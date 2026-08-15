# Multi-Sample PDF Detection

Date: 2026-08-13

## Context

The extraction pipeline (`lib/hp-classification/extract.ts`) assumes every uploaded PDF describes exactly one sample. The real Eurofins Alta Lufthavn PDF breaks this assumption: it bundles five separate lab sub-reports (a PFAS panel and four "Totalanalyse betong" concrete panels, one on a different measurement basis) across 15 pages. After the `hasUsableText()` routing fix (previous slice) correctly sends this PDF down the native-document extraction path, the extraction call itself now fails — Claude's response comes back as malformed JSON, repeatedly, not intermittently. The likely cause: the single-sample extraction prompt asks Claude to reconcile five distinct samples' worth of data into one schema, either producing confused/inconsistent output or exceeding the 4096-token response budget.

## Decision: two-stage extraction, detection then scoped extraction

**Stage A — `listSamples()`**: one lightweight Claude call, same document/text input as today, asking only "how many distinct lab samples are described in this document, and for each, its sample number/marking and matrix type?" This returns a small array with no full analyte data — the response stays small regardless of how many samples are bundled, eliminating the token-overflow failure mode entirely (Stage A's own output is bounded by sample *count*, not by the full analyte data of all samples combined).

**Stage B — the existing extraction, now always explicitly scoped**: unchanged extraction logic, but the prompt is given an explicit sample identifier to extract ("extract only the sample marked X") rather than implicitly assuming the whole document describes one sample. This is what actually fixes the malformed-JSON failure: Claude is never asked to describe more than one sample's data in a single response.

When Stage A finds exactly one sample (the common case — every report validated so far except this one), the app proceeds directly to Stage B with that sample's identifier, with no user-visible change from today's behavior: same number of visible wizard steps, one extra cheap API call happening behind the scenes. When Stage A finds more than one, the wizard inserts a new **Sample selection** step (between Upload and Extraction review) listing each detected sample by marking + matrix type; the user picks one, and Stage B runs scoped to that pick.

## Scope of this slice

**In scope:**
- `listSamples()` in `lib/hp-classification/extract.ts` — Stage A detection call.
- Scoping Stage B's existing prompt to an explicit sample identifier.
- A new wizard step (`SampleSelectionStep`) shown only when Stage A finds >1 sample; skipped entirely for single-sample documents.
- Fallback: if Stage A fails or returns zero samples, fall back to today's unscoped Stage B behavior (attempt extraction on the whole document) rather than blocking the user.
- Manual verification against both real PDFs in hand: the Italian sample (must show zero behavior change) and the Eurofins bundle (must now successfully extract at least one of its five samples end-to-end).

**Explicitly out of scope:**
- Batch classification of all samples in a bundled PDF in one pass — this slice classifies one sample per submission, same as today; picking a different sample from the same PDF means re-running the wizard, not a new multi-select flow.
- Any change to `AnalyteReference` coverage or the PFAS substance panel specifically (the Eurofins bundle's first sub-report is a PFAS panel with substances entirely outside the current reference table) — a real, separate follow-on, not addressed by fixing the routing/scoping problem this slice targets.
- Any change to `classifySample()`, `normalizeSample()`, `classifyHazard()`, or `assignEalCode()` — this slice is entirely about getting clean, correctly-scoped extraction input to the existing, already-validated engine, not about the engine itself.

## Error handling

Stage A is a detection optimization, not a hard gate — its own failure (network error, malformed response) falls back to today's behavior (unscoped Stage B on the whole document) rather than blocking extraction entirely. This means the worst case for a document Stage A can't parse is identical to today's status quo, never worse.

## Testing

- `listSamples()`'s response-shape validation gets a dedicated unit test (structural checks only, no network call — same no-network-calls-in-unit-tests discipline as the existing `validateExtractionResponse` tests).
- Manual verification: re-run the Italian sample PDF (confirm Stage A detects exactly 1 sample, picker is skipped, Stage B's output is unchanged from before this slice) and the Eurofins bundle (confirm Stage A detects multiple samples, the picker renders with real sample markings, and picking one successfully extracts real analyte data without the malformed-JSON failure that motivated this slice).
