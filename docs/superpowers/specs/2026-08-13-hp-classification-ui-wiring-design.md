# Wiring the HP1-15 Classification Engine into the UI

Date: 2026-08-13

## Context

The HP1-15 classification engine (`lib/hp-classification/*`, merged in the previous slice) exists only as tested pure functions — nothing in the app calls it. The wizard's live flow (`components/wizard/*`) still runs on the older `lib/extraction.ts`/`lib/classification.ts` schema and the WM Recovery partner-matching demo data, which predates this session's pivot to real regulatory data. This spec wires the real engine into the UI, replacing that older flow entirely, and closes a gap the final review of the last slice flagged: there is currently no single "production" function that composes `normalizeSample → speciateElement → classifyHazard → assignEalCode` — only the regression test does that assembly today.

## Scope of this slice

**In scope:**
- A `classifySample()` orchestrator in `lib/hp-classification/` composing the four existing pipeline stages into one callable entry point.
- A new extractor (`lib/hp-classification/extract.ts`) that parses a lab report PDF into the engine's real schema (`SampleMetadata`/`SampleResult`/`TestResult`), targeting both report layouts seen so far (Italian LabAnalysis, Norwegian Eurofins) via one Claude-based prompt.
- A rebuilt wizard flow: Upload → Extraction review (with a required, user-supplied `originProcess` field and a visible "unmatched substances" list) → Classification results (HP1-15 outcomes, triggered HPs, EAL assignment).
- Retirement of the old flow: `lib/extraction.ts`, `lib/classification.ts`, WM Recovery partner-matching (`lib/wmr-partners.json`, `lib/wmr-cases.ts`, `lib/chemical-coverage.ts`, `lib/wmr-business-areas.ts`) and their wizard components/tests are removed, the same way the prior Stage 2 engine was removed in an earlier slice.

**Explicitly out of scope for this slice** (real, already-designed follow-on work, not abandoned):
- Stage 4 (facility matching) — the wizard's classification step is the current end of the flow; no partner/facility matching happens after it.
- Expanding `AnalyteReference` beyond what's needed to keep extraction useful — unmatched substances are surfaced, not silently guessed, and the table grows opportunistically as real reports are run through the tool, not exhaustively seeded now.
- A structured `originProcess` picker beyond a free-text field — the `originToChapterLookup` table only has one real entry today ("escavo terre e rocce" → chapter 1705); a dropdown becomes worth building once more entries exist.
- Any change to the underlying HP1-15/EAL logic itself — this slice is purely about calling the existing, already-validated engine from the UI.

## Architecture

**`lib/hp-classification/classify-sample.ts`** (new) — `classifySample(metadata: SampleMetadata, results: SampleResult[], testResults: TestResult[], analyteRef: AnalyteReference[], compoundForms: ElementCompoundForm[], originToChapterLookup: Record<string, string>): { hazard: HazardClassification; eal: EalAssignment }`. This is the real production version of the assembly logic that today only exists inside `tests/hp-classification/italian-sample.test.ts`: it runs `normalizeSample`, then for each normalized result whose `analyteId` maps to an `AnalyteReference` entry with an `elementSymbol`, runs `speciateElement` and fans its compound results into `NormalizedResultWithClp[]`; for entries with a direct `hStatement` or `hStatements` array (no speciation), it attaches those directly. The combined list feeds `classifyHazard`, whose `isHazardous` result feeds `assignEalCode`. The regression test is updated to call this function instead of duplicating its logic — this both closes the "no production entry point" gap and means the test now proves the shipped path, not a parallel one.

**`lib/hp-classification/extract.ts`** (new) — `extractSampleData(pdfText: string, analyteRef: AnalyteReference[]): Promise<{ metadata: Partial<SampleMetadata>; results: SampleResult[]; testResults: TestResult[]; unmatchedAnalytes: string[] }>`. Follows the existing `lib/extraction.ts`'s structure (pdfjs text extraction happens in the API route, same as today; this module takes the extracted text and makes one Claude call). The prompt: (1) asks for every `SampleMetadata` field except `originProcess`, which is never requested since it's never present in a lab report and must come from the user; (2) is given the current `AnalyteReference` table's canonical names (Italian/Norwegian/English) as its matching vocabulary and instructed to tag each result row with a matching `analyteId` or leave it `null` with the raw name preserved; (3) extracts `testResults` from free-text lab statements (flammability, skin corrosion, skin irritation) when present, matching the pattern already validated against the real Italian sample. Retries once on a malformed/incomplete response, mirroring the old extractor's proven retry behavior.

**Removal**: `lib/extraction.ts`, `lib/classification.ts`, `lib/wmr-partners.json`, `lib/wmr-cases.ts`, `lib/chemical-coverage.ts`, `lib/wmr-business-areas.ts`, their data files, and their tests are deleted. `components/wizard/*` components are rebuilt against the new schema rather than patched.

## UI flow

Three wizard steps:

1. **Upload** — same PDF upload UI as today, unchanged.
2. **Extraction review** — shows the extracted `SampleMetadata` fields (editable, since OCR/LLM extraction can misread a field), a required `originProcess` text field that blocks progression until filled (client-side; the engine's own Stage 0 halt remains the server-side honest fallback if this is ever bypassed), and — if `unmatchedAnalytes` is non-empty — a visible list of substances the extractor found but couldn't map to a known reference entry, framed as "not evaluated" rather than hidden.
3. **Classification results** — calls `classifySample()` and renders: `resultsByHp` as a per-HP-code list (each showing its literal outcome — `true`/`false`/`"not tested — assumed not applicable"`/`"requires case-specific assessment — not automatable from lab data alone"`/`"superseded by HP8"` — not just a checkmark, since the three-state nature matters), `triggeredHps` as a summary, `confidenceFlags` (from HP6's category-lookup gap-flagging, added in the last slice) shown as caveats, and the `EalAssignment` (`code`, `description`, `confidence` string) prominently. A note states facility matching is a future stage, not silently omitted from this screen.

## Error handling & testing

- Extraction failure (malformed JSON, missing required fields after retry) surfaces as an error state on the Upload step, same UX pattern as today's extractor.
- `classifySample()` is called only once `originProcess` is non-empty; the Classify button stays disabled until then.
- **Testing**: unit tests for `classifySample()`'s composition logic (parametrized versions of what the regression test currently asserts inline, now testing the extracted function). A new extraction test feeding the Italian sample's real PDF text through `extractSampleData()` and asserting the output is shape-compatible with what `normalizeSample` expects (not a full re-classification — that's already covered). Manual verification: upload the real Italian sample PDF through the actual browser preview end-to-end and confirm the UI renders `HP6/HP7/HP10/HP14` triggered and `17 05 03*` — the same ground truth the regression test already proves at the function level, now proven through the real UI path too.
