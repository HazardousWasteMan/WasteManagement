import { createAssessmentSuccessor } from "@/lib/production/finalize-assessment";
import { getProductionApplication } from "@/lib/production/server";
import { sameOrigin, uuid, productionError } from "@/lib/production/http";
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;assessmentId:string}>}) {
  try {
    sameOrigin(request);const body=await request.json();const ids=await params;
    const app=await getProductionApplication();
    const id=await createAssessmentSuccessor(app,uuid(ids.projectId),uuid(ids.assessmentId),{id:uuid(body?.id),replacementAssessmentId:body?.replacementAssessmentId?uuid(body.replacementAssessmentId):undefined});
    return Response.json({assessmentId:id},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){return productionError(error);}
}
