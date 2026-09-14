# Liquid-Waste-Stream Disambiguation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a genuinely liquid waste stream's real mg/l total-content data from being gated or stripped by the leachate-detection logic that exists to catch a solid sample's re-reported eluate data — using `SampleMetadata.physicalState` as the disambiguator, after hardening its Datalab-side derivation to cover a real, known-plausible slip case (Italian wording).

**Architecture:** Two independent, sequential changes. (1) Widen the keyword regex that derives `physicalState` from Datalab's `fysisk_form` field to also recognize Italian terms and a Norwegian noun form. (2) Gate both existing leachate-detection call sites in `classifySample` on `metadata.physicalState === "liquid"`, bypassing the unit-based interpretation (never the keyword-based one) for a confirmed liquid sample.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- The `physicalState`-hardening regex covers ONLY the concrete, known-real cases this pipeline's stated input languages call for: Italian `liquido`/`polvere`, and Norwegian `væske`. Do not add speculative synonyms beyond these.
- The bypass in `classifySample` applies to BOTH existing call sites (`unitFlaggedLeachingOnly` and `resultsForClassification`'s filter) — bypassing one without the other leaves the disclosed risk half-fixed.
- `keywordFlaggedLeachingOnly` (the `ristetestUtfort`/`kolonnetestUtfort`/`totalinnholdUtfort` gate) is NOT touched by this plan — a liquid sample with an explicit LLM claim of leaching-only data must still gate exactly as it does today. The bypass is scoped to the unit-based signal only.
- No new confidenceFlags note is added when the bypass fires — a liquid sample whose mg/l data is used normally should look exactly like any other normally-classified sample, not carry a special note for behaving as expected.

---

## Task 1: Harden the Datalab physicalState derivation

**Files:**
- Modify: `lib/bk-skjema/from-datalab.ts:102-104`
- Test: `tests/bk-skjema/from-datalab.test.ts`

**Interfaces:**
- Consumes: nothing new — `data.fysisk_form` (already read via the existing `str()` helper in this file).
- Produces: no signature change — `bkFromDatalab(...).source.metadata.physicalState` now also resolves `"liquid"` for `liquido`/`væske` input and `"powder"` for `polvere` input, in addition to the existing recognized terms.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bk-skjema/from-datalab.test.ts`, inside the existing `describe("bkFromDatalab", ...)` block (after the existing `"halts EAL assignment when no origin process is supplied"` test, or any convenient existing test in that block):

```typescript
  it("recognizes the Italian and Norwegian-noun physicalState terms this pipeline's own stated input languages call for", () => {
    const italianLiquid = bkFromDatalab(datalabPayload({ fysisk_form: "Liquido" }), blocks, ORIGIN);
    expect(italianLiquid.source.metadata.physicalState).toBe("liquid");

    const italianPowder = bkFromDatalab(datalabPayload({ fysisk_form: "Polvere fine" }), blocks, ORIGIN);
    expect(italianPowder.source.metadata.physicalState).toBe("powder");

    const norwegianNounLiquid = bkFromDatalab(datalabPayload({ fysisk_form: "Væske" }), blocks, ORIGIN);
    expect(norwegianNounLiquid.source.metadata.physicalState).toBe("liquid");
  });

  it("still recognizes every previously-supported physicalState term (regression coverage)", () => {
    const norwegianLiquidAdjective = bkFromDatalab(datalabPayload({ fysisk_form: "Flytende" }), blocks, ORIGIN);
    expect(norwegianLiquidAdjective.source.metadata.physicalState).toBe("liquid");

    const englishLiquid = bkFromDatalab(datalabPayload({ fysisk_form: "Liquid" }), blocks, ORIGIN);
    expect(englishLiquid.source.metadata.physicalState).toBe("liquid");

    const norwegianPowder = bkFromDatalab(datalabPayload({ fysisk_form: "Pulver" }), blocks, ORIGIN);
    expect(norwegianPowder.source.metadata.physicalState).toBe("powder");

    const englishPowder = bkFromDatalab(datalabPayload({ fysisk_form: "Powder" }), blocks, ORIGIN);
    expect(englishPowder.source.metadata.physicalState).toBe("powder");

    const solidDefault = bkFromDatalab(datalabPayload({ fysisk_form: "Fast" }), blocks, ORIGIN);
    expect(solidDefault.source.metadata.physicalState).toBe("solid");

    const unrecognizedDefaultsSolid = bkFromDatalab(datalabPayload({ fysisk_form: undefined }), blocks, ORIGIN);
    expect(unrecognizedDefaultsSolid.source.metadata.physicalState).toBe("solid");
  });
```

- [ ] **Step 2: Run the tests to verify the new terms fail**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: the first new test FAILS (`liquido`/`polvere`/`væske` all currently resolve to `"solid"`, the unrecognized default); the regression test already PASSES (these terms already work today) — confirming you're adding coverage, not fixing an existing regression.

- [ ] **Step 3: Widen the regex**

In `lib/bk-skjema/from-datalab.ts`, replace:

```typescript
  const physicalState: SampleMetadata["physicalState"] =
    /flyt|liquid/.test(physical) ? "liquid" : /pulver|powder/.test(physical) ? "powder" : "solid";
```

with:

```typescript
  const physicalState: SampleMetadata["physicalState"] =
    /flyt|liquid|liquido|væske/.test(physical) ? "liquid" :
    /pulver|powder|polvere/.test(physical) ? "powder" : "solid";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — both new tests, and the full file (no regressions on the 103-field-coverage test or any other existing test in this file, since this only widens which raw strings map to the same three existing output values).

- [ ] **Step 5: Commit**

```bash
git add lib/bk-skjema/from-datalab.ts tests/bk-skjema/from-datalab.test.ts
git commit -m "feat: recognize Italian and Norwegian-noun physicalState terms in Datalab extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Bypass leachate detection for a confirmed liquid sample

**Files:**
- Modify: `lib/hp-classification/classify-sample.ts`
- Test: `tests/hp-classification/classify-sample.test.ts`

**Interfaces:**
- Consumes: `SampleMetadata.physicalState` (already defined in `lib/hp-classification/types.ts`, unchanged) — Task 1's hardened derivation feeds this transparently, no direct dependency needed in this task's code.
- Produces: no signature change to `classifySample`/`unitsIndicateLeachate` — only the internal `unitFlaggedLeachingOnly` and `resultsForClassification` computations inside `classifySample` change.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hp-classification/classify-sample.test.ts`, inside the existing `describe("classifySample", ...)` block (a good place is right after the existing `"does NOT misclassify a mixed report by feeding a dual-reported analyte's liquid-unit row..."` test):

```typescript
  it("does NOT gate or exclude a genuinely liquid waste stream's mg/l data (physicalState: liquid bypasses the unit-based checks)", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const liquidStreamMetadata: SampleMetadata = { ...baseMetadata, physicalState: "liquid" };
    const result = classifySample(liquidStreamMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    // Without the bypass, unitsIndicateLeachate would gate this to null (100% liquid units) —
    // with the bypass, this classifies normally off its own real mg/l data, same as if it had
    // been reported in a solid-basis unit.
    expect(result.hazard.isHazardous).toBe(true);
    expect(result.hazard.resultsByHp.HP7).toBe(true);
  });

  it("does NOT strip liquid-unit rows from classification when physicalState is liquid, even in a would-be mixed-report shape", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const liquidStreamMetadata: SampleMetadata = { ...baseMetadata, physicalState: "liquid" };
    const result = classifySample(liquidStreamMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    // No exclusion note should appear — this sample's mg/l row was never excluded, so it must not
    // carry the "One or more result rows were excluded..." confidenceFlags note.
    expect(result.hazard.confidenceFlags.some(f => f.includes("excluded from HP classification"))).toBe(false);
  });

  it("a solid sample's liquid-unit data is still gated/excluded exactly as before (bypass is scoped to physicalState: liquid only)", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    // baseMetadata's physicalState is "solid" — no bypass should apply.
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull(); // still gates, same as pre-existing behavior
  });

  it("a liquid sample still gates when the keyword flag explicitly says leaching-only, regardless of the unit bypass", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const liquidLeachingOnlyMetadata: SampleMetadata = {
      ...baseMetadata, physicalState: "liquid", ristetestUtfort: true, totalinnholdUtfort: false,
    };
    const result = classifySample(liquidLeachingOnlyMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    // The keyword-based gate is untouched by the physicalState bypass — this must still gate.
    expect(result.hazard.isHazardous).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: the first two new tests FAIL (today, a liquid sample's mg/l data still gates/gets excluded exactly like a solid sample's would); the last two new tests already PASS (they describe behavior that isn't changing).

- [ ] **Step 3: Add the physicalState bypass**

In `lib/hp-classification/classify-sample.ts`, replace:

```typescript
  // Deterministic fallback (see unitsIndicateLeachate above): units win, always — even overriding
  // an explicit totalinnholdUtfort: true from the extraction LLM. See
  // docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
  const unitFlaggedLeachingOnly = unitsIndicateLeachate(results);
```

with:

```typescript
  // Deterministic fallback (see unitsIndicateLeachate above): units win, always — even overriding
  // an explicit totalinnholdUtfort: true from the extraction LLM. See
  // docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
  //
  // Bypass for a genuinely liquid waste stream: mg/l is that sample's real, legitimate
  // total-content basis, not evidence of a re-reported leachate/eluate table — the unit check
  // exists to catch a SOLID sample's eluate data, not to gate a sample that IS liquid. This
  // bypass does NOT apply to keywordFlaggedLeachingOnly above — a liquid sample can still
  // genuinely have only leaching-test data (the LLM's own flags say so), which must still gate.
  // See docs/superpowers/specs/2026-09-06-liquid-waste-stream-disambiguation-design.md.
  const unitFlaggedLeachingOnly = metadata.physicalState === "liquid" ? false : unitsIndicateLeachate(results);
```

Then replace:

```typescript
  const resultsForClassification = results.filter(r => !LIQUID_UNIT_PATTERN.test(r.unitRaw));
```

with:

```typescript
  // Same liquid-waste-stream bypass as above: a confirmed liquid sample's mg/l rows ARE its real
  // total-content basis and must never be stripped from classification input.
  const resultsForClassification = metadata.physicalState === "liquid"
    ? results
    : results.filter(r => !LIQUID_UNIT_PATTERN.test(r.unitRaw));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: PASS — all 4 new tests, plus every pre-existing test in this file (the bypass only changes behavior for `physicalState === "liquid"`; every existing test in this file uses `baseMetadata`, whose `physicalState` is `"solid"`, so none of them are affected).

- [ ] **Step 5: Run the full test suite and build**

Run: `npx vitest run`
Expected: same pre-existing/unrelated failures as before this plan (missing `DATALAB_API_KEY`/Anthropic auth in `bk/*.test.ts`), everything else green.

Run: `pnpm build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/classify-sample.ts tests/hp-classification/classify-sample.test.ts
git commit -m "feat: bypass unit-based leachate detection for a confirmed liquid waste stream

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## Known follow-ups (not built in this plan, disclosed per the spec)

- `physicalState`'s Datalab-side derivation is still keyword-regex-based even after this hardening — a sufficiently unusual `fysisk_form` phrasing this pipeline hasn't seen could still default to `"solid"` and miss the bypass.
- No new confidenceFlags note is added when the bypass fires, by deliberate design (see spec) — this is disclosed, not an oversight.
