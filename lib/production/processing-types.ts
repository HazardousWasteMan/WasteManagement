import type { Assessment, JsonObject, Project, SourceDocument, WasteStream } from "./types";
import type { EffectiveEal } from "@/lib/hp-classification/eal";
import type { EffectiveHazardStatus } from "./presentation";

export type ProcessingRun = {
  id: string; organisation_id: string; project_id: string; source_document_id: string;
  origin_process: string | null;
  status: "processing" | "completed" | "partial" | "failed";
  started_at: string; lease_expires_at: string; finished_at: string | null; error_message: string | null;
};
export type ProcessingSample = {
  organisation_id: string; project_id: string; run_id: string; sample_index: number;
  source_metadata: JsonObject; status: "pending" | "succeeded" | "failed";
  assessment_id: string | null; error_message: string | null;
  bk_status: "needs_input" | "needs_review" | "draft_ready" | null;
};
export type AssessmentSummary = Pick<Assessment, "id" | "waste_stream_id" | "version" | "created_at" | "eal_code" | "is_hazardous"> & {
  effectiveEal: EffectiveEal;
  hazardStatus: EffectiveHazardStatus;
  bkStatus: "needs_input" | "needs_review" | "draft_ready" | "finalized";
  finalized: boolean;
};
export type ProjectOverview = {
  checkedAt: number;
  project: Project; documents: SourceDocument[]; runs: ProcessingRun[];
  samples: ProcessingSample[]; streams: WasteStream[]; assessments: AssessmentSummary[];
};
