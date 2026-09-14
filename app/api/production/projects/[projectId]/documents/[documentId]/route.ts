import { getProductionApplication } from "@/lib/production/server";
import { uuid, productionError } from "@/lib/production/http";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  try {
    const { processing } = await getProductionApplication();
    const path = await params;
    const source = await processing.readDocument(uuid(path.projectId), uuid(path.documentId));
    if (!source) return Response.json({ error: "Document not found" }, { status: 404 });
    return new Response(new Uint8Array(Buffer.from(source.base64, "base64")), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="analysis.pdf"; filename*=UTF-8''${encodeURIComponent(source.document.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return productionError(error); }
}
