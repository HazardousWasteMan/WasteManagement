import { getProductionApplication } from "@/lib/production/server";
import { answerBkQuestions, loadBkWorkspace } from "@/lib/production/bk-workspace";
import { sameOrigin,uuid,productionError } from "@/lib/production/http";
import { BkQuestionError } from "@/lib/bk-skjema/questions";

export async function POST(request:Request,{params}:{params:Promise<{projectId:string;assessmentId:string}>}) {
  try {
    sameOrigin(request);
    const app=await getProductionApplication();
    const ids=await params;
    const body=await request.json();
    if(!body||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new BkQuestionError("Invalid draft answer.");
    const answers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? body.answers
      : typeof body.questionId === "string" ? {[body.questionId]:body.answer} : null;
    if(!answers)throw new BkQuestionError("Invalid draft answers.");
    const projectId=uuid(ids.projectId);const assessmentId=uuid(ids.assessmentId);
    const result=await answerBkQuestions(app,projectId,assessmentId,{id:uuid(body.id),expectedRevision:body.expectedRevision,answers});
    const current=await loadBkWorkspace(app,projectId,assessmentId);
    return Response.json({revision:result.revision,workspace:result.workspace,eligibility:current?.eligibility},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {return productionError(error);}
}
