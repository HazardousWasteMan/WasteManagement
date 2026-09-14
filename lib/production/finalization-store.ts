import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionDatabase, Assessment, WasteStream, SourceDocument, AssessmentSourceDocument, JsonObject } from "./types";
import type { BkWorkspace } from "@/lib/bk-skjema/workspace";
import type { FormFreeze, LegalParagraph } from "@/lib/compliance/types";
import { ProcessingPersistenceError } from "./processing-store";

export type LegalFreeze = FormFreeze & { paragraph: LegalParagraph; contentSha256: string; disputed: boolean; primary: boolean };
export type Finalization = {
  id: string; organisation_id: string; project_id: string; assessment_id: string; bk_revision: number;
  finalized_at: string; created_by: string; snapshot_sha256: string; pdf_sha256: string;
  snapshot: {assessment: Assessment; workspace: BkWorkspace; stream: WasteStream;
    sources: {link: AssessmentSourceDocument; document: SourceDocument}[]; legalFreezes: LegalFreeze[];
    acknowledgedGaps: string[]; artifactVersion: JsonObject;processingRuns:import("./processing-types").ProcessingRun[];processingRun:import("./processing-types").ProcessingRun|null};
};
export type AuditEvent = {id: number; organisation_id: string; project_id: string; assessment_id: string; kind: string; detail: JsonObject; occurred_at: string; actor_id: string};
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
function unwrap<T>(r: {data: T; error: {message: string; code?: string} | null}): T {if(r.error)throw new ProcessingPersistenceError(r.error.message,r.error.code);return r.data;}
/** Exact artifact and snapshot storage is PostgreSQL bytea/JSON, atomic and local-testable. */
export function createFinalizationStore(client: SupabaseClient<ProductionDatabase>, organisationId: string) {
  return {
    async get(projectId: string, assessmentId: string): Promise<Finalization|null> {
      return unwrap(await client.from("production_finalizations").select("id,organisation_id,project_id,assessment_id,bk_revision,snapshot,snapshot_sha256,pdf_sha256,finalized_at,created_by").eq("organisation_id",organisationId).eq("project_id",projectId).eq("assessment_id",assessmentId).maybeSingle());
    },
    async audit(projectId: string, assessmentId: string): Promise<AuditEvent[]> {
      return unwrap(await client.from("production_audit_events").select("*").eq("organisation_id",organisationId).eq("project_id",projectId).eq("assessment_id",assessmentId).order("id")) ?? [];
    },
    async pdf(projectId: string, assessmentId: string) {
      return unwrap(await client.rpc("production_read_finalized_pdf",{p_organisation_id:organisationId,p_project_id:projectId,p_assessment_id:assessmentId}));
    },
    async finalize(projectId: string, assessmentId: string, input: {id: string; expectedRevision: number; pdf: Uint8Array; legalFreezes: LegalFreeze[]; acknowledgedGaps: string[]; artifactVersion: JsonObject}) {
      return unwrap(await client.rpc("production_finalize_assessment",{p_organisation_id:organisationId,p_project_id:projectId,p_assessment_id:assessmentId,p_id:input.id,p_expected_revision:input.expectedRevision,p_pdf_base64:Buffer.from(input.pdf).toString("base64"),p_legal_freezes:json(input.legalFreezes),p_acknowledged_gaps:input.acknowledgedGaps,p_artifact_version:input.artifactVersion}));
    },
    async successor(projectId: string, assessmentId: string, id: string, replacement?: {assessmentId:string;workspace:BkWorkspace}) {
      return unwrap(await client.rpc("production_create_successor",{p_organisation_id:organisationId,p_project_id:projectId,p_assessment_id:assessmentId,p_new_id:id,...(replacement?{p_replacement_id:replacement.assessmentId,p_workspace:json(replacement.workspace)}:{})}));
    },
  };
}
