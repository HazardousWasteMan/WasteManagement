import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";
import type { TestResult } from "./hazard";
import { ORIGIN_OPTIONS } from "./origin-options";
import { PDFDocument } from "pdf-lib";
import { shouldBatchDocument, computeBatchPageRanges, getPdfPageCount, splitPdfIntoBatches, mergeExtractionResults } from "./pdf-batching";

export interface ExtractionResult {
  metadata: Partial<SampleMetadata>;
  results: Omit<SampleResult, "sampleId" | "method">[];
  testResults: TestResult[];
  unmatchedAnalytes: string[];
  // Claude's own best-guess match against the real ORIGIN_OPTIONS list (or null if unsure).
  // Always validated/normalized before being trusted — see normalizeSuggestedOriginProcess.
  suggestedOriginProcess: string | null;
  // Set by our own code (not by the LLM), based on whether pdf-parse found usable text.
  // "document" means this result came from a lower-fidelity scanned/image extraction path.
  sourceType: "text" | "document";
}

export function validateExtractionResponse(x: unknown): x is ExtractionResult {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;

  if (!d.metadata || typeof d.metadata !== "object") return false;
  if (!Array.isArray(d.results)) return false;
  for (const r of d.results) {
    if (!r || typeof r !== "object") return false;
    const row = r as Record<string, unknown>;
    if (typeof row.rawAnalyteName !== "string") return false;
    if (row.analyteId !== null && typeof row.analyteId !== "string") return false;
    if (row.resultValue !== null && typeof row.resultValue !== "number") return false;
    if (typeof row.isBelowLoq !== "boolean") return false;
    if (row.loqValue !== null && typeof row.loqValue !== "number") return false;
    if (typeof row.unitRaw !== "string") return false;
    if (typeof row.expressedOnDryBasis !== "boolean") return false;
  }
  if (!Array.isArray(d.testResults)) return false;
  if (!Array.isArray(d.unmatchedAnalytes)) return false;
  if (!d.unmatchedAnalytes.every(u => typeof u === "string")) return false;
  if (
    d.suggestedOriginProcess !== undefined &&
    d.suggestedOriginProcess !== null &&
    typeof d.suggestedOriginProcess !== "string"
  ) return false;

  return true;
}

// The single source of truth for "did pdf-parse actually find real report text, or just
// structural noise (page markers, whitespace, table skeleton)". Counts real word-like content
// (runs of 4+ Unicode letters) rather than stripping known noise patterns — this generalizes to
// any PDF's noise format, since regex-stripping specific patterns (e.g. "-- N of M --") breaks
// the moment a different report's PDF export produces differently-shaped noise (verified: a real
// second report used "1of15"-style markers with no dashes, which the old regex didn't catch).
export function hasUsableText(pdfText: string): boolean {
  const MIN_REAL_WORDS = 10;
  const words = pdfText.match(/[^\W\d_]{4,}/gu) ?? [];
  return words.length >= MIN_REAL_WORDS;
}

function buildSchemaInstructions(analyteRef: AnalyteReference[], sampleIdentifier: string | null): string {
  const knownAnalytes = analyteRef
    .map(a => `- ${a.analyteId}: ${[a.canonicalNameNo, a.canonicalNameIt, a.canonicalNameEn].filter(Boolean).join(" / ")}`)
    .join("\n");

  const originOptionsList = ORIGIN_OPTIONS.map(o => `- ${o.value} (${o.label})`).join("\n");

  const scopingInstruction = sampleIdentifier
    ? `\n\nThis document contains data for MULTIPLE distinct samples. Extract data for ONLY the sample identified as "${sampleIdentifier}", INCLUDING any of its own sub-tests (e.g. a leachate/eluate test of this same sample, even if that sub-test has its own separate lab-assigned ID) — but ignore data belonging to any OTHER independent sample described elsewhere in the document.`
    : "";

  return `You are extracting structured waste characterization data from a lab report (Italian or Norwegian format). This report may span many pages and contain many dozens or hundreds of individual analyte/substance result rows across those pages. You MUST extract EVERY result row found anywhere in the document, across ALL pages — do not summarize, sample a subset, or stop early. If the document is long, keep reading and extracting until you have covered every page and every result row it contains.
Return ONLY a JSON object matching this exact shape, with no markdown fences and no commentary:

{
  "metadata": {
    "externalReportNo": string | null,
    "labName": string | null,
    "customerName": string | null,
    "sampleMarking": string | null,
    "matrixType": string | null,
    "samplingDate": string | null,
    "receiptDate": string | null,
    "producerName": string | null,
    "location": string | null,
    "physicalState": "solid" | "liquid" | "powder" | null,
    "viscosity40cMm2s": number | null,
    "ph": number | null,
    "labClassificationGiven": boolean,
    "labStatedEalCode": string | null
  },
  "results": [
    { "rawAnalyteName": string, "analyteId": string | null, "resultValue": number | null, "isBelowLoq": boolean, "loqValue": number | null, "unitRaw": string, "expressedOnDryBasis": boolean }
  ],

  "testResults": [
    { "testName": "flammability" | "skin_corrosion" | "skin_irritation", "result": string, "isPositive": boolean }
  ],
  "unmatchedAnalytes": [string],
  "suggestedOriginProcess": string | null
}${scopingInstruction}

For "location", extract the site/property address, name, or municipality where the waste was generated or where the sampling took place, if the document clearly states one (e.g. a project name, site address, or municipality mentioned in the report header or sampling details) — set it to null if the document does not clearly state a location; never guess or infer a location from unrelated context.

Do NOT populate an "originProcess" field — it is intentionally absent from this schema. It is never present in a lab report and must be supplied by the user, not guessed by you.

For "suggestedOriginProcess" (a DIFFERENT field from "originProcess" above), pick the single closest match from this real list of origin/process values, based on the report's stated matrix type, material description, or process context. Return the exact "value" string shown (not the label), or return null if none of these confidently matches — never invent a value not in this list, and never guess when you are uncertain:

${originOptionsList}

For each analyte/substance result row in the report, match it against this list of known analytes by name (any language) and set "analyteId" to the matching id. If a row's substance does not match any of these, set "analyteId": null and add its raw name to the top-level "unmatchedAnalytes" array instead — never guess a match, and never invent an analyteId not in this list:

${knownAnalytes}

"expressedOnDryBasis" should be true when the report indicates the value is on a dry-matter/dry-substance basis (Italian: look for "s.s." or "sostanza secca"; Norwegian: look for "TS" or "tørrstoff" in the unit or a footnote), and false otherwise.

For "testResults", look for free-text statements about flammability, skin corrosion (e.g. "non corrosivo"/"corrosivo", "not corrosive"/"corrosive"), or skin irritation (e.g. "non irritante"/"irritante", "not irritating"/"irritating") and report each one found, with "isPositive" true if the test indicates the hazard IS present, false if it indicates it is NOT present.`;
}

type MessageContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

// Shared text-vs-document branching decision, used by both the full extraction (Stage B) and
// the lightweight sample-detection call (Stage A) — the choice of "send text" vs "send the raw
// PDF as a native document" only depends on hasUsableText(pdfText), never on which stage is
// calling it.
function buildDocumentOrTextContent(
  instructions: string,
  pdfText: string,
  pdfBuffer: Buffer
): MessageContentBlock[] {
  if (hasUsableText(pdfText)) {
    return [{ type: "text", text: `${instructions}\n\nReport text:\n${pdfText}` }];
  }

  return [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdfBuffer.toString("base64") },
    },
    { type: "text", text: `${instructions}\n\nRead the attached PDF document directly — pdf-parse found no usable text in it, so it is likely scanned/image-only.` },
  ];
}

// Decides the extraction strategy: if pdf-parse found real text, send it as a text prompt
// (fast, cheap, unchanged from before). If not (a scanned/image-only PDF), send the raw PDF
// bytes as a native document content block instead — Claude reads it directly, no OCR
// pre-processing, no rendering, no native binary dependency.
export function buildMessageContent(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[],
  sampleIdentifier: string | null
): MessageContentBlock[] {
  return buildDocumentOrTextContent(buildSchemaInstructions(analyteRef, sampleIdentifier), pdfText, pdfBuffer);
}

export interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
  // Non-null when this entry is a sub-test (e.g. a leachate/eluate/extraction test) of another
  // sample already listed in this same array, identified by its own lab-assigned ID but not an
  // independently classifiable waste stream. Null means this is a top-level, independently
  // classifiable sample.
  parentSampleIdentifier: string | null;
}

export function validateListSamplesResponse(x: unknown): x is DetectedSample[] {
  if (!Array.isArray(x)) return false;
  for (const item of x) {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (typeof row.sampleIdentifier !== "string") return false;
    if (row.matrixType !== null && typeof row.matrixType !== "string") return false;
    if (row.parentSampleIdentifier !== null && typeof row.parentSampleIdentifier !== "string") return false;
  }
  return true;
}

function buildListSamplesInstructions(): string {
  return `You are analyzing a lab report document that may contain data for ONE or MULTIPLE distinct waste/environmental samples (some lab reports bundle several separate sample sub-reports into one document).

Return ONLY a JSON array (no markdown fences, no commentary) where each element represents one distinct sample found in this document:

[
  { "sampleIdentifier": string, "matrixType": string | null, "parentSampleIdentifier": string | null }
]

"sampleIdentifier" must be the sample's own report/sample number or marking exactly as printed in the document (e.g. a "Prøvenr." value, an "AR-..." report number, or a sample marking code) — something that uniquely distinguishes this sample from any others in the same document. If the document clearly describes only one sample, return an array with exactly one element. Never invent or guess a sample identifier — if you cannot find any clearly distinguishable sample identifiers in the document, return an empty array.

"parentSampleIdentifier" should be set to another sample's "sampleIdentifier" from this same array when THIS entry is a sub-test of that other sample rather than an independently classifiable waste stream — most commonly a leachate/eluate/extraction test (look for terms like "eluizione", "eluat", "leaching test", "UNI EN 12457", "leachate") that analyzes the SAME physical waste sample under a different lab procedure and often gets its own separate lab-assigned ID. If a sample is NOT a sub-test of another sample in this document (the normal case, including when the document describes only one sample), set "parentSampleIdentifier" to null.`;
}

export async function listSamples(pdfText: string, pdfBuffer: Buffer): Promise<DetectedSample[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = buildDocumentOrTextContent(buildListSamplesInstructions(), pdfText, pdfBuffer);

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: content as Anthropic.MessageParam["content"] }],
    });

    if (message.stop_reason === "max_tokens") {
      console.warn(
        "Stage A (listSamples) response was truncated (max_tokens), falling back to unscoped extraction"
      );
      return [];
    }

    const textBlock = message.content.find(block => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];

    const stripped = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const parsed: unknown = JSON.parse(stripped);

    const normalized = Array.isArray(parsed)
      ? parsed.map((item: unknown) => {
          if (!item || typeof item !== "object") return item;
          const row = item as Record<string, unknown>;
          return {
            ...row,
            matrixType: row.matrixType ?? null,
            parentSampleIdentifier: row.parentSampleIdentifier ?? null,
          };
        })
      : parsed;

    if (!validateListSamplesResponse(normalized)) {
      console.warn(
        "Stage A (listSamples) response failed validation, falling back to unscoped extraction:",
        JSON.stringify(parsed).slice(0, 500)
      );
      return [];
    }

    return normalized;
  } catch {
    // Stage A is a detection optimization, not a hard gate — any failure here (network error,
    // malformed response) falls back to the caller treating this as "0 samples detected", which
    // triggers the existing unscoped whole-document extraction, identical to today's behavior.
    return [];
  }
}

// Never trust a hallucinated origin suggestion — only accept it if it's actually one of the
// real, curated ORIGIN_OPTIONS values. Anything else (a made-up string, the field being absent,
// or an explicit null) becomes null. This is the same honest-gap discipline used throughout
// this extraction pipeline: an uncertain or invalid guess must surface as "no suggestion", not
// as a wrong one.
export function normalizeSuggestedOriginProcess(value: unknown): string | null {
  return typeof value === "string" && ORIGIN_OPTIONS.some(o => o.value === value) ? value : null;
}

// Thrown when Claude's extraction response hit stop_reason: "max_tokens" — the report's real
// content genuinely doesn't fit in the response length ceiling. Distinct from a generic Error
// so callers (extractSampleData's own retry loop, and the API routes) can tell this apart from
// an actual unreadability failure and from a transient/parse error worth retrying.
export class ExtractionTruncatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionTruncatedError";
  }
}

// Thrown when our own AbortController timeout fires before the streaming call finishes — a
// deliberate, honest failure distinct from Vercel's platform-level kill (which would produce no
// useful error at all), used because this app may run on Vercel Hobby, which hard-caps function
// duration at 300s with no override available.
export class ExtractionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionTimeoutError";
  }
}

const MAX_EXTRACTION_ATTEMPTS = 2;

async function extractSingleDocumentBatch(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[],
  sampleIdentifier: string | null
): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = buildMessageContent(pdfText, pdfBuffer, analyteRef, sampleIdentifier);

  // Comfortable margin under Vercel Hobby's hard, non-configurable 300s function-duration cap —
  // this app's real/planned deployment plan. This budget applies per document-batch (see
  // extractSampleData, which splits a large scanned document into page batches so each one
  // individually stays well within this budget, rather than needing a document-size-proportional
  // timeout), and is shared across that batch's own retry attempts (see the deadline computed
  // once below, before the retry loop) — this timeout fires before Vercel's own platform-level
  // kill would, so the failure is an honest, explained one instead of a silent kill.
  const EXTRACTION_TIMEOUT_MS = 270_000;

  // Computed ONCE, before the retry loop: both attempts together share a single 270s
  // wall-clock budget, rather than each attempt getting its own full 270s allowance (which
  // could produce a worst-case ~540s across two attempts — silently killed by Vercel's 300s
  // function timeout, exactly the silent failure this whole fix exists to prevent).
  const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new ExtractionTimeoutError(
        "Extraction did not finish within the available processing time — the report may be too large or detailed to process in a single pass."
      );
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), remainingMs);

    try {
      let message: Anthropic.Message;
      try {
        const stream = client.messages.stream(
          {
            model: "claude-haiku-4-5",
            max_tokens: 64000,
            messages: [{ role: "user", content: content as Anthropic.MessageParam["content"] }],
          },
          { signal: abortController.signal }
        );
        message = await stream.finalMessage();
      } catch (streamErr) {
        if (streamErr instanceof APIUserAbortError || abortController.signal.aborted) {
          throw new ExtractionTimeoutError(
            "Extraction did not finish within the available processing time — the report may be too large or detailed to process in a single pass."
          );
        }
        throw streamErr;
      }

      if (message.stop_reason === "max_tokens") {
        throw new ExtractionTruncatedError(
          "Claude's extraction response was truncated (exceeded the response length limit) — the report may be too large or complex for a single extraction pass"
        );
      }

      const textBlock = message.content.find(block => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude returned no text content for extraction");
      }

      const stripped = textBlock.text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        throw new Error("Claude's extraction response was not valid JSON");
      }

      if (!validateExtractionResponse(parsed)) {
        throw new Error("Claude's extraction response was missing required fields");
      }

      // Never trust Claude's raw suggestedOriginProcess string — only a real, curated
      // ORIGIN_OPTIONS value survives; anything else (including an absent field) becomes null.
      const normalizedSuggestedOrigin = normalizeSuggestedOriginProcess(parsed.suggestedOriginProcess);

      // The LLM extraction schema never asks for resultId (it's an internal identity concern,
      // not something the report itself states) — assign stable, deterministic IDs here so every
      // downstream consumer (classification, review UI) has one, exactly as the SampleResult type
      // requires and as the hand-built test fixtures already do.
      const resultsWithIds = parsed.results.map((row, i) => ({ ...row, resultId: `r${i + 1}` }));

      return {
        ...parsed,
        results: resultsWithIds,
        suggestedOriginProcess: normalizedSuggestedOrigin,
        sourceType: hasUsableText(pdfText) ? "text" : "document",
      };
    } catch (err) {
      lastError = err;
      // Truncation and timeout are both deterministic failures for the same input — retrying
      // with identical parameters would just reproduce the same multi-minute failure. Fail fast
      // rather than burning the retry budget on a guaranteed-identical re-failure.
      if (err instanceof ExtractionTruncatedError || err instanceof ExtractionTimeoutError) {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Extraction failed");
}

// Routes to a single extraction call for a short document or one with real extractable text
// (unchanged behavior), or splits a large scanned document into page batches run concurrently
// and merges their results — see lib/hp-classification/pdf-batching.ts for why: a single fixed
// time budget cannot scale to an arbitrarily large scanned document, but several small,
// concurrently-run batches each comfortably fit within the SAME existing budget regardless of
// how many batches that turns into.
export async function extractSampleData(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[],
  sampleIdentifier: string | null
): Promise<ExtractionResult> {
  if (!hasUsableText(pdfText)) {
    // The page-count probe (via pdf-lib's PDFDocument.load) can throw for PDFs the existing
    // pdf-parse-based pipeline tolerates just fine today — owner-password-encrypted PDFs
    // (EncryptedPDFError) or structurally malformed ones. A small (e.g. 3-page) document that
    // never needed batching in the first place must not hard-fail purely because this probe
    // couldn't run — fall through to the original single-call path exactly as before this
    // feature existed, on ANY failure here.
    let preloadedDoc: PDFDocument | undefined;
    let pageCount: number | undefined;
    try {
      preloadedDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      pageCount = await getPdfPageCount(pdfBuffer, preloadedDoc);
    } catch (err) {
      console.error(
        "extractSampleData: getPdfPageCount failed, falling back to single-call extraction:",
        err
      );
    }

    if (pageCount !== undefined && shouldBatchDocument(pageCount)) {
      const ranges = computeBatchPageRanges(pageCount);
      const batchBuffers = await splitPdfIntoBatches(pdfBuffer, ranges, preloadedDoc);
      const settled = await Promise.allSettled(
        batchBuffers.map(buf => extractSingleDocumentBatch("", buf, analyteRef, sampleIdentifier))
      );
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (rejected.length > 0) {
        // Diagnostic-only: a batch failure that still leaves other batches succeeding produces a
        // result that LOOKS complete with nothing in the logs to explain the gap. Log each
        // rejection with the page range it covered so a partial result is diagnosable, not silent.
        rejected.forEach(r => {
          const idx = settled.indexOf(r);
          const range = ranges[idx];
          console.error(
            `extractSampleData: batch failed for pages ${range?.startPage}-${range?.endPage}:`,
            r.reason
          );
        });
      }
      const fragments = settled
        .filter((r): r is PromiseFulfilledResult<ExtractionResult> => r.status === "fulfilled")
        .map(r => r.value);
      if (fragments.length === 0) {
        const firstRejected = rejected[0];
        throw firstRejected ? firstRejected.reason : new Error("All extraction batches failed");
      }
      return mergeExtractionResults(fragments);
    }
  }
  return extractSingleDocumentBatch(pdfText, pdfBuffer, analyteRef, sampleIdentifier);
}
