# Origin/Process Auto-Suggestion

Date: 2026-08-13

## Context

The wizard's review step requires the user to manually select an origin/process value
(construction waste, hydraulic oil waste, etc.) before classification can run — this drives
EAL chapter selection and is deliberately never guessed by the classification engine itself,
since origin/process genuinely cannot be derived from lab analyte data alone.

During brainstorming, the user asked whether origin/process selection should move to *before*
extraction, with the AI extraction scoped to a pre-chosen chapter. Investigating two real
reports (`Totalanalyse betongprøver - Alta Lufthavn Avinor.pdf`, `Analyser jord 170503
Hera.pdf`) showed this would be a regression, not an improvement:

- Origin/matrix is genuinely not always knowable before opening the document. The Eurofins
  file's own filename claims "concrete samples" but the PDF actually bundles a PFAS/ash-asphalt
  sub-report alongside real concrete sub-reports — the same multi-sample-per-PDF problem this
  app already solved with two-stage extraction. Pre-committing to one origin for the whole
  upload would have mis-tagged the ash-asphalt sample.
- Extraction (structured lab values) doesn't need the chapter — only the final EAL-assignment
  step does. Scoping extraction to a possibly-wrong pre-chosen chapter risks making extraction
  *worse* for no benefit.
- Some labs already state their own EAL/EER code directly in the report (the Italian Hera
  report states `EER: 170503*` on page 1) — the engine already cross-checks its own
  chapter-derived code against this when present (`eal.ts`'s lab-agreement/flag-for-review
  logic). This is a stronger, already-existing version of "does the human know the right
  chapter" that needs no upfront guess at all.

The real improvement identified: keep the existing order (extract, then categorize, then
classify) but make the post-extraction categorization step *smarter* — auto-suggest/pre-fill
the origin/process field using what extraction already found, so the human's step becomes a
quick confirm/correct instead of a blind pick.

## Scope of this slice

**In scope:**
- A new `suggestedOriginProcess: string | null` field in the Stage B extraction schema —
  Claude's best-guess match against the real 25-option `ORIGIN_OPTIONS` list, or `null` if
  genuinely unsure. Validated against the real list post-parse; any value not in the list is
  normalized to `null`, never trusted.
- A deterministic override: when the lab already states its own EAL code
  (`metadata.labStatedEalCode`), derive the origin directly from that code's chapter digits —
  no AI guessing involved, since the lab already told us.
- Precedence logic combining both sources: lab-code-derived beats Claude's suggestion beats
  nothing.
- Pre-filling the wizard's origin/process input with the computed suggestion — still a plain,
  fully editable field, same component behavior as today, just a smarter default. Updated
  helper text reflecting that a suggestion may be pre-filled and should be confirmed.

**Explicitly out of scope:**
- Translating `eal-koder-full.json`'s Norwegian descriptions to English — a separate,
  independently-valuable slice with its own real-data-sourcing requirement (the official EU
  List of Waste English text), to be brainstormed separately.
- Widening `customChapter`'s validation beyond the 25 curated `ORIGIN_OPTIONS` chapters — a
  known, already-documented gap from the previous branch's final review, not touched here. If
  a lab-stated code's chapter isn't one of the 25 curated ones, the deterministic override
  simply returns `null` and falls through to Claude's suggestion (or no suggestion) rather than
  reaching further.
- Any visual "this was suggested" badge/indicator — per the user's choice, this is a plain
  pre-fill with no extra UI state to track.
- Any change to `assignEalCode`'s matching/ambiguity logic, `classifySample`, or HP1-15 hazard
  classification — this slice only affects how the origin/process *field* gets its initial
  value; the human still confirms before "Classify" is clickable.

## Data flow

**Stage B extraction (`lib/hp-classification/extract.ts`):**
- The extraction prompt gains the real 25-option list (`value` + `label`, from
  `ORIGIN_OPTIONS`) and an instruction to return the single best-matching `value` string, or
  `null` if no option is a confident match — same honest-gap discipline as every other
  extraction field in this project (never guess, disclose uncertainty).
- `ExtractionResult` gains `suggestedOriginProcess: string | null`.
- `validateExtractionResponse` accepts `suggestedOriginProcess` as `null` or `string` (shape
  check only, matching the existing pattern for optional fields).
- After parsing, a new normalization step checks the returned value is actually one of the 25
  real `ORIGIN_OPTIONS` values (never trust a hallucinated string) — if not, silently
  normalizes to `null` before the result is returned, the same treatment already given to
  missing `matrixType`/`parentSampleIdentifier` during the multi-sample-detection work.

**`lib/hp-classification/origin-options.ts` — two new pure functions:**

```typescript
// Derives the origin option matching a lab-stated EAL code's chapter, if the lab already told
// us. Strips spaces and the trailing "*" hazard marker, takes the first 4 digits (the chapter),
// and looks up a curated ORIGIN_OPTIONS entry with that exact chapter. Returns null if the
// code is malformed or its chapter isn't one of the 25 curated ones (falls through to Claude's
// suggestion elsewhere — does not attempt to reach the wider 20-chapter catalogue; that gap is
// tracked separately, see "Explicitly out of scope" above).
export function deriveOriginFromLabCode(labStatedEalCode: string | null): string | null;

// Precedence: a lab-derived origin (grounded in the lab's own stated classification) always
// wins over Claude's inferred suggestion. Claude's suggestion is used only when no lab code is
// present or its chapter isn't curated, AND the suggestion is validated as a real
// ORIGIN_OPTIONS value (extraction-time normalization already handles this, but this function
// re-validates defensively since it's a public API other code may call directly). Returns null
// when neither source yields a real, curated origin.
export function suggestOriginProcess(
  labStatedEalCode: string | null,
  claudeSuggested: string | null
): string | null;
```

**Wizard wiring (`components/wizard/ExtractionReviewStep.tsx`):**
- The origin/process `useState("")` initializer becomes
  `useState(() => suggestOriginProcess(extraction.metadata.labStatedEalCode, extraction.suggestedOriginProcess) ?? "")`.
- The existing free-text/datalist input, matching, and custom-chapter fallback behavior are
  completely unchanged — a pre-filled value just starts the user further along than an empty
  field, exactly as if they'd typed/picked it themselves.
- Helper text under the field changes from "Never present in a lab report — required to select
  the correct EAL chapter. This is never guessed." to "Never present in a lab report — a
  suggestion may be pre-filled based on the extracted data, but always confirm it's correct
  before classifying."

## Testing

- `deriveOriginFromLabCode`: the real Italian sample's code (`"17 05 03*"` → `"escavo terre e
  rocce"`); a well-formed code outside the 25 curated chapters (e.g. a chapter-01 code) →
  `null`; `null` input → `null`.
- `suggestOriginProcess`: lab-derived value wins even when a different Claude suggestion is
  also present; falls to Claude's suggestion when no lab code is present; falls to `null` when
  neither source yields a value; rejects a Claude suggestion that isn't a real `ORIGIN_OPTIONS`
  value (defensive re-validation) even if some future caller forgets extraction-time
  normalization.
- Extraction validation: a `suggestedOriginProcess` value not in the real 25-option list is
  normalized to `null`, matching the existing `matrixType`/`parentSampleIdentifier`
  null-normalization pattern.
- `ExtractionReviewStep`: given extraction data with `labStatedEalCode: "17 05 03*"`, the origin
  input's initial value is `"escavo terre e rocce"` — a rendering-level regression test using
  the real Italian sample fixture already in this repo.
