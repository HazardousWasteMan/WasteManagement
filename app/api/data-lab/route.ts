import { NextRequest, NextResponse } from "next/server";
import { convertDocument, extractStructured, buildBkPageSchema } from "@/lib/bk-skjema/datalab";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";

// Datalab parses and extracts server-side; both are polled. Comfortable margin under Vercel's cap.
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const VALID_ORIGINS = new Set(ORIGIN_OPTIONS.map(o => o.value));

/**
 * Streams NDJSON rather than returning a single JSON body. The work is two sequential Datalab
 * calls that together take 30-75s, and without progress events the client can only show an
 * unchanging "working" message for over a minute. Streaming lets it name the phase it is
 * actually in instead of guessing from a timer.
 *
 * One consequence: once the first event is written the status code is already 200, so failures
 * after that point arrive as a {phase:"error"} event rather than an HTTP error. Validation
 * failures happen before the stream opens and still return real status codes.
 */
export async function POST(request: NextRequest) {
  if (!process.env.DATALAB_API_KEY) {
    return NextResponse.json({ error: "DATALAB_API_KEY is not configured on the server" }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is larger than 25 MB" }, { status: 413 });
  }

  const originRaw = formData.get("originProcess");
  const originProcess = typeof originRaw === "string" && originRaw ? originRaw : null;
  if (originProcess && !VALID_ORIGINS.has(originProcess)) {
    return NextResponse.json({ error: "Unknown originProcess" }, { status: 400 });
  }

  const pageRangeRaw = formData.get("pageRange");
  const pageRange = typeof pageRangeRaw === "string" && pageRangeRaw.trim() ? pageRangeRaw.trim() : undefined;
  if (pageRange && !/^[\d,\-\s]+$/.test(pageRange)) {
    return NextResponse.json({ error: "pageRange must look like \"0,5-10\"" }, { status: 400 });
  }

  const pdf = Buffer.from(await file.arrayBuffer());
  const filename = file instanceof File ? file.name : "analyse.pdf";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        send({ phase: "converting" });
        // Convert with save_checkpoint, then extract against the checkpoint: the document is
        // parsed (and billed) once, and the block tree is what makes citations resolvable.
        const converted = await convertDocument(pdf, filename, { pageRange });

        send({ phase: "extracting", pageCount: converted.pageCount, costCents: converted.costCents });
        const extracted = await extractStructured(
          buildBkPageSchema(),
          converted.checkpointId ? { checkpointId: converted.checkpointId } : { pdf, filename },
          { pageRange }
        );

        const result = bkFromDatalab(extracted.data, converted.blocks, originProcess);
        send({
          phase: "done",
          result: {
            fields: result.fields,
            metadata: result.source.metadata,
            results: result.source.results,
            classification: result.classification,
            unmatchedAnalytes: result.unmatchedAnalytes,
            pages: converted.pages,
            pageCount: converted.pageCount,
            blocks: converted.blocks,
            raw: extracted.data,
            costCents: converted.costCents + extracted.costCents,
          },
        });
      } catch (err) {
        console.error("Data Lab extraction failed:", err);
        send({ phase: "error", error: err instanceof Error ? err.message : "Datalab extraction failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Stops any intermediary from buffering the stream and defeating the point of it.
      "X-Accel-Buffering": "no",
    },
  });
}
