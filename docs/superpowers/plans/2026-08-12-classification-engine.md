# Stage 2 Classification Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, sourced Norwegian tilstandsklasse + EU HP-criteria classification engine that drives EAL-code selection for soil/stone waste samples, activated only when a lab report supplies total solid concentration data (mg/kg dry matter) — distinct from the TCLP leachate data (mg/L) the app already handles.

**Architecture:** Two new pure-function modules (`lib/tilstandsklasse.ts`, `lib/hp-criteria.ts`) driven by two new real threshold JSON data files and a small CLP-classification lookup. `lib/classification.ts`'s `pickEalCode()` gains a new branch that runs these modules for soil-matrix samples when the extraction produced `totalConcentrationsMgKg` data, and falls through unchanged otherwise. The extraction schema and prompt gain one new field to capture that data when present.

**Tech Stack:** TypeScript, Vitest, existing Next.js app conventions (no new dependencies).

## Global Constraints

- Never fabricate or approximate regulatory threshold values — every number in the new JSON data files must be one of the values transcribed in the spec (`docs/superpowers/specs/2026-08-12-classification-engine-design.md`), copied verbatim.
- HP14 and the asbestos presence/absence rule ship marked as unverified/needs-sourcing — never presented as equally solid as the sourced HP4/HP5/HP6/HP7 data.
- TCLP leachate (mg/L, `tclpMetalsMgL`) and total concentration (mg/kg, `totalConcentrationsMgKg`) must never be mixed in the same computation.
- Tilstandsklasse output is informational only — it must never drive the `hazardous` boolean or EAL selection; only HP-criteria does.
- A substance present in extracted data but absent from a threshold/CLP table is silently skipped in that computation, never guessed.
- No change to non-soil-matrix EAL selection logic, and no change to `lib/search-classify.ts` behavior.

---

### Task 1: Extraction schema — add `totalConcentrationsMgKg`

**Files:**
- Modify: `lib/types.ts:14-16` (add field to `ExtractedWasteData`)
- Modify: `lib/extraction.ts:21-23` (validation), `lib/extraction.ts:29-51` (prompt)
- Test: `tests/extraction.test.ts` (new file)

**Interfaces:**
- Produces: `ExtractedWasteData.totalConcentrationsMgKg: Record<string, number>` — consumed by Task 4 (`pickEalCode`) and Task 2/3 modules.

- [ ] **Step 1: Write the failing test**

Create `tests/extraction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateExtractedWasteData } from "@/lib/extraction";

describe("validateExtractedWasteData", () => {
  const base = {
    sampleId: "S-1",
    matrix: "Soil",
    sourceDescription: "Test site",
    quantityKg: null,
    physicalCharacteristics: { phSU: null, flashPointF: null, tphMgKg: null, ignitable: null },
    tclpMetalsMgL: {},
    volatileOrganicsMgKg: {},
    hazardIndicatorsNoted: [],
  };

  it("accepts data with totalConcentrationsMgKg present", () => {
    const data = { ...base, totalConcentrationsMgKg: { lead: 250 } };
    expect(validateExtractedWasteData(data)).toBe(true);
  });

  it("accepts data with totalConcentrationsMgKg empty", () => {
    const data = { ...base, totalConcentrationsMgKg: {} };
    expect(validateExtractedWasteData(data)).toBe(true);
  });

  it("rejects data missing totalConcentrationsMgKg entirely", () => {
    expect(validateExtractedWasteData(base)).toBe(false);
  });

  it("rejects data where totalConcentrationsMgKg is not an object", () => {
    const data = { ...base, totalConcentrationsMgKg: "not an object" };
    expect(validateExtractedWasteData(data)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extraction.test.ts`
Expected: FAIL — `totalConcentrationsMgKg` missing-field cases don't yet exist as a validation branch, so the "accepts" cases fail (field doesn't exist on type but JS doesn't care) — actually since `validateExtractedWasteData` doesn't check for the field yet, the "rejects... missing entirely" test will FAIL (currently returns `true`). This is the expected red state.

- [ ] **Step 3: Add the field to the type**

In `lib/types.ts`, after line 15 (`tclpMetalsMgL` line) add:

```typescript
  tclpMetalsMgL: Record<string, number>;   // e.g. { arsenic: 0.041, lead: 0.612, ... }
  volatileOrganicsMgKg: Record<string, number>; // e.g. { benzene: 3.9, toluene: 22.6, ... }
  totalConcentrationsMgKg: Record<string, number>; // TOTAL solid concentration, mg/kg dry matter — distinct lab method from tclpMetalsMgL (leachate, mg/L). Empty {} when the report only provides TCLP/leachate data.
  hazardIndicatorsNoted: string[];  // free-text flags the lab report itself calls out
```

(Replacing the existing three lines 14-16 with these four.)

- [ ] **Step 4: Add validation in `lib/extraction.ts`**

After line 22 (`if (!d.volatileOrganicsMgKg || typeof d.volatileOrganicsMgKg !== "object") return false;`), add:

```typescript
  if (!d.totalConcentrationsMgKg || typeof d.totalConcentrationsMgKg !== "object") return false;
```

- [ ] **Step 5: Update the extraction prompt**

In `lib/extraction.ts`, replace the `EXTRACTION_PROMPT` constant's JSON shape block (lines 32-46) with:

```typescript
{
  "sampleId": string,
  "matrix": string,
  "sourceDescription": string,
  "quantityKg": number | null,
  "physicalCharacteristics": {
    "phSU": number | null,
    "flashPointF": number | null,
    "tphMgKg": number | null,
    "ignitable": boolean | null
  },
  "tclpMetalsMgL": { [analyte: string]: number },
  "volatileOrganicsMgKg": { [analyte: string]: number },
  "totalConcentrationsMgKg": { [analyte: string]: number },
  "hazardIndicatorsNoted": string[]
}
```

And after the existing "Use camelCase keys..." paragraph (line 48), add a new paragraph:

```
"tclpMetalsMgL" is for TCLP / leachate test results only (unit mg/L), as reported under a "TCLP" or "leachate" column or method reference. "totalConcentrationsMgKg" is for TOTAL solid concentration results only (unit mg/kg dry matter), as reported under a "total concentration", "total metals", or "bulk concentration" column or method reference — this is a different lab test from TCLP, not a unit conversion of it. If the report only contains one of the two, leave the other as an empty object {}. Never convert or estimate one from the other.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/extraction.test.ts`
Expected: PASS (4/4)

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All existing tests still pass — note any test fixtures building `ExtractedWasteData` object literals directly (not via `validateExtractedWasteData`) will need `totalConcentrationsMgKg: {}` added; if `npx vitest run` reports TypeScript errors in `tests/classification.test.ts`, `tests/matching.test.ts`, or `tests/search-classify.test.ts` for missing the field, add `totalConcentrationsMgKg: {}` to every `ExtractedWasteData` literal in those files before proceeding.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/extraction.ts tests/extraction.test.ts tests/classification.test.ts tests/matching.test.ts tests/search-classify.test.ts
git commit -m "feat: add totalConcentrationsMgKg field to extraction schema"
```

---

### Task 2: Tilstandsklasse threshold data + `lib/tilstandsklasse.ts`

**Files:**
- Create: `lib/data/tilstandsklasse-thresholds.json`
- Create: `lib/tilstandsklasse.ts`
- Test: `tests/tilstandsklasse.test.ts`

**Interfaces:**
- Produces: `computeTilstandsklasse(concentrations: Record<string, number>): { perSubstance: TilstandsklasseResult[]; overallKlasse: 1 | 2 | 3 | 4 | 5 | "above-5" | null }` and `TilstandsklasseResult { substance: string; concentrationMgKg: number; klasse: 1 | 2 | 3 | 4 | 5 | "above-5" }` — consumed by Task 4.

- [ ] **Step 1: Create the threshold data file**

Create `lib/data/tilstandsklasse-thresholds.json`:

```json
[
  { "substance": "arsenic", "unit": "mg/kg", "classBoundaries": [8, 20, 50, 600, 1000] },
  { "substance": "lead", "unit": "mg/kg", "classBoundaries": [60, 100, 300, 700, 2500] },
  { "substance": "cadmium", "unit": "mg/kg", "classBoundaries": [1.5, 10, 15, 30, 1000] },
  { "substance": "chromiumTotal", "unit": "mg/kg", "classBoundaries": [50, 200, 500, 2800, 25000] },
  { "substance": "chromiumVI", "unit": "mg/kg", "classBoundaries": [2, 5, 20, 80, 1000] },
  { "substance": "copper", "unit": "mg/kg", "classBoundaries": [100, 200, 1000, 8500, 25000] },
  { "substance": "mercury", "unit": "mg/kg", "classBoundaries": [1, 2, 4, 10, 1000] },
  { "substance": "nickel", "unit": "mg/kg", "classBoundaries": [60, 135, 200, 1200, 2500] },
  { "substance": "zinc", "unit": "mg/kg", "classBoundaries": [200, 500, 1000, 5000, 25000] },
  { "substance": "aliphaticsC8C10", "unit": "mg/kg", "classBoundaries": [10, 10, 40, 50, 20000] },
  { "substance": "aliphaticsC10C12", "unit": "mg/kg", "classBoundaries": [50, 60, 130, 300, 20000] },
  { "substance": "aliphaticsC12C35", "unit": "mg/kg", "classBoundaries": [100, 300, 600, 2000, 20000] },
  { "substance": "benzene", "unit": "mg/kg", "classBoundaries": [0.01, 0.015, 0.04, 0.05, 1000] },
  { "substance": "benzoAPyrene", "unit": "mg/kg", "classBoundaries": [0.1, 0.5, 5, 15, 50] },
  { "substance": "pah16Sum", "unit": "mg/kg", "classBoundaries": [2, 8, 50, 150, 2500] },
  { "substance": "pcb7Sum", "unit": "mg/kg", "classBoundaries": [0.01, 0.5, 1, 5, 50] }
]
```

(Source: Miljødirektoratet TA-2553/2009 tilstandsklasse table, as transcribed in `docs/superpowers/specs/2026-08-12-classification-engine-design.md` §2.)

- [ ] **Step 2: Write the failing test**

Create `tests/tilstandsklasse.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeTilstandsklasse } from "@/lib/tilstandsklasse";

describe("computeTilstandsklasse", () => {
  it("classifies a substance at klasse 1 when at or below the first boundary", () => {
    const result = computeTilstandsklasse({ lead: 60 });
    expect(result.perSubstance).toEqual([{ substance: "lead", concentrationMgKg: 60, klasse: 1 }]);
    expect(result.overallKlasse).toBe(1);
  });

  it("classifies a substance at klasse 3 when between the 2nd and 3rd boundary", () => {
    const result = computeTilstandsklasse({ lead: 250 });
    expect(result.perSubstance).toEqual([{ substance: "lead", concentrationMgKg: 250, klasse: 3 }]);
    expect(result.overallKlasse).toBe(3);
  });

  it("classifies a substance as above-5 when beyond the last boundary", () => {
    const result = computeTilstandsklasse({ mercury: 5000 });
    expect(result.perSubstance).toEqual([{ substance: "mercury", concentrationMgKg: 5000, klasse: "above-5" }]);
    expect(result.overallKlasse).toBe("above-5");
  });

  it("takes the max klasse across multiple substances", () => {
    const result = computeTilstandsklasse({ lead: 60, mercury: 5000 });
    expect(result.overallKlasse).toBe("above-5");
  });

  it("skips substances with no threshold entry", () => {
    const result = computeTilstandsklasse({ unknownSubstance: 999 });
    expect(result.perSubstance).toEqual([]);
    expect(result.overallKlasse).toBeNull();
  });

  it("returns null overallKlasse for empty input", () => {
    const result = computeTilstandsklasse({});
    expect(result.overallKlasse).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/tilstandsklasse.test.ts`
Expected: FAIL with "Cannot find module '@/lib/tilstandsklasse'"

- [ ] **Step 4: Write the implementation**

Create `lib/tilstandsklasse.ts`:

```typescript
import thresholds from "./data/tilstandsklasse-thresholds.json";

export interface TilstandsklasseResult {
  substance: string;
  concentrationMgKg: number;
  klasse: 1 | 2 | 3 | 4 | 5 | "above-5";
}

function klasseFor(concentrationMgKg: number, classBoundaries: number[]): 1 | 2 | 3 | 4 | 5 | "above-5" {
  for (let i = 0; i < classBoundaries.length; i++) {
    if (concentrationMgKg <= classBoundaries[i]) {
      return (i + 1) as 1 | 2 | 3 | 4 | 5;
    }
  }
  return "above-5";
}

export function computeTilstandsklasse(concentrations: Record<string, number>): {
  perSubstance: TilstandsklasseResult[];
  overallKlasse: 1 | 2 | 3 | 4 | 5 | "above-5" | null;
} {
  const perSubstance: TilstandsklasseResult[] = [];

  for (const [substance, concentrationMgKg] of Object.entries(concentrations)) {
    const entry = thresholds.find(t => t.substance === substance);
    if (!entry) continue; // no sourced threshold for this substance — skip, never guess
    perSubstance.push({ substance, concentrationMgKg, klasse: klasseFor(concentrationMgKg, entry.classBoundaries) });
  }

  if (perSubstance.length === 0) {
    return { perSubstance, overallKlasse: null };
  }

  const rank = (k: TilstandsklasseResult["klasse"]) => (k === "above-5" ? 6 : k);
  const overallKlasse = perSubstance.reduce((max, r) => (rank(r.klasse) > rank(max) ? r.klasse : max), perSubstance[0].klasse);

  return { perSubstance, overallKlasse };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tilstandsklasse.test.ts`
Expected: PASS (6/6)

- [ ] **Step 6: Commit**

```bash
git add lib/data/tilstandsklasse-thresholds.json lib/tilstandsklasse.ts tests/tilstandsklasse.test.ts
git commit -m "feat: add tilstandsklasse threshold data and computeTilstandsklasse"
```

---

### Task 3: HP-criteria threshold data + CLP lookup + `lib/hp-criteria.ts`

**Files:**
- Create: `lib/data/hp-criteria-thresholds.json`
- Create: `lib/data/substance-clp-classification.json`
- Create: `lib/hp-criteria.ts`
- Test: `tests/hp-criteria.test.ts`

**Interfaces:**
- Produces: `computeHpCriteria(concentrations: Record<string, number>): { triggeredFlags: HpFlag[]; hazardous: boolean }` and `HpFlag { hpCode: string; substance: string; triggeredAtPercent: number; thresholdPercent: number }` — consumed by Task 4.

- [ ] **Step 1: Create the HP-criteria threshold data file**

Create `lib/data/hp-criteria-thresholds.json`:

```json
[
  { "hpCode": "HP4", "hazardClass": "Skin Corr. 1A (H314)", "thresholdPercent": 1, "status": "sourced" },
  { "hpCode": "HP4", "hazardClass": "Eye Dam. 1 (H318)", "thresholdPercent": 10, "status": "sourced" },
  { "hpCode": "HP5", "hazardClass": "STOT SE1/RE1 (H370/H372)", "thresholdPercent": 1, "status": "sourced" },
  { "hpCode": "HP5", "hazardClass": "STOT SE2/RE2 (H371/H373)", "thresholdPercent": 10, "status": "sourced" },
  { "hpCode": "HP6", "hazardClass": "Acute Tox. 1 Oral (H300)", "thresholdPercent": 0.1, "status": "sourced" },
  { "hpCode": "HP6", "hazardClass": "Acute Tox. 4 Oral (H302)", "thresholdPercent": 25, "status": "sourced" },
  { "hpCode": "HP7", "hazardClass": "Carc. 1A/1B (H350)", "thresholdPercent": 0.1, "status": "sourced" },
  { "hpCode": "HP7", "hazardClass": "Carc. 2 (H351)", "thresholdPercent": 1.0, "status": "sourced" },
  { "hpCode": "HP14", "hazardClass": null, "thresholdPercent": null, "status": "needs-sourcing" }
]
```

(Source: EU Regulation (EU) No 1357/2014, Annex III, as transcribed in the design spec §2. HP14 intentionally has no threshold — see spec Non-goals.)

- [ ] **Step 2: Create the CLP classification lookup**

Create `lib/data/substance-clp-classification.json`:

```json
[
  { "substance": "benzoAPyrene", "clpClass": "Carc. 1B (H350)", "appliesTo": ["HP7"] },
  { "substance": "arsenic", "clpClass": "Acute Tox. 3 Oral (H301)", "appliesTo": ["HP6"] }
]
```

This is intentionally minimal — only substances with a sourced CLP classification are listed. It is a maintained reference table, not an exhaustive one; more entries are added as they are sourced (see spec §2).

- [ ] **Step 3: Write the failing test**

Create `tests/hp-criteria.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeHpCriteria } from "@/lib/hp-criteria";

describe("computeHpCriteria", () => {
  it("does not trigger HP7 for benzo[a]pyrene well below the 0.1% threshold", () => {
    // 0.05 mg/kg = 0.000005% — far below 0.1%
    const result = computeHpCriteria({ benzoAPyrene: 0.05 });
    expect(result.triggeredFlags).toEqual([]);
    expect(result.hazardous).toBe(false);
  });

  it("does not trigger HP7 for benzo[a]pyrene at 150 mg/kg (0.015%), despite being deep into tilstandsklasse 5", () => {
    // 150 mg/kg = 0.015% — still below the 0.1% HP7 Carc.1B threshold.
    // This illustrates that a high tilstandsklasse does NOT imply an HP flag —
    // the two frameworks use very different scales.
    const result = computeHpCriteria({ benzoAPyrene: 150 });
    expect(result.triggeredFlags).toEqual([]);
    expect(result.hazardous).toBe(false);
  });

  it("triggers HP7 for benzo[a]pyrene at or above the 0.1% threshold", () => {
    // 1000 mg/kg = 0.1% exactly
    const result = computeHpCriteria({ benzoAPyrene: 1000 });
    expect(result.triggeredFlags).toEqual([
      { hpCode: "HP7", substance: "benzoAPyrene", triggeredAtPercent: 0.1, thresholdPercent: 0.1 },
    ]);
    expect(result.hazardous).toBe(true);
  });

  it("skips substances with no CLP classification entry", () => {
    const result = computeHpCriteria({ zinc: 999999 });
    expect(result.triggeredFlags).toEqual([]);
    expect(result.hazardous).toBe(false);
  });

  it("returns hazardous:false and no flags for empty input", () => {
    const result = computeHpCriteria({});
    expect(result.triggeredFlags).toEqual([]);
    expect(result.hazardous).toBe(false);
  });

  it("triggers HP6 for arsenic at or above the 0.1% Acute Tox 1 threshold", () => {
    // 1000 mg/kg = 0.1% exactly
    const result = computeHpCriteria({ arsenic: 1000 });
    expect(result.triggeredFlags).toEqual([
      { hpCode: "HP6", substance: "arsenic", triggeredAtPercent: 0.1, thresholdPercent: 0.1 },
    ]);
    expect(result.hazardous).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/hp-criteria.test.ts`
Expected: FAIL with "Cannot find module '@/lib/hp-criteria'"

- [ ] **Step 5: Write the implementation**

Create `lib/hp-criteria.ts`:

```typescript
import hpThresholds from "./data/hp-criteria-thresholds.json";
import clpClassifications from "./data/substance-clp-classification.json";

export interface HpFlag {
  hpCode: string;
  substance: string;
  triggeredAtPercent: number;
  thresholdPercent: number;
}

const MG_KG_TO_PERCENT = 10000; // 1% = 10,000 mg/kg

export function computeHpCriteria(concentrations: Record<string, number>): {
  triggeredFlags: HpFlag[];
  hazardous: boolean;
} {
  const triggeredFlags: HpFlag[] = [];

  for (const [substance, concentrationMgKg] of Object.entries(concentrations)) {
    const classification = clpClassifications.find(c => c.substance === substance);
    if (!classification) continue; // no sourced CLP classification — skip, never guess

    const percent = concentrationMgKg / MG_KG_TO_PERCENT;

    for (const hpCode of classification.appliesTo) {
      const thresholdRow = hpThresholds.find(
        t => t.hpCode === hpCode && t.hazardClass === classification.clpClass && t.status === "sourced"
      );
      if (!thresholdRow || thresholdRow.thresholdPercent === null) continue; // e.g. HP14 — needs-sourcing, never guessed

      if (percent >= thresholdRow.thresholdPercent) {
        triggeredFlags.push({
          hpCode,
          substance,
          triggeredAtPercent: percent,
          thresholdPercent: thresholdRow.thresholdPercent,
        });
      }
    }
  }

  return { triggeredFlags, hazardous: triggeredFlags.length > 0 };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/hp-criteria.test.ts`
Expected: PASS (6/6)

- [ ] **Step 7: Commit**

```bash
git add lib/data/hp-criteria-thresholds.json lib/data/substance-clp-classification.json lib/hp-criteria.ts tests/hp-criteria.test.ts
git commit -m "feat: add HP-criteria threshold data and computeHpCriteria"
```

---

### Task 4: Wire the new engine into `pickEalCode` and `ClassificationResult`

**Files:**
- Modify: `lib/types.ts:25-33` (`ClassificationResult`)
- Modify: `lib/classification.ts:9-44` (`pickEalCode`), `lib/classification.ts:107-121` (`classifyWaste`)
- Test: `tests/classification.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `computeTilstandsklasse` from Task 2, `computeHpCriteria` from Task 3, `ExtractedWasteData.totalConcentrationsMgKg` from Task 1.
- Produces: `ClassificationResult.tilstandsklasse: { overallKlasse: 1|2|3|4|5|"above-5"|null; perSubstance: TilstandsklasseResult[] } | null` and `ClassificationResult.hpFlags: HpFlag[]`.

- [ ] **Step 1: Write the failing tests**

Read the existing `tests/classification.test.ts` first to match its style, then add these test cases to it (append to the existing `describe` block, or add a new one):

```typescript
describe("classifyWaste — soil with totalConcentrationsMgKg", () => {
  const baseSoilSample = {
    sampleId: "S-SOIL-1",
    matrix: "Soil",
    sourceDescription: "Construction site, Oslo",
    quantityKg: 5000,
    physicalCharacteristics: { phSU: null, flashPointF: null, tphMgKg: null, ignitable: null },
    tclpMetalsMgL: {},
    volatileOrganicsMgKg: {},
    hazardIndicatorsNoted: [],
  };

  it("selects 17 05 04 (non-hazardous) when no HP flag is triggered", () => {
    const result = classifyWaste({ ...baseSoilSample, totalConcentrationsMgKg: { lead: 250 } });
    expect(result.ealCode).toBe("17 05 04");
    expect(result.tilstandsklasse?.overallKlasse).toBe(3);
    expect(result.hpFlags).toEqual([]);
  });

  it("selects 17 05 03* (hazardous) when an HP flag is triggered", () => {
    const result = classifyWaste({ ...baseSoilSample, totalConcentrationsMgKg: { benzoAPyrene: 1000 } });
    expect(result.ealCode).toBe("17 05 03*");
    expect(result.hpFlags.length).toBeGreaterThan(0);
  });

  it("falls through to existing TPH-based logic when totalConcentrationsMgKg is empty", () => {
    const result = classifyWaste({
      ...baseSoilSample,
      totalConcentrationsMgKg: {},
      physicalCharacteristics: { phSU: null, flashPointF: null, tphMgKg: 2000, ignitable: null },
    });
    expect(result.ealCode).toBe("17 05 03*"); // existing TPH > 1000 branch
    expect(result.tilstandsklasse).toBeNull();
    expect(result.hpFlags).toEqual([]);
  });

  it("selects 17 06 05* for asbestos regardless of totalConcentrationsMgKg", () => {
    const result = classifyWaste({
      ...baseSoilSample,
      matrix: "Soil with Asbestos",
      totalConcentrationsMgKg: { lead: 60 },
    });
    expect(result.ealCode).toBe("17 06 05*");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/classification.test.ts`
Expected: FAIL — `result.tilstandsklasse` and `result.hpFlags` are `undefined`, and the soil branch doesn't yet use `totalConcentrationsMgKg`.

- [ ] **Step 3: Add the new fields to `ClassificationResult`**

In `lib/types.ts`, replace the `ClassificationResult` interface (lines 25-33) with:

```typescript
export interface ClassificationResult {
  ealCode: string;              // e.g. "05 01 06*"
  ealDescription: string;
  avfallsstoffnummer: string | null;
  avfallsstoffnummerDescription: string | null;
  complianceFlags: ComplianceFlag[];
  quantityKg: number | null;
  sourceDescription: string;
  tilstandsklasse: { overallKlasse: 1 | 2 | 3 | 4 | 5 | "above-5" | null; perSubstance: import("./tilstandsklasse").TilstandsklasseResult[] } | null;
  hpFlags: import("./hp-criteria").HpFlag[];
}
```

- [ ] **Step 4: Wire the new engine into `pickEalCode` and `classifyWaste`**

In `lib/classification.ts`, add imports at the top (after line 4):

```typescript
import { computeTilstandsklasse, type TilstandsklasseResult } from "./tilstandsklasse";
import { computeHpCriteria, type HpFlag } from "./hp-criteria";
```

Replace the `pickEalCode` function signature and its soil branch (lines 9-44). The full replacement:

```typescript
function pickEalCode(data: ExtractedWasteData): { code: string; description: string } {
  const tph = data.physicalCharacteristics.tphMgKg ?? 0;
  const matrix = data.matrix.toLowerCase();
  const hazardNotes = data.hazardIndicatorsNoted.join(" ").toLowerCase();
  const hasSolventAnalyte = Object.keys(data.volatileOrganicsMgKg)
    .some(k => /trichloroethylene|tetrachloroethylene|trichloroethane/i.test(k));

  if (matrix.includes("asbestos") || hazardNotes.includes("asbestos") || matrix.includes("acm")) {
    const match = ealCodes.find(c => c.code === "17 06 05*");
    if (match) return match;
  }
  if (matrix.includes("solvent") || hasSolventAnalyte) {
    const match = ealCodes.find(c => c.code === "07 01 03*");
    if (match) return match;
  }
  if (matrix.includes("soil")) {
    const hasTotalConcentrationData = Object.keys(data.totalConcentrationsMgKg).length > 0;
    if (hasTotalConcentrationData) {
      const popMatchForSoil = pops.find(p =>
        data.hazardIndicatorsNoted.some(note => {
          const lowerNote = note.toLowerCase();
          const aliasHit = (p.aliases ?? []).some(alias => lowerNote.includes(alias.toLowerCase()));
          const casHit = p.casNumber ? lowerNote.includes(p.casNumber.toLowerCase()) : false;
          return aliasHit || casHit;
        })
      );
      if (popMatchForSoil) {
        const match = ealCodes.find(c => c.code === "17 09 02*");
        if (match) return match;
      }
      const hpResult = computeHpCriteria(data.totalConcentrationsMgKg);
      const match = ealCodes.find(c => c.code === (hpResult.hazardous ? "17 05 03*" : "17 05 04"));
      if (match) return match;
    }
    const hazardousSoil = tph > TPH_OILY_THRESHOLD_MG_KG;
    const match = ealCodes.find(c => c.code === (hazardousSoil ? "17 05 03*" : "17 05 04"));
    if (match) return match;
  }
  if (matrix.includes("drilling")) {
    const match = ealCodes.find(c => c.code === "01 05 05*");
    if (match) return match;
  }
  if (matrix.includes("used oil") || (matrix.includes("oil") && matrix.includes("sludge"))) {
    const match = ealCodes.find(c => c.code === "13 02 05*");
    if (match) return match;
  }
  if (tph > TPH_OILY_THRESHOLD_MG_KG && (matrix.includes("sludge") || matrix.includes("tank"))) {
    const match = ealCodes.find(c => c.code === "05 01 06*");
    if (match) return match;
  }
  const fallback = ealCodes.find(c => c.code === "05 01 99");
  if (!fallback) throw new Error("no fallback EAL code configured");
  return fallback;
}
```

Now update `classifyWaste` (lines 107-121) to compute and attach `tilstandsklasse`/`hpFlags`:

```typescript
export function classifyWaste(data: ExtractedWasteData): ClassificationResult {
  const eal = pickEalCode(data);
  const hazardous = eal.code.endsWith("*");
  const avfallsstoffnummer = pickAvfallsstoffnummer(eal.code, hazardous);

  const hasTotalConcentrationData = Object.keys(data.totalConcentrationsMgKg).length > 0;
  const tilstandsklasse = hasTotalConcentrationData
    ? computeTilstandsklasse(data.totalConcentrationsMgKg)
    : null;
  const hpFlags: HpFlag[] = hasTotalConcentrationData
    ? computeHpCriteria(data.totalConcentrationsMgKg).triggeredFlags
    : [];

  return {
    ealCode: eal.code,
    ealDescription: eal.description,
    avfallsstoffnummer: avfallsstoffnummer?.number ?? null,
    avfallsstoffnummerDescription: avfallsstoffnummer?.description ?? null,
    complianceFlags: buildComplianceFlags(data, eal.code, hazardous),
    quantityKg: data.quantityKg,
    sourceDescription: data.sourceDescription,
    tilstandsklasse,
    hpFlags,
  };
}
```

Note: `TilstandsklasseResult` is imported but only used via the `ClassificationResult` type reference in `lib/types.ts` (using the `import("./tilstandsklasse")` inline type import) — if your editor/linter flags the `TilstandsklasseResult` import in `lib/classification.ts` as unused, remove that named import there and keep only `computeTilstandsklasse`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/classification.test.ts`
Expected: PASS (all cases, old and new)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass. If any existing `ExtractedWasteData` literal in other test files lacks `totalConcentrationsMgKg`, add `totalConcentrationsMgKg: {}` to it (should already be resolved from Task 1 Step 7, but re-check here since Task 4 touches `classification.ts` directly).

- [ ] **Step 7: Run the build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/classification.ts tests/classification.test.ts
git commit -m "feat: wire tilstandsklasse/HP-criteria engine into EAL selection for soil matrices"
```

---

### Task 5: Surface tilstandsklasse and HP-flags in the report/UI (minimal, non-branding)

**Files:**
- Modify: `lib/report-pdf.tsx:19-33` (Classification section)
- Modify: `components/wizard/ReviewStep.tsx` (read file first — add a small informational block)
- Test: manual verification only (no new automated test — this is presentational; existing classification/report tests already cover the data)

**Interfaces:**
- Consumes: `ClassificationResult.tilstandsklasse`, `ClassificationResult.hpFlags` from Task 4.

- [ ] **Step 1: Add tilstandsklasse/HP display to the PDF report**

In `lib/report-pdf.tsx`, inside the "Classification" `<View style={styles.section}>` block (after the `sourceDescription`/`quantityKg` rows, before the closing `</View>` at line 33), add:

```tsx
          {classification.tilstandsklasse && (
            <View style={styles.row}>
              <Text>Tilstandsklasse (informational)</Text>
              <Text>{classification.tilstandsklasse.overallKlasse}</Text>
            </View>
          )}
          {classification.hpFlags.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text>HP-criteria triggered: {classification.hpFlags.map(f => f.hpCode).join(", ")}</Text>
            </View>
          )}
```

- [ ] **Step 2: Read `components/wizard/ReviewStep.tsx` to find the compliance flags block**

Use the Read tool on `components/wizard/ReviewStep.tsx` before editing, to match its existing `Card`/`Chip` pattern for compliance flags (per the session's prior work, compliance flags render as individual `Card` blocks with a `Chip` + detail paragraph). Add a new block immediately after the compliance flags rendering, following the same visual pattern:

```tsx
{classification.tilstandsklasse && (
  <Card>
    <Card.Content className="py-4">
      <p className="text-sm font-medium">
        Tilstandsklasse {classification.tilstandsklasse.overallKlasse} (informational)
      </p>
      <p className="text-xs text-black/60 mt-1">
        Norwegian soil contamination severity class per Miljødirektoratet TA-2553/2009 — informational only, does not by itself determine hazardous-waste status.
      </p>
    </Card.Content>
  </Card>
)}
{classification.hpFlags.length > 0 && (
  <Card>
    <Card.Content className="py-4">
      <p className="text-sm font-medium">HP-criteria triggered</p>
      <ul className="text-xs text-black/60 mt-1 flex flex-col gap-1">
        {classification.hpFlags.map(flag => (
          <li key={`${flag.hpCode}-${flag.substance}`}>
            {flag.hpCode} — {flag.substance} at {flag.triggeredAtPercent.toFixed(4)}% (threshold {flag.thresholdPercent}%)
          </li>
        ))}
      </ul>
    </Card.Content>
  </Card>
)}
```

Adjust the exact `Card`/`Card.Content`/className usage to match whatever pattern the file actually uses once you've read it — the content and logic above must be preserved, but match the surrounding component's exact styling conventions rather than introducing a new one.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Manual verification**

Run: `npx vitest run` (confirm no regressions), then start the dev server and manually confirm via a constructed test: temporarily call `classifyWaste` with a soil sample containing `totalConcentrationsMgKg: { lead: 250 }` (e.g. via a scratch script or by temporarily adjusting a sample fixture) and confirm the PDF report and ReviewStep both render the tilstandsklasse line without errors. Remove any temporary scratch scaffolding before committing.

- [ ] **Step 5: Commit**

```bash
git add lib/report-pdf.tsx components/wizard/ReviewStep.tsx
git commit -m "feat: surface tilstandsklasse and HP-criteria flags in report and review UI"
```

---

## Self-Review Notes

- **Spec coverage:** §1 extraction schema → Task 1. §2 threshold data (tilstandsklasse, HP-criteria, CLP lookup) → Tasks 2–3. §3 new logic modules → Tasks 2–3. §4 EAL selection integration → Task 4. §5 error handling/honesty behavior (empty data fallback, skip-not-guess, HP14/asbestos markers) → built into Tasks 2–4 directly (see inline comments and code). §6 testing approach, including the counter-intuitive benzo[a]pyrene case → Task 3 Step 3. UI/report surfacing wasn't explicitly required by the spec's six numbered sections but is necessary for the data to be visible anywhere — added as Task 5, kept minimal and consistent with existing non-branded UI conventions from prior work in this codebase.
- **Placeholder scan:** no TBD/TODO markers; all code blocks are complete and runnable.
- **Type consistency:** `TilstandsklasseResult` (Task 2) and `HpFlag` (Task 3) are referenced with identical shapes in `ClassificationResult` (Task 4) via inline `import(...)` types, avoiding a circular import between `classification.ts` and `types.ts`.
