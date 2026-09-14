import type { Finalization, AuditEvent } from "./finalization-store";
import type { BkRevision } from "./bk-draft-store";
import type { ProcessingRun, ProcessingSample } from "./processing-types";
/** Production persistence contracts. Deliberately separate from lib/projects.ts's legacy
 * browser/demo records. Field names mirror Postgres; timestamps are ISO strings. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Organisation = {
  id: string;
  name: string;
  created_at: string;
};

export type Project = {
  id: string;
  organisation_id: string;
  name: string;
  location: string;
  created_at: string;
};

export type WasteStream = {
  id: string;
  organisation_id: string;
  project_id: string;
  name: string;
  origin_process: string | null;
  description: string;
  created_at: string;
};

export type SourceDocument = {
  id: string;
  organisation_id: string;
  project_id: string;
  filename: string;
  /** Organisation/project-prefixed immutable object locator, not a public URL. */
  storage_key: string;
  sha256: string;
  created_at: string;
};

/** An append-only point-in-time snapshot, not a finalized BK declaration. No update API. */
export type Assessment = {
  id: string;
  organisation_id: string;
  project_id: string;
  waste_stream_id: string;
  version: number;
  previous_assessment_id: string | null;
  assessed_at: string;
  created_at: string;
  created_by: string;
  eal_code: string | null;
  is_hazardous: boolean | null;
  /** Evidence/engine provenance supplied by the caller; no classification is performed here. */
  decision_snapshot: JsonObject;
  bk_output: JsonObject | null;
  compliance_evidence: Json[];
};

export type AssessmentSourceDocument = {
  organisation_id: string;
  project_id: string;
  assessment_id: string;
  source_document_id: string;
  segment_key: string;
  /** Zero-based inclusive source page range; both null means an unspecified range. */
  first_page: number | null;
  last_page: number | null;
};

export type SourceDocumentLink = Pick<AssessmentSourceDocument,
  "source_document_id" | "segment_key" | "first_page" | "last_page">;

export type CreateProject = Pick<Project, "name" | "location">;
export type CreateWasteStream = Pick<WasteStream, "project_id" | "name" | "origin_process" | "description">;
export type CreateSourceDocument = Pick<SourceDocument, "project_id" | "filename" | "storage_key" | "sha256">;
export type CreateAssessment = Pick<Assessment,
  "id" | "project_id" | "waste_stream_id" | "assessed_at" | "eal_code" | "is_hazardous" |
  "decision_snapshot" | "bk_output" | "compliance_evidence"> & {
    /** Complete link set at creation; cannot append evidence to a historical snapshot. */
    documents: SourceDocumentLink[];
  };

type Table<Row, Insert = never> = { Row: Row; Insert: Insert; Update: never; Relationships: [] };
type OwnedInsert<Input> = Input & { organisation_id: string };

/** Scoped to the new tables only; existing compliance clients retain their own contracts. */
export type ProductionDatabase = {
  public: {
    Tables: {
      production_backend_identities: Table<{ user_id: string; created_at: string }, { user_id: string }>;
      production_finalizations: Table<Finalization>;
      production_audit_events: Table<AuditEvent>;
      production_bk_revisions: Table<BkRevision>;
      production_processing_runs: Table<ProcessingRun>;
      production_processing_samples: Table<ProcessingSample>;
      organisations: Table<Organisation>;
      organisation_members: Table<{ organisation_id: string; user_id: string }>;
      projects: Table<Project, OwnedInsert<CreateProject>>;
      waste_streams: Table<WasteStream, OwnedInsert<CreateWasteStream>>;
      source_documents: Table<SourceDocument, OwnedInsert<CreateSourceDocument>>;
      assessments: Table<Assessment>;
      assessment_source_documents: Table<AssessmentSourceDocument>;
    };
    Views: { [_ in never]: never };
    Functions: {
      production_finalize_assessment: {Args:{p_organisation_id:string;p_project_id:string;p_assessment_id:string;p_id:string;p_expected_revision:number;p_pdf_base64:string;p_legal_freezes:Json[];p_acknowledged_gaps:string[];p_artifact_version:JsonObject};Returns:string};
      production_read_finalized_pdf: {Args:{p_organisation_id:string;p_project_id:string;p_assessment_id:string};Returns:string|null};
      production_create_successor: {Args:{p_organisation_id:string;p_project_id:string;p_assessment_id:string;p_new_id:string;p_replacement_id?:string;p_workspace?:JsonObject};Returns:string};
      production_save_bk_revision: { Args: {p_organisation_id: string; p_project_id: string; p_assessment_id: string; p_id: string; p_expected_revision: number; p_answers: JsonObject; p_workspace: JsonObject}; Returns: BkRevision };
      production_review_eal: { Args: {p_organisation_id: string; p_project_id: string; p_assessment_id: string; p_id: string; p_expected_revision: number; p_workspace: JsonObject}; Returns: BkRevision };
      production_upload_document: { Args: { p_organisation_id: string; p_project_id: string; p_filename: string; p_sha256: string; p_content_base64: string }; Returns: SourceDocument };
      production_read_document: { Args: { p_organisation_id: string; p_project_id: string; p_document_id: string }; Returns: string | null };
      production_begin_processing: { Args: { p_organisation_id: string; p_project_id: string; p_document_id: string; p_run_id: string; p_origin_process: string | null }; Returns: { run: ProcessingRun; claimed: boolean } };
      production_register_samples: { Args: { p_organisation_id: string; p_project_id: string; p_run_id: string; p_samples: JsonObject[] }; Returns: undefined };
      production_save_sample: { Args: { p_organisation_id: string; p_project_id: string; p_run_id: string; p_index: number; p_snapshot: JsonObject | null; p_bk_output: JsonObject | null; p_compliance_evidence: Json[]; p_bk_status: string | null; p_error: string | null }; Returns: ProcessingSample };
      production_finish_processing: { Args: { p_organisation_id: string; p_project_id: string; p_run_id: string; p_error: string | null }; Returns: ProcessingRun };
      production_create_assessment: {
        Args: {
          p_organisation_id: string;
          p_project_id: string;
          p_waste_stream_id: string;
          p_id: string;
          p_assessed_at: string;
          p_eal_code: string | null;
          p_is_hazardous: boolean | null;
          p_decision_snapshot: JsonObject;
          p_documents: SourceDocumentLink[];
          p_bk_output: JsonObject | null;
          p_compliance_evidence: Json[];
        };
        Returns: Assessment;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/** Safe application-shell DTO: no credentials, database client or mutable tenant selection. */
export type OrganisationState =
  | { status: "ready"; organisation: Pick<Organisation, "id" | "name"> }
  | { status: "unconfigured" | "unavailable"; organisation: null };
