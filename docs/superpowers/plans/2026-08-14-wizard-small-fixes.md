# Wizard Small Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three small, independent issues in the classification wizard: a duplicate-React-key crash in the multi-sample picker, a missing "powder" physical-state option, and HP1-15 screening not showing which real chemicals triggered each hazard.

**Architecture:** Each fix is self-contained: (1) a new pure function `disambiguateSamples` in `lib/wizard/disambiguate-samples.ts` used by `SampleSelectionStep.tsx`, tested independently of any component-test harness; (2) a type-only extension of the `physicalState` union across 4 files, verified to need no new hazard-logic branch; (3) a new `triggeringSubstancesByHp` field on `HazardClassification`, populated inside `classifyHazard` (`hazard.ts`) and surfaced in `ClassificationResultsStep.tsx`.

**Tech Stack:** TypeScript, Next.js App Router, React, Vitest.

## Global Constraints

- Fix 1: the *value* passed to `/api/extract-sample` (`sampleIdentifier`) must never be altered — only the *displayed* label may gain a `" (N)"` disambiguating suffix.
- Fix 2: `"powder"` must behave identically to `"solid"` for all existing hazard logic — no new classification rule.
- Fix 3: `triggeringSubstancesByHp` gets a key only for an HP that is (a) triggered (`true`) and (b) substance-attributable (HP4, HP5, HP6, HP7, HP8, HP10, HP11, HP13, HP14) — never an empty array, never a key for test-based or case-specific HPs (HP1-3, HP9, HP12, HP15).
- All three fixes were empirically pre-verified against this exact repo before this plan was finalized (code applied directly, full suite + build run, then reverted to clean baseline) — the code in every step below is final, not a draft.

---

### Task 1: Fix duplicate-key crash in the sample picker

**Files:**
- Create: `lib/wizard/disambiguate-samples.ts`
- Create: `tests/wizard/disambiguate-samples.test.ts`
- Modify: `components/wizard/SampleSelectionStep.tsx`

**Interfaces:**
- Produces: `export interface DetectedSample { sampleIdentifier: string; matrixType: string | null; }`, `export interface DisambiguatedSample extends DetectedSample { displayLabel: string; }`, `export function disambiguateSamples(samples: DetectedSample[]): DisambiguatedSample[]` from `lib/wizard/disambiguate-samples.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/wizard/disambiguate-samples.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { disambiguateSamples } from "@/lib/wizard/disambiguate-samples";

describe("disambiguateSamples", () => {
  it("adds no suffix when every sampleIdentifier is unique", () => {
    const result = disambiguateSamples([
      { sampleIdentifier: "A-1", matrixType: "jord" },
      { sampleIdentifier: "A-2", matrixType: "vann" },
    ]);
    expect(result[0].displayLabel).toBe("A-1 — jord");
    expect(result[1].displayLabel).toBe("A-2 — vann");
  });

  it("appends a distinguishing (N) suffix when two samples share an identifier, without changing sampleIdentifier", () => {
    const result = disambiguateSamples([
      { sampleIdentifier: "nitrati", matrixType: null },
      { sampleIdentifier: "nitrati", matrixType: null },
    ]);
    expect(result[0].displayLabel).toBe("nitrati (1)");
    expect(result[1].displayLabel).toBe("nitrati (2)");
    expect(result[0].sampleIdentifier).toBe("nitrati");
    expect(result[1].sampleIdentifier).toBe("nitrati");
  });

  it("only disambiguates identifiers that actually repeat", () => {
    const result = disambiguateSamples([
      { sampleIdentifier: "nitrati", matrixType: null },
      { sampleIdentifier: "nitrati", matrixType: null },
      { sampleIdentifier: "unique-id", matrixType: "jord" },
    ]);
    expect(result[2].displayLabel).toBe("unique-id — jord");
  });

  it("returns an empty array for an empty input", () => {
    expect(disambiguateSamples([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/wizard/disambiguate-samples.test.ts`
Expected: FAIL — `lib/wizard/disambiguate-samples.ts` doesn't exist yet.

- [ ] **Step 3: Create the pure function**

Create `lib/wizard/disambiguate-samples.ts`:

```ts
export interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export interface DisambiguatedSample extends DetectedSample {
  displayLabel: string;
}

// Real documents occasionally produce two detected samples sharing one sampleIdentifier —
// extraction's multi-sample detection prompt asks the LLM for a unique identifier per sample,
// but cannot guarantee it against a messy or ambiguous real source document. Appends a "(N)"
// suffix to the DISPLAYED label only when an identifier repeats; sampleIdentifier itself is
// never touched, since /api/extract-sample still needs the real, unmodified value.
export function disambiguateSamples(samples: DetectedSample[]): DisambiguatedSample[] {
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.sampleIdentifier, (counts.get(s.sampleIdentifier) ?? 0) + 1);

  const seen = new Map<string, number>();
  return samples.map(s => {
    const total = counts.get(s.sampleIdentifier)!;
    if (total <= 1) {
      return { ...s, displayLabel: s.matrixType ? `${s.sampleIdentifier} — ${s.matrixType}` : s.sampleIdentifier };
    }
    const occurrence = (seen.get(s.sampleIdentifier) ?? 0) + 1;
    seen.set(s.sampleIdentifier, occurrence);
    const base = `${s.sampleIdentifier} (${occurrence})`;
    return { ...s, displayLabel: s.matrixType ? `${base} — ${s.matrixType}` : base };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/wizard/disambiguate-samples.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Wire it into `SampleSelectionStep.tsx`**

The current file is:

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";

interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export function SampleSelectionStep({ samples, file, onSelected, onError }: {
  samples: DetectedSample[];
  file: File;
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) => void;
  onError: (message: string) => void;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function handlePick(sampleIdentifier: string) {
    setLoadingId(sampleIdentifier);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sampleIdentifier", sampleIdentifier);

    try {
      const res = await fetch("/api/extract-sample", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Extraction failed");
        return;
      }
      onSelected(body.data);
    } catch {
      onError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col gap-4 py-6">
        <p className="text-sm font-medium text-forest">This document contains multiple samples</p>
        <p className="text-xs text-black/60">Choose which one to classify:</p>
        <div className="flex flex-col gap-2">
          {samples.map(sample => (
            <Button
              key={sample.sampleIdentifier}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier)}
              isDisabled={loadingId !== null}
              className="justify-start"
            >
              {loadingId === sample.sampleIdentifier
                ? "Extracting…"
                : `${sample.sampleIdentifier}${sample.matrixType ? ` — ${sample.matrixType}` : ""}`}
            </Button>
          ))}
        </div>
        {loadingId !== null && <RotatingLoadingMessage />}
      </Card.Content>
    </Card>
  );
}
```

Note the pre-existing `loadingId` state is ALSO keyed by `sampleIdentifier` — if two samples share
an identifier, clicking one would show "Extracting…" on BOTH duplicate buttons simultaneously.
Fix this alongside the key fix by tracking the loading state by array index instead.

Replace the entire file with:

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";
import { disambiguateSamples, type DetectedSample } from "@/lib/wizard/disambiguate-samples";

export function SampleSelectionStep({ samples, file, onSelected, onError }: {
  samples: DetectedSample[];
  file: File;
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) => void;
  onError: (message: string) => void;
}) {
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const displaySamples = disambiguateSamples(samples);

  async function handlePick(sampleIdentifier: string, index: number) {
    setLoadingIndex(index);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sampleIdentifier", sampleIdentifier);

    try {
      const res = await fetch("/api/extract-sample", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Extraction failed");
        return;
      }
      onSelected(body.data);
    } catch {
      onError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setLoadingIndex(null);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col gap-4 py-6">
        <p className="text-sm font-medium text-forest">This document contains multiple samples</p>
        <p className="text-xs text-black/60">Choose which one to classify:</p>
        <div className="flex flex-col gap-2">
          {displaySamples.map((sample, i) => (
            <Button
              key={i}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier, i)}
              isDisabled={loadingIndex !== null}
              className="justify-start"
            >
              {loadingIndex === i ? "Extracting…" : sample.displayLabel}
            </Button>
          ))}
        </div>
        {loadingIndex !== null && <RotatingLoadingMessage />}
      </Card.Content>
    </Card>
  );
}
```

- [ ] **Step 6: Verify with a build**

Run: `npm run build`
Expected: compiles successfully — confirms `SampleSelectionStep.tsx`'s new import and prop usage
type-check cleanly, and confirms nothing else in the codebase imported the old locally-scoped
`DetectedSample` interface from this file (it wasn't exported before, so nothing could have).

- [ ] **Step 7: Commit**

```bash
git add lib/wizard/disambiguate-samples.ts tests/wizard/disambiguate-samples.test.ts components/wizard/SampleSelectionStep.tsx
git commit -m "fix: prevent duplicate-key crash in multi-sample picker, disambiguate shared identifiers"
```

---

### Task 2: Add "powder" as a physical state

**Files:**
- Modify: `lib/hp-classification/types.ts`
- Modify: `lib/hp-classification/extract.ts`
- Modify: `components/wizard/Wizard.tsx`
- Modify: `components/wizard/ExtractionReviewStep.tsx`
- Test: `tests/hp-classification/hazard.test.ts`

**Interfaces:**
- Consumes: none from other tasks.
- Produces: `SampleMetadata.physicalState: "solid" | "liquid" | "powder"` — Task 3 does not need to know about this since it only reads `metadata.physicalState === "liquid"`, which is unaffected by adding a third value.

- [ ] **Step 1: Write the failing test**

Add to `tests/hp-classification/hazard.test.ts`, inside the existing `describe("classifyHazard", ...)`
block (anywhere among the other `it(...)` calls — e.g. right after the existing "HP5 Asp. Tox. 1
never triggers for a solid" test):

```ts
  it("HP5 Asp. Tox. 1 never triggers for a powder either, same as solid, regardless of concentration", () => {
    const powderMetadata: SampleMetadata = { ...solidMetadata, physicalState: "powder" };
    const results: NormalizedResultWithClp[] = [
      { substanceName: "high-h304", resultPct: 50, hStatement: "H304", hazardClass: "Asp. Tox. 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, powderMetadata, []);
    expect(result.resultsByHp.HP5).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hp-classification/hazard.test.ts`
Expected: FAIL — TypeScript error, `"powder"` is not assignable to `SampleMetadata["physicalState"]`
(currently `"solid" | "liquid"`).

- [ ] **Step 3: Extend the type in `types.ts`**

In `lib/hp-classification/types.ts`, change:

```ts
  physicalState: "solid" | "liquid";
```

to:

```ts
  physicalState: "solid" | "liquid" | "powder";
```

- [ ] **Step 4: Extend the extraction schema in `extract.ts`**

In `lib/hp-classification/extract.ts`, find this line in the LLM extraction schema string:

```ts
    "physicalState": "solid" | "liquid" | null,
```

Change it to:

```ts
    "physicalState": "solid" | "liquid" | "powder" | null,
```

- [ ] **Step 5: Extend the type in `Wizard.tsx`**

In `components/wizard/Wizard.tsx`, change:

```ts
  physicalState: "solid" | "liquid" | null;
```

to:

```ts
  physicalState: "solid" | "liquid" | "powder" | null;
```

- [ ] **Step 6: Extend the type and dropdown in `ExtractionReviewStep.tsx`**

Change the `ExtractedMetadata` interface's field:

```ts
  physicalState: "solid" | "liquid" | null;
```

to:

```ts
  physicalState: "solid" | "liquid" | "powder" | null;
```

Then find the physical-state `<select>`:

```tsx
            <select
              id="field-physical-state"
              value={editedMetadata.physicalState ?? ""}
              onChange={e => updateField("physicalState", (e.target.value || null) as "solid" | "liquid" | null)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            >
              <option value="">—</option>
              <option value="solid">solid</option>
              <option value="liquid">liquid</option>
            </select>
```

Replace it with:

```tsx
            <select
              id="field-physical-state"
              value={editedMetadata.physicalState ?? ""}
              onChange={e => updateField("physicalState", (e.target.value || null) as "solid" | "liquid" | "powder" | null)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            >
              <option value="">—</option>
              <option value="solid">solid</option>
              <option value="liquid">liquid</option>
              <option value="powder">powder</option>
            </select>
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/hp-classification/hazard.test.ts`
Expected: PASS — all tests in the file pass, including the new one.

- [ ] **Step 8: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass — confirms no other file assumed an exhaustive 2-value union.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 9: Commit**

```bash
git add lib/hp-classification/types.ts lib/hp-classification/extract.ts components/wizard/Wizard.tsx components/wizard/ExtractionReviewStep.tsx tests/hp-classification/hazard.test.ts
git commit -m "feat: add powder as a selectable physical state"
```

---

### Task 3: Show which chemicals triggered each HP

**Files:**
- Modify: `lib/hp-classification/hazard.ts`
- Modify: `components/wizard/ClassificationResultsStep.tsx`
- Test: `tests/hp-classification/hazard.test.ts`

**Interfaces:**
- Consumes: none from other tasks (independent of Tasks 1 and 2).
- Produces: `HazardClassification.triggeringSubstancesByHp: Record<string, string[]>` — no other task or file consumes this beyond `ClassificationResultsStep.tsx`, updated in this same task.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `tests/hp-classification/hazard.test.ts`:

```ts
describe("classifyHazard — triggeringSubstancesByHp", () => {
  it("HP7 lists the exact substance that triggered it", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "pentaossido di diarsenico", resultPct: 7.9, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.triggeringSubstancesByHp.HP7).toEqual(["pentaossido di diarsenico"]);
  });

  it("HP6 lists both substances in the winning category, de-duplicated", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "composti-arsenico-altro", resultPct: 5.17, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "pentaossido-diarsenico", resultPct: 7.9, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.triggeringSubstancesByHp.HP6.sort()).toEqual(["composti-arsenico-altro", "pentaossido-diarsenico"]);
  });

  it("an HP4 superseded by HP8 gets no triggering list of its own, but HP8 gets one", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "triossido-diarsenico", resultPct: 6.82, hStatement: "H314", hazardClass: "Skin Corr. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP4).toBe("superseded by HP8");
    expect(result.triggeringSubstancesByHp.HP4).toBeUndefined();
    expect(result.triggeringSubstancesByHp.HP8).toEqual(["triossido-diarsenico"]);
  });

  it("a test-driven HP8 (lab corrosion test, not substance data) gets no triggering list", () => {
    const result = classifyHazard([], solidMetadata, [
      { testName: "skin_corrosion", result: "positive", isPositive: true },
    ]);
    expect(result.resultsByHp.HP8).toBe(true);
    expect(result.triggeringSubstancesByHp.HP8).toBeUndefined();
  });

  it("untriggered and case-specific HPs have no key at all in triggeringSubstancesByHp", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(Object.keys(result.triggeringSubstancesByHp)).toEqual([]);
  });

  it("HP14 lists substances only from the specific cascade tier that fired, not every tier", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chronic1-with-mfactor", resultPct: 20, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: 1.2, mFactorAcute: null },
      { substanceName: "chronic4-substance", resultPct: 3, hStatement: "H413", hazardClass: "Aquatic Chronic 4", mFactorChronic: null, mFactorAcute: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    // Same fixture as the existing "Chronic 4 tier uses the RAW sum" test — resolves to false.
    expect(result.resultsByHp.HP14).toBe(false);
    expect(result.triggeringSubstancesByHp.HP14).toBeUndefined();
  });

  it("HP5 unions substances across multiple independently-triggering conditions", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "h335-sub", resultPct: 25, hStatement: "H335", hazardClass: "STOT SE 3", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "h370-sub", resultPct: 5, hStatement: "H370", hazardClass: "STOT SE 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP5).toBe(true);
    expect(result.triggeringSubstancesByHp.HP5.sort()).toEqual(["h335-sub", "h370-sub"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/hazard.test.ts`
Expected: FAIL — `result.triggeringSubstancesByHp` is `undefined` (the field doesn't exist on
`HazardClassification` yet).

- [ ] **Step 3: Replace `lib/hp-classification/hazard.ts` in full**

Replace the entire file content with:

```ts
import hpThresholds from "../data/hp-thresholds.json";
import type { SampleMetadata } from "./types";

export interface NormalizedResultWithClp {
  substanceName: string;
  resultPct: number;
  hStatement: string;
  hazardClass: string;
  mFactorAcute: number | null;
  mFactorChronic: number | null;
}

export interface TestResult {
  testName: "flammability" | "skin_corrosion" | "skin_irritation";
  result: string;
  isPositive: boolean; // true if the test result indicates the hazard IS present
}

type HpOutcome = boolean | "not tested — assumed not applicable" | "requires case-specific assessment — not automatable from lab data alone" | "superseded by HP8";

export interface HazardClassification {
  resultsByHp: Record<string, HpOutcome>;
  // Real substance names that contributed to an HP being triggered (true), keyed by HP code.
  // Only present for HPs whose true outcome derives from substance-level result data (HP4, HP5,
  // HP6, HP7, HP8, HP10, HP11, HP13, HP14) — omitted entirely when an HP wasn't triggered, was
  // determined by a lab test rather than substance data, or is one of the case-specific/
  // not-automatable HPs (HP1-3, HP9, HP12, HP15), since there's nothing real to attribute.
  triggeringSubstancesByHp: Record<string, string[]>;
  isHazardous: boolean;
  triggeredHps: string[];
  confidenceFlags: string[];
}

function sumForHStatement(results: NormalizedResultWithClp[], hStatement: string): number {
  return results.filter(r => r.hStatement === hStatement).reduce((sum, r) => sum + r.resultPct, 0);
}

function thresholdFor(hpCode: string, hStatement: string, hazardClass?: string): number | null {
  const row = hazardClass
    ? hpThresholds.find(t => t.hpCode === hpCode && t.hStatement === hStatement && t.hazardClass === hazardClass)
    : hpThresholds.find(t => t.hpCode === hpCode && t.hStatement === hStatement);
  return row?.concentrationLimitPct ?? null;
}

export function classifyHazard(
  results: NormalizedResultWithClp[],
  metadata: SampleMetadata,
  testResults: TestResult[]
): HazardClassification {
  const resultsByHp: Record<string, HpOutcome> = {};
  const triggeringSubstancesByHp: Record<string, string[]> = {};
  const confidenceFlags: string[] = [];

  // Records the real, de-duplicated substance names that contributed to `hp` being triggered.
  // No-op when `substances` is empty — an HP with no contributing substances (test-based,
  // untriggered, or case-specific) gets no key at all, never an empty array.
  function setTriggering(hp: string, substances: NormalizedResultWithClp[]) {
    if (substances.length === 0) return;
    triggeringSubstancesByHp[hp] = Array.from(new Set(substances.map(r => r.substanceName)));
  }

  // HP1-HP3: test-only, never substance-attributable
  for (const hp of ["HP1", "HP2", "HP3"]) {
    const testName = hp === "HP3" ? "flammability" : null;
    const test = testName ? testResults.find(t => t.testName === testName) : undefined;
    resultsByHp[hp] = test ? test.isPositive : "not tested — assumed not applicable";
  }

  // HP4/HP8: test overrides calculation; HP8 supersedes HP4 on the corrosive overlap
  const corrosionTest = testResults.find(t => t.testName === "skin_corrosion");
  const irritationTest = testResults.find(t => t.testName === "skin_irritation");
  const h314Substances = results.filter(r => r.hStatement === "H314");

  let hp8Triggered: boolean;
  if (corrosionTest) {
    hp8Triggered = corrosionTest.isPositive; // test-based — no substance attribution
  } else {
    const h314Sum = sumForHStatement(results, "H314");
    const h314Threshold = thresholdFor("HP8", "H314") ?? 5;
    hp8Triggered = h314Sum >= h314Threshold;
    if (hp8Triggered) setTriggering("HP8", h314Substances);
  }
  resultsByHp.HP8 = hp8Triggered;

  if (hp8Triggered) {
    resultsByHp.HP4 = "superseded by HP8";
  } else if (irritationTest) {
    resultsByHp.HP4 = irritationTest.isPositive; // test-based — no substance attribution
  } else {
    const h314Sum = sumForHStatement(results, "H314");
    const h314Threshold = thresholdFor("HP4", "H314") ?? 1;
    const h315Substances = results.filter(r => r.hStatement === "H315");
    const h319Substances = results.filter(r => r.hStatement === "H319");
    const h315h319Sum = sumForHStatement(results, "H315") + sumForHStatement(results, "H319");
    const h315h319Threshold = thresholdFor("HP4", "H315") ?? 20;
    const h318Substances = results.filter(r => r.hStatement === "H318");
    const h318Sum = sumForHStatement(results, "H318");
    const h318Threshold = thresholdFor("HP4", "H318") ?? 10;
    resultsByHp.HP4 = h314Sum >= h314Threshold || h315h319Sum >= h315h319Threshold || h318Sum >= h318Threshold;
    if (resultsByHp.HP4 === true) {
      const contributing: NormalizedResultWithClp[] = [];
      if (h314Sum >= h314Threshold) contributing.push(...h314Substances);
      if (h315h319Sum >= h315h319Threshold) contributing.push(...h315Substances, ...h319Substances);
      if (h318Sum >= h318Threshold) contributing.push(...h318Substances);
      setTriggering("HP4", contributing);
    }
  }

  // HP5: Asp. Tox 1 carve-out + independent no-sum checks
  const asp1Applicable = metadata.physicalState === "liquid" && (metadata.viscosity40cMm2s ?? Infinity) <= 20.5;
  const h304Substances = results.filter(r => r.hStatement === "H304");
  const h304Sum = sumForHStatement(results, "H304");
  const h304Threshold = thresholdFor("HP5", "H304") ?? 10;
  const hp5AspTriggered = asp1Applicable && h304Sum >= h304Threshold;

  function hp5SubstancesFor(hStatement: string, defaultThreshold: number): NormalizedResultWithClp[] {
    const threshold = thresholdFor("HP5", hStatement) ?? defaultThreshold;
    return results.filter(r => r.hStatement === hStatement && r.resultPct >= threshold);
  }
  const hp5H335 = hp5SubstancesFor("H335", 20);
  const hp5H370 = hp5SubstancesFor("H370", 1);
  const hp5H371 = hp5SubstancesFor("H371", 10);
  const hp5H372 = hp5SubstancesFor("H372", 1);
  const hp5H373 = hp5SubstancesFor("H373", 10);
  resultsByHp.HP5 =
    hp5AspTriggered ||
    hp5H335.length > 0 ||
    hp5H370.length > 0 ||
    hp5H371.length > 0 ||
    hp5H372.length > 0 ||
    hp5H373.length > 0;
  if (resultsByHp.HP5) {
    const contributing: NormalizedResultWithClp[] = [];
    if (hp5AspTriggered) contributing.push(...h304Substances);
    contributing.push(...hp5H335, ...hp5H370, ...hp5H371, ...hp5H372, ...hp5H373);
    setTriggering("HP5", contributing);
  }

  // HP6: sum within category — the "category" is the specific hazard class (e.g. "Acute Tox. 2 (Oral)"),
  // not the H-statement alone, since multiple hazard classes can share one H-statement (H300 covers both
  // Acute Tox. 1 and Acute Tox. 2, at different thresholds).
  const hp6HStatements = new Set(hpThresholds.filter(t => t.hpCode === "HP6").map(t => t.hStatement));
  for (const r of results) {
    if (
      hp6HStatements.has(r.hStatement) &&
      !hpThresholds.some(t => t.hpCode === "HP6" && t.hStatement === r.hStatement && t.hazardClass === r.hazardClass)
    ) {
      confidenceFlags.push(
        `HP6: substance '${r.substanceName}' with hStatement ${r.hStatement}/hazardClass '${r.hazardClass}' has no matching threshold row — excluded from HP6 evaluation`
      );
    }
  }
  const hp6Categories = new Set(
    results
      .filter(r => hpThresholds.some(t => t.hpCode === "HP6" && t.hStatement === r.hStatement && t.hazardClass === r.hazardClass))
      .map(r => `${r.hStatement}::${r.hazardClass}`)
  );
  const hp6TriggeringCategories = Array.from(hp6Categories).filter(key => {
    const [hStatement, hazardClass] = key.split("::");
    const sum = results
      .filter(r => r.hStatement === hStatement && r.hazardClass === hazardClass)
      .reduce((s, r) => s + r.resultPct, 0);
    const threshold = thresholdFor("HP6", hStatement, hazardClass);
    return threshold !== null && sum >= threshold;
  });
  resultsByHp.HP6 = hp6TriggeringCategories.length > 0;
  if (resultsByHp.HP6) {
    const contributing: NormalizedResultWithClp[] = [];
    for (const key of hp6TriggeringCategories) {
      const [hStatement, hazardClass] = key.split("::");
      contributing.push(...results.filter(r => r.hStatement === hStatement && r.hazardClass === hazardClass));
    }
    setTriggering("HP6", contributing);
  }

  // HP7: individual substance, never summed
  const hp7Substances = results.filter(r => {
    if (r.hStatement !== "H350" && r.hStatement !== "H351") return false;
    const threshold = thresholdFor("HP7", r.hStatement);
    return threshold !== null && r.resultPct >= threshold;
  });
  resultsByHp.HP7 = hp7Substances.length > 0;
  setTriggering("HP7", hp7Substances);

  // HP9: case-specific
  resultsByHp.HP9 = "requires case-specific assessment — not automatable from lab data alone";

  // HP10: sum (H360 and H361 are separate sums)
  const h360Substances = results.filter(r => r.hStatement === "H360");
  const h360Sum = sumForHStatement(results, "H360");
  const h360Threshold = thresholdFor("HP10", "H360") ?? 0.3;
  const h361Substances = results.filter(r => r.hStatement === "H361");
  const h361Sum = sumForHStatement(results, "H361");
  const h361Threshold = thresholdFor("HP10", "H361") ?? 3;
  resultsByHp.HP10 = h360Sum >= h360Threshold || h361Sum >= h361Threshold;
  if (resultsByHp.HP10) {
    const contributing: NormalizedResultWithClp[] = [];
    if (h360Sum >= h360Threshold) contributing.push(...h360Substances);
    if (h361Sum >= h361Threshold) contributing.push(...h361Substances);
    setTriggering("HP10", contributing);
  }

  // HP11: individual substance, never summed
  const hp11Substances = results.filter(r => {
    if (r.hStatement !== "H340" && r.hStatement !== "H341") return false;
    const threshold = thresholdFor("HP11", r.hStatement);
    return threshold !== null && r.resultPct >= threshold;
  });
  resultsByHp.HP11 = hp11Substances.length > 0;
  setTriggering("HP11", hp11Substances);

  // HP12: case-specific
  resultsByHp.HP12 = "requires case-specific assessment — not automatable from lab data alone";

  // HP13: no-sum, independent per substance
  const hp13Substances = results.filter(r => {
    if (r.hStatement !== "H317" && r.hStatement !== "H334") return false;
    const threshold = thresholdFor("HP13", r.hStatement);
    return threshold !== null && r.resultPct >= threshold;
  });
  resultsByHp.HP13 = hp13Substances.length > 0;
  setTriggering("HP13", hp13Substances);

  // HP14: M-factor-weighted cascade (Aquatic Acute 1 -> Chronic 1 -> Chronic 2 -> Chronic 3 -> Chronic 4),
  // evaluated top-to-bottom, stopping at the first threshold met. A substance with no registered
  // M-factor defaults to M-factor 1 (the CLP baseline for a non-specially-potent substance), never excluded.
  function mWeightedSum(hStatement: string, mFactorKey: "mFactorAcute" | "mFactorChronic"): number {
    return results
      .filter(r => r.hStatement === hStatement)
      .reduce((sum, r) => sum + r.resultPct * (r[mFactorKey] ?? 1), 0);
  }

  const acute1Substances = results.filter(r => r.hStatement === "H400");
  const chronic1Substances = results.filter(r => r.hStatement === "H410");
  const chronic2Substances = results.filter(r => r.hStatement === "H411");
  const chronic3Substances = results.filter(r => r.hStatement === "H412");
  const chronic4Substances = results.filter(r => r.hStatement === "H413");

  const acute1Sum = mWeightedSum("H400", "mFactorAcute");
  const chronic1Sum = mWeightedSum("H410", "mFactorChronic");
  const chronic1RawSum = sumForHStatement(results, "H410");
  const chronic2RawSum = sumForHStatement(results, "H411");
  const chronic3RawSum = sumForHStatement(results, "H412");
  const chronic4RawSum = sumForHStatement(results, "H413");

  if (acute1Sum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", acute1Substances);
  } else if (chronic1Sum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", chronic1Substances);
  } else if (0.1 * chronic1Sum + chronic2RawSum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", [...chronic1Substances, ...chronic2Substances]);
  } else if (0.01 * chronic1Sum + 0.1 * chronic2RawSum + chronic3RawSum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", [...chronic1Substances, ...chronic2Substances, ...chronic3Substances]);
  } else if (chronic1RawSum + chronic2RawSum + chronic3RawSum + chronic4RawSum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", [...chronic1Substances, ...chronic2Substances, ...chronic3Substances, ...chronic4Substances]);
  } else {
    resultsByHp.HP14 = false;
  }

  // HP15: case-specific
  resultsByHp.HP15 = "requires case-specific assessment — not automatable from lab data alone";

  const triggeredHps = Object.entries(resultsByHp)
    .filter(([, v]) => v === true)
    .map(([hp]) => hp);

  return {
    resultsByHp,
    triggeringSubstancesByHp,
    isHazardous: triggeredHps.length > 0,
    triggeredHps,
    confidenceFlags,
  };
}
```

This is a faithful rewrite of the existing logic (same conditions, same thresholds, same
if/else-if ordering for HP14's cascade) — the only behavioral addition is substance tracking. It
was empirically verified during planning: the full pre-existing `hazard.test.ts` suite plus
`classify-sample.test.ts`, `eurofins-concrete-sample.test.ts`, and `italian-sample.test.ts` all
passed unchanged against this exact rewrite.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/hazard.test.ts`
Expected: PASS — all tests pass, including every pre-existing test (confirming the rewrite
preserves all prior boolean/string outcomes) and the 7 new ones from Step 1.

- [ ] **Step 5: Update `ClassificationResultsStep.tsx` to display triggering substances**

The current HP list rendering is:

```tsx
type HpOutcome = boolean | "not tested — assumed not applicable" | "requires case-specific assessment — not automatable from lab data alone" | "superseded by HP8";

interface HazardClassification {
  resultsByHp: Record<string, HpOutcome>;
  isHazardous: boolean;
  triggeredHps: string[];
  confidenceFlags: string[];
}
```

and:

```tsx
      <Card>
        <Card.Content className="flex flex-col gap-2 py-4">
          <p className="text-sm font-medium text-forest">HP1–HP15 outcomes</p>
          {Object.entries(hazard.resultsByHp)
            .sort(([a], [b]) => Number(a.slice(2)) - Number(b.slice(2)))
            .map(([hp, outcome]) => (
              <div key={hp} className="flex items-center gap-3 text-sm">
                <Chip color={outcome === true ? "danger" : "default"} variant="soft" className="w-14 justify-center">
                  {hp}
                </Chip>
                <span className="text-black/70">{outcomeLabel(outcome)}</span>
              </div>
            ))}
        </Card.Content>
      </Card>
```

First, update the local `HazardClassification` interface to add the new field:

```tsx
interface HazardClassification {
  resultsByHp: Record<string, HpOutcome>;
  triggeringSubstancesByHp: Record<string, string[]>;
  isHazardous: boolean;
  triggeredHps: string[];
  confidenceFlags: string[];
}
```

Then replace the HP list rendering block with:

```tsx
      <Card>
        <Card.Content className="flex flex-col gap-2 py-4">
          <p className="text-sm font-medium text-forest">HP1–HP15 outcomes</p>
          {Object.entries(hazard.resultsByHp)
            .sort(([a], [b]) => Number(a.slice(2)) - Number(b.slice(2)))
            .map(([hp, outcome]) => {
              const substances = hazard.triggeringSubstancesByHp[hp];
              return (
                <div key={hp} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-3 text-sm">
                    <Chip color={outcome === true ? "danger" : "default"} variant="soft" className="w-14 justify-center">
                      {hp}
                    </Chip>
                    <span className="text-black/70">{outcomeLabel(outcome)}</span>
                  </div>
                  {substances && substances.length > 0 && (
                    <p className="text-xs text-black/50 pl-[4.25rem]">Triggered by: {substances.join(", ")}</p>
                  )}
                </div>
              );
            })}
        </Card.Content>
      </Card>
```

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/hazard.ts components/wizard/ClassificationResultsStep.tsx tests/hp-classification/hazard.test.ts
git commit -m "feat: show which chemicals triggered each HP in classification results"
```
