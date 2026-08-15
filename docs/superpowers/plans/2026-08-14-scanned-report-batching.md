# Scanned Report Page-Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let large scanned (no-extractable-text) lab report PDFs be processed successfully, regardless of page count, by splitting them into page batches that run concurrently instead of one document exceeding a single fixed time budget.

**Architecture:** A new module, `lib/hp-classification/pdf-batching.ts`, holds all the new logic: pure page-range/merge math (no dependencies), and `pdf-lib`-backed page-count/splitting functions. `extractSampleData` in `lib/hp-classification/extract.ts` is refactored so its existing single-document extraction logic becomes a reusable private helper, and the exported function becomes a router: unchanged single-call behavior for short/text documents, batched-and-merged behavior for large scanned ones.

**Tech Stack:** TypeScript, `pdf-lib` (new dependency), Vitest, existing `@anthropic-ai/sdk` mocking pattern.

## Global Constraints

- Batching triggers ONLY for the existing "document" (no-usable-text) extraction path, and only when the real PDF page count exceeds 15 — the text-based path and any scanned document of 15 pages or fewer are completely unaffected.
- Batch size is 15 pages with a 1-page overlap between consecutive batches — page-count-driven only, never tuned to any specific report's file size or content.
- A single batch's own failure (after its own existing retries are exhausted) must not fail the whole extraction if at least one other batch succeeded — merge proceeds with whatever did come back.
- No change to `EXTRACTION_TIMEOUT_MS`, `MAX_EXTRACTION_ATTEMPTS`, or the retry/timeout logic itself — those already work correctly for one batch-sized document.
- `listSamples`'s similar-but-separate scaling risk is explicitly out of scope for this plan.

---

### Task 1: Pure batching decision and merge logic

**Files:**
- Create: `lib/hp-classification/pdf-batching.ts`
- Test: `tests/hp-classification/pdf-batching.test.ts`

**Interfaces:**
- Produces: `export const BATCH_PAGE_THRESHOLD = 15`, `export const BATCH_SIZE = 15`, `export const BATCH_OVERLAP = 1`, `export interface PageRange { startPage: number; endPage: number; }` (1-indexed, inclusive), `export function shouldBatchDocument(pageCount: number): boolean`, `export function computeBatchPageRanges(pageCount: number): PageRange[]`, `export function mergeExtractionResults(fragments: ExtractionResult[]): ExtractionResult` — Task 3 imports all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/hp-classification/pdf-batching.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  shouldBatchDocument,
  computeBatchPageRanges,
  mergeExtractionResults,
  BATCH_PAGE_THRESHOLD,
} from "@/lib/hp-classification/pdf-batching";
import type { ExtractionResult } from "@/lib/hp-classification/extract";

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
    const fragmentA = baseResult({ metadata: { customerName: "Real Customer AS", labName: null } });
    const fragmentB = baseResult({ metadata: { customerName: null, labName: "Eurofins" } });
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/pdf-batching.test.ts`
Expected: FAIL — `lib/hp-classification/pdf-batching.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/hp-classification/pdf-batching.ts`**

```ts
import type { ExtractionResult } from "./extract";
import type { SampleMetadata, SampleResult } from "./types";
import type { TestResult } from "./hazard";

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
  const dedupedResults = dedupeBy(allResults, r => `${r.rawAnalyteName}::${r.resultValue}::${r.unitRaw}`);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/pdf-batching.test.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/hp-classification/pdf-batching.ts tests/hp-classification/pdf-batching.test.ts
git commit -m "feat: add pure page-batching decision and extraction-result merge logic"
```

---

### Task 2: Real PDF page-count and splitting via `pdf-lib`

**Files:**
- Modify: `package.json` (add `pdf-lib` dependency)
- Modify: `lib/hp-classification/pdf-batching.ts`
- Test: `tests/hp-classification/pdf-batching.test.ts`

**Interfaces:**
- Consumes: `PageRange` (Task 1).
- Produces: `export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number>`, `export async function splitPdfIntoBatches(pdfBuffer: Buffer, ranges: PageRange[]): Promise<Buffer[]>` — Task 3 calls both.

- [ ] **Step 1: Install `pdf-lib`**

```bash
npm install pdf-lib
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/hp-classification/pdf-batching.test.ts`, after the existing imports:

```ts
import { PDFDocument } from "pdf-lib";
import { getPdfPageCount, splitPdfIntoBatches } from "@/lib/hp-classification/pdf-batching";
```

Add a new `describe` block at the end of the file:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/pdf-batching.test.ts`
Expected: FAIL — `getPdfPageCount`/`splitPdfIntoBatches` aren't exported yet.

- [ ] **Step 4: Add the two functions to `lib/hp-classification/pdf-batching.ts`**

Add this import at the top of the file, alongside the existing ones:

```ts
import { PDFDocument } from "pdf-lib";
```

Add these two functions at the end of the file:

```ts
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}

// Produces one real, independently-valid PDF per range — Claude's document content block
// requires genuine PDF bytes, not an arbitrary slice of the original file.
export async function splitPdfIntoBatches(pdfBuffer: Buffer, ranges: PageRange[]): Promise<Buffer[]> {
  const sourceDoc = await PDFDocument.load(pdfBuffer);
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/pdf-batching.test.ts`
Expected: PASS — all tests pass, including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/hp-classification/pdf-batching.ts tests/hp-classification/pdf-batching.test.ts
git commit -m "feat: add real pdf-lib-backed page count and PDF splitting"
```

---

### Task 3: Wire batching into `extractSampleData`

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- Consumes: `shouldBatchDocument`, `computeBatchPageRanges`, `getPdfPageCount`, `splitPdfIntoBatches`, `mergeExtractionResults` from `lib/hp-classification/pdf-batching.ts` (Tasks 1-2).

- [ ] **Step 1: Refactor `extractSampleData`'s current body into a private helper**

In `lib/hp-classification/extract.ts`, the current `extractSampleData` function (shown below, exactly as it exists today) becomes a renamed, non-exported helper, `extractSingleDocumentBatch` — identical logic, only the function name changes:

```ts
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
  // timeout).
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
```

- [ ] **Step 2: Add the import and the new `extractSampleData` router**

Add this import near the top of `lib/hp-classification/extract.ts`, alongside the existing imports:

```ts
import { shouldBatchDocument, computeBatchPageRanges, getPdfPageCount, splitPdfIntoBatches, mergeExtractionResults } from "./pdf-batching";
```

Add this new exported function, replacing the old exported `extractSampleData` (which Step 1 already renamed to `extractSingleDocumentBatch`):

```ts
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
    const pageCount = await getPdfPageCount(pdfBuffer);
    if (shouldBatchDocument(pageCount)) {
      const ranges = computeBatchPageRanges(pageCount);
      const batchBuffers = await splitPdfIntoBatches(pdfBuffer, ranges);
      const settled = await Promise.allSettled(
        batchBuffers.map(buf => extractSingleDocumentBatch("", buf, analyteRef, sampleIdentifier))
      );
      const fragments = settled
        .filter((r): r is PromiseFulfilledResult<ExtractionResult> => r.status === "fulfilled")
        .map(r => r.value);
      if (fragments.length === 0) {
        const firstRejected = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
        throw firstRejected ? firstRejected.reason : new Error("All extraction batches failed");
      }
      return mergeExtractionResults(fragments);
    }
  }
  return extractSingleDocumentBatch(pdfText, pdfBuffer, analyteRef, sampleIdentifier);
}
```

- [ ] **Step 3: Write the failing tests**

Add to `tests/hp-classification/extract.test.ts`, a new `describe` block at the end of the file. This uses the same `mockStream`/`PDFDocument` real-buffer pattern already established in `pdf-batching.test.ts` — add the import at the top of this file alongside the existing ones:

```ts
import { PDFDocument } from "pdf-lib";
```

```ts
describe("extractSampleData — page batching for large scanned documents", () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  async function buildRealPdf(pageCount: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
    return Buffer.from(await doc.save());
  }

  function mockSuccessResponse(rawAnalyteName: string) {
    return {
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                metadata: {},
                results: [
                  { rawAnalyteName, analyteId: null, resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
                ],
                testResults: [],
                unmatchedAnalytes: [],
                suggestedOriginProcess: null,
              }),
            },
          ],
        }),
    };
  }

  it("does not batch a scanned document at or below the page threshold — single call", async () => {
    const pdf = await buildRealPdf(10);
    mockStream.mockReturnValue(mockSuccessResponse("substance-a"));

    const result = await extractSampleData("", pdf, [], null);

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
  });

  it("never batches when real extractable text exists, regardless of the buffer's real page count", async () => {
    const pdf = await buildRealPdf(31); // well over the batching threshold
    const realWordsText = "some real report text with enough real words in it to count as usable, definitely";
    mockStream.mockReturnValue(mockSuccessResponse("substance-a"));

    await extractSampleData(realWordsText, pdf, [], null);

    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("splits a 31-page scanned document into 3 batches, runs them concurrently, and merges the results", async () => {
    const pdf = await buildRealPdf(31);
    mockStream
      .mockReturnValueOnce(mockSuccessResponse("substance-a"))
      .mockReturnValueOnce(mockSuccessResponse("substance-b"))
      .mockReturnValueOnce(mockSuccessResponse("substance-c"));

    const result = await extractSampleData("", pdf, [], null);

    expect(mockStream).toHaveBeenCalledTimes(3);
    expect(result.results.map(r => r.rawAnalyteName).sort()).toEqual(["substance-a", "substance-b", "substance-c"]);
    // Merged results get fresh sequential ids, not each batch's own colliding "r1".
    expect(result.results.map(r => r.resultId)).toEqual(["r1", "r2", "r3"]);
    expect(result.sourceType).toBe("document");
  });

  it("returns a partial merged result when one batch fails but others succeed", async () => {
    const pdf = await buildRealPdf(31);
    mockStream
      .mockReturnValueOnce(mockSuccessResponse("substance-a"))
      .mockImplementationOnce(() => {
        throw new Error("simulated batch failure");
      })
      .mockReturnValueOnce(mockSuccessResponse("substance-c"));

    const result = await extractSampleData("", pdf, [], null);

    expect(result.results.map(r => r.rawAnalyteName).sort()).toEqual(["substance-a", "substance-c"]);
  });

  it("rejects when every batch fails", async () => {
    const pdf = await buildRealPdf(31);
    mockStream.mockImplementation(() => {
      throw new Error("simulated total failure");
    });

    await expect(extractSampleData("", pdf, [], null)).rejects.toThrow("simulated total failure");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL — `extractSampleData` doesn't batch yet (all new tests except possibly the
no-batching ones fail; the "never batches with real text" and "does not batch below threshold"
tests may already pass by coincidence since the pre-Step-2 code never batches at all — that's
fine, the important failures are the 31-page multi-batch tests).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS — all tests in the file pass, including every pre-existing test (confirming the
refactor didn't change single-document behavior) and all 5 new ones.

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: batch large scanned reports into concurrent page-range extraction calls"
```
