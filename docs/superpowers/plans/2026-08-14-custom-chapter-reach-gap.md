# Custom Chapter Reach Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the custom-chapter fallback (shown when a user's origin process doesn't match any curated `ORIGIN_OPTIONS` entry) reach all 20 real EAL chapters, not just the 7 chapters `ORIGIN_OPTIONS` happens to curate — both in the UI dropdown and in the server-side validation that currently rejects any chapter outside that same 7-chapter set.

**Architecture:** Add a new static, real, sourced constant `EAL_CHAPTERS` (20 entries: 2-digit chapter code + real English title, transcribed from `lib/data/eal-koder-full.json`'s `nivaa: 1` entries) to `lib/hp-classification/origin-options.ts`, alongside the existing `ORIGIN_OPTIONS`. Swap the fallback `<select>` in `components/wizard/ExtractionReviewStep.tsx` and the server-side chapter check in `app/api/classify/route.ts` to validate against `EAL_CHAPTERS` instead of `ORIGIN_OPTIONS`. Nothing else changes — the primary type-ahead, `withCustomOrigin`, `deriveOriginFromLabCode`, and `suggestOriginProcess` are all untouched.

**Tech Stack:** TypeScript, Next.js App Router (route handlers), React, Vitest.

## Global Constraints

- `EAL_CHAPTERS` must have exactly 20 entries, one per real EAL top-level chapter, codes `"01"`–`"20"` in ascending string order.
- Every `EAL_CHAPTERS[i].label` must be the exact, real, verified `beskrivelseEn` string from `lib/data/eal-koder-full.json`'s corresponding `nivaa: 1` entry — no paraphrasing, no truncation, no fabrication.
- `ORIGIN_OPTIONS`, `withCustomOrigin`, `deriveOriginFromLabCode`, and `suggestOriginProcess` are not modified by this plan.
- The primary origin-process type-ahead `<datalist>` in `ExtractionReviewStep.tsx` (built from `ORIGIN_OPTIONS`) is not modified by this plan — only the custom-chapter fallback `<select>` changes.

---

### Task 1: Add the real `EAL_CHAPTERS` constant and its tests

**Files:**
- Modify: `lib/hp-classification/origin-options.ts`
- Test: `tests/hp-classification/origin-options.test.ts`

**Interfaces:**
- Produces: `export interface EalChapter { chapter: string; label: string; }` and `export const EAL_CHAPTERS: EalChapter[]` from `lib/hp-classification/origin-options.ts` — Task 2 and Task 3 both import this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hp-classification/origin-options.test.ts` (the file already imports `ealKoderFull from "@/lib/data/eal-koder-full.json"` at the top — reuse that import; add `EAL_CHAPTERS` to the existing `origin-options` import on line 2):

```ts
import { ORIGIN_OPTIONS, withCustomOrigin, deriveOriginFromLabCode, suggestOriginProcess, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";
```

Add a new `describe` block at the end of the file:

```ts
describe("EAL_CHAPTERS", () => {
  it("has exactly 20 entries with chapter codes 01 through 20 in order", () => {
    expect(EAL_CHAPTERS).toHaveLength(20);
    expect(EAL_CHAPTERS.map(c => c.chapter)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"))
    );
  });

  it("every label matches the real eal-koder-full.json nivaa:1 beskrivelseEn for that chapter", () => {
    const ealKoder = ealKoderFull as { nivaa: number; kode: string; beskrivelseEn: string | null }[];
    for (const c of EAL_CHAPTERS) {
      const realEntry = ealKoder.find(e => e.nivaa === 1 && e.kode === c.chapter);
      expect(realEntry, `chapter ${c.chapter} not found as a nivaa:1 entry`).toBeDefined();
      expect(c.label).toBe(realEntry!.beskrivelseEn);
    }
  });

  it("covers every chapter ORIGIN_OPTIONS references, since the curated set must be a subset of the real catalogue", () => {
    const curatedChapters = new Set(ORIGIN_OPTIONS.map(o => o.chapter.slice(0, 2)));
    const fullChapters = new Set(EAL_CHAPTERS.map(c => c.chapter));
    for (const ch of curatedChapters) {
      expect(fullChapters.has(ch), `curated chapter ${ch} missing from EAL_CHAPTERS`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/origin-options.test.ts`
Expected: FAIL — `EAL_CHAPTERS` is not exported from `lib/hp-classification/origin-options.ts`.

- [ ] **Step 3: Add the real constant**

Add this to `lib/hp-classification/origin-options.ts`, after the existing `ORIGIN_OPTIONS` array closes (after its closing `];` and before the `withCustomOrigin` function):

```ts
// All 20 real EAL top-level chapters, with their real English titles — transcribed from
// lib/data/eal-koder-full.json's nivaa:1 entries (all 20 have a real, non-gap beskrivelseEn;
// verified during this feature's design). Used only by the custom-chapter fallback below: when
// a user's origin process doesn't match any curated ORIGIN_OPTIONS entry, they still need to be
// able to place their sample in *some* real EAL chapter for manual review, and ORIGIN_OPTIONS
// only covers 7 of these 20 chapters. This constant is intentionally chapter-level (2-digit),
// not sub-chapter-level like ORIGIN_OPTIONS — assignEalCode already does the fine-grained work
// of picking among a chapter's real leaf codes (see eal.ts).
export interface EalChapter {
  chapter: string; // 2-digit EAL chapter code, e.g. "05"
  label: string;   // real English chapter title, sourced from eal-koder-full.json's nivaa:1 beskrivelseEn
}

export const EAL_CHAPTERS: EalChapter[] = [
  { chapter: "01", label: "Wastes resulting from exploration, Mining, Quarrying, Physical and Chemical treatment of Minerals" },
  { chapter: "02", label: "Wastes from Agriculture, Horticulture, Aquaculture, Forestry, Hunting and Fishing, Food Preparation and Processing" },
  { chapter: "03", label: "Wastes from Wood Processing and the Production of Panels and Furniture, Pulp, Paper and Cardboard" },
  { chapter: "04", label: "Wastes from the Leather, Fur and Textile Industries" },
  { chapter: "05", label: "Wastes from the Petroleum Refining, Natural Gas Purification and Pyrolitic Treatment of Coal" },
  { chapter: "06", label: "Wastes from Inorganic Chemical Processes" },
  { chapter: "07", label: "Wastes from Organic Chemical Processes" },
  { chapter: "08", label: "Wastes from the MFSU of Coatings (Paints, Varnishes and Vitreous Enamels), Adhesives, Sealants and Printing Inks" },
  { chapter: "09", label: "Wastes from the Photographic Industry" },
  { chapter: "10", label: "Waste From Thermal Processes" },
  { chapter: "11", label: "Wastes from Chemical Surface Treatment and Coating of Metals and Other Materials, Non- Ferrous HydroMetallurgy" },
  { chapter: "12", label: "Wastes from Shaping and Physical and Mechanical Surface Treatment of Metals and Plastics" },
  { chapter: "13", label: "Oil Wastes and Wastes of Liquid Fuels (except edible oils and those in chapters 05,12 and 19)" },
  { chapter: "14", label: "Waste Organic Solvents, Refrigerants and Propellants (except 07 and 08)" },
  { chapter: "15", label: "Waste Packaging, Absorbents, Wiping Cloths, Filter Materials and Protective Clothing Not Otherwise Specified" },
  { chapter: "16", label: "Wastes Not Otherwise Specified in the List" },
  { chapter: "17", label: "Construction and Demolition Wastes (including Excavated Soil from Contaminated Sites)" },
  { chapter: "18", label: "Wastes From Human or Animal Health Care and/or Related Research (except kitchen wastes not arising from immediate health care)" },
  { chapter: "19", label: "Wastes from Waste Management Facilities, Off-Site Waste Water Treatment Plants and the Preparation of Water for Human Consumption and Water for Industrial Use" },
  { chapter: "20", label: "Municipal Wastes (Household Waste and Similar Commercial, Industrial and Institutional Wastes) Including Separately Collected Fractions" },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/origin-options.test.ts`
Expected: PASS — all tests in the file, including the 3 new ones, pass.

- [ ] **Step 5: Commit**

```bash
git add lib/hp-classification/origin-options.ts tests/hp-classification/origin-options.test.ts
git commit -m "feat: add real EAL_CHAPTERS constant covering all 20 EAL top-level chapters"
```

---

### Task 2: Widen the custom-chapter fallback dropdown to use `EAL_CHAPTERS`

**Files:**
- Modify: `components/wizard/ExtractionReviewStep.tsx`

**Interfaces:**
- Consumes: `EAL_CHAPTERS` (`{ chapter: string; label: string }[]`) from `lib/hp-classification/origin-options.ts` (Task 1).

This component has no existing test file in the repo (no `tests/wizard/extraction-review-step.test.ts` or similar exists today — `tests/wizard/rotating-loading-message.test.ts` is the only wizard-component test and covers a different, non-interactive component). Adding a full React component test harness is out of scope for this plan; Task 3's API-route tests exercise the same `EAL_CHAPTERS` validation logic this component depends on, and the change here is a mechanical one-line data-source swap. Verify this task manually per Step 3 below instead of adding a new test file.

- [ ] **Step 1: Read the current custom-chapter select block**

The current block (`components/wizard/ExtractionReviewStep.tsx`, inside the `isCustomOrigin &&` conditional) is:

```tsx
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
```

Note this currently renders `ORIGIN_OPTIONS` (25 entries, some sharing the same first-2-digit chapter — e.g. both `1701` and `1705` render as separate options here, which is itself part of the bug: the fallback shows 25 sub-chapter rows instead of a clean list of 20 chapters, several of them duplicating the same top-level chapter under different labels).

- [ ] **Step 2: Replace the select block to render `EAL_CHAPTERS`**

Replace the block from Step 1 with:

```tsx
              <select
                id="custom-chapter"
                value={customChapter}
                onChange={e => setCustomChapter(e.target.value)}
                className="border border-black/10 rounded-lg px-2 py-1 text-sm"
              >
                <option value="">— select a chapter —</option>
                {EAL_CHAPTERS.map(chapter => (
                  <option key={chapter.chapter} value={chapter.chapter}>
                    {chapter.chapter} — {chapter.label}
                  </option>
                ))}
              </select>
```

Note the option `value` is now a 2-digit chapter code (e.g. `"05"`), not a 4-digit sub-chapter code — this matches `EAL_CHAPTERS.chapter`'s shape and is what gets passed as `customChapter` to `onConfirm`, then to the API route.

- [ ] **Step 3: Update the import**

Change the top-of-file import (currently):

```tsx
import { ORIGIN_OPTIONS, suggestOriginProcess } from "@/lib/hp-classification/origin-options";
```

to:

```tsx
import { ORIGIN_OPTIONS, suggestOriginProcess, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";
```

`ORIGIN_OPTIONS` stays imported and used elsewhere in the file (the primary type-ahead datalist) — only the fallback select's data source changes.

- [ ] **Step 4: Verify manually**

Run the dev server (`npm run dev`) and in the wizard's extraction-review step, type an origin process that matches nothing in `ORIGIN_OPTIONS` (e.g. "test origin xyz"). Confirm the custom-chapter dropdown now shows exactly 20 options, each starting with a 2-digit chapter code (`01` through `20`) followed by its real English title, with no duplicate chapter numbers.

- [ ] **Step 5: Commit**

```bash
git add components/wizard/ExtractionReviewStep.tsx
git commit -m "feat: widen custom-chapter fallback dropdown to all 20 real EAL chapters"
```

---

### Task 3: Widen server-side custom-chapter validation and add API-route tests

**Files:**
- Modify: `app/api/classify/route.ts`
- Test: `tests/hp-classification/classify-route.test.ts` (new file)

**Interfaces:**
- Consumes: `EAL_CHAPTERS` from `lib/hp-classification/origin-options.ts` (Task 1); `POST` handler exported from `app/api/classify/route.ts` (existing).

- [ ] **Step 1: Write the failing tests**

Create `tests/hp-classification/classify-route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/classify/route";

const baseMetadata = {
  sampleId: "t", externalReportNo: "t", labName: "t", customerName: "t", sampleMarking: "t",
  matrixType: "jord", samplingDate: null, receiptDate: null, originProcess: "a genuinely novel origin process",
  producerName: null, physicalState: "solid" as const, viscosity40cMm2s: null, ph: null,
  labClassificationGiven: false, labStatedEalCode: null,
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/classify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/classify — customChapter validation", () => {
  it("accepts a real chapter outside the 7 curated ORIGIN_OPTIONS chapters (e.g. 05, petroleum refining)", async () => {
    const response = await POST(postRequest({ metadata: baseMetadata, results: [], customChapter: "05" }));
    expect(response.status).toBe(200);
  });

  it("still rejects a chapter code that isn't a real EAL chapter", async () => {
    const response = await POST(postRequest({ metadata: baseMetadata, results: [], customChapter: "99" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid chapter code");
  });

  it("accepts the 2-digit chapter code for a chapter ORIGIN_OPTIONS already curates at the sub-chapter level (e.g. 17)", async () => {
    // Verified empirically before writing this plan: the CURRENT code only ever validates
    // against ORIGIN_OPTIONS' 4-digit sub-chapter codes (e.g. "1701", "1705"), so a bare 2-digit
    // "17" is REJECTED today (400), even though chapter 17 is fully curated. This is the same
    // reach gap, just visible from a different angle: even a curated chapter is unreachable via
    // its own 2-digit code. After this task's fix, "17" is accepted because EAL_CHAPTERS has a
    // "17" entry.
    const response = await POST(postRequest({ metadata: baseMetadata, results: [], customChapter: "17" }));
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify the first two fail**

Run: `npx vitest run tests/hp-classification/classify-route.test.ts`
Expected: the first test (`customChapter: "05"`) and the third test (`customChapter: "17"`) both FAIL with status 400 — verified empirically: the current code's `ORIGIN_OPTIONS.some(o => o.chapter === customChapter)` check only matches 4-digit codes (`"1701"`, `"1705"`, etc.), so neither a real-but-uncurated 2-digit chapter (`"05"`) nor a real, curated chapter's bare 2-digit form (`"17"`) is accepted today. Only the second test (`customChapter: "99"`, a nonexistent chapter) already passes, since `"99"` is invalid under any interpretation.

- [ ] **Step 3: Update the validation and import**

In `app/api/classify/route.ts`, change the import (currently):

```ts
import { ORIGIN_OPTIONS, withCustomOrigin } from "@/lib/hp-classification/origin-options";
```

to:

```ts
import { ORIGIN_OPTIONS, withCustomOrigin, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";
```

Then change the validation block (currently):

```ts
  if (customChapter !== undefined && customChapter !== null) {
    const isValidChapter = ORIGIN_OPTIONS.some(o => o.chapter === customChapter);
    if (!isValidChapter) {
      return NextResponse.json({ error: "Invalid chapter code" }, { status: 400 });
    }
  }
```

to:

```ts
  if (customChapter !== undefined && customChapter !== null) {
    const isValidChapter = EAL_CHAPTERS.some(c => c.chapter === customChapter);
    if (!isValidChapter) {
      return NextResponse.json({ error: "Invalid chapter code" }, { status: 400 });
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/classify-route.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Run the full test suite and build**

Run: `npx vitest run`
Expected: all test files pass, including the pre-existing ones (this confirms `withCustomOrigin` and `ORIGIN_TO_CHAPTER_LOOKUP`, both untouched, still behave correctly with the new validation).

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add app/api/classify/route.ts tests/hp-classification/classify-route.test.ts
git commit -m "feat: validate customChapter against all 20 real EAL chapters, not just curated ORIGIN_OPTIONS"
```
