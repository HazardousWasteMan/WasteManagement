import "@/lib/pdf-globals";
import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractSampleData, listSamples, hasUsableText, ExtractionTruncatedError, ExtractionTimeoutError } from "@/lib/hp-classification/extract";
import type { AnalyteReference } from "@/lib/hp-classification/types";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import path from "node:path";

GlobalWorkerOptions.workerSrc = path.join(
  process.cwd(),
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
);

// Comfortable margin under Vercel Hobby's hard 300s cap — extractSampleData's own internal
// timeout (270s) fires first and produces an honest error; this is a backstop, not the primary
// mechanism. See lib/hp-classification/extract.ts's EXTRACTION_TIMEOUT_MS for the real guard.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
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

  const buffer = Buffer.from(await file.arrayBuffer());

  let pdfText: string;
  try {
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    pdfText = parsed.text;
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded PDF" }, { status: 422 });
  }

  const detectedSamples = await listSamples(pdfText, buffer);
  // Sub-tests (e.g. leachate/eluate tests) belong to a top-level sample and should never appear
  // in the picker or count toward "how many samples were detected".
  const topLevelSamples = detectedSamples.filter(s => s.parentSampleIdentifier === null);

  if (topLevelSamples.length > 1) {
    return NextResponse.json({ samples: topLevelSamples });
  }

  // 0 or 1 top-level samples detected: proceed exactly as before this feature existed — a single
  // sampleIdentifier (or null if Stage A found nothing/failed) scoped extraction call.
  const sampleIdentifier = topLevelSamples.length === 1 ? topLevelSamples[0].sampleIdentifier : null;

  try {
    const data = await extractSampleData(pdfText, buffer, analyteReferenceRaw as AnalyteReference[], sampleIdentifier);
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof ExtractionTruncatedError) {
      console.error("Extraction truncated (response length limit):", err);
      return NextResponse.json(
        {
          error:
            "This report is too large or detailed to extract in a single pass — its data exceeded the processing response limit. Try a smaller or simpler report, or contact support.",
        },
        { status: 422 }
      );
    }
    if (err instanceof ExtractionTimeoutError) {
      console.error("Extraction timed out:", err);
      return NextResponse.json(
        {
          error:
            "This report is too large or detailed to finish processing in the available time. Try a smaller or simpler report, or contact support.",
        },
        { status: 422 }
      );
    }
    const status = hasUsableText(pdfText) ? 502 : 422;
    if (status === 422) {
      console.error("Native-PDF extraction fallback failed:", err);
      return NextResponse.json(
        {
          error:
            "This PDF appears to be scanned or otherwise unreadable, and automatic extraction from the document image was unsuccessful. Try a different file, or a report with an embedded text layer.",
        },
        { status: 422 }
      );
    }
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
