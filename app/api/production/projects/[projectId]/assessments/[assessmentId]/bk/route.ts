import fs from "node:fs/promises";
import path from "node:path";
import { getProductionApplication } from "@/lib/production/server";
import { loadBkWorkspace } from "@/lib/production/bk-workspace";
import { BkQuestionError } from "@/lib/bk-skjema/questions";
import { uuid, productionError } from "@/lib/production/http";
import { fillBkPdf } from "@/lib/bk-skjema/fill-pdf";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; assessmentId: string }> }) {
  try {
    const app = await getProductionApplication();
    const ids = await params;
    const revisionValue = new URL(request.url).searchParams.get("revision");
    const revision = revisionValue === null ? undefined : Number(revisionValue);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new BkQuestionError("Invalid revision.");
    const projectId=uuid(ids.projectId), assessmentId=uuid(ids.assessmentId);
    // Frozen downloads do not depend on the current question model, renderer or template.
    const frozen=await app.finalizations.get(projectId,assessmentId);
    if(frozen&&(revision===undefined||revision===frozen.bk_revision)){
      const base64=await app.finalizations.pdf(projectId,assessmentId);
      if(!base64)throw new Error("Finalized artifact missing");
      return new Response(Buffer.from(base64,"base64"),{headers:{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="bk-finalized.pdf"',"Cache-Control":"private, no-store"}});
    }
    const loaded = await loadBkWorkspace(app,projectId,assessmentId,revision);
    if (!loaded) return Response.json({ error: "BK draft not found" }, { status: 404 });
    const blank = await fs.readFile(path.join(process.cwd(), "public/forms/bk-skjema-blank.pdf"));
    const { pdf } = await fillBkPdf(blank, loaded.workspace.fields, { fitText: true });
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="bk-draft.pdf"', "Cache-Control": "private, no-store" } });
  } catch (error) { return productionError(error); }
}
