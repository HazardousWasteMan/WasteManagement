# Scanned Report Page-Batching — Design Spec

## Problem

`lib/hp-classification/extract.ts`'s `extractSampleData` sends a scanned/image-only PDF (no
usable extractable text — `hasUsableText(pdfText)` false) to Claude as a single native `document`
content block covering every page. This is a genuinely slow vision workload that scales with page
count, and the function has one deliberate wall-clock budget (`EXTRACTION_TIMEOUT_MS = 270_000`,
chosen to stay under Vercel Hobby's hard, non-configurable 300s function-duration cap) shared
across the whole call.

That budget was calibrated against a real 41-page scanned report that measured 284.3s — already
*over* the 270s ceiling that measurement produced. The fix at the time converted what would have
been a silent platform-level kill into an honest, explained `ExtractionTimeoutError`, but did not
change the fact that any sufficiently large scanned report — this one included — will always
exceed a single fixed budget, no matter what that budget's exact value is. A user has now hit
this in practice on a real 41-page, 12.2MB, zero-extractable-text lab report.

Scanned/faxed lab reports are a realistic, recurring case in this domain (older labs, third-party
subcontractor reports, mobile-scanned field paperwork) — this is not a one-off edge case to work
around, it's a document shape the system needs to genuinely handle.

## Fix: page-batched, parallel extraction — general, not report-specific

The core problem is that wall-clock cost scales with page count but the system only had one
fixed-size budget to spend it in. The fix removes that coupling: split a large scanned document
into several smaller documents (each cheap enough to comfortably finish within the SAME existing
per-call budget), and extract them concurrently rather than serially, so total wall-clock time
depends on the LARGEST batch, not the sum of all pages.

Crucially, none of the numbers involved are tuned to any specific report's content or file size —
only to page count, a structural property every PDF has:

- **Trigger:** only for the existing "document" (scanned/no-usable-text) path, and only when the
  PDF's real page count (via `pdf-lib`'s `PDFDocument.load(buffer).getPageCount()`) exceeds 15.
  Below that threshold, or whenever real extractable text exists, behavior is completely
  unchanged — this is strictly additive for large scanned documents, not a rewrite of the
  existing fast paths.
- **Splitting:** batches of 15 pages, with a 1-page overlap between consecutive batches (batch 2
  starts on batch 1's last page), built with `pdf-lib` into real, independently-valid sub-PDF
  byte buffers — Claude's document content block requires genuine PDF bytes, not an arbitrary
  slice of the original file's bytes. A 41-page document becomes 3 batches (pages 1-16, 16-31,
  31-41); a 100-page document becomes ~7; there is no upper bound on how many batches a
  sufficiently large document produces — batching is what removes the total-size ceiling
  entirely, not a workaround for one particular size.
- **Execution:** all batches run concurrently (`Promise.all`), each independently reusing the
  EXISTING per-call `EXTRACTION_TIMEOUT_MS`/retry logic unchanged — a batch's cost is bounded by
  its own 15-16 pages, not the document's total page count, so the existing budget that already
  comfortably handles a short scanned document now also comfortably handles each batch of a long
  one.
- **Merging** (after all batches settle):
  - `results` / `testResults` / `unmatchedAnalytes`: concatenated, then de-duplicated (exact
    match on the fields that identify a row — `rawAnalyteName`+`resultValue`+`unitRaw` for
    results, `testName`+`result` for test results, exact string for unmatched analytes) to
    collapse rows the 1-page overlap causes two adjacent batches to both report.
  - `metadata`: merged field-by-field, first non-null value found across batches (in page order)
    wins — real report metadata (customer, lab, sample marking, etc.) typically appears once,
    near the start of the document.
  - `sourceType`: always `"document"` (batching only ever triggers on this path).
  - A single batch's own failure (its retries exhausted, still times out or errors) does not fail
    the whole extraction — the merge proceeds with whatever batches did succeed. A partial result
    is more useful than none, and this codebase's existing "unmatched substances are flagged, not
    silently dropped" discipline already gives the user visibility into what's missing, rather
    than presenting a partial result as if it were complete.

## Non-goals

- `listSamples` (the separate, lighter "Stage A" multi-sample-detection call) has no timeout
  guard at all today and could in principle have a similar scaling problem for a very large
  scanned document — this is a real, related gap, but out of scope here: the user's actual
  failure was specifically `extractSampleData`'s timeout, and `listSamples`'s prompt/response
  shape (a short list of detected samples, not full structured extraction) is different enough
  that it deserves its own look rather than being folded into this fix.
- No change to the text-based extraction path, which is already fast regardless of document
  length and untouched by this fix.
- No change to the per-batch retry/timeout constants themselves (`EXTRACTION_TIMEOUT_MS`,
  `MAX_EXTRACTION_ATTEMPTS`) — those already work correctly for a single batch-sized document;
  this fix's job is ensuring large scanned documents get split into batch-sized pieces, not
  re-tuning how a single piece is processed.
- No explicit concurrency limiter on the number of simultaneous batch calls — at this app's real
  scale (a handful of pages-per-batch, rarely more than a few batches per document), this isn't
  expected to hit API rate limits in practice; if it ever does, that's a real, separate follow-up
  once actually observed, not a speculative constraint to build in now.

## Testing

- Real, deterministic tests for the pure logic: given a fake page count and a 15-page threshold,
  does the batching decision (batch vs. no batch) come out right at the boundary (15 pages exactly
  → no batch; 16 → batch)? Given a page count, does batch-range computation (with 1-page overlap)
  produce the right set of `[start, end]` ranges?
- Real, deterministic tests for the merge logic in isolation: given several fake `ExtractionResult`
  fragments with a deliberately duplicated row (simulating the 1-page overlap), does the merged
  result de-duplicate correctly? Given fragments where only one has a given metadata field
  non-null, does the merged metadata pick it up? Given one fragment that's empty (simulating a
  batch with no data for a multi-sample-scoped extraction), does merging tolerate it without
  error?
- An integration-style test using a real small multi-page PDF fixture (already-scanned or
  synthetically built) to confirm `pdf-lib` splitting actually produces independently-openable,
  valid sub-PDFs — not just a mocked assertion that splitting "was called."
- No real end-to-end test against a live 41-page Anthropic API call (too slow/costly for a test
  suite) — the pure batching-decision and merge-logic tests, plus the real-but-small splitting
  test, are what's checked automatically. The actual reported 41-page PDF remains available as
  the real manual verification case before this ships.
