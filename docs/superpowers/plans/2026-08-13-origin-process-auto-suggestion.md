# Origin/Process Auto-Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-fill the wizard's origin/process field with a smart suggestion — derived from the lab's own stated EAL code when present, or Claude's best-guess match against the real 25-option list otherwise — so the human's confirm step becomes a quick check instead of a blind pick, without changing the overall extract-then-categorize-then-classify order.

**Architecture:** Two new pure functions in `origin-options.ts` implement the suggestion precedence (lab-code-derived beats Claude's guess beats nothing). `extract.ts`'s Stage B extraction gains a `suggestedOriginProcess` field, with the real 25-option list injected into the prompt and a defensive post-parse normalization step that never trusts a hallucinated value. The wizard's review step uses the combined suggestion as the origin field's initial value — the field itself, its editing behavior, and the "Classify" button's requirement to have a value, are all unchanged.

**Tech Stack:** TypeScript, Vitest, Anthropic Claude (existing extraction pipeline).

## Global Constraints

- **This branch builds on top of the still-open `feature/full-eal-catalogue` branch (PR #2), not `master`.** `master` currently only has the old 8-entry `ORIGIN_OPTIONS`; this feature needs the real 25-entry list. Branch off `feature/full-eal-catalogue`.
- Claude's `suggestedOriginProcess` must be validated against the real, curated `ORIGIN_OPTIONS` list — any value not in that list is normalized to `null`, never trusted. Same honest-gap discipline as every other extraction field in this project.
- A lab-stated EAL code, when present, always wins over Claude's inferred suggestion — it's grounded in the lab's own real classification, not an inference.
- No visual "this was suggested" badge or extra UI state — a plain pre-fill only, per the user's explicit choice.
- No change to `assignEalCode`, `classifySample`, HP1-15 hazard classification, or the origin field's existing editing/validation behavior — this slice only changes what value the field starts with.
- Widening `customChapter`'s reach beyond the 25 curated chapters is out of scope (a known, separately-tracked gap) — when a lab-stated code's chapter isn't one of the 25, the deterministic override returns `null` and falls through to Claude's suggestion, it does not reach further.

---

### Task 1: `origin-options.ts` — suggestion precedence functions

**Files:**
- Modify: `lib/hp-classification/origin-options.ts`
- Test: `tests/hp-classification/origin-options.test.ts`

**Interfaces:**
- Consumes: `ORIGIN_OPTIONS` (existing, 25 real entries on `feature/full-eal-catalogue`).
- Produces: `deriveOriginFromLabCode(labStatedEalCode: string | null): string | null` and `suggestOriginProcess(labStatedEalCode: string | null, claudeSuggested: string | null): string | null` — consumed by Task 3's `ExtractionReviewStep.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hp-classification/origin-options.test.ts` (new `describe` blocks, after the existing ones):

```typescript
import { deriveOriginFromLabCode, suggestOriginProcess } from "@/lib/hp-classification/origin-options";

describe("deriveOriginFromLabCode", () => {
  it("derives the real origin option for the Italian sample's real lab-stated EAL code", () => {
    expect(deriveOriginFromLabCode("17 05 03*")).toBe("escavo terre e rocce");
  });

  it("handles a code with no spaces or asterisk the same way", () => {
    expect(deriveOriginFromLabCode("170503")).toBe("escavo terre e rocce");
  });

  it("returns null for a well-formed code whose chapter isn't one of the 25 curated ones", () => {
    // Chapter 0101 (mineral extraction) is real but not among the 7 curated chapters.
    expect(deriveOriginFromLabCode("01 01 01")).toBeNull();
  });

  it("returns null when no lab code is given", () => {
    expect(deriveOriginFromLabCode(null)).toBeNull();
  });

  it("returns null for a malformed code with fewer than 4 digits", () => {
    expect(deriveOriginFromLabCode("1*")).toBeNull();
  });
});

describe("suggestOriginProcess", () => {
  it("prefers the lab-derived origin even when a different Claude suggestion is also present", () => {
    const result = suggestOriginProcess("17 05 03*", "hydraulic oil waste");
    expect(result).toBe("escavo terre e rocce");
  });

  it("falls back to Claude's suggestion when no lab code is present", () => {
    const result = suggestOriginProcess(null, "hydraulic oil waste");
    expect(result).toBe("hydraulic oil waste");
  });

  it("falls back to Claude's suggestion when the lab code's chapter isn't curated", () => {
    const result = suggestOriginProcess("01 01 01", "hydraulic oil waste");
    expect(result).toBe("hydraulic oil waste");
  });

  it("rejects a Claude suggestion that isn't a real ORIGIN_OPTIONS value, even with no lab code", () => {
    const result = suggestOriginProcess(null, "something Claude made up");
    expect(result).toBeNull();
  });

  it("returns null when neither source yields a value", () => {
    expect(suggestOriginProcess(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/origin-options.test.ts`
Expected: FAIL with "deriveOriginFromLabCode is not a function" (or similar — the functions don't exist yet).

- [ ] **Step 3: Write the implementation**

In `lib/hp-classification/origin-options.ts`, append after the existing `withCustomOrigin` function (at the end of the file):

```typescript
// Derives the origin option matching a lab-stated EAL code's chapter, if the lab already told
// us. Strips everything except digits (handles "17 05 03*", "170503", spaces, the trailing "*"
// hazard marker) and takes the first 4 digits — the chapter. Returns null if the code is too
// short to contain a chapter, or if its chapter isn't one of the 25 curated ORIGIN_OPTIONS
// entries (this does NOT reach the wider 20-chapter catalogue — see the plan's Global
// Constraints for why that's a deliberate boundary, not an oversight).
export function deriveOriginFromLabCode(labStatedEalCode: string | null): string | null {
  if (!labStatedEalCode) return null;
  const digitsOnly = labStatedEalCode.replace(/[^0-9]/g, "");
  if (digitsOnly.length < 4) return null;
  const chapter = digitsOnly.slice(0, 4);
  const match = ORIGIN_OPTIONS.find(o => o.chapter === chapter);
  return match ? match.value : null;
}

// Combines both suggestion sources with a strict precedence: a lab-derived origin (grounded in
// the lab's own stated classification) always wins over Claude's inferred suggestion. Claude's
// suggestion is only used as a fallback, and only if it's actually a real ORIGIN_OPTIONS value
// — this function re-validates that defensively (extraction-time normalization already does
// this too, but this is a public function other code may call directly, so it never trusts an
// unvalidated string). Returns null when neither source yields a real, curated origin.
export function suggestOriginProcess(
  labStatedEalCode: string | null,
  claudeSuggested: string | null
): string | null {
  const fromLabCode = deriveOriginFromLabCode(labStatedEalCode);
  if (fromLabCode) return fromLabCode;
  if (claudeSuggested && ORIGIN_OPTIONS.some(o => o.value === claudeSuggested)) {
    return claudeSuggested;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/origin-options.test.ts`
Expected: PASS (all tests, including the pre-existing ones from before this task).

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/origin-options.ts tests/hp-classification/origin-options.test.ts
git commit -m "feat: add deriveOriginFromLabCode/suggestOriginProcess precedence functions"
```

---

### Task 2: `extract.ts` — Stage B suggests an origin/process match

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- Consumes: `ORIGIN_OPTIONS` (existing).
- Produces: `ExtractionResult.suggestedOriginProcess: string | null` (new field), `normalizeSuggestedOriginProcess(value: unknown): string | null` (new exported pure function) — consumed by Task 3 via the API routes, which already pass the full `ExtractionResult` through unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hp-classification/extract.test.ts`. First, update the import line at the top of the file to also bring in the new function:

```typescript
import { validateExtractionResponse, hasUsableText, buildMessageContent, validateListSamplesResponse, normalizeSuggestedOriginProcess } from "@/lib/hp-classification/extract";
```

Then add these tests inside the existing `describe("validateExtractionResponse", ...)` block, after the last existing `it(...)` (right before the block's closing `});`):

```typescript
  it("accepts a response with a real suggestedOriginProcess value from ORIGIN_OPTIONS", () => {
    const withSuggestion = { ...validResponse, suggestedOriginProcess: "hydraulic oil waste" };
    expect(validateExtractionResponse(withSuggestion)).toBe(true);
  });

  it("accepts a response with suggestedOriginProcess explicitly null", () => {
    const withNullSuggestion = { ...validResponse, suggestedOriginProcess: null };
    expect(validateExtractionResponse(withNullSuggestion)).toBe(true);
  });

  it("rejects a response where suggestedOriginProcess is a non-string, non-null value", () => {
    const bad = { ...validResponse, suggestedOriginProcess: 42 };
    expect(validateExtractionResponse(bad)).toBe(false);
  });
```

(Note: `validResponse` itself has no `suggestedOriginProcess` key at all, and the existing "accepts a well-formed extraction response" test already asserts `validateExtractionResponse(validResponse)` is `true` — this must keep passing. The field's absence must be treated as valid, matching how `resultId` was handled in an earlier slice: the type declares it required, but the schema is populated programmatically after validation, not strictly required from the LLM's raw JSON.)

Add a new top-level `describe` block for the new pure normalization function, and one for confirming the prompt actually includes the real option list:

```typescript
describe("normalizeSuggestedOriginProcess", () => {
  it("accepts a real ORIGIN_OPTIONS value unchanged", () => {
    expect(normalizeSuggestedOriginProcess("hydraulic oil waste")).toBe("hydraulic oil waste");
  });

  it("rejects a value not in ORIGIN_OPTIONS, returning null", () => {
    expect(normalizeSuggestedOriginProcess("something Claude made up")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeSuggestedOriginProcess(null)).toBeNull();
  });

  it("returns null for undefined input (field absent from the LLM's response)", () => {
    expect(normalizeSuggestedOriginProcess(undefined)).toBeNull();
  });

  it("returns null for a non-string, non-null value", () => {
    expect(normalizeSuggestedOriginProcess(42)).toBeNull();
  });
});
```

Add this inside the existing `describe("buildMessageContent", ...)` block, after its last `it(...)`:

```typescript
  it("includes the real origin/process option list so Claude can pick from it", () => {
    const analyteRef: AnalyteReference[] = [];
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), analyteRef, null);
    const textBlock = content.find(b => b.type === "text");
    expect(textBlock).toBeDefined();
    expect((textBlock as { text: string }).text).toContain("hydraulic oil waste");
    expect((textBlock as { text: string }).text).toContain("suggestedOriginProcess");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL — `normalizeSuggestedOriginProcess` doesn't exist yet, and the prompt doesn't mention `suggestedOriginProcess` or the real option list yet.

- [ ] **Step 3: Write the implementation**

In `lib/hp-classification/extract.ts`:

Add the import (near the top, after the existing imports):

```typescript
import { ORIGIN_OPTIONS } from "./origin-options";
```

Update the `ExtractionResult` interface to add the new field:

```typescript
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
```

In `validateExtractionResponse`, add this check right before the final `return true;`:

```typescript
  if (
    d.suggestedOriginProcess !== undefined &&
    d.suggestedOriginProcess !== null &&
    typeof d.suggestedOriginProcess !== "string"
  ) return false;
```

Add a new exported function near the bottom of the file, right before `extractSampleData`:

```typescript
// Never trust a hallucinated origin suggestion — only accept it if it's actually one of the
// real, curated ORIGIN_OPTIONS values. Anything else (a made-up string, the field being absent,
// or an explicit null) becomes null. This is the same honest-gap discipline used throughout
// this extraction pipeline: an uncertain or invalid guess must surface as "no suggestion", not
// as a wrong one.
export function normalizeSuggestedOriginProcess(value: unknown): string | null {
  return typeof value === "string" && ORIGIN_OPTIONS.some(o => o.value === value) ? value : null;
}
```

In `buildSchemaInstructions`, add the origin option list as a new local constant near the top of the function (alongside `knownAnalytes`):

```typescript
  const originOptionsList = ORIGIN_OPTIONS.map(o => `- ${o.value} (${o.label})`).join("\n");
```

Add `"suggestedOriginProcess": string | null` to the returned JSON shape, as a new field alongside `"unmatchedAnalytes"` — change:

```typescript
  "unmatchedAnalytes": [string]
}${scopingInstruction}
```

to:

```typescript
  "unmatchedAnalytes": [string],
  "suggestedOriginProcess": string | null
}${scopingInstruction}
```

Add a new paragraph right after the existing `Do NOT populate an "originProcess" field...` sentence (these are two different fields — `originProcess` stays permanently absent/human-only, `suggestedOriginProcess` is new and Claude-populated — the prompt must make the distinction clear):

```typescript
Do NOT populate an "originProcess" field — it is intentionally absent from this schema. It is never present in a lab report and must be supplied by the user, not guessed by you.

For "suggestedOriginProcess" (a DIFFERENT field from "originProcess" above), pick the single closest match from this real list of origin/process values, based on the report's stated matrix type, material description, or process context. Return the exact "value" string shown (not the label), or return null if none of these confidently matches — never invent a value not in this list, and never guess when you are uncertain:

${originOptionsList}
```

In `extractSampleData`, right after the `if (!validateExtractionResponse(parsed)) { ... }` block and before the existing `resultsWithIds` line, add:

```typescript
      // Never trust Claude's raw suggestedOriginProcess string — only a real, curated
      // ORIGIN_OPTIONS value survives; anything else (including an absent field) becomes null.
      const normalizedSuggestedOrigin = normalizeSuggestedOriginProcess(parsed.suggestedOriginProcess);
```

Update the function's final `return` statement to include the new field:

```typescript
      return {
        ...parsed,
        results: resultsWithIds,
        suggestedOriginProcess: normalizedSuggestedOrigin,
        sourceType: hasUsableText(pdfText) ? "text" : "document",
      };
```

(This replaces the existing single-line `return { ...parsed, results: resultsWithIds, sourceType: hasUsableText(pdfText) ? "text" : "document" };`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS (all tests, including every pre-existing one — the `validResponse` fixture without `suggestedOriginProcess` must still validate as `true`).

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: Stage B extraction suggests an origin/process match, validated against the real option list"
```

---

### Task 3: Wire the suggestion into the wizard's review step

**Files:**
- Modify: `components/wizard/ExtractionReviewStep.tsx`
- Modify: `components/wizard/Wizard.tsx`
- Modify: `components/wizard/UploadStep.tsx`
- Modify: `components/wizard/SampleSelectionStep.tsx`

**Interfaces:**
- Consumes: `suggestOriginProcess` (Task 1), `ExtractionResult.suggestedOriginProcess` (Task 2, already passed through unchanged by the existing `/api/extract` and `/api/extract-sample` routes, which both return `{ data }` = the full `ExtractionResult`).
- No new exported interfaces — this task only widens existing duck-typed prop shapes to include the new field so the app compiles and the value flows end-to-end.

- [ ] **Step 1: Update `ExtractionReviewStep.tsx`**

Change the import line:

```typescript
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
```

to:

```typescript
import { ORIGIN_OPTIONS, suggestOriginProcess } from "@/lib/hp-classification/origin-options";
```

Add `suggestedOriginProcess: string | null;` to the `extraction` prop's inline type, as a sibling of `sourceType`:

```typescript
export function ExtractionReviewStep({ extraction, onConfirm }: {
  extraction: {
    metadata: ExtractedMetadata;
    results: ExtractedResultRow[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  };
  onConfirm: (originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) => void;
}) {
```

Change the origin `useState` initializer from:

```typescript
  const [originProcess, setOriginProcess] = useState("");
```

to:

```typescript
  const [originProcess, setOriginProcess] = useState(
    () => suggestOriginProcess(extraction.metadata.labStatedEalCode, extraction.suggestedOriginProcess) ?? ""
  );
```

Change the helper paragraph text under the origin/process label from:

```tsx
          <p className="text-xs text-black/60">
            Never present in a lab report — required to select the correct EAL chapter. This is never guessed.
          </p>
```

to:

```tsx
          <p className="text-xs text-black/60">
            Never present in a lab report — a suggestion may be pre-filled based on the extracted data, but always
            confirm it's correct before classifying.
          </p>
```

- [ ] **Step 2: Update `Wizard.tsx`**

Add `suggestedOriginProcess: string | null;` to the `ExtractionData` interface, as a sibling of `sourceType`:

```typescript
interface ExtractionData {
  metadata: ExtractedMetadata;
  results: ExtractedResultRow[];
  testResults: Record<string, unknown>[];
  unmatchedAnalytes: string[];
  suggestedOriginProcess: string | null;
  sourceType: "text" | "document";
}
```

Add the same field to `handleExtracted`'s parameter type:

```typescript
  function handleExtracted(data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) {
```

- [ ] **Step 3: Update `UploadStep.tsx`**

Add the same field to the `onExtracted` prop's parameter type, so it stays structurally compatible with `handleExtracted`:

```typescript
export function UploadStep({ onExtracted, onSamplesFound, onError }: {
  onExtracted: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) => void;
  onSamplesFound: (samples: DetectedSample[], file: File) => void;
  onError: (message: string) => void;
}) {
```

- [ ] **Step 4: Update `SampleSelectionStep.tsx`**

Find its `onSelected` prop's parameter type (same shape as `UploadStep.tsx`'s `onExtracted`) and add the same field:

```typescript
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) => void;
```

(Match this to whatever the file's exact current parameter type text is — it should be identical in shape to `UploadStep.tsx`'s `onExtracted`, just add the same one new line.)

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean — this task is pure type-widening plus the one real behavior change (the `useState` initializer), so no test file changes are needed here; Task 1 and Task 2's tests already cover the new logic these components call.

- [ ] **Step 6: Manual verification**

With the local dev server running (`lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`), upload the real Italian sample PDF (or use the `fixtures/italian-sample.json` fixture's data shape as a reference) through the wizard and confirm the origin/process field on the review step is pre-filled with "Excavated soil or rock" (the label for `"escavo terre e rocce"`) rather than empty, since that fixture's `labStatedEalCode` is `"17 05 03*"`. If live extraction isn't available (e.g. Anthropic API credit/availability issues), verify via a direct unit-level check instead: confirm `suggestOriginProcess("17 05 03*", null)` returns `"escavo terre e rocce"` (already covered by Task 1's tests) and that `ExtractionReviewStep`'s `useState` initializer calls this function with the real prop shape (inspect the diff, not a live run) — note explicitly in your report which verification path was used.

- [ ] **Step 7: Commit**

```bash
git add components/wizard/ExtractionReviewStep.tsx components/wizard/Wizard.tsx components/wizard/UploadStep.tsx components/wizard/SampleSelectionStep.tsx
git commit -m "feat: pre-fill origin/process field with the computed suggestion"
```

---

## Self-Review Notes

- **Spec coverage:** suggestion precedence logic → Task 1. Extraction schema field + validation + normalization + prompt injection → Task 2. UI wiring (including the three duck-typed prop shapes that would otherwise silently drift out of sync and break the build) → Task 3. The spec's "Explicitly out of scope" items (EAL English translation, widening `customChapter`, visual suggestion badge, any classification-logic change) are untouched by any task.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command with expected output.
- **Type consistency:** `deriveOriginFromLabCode`/`suggestOriginProcess` (Task 1) are called with the exact same signature in Task 3's `ExtractionReviewStep.tsx`. `ExtractionResult.suggestedOriginProcess: string | null` (Task 2) matches the field name and type used in Task 3's four duck-typed prop shapes exactly. `normalizeSuggestedOriginProcess` is defined and used consistently within Task 2 only (an internal implementation detail Task 3 doesn't need to know about directly, since the API routes already pass the full, already-normalized `ExtractionResult` through).
- **Existing-test safety:** the plan explicitly calls out that `extract.test.ts`'s pre-existing `validResponse` fixture (which has no `suggestedOriginProcess` key at all) must keep validating as `true` — verified achievable by treating the field as optional-with-undefined-allowed in `validateExtractionResponse`, matching the precedent already set by this project's earlier `resultId` field (declared required in the type, populated programmatically rather than strictly required from the LLM's raw JSON).
