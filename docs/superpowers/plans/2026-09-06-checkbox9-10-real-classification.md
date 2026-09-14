# Checkbox9/Checkbox10 Real Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Checkbox9/Checkbox10's hardcoded `check` values with a real signal derived from whether any detected substance actually maps to a CLP hazard classification, tri-state to match the sample's real classification outcome.

**Architecture:** A new optional field on `HazardClassification`, computed in `classify-sample.ts` (never inside `classifyHazard`, which stays untouched), threaded through `from-datalab.ts` into `BkSource`, consumed by Checkbox9/10 in `form-map.ts`.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- `classifyHazard`'s own signature and return-statement logic stay completely untouched — every prior plan on this branch has verified it byte-for-byte unchanged, and this plan preserves that.
- `HazardClassification.hasDetectedHazardousSubstance` is `boolean | null`, and OPTIONAL on the interface (`hasDetectedHazardousSubstance?: boolean | null`) — `classifyHazard`'s existing return-object literals don't set it, so the field must not be required, or every one of `classifyHazard`'s existing return statements would need editing (forbidden by the constraint above). `classify-sample.ts` sets it by mutating the object `classifyHazard` returns, the same pattern already used for the existing `confidenceFlags`-append mutation.
- In every gated path (the single `if (leachingOnly) { ... }` block in `classifySample`), `hasDetectedHazardousSubstance` is `null` — the classification genuinely couldn't run.
- In the normal (non-gated) path, `hasDetectedHazardousSubstance` is `withClp.length > 0` — computed AFTER `classifyHazard` is called, by mutation, never inside `classifyHazard` itself.
- Checkbox9/10's existing `legalCitation`/`legalCitationKey`/note logic on Checkbox10 is UNCHANGED — this plan only changes `check` (the hardcoded part) and adds a GAP note to Checkbox9 for the `null` case.

---

## Task 1: Expose hasDetectedHazardousSubstance from classifySample

**Files:**
- Modify: `lib/hp-classification/hazard.ts`
- Modify: `lib/hp-classification/classify-sample.ts`
- Test: `tests/hp-classification/classify-sample.test.ts`

**Interfaces:**
- Consumes: `withClp: NormalizedResultWithClp[]` (already built locally in `classifySample`, unchanged).
- Produces: `HazardClassification.hasDetectedHazardousSubstance?: boolean | null`. `classifySample`'s returned `hazard` object now always carries this field: `null` when gated, `withClp.length > 0` otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hp-classification/classify-sample.test.ts`, inside the existing `describe("classifySample", ...)` block:

```typescript
  it("sets hasDetectedHazardousSubstance: true when a real hazardous substance is detected above LOQ", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.hasDetectedHazardousSubstance).toBe(true);
  });

  it("sets hasDetectedHazardousSubstance: false when no detected result maps to a known CLP hazard classification", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "unregistered", rawAnalyteName: "unknown",
        resultValue: 99, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.hasDetectedHazardousSubstance).toBe(false);
  });

  it("sets hasDetectedHazardousSubstance: null when gated by the keyword leaching-only flag", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null,
      },
    ];
    const leachateOnlyMetadata: SampleMetadata = {
      ...baseMetadata, ristetestUtfort: true, kolonnetestUtfort: false, totalinnholdUtfort: false,
    };
    const result = classifySample(leachateOnlyMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.hasDetectedHazardousSubstance).toBeNull();
  });

  it("sets hasDetectedHazardousSubstance: null when gated by the unit-based fallback", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Ba",
        resultValue: 0.13, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null,
      },
      {
        resultId: "r2", sampleId: "t", analyteId: "test-carcinogen-2", rawAnalyteName: "Cr",
        resultValue: 0.059, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull(); // confirms this test genuinely hits the gate
    expect(result.hazard.hasDetectedHazardousSubstance).toBeNull();
  });

  it("sets hasDetectedHazardousSubstance: null when gated by the liquid-waste-stream physicalState message", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null,
      },
    ];
    const liquidStreamMetadata: SampleMetadata = { ...baseMetadata, physicalState: "liquid" };
    const result = classifySample(liquidStreamMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull(); // confirms this test genuinely hits the gate
    expect(result.hazard.hasDetectedHazardousSubstance).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: FAIL — `hasDetectedHazardousSubstance` is `undefined` on every result, not `true`/`false`/`null`.

- [ ] **Step 3: Add the field to HazardClassification**

In `lib/hp-classification/hazard.ts`, modify the `HazardClassification` interface — add this field after the existing `confidenceFlagsNo?: string[];` line (find it by searching for that exact line):

```typescript
  /** Whether any detected result mapped to a real CLP hazard classification (elementSymbol,
   * hStatement, or hStatements on its AnalyteReference entry) above LOQ — a narrower question
   * than isHazardous (which asks whether the whole waste crosses an HP1-15 threshold). Optional
   * because classifyHazard's own return statements never set this — classify-sample.ts computes
   * and attaches it afterward, since classifyHazard's signature/logic must stay untouched. null
   * means the classification never ran at all (the sample was gated before this could be
   * determined) — never a guessed true/false. */
  hasDetectedHazardousSubstance?: boolean | null;
```

- [ ] **Step 4: Set the field in classify-sample.ts**

In `lib/hp-classification/classify-sample.ts`, modify the gate's `hazard` object literal (inside the `if (leachingOnly) { ... }` block):

```typescript
    const hazard: HazardClassification = {
      resultsByHp: {},
      triggeringSubstancesByHp: {},
      isHazardous: null,
      triggeredHps: [],
      confidenceFlags,
      confidenceFlagsNo,
      hasDetectedHazardousSubstance: null,
    };
```

Then, in the normal (non-gated) path, modify the block right after `const hazard = classifyHazard(withClp, metadata, testResults);` — this is the SAME block that already appends the liquid-exclusion confidenceFlags note, so add the new assignment right before that existing `if` statement:

```typescript
  const hazard = classifyHazard(withClp, metadata, testResults);
  const eal = assignEalCode(hazard.isHazardous, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);

  hazard.hasDetectedHazardousSubstance = withClp.length > 0;

  // Traceability for the exclusion above: when this sample proceeded to real classification
```

(The comment and the `if (resultsForClassification.length < results.length) { ... }` block that follows are UNCHANGED — only the new `hazard.hasDetectedHazardousSubstance = withClp.length > 0;` line is inserted before them.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: PASS — all 5 new tests, plus every pre-existing test in this file (this is purely additive to the returned object; no existing assertion reads or depends on this new field).

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/hazard.ts lib/hp-classification/classify-sample.ts tests/hp-classification/classify-sample.test.ts
git commit -m "feat: expose hasDetectedHazardousSubstance from classifySample

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Wire real Checkbox9/Checkbox10

**Files:**
- Modify: `lib/bk-skjema/from-datalab.ts`
- Modify: `lib/bk-skjema/form-map.ts`
- Test: `tests/bk-skjema/from-datalab.test.ts`

**Interfaces:**
- Consumes: `classification.hazard.hasDetectedHazardousSubstance` (Task 1).
- Produces: `BkSource.hasDetectedHazardousSubstance: boolean | null`. Checkbox9/Checkbox10's `check` now derives from it instead of being hardcoded.

- [ ] **Step 1: Write the failing test**

Add to `tests/bk-skjema/from-datalab.test.ts`, after the existing `"every citation-bearing field carries the correct legalCitationKey..."` test:

```typescript
  it("Checkbox9/Checkbox10 derive check from hasDetectedHazardousSubstance, tri-state", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);

    const detected: BkSource = { ...source, hasDetectedHazardousSubstance: true };
    const detectedFields = buildBkFields(detected);
    expect(detectedFields.find(f => f.field === "Checkbox9")!.check).toBe(false);
    expect(detectedFields.find(f => f.field === "Checkbox10")!.check).toBe(true);

    const notDetected: BkSource = { ...source, hasDetectedHazardousSubstance: false };
    const notDetectedFields = buildBkFields(notDetected);
    expect(notDetectedFields.find(f => f.field === "Checkbox9")!.check).toBe(true);
    expect(notDetectedFields.find(f => f.field === "Checkbox10")!.check).toBe(false);

    const unknown: BkSource = { ...source, hasDetectedHazardousSubstance: null };
    const unknownFields = buildBkFields(unknown);
    expect(unknownFields.find(f => f.field === "Checkbox9")!.check).toBe(false);
    expect(unknownFields.find(f => f.field === "Checkbox10")!.check).toBe(false);
    expect(unknownFields.find(f => f.field === "Checkbox9")!.note).toContain("GAP");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — `Checkbox9.check` is always `false` and `Checkbox10.check` is always `true` regardless of the constructed `BkSource`.

- [ ] **Step 3: Thread the field through BkSource**

In `lib/bk-skjema/form-map.ts`, find the `BkSource` interface's `isHazardous: boolean | null;` line and add immediately after it:

```typescript
  /** Whether any detected result mapped to a real CLP hazard classification above LOQ — see
   * HazardClassification.hasDetectedHazardousSubstance in lib/hp-classification/hazard.ts for
   * the full explanation of why this is a narrower question than isHazardous. */
  hasDetectedHazardousSubstance: boolean | null;
```

In `lib/bk-skjema/from-datalab.ts`, find the line `isHazardous: classification.hazard.isHazardous,` and add immediately after it:

```typescript
    hasDetectedHazardousSubstance: classification.hazard.hasDetectedHazardousSubstance ?? null,
```

(The `?? null` handles the fact that `HazardClassification.hasDetectedHazardousSubstance` is optional/`undefined`-possible on the type, per Task 1's Global Constraint — `classifySample` always actually sets it to a real value in practice, but the threading here degrades safely to `null` rather than `undefined` if that were ever not true.)

- [ ] **Step 4: Replace the hardcoded Checkbox9/Checkbox10**

In `lib/bk-skjema/form-map.ts`, replace:

```typescript
    { field: "Checkbox9", label: "Innhold av farlige stoffer: Nei", src: "derived", check: false },
    { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived", check: true,
```

with:

```typescript
    { field: "Checkbox9", label: "Innhold av farlige stoffer: Nei", src: "derived",
      check: s.hasDetectedHazardousSubstance === false,
      note: s.hasDetectedHazardousSubstance === null ? "GAP: classification could not run — see TextField38" : undefined },
    { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived",
      check: s.hasDetectedHazardousSubstance === true,
```

(Everything after this on Checkbox10's object literal — the `legalCitation`/`legalCitationKey`/`note` lines — is UNCHANGED; only the `check:` line and the object's opening are modified. Checkbox9 previously had no other properties, so its full replacement above is complete.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — the new test, plus every pre-existing test in this file (this changes `check` on two fields whose value no prior test asserted a specific way — confirm this by reading the diff of failures in Step 2 versus passes here; if any pre-existing test DID assert Checkbox9/10's `check` value against the old hardcoded behavior, update that assertion to match the new, correct derivation instead of the old hardcoded one, and note this in your report).

- [ ] **Step 6: Run the full test suite and build**

Run: `npx vitest run`
Expected: same pre-existing/unrelated failures as before this plan (missing `DATALAB_API_KEY`/Anthropic auth in `bk/*.test.ts`), everything else green.

Run: `pnpm build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/bk-skjema/from-datalab.ts lib/bk-skjema/form-map.ts tests/bk-skjema/from-datalab.test.ts
git commit -m "feat: derive Checkbox9/Checkbox10 from real hasDetectedHazardousSubstance, tri-state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## Known follow-ups (not built in this plan, disclosed per the spec)

- Checkbox10's existing note text ("hazardous substances detected above LOQ, though all below HP thresholds") is a fixed string that doesn't distinguish "many substances detected" from "exactly one, barely above LOQ" — out of scope, only `check` was hardcoded/wrong.
