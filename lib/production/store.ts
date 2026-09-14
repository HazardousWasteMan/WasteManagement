import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Assessment, AssessmentSourceDocument, CreateAssessment, CreateProject,
  CreateSourceDocument, CreateWasteStream, Organisation, ProductionDatabase,
  Project, SourceDocument, WasteStream,
} from "./types";

export interface ProductionStore {
  getOrganisation(): Promise<Organisation | null>;
  listProjects(): Promise<Project[]>;
  createProject(input: CreateProject): Promise<Project>;
  listWasteStreams(projectId: string): Promise<WasteStream[]>;
  createWasteStream(input: CreateWasteStream): Promise<WasteStream>;
  listSourceDocuments(projectId: string): Promise<SourceDocument[]>;
  createSourceDocument(input: CreateSourceDocument): Promise<SourceDocument>;
  listAssessments(wasteStreamId: string): Promise<Assessment[]>;
  getAssessment(projectId: string, id: string): Promise<Assessment | null>;
  createAssessment(input: CreateAssessment): Promise<Assessment>;
  listAssessmentDocuments(projectId: string, assessmentId: string): Promise<AssessmentSourceDocument[]>;
}

function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Production persistence: ${result.error.message}`);
  return result.data;
}

/** Bind one selected customer context. Pass a Supabase client authenticated as the actual
 * user (publishable/anon key + user session), NEVER a service-role client: RLS is the
 * authorisation boundary. An organisation ID alone confers no access. No env/global default,
 * demo fallback or automatic legacy import. This module performs no classification. */
export function createProductionStore(
  client: SupabaseClient<ProductionDatabase>,
  organisationId: string,
): ProductionStore {
  if (!organisationId.trim()) throw new Error("Organisation ID is required");
  return {
    async getOrganisation() {
      return unwrap(await client.from("organisations").select("*").eq("id", organisationId).maybeSingle());
    },
    async listProjects() {
      return unwrap(await client.from("projects").select("*")
        .eq("organisation_id", organisationId).order("created_at").order("id")) ?? [];
    },
    async createProject(input) {
      // Explicit projection prevents runtime extra properties from overriding tenant/IDs.
      return unwrap(await client.from("projects").insert({
        organisation_id: organisationId, name: input.name, location: input.location,
      }).select("*").single())!;
    },
    async listWasteStreams(projectId) {
      return unwrap(await client.from("waste_streams").select("*")
        .eq("organisation_id", organisationId).eq("project_id", projectId)
        .order("created_at").order("id")) ?? [];
    },
    async createWasteStream(input) {
      return unwrap(await client.from("waste_streams").insert({
        organisation_id: organisationId, project_id: input.project_id, name: input.name,
        origin_process: input.origin_process, description: input.description,
      }).select("*").single())!;
    },
    async listSourceDocuments(projectId) {
      return unwrap(await client.from("source_documents").select("*")
        .eq("organisation_id", organisationId).eq("project_id", projectId)
        .order("created_at").order("id")) ?? [];
    },
    async createSourceDocument(input) {
      return unwrap(await client.from("source_documents").insert({
        organisation_id: organisationId, project_id: input.project_id,
        filename: input.filename, storage_key: input.storage_key, sha256: input.sha256,
      }).select("*").single())!;
    },
    async listAssessments(wasteStreamId) {
      return unwrap(await client.from("assessments").select("*")
        .eq("organisation_id", organisationId).eq("waste_stream_id", wasteStreamId)
        .order("version")) ?? [];
    },
    async getAssessment(projectId, id) {
      return unwrap(await client.from("assessments").select("*")
        .eq("organisation_id", organisationId).eq("project_id", projectId).eq("id", id).maybeSingle());
    },
    async createAssessment(input) {
      return unwrap(await client.rpc("production_create_assessment", {
        p_organisation_id: organisationId, p_project_id: input.project_id,
        p_waste_stream_id: input.waste_stream_id, p_id: input.id,
        p_assessed_at: input.assessed_at, p_eal_code: input.eal_code,
        p_is_hazardous: input.is_hazardous, p_decision_snapshot: input.decision_snapshot,
        p_documents: input.documents, p_bk_output: input.bk_output,
        p_compliance_evidence: input.compliance_evidence,
      }))!;
    },
    async listAssessmentDocuments(projectId, assessmentId) {
      return unwrap(await client.from("assessment_source_documents").select("*")
        .eq("organisation_id", organisationId).eq("project_id", projectId).eq("assessment_id", assessmentId)
        .order("source_document_id").order("segment_key")) ?? [];
    },
  };
}
