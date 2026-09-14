import { getProductionApplication } from "@/lib/production/server";
import { finalizeAssessment } from "@/lib/production/finalize-assessment";
import { sameOrigin, uuid, productionError } from "@/lib/production/http";
import { BkQuestionError } from "@/lib/bk-skjema/questions";
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;assessmentId:string}>}) {
  try {
    sameOrigin(request);
    const body=await request.json();const ids=await params;
    if(!body||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||!Array.isArray(body.acknowledgedGaps)||!body.acknowledgedGaps.every((g:unknown)=>typeof g==="string"))throw new BkQuestionError("Invalid finalization request.");
    const id=await finalizeAssessment(await getProductionApplication(),uuid(ids.projectId),uuid(ids.assessmentId),{id:uuid(body.id),expectedRevision:body.expectedRevision,acknowledgedGaps:body.acknowledgedGaps});
    return Response.json({id},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){return productionError(error);}
}
