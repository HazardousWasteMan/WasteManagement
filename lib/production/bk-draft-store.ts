import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonObject, ProductionDatabase } from "./types";
import type { BkWorkspace } from "@/lib/bk-skjema/workspace";
import type { BkAnswers } from "@/lib/bk-skjema/questions";
import { ProcessingPersistenceError } from "./processing-store";
export type BkRevision = { id: string; organisation_id: string; project_id: string; assessment_id: string; revision: number; state: "draft" | "ready"; answers: BkAnswers; workspace: BkWorkspace; created_at: string; created_by: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonObject;
function unwrap<T>(result: {data: T; error: {message: string; code?: string} | null}): T { if (result.error) throw new ProcessingPersistenceError(result.error.message,result.error.code); return result.data; }
export function createBkDraftStore(client: SupabaseClient<ProductionDatabase>, organisationId: string) {
  return {
    async links(projectId: string, assessmentId: string) {
      return unwrap(await client.from("assessment_source_documents").select("*").eq("organisation_id",organisationId).eq("project_id",projectId).eq("assessment_id",assessmentId)) ?? [];
    },
    async get(projectId: string, assessmentId: string, revision?: number): Promise<BkRevision | null> {
      let query = client.from("production_bk_revisions").select("*").eq("organisation_id", organisationId).eq("project_id", projectId).eq("assessment_id",assessmentId);
      if (revision !== undefined) query = query.eq("revision",revision);
      return unwrap(await query.order("revision", {ascending:false}).limit(1).maybeSingle()) as BkRevision | null;
    },
    async history(projectId: string, assessmentId: string) {
      return unwrap(await client.from("production_bk_revisions").select("revision,state,created_at").eq("organisation_id",organisationId).eq("project_id",projectId).eq("assessment_id",assessmentId).order("revision",{ascending:false})) ?? [];
    },
    async save(projectId: string, assessmentId: string, id: string, expectedRevision: number, workspace: BkWorkspace): Promise<BkRevision> {
      return unwrap(await client.rpc("production_save_bk_revision",{p_organisation_id:organisationId,p_project_id:projectId,p_assessment_id:assessmentId,p_id:id,p_expected_revision:expectedRevision,p_answers:json(workspace.answers),p_workspace:json(workspace)})) as unknown as BkRevision;
    },
    async reviewEal(projectId:string,assessmentId:string,id:string,expectedRevision:number,workspace:BkWorkspace):Promise<BkRevision>{
      return unwrap(await client.rpc("production_review_eal",{p_organisation_id:organisationId,p_project_id:projectId,p_assessment_id:assessmentId,p_id:id,p_expected_revision:expectedRevision,p_workspace:json(workspace)})) as unknown as BkRevision;
    },
  };
}
