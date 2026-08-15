# Origin/Process Searchable Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the origin/process free-text input with a searchable dropdown covering all of EAL chapter 17's real construction/demolition subchapters (shown as "Name — Code"), plus a custom-entry fallback that always resolves to a real EAL code by having the user explicitly pick a chapter.

**Architecture:** A small shared data module holds the 8 real origin-type options (label + EAL chapter code), consumed by both the UI (a native `<input list>`/`<datalist>` — genuine browser type-to-filter search, matching this codebase's existing plain-HTML-input convention rather than introducing a new component library API) and a unit test asserting the lookup values. Custom entries send an extra `customChapter` field through to `/api/classify`, which merges it into its existing `ORIGIN_TO_CHAPTER_LOOKUP` for that one request only — no persistence, no schema change to `assignEalCode`.

**Tech Stack:** TypeScript, React (native `<datalist>`, no new UI library dependency), Vitest.

## Global Constraints

- Origin/process is never extracted or inferred from the PDF — this plan only touches how the user supplies it, never adds extraction for it.
- All 8 dropdown chapter codes must be real, transcribed from `lib/data/eal-koder-kapittel17.json`'s level-2 subchapter descriptions — no invented codes.
- A custom entry must always resolve to a real EAL code (the user explicitly picks the chapter) — never left to silently fail the existing "no chapter mapping found" halt.
- A custom mapping is scoped to the one request it was submitted with — no database or config-file write, no mutation of the shared base lookup object across requests.

---

### Task 1: Origin-type options data module

**Files:**
- Create: `lib/hp-classification/origin-options.ts`
- Test: `tests/hp-classification/origin-options.test.ts`

**Interfaces:**
- Produces: `ORIGIN_OPTIONS: OriginOption[]` and `interface OriginOption { value: string; label: string; chapter: string }` — consumed by Task 2's UI component and Task 3's route (which already imports a similarly-shaped lookup).

- [ ] **Step 1: Write the failing test**

Create `tests/hp-classification/origin-options.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";

describe("ORIGIN_OPTIONS", () => {
  it("has exactly 8 real chapter-17 origin types", () => {
    expect(ORIGIN_OPTIONS).toHaveLength(8);
  });

  it("every option has a non-empty value, label, and a 4-digit chapter code", () => {
    for (const option of ORIGIN_OPTIONS) {
      expect(option.value.length).toBeGreaterThan(0);
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.chapter).toMatch(/^\d{4}$/);
    }
  });

  it("includes excavated soil or rock mapped to chapter 1705, matching the existing regression fixture's origin", () => {
    const soilOption = ORIGIN_OPTIONS.find(o => o.chapter === "1705");
    expect(soilOption).toBeDefined();
    expect(soilOption!.value).toBe("escavo terre e rocce");
  });

  it("has no duplicate values or chapters", () => {
    const values = ORIGIN_OPTIONS.map(o => o.value);
    const chapters = ORIGIN_OPTIONS.map(o => o.chapter);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(chapters).size).toBe(chapters.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/origin-options.test.ts`
Expected: FAIL with "Cannot find module '@/lib/hp-classification/origin-options'"

- [ ] **Step 3: Write the implementation**

Create `lib/hp-classification/origin-options.ts`. The `value` for chapter 1705 stays `"escavo terre e rocce"` (unchanged from the existing hardcoded lookup, since the regression fixture and the app's own `originToChapterLookup` in `app/api/classify/route.ts` both already key on this exact string) — the other 7 use plain English description strings as their `value` since there's no existing fixture depending on a specific string for them:

```typescript
export interface OriginOption {
  value: string;
  label: string;
  chapter: string;
}

// Real EAL chapter-17 subchapters, transcribed from lib/data/eal-koder-kapittel17.json's
// level-2 (nivaa: 2) descriptions. "escavo terre e rocce" is kept as the exact value string
// for chapter 1705 since it's already what the Italian sample fixture and the existing
// ORIGIN_TO_CHAPTER_LOOKUP key on — changing it would break that regression test.
export const ORIGIN_OPTIONS: OriginOption[] = [
  { value: "escavo terre e rocce", label: "Excavated soil or rock", chapter: "1705" },
  { value: "concrete, brick, tile, or ceramic waste", label: "Concrete, brick, tile, or ceramic waste", chapter: "1701" },
  { value: "wood, glass, or plastic waste", label: "Wood, glass, or plastic waste", chapter: "1702" },
  { value: "bituminous mixtures / asphalt", label: "Bituminous mixtures / asphalt", chapter: "1703" },
  { value: "metal waste", label: "Metal waste", chapter: "1704" },
  { value: "insulation material or asbestos-containing building material", label: "Insulation material or asbestos-containing building material", chapter: "1706" },
  { value: "gypsum-based building material", label: "Gypsum-based building material", chapter: "1708" },
  { value: "other construction/demolition waste", label: "Other construction/demolition waste", chapter: "1709" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/origin-options.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/hp-classification/origin-options.ts tests/hp-classification/origin-options.test.ts
git commit -m "feat: add real chapter-17 origin-process options data"
```

---

### Task 2: Searchable dropdown + custom-entry fallback in the UI

**Files:**
- Modify: `components/wizard/ExtractionReviewStep.tsx`
- Modify: `components/wizard/Wizard.tsx`

**Interfaces:**
- Consumes: `ORIGIN_OPTIONS`, `OriginOption` (Task 1).
- Produces: `ExtractionReviewStep`'s `onConfirm` gains a third parameter — `onConfirm: (originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) => void` — consumed by Task 3's `Wizard.tsx` POST body.

- [ ] **Step 1: Read the current files**

Read `components/wizard/ExtractionReviewStep.tsx` and `components/wizard/Wizard.tsx` in full — this task replaces the origin-process `Card` block in the former and updates the latter's `handleConfirmOrigin` call site to accept the new third argument.

- [ ] **Step 2: Replace the origin-process block in `ExtractionReviewStep.tsx`**

Add the import at the top of the file:

```typescript
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
```

Add new state (alongside the existing `originProcess`/`editedMetadata` state):

```typescript
const [isCustomOrigin, setIsCustomOrigin] = useState(false);
const [customChapter, setCustomChapter] = useState("");
```

Replace the entire origin-process `<Card>` block (the one containing the `<label htmlFor="origin-process">`/`<input id="origin-process">` pair) with:

```tsx
<Card>
  <Card.Content className="py-6 flex flex-col gap-2">
    <label htmlFor="origin-process" className="text-sm font-medium text-forest">
      Origin / process <span className="text-danger">*</span>
    </label>
    <p className="text-xs text-black/60">
      Never present in a lab report — required to select the correct EAL chapter. This is never guessed.
    </p>
    <input
      id="origin-process"
      list="origin-process-options"
      type="text"
      value={originProcess}
      onChange={e => {
        const value = e.target.value;
        setOriginProcess(value);
        const matched = ORIGIN_OPTIONS.find(o => o.value === value || o.label === value);
        if (matched) {
          setOriginProcess(matched.value);
          setIsCustomOrigin(false);
        } else if (value.trim() !== "" && !ORIGIN_OPTIONS.some(o => o.label === value)) {
          setIsCustomOrigin(true);
        } else {
          setIsCustomOrigin(false);
        }
      }}
      placeholder="Type to search, or enter your own…"
      className="border border-black/10 rounded-lg px-3 py-2 text-sm"
    />
    <datalist id="origin-process-options">
      {ORIGIN_OPTIONS.map(option => (
        <option key={option.value} value={option.label}>
          {option.label} — {option.chapter.slice(0, 2)} {option.chapter.slice(2)}
        </option>
      ))}
    </datalist>

    {isCustomOrigin && (
      <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-black/10">
        <label htmlFor="custom-chapter" className="text-xs font-medium text-forest">
          Which EAL chapter does this belong to? <span className="text-danger">*</span>
        </label>
        <p className="text-xs text-black/60">
          A custom description needs an explicit chapter — this is never guessed either.
        </p>
        <select
          id="custom-chapter"
          value={customChapter}
          onChange={e => setCustomChapter(e.target.value)}
          className="border border-black/10 rounded-lg px-2 py-1 text-sm"
        >
          <option value="">— select a chapter —</option>
          {ORIGIN_OPTIONS.map(option => (
            <option key={option.chapter} value={option.chapter}>
              {option.label} — {option.chapter.slice(0, 2)} {option.chapter.slice(2)}
            </option>
          ))}
        </select>
      </div>
    )}
  </Card.Content>
</Card>
```

Note: since the dropdown's `<option>` display text includes both label and code (`"Excavated soil or rock — 17 05"`), but the `<input>`'s `onChange` needs to detect a match against the plain label to auto-select the matching option's `value`, the matching logic above checks `o.label === value` (what the datalist shows/what gets filled into the input when a suggestion is picked) as well as `o.value === value` (in case a caller ever sets it directly) — this keeps the actual submitted `originProcess` as the clean backend key (`"escavo terre e rocce"`) rather than the display string with the code appended, even though the visible input text will briefly show the label-only string when a user picks a suggestion (browsers fill `<input>` from `<option value>`, which is set to `option.label` here, not the code-appended display text — verify this actually behaves as expected in the browser during Step 4's manual check, since `<datalist>` display-vs-value behavior has minor differences across browsers).

- [ ] **Step 3: Update the Classify button's `onConfirm` call and disabled logic**

In the same file, update the `Button`'s `onPress` and `isDisabled`:

```tsx
<Button
  variant="primary"
  onPress={() => onConfirm(originProcess.trim(), editedMetadata, isCustomOrigin ? customChapter : null)}
  isDisabled={originProcess.trim() === "" || (isCustomOrigin && customChapter === "")}
  className="self-start"
>
  Classify
</Button>
```

Update the component's prop type declaration:

```typescript
onConfirm: (originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) => void;
```

- [ ] **Step 4: Update `Wizard.tsx`'s call site**

Read `Wizard.tsx`'s `handleConfirmOrigin` function. Update its signature to accept the third parameter and pass it through (Task 3 wires it into the actual POST body — for this task, just update the signature and prop-passing so the build compiles; if `handleConfirmOrigin` doesn't yet send `customChapter` in its fetch body, that's fine, Task 3 adds it):

```typescript
async function handleConfirmOrigin(originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) {
  // existing body — Task 3 will add customChapter to the POST payload here
}
```

Update the `<ExtractionReviewStep onConfirm={handleConfirmOrigin} .../>` call to match (it likely already just passes the function reference, so no change needed there beyond the function's own signature).

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean — this task only changes UI/prop signatures, no new test file, and Task 1's test should already be passing from the prior commit.

- [ ] **Step 6: Manual check of the datalist behavior**

With the local dev server running (`http://localhost:3000`), open the app, get to the Extraction review step (upload any sample, or reuse a previous session if the wizard state allows), and confirm: typing in the origin-process field shows filtered suggestions displaying "Label — Code", selecting one fills the field, and typing something that doesn't match any option reveals the custom-chapter picker. Note in your commit message or report if the datalist's display-vs-value behavior didn't match what Step 2's code intends (per that step's own disclosed uncertainty) — if so, adjust the `<option value=...>` to fix it before committing.

- [ ] **Step 7: Commit**

```bash
git add components/wizard/ExtractionReviewStep.tsx components/wizard/Wizard.tsx
git commit -m "feat: replace origin-process free-text input with searchable dropdown + custom-entry fallback"
```

---

### Task 3: Request-scoped custom-chapter merge in the API route

**Files:**
- Modify: `components/wizard/Wizard.tsx` (finish wiring `customChapter` into the POST body)
- Modify: `app/api/classify/route.ts`
- Test: `tests/hp-classification/origin-options.test.ts` (extend, or check if a route-level test file should be created — see Step 1)

**Interfaces:**
- Consumes: `customChapter: string | null` (Task 2), `ORIGIN_TO_CHAPTER_LOOKUP` (existing constant in `app/api/classify/route.ts`).

- [ ] **Step 1: Read the current files**

Read `app/api/classify/route.ts` in full to find the exact current `ORIGIN_TO_CHAPTER_LOOKUP` declaration and POST handler body. Check whether this repo has any existing test file directly testing `app/api/classify/route.ts` (search `tests/` — per this project's established finding in an earlier slice, it likely does not, since Next.js API routes aren't unit-tested directly here). If none exists, the merge-logic test in this task instead targets a small extracted pure function (see Step 3) rather than the route handler itself, keeping with this repo's existing no-route-level-tests pattern.

- [ ] **Step 2: Finish wiring `customChapter` through `Wizard.tsx`**

In `Wizard.tsx`'s `handleConfirmOrigin` (from Task 2 Step 4), add `customChapter` to the POST body:

```typescript
async function handleConfirmOrigin(originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) {
  if (!extraction) return;
  setError(null);
  setClassifying(true);
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: { ...extraction.metadata, ...editedMetadata, originProcess },
        results: extraction.results,
        testResults: extraction.testResults,
        customChapter,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Classification failed");
      return;
    }
    setClassificationResult({ hazard: body.hazard, eal: body.eal, noDataWarning: Boolean(body.noDataWarning) });
    setStep("results");
  } catch {
    setError("Could not reach the classification service.");
  } finally {
    setClassifying(false);
  }
}
```

(Match this against the file's actual current body first — only the `customChapter` field in the `JSON.stringify(...)` call and the function signature are new; keep everything else — error handling, `noDataWarning`, etc. — exactly as it currently is.)

- [ ] **Step 3: Add a pure merge helper and use it in the route**

In `lib/hp-classification/origin-options.ts` (from Task 1), add a small pure function:

```typescript
// Merges a request-scoped custom origin->chapter mapping into a base lookup, WITHOUT
// mutating the base object — each request gets its own merged copy, so a custom entry
// from one submission never leaks into another request's lookup.
export function withCustomOrigin(
  baseLookup: Record<string, string>,
  originProcess: string | null,
  customChapter: string | null
): Record<string, string> {
  if (!originProcess || !customChapter) return baseLookup;
  return { ...baseLookup, [originProcess]: customChapter };
}
```

Add a test to `tests/hp-classification/origin-options.test.ts`:

```typescript
import { withCustomOrigin } from "@/lib/hp-classification/origin-options";

describe("withCustomOrigin", () => {
  it("merges a custom origin/chapter pair into a copy of the base lookup", () => {
    const base = { "escavo terre e rocce": "1705" };
    const merged = withCustomOrigin(base, "demolished retaining wall", "1701");
    expect(merged).toEqual({ "escavo terre e rocce": "1705", "demolished retaining wall": "1701" });
  });

  it("does not mutate the base lookup object", () => {
    const base = { "escavo terre e rocce": "1705" };
    withCustomOrigin(base, "demolished retaining wall", "1701");
    expect(base).toEqual({ "escavo terre e rocce": "1705" });
  });

  it("returns the base lookup unchanged when no custom chapter is provided", () => {
    const base = { "escavo terre e rocce": "1705" };
    expect(withCustomOrigin(base, "demolished retaining wall", null)).toBe(base);
  });

  it("returns the base lookup unchanged when originProcess is null", () => {
    const base = { "escavo terre e rocce": "1705" };
    expect(withCustomOrigin(base, null, "1701")).toBe(base);
  });
});
```

Run: `npx vitest run tests/hp-classification/origin-options.test.ts` — expect this to FAIL first (function doesn't exist yet) before you add the implementation above, then PASS after (8/8 total in this file, combining Task 1's 4 tests with these 4).

In `app/api/classify/route.ts`, import `withCustomOrigin` and use it:

```typescript
import { withCustomOrigin } from "@/lib/hp-classification/classify-sample"; // adjust import path to wherever origin-options.ts actually lives relative to this file
```

(Use the correct relative/alias import path — `@/lib/hp-classification/origin-options`, matching this file's existing import style for other `lib/hp-classification/*` modules.)

Update the POST handler to read `customChapter` from the body and pass the merged lookup to `classifySample`:

```typescript
const { metadata, results, testResults, customChapter } = body as {
  metadata?: SampleMetadata;
  results?: SampleResult[];
  testResults?: TestResult[];
  customChapter?: string | null;
};

// ... existing validation stays the same ...

const effectiveLookup = withCustomOrigin(ORIGIN_TO_CHAPTER_LOOKUP, metadata.originProcess, customChapter ?? null);

const { hazard, eal, noDataWarning } = classifySample(
  metadata,
  results,
  testResults ?? [],
  analyteReferenceRaw as AnalyteReference[],
  elementCompoundForms as ElementCompoundForm[],
  effectiveLookup
);
```

(Adjust to match the route's actual current variable names and structure — read it first, this shows the shape of the change, not necessarily every surrounding line verbatim.)

Also expand `ORIGIN_TO_CHAPTER_LOOKUP` itself to include all 8 real entries from `ORIGIN_OPTIONS`, instead of just the one hardcoded "escavo terre e rocce" entry — build it directly from the data module so it can never drift from the dropdown's own options:

```typescript
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";

const ORIGIN_TO_CHAPTER_LOOKUP: Record<string, string> = Object.fromEntries(
  ORIGIN_OPTIONS.map(o => [o.value, o.chapter])
);
```

(Remove the old hardcoded `{ "escavo terre e rocce": "1705" }` object literal, replacing it with this derived version.)

- [ ] **Step 4: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean, `origin-options.test.ts` now has 8 total tests passing.

- [ ] **Step 5: Manual verification**

With the local dev server running, walk through the full flow once for a built-in dropdown selection (pick "Excavated soil or rock" — should resolve exactly as before) and once for a custom entry (type something not in the list, pick a chapter from the fallback picker, confirm classification still succeeds and produces a real EAL code from that chapter).

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/origin-options.ts tests/hp-classification/origin-options.test.ts app/api/classify/route.ts components/wizard/Wizard.tsx
git commit -m "feat: wire custom origin-process entries into the EAL chapter lookup, request-scoped only"
```

---

## Self-Review Notes

- **Spec coverage:** expanded lookup table with real chapter-17 data → Task 1. Searchable dropdown UI + custom fallback → Task 2. Request-scoped merge (no persistence, no base-object mutation) → Task 3.
- **Placeholder scan:** no TBD/TODO. The disclosed uncertainty in Task 2 Step 2 (datalist display-vs-value browser behavior) is a genuine, bounded thing to verify manually, not a glossed-over gap — Step 6 of the same task directs the implementer to check and fix it before committing if it doesn't behave as intended.
- **Type consistency:** `OriginOption` (Task 1) is used identically in Task 2's dropdown rendering and Task 3's `ORIGIN_TO_CHAPTER_LOOKUP` derivation. `onConfirm`'s third parameter (`customChapter: string | null`) is introduced in Task 2 and consumed with the same type in Task 3's `Wizard.tsx` wiring and `withCustomOrigin`'s signature.
