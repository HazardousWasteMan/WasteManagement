import { describe, it, expect } from "vitest";
import {
  shouldBatchDocument,
  computeBatchPageRanges,
  mergeExtractionResults,
  BATCH_PAGE_THRESHOLD,
  getPdfPageCount,
  splitPdfIntoBatches,
} from "@/lib/hp-classification/pdf-batching";
import type { ExtractionResult } from "@/lib/hp-classification/extract";
import { PDFDocument } from "pdf-lib";

describe("shouldBatchDocument", () => {
  it("does not batch at exactly the threshold", () => {
    expect(shouldBatchDocument(BATCH_PAGE_THRESHOLD)).toBe(false);
  });

  it("batches one page over the threshold", () => {
    expect(shouldBatchDocument(BATCH_PAGE_THRESHOLD + 1)).toBe(true);
  });

  it("does not batch a short document", () => {
    expect(shouldBatchDocument(3)).toBe(false);
  });
});

describe("computeBatchPageRanges", () => {
  it("produces exactly 3 overlapping ranges for a 31-page document", () => {
    const ranges = computeBatchPageRanges(31);
    expect(ranges).toEqual([
      { startPage: 1, endPage: 15 },
      { startPage: 15, endPage: 29 },
      { startPage: 29, endPage: 31 },
    ]);
  });

  it("covers every real page at least once, with 1-page overlaps between consecutive ranges", () => {
    const ranges = computeBatchPageRanges(31);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].startPage).toBe(ranges[i - 1].endPage);
    }
    expect(ranges[0].startPage).toBe(1);
    expect(ranges[ranges.length - 1].endPage).toBe(31);
  });

  it("produces a single range covering the whole document when not batching", () => {
    expect(computeBatchPageRanges(10)).toEqual([{ startPage: 1, endPage: 10 }]);
  });
});

describe("mergeExtractionResults", () => {
  const baseResult = (overrides: Partial<ExtractionResult>): ExtractionResult => ({
    metadata: {},
    results: [],
    testResults: [],
    unmatchedAnalytes: [],
    suggestedOriginProcess: null,
    sourceType: "document",
    ...overrides,
  });

  it("concatenates and de-duplicates identical result rows from overlapping batches", () => {
    const fragmentA = baseResult({
      results: [
        { resultId: "r1", rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
      ],
    });
    const fragmentB = baseResult({
      results: [
        // Same row, re-reported due to the 1-page overlap — must be deduplicated.
        { resultId: "r1", rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
        { resultId: "r2", rawAnalyteName: "piombo", analyteId: "lead", resultValue: 12.3, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
      ],
    });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.results).toHaveLength(2);
    expect(merged.results.map(r => r.rawAnalyteName).sort()).toEqual(["arsenico", "piombo"]);
  });

  it("assigns fresh sequential resultIds after merging, since per-batch ids can collide", () => {
    const fragmentA = baseResult({
      results: [{ resultId: "r1", rawAnalyteName: "a", analyteId: null, resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }],
    });
    const fragmentB = baseResult({
      // Same resultId "r1" as fragmentA, because each batch numbers its own rows independently.
      results: [{ resultId: "r1", rawAnalyteName: "b", analyteId: null, resultValue: 2, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }],
    });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.results.map(r => r.resultId)).toEqual(["r1", "r2"]);
  });

  it("merges metadata field-by-field, first non-null value wins", () => {
    const fragmentA = baseResult({ metadata: { customerName: "Real Customer AS", labName: undefined } });
    const fragmentB = baseResult({ metadata: { customerName: undefined, labName: "Eurofins" } });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.metadata.customerName).toBe("Real Customer AS");
    expect(merged.metadata.labName).toBe("Eurofins");
  });

  it("de-duplicates testResults and unmatchedAnalytes the same way", () => {
    const fragmentA = baseResult({
      testResults: [{ testName: "flammability", result: "non infiammabile", isPositive: false }],
      unmatchedAnalytes: ["sostanza sconosciuta"],
    });
    const fragmentB = baseResult({
      testResults: [{ testName: "flammability", result: "non infiammabile", isPositive: false }],
      unmatchedAnalytes: ["sostanza sconosciuta", "un'altra sostanza"],
    });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.testResults).toHaveLength(1);
    expect(merged.unmatchedAnalytes).toEqual(["sostanza sconosciuta", "un'altra sostanza"]);
  });

  it("tolerates an empty fragment (a batch with no data for a sample-scoped extraction)", () => {
    const fragmentA = baseResult({
      results: [{ resultId: "r1", rawAnalyteName: "a", analyteId: null, resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }],
    });
    const emptyFragment = baseResult({});
    const merged = mergeExtractionResults([fragmentA, emptyFragment]);
    expect(merged.results).toHaveLength(1);
  });

  it("picks the first non-null suggestedOriginProcess across fragments", () => {
    const fragmentA = baseResult({ suggestedOriginProcess: null });
    const fragmentB = baseResult({ suggestedOriginProcess: "hydraulic oil waste" });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.suggestedOriginProcess).toBe("hydraulic oil waste");
  });

  it("always sets sourceType to document, regardless of fragment content", () => {
    const merged = mergeExtractionResults([baseResult({})]);
    expect(merged.sourceType).toBe("document");
  });

  it("throws for an empty fragment list", () => {
    expect(() => mergeExtractionResults([])).toThrow();
  });

  it("keeps as-received and dry-basis rows of the same substance/value/unit as two distinct results", () => {
    const fragment = baseResult({
      results: [
        { resultId: "r1", rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: false },
        { resultId: "r2", rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
      ],
    });
    const merged = mergeExtractionResults([fragment]);
    expect(merged.results).toHaveLength(2);
  });

  it("still dedupes a true 1-page-overlap duplicate (identical across all key fields)", () => {
    const fragmentA = baseResult({
      results: [
        { resultId: "r1", rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
      ],
    });
    const fragmentB = baseResult({
      results: [
        { resultId: "r1", rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
      ],
    });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.results).toHaveLength(1);
  });

  it("labClassificationGiven: a later fragment's true is not shadowed by an earlier fragment's false", () => {
    const fragmentA = baseResult({ metadata: { labClassificationGiven: false } });
    const fragmentB = baseResult({ metadata: { labClassificationGiven: true } });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.metadata.labClassificationGiven).toBe(true);
  });

  it("labClassificationGiven: falls back to first-non-null-wins when no fragment says true", () => {
    const fragmentA = baseResult({ metadata: { labClassificationGiven: false } });
    const fragmentB = baseResult({ metadata: {} });
    const merged = mergeExtractionResults([fragmentA, fragmentB]);
    expect(merged.metadata.labClassificationGiven).toBe(false);
  });
});

describe("getPdfPageCount and splitPdfIntoBatches (real pdf-lib documents)", () => {
  async function buildRealPdf(pageCount: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      doc.addPage([200, 200]);
    }
    return Buffer.from(await doc.save());
  }

  it("reports the real page count of a genuine multi-page PDF", async () => {
    const pdf = await buildRealPdf(7);
    expect(await getPdfPageCount(pdf)).toBe(7);
  });

  it("splits a real PDF into independently valid, correctly-sized sub-PDFs", async () => {
    const pdf = await buildRealPdf(20);
    const ranges = [
      { startPage: 1, endPage: 10 },
      { startPage: 10, endPage: 20 },
    ];
    const batches = await splitPdfIntoBatches(pdf, ranges);
    expect(batches).toHaveLength(2);

    // Each batch must be a genuinely independent, openable PDF — not just a byte slice.
    const firstBatchDoc = await PDFDocument.load(batches[0]);
    expect(firstBatchDoc.getPageCount()).toBe(10);
    const secondBatchDoc = await PDFDocument.load(batches[1]);
    expect(secondBatchDoc.getPageCount()).toBe(11);
  });

  it("a single-range split (no batching) returns one buffer covering the whole document", async () => {
    const pdf = await buildRealPdf(5);
    const batches = await splitPdfIntoBatches(pdf, [{ startPage: 1, endPage: 5 }]);
    expect(batches).toHaveLength(1);
    const doc = await PDFDocument.load(batches[0]);
    expect(doc.getPageCount()).toBe(5);
  });
});
