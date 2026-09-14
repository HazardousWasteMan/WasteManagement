import { getProductionApplication } from "@/lib/production/server";
import { uuid, origin, sameOrigin, productionError } from "@/lib/production/http";
import { processProjectDocument } from "@/lib/production/process-document";

export const maxDuration = 300;
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  try {
    sameOrigin(request);
    const { processing } = await getProductionApplication();
    const path = await params;
    const body = await request.json();
    const run = await processProjectDocument(processing, { projectId: uuid(path.projectId), documentId: uuid(path.documentId), runId: uuid(body?.runId), originProcess: origin(body?.originProcess) });
    return Response.json({ run });
  } catch (error) { return productionError(error); }
}
