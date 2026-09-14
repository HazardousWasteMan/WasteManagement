import { getProductionApplication } from "@/lib/production/server";
import { loadBkWorkspace, reviewAssessmentEal } from "@/lib/production/bk-workspace";
import { sameOrigin,uuid,productionError } from "@/lib/production/http";
import { BkQuestionError } from "@/lib/bk-skjema/questions";

export async function POST(request:Request,{params}:{params:Promise<{projectId:string;assessmentId:string}>}) {
  try {
    sameOrigin(request);
    const body=await request.json();const ids=await params;
    if(!body||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.selectedCode!=="string"||typeof body.reason!=="string")throw new BkQuestionError("Invalid EAL review.");
    const app=await getProductionApplication();const projectId=uuid(ids.projectId);const assessmentId=uuid(ids.assessmentId);
    const result=await reviewAssessmentEal(app,projectId,assessmentId,{id:uuid(body.id),expectedRevision:body.expectedRevision,selectedCode:body.selectedCode,reason:body.reason});
    const current=await loadBkWorkspace(app,projectId,assessmentId);
    return Response.json({revision:result.revision,workspace:result.workspace,eligibility:current?.eligibility,reviewedAt:result.created_at,reviewedBy:result.created_by},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){return productionError(error);}
}
