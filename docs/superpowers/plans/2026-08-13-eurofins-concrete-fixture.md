# Eurofins Concrete Sample Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second real, hand-transcribed regression fixture (a Norwegian Eurofins concrete sample, genuinely non-hazardous) proving the HP1-15 engine correctly resolves a clean sample to a real non-hazardous EAL code, not just that it can detect hazards.

**Architecture:** Three new `AnalyteReference` entries with real, sourced CLP classifications (mercury, chromium VI, benzo[a]pyrene — all landing on hazard categories `hp-thresholds.json` already covers, no new threshold rows needed); the existing arsenic/lead/copper/nickel/zinc/cadmium entries are reused as-is since this sample reports the same elements the Italian sample already classifies. A new fixture file and a second end-to-end regression test, structured identically to the existing Italian-sample test.

**Tech Stack:** TypeScript, Vitest — no new dependencies.

## Global Constraints

- Every new CLP classification must be real and sourced — no fabricated H-statements or thresholds. Sources used: mercury (Acute Tox. 2 Inhalation H330, Repr. 1B H360D, STOT RE 1 H372, CAS 7439-97-6), benzo[a]pyrene (Carc. 1B H350, Muta. 1B H340, Repr. 1B H360, Skin Sens. 1 H317, Aquatic Acute 1 H400, Aquatic Chronic 1 H410, CAS 50-32-8, EC 200-028-5), chromium VI generic compounds bucket (Carc. 1B H350 — the generic "other Cr(VI) compounds" entry; specific chromates like chromium trioxide are the stricter Carc. 1A, not used here since this sample reports total Cr(VI), not a specific compound).
- The existing Italian sample fixture and its regression test (`tests/hp-classification/italian-sample.test.ts`) must be left untouched and must keep passing.
- Substances this sample reports but that get no new CLP entry (remaining PAH16 members, PCB7 congeners, aliphatic/aromatic hydrocarbon fractions, plain chromium-total) are extracted and normalized but honestly excluded from hazard classification — never guessed into a category.
- Reuse existing `AnalyteReference` entries for elements this sample shares with the Italian sample (arsenic, lead-compounds, cupric-oxide, nickel-monoxide, zinc-oxide, cadmium-oxide) rather than creating duplicates.

---

### Task 1: New AnalyteReference entries (mercury, chromium VI, benzo[a]pyrene)

**Files:**
- Modify: `lib/data/analyte-reference.json`
- Test: `tests/hp-classification/hazard.test.ts` (extend existing file)

**Interfaces:**
- Produces: three new entries in `lib/data/analyte-reference.json` with `analyteId` values `"mercury"`, `"chromium-vi"`, `"benzo-a-pyrene"` — consumed by Task 2's fixture (via their `analyteId` strings) and by `classifySample()`'s existing lookup logic (unchanged).

- [ ] **Step 1: Read the current `lib/data/analyte-reference.json`**

Read the file in full to confirm the exact current entry shape (each entry has `analyteId`, `canonicalNameNo`, `canonicalNameIt`, `canonicalNameEn`, `casNumber`, `substanceGroup`, `elementSymbol`, `hStatement`, `hazardClass`, `hStatements`, `mFactorAcute`, `mFactorChronic` — all fields present on every entry, `null` where not applicable, per the shape Task 2 of the earlier UI-wiring plan established).

- [ ] **Step 2: Write the failing test**

Add to `tests/hp-classification/hazard.test.ts` (append new test cases; do not modify existing ones):

```typescript
describe("classifyHazard — Eurofins concrete sample substances", () => {
  it("mercury at real EU CLP classification does not trigger HP6 when below its Acute Tox. 2 Inhalation threshold", () => {
    // Real report value: <0.0096 mg/kg TS (below LOQ) = 0.00000096% — far below the 0.5% HP6 Acute Tox. 2 Inhalation threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "mercury", resultPct: 0.00000096, hStatement: "H330", hazardClass: "Acute Tox. 2 (Inhal.)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP6).toBe(false);
  });

  it("chromium VI at real EU CLP classification does not trigger HP7 at the report's real low concentration", () => {
    // Real report value: 1.6 mg/kg TS = 0.00016% — far below the 0.1% HP7 Carc. 1B threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chromium-vi", resultPct: 0.00016, hStatement: "H350", hazardClass: "Carc. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP7).toBe(false);
  });

  it("benzo[a]pyrene at real EU CLP classification does not trigger HP7 at the report's real below-LOQ concentration", () => {
    // Real report value: <30 µg/kg TS = <0.03 mg/kg TS = 0.000003% — far below the 0.1% HP7 Carc. 1B threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "benzo-a-pyrene", resultPct: 0.000003, hStatement: "H350", hazardClass: "Carc. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP7).toBe(false);
  });
});
```

(Confirm the file's existing shared `solidMetadata` fixture name matches — read the file first; if it's named differently, use the actual name.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/hazard.test.ts`
Expected: these 3 new cases PASS immediately actually (they're just calling `classifyHazard` directly with literal test data, not depending on the new `AnalyteReference` entries at all) — this task's real failing-test-first cycle is in Step 4/5 below, which tests that the new JSON entries exist and have the right shape. Reorder: run this file's tests now only to confirm no regression (should be green), then proceed to Step 4 for the actual new-entry-existence test.

- [ ] **Step 4: Write a failing test for the new AnalyteReference entries' existence and shape**

Add to `tests/hp-classification/origin-options.test.ts` — no, this doesn't belong there. Instead, check whether a dedicated test file exists for `analyte-reference.json`'s shape (search `tests/` for one); if none exists, create `tests/hp-classification/analyte-reference.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

describe("analyte-reference.json — new Eurofins-sample entries", () => {
  it("has a mercury entry with the real sourced CLP classification", () => {
    const mercury = analyteReferenceRaw.find(a => a.analyteId === "mercury");
    expect(mercury).toBeDefined();
    expect(mercury!.casNumber).toBe("7439-97-6");
    expect(mercury!.hStatements).toEqual([
      { hStatement: "H330", hazardClass: "Acute Tox. 2 (Inhal.)" },
      { hStatement: "H360D", hazardClass: "Repr. 1B" },
      { hStatement: "H372", hazardClass: "STOT RE 1" },
    ]);
  });

  it("has a chromium-vi entry with the real sourced CLP classification", () => {
    const chromiumVi = analyteReferenceRaw.find(a => a.analyteId === "chromium-vi");
    expect(chromiumVi).toBeDefined();
    expect(chromiumVi!.hStatement).toBe("H350");
    expect(chromiumVi!.hazardClass).toBe("Carc. 1B");
  });

  it("has a benzo-a-pyrene entry with the real sourced CLP classification", () => {
    const bap = analyteReferenceRaw.find(a => a.analyteId === "benzo-a-pyrene");
    expect(bap).toBeDefined();
    expect(bap!.casNumber).toBe("50-32-8");
    expect(bap!.hStatements).toEqual(
      expect.arrayContaining([
        { hStatement: "H350", hazardClass: "Carc. 1B" },
        { hStatement: "H340", hazardClass: "Muta. 1B" },
        { hStatement: "H360", hazardClass: "Repr. 1B" },
        { hStatement: "H317", hazardClass: "Skin Sens. 1" },
        { hStatement: "H400", hazardClass: "Aquatic Acute 1" },
        { hStatement: "H410", hazardClass: "Aquatic Chronic 1" },
      ])
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: FAIL — `mercury`/`chromium-vi`/`benzo-a-pyrene` entries don't exist yet.

- [ ] **Step 6: Add the three entries to `lib/data/analyte-reference.json`**

Append these three entries to the existing array (matching the exact field shape every other entry already has — `canonicalNameNo`/`canonicalNameIt`/`canonicalNameEn`/`substanceGroup`/`elementSymbol`/`mFactorAcute`/`mFactorChronic` all present, `null` where not applicable):

```json
{
  "analyteId": "mercury",
  "canonicalNameNo": "kvikksølv",
  "canonicalNameIt": null,
  "canonicalNameEn": "mercury",
  "casNumber": "7439-97-6",
  "substanceGroup": "metal",
  "elementSymbol": null,
  "hStatement": null,
  "hazardClass": null,
  "hStatements": [
    { "hStatement": "H330", "hazardClass": "Acute Tox. 2 (Inhal.)" },
    { "hStatement": "H360D", "hazardClass": "Repr. 1B" },
    { "hStatement": "H372", "hazardClass": "STOT RE 1" }
  ],
  "mFactorAcute": null,
  "mFactorChronic": null
},
{
  "analyteId": "chromium-vi",
  "canonicalNameNo": "krom (VI)",
  "canonicalNameIt": null,
  "canonicalNameEn": "chromium VI",
  "casNumber": "18540-29-9",
  "substanceGroup": "metal",
  "elementSymbol": null,
  "hStatement": "H350",
  "hazardClass": "Carc. 1B",
  "hStatements": null,
  "mFactorAcute": null,
  "mFactorChronic": null
},
{
  "analyteId": "benzo-a-pyrene",
  "canonicalNameNo": "benzo(a)pyren",
  "canonicalNameIt": null,
  "canonicalNameEn": "benzo[a]pyrene",
  "casNumber": "50-32-8",
  "substanceGroup": "PAH",
  "elementSymbol": null,
  "hStatement": null,
  "hazardClass": null,
  "hStatements": [
    { "hStatement": "H350", "hazardClass": "Carc. 1B" },
    { "hStatement": "H340", "hazardClass": "Muta. 1B" },
    { "hStatement": "H360", "hazardClass": "Repr. 1B" },
    { "hStatement": "H317", "hazardClass": "Skin Sens. 1" },
    { "hStatement": "H400", "hazardClass": "Aquatic Acute 1" },
    { "hStatement": "H410", "hazardClass": "Aquatic Chronic 1" }
  ],
  "mFactorAcute": null,
  "mFactorChronic": null
}
```

Note: `chromiumVI`'s CAS number `18540-29-9` is the generic "chromium(VI) compounds" CAS registry reference commonly used for the unspecified/generic Cr(VI) bucket (distinct from the far stricter, specific-compound entries like chromium trioxide CAS `1333-82-0` which carries Carc. 1A — not used here since this report measures total Cr(VI), not a named specific compound).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts tests/hp-classification/hazard.test.ts`
Expected: PASS (all cases, old and new).

- [ ] **Step 8: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add lib/data/analyte-reference.json tests/hp-classification/hazard.test.ts tests/hp-classification/analyte-reference.test.ts
git commit -m "feat: add mercury, chromium VI, and benzo[a]pyrene AnalyteReference entries with sourced CLP classifications"
```

---

### Task 2: Eurofins concrete sample fixture and end-to-end regression test

**Files:**
- Create: `fixtures/eurofins-concrete-sample.json`
- Test: `tests/hp-classification/eurofins-concrete-sample.test.ts`

**Interfaces:**
- Consumes: `classifySample` (`lib/hp-classification/classify-sample.ts`), `mercury`/`chromium-vi`/`benzo-a-pyrene` and the reused `arsenic`/`lead-compounds`/`cupric-oxide`/`nickel-monoxide`/`zinc-oxide`/`cadmium-oxide` entries from Task 1's `analyte-reference.json`, `ORIGIN_OPTIONS` (`lib/hp-classification/origin-options.ts`) for the chapter-1701 origin process value.

This task's ground truth (already established in the design spec, transcribed from the real report, sample `ENAT-BØF1-BO9OB1`, Prøvenr. `439-2025-10080994`): `isHazardous === false`, `triggeredHps` is empty, EAL code resolves to `17 01 07` (mixtures of concrete/brick/tile/ceramic NOT containing hazardous substances).

- [ ] **Step 1: Confirm the chapter-1701 origin option's exact value string**

Read `lib/hp-classification/origin-options.ts` to get the exact `value` string for the chapter-1701 entry ("Concrete, brick, tile, or ceramic waste" per the earlier plan — confirm the exact lowercase/casing used for `value`, since the fixture's `originProcess` must match it exactly for the lookup to resolve).

- [ ] **Step 2: Create the fixture**

Create `fixtures/eurofins-concrete-sample.json`, transcribed from the real report (Eurofins Environment Testing Norway, Prøvenr. `439-2025-10080994`, referanse "Alta lufthavn - PFAS-prosjektet", prøvemerking `ENAT-BØF1-BO9OB1`):

```json
{
  "metadata": {
    "sampleId": "eurofins-concrete-sample-1",
    "externalReportNo": "AR-25-MM-118438-01",
    "labName": "Eurofins Environment Testing Norway",
    "customerName": "Avinor AS",
    "sampleMarking": "ENAT-BØF1-BO9OB1",
    "matrixType": "Betong",
    "samplingDate": null,
    "receiptDate": "2025-10-08",
    "originProcess": "REPLACE_WITH_EXACT_VALUE_FROM_STEP_1",
    "producerName": "Avinor AS",
    "physicalState": "solid",
    "viscosity40cMm2s": null,
    "ph": null,
    "labClassificationGiven": false,
    "labStatedEalCode": null
  },
  "dryMatterPct": 94.6,
  "testResults": [],
  "results": [
    { "resultId": "r1", "analyteId": "arsenic", "rawAnalyteName": "Arsen (As)", "resultValue": 1.8, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r2", "analyteId": "lead-compounds", "rawAnalyteName": "Bly (Pb)", "resultValue": 3.3, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r3", "analyteId": "cadmium-oxide", "rawAnalyteName": "Kadmium (Cd)", "resultValue": null, "isBelowLoq": true, "loqValue": 0.20, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r4", "analyteId": "cupric-oxide", "rawAnalyteName": "Kobber (Cu)", "resultValue": 13, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r5", "analyteId": "mercury", "rawAnalyteName": "Kvikksølv (Hg)", "resultValue": null, "isBelowLoq": true, "loqValue": 0.0096, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r6", "analyteId": "nickel-monoxide", "rawAnalyteName": "Nikkel (Ni)", "resultValue": 9.4, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r7", "analyteId": "zinc-oxide", "rawAnalyteName": "Sink (Zn)", "resultValue": 41, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r8", "analyteId": "chromium-vi", "rawAnalyteName": "Krom (VI)", "resultValue": 1.6, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r9", "analyteId": "benzo-a-pyrene", "rawAnalyteName": "Benzo(a)pyren", "resultValue": null, "isBelowLoq": true, "loqValue": 0.030, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r10", "analyteId": null, "rawAnalyteName": "Krom (Cr)", "resultValue": 15, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r11", "analyteId": null, "rawAnalyteName": "Fenantren", "resultValue": 0.320, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r12", "analyteId": null, "rawAnalyteName": "Fluoren", "resultValue": 0.076, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r13", "analyteId": null, "rawAnalyteName": "Fluoranten", "resultValue": 0.038, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true },
    { "resultId": "r14", "analyteId": null, "rawAnalyteName": "Pyren", "resultValue": 0.057, "isBelowLoq": false, "loqValue": null, "unitRaw": "mg/kg", "expressedOnDryBasis": true }
  ]
}
```

Note: `r10`-`r14` (plain chromium-total, and the four detected-but-unclassified PAH16 members) intentionally use `analyteId: null` — these substances have no `AnalyteReference` entry (per this task's and the design spec's explicit scope decision not to add CLP classifications for them), so `normalizeSample` will correctly skip them, never guessing a classification. Replace `originProcess`'s placeholder value with the exact string confirmed in Step 1 before proceeding — do not leave the placeholder in the committed file.

- [ ] **Step 3: Write the failing end-to-end regression test**

Create `tests/hp-classification/eurofins-concrete-sample.test.ts`, structured identically to `tests/hp-classification/italian-sample.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import type { TestResult } from "@/lib/hp-classification/hazard";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import fixture from "@/fixtures/eurofins-concrete-sample.json";

describe("Eurofins concrete sample regression test (Prøvenr. 439-2025-10080994, ENAT-BØF1-BO9OB1)", () => {
  it("reproduces the expected non-hazardous classification and real EAL code for a genuinely clean sample", () => {
    const metadata = fixture.metadata as SampleMetadata;
    const results = fixture.results.map(r => ({ ...r, sampleId: metadata.sampleId, method: null })) as SampleResult[];
    const analyteRef = analyteReferenceRaw as AnalyteReference[];
    const originLookup = Object.fromEntries(
      (await import("@/lib/hp-classification/origin-options")).ORIGIN_OPTIONS.map(o => [o.value, o.chapter])
    );

    const { hazard, eal } = classifySample(
      metadata,
      results,
      fixture.testResults as TestResult[],
      analyteRef,
      elementCompoundForms as ElementCompoundForm[],
      originLookup
    );

    expect(hazard.triggeredHps).toEqual([]);
    expect(hazard.isHazardous).toBe(false);
    expect(eal.code).toBe("17 01 07");
  });
});
```

Note: the dynamic `await import(...)` for `ORIGIN_OPTIONS` inside a non-async `it()` callback will not type-check as written — fix this before running by either making the test callback `async () => {...}` (Vitest supports async test callbacks natively) or, more simply, replacing the dynamic import with a normal top-level `import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";` and using `Object.fromEntries(ORIGIN_OPTIONS.map(o => [o.value, o.chapter]))` directly in the test body — use the normal top-level import, it's simpler and there's no reason to defer it.

- [ ] **Step 4: Run test to verify it fails, then iterate to green**

Run: `npx vitest run tests/hp-classification/eurofins-concrete-sample.test.ts`

Per the established discipline from the Italian sample's own end-to-end test: if `triggeredHps`/`eal.code` don't match on the first run, debug by logging `hazard.resultsByHp` and comparing against the real report's actual values (re-transcribe from the source description in this plan/spec if needed) rather than adjusting the fixture to force a pass. Given every value in this sample is genuinely far below every relevant threshold, a mismatch here most likely means a transcription error (wrong analyteId, wrong unit) or a bug, not a genuine classification disagreement — find the real cause.

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: all tests pass (Task 1 + Task 2 combined, plus the untouched Italian-sample test still green), clean build.

- [ ] **Step 6: Commit**

```bash
git add fixtures/eurofins-concrete-sample.json tests/hp-classification/eurofins-concrete-sample.test.ts
git commit -m "feat: add Eurofins concrete sample fixture and end-to-end non-hazardous regression test"
```

---

## Self-Review Notes

- **Spec coverage:** three new sourced `AnalyteReference` entries → Task 1. Fixture + end-to-end non-hazardous regression proof → Task 2. The spec's explicit non-goals (other 4 sub-reports, exhaustive PAH16/PCB7 coverage, live extraction, Stage 4) are correctly absent from both tasks — not silently included.
- **Placeholder scan:** the `REPLACE_WITH_EXACT_VALUE_FROM_STEP_1` string in Task 2 Step 2 is an intentional, disclosed placeholder that Step 1 exists specifically to resolve before the fixture is committed — Step 2's own text explicitly instructs replacing it, and Step 6's commit only happens after Steps 3-5 (which require the real value to pass) succeed. This is not a plan gap; it's sequencing a value that depends on reading another file first, same pattern as prior plans' "read the current file to confirm the exact current shape" steps.
- **Type consistency:** the three new `analyteId` strings (`mercury`, `chromium-vi`, `benzo-a-pyrene`) are used identically across Task 1's data entry, Task 1's existence test, and Task 2's fixture. The reused `analyteId` strings (`arsenic`, `lead-compounds`, `cupric-oxide`, `nickel-monoxide`, `zinc-oxide`, `cadmium-oxide`) match the exact strings already present in `lib/data/analyte-reference.json` today (verified by direct inspection before writing this plan).
