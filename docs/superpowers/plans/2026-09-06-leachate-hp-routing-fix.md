# Leachate-Only Sample HP Routing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a leachate-only sample (ristetest/kolonnetest with no total-content data) from
getting a fabricated HP1–15 hazardous/non-hazardous verdict, and make `isHazardous`'s honest
third state — "cannot be determined" — visible and safe everywhere it's consumed, not just in
the BK-skjema output.

**Architecture:** `HazardClassification.isHazardous` widens from `boolean` to `boolean | null`.
`classify-sample.ts` is the sole place that decides whether to gate (it never calls
`classifyHazard` at all when leaching-only data is detected — `classifyHazard` itself is
unmodified and always returns a real `boolean` when it runs). The `null` then flows through
`assignEalCode`, the BK-skjema field wiring (reusing the already-built compliance-citation
mechanism — zero new legal-paragraph seeding needed, § 9-6 is already cached), and every real
downstream consumer found by a full-tree grep: facility-matching (safety-relevant — must not
silently treat indeterminate as non-hazardous), the committed case data model, dashboard counts,
case detail pages, the depot map, and the older wizard flow.

**Tech Stack:** TypeScript, Next.js, React, Vitest — all already in place. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-leachate-hp-routing-design.md` (see its full
  "consumer inventory" table — copied into task file lists below, one task per logical group).
- **Full nullable refactor, confirmed with the user** over a narrower additive-flag alternative —
  `isHazardous: boolean | null` everywhere it's consumed, not just in `lib/hp-classification/*`.
- **Default-absent handling**: an absent/`undefined` `totalinnholdUtfort` means "assume total
  content present" (today's existing behavior) — the gate only fires when `totalinnholdUtfort`
  is **explicitly `false`** AND at least one of `ristetestUtfort`/`kolonnetestUtfort` is
  explicitly `true`. Never gate on a missing field.
- **Safety-relevant**: `lib/hp-classification/facility-match.ts`'s falsy-`isHazardous` branch
  currently *assumes non-hazardous* — `null` must route to the existing `eligible: "insufficient
  data"` state instead, never fall through to that assumption.
- **Checkbox9/10 in `form-map.ts` are NOT part of this cascade** — confirmed by direct code
  inspection, they're hardcoded and never read `s.isHazardous`. Only Checkbox1/3/4/6 and
  `TextField41` do. Do not touch Checkbox9/10.
- **Single source of truth for the indeterminate-state explanation text**: it must exist as
  exactly one `confidenceFlags` entry, computed once in `classify-sample.ts`. Every downstream
  renderer (BK-skjema notes, `buildDescription`, wizard UI) must quote that same string, never
  restate an independent paraphrase.
- **§ 9-6 is already seeded** (from the prior landfill-category plan) — this fix needs a new
  `resolve-legal-citations.ts` `RESOLVED_FIELDS` entry pointing at the SAME already-cached
  paragraph, zero new seeding, zero new Lovdata research.
- **Per-sample granularity, already correct**: `buildBkPageSchema()` (where the three new
  extraction flags live) is extracted per sample, not per document — a bundle with a mixed
  document (one sample with total content, one leaching-only) must produce two independent
  gating decisions. Proven by a dedicated test, not assumed.
- **Every task's OWN new/modified test files must pass** (`npx vitest run <that task's test
  files>`), matching this repo's existing verification standard. **`pnpm build` (whole-tree
  type-check) is explicitly NOT required to be green until Task 5's completion** — this refactor
  touches ~15 files across the app, too many to land atomically the way a smaller reshape did
  earlier this session; each task's own type change is real and tested, but the wider tree only
  finishes updating at Task 5. Every task's own steps say so explicitly where relevant — this is
  a deliberate, disclosed exception to the "every task ends green" default, not a contradiction to
  paper over.

---

### Task 1: Tri-state `isHazardous` in the classification core

**Files:**
- Modify: `lib/hp-classification/types.ts` (add 3 optional fields to `SampleMetadata`)
- Modify: `lib/hp-classification/hazard.ts` (type only — `isHazardous: boolean | null`)
- Modify: `lib/hp-classification/classify-sample.ts` (the actual gating logic)
- Modify: `lib/hp-classification/eal.ts` (new `null` branch in `assignEalCode`)
- Test: `tests/hp-classification/classify-sample.test.ts`
- Test: `tests/hp-classification/eal.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SampleMetadata` gains `ristetestUtfort?: boolean; kolonnetestUtfort?: boolean;
  totalinnholdUtfort?: boolean | null` (all optional — existing test fixtures across the repo
  that construct `SampleMetadata` literals without these fields continue to compile unchanged).
  `HazardClassification.isHazardous: boolean | null` (was `boolean`). `EalAssignment` unchanged in
  shape; `assignEalCode`'s first param becomes `isHazardous: boolean | null`. All three are
  consumed by every later task in this plan.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hp-classification/classify-sample.test.ts` (the file already has a `baseMetadata`
fixture — reuse it, spreading overrides; read the file first to confirm the exact fixture
variable name and its full field list before writing these):

```ts
  it("gates HP classification to isHazardous: null when only leaching-test data exists (no total content)", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null,
      },
    ];
    const leachateOnlyMetadata: SampleMetadata = {
      ...baseMetadata,
      ristetestUtfort: true,
      kolonnetestUtfort: false,
      totalinnholdUtfort: false,
    };
    const result = classifySample(leachateOnlyMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull();
    expect(result.hazard.confidenceFlags.some(f => f.includes("leach") || f.includes("total content"))).toBe(true);
    expect(result.eal.code).toBeNull();
  });

  it("does NOT gate when totalinnholdUtfort is absent (default-absent means assume present)", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const metadataWithLeachFlagOnly: SampleMetadata = { ...baseMetadata, ristetestUtfort: true };
    const result = classifySample(metadataWithLeachFlagOnly, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(true); // unaffected — same as the existing non-gated test above
  });

  it("does NOT gate when totalinnholdUtfort is explicitly true, even alongside a leaching flag", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const mixedMetadata: SampleMetadata = {
      ...baseMetadata, ristetestUtfort: true, totalinnholdUtfort: true,
    };
    const result = classifySample(mixedMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(true);
  });
```

Add to `tests/hp-classification/eal.test.ts`:

```ts
  it("returns no code and a clear message when isHazardous is null (indeterminate)", () => {
    const result = assignEalCode(null, "escavo terre e rocce", null, originLookup);
    expect(result.code).toBeNull();
    expect(result.confidence).toContain("indeterminate");
    expect(result.confidenceNo).toContain("ikke bestemt");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts tests/hp-classification/eal.test.ts`
Expected: FAIL — `SampleMetadata` doesn't have the three new fields yet (TS error), and
`assignEalCode` doesn't accept `null`/doesn't have the new branch.

- [ ] **Step 3: Add the three optional fields to `SampleMetadata`**

In `lib/hp-classification/types.ts`, add to the `SampleMetadata` interface (after
`labStatedEalCode`):

```ts
  /** True only if the report contains ristetest (shake test) results. Absent = unknown/false. */
  ristetestUtfort?: boolean;
  /** True only if the report contains kolonnetest (column test) results. Absent = unknown/false. */
  kolonnetestUtfort?: boolean;
  /** True only if the report contains total-content (bulk) analysis results. Absent/null =
   * assume present (today's existing behavior) — HP classification is only gated when this is
   * explicitly false alongside a leaching flag. Never treat "absent" as "confirmed absent." */
  totalinnholdUtfort?: boolean | null;
```

- [ ] **Step 4: Widen `HazardClassification.isHazardous`'s type**

In `lib/hp-classification/hazard.ts`, change:

```ts
  isHazardous: boolean;
```

to:

```ts
  /** null means "cannot be determined from the data available" — never a guessed true/false. */
  isHazardous: boolean | null;
```

No other change to this file — `classifyHazard` itself is never called on gated data (see Step
5), so every real invocation of it still produces a genuine `boolean` via
`triggeredHps.length > 0`, unchanged.

- [ ] **Step 5: Add the gating logic to `classifySample`**

In `lib/hp-classification/classify-sample.ts`, before the existing `normalizeSample` call, add
the gate and short-circuit:

```ts
export function classifySample(
  metadata: SampleMetadata,
  results: SampleResult[],
  testResults: TestResult[],
  analyteRef: AnalyteReference[],
  compoundForms: ElementCompoundForm[],
  originToChapterLookup: Record<string, string>
): { hazard: HazardClassification; eal: EalAssignment; noDataWarning: boolean } {
  // Real regulatory gap, not a bug: ristetest/kolonnetest (leaching test) results are governed
  // by avfallsforskriften kap. 9 (landfill acceptance criteria — a different, delegated
  // question), never by kap. 11's HP1-15 hazard classification, which requires total-content
  // data. A document confirmed to carry ONLY leaching-test data cannot answer "is this
  // hazardous waste" — classifyHazard is never called in that case; isHazardous is null, never
  // a fabricated true/false. See docs/superpowers/specs/2026-09-05-leachate-hp-routing-design.md.
  const leachingOnly =
    (metadata.ristetestUtfort === true || metadata.kolonnetestUtfort === true) &&
    metadata.totalinnholdUtfort === false;

  if (leachingOnly) {
    const hazard: HazardClassification = {
      resultsByHp: {},
      triggeringSubstancesByHp: {},
      isHazardous: null,
      triggeredHps: [],
      confidenceFlags: [
        "HP1-15 hazard classification not performed: this sample has leaching-test " +
        "(ristetest/kolonnetest) data only, no total content data — leaching-test results are " +
        "landfill-acceptance-criteria data (avfallsforskriften kap. 9), a different regulatory " +
        "question from hazardous-waste classification (kap. 11), which requires total content. " +
        "Manual review required.",
      ],
    };
    const eal = assignEalCode(null, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);
    return { hazard, eal, noDataWarning: false };
  }

  const normalized = normalizeSample(metadata, results, analyteRef);
  const noDataWarning = normalized.length === 0;
  // ... rest of the function unchanged from here ...
```

Read the rest of the existing function body (already in the file, untouched below this point) to
confirm the merge point is correct — the `const normalized = ...` line is where the new code
above hands off to the existing logic.

- [ ] **Step 6: Add the `null` branch to `assignEalCode`**

In `lib/hp-classification/eal.ts`, change the signature and add the new branch as the FIRST
check (before the existing `!originProcess` check, since an indeterminate hazard status makes an
EAL code assignment impossible regardless of origin/process):

```ts
export function assignEalCode(
  isHazardous: boolean | null,
  originProcess: string | null,
  labStatedEalCode: string | null,
  originToChapterLookup: Record<string, string>
): EalAssignment {
  if (isHazardous === null) {
    return {
      code: null, description: null,
      confidence: "indeterminate — hazard status could not be determined (leaching-test data only), cannot assign an EAL code",
      confidenceNo: "ikke bestemt — farestatus kunne ikke fastslås (kun utlekkingstest-data), kan ikke tildele EAL-kode",
    };
  }

  if (!originProcess) {
```

The rest of the function is unchanged — every existing branch already only runs when
`isHazardous` is a real `boolean`, and TypeScript's narrowing after the `=== null` check above
makes that automatic.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts tests/hp-classification/eal.test.ts`
Expected: PASS — all tests pass, including the 3 new classify-sample cases and 1 new eal case.

- [ ] **Step 8: Run the full suite and build**

Run: `npx vitest run`
Expected: FAIL initially — `hazard.test.ts` and other files across the tree construct
`HazardClassification`/consume `isHazardous` and may now show TypeScript errors from the widened
type flowing through unmodified consumers (facility-match.ts, form-map.ts, from-datalab.ts, and
the app-level files) — this is EXPECTED at this point in the plan; those are fixed in Tasks 2-5.
Confirm the failures are all TYPE errors in files this task doesn't touch, not new failures in
`classify-sample.test.ts`/`eal.test.ts`/`hazard.test.ts` themselves.

Run: `pnpm build`
Expected: FAIL with TypeScript errors in `lib/bk-skjema/from-datalab.ts`,
`lib/bk-skjema/form-map.ts`, `lib/hp-classification/facility-match.ts`, and app-level files —
also expected at this point; each is fixed in a later task.

- [ ] **Step 9: Commit**

```bash
git add lib/hp-classification/types.ts lib/hp-classification/hazard.ts \
        lib/hp-classification/classify-sample.ts lib/hp-classification/eal.ts \
        tests/hp-classification/classify-sample.test.ts tests/hp-classification/eal.test.ts
git commit -m "feat(hp-classification): gate HP1-15 classification on leaching-only samples

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extraction schema + Datalab pipeline wiring

**Files:**
- Modify: `lib/bk-skjema/datalab.ts` (add `totalinnhold_utfort` to the extraction schema)
- Modify: `lib/bk-skjema/from-datalab.ts` (thread the three flags from the raw payload into
  `SampleMetadata`)
- Test: `tests/bk-skjema/from-datalab.test.ts`

**Interfaces:**
- Consumes: `SampleMetadata`'s three new optional fields, `classifySample`'s gating (Task 1).
- Produces: nothing new consumed by later tasks — this task proves the real Datalab pipeline
  correctly reaches Task 1's gate.

- [ ] **Step 1: Write the failing tests**

This file's real fixture helper is `datalabPayload(overrides = {})` (defined near the top of
`tests/bk-skjema/from-datalab.test.ts`) — it returns a full payload object and spreads `overrides`
over it, and every existing test calls `bkFromDatalab(datalabPayload(...), blocks, ORIGIN)` using
the module-level `blocks` (from `flattenBlocks(CONVERT_JSON)`) and `ORIGIN` constants already in
this file. Its default `analyseresultater` rows use real Datalab field names: `parameter`,
`analyte_id`, `verdi`, `under_loq`, `loq`, `enhet`, `verdi_citations` (NOT `navn`/
`under_deteksjonsgrense`/`metode` — use the real names below). Add, inside the existing
`describe("bkFromDatalab", ...)` block:

```ts
  it("gates to isHazardous: null for a leaching-test-only sample (ristetest metals, no total content)", () => {
    const { classification, source } = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        kolonnetest_utfort: false,
        totalinnhold_utfort: false,
        analyseresultater: [
          { parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.17, under_loq: false, loq: 0.5, enhet: "mg/kg TS" },
          { parameter: "Kadmium (Cd)", analyte_id: "cadmium-oxide", verdi: 0.189, under_loq: false, loq: 0.05, enhet: "mg/kg TS" },
        ],
      }),
      blocks,
      ORIGIN
    );
    expect(classification.hazard.isHazardous).toBeNull();
    expect(source.isHazardous).toBeNull();
    expect(classification.eal.code).toBeNull();
  });

  it("does not gate a normal total-content report — regression, using this file's default fixture", () => {
    // datalabPayload() with NO overrides has no ristetest_utfort/totalinnhold_utfort at all
    // (both absent) — per the default-absent rule, this must NOT gate, exactly like every other
    // existing test in this file that already calls bkFromDatalab(datalabPayload(), blocks, ORIGIN).
    const { classification } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    expect(classification.hazard.isHazardous).not.toBeNull();
  });

  it("gates per-sample, not per-document: sample A has both test types, sample B has leaching only", () => {
    const sampleA = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        totalinnhold_utfort: true,
        analyseresultater: [{ parameter: "Benzo[a]pyren", analyte_id: "benzo-a-pyrene", verdi: 2.5, under_loq: false, loq: 0.1, enhet: "mg/kg TS" }],
      }),
      blocks,
      ORIGIN
    );
    const sampleB = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        totalinnhold_utfort: false,
        analyseresultater: [{ parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.17, under_loq: false, loq: 0.5, enhet: "mg/kg TS" }],
      }),
      blocks,
      ORIGIN
    );
    expect(sampleA.classification.hazard.isHazardous).not.toBeNull();
    expect(sampleB.classification.hazard.isHazardous).toBeNull();
  });
```

Confirmed real: `benzo-a-pyrene` exists in `lib/data/analyte-reference.json` (verified directly
during planning) — use it as written above, no substitution needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — `totalinnhold_utfort` isn't read yet, `SampleMetadata` doesn't get the three
flags populated from `from-datalab.ts`.

- [ ] **Step 3: Add `totalinnhold_utfort` to the extraction schema**

In `lib/bk-skjema/datalab.ts`, add immediately after the existing two flags (line ~319):

```ts
      totalinnhold_utfort: { type: "boolean", description: "True bare hvis rapporten inneholder resultater fra totalinnhold (bulk) analyse, ikke bare utlekking/eluat" },
```

- [ ] **Step 4: Thread the three flags through `from-datalab.ts`**

Add a `bool` helper alongside the existing `num`/`str` helpers (near line 39-40):

```ts
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
```

In the `metadata: SampleMetadata` object literal (around line 105-121), add after
`labStatedEalCode: null,`:

```ts
    ristetestUtfort: bool(data.ristetest_utfort) ?? undefined,
    kolonnetestUtfort: bool(data.kolonnetest_utfort) ?? undefined,
    totalinnholdUtfort: bool(data.totalinnhold_utfort),
```

Note `ristetestUtfort`/`kolonnetestUtfort` convert a `bool()` `null` to `undefined` (matching
their `?: boolean` optional-not-nullable type from Task 1), while `totalinnholdUtfort` keeps
`null` as a real, distinct value (matching its `?: boolean | null` type) — this is deliberate:
"we don't know if a leaching test ran" behaves like "no" either way (the gate needs at least one
leaching flag `true` to fire), but "we don't know if total content exists" must NOT collapse into
`false` — only an explicit `false` gates, per the Global Constraints' default-absent rule.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — all tests pass, including the 3 new cases.

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: same remaining type errors as Task 1's Step 8 in the files this task doesn't touch
(`form-map.ts`, `facility-match.ts`, app-level files) — `from-datalab.test.ts` itself and
everything in `lib/hp-classification/` must be fully green now.

Run: `pnpm build`
Expected: FAIL — `lib/bk-skjema/form-map.ts` still assumes `isHazardous: boolean` (fixed in
Task 3); this is expected.

- [ ] **Step 7: Commit**

```bash
git add lib/bk-skjema/datalab.ts lib/bk-skjema/from-datalab.ts tests/bk-skjema/from-datalab.test.ts
git commit -m "feat(hp-classification): thread leaching/total-content flags from Datalab extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: BK-skjema wiring — Checkbox1/3/4/6, TextField41, and the indeterminate citation

**Files:**
- Modify: `lib/bk-skjema/form-map.ts` (`BkSource.isHazardous` type, Checkbox1/3/4/6,
  `TextField41`, `buildDescription`)
- Modify: `lib/bk-skjema/from-datalab.ts` (thread `confidenceFlags` through to `BkSource`)
- Modify: `lib/compliance/resolve-legal-citations.ts` (new `RESOLVED_FIELDS` entry)
- Test: `tests/bk-skjema/from-datalab.test.ts`
- Test: `tests/compliance/resolve-legal-citations.test.ts`

**Interfaces:**
- Consumes: `isHazardous: boolean | null` (Tasks 1-2), the existing `resolveLegalCitations`/
  `RESOLVED_FIELDS` mechanism (already built, unmodified except for the new entry).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test for the new legal-citation config entry**

Add to `tests/compliance/resolve-legal-citations.test.ts` (reuse the file's existing
`fakeStore`/`p9_5`/`p9_6` fixtures — read the file first to confirm their exact current names):

```ts
  it("resolves hazard-indeterminate-basis to § 9-6 alone (reusing the already-seeded paragraph, no new location)", async () => {
    const store = fakeStore([p9_6]); // only § 9-6 needed — no § 9-5 for this field
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hazard-indeterminate-basis"]?.citations).toHaveLength(1);
    expect(result["hazard-indeterminate-basis"]?.citations[0].paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(result["hazard-indeterminate-basis"]?.citations[0].primary).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: FAIL — `"hazard-indeterminate-basis"` isn't in `RESOLVED_FIELDS` yet.

- [ ] **Step 3: Add the new `RESOLVED_FIELDS` entry**

In `lib/compliance/resolve-legal-citations.ts`, add to the `RESOLVED_FIELDS` array (after the
existing `"deponi-category-basis"` entry):

```ts
  {
    key: "hazard-indeterminate-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "9", paragraph: "6", queryText: "avfall som tillates deponert på de ulike deponikategoriene", primary: true },
    ],
  },
```

This reuses the SAME § 9-6 location already used by `"deponi-category-basis"` — no new seeding,
no new Lovdata research. `search()`'s cache-hit path resolves it from the already-cached row.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: PASS — all tests pass, including the new one.

- [ ] **Step 5: Write the failing BK-skjema tests**

Use the same real `datalabPayload()`/`blocks`/`ORIGIN` fixtures confirmed in Task 2. Add, inside
the same `describe("bkFromDatalab", ...)` block:

```ts
  it("Checkbox1/3/4/6 and TextField41 render an indeterminate state, grounded in § 9-6, when isHazardous is null", () => {
    const legalCitations = {
      "hazard-indeterminate-basis": {
        citations: [{
          paragraphId: "no-avfallsforskriften-9-6", label: "Avfallsforskriften § 9-6",
          sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6",
          verifiedAt: "2026-09-06T00:00:00.000Z", disputed: false, primary: true,
        }],
      },
    };
    const { fields, classification } = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        totalinnhold_utfort: false,
        analyseresultater: [{ parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.17, under_loq: false, loq: 0.5, enhet: "mg/kg TS" }],
      }),
      blocks,
      ORIGIN,
      legalCitations
    );
    const checkbox1 = fields.find(f => f.field === "Checkbox1")!;
    const checkbox3 = fields.find(f => f.field === "Checkbox3")!;
    const checkbox4 = fields.find(f => f.field === "Checkbox4")!;
    const checkbox6 = fields.find(f => f.field === "Checkbox6")!;
    const textField41 = fields.find(f => f.field === "TextField41")!;

    expect(checkbox1.check).toBe(false);
    expect(checkbox3.check).toBe(false);
    expect(checkbox4.check).toBe(false);
    expect(checkbox6.check).toBe(false);
    expect(checkbox1.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(textField41.value).toContain("ikke bestemt");

    // Single-source-of-truth: the note text must be the EXACT confidenceFlags string, not an
    // independently-paraphrased one.
    expect(checkbox1.note).toBe(classification.hazard.confidenceFlags[0]);
  });
```

Confirm `bkFromDatalab`'s real 4th parameter name and position (already established by the prior
trust-model plan as `legalCitations?: Record<string, LegalCitationView | null>`, last positional
param) matches this call — read the function's current signature first if in doubt.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — Checkbox1/3/4/6 still assume `isHazardous` is a plain boolean.

- [ ] **Step 7: Thread `confidenceFlags` and `legalCitations` into `BkSource` in `from-datalab.ts`**

Add a 4th parameter to `bkFromDatalab` (find its current signature — it already takes
`legalCitations?: Record<string, LegalCitationView | null>` per the prior plan's Task 3; confirm
this and do not duplicate it). In the `source: BkSource` object literal, `isHazardous:
classification.hazard.isHazardous` (unchanged reference — already `boolean | null` now, flows
through automatically) needs a companion field:

```ts
    isHazardous: classification.hazard.isHazardous,
    hazardConfidenceFlags: classification.hazard.confidenceFlags,
```

Add `hazardConfidenceFlags: string[]` to `BkSource` in `form-map.ts` (see Step 8) so this compiles.

- [ ] **Step 8: Update `lib/bk-skjema/form-map.ts`**

Change `BkSource.isHazardous`'s type (find the line, currently `isHazardous: boolean;`):

```ts
  isHazardous: boolean | null;
  /** Set only when isHazardous is null — the single-source explanation every indeterminate-state
   * note below must quote verbatim, never independently paraphrase. */
  hazardConfidenceFlags: string[];
```

Replace the Checkbox1/3/4/6 entries (find them — currently `check: !s.isHazardous` /
`check: s.isHazardous` per the code already read during planning) with:

```ts
    { field: "Checkbox1", label: "Deponi for ordinært avfall", src: "derived",
      check: s.isHazardous === null ? false : !s.isHazardous,
      legalCitation: s.isHazardous === null ? (s.legalCitations?.["hazard-indeterminate-basis"] ?? null) : (s.legalCitations?.["deponi-category-basis"] ?? null),
      note: s.isHazardous === null ? s.hazardConfidenceFlags[0] : "CONSERVATIVE: inert cannot be claimed without a leaching test" },
    { field: "Checkbox2", label: "Deponi for inert avfall", src: "derived", check: false,
      legalCitation: s.legalCitations?.["deponi-category-basis"] ?? null,
      note: "requires ristetest/kolonnetest results, which a standard total-analysis report lacks" },
    { field: "Checkbox3", label: "Deponi for farlig avfall", src: "derived",
      check: s.isHazardous === true,
      legalCitation: s.isHazardous === null ? (s.legalCitations?.["hazard-indeterminate-basis"] ?? null) : (s.legalCitations?.["deponi-category-basis"] ?? null) },
    { field: "Checkbox4", label: "Avfallstype: Ordinært avfall", src: "derived",
      check: s.isHazardous === null ? false : !s.isHazardous },
    { field: "Checkbox5", label: "Avfallstype: Inert avfall", src: "derived", check: false },
    { field: "Checkbox6", label: "Avfallstype: Farlig avfall", src: "derived",
      check: s.isHazardous === true },
```

Replace `TextField41`'s value (find it — currently a ternary on `s.isHazardous`):

```ts
    { field: "TextField41", label: "Må deponiet treffe ekstra forhåndsregler?", src: "derived",
      value: s.isHazardous === null
        ? `Ikke bestemt — ${s.hazardConfidenceFlags[0] ?? "farestatus kunne ikke fastslås"}`
        : s.isHazardous ? "Ja — se analyserapport." : "Nei — ingen HP-kategori utløst." },
```

In `buildDescription` (find the line `s.isHazardous ? \`avfallet er farlig avfall.\` : ...`),
add a third branch:

```ts
    s.isHazardous === null
      ? `HP-vurdering ikke mulig: ${s.hazardConfidenceFlags[0] ?? "kun utlekkingstest-data foreligger"}.`
      : s.isHazardous ? `avfallet er farlig avfall.` : `ingen HP-kategori utløst, avfallet er ikke farlig avfall.`,
```

Note: the EAL-code line below it (`s.eal.code ? ... : \`EAL-kode ikke tildelt: ${s.eal.confidenceNo}.\``)
is already correct unchanged — `assignEalCode`'s new `null`-branch message (Task 1) already
covers the indeterminate case via `s.eal.confidenceNo`, no further change needed there.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — all tests pass, including the 103-field-count invariant (this task only changes
existing fields' `check`/`note`/`legalCitation` values, never adds/removes a field) and the new
indeterminate-state test.

- [ ] **Step 10: Run the full suite and build**

Run: `npx vitest run`
Expected: `lib/hp-classification/`, `lib/bk-skjema/`, and `lib/compliance/` all green now. Any
remaining failures should be confined to `facility-match.ts`/app-level files (Tasks 4-5).

Run: `pnpm build`
Expected: FAIL — `lib/hp-classification/facility-match.ts` and app-level files still assume
`isHazardous: boolean`; expected until Tasks 4-5 land.

- [ ] **Step 11: Commit**

```bash
git add lib/bk-skjema/form-map.ts lib/bk-skjema/from-datalab.ts lib/compliance/resolve-legal-citations.ts \
        tests/bk-skjema/from-datalab.test.ts tests/compliance/resolve-legal-citations.test.ts
git commit -m "feat(compliance): ground the indeterminate hazard state in § 9-6, wire Checkbox1/3/4/6

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Facility-matching safety fix

**Files:**
- Modify: `lib/hp-classification/facility-match.ts`
- Modify: `app/api/facility-match/route.ts`
- Test: `tests/hp-classification/facility-match.test.ts`

**Interfaces:**
- Consumes: `isHazardous: boolean | null` (Task 1).
- Produces: `FacilityMatchInput.isHazardous: boolean | null` — consumed only by this file's own
  internal logic and its API route; no later task depends on new exports here.

- [ ] **Step 1: Confirmed against the real file — only `checkStoleheia` needs this fix**

Read directly during planning: `matchFacilities(input: FacilityMatchInput): { stoleheia:
FacilityMatchResult; returkraft: FacilityMatchResult }` — an OBJECT keyed by facility id, not an
array. `checkStoleheia` is the ONLY function that reads `input.isHazardous` (its `if
(input.isHazardous)` branch, with a falsy-else that currently describes an "ordinary/contaminated
mass path"). `checkReturkraft` branches entirely on `matrixType`/`ealCode`/the avfallsstoffnummer
crosswalk — it never references `isHazardous` at all, so it needs NO change here; do not touch
it.

- [ ] **Step 2: Write the failing test**

Read `tests/hp-classification/facility-match.test.ts`'s existing test style first (confirm how
existing tests destructure `matchFacilities`'s `{ stoleheia, returkraft }` return — reuse that
exact pattern). Add:

```ts
  it("stoleheia routes to insufficient-data, NOT the non-hazardous assumption, when isHazardous is null", () => {
    const input: FacilityMatchInput = { isHazardous: null, ealCode: "17 05 04", matrixType: "jord" };
    const { stoleheia } = matchFacilities(input);
    expect(stoleheia.eligible).toBe("insufficient data");
    expect(stoleheia.reason ?? "").toMatch(/indeterminate|hazard status/i);
    // Must NOT be the existing non-hazardous branch's reason text:
    expect(stoleheia.reason ?? "").not.toContain("ordinary/contaminated mass path");
  });

  it("returkraft is unaffected by isHazardous: null — its eligibility never depended on hazard status", () => {
    const withHazard: FacilityMatchInput = { isHazardous: true, ealCode: "17 05 04", matrixType: "jord" };
    const withoutHazard: FacilityMatchInput = { isHazardous: null, ealCode: "17 05 04", matrixType: "jord" };
    expect(matchFacilities(withHazard).returkraft).toEqual(matchFacilities(withoutHazard).returkraft);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/hp-classification/facility-match.test.ts`
Expected: FAIL — `FacilityMatchInput.isHazardous` is still `boolean`-only (TS error), and/or
`null` currently falls into the existing "assume non-hazardous" branch in `checkStoleheia`.

- [ ] **Step 4: Fix `facility-match.ts`**

Change `FacilityMatchInput`:

```ts
export interface FacilityMatchInput {
  isHazardous: boolean | null;
  ealCode: string;
  matrixType: string | null;
}
```

In `checkStoleheia` ONLY (its real current code, `if (input.isHazardous) { ... } return { ...
non-hazardous branch... }`, already read during planning), add an explicit `null` check FIRST:

```ts
function checkStoleheia(input: FacilityMatchInput): FacilityMatchResult {
  if (input.isHazardous === null) {
    return {
      facilityId: "stoleheia",
      eligible: "insufficient data",
      route: "cannot route — hazard status indeterminate",
      reason:
        "Hazard status could not be determined (leaching-test data only, no total content) — resolve manually before facility matching.",
    };
  }

  if (input.isHazardous) {
    // ... existing hazardous branch, unchanged ...
  }

  return {
    // ... existing non-hazardous branch, unchanged ...
  };
}
```

`checkReturkraft` needs no change at all — confirm this by re-reading it once more before
concluding the fix is complete; it must compile once `FacilityMatchInput.isHazardous` widens
(TypeScript won't complain, since it never reads that field), and its own tests must show zero
behavioral difference (Step 2's second test proves this).

- [ ] **Step 5: Update `app/api/facility-match/route.ts`'s validation**

Find the current check (`typeof isHazardous !== "boolean"` → 400). Change to accept `null`
explicitly:

```ts
  if (typeof isHazardous !== "boolean" && isHazardous !== null) {
    return NextResponse.json({ error: "isHazardous must be a boolean or null" }, { status: 400 });
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/facility-match.test.ts`
Expected: PASS — all tests pass, including the new one, for BOTH facilities.

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: `lib/hp-classification/` fully green now. Remaining failures confined to app-level
files (Task 5).

Run: `pnpm build`
Expected: FAIL — app-level files (`lib/projects.ts`, case pages, dashboard, wizard) still assume
`isHazardous: boolean`; expected until Task 5.

- [ ] **Step 8: Commit**

```bash
git add lib/hp-classification/facility-match.ts app/api/facility-match/route.ts \
        tests/hp-classification/facility-match.test.ts
git commit -m "fix(hp-classification): never treat indeterminate hazard status as non-hazardous in facility matching

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Downstream display — committed case data, dashboard, depot map, wizard

**Files:**
- Modify: `lib/projects.ts` (`WasteEntry.isHazardous`)
- Modify: `app/cases/[id]/page.tsx` (Chip + copy)
- Modify: `app/page.tsx`, `app/projects/[id]/page.tsx` (add `indeterminateEntryCount`)
- Modify: `lib/depots.ts`, `components/dashboard/DepotMap.tsx` (`depotIsLit`'s param type)
- Modify: `components/wizard/Wizard.tsx`, `components/wizard/ClassificationResultsStep.tsx`,
  `components/wizard/FacilityMatchStep.tsx`
- Modify: `components/data-lab/SampleSwitcher.tsx`

**Interfaces:**
- Consumes: `isHazardous: boolean | null` (Task 1), everything already updated in Tasks 1-4.
- Produces: nothing new consumed by later tasks — this is the plan's final, integrating task.

This task has no dedicated new test file for the React component changes (this repo has no
component-rendering test harness — the same disclosed situation established in the trust-model
plan's Task 4). Verify via `pnpm build` (type-checks every file below) and, where practical, a
manual check via `pnpm dev`.

- [ ] **Step 1: Update `lib/projects.ts`**

Change:

```ts
export interface WasteEntry {
  id: string;
  sampleLabel: string;
  isHazardous: boolean;
```

to:

```ts
export interface WasteEntry {
  id: string;
  sampleLabel: string;
  /** null means "could not be determined" (e.g. leaching-test-only data) — a real, committed
   * state, not a placeholder to resolve before saving. */
  isHazardous: boolean | null;
```

Check whether this file's seed data (the literal `WasteEntry` objects further down, already read
during planning — `seed-entry-1` through `seed-entry-5`) needs any change: it doesn't, since
`boolean` is still assignable to `boolean | null`, only the reverse needs the wider type.

- [ ] **Step 2: Update `app/cases/[id]/page.tsx`**

Find the current Chip block (already read during planning):

```tsx
        <Chip color={entry.isHazardous ? "danger" : "success"} variant="soft">
          {entry.isHazardous ? "Hazardous" : "Non-hazardous"}
        </Chip>
```

Replace with a three-state version:

```tsx
        <Chip color={entry.isHazardous === null ? "warning" : entry.isHazardous ? "danger" : "success"} variant="soft">
          {entry.isHazardous === null ? "Indeterminate" : entry.isHazardous ? "Hazardous" : "Non-hazardous"}
        </Chip>
```

Check this UI library's `Chip` component (HeroUI, per this repo's dependencies) actually supports
a `"warning"` color variant — if not, read what colors it does support and pick a real one
distinct from `"danger"`/`"success"` rather than guessing `"warning"` blindly.

Find the surrounding paragraph (already read during planning — the one starting
`{entry.isHazardous ? entry.avfallsstoffnr ? ... : ...}`) and add a third branch before the
existing ternary:

```tsx
          {entry.isHazardous === null
            ? "Hazard status could not be determined — resolve manually before matching a depot."
            : entry.isHazardous
              ? entry.avfallsstoffnr
                ? `Glowing stations hold a permit covering avfallsstoffnr ${entry.avfallsstoffnr} — zoom and click one for its permitted codes and permit PDF.`
                : "Glowing stations are licensed to receive hazardous waste — zoom and click one for its permitted codes and permit PDF."
              : "This waste is non-hazardous and can go to ordinary municipal facilities; hazardous receivers are shown dimmed."}
```

- [ ] **Step 3: Update `app/page.tsx` and `app/projects/[id]/page.tsx`**

In `app/page.tsx`, find the `ProjectRow` interface and the `.map` building it (already read
during planning):

```ts
interface ProjectRow {
  project: Project;
  caseCount: number;
  hazardousEntryCount: number;
}
```

Add `indeterminateEntryCount: number` alongside it, and populate it in the `.map`:

```ts
        return {
          project, caseCount: cases.length,
          hazardousEntryCount: entries.filter(e => e.isHazardous === true).length,
          indeterminateEntryCount: entries.filter(e => e.isHazardous === null).length,
        };
```

Note the existing `hazardousEntryCount` filter changes from `e.isHazardous` (truthy) to
`e.isHazardous === true` (explicit) — behaviorally identical for real data (both exclude `null`
and `false`), but explicit is clearer now that a third state exists.

Add a `totalIndeterminate` reduce alongside the existing `totalHazardous`:

```ts
  const totalIndeterminate = rows.reduce((sum, r) => sum + r.indeterminateEntryCount, 0);
```

Add a new `StatCard` alongside the existing "Hazardous entries" one (find that JSX — it's a
`<StatCard label="Hazardous entries" value={String(totalHazardous)} />` per this file's existing
pattern):

```tsx
        <StatCard label="Indeterminate entries" value={String(totalIndeterminate)} />
```

Read `app/projects/[id]/page.tsx` in full and apply the same pattern (its own
`hazardousCount`/`entries.filter(...)` computation, already located in an earlier grep at line
93) — match its exact existing structure, don't assume it's identical to `app/page.tsx`.

- [ ] **Step 4: Update `lib/depots.ts` and `components/dashboard/DepotMap.tsx`**

In `lib/depots.ts`, widen `depotIsLit`'s parameter type only — no logic change needed
(`!null` is `true` in JS, so `if (!analysisIsHazardous) return false;` already correctly treats
`null` the same as `false`, i.e. "don't light this depot up"):

```ts
export function depotIsLit(depot: Depot, analysisIsHazardous: boolean | null, avfallsstoffnr?: string | null): boolean {
```

Read `components/dashboard/DepotMap.tsx` in full and widen its own `isHazardous` prop type to
`boolean | null` (it's currently `isHazardous?: boolean` — an already-optional prop used for a
"no filter" state; confirm whether `null` should be treated the same as `undefined` there, or
needs its own distinct branch, by reading how the existing `undefined` case is handled before
deciding — don't assume without checking).

- [ ] **Step 5: Update the wizard files**

Read `components/wizard/Wizard.tsx` in full. Find where it reads `hazard.isHazardous` (already
located during planning at two spots: building the committed `WasteEntry` around line 190-198,
and passing to `FacilityMatchStep` around line 313 — both currently cast via `as { isHazardous:
boolean }`). Update both casts to `as { isHazardous: boolean | null }`, and update the `summary`
text construction (around line 198, `hazard.isHazardous ? ... : ...`) to add a third branch for
`null` (an indeterminate summary sentence, following this file's existing tone/style — read the
existing two branches to match their voice before writing the third).

Read `components/wizard/ClassificationResultsStep.tsx` in full. Find `<StatCard label="Hazardous
waste" value={hazard.isHazardous ? "Yes" : "No"} />` (already located during planning) and widen
to a three-state value: `hazard.isHazardous === null ? "Indeterminate" : hazard.isHazardous ?
"Yes" : "No"`. Update its own `isHazardous: boolean` prop type declaration to `boolean | null`.

Read `components/wizard/FacilityMatchStep.tsx` in full. Widen its `isHazardous: boolean` prop to
`boolean | null` and read its internal ternary (already located during planning, around line 10)
to add a third branch consistent with its existing two, before passing the value to `DepotMap`
(Step 4 already widened `DepotMap`'s own prop to accept this).

- [ ] **Step 6: Update `components/data-lab/SampleSwitcher.tsx`**

Read the file in full. Widen its `isHazardous: boolean` prop to `boolean | null` and update the
existing ternary (`tab.isHazardous ? "farlig avfall" : tab.ealCode ?? "no EAL"`, already located
during planning around line 71) to a three-state version — an indeterminate tab label
(e.g. `"ikke bestemt"`) distinct from both the hazardous and the EAL-code-shown states.

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass (same pre-existing DATALAB_API_KEY/ANTHROPIC_API_KEY failures
only, no new failures).

Run: `pnpm build`
Expected: compiles successfully — this is the point where every consumer identified in the
spec's full inventory table has been updated, and the whole app should type-check clean.

- [ ] **Step 8: Manual verification**

Run `pnpm dev` (or reuse a running instance), upload the real leaching-test-only report used
throughout this investigation (Envir AS / COWI "G5 Utlekkingstest" pattern — ristetest metals
only), and confirm: Checkbox1/3/4/6 render unchecked with a note citing § 9-6 (same citation the
Checkbox1/2/3 landfill-category grounding already uses); `TextField41` and the generated
description both say "ikke bestemt"/indeterminate, not a fabricated verdict; no EAL code is
assigned. If a facility-match view is reachable for this sample, confirm it shows "insufficient
data," not a routed-to-ordinary-facility result.

- [ ] **Step 9: Commit**

```bash
git add lib/projects.ts app/cases/[id]/page.tsx app/page.tsx app/projects/[id]/page.tsx \
        lib/depots.ts components/dashboard/DepotMap.tsx components/wizard/Wizard.tsx \
        components/wizard/ClassificationResultsStep.tsx components/wizard/FacilityMatchStep.tsx \
        components/data-lab/SampleSwitcher.tsx
git commit -m "feat: surface indeterminate hazard status across cases, dashboard, depot map, wizard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Known follow-ups this plan surfaces but does not resolve

1. **Checkbox9/10's hardcoded `check: false`/`check: true`** (spec, disclosed) — never read
   `s.isHazardous`, represent a different, also-unautomated question about detected hazardous
   substance content. Not touched by this fix.
2. **Kap. 9 Vedlegg II's actual limit-value table is not yet citable** — `LovdataSource` only
   addresses `§article-paragraph` locations; Vedlegg sections need new addressing logic. § 9-6
   alone is sufficient grounding for this fix's claim. See the
   `lovdata-vedlegg-addressing-gap` memory for the real archive location already found
   (`KAPITTEL_11-2`, title "Karakterisering og kriterier for mottak av avfall").
3. **Composite `(paragraphId, resolvedFieldKey)` dispute scoping** — still deferred, now
   materially closer to mattering: § 9-6 grounds two resolution keys as of this plan
   (`deponi-category-basis`, `hazard-indeterminate-basis`), each covering multiple BK-skjema
   fields — five fields total across both keys (Checkbox1/2/3 share `deponi-category-basis`;
   Checkbox1/3/4/6 also read `hazard-indeterminate-basis` when indeterminate), not three.
4. **The seed-corpus chapter roadmap** (kap. 10, 10a, 13/13A, 14A, 17, 18A — confirmed with the
   user, tracked in the `avfallsforskriften-chapter-roadmap` memory) remains demand-driven only;
   nothing in this plan needs a new chapter.
