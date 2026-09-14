import { getProductionApplication } from "@/lib/production/server";
import { uuid, origin, sameOrigin, productionError } from "@/lib/production/http";
import { MAX_PROJECT_UPLOAD_BYTES, ProjectInputError, uploadProjectDocument, processProjectDocument } from "@/lib/production/process-document";

export const maxDuration = 300;
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    sameOrigin(request);
    const { processing } = await getProductionApplication();
    const projectId = uuid((await params).projectId);
    const form = await request.formData();
    const runId = uuid(form.get("runId"));
    const originProcess = origin(form.get("originProcess"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new ProjectInputError("Select an analysis PDF");
    if (file.size > MAX_PROJECT_UPLOAD_BYTES) throw new ProjectInputError("PDF must be 25 MB or smaller");
    const document = await uploadProjectDocument(processing, projectId, file.name, Buffer.from(await file.arrayBuffer()));
    const run = await processProjectDocument(processing, { projectId, documentId: document.id, runId, originProcess });
    return Response.json({ document, run });
  } catch (error) { return productionError(error); }
}
