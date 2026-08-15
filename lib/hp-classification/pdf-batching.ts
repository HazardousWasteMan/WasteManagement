import type { ExtractionResult } from "./extract";
import type { SampleMetadata, SampleResult } from "./types";
import type { TestResult } from "./hazard";
import { PDFDocument } from "pdf-lib";

// Structural, page-count-driven only — never tuned to any specific report's file size or
// content. A document at or below this many pages is processed exactly as it always has been
// (a single call); anything larger is split into overlapping batches of BATCH_SIZE pages each,
// so wall-clock cost per call stays bounded regardless of how large the source document is.
export const BATCH_PAGE_THRESHOLD = 15;
export const BATCH_SIZE = 15;
export const BATCH_OVERLAP = 1;

export function shouldBatchDocument(pageCount: number): boolean {
  return pageCount > BATCH_PAGE_THRESHOLD;
}

export interface PageRange {
  startPage: number; // 1-indexed, inclusive
  endPage: number; // 1-indexed, inclusive
}

// Splits a page count into BATCH_SIZE-page ranges, each overlapping the previous by
// BATCH_OVERLAP page(s) — a table row that spans a page break has a real chance of appearing
// whole in at least one batch instead of being silently split across two. When the document
// doesn't need batching at all, returns a single range covering every page.
export function computeBatchPageRanges(pageCount: number): PageRange[] {
  if (!shouldBatchDocument(pageCount)) {
    return [{ startPage: 1, endPage: pageCount }];
  }
  const ranges: PageRange[] = [];
  let start = 1;
  while (start <= pageCount) {
    const end = Math.min(start + BATCH_SIZE - 1, pageCount);
    ranges.push({ startPage: start, endPage: end });
    if (end >= pageCount) break;
    start = end - BATCH_OVERLAP + 1;
  }
  return ranges;
}

function mergeMetadata(fragments: ExtractionResult[]): Partial<SampleMetadata> {
  const merged: Record<string, unknown> = {};
  for (const f of fragments) {
    for (const [key, value] of Object.entries(f.metadata)) {
      if (value !== null && value !== undefined && !(key in merged)) {
        merged[key] = value;
      }
    }
  }

  // labClassificationGiven is a special case: a lab's classification statement often appears
  // near the END of a report, so "first fragment wins" could let an earlier batch's false
  // permanently shadow a later batch's real true. Instead: true if ANY fragment says true, else
  // fall back to the normal first-non-null-wins value already computed above.
  if (fragments.some(f => f.metadata.labClassificationGiven === true)) {
    merged.labClassificationGiven = true;
  }

  return merged as Partial<SampleMetadata>;
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Combines several batches' extraction results (from splitting one large scanned document) into
// one. Per-batch resultIds are reassigned sequentially afterward, since each batch numbers its
// own rows independently starting at "r1" and would otherwise collide once merged.
export function mergeExtractionResults(fragments: ExtractionResult[]): ExtractionResult {
  if (fragments.length === 0) {
    throw new Error("mergeExtractionResults requires at least one fragment");
  }

  const allResults = fragments.flatMap(f => f.results);
  // Includes expressedOnDryBasis and isBelowLoq in the key: the same substance can legitimately
  // be reported twice with identical name/value/unit — once as-received, once on a dry-substance
  // basis (common in Italian lab reports) — and those are two real, distinct results, not
  // duplicates. Only rows identical across ALL of these fields (the real 1-page-overlap
  // duplicate case) get merged.
  const dedupedResults = dedupeBy(
    allResults,
    r => `${r.rawAnalyteName}::${r.resultValue}::${r.unitRaw}::${r.expressedOnDryBasis}::${r.isBelowLoq}`
  );
  const results: Omit<SampleResult, "sampleId" | "method">[] = dedupedResults.map((r, i) => ({
    ...r,
    resultId: `r${i + 1}`,
  }));

  const allTestResults = fragments.flatMap(f => f.testResults);
  const testResults: TestResult[] = dedupeBy(allTestResults, t => `${t.testName}::${t.result}`);

  const allUnmatched = fragments.flatMap(f => f.unmatchedAnalytes);
  const unmatchedAnalytes = dedupeBy(allUnmatched, name => name);

  const suggestedOriginProcess = fragments.find(f => f.suggestedOriginProcess !== null)?.suggestedOriginProcess ?? null;

  return {
    metadata: mergeMetadata(fragments),
    results,
    testResults,
    unmatchedAnalytes,
    suggestedOriginProcess,
    sourceType: "document",
  };
}

// ignoreEncryption: true so an owner-password-restricted-but-readable PDF (common for scanned
// reports exported by some lab software) doesn't throw EncryptedPDFError purely from this
// page-count probe — pdf-lib's default (ignoreEncryption: false) would otherwise hard-fail a
// document the pre-batching pdf-parse pipeline tolerated just fine.
export async function getPdfPageCount(pdfBuffer: Buffer, preloadedDoc?: PDFDocument): Promise<number> {
  const doc = preloadedDoc ?? (await PDFDocument.load(pdfBuffer, { ignoreEncryption: true }));
  return doc.getPageCount();
}

// Produces one real, independently-valid PDF per range — Claude's document content block
// requires genuine PDF bytes, not an arbitrary slice of the original file.
// Accepts an optional preloadedDoc so a caller that already parsed the buffer (e.g.
// extractSampleData, which needs the page count first) can avoid a second full parse of a
// potentially large, image-heavy PDF. Both parameters remain independently callable with just
// pdfBuffer, matching this function's existing standalone-testable calling convention.
export async function splitPdfIntoBatches(
  pdfBuffer: Buffer,
  ranges: PageRange[],
  preloadedDoc?: PDFDocument
): Promise<Buffer[]> {
  const sourceDoc = preloadedDoc ?? (await PDFDocument.load(pdfBuffer, { ignoreEncryption: true }));
  const batches: Buffer[] = [];
  for (const range of ranges) {
    const newDoc = await PDFDocument.create();
    const pageIndices: number[] = [];
    for (let p = range.startPage; p <= range.endPage; p++) {
      pageIndices.push(p - 1); // pdf-lib is 0-indexed; PageRange is 1-indexed
    }
    const copiedPages = await newDoc.copyPages(sourceDoc, pageIndices);
    for (const page of copiedPages) newDoc.addPage(page);
    batches.push(Buffer.from(await newDoc.save()));
  }
  return batches;
}
