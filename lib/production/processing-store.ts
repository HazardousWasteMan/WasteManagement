import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, JsonObject, ProductionDatabase, SourceDocument } from "./types";
import type { ProcessingRun, ProcessingSample, ProjectOverview } from "./processing-types";
import type { BkWorkspace } from "@/lib/bk-skjema/workspace";
import type { HazardClassification } from "@/lib/hp-classification/hazard";
import { effectiveHazardStatus } from "./presentation";
import { effectiveEal } from "@/lib/hp-classification/eal";
import type { Finalization } from "./finalization-store";
import type { BkRevision } from "./bk-draft-store";

export class ProcessingPersistenceError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
function unwrap<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new ProcessingPersistenceError(result.error.message, result.error.code);
  return result.data;
}
export interface ProcessingStore {
  overview(projectId: string): Promise<ProjectOverview | null>;
  upload(projectId: string, filename: string, sha256: string, base64: string): Promise<SourceDocument>;
  readDocument(projectId: string, documentId: string): Promise<{ document: SourceDocument; base64: string } | null>;
  begin(projectId: string, documentId: string, runId: string, origin: string | null): Promise<{ run: ProcessingRun; claimed: boolean }>;
  register(projectId: string, runId: string, samples: JsonObject[]): Promise<void>;
  save(projectId: string, runId: string, index: number, result: {
    snapshot: JsonObject | null; bk: JsonObject | null; compliance: Json[];
    bkStatus: ProcessingSample["bk_status"]; error: string | null;
  }): Promise<ProcessingSample>;
  finish(projectId: string, runId: string, error: string | null): Promise<ProcessingRun>;
  assessment(projectId: string, assessmentId: string): Promise<import("./types").Assessment | null>;
}

/** Infrastructure adapter; feature code obtains this through getProductionApplication(). */
export function createProcessingStore(client: SupabaseClient<ProductionDatabase>, organisationId: string): ProcessingStore {
  return {
    async overview(projectId) {
      const project = unwrap(await client.from("projects").select("*").eq("organisation_id", organisationId).eq("id", projectId).maybeSingle());
      if (!project) return null;
      const [documents, runs, samples, streams, assessmentsResult, revisionsResult, finalizationsResult] = await Promise.all([
        client.from("source_documents").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).order("created_at", { ascending: false }),
        client.from("production_processing_runs").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).order("started_at", { ascending: false }),
        client.from("production_processing_samples").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).order("sample_index"),
        client.from("waste_streams").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).order("created_at"),
        client.from("assessments").select("id,waste_stream_id,version,created_at,eal_code,is_hazardous,decision_snapshot").eq("organisation_id", organisationId).eq("project_id", projectId).order("created_at"),
        client.from("production_bk_revisions").select("assessment_id,revision,state,workspace").eq("organisation_id", organisationId).eq("project_id", projectId).order("revision", {ascending:false}),
        client.from("production_finalizations").select("assessment_id,snapshot").eq("organisation_id", organisationId).eq("project_id", projectId),
      ]);
      const revisions = (unwrap(revisionsResult) ?? []) as Pick<BkRevision,"assessment_id"|"revision"|"state"|"workspace">[];
      const finalizations = (unwrap(finalizationsResult) ?? []) as Pick<Finalization,"assessment_id"|"snapshot">[];
      const sampleRows = unwrap(samples) ?? [];
      const assessments = (unwrap(assessmentsResult) ?? []).map(assessment => {
        const finalization = finalizations.find(item => item.assessment_id === assessment.id);
        const latest = revisions.find(item => item.assessment_id === assessment.id);
        const finalWorkspace = finalization?.snapshot.workspace;
        const latestWorkspace = latest?.workspace as BkWorkspace | undefined;
        const resolvedEal = effectiveEal({
          decisions: [finalWorkspace?.ealDecision, latestWorkspace?.ealDecision],
          persistedCode: assessment.eal_code,
        });
        const snapshot=assessment.decision_snapshot as {classification?:{hazard?:HazardClassification}};
        const initialStatus = sampleRows.find(sample => sample.assessment_id === assessment.id)?.bk_status;
        return {
          ...assessment,
          effectiveEal: resolvedEal,
          hazardStatus:effectiveHazardStatus({hazard:snapshot.classification?.hazard,persisted:assessment.is_hazardous}),
          finalized: Boolean(finalization),
          bkStatus: finalization ? "finalized" as const
            : resolvedEal.status === "needs_review" ? "needs_review" as const
            : latestWorkspace?.state === "ready" || (!latestWorkspace && initialStatus === "draft_ready") ? "draft_ready" as const
            : "needs_input" as const,
        };
      });
      return { checkedAt: Date.now(), project, documents: unwrap(documents) ?? [], runs: unwrap(runs) ?? [], samples: sampleRows, streams: unwrap(streams) ?? [], assessments };
    },
    async upload(projectId, filename, sha256, base64) {
      return unwrap(await client.rpc("production_upload_document", { p_organisation_id: organisationId, p_project_id: projectId, p_filename: filename, p_sha256: sha256, p_content_base64: base64 }))!;
    },
    async readDocument(projectId, documentId) {
      const document = unwrap(await client.from("source_documents").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).eq("id", documentId).maybeSingle());
      if (!document) return null;
      const base64 = unwrap(await client.rpc("production_read_document", { p_organisation_id: organisationId, p_project_id: projectId, p_document_id: documentId }));
      return base64 ? { document, base64 } : null;
    },
    async begin(projectId, documentId, runId, origin) {
      return unwrap(await client.rpc("production_begin_processing", { p_organisation_id: organisationId, p_project_id: projectId, p_document_id: documentId, p_run_id: runId, p_origin_process: origin }))!;
    },
    async register(projectId, runId, samples) {
      unwrap(await client.rpc("production_register_samples", { p_organisation_id: organisationId, p_project_id: projectId, p_run_id: runId, p_samples: samples }));
    },
    async save(projectId, runId, index, result) {
      return unwrap(await client.rpc("production_save_sample", { p_organisation_id: organisationId, p_project_id: projectId, p_run_id: runId, p_index: index,
        p_snapshot: result.snapshot, p_bk_output: result.bk, p_compliance_evidence: result.compliance, p_bk_status: result.bkStatus, p_error: result.error }))!;
    },
    async finish(projectId, runId, error) {
      return unwrap(await client.rpc("production_finish_processing", { p_organisation_id: organisationId, p_project_id: projectId, p_run_id: runId, p_error: error }))!;
    },
    async assessment(projectId, assessmentId) {
      return unwrap(await client.from("assessments").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).eq("id", assessmentId).maybeSingle());
    },
  };
}
