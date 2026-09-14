# HP Methodology Citation + Unit-Based Leachate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the universal "Vurdert mot HP1-HP15..." sentence in every generated BK-skjema description with a real § 11-2 citation, and add a deterministic unit-based fallback so a leachate/eluate sample cannot slip through the leaching-only gate just because its report language didn't use the words "ristetest"/"kolonnetest".

**Architecture:** Two independent additions on top of the existing compliance-cache and leachate-gating mechanisms. (1) A new `resolve-legal-citations.ts` field key (`"hp-methodology-basis"`, § 11-2) resolved and attached unconditionally to `TextField38`. (2) A new pure function `unitsIndicateLeachate` in `classify-sample.ts` that inspects `SampleResult.unitRaw` values and, when a strict majority are liquid-concentration units, forces the existing leaching-only gate — even overriding an explicit `totalinnholdUtfort: true` — with a distinct, traceable confidence-flag message when it's the unit check (not the keyword flag) that triggered.

**Tech Stack:** TypeScript, Vitest, Supabase (paragraph cache), Lovdata (`LovdataSource`), Voyage embeddings (`embedText`).

## Global Constraints

- Never fabricate a citation: a location that doesn't resolve degrades the whole field to `null` (existing `resolveLegalCitations` all-or-nothing contract) — do not weaken this for the new field.
- English (`confidenceFlags`) vs Norwegian (`confidenceFlagsNo`) text stays fully separate — `TextField38`/`buildDescription` and `TextField41` read ONLY the `*No` array; internal/reviewer-facing surfaces (checkbox `.note`) read ONLY the plain (English) array. Never let one leak into the other.
- `unitsIndicateLeachate(results: SampleResult[]): boolean` gates by a **strict majority**: liquid-unit rows (`/l` denominator: `mg/l`, `µg/l`, `ng/l`, `g/l`) vs solid-basis rows (`/kg` denominator, e.g. `mg/kg TS`); rows matching neither are excluded from both counts. Formula: `liquidCount / (liquidCount + solidCount) > 0.5`. Zero counted rows → `false`.
- "Units win, always": when `unitsIndicateLeachate` returns `true`, the sample gates to `isHazardous: null` regardless of `ristetestUtfort`/`kolonnetestUtfort`/`totalinnholdUtfort` — even overriding an explicit `totalinnholdUtfort: true`.
- When the unit check is the reason for gating and the keyword-based flag (`ristetestUtfort === true || kolonnetestUtfort === true) && totalinnholdUtfort === false`) is NOT also true, the `confidenceFlags`/`confidenceFlagsNo` message MUST be the distinct override-specific text (see Task 1), never the plain keyword-gate message. When both signals agree, reuse the existing message unchanged — no new message for the non-conflicting case.
- `TextField38` gets `legalCitation: s.legalCitations?.["hp-methodology-basis"] ?? null` **unconditionally**, for every sample regardless of `isHazardous` state — this is the first citation in the codebase that is not state-conditional.
- § 11-2 needs real seeding (new paragraph, never cached before) — extend `scripts/seed-lovdata.ts`'s `buildSeedLocations` and actually run it against the real Supabase project as part of this plan (same as every prior plan that added a location).
- Follow the existing `RESOLVED_FIELDS` pattern in `lib/compliance/resolve-legal-citations.ts` exactly — do not introduce a new resolution mechanism.

---

## Task 1: Unit-based leachate detection in classify-sample.ts

**Files:**
- Modify: `lib/hp-classification/classify-sample.ts`
- Test: `tests/hp-classification/classify-sample.test.ts`

**Interfaces:**
- Consumes: `SampleResult` (`lib/hp-classification/types.ts`) — uses only the existing `unitRaw: string` field, no new fields needed.
- Produces: `unitsIndicateLeachate(results: SampleResult[]): boolean`, exported from `lib/hp-classification/classify-sample.ts` for direct unit testing. No change to `classifySample`'s own exported signature.

- [ ] **Step 1: Write the failing tests for `unitsIndicateLeachate` directly**

Add to `tests/hp-classification/classify-sample.test.ts`, after the existing `import` lines (add one new import) and before the closing `});` of the `describe("classifySample", ...)` block — as a new sibling `describe` block appended after it:

```typescript
import { classifySample, unitsIndicateLeachate } from "@/lib/hp-classification/classify-sample";
```

(Replace the existing `import { classifySample } from "@/lib/hp-classification/classify-sample";` line with the line above.)

Then append this new block at the end of the file (after the final `});` that closes `describe("classifySample", ...)`):

```typescript
function result(overrides: Partial<SampleResult>): SampleResult {
  return {
    resultId: "r", sampleId: "t", analyteId: "x", rawAnalyteName: "x",
    resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS",
    expressedOnDryBasis: true, method: null,
    ...overrides,
  };
}

describe("unitsIndicateLeachate", () => {
  it("returns true for the real Test-1 leachate pattern (Ba/Cr/Mo/Cl in mg/l, pH unitless)", () => {
    const results: SampleResult[] = [
      result({ rawAnalyteName: "Ba", resultValue: 0.13, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "Cr", resultValue: 0.059, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "Mo", resultValue: 0.069, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "Cl", resultValue: 23, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "pH", resultValue: 12.5, unitRaw: "" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(true);
  });

  it("returns false for a normal total-content sample (mg/kg TS units)", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false at exactly a 50/50 liquid/solid split (majority requires strictly more than half)", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "mg/l" }),
      result({ unitRaw: "mg/l" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false for a single stray liquid-unit row among mostly-solid rows", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "mg/l" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false when no rows have a recognized liquid or solid unit (absence of evidence is not evidence)", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "%" }),
      result({ unitRaw: "" }),
      result({ unitRaw: "mg/m3" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("recognizes µg/l and ng/l and g/l as liquid units, and mg/kg (no TS suffix) as solid", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "µg/l" }),
      result({ unitRaw: "ng/l" }),
      result({ unitRaw: "g/l" }),
      result({ unitRaw: "mg/kg" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(true); // 3 liquid / 1 solid = 75% > 50%
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: FAIL — `unitsIndicateLeachate` is not exported from `classify-sample.ts` (import error / undefined).

- [ ] **Step 3: Implement `unitsIndicateLeachate` and wire it into the gate**

In `lib/hp-classification/classify-sample.ts`, add the new function above `classifySample` (after the existing `import` lines):

```typescript
import { normalizeSample } from "./normalize";
import { speciateElement, type ElementCompoundForm } from "./speciate";
import { classifyHazard, type NormalizedResultWithClp, type TestResult, type HazardClassification } from "./hazard";
import { assignEalCode, type EalAssignment } from "./eal";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";

const LIQUID_UNIT_PATTERN = /\/\s*[lL]\b/;
const SOLID_UNIT_PATTERN = /\/\s*kg\b/i;

// Deterministic fallback for the ristetest/kolonnetest keyword gate below: the extraction LLM's
// ristetest_utfort/kolonnetest_utfort flags are language-pattern judgments and can miss a report
// that is chemically a leachate/eluate sample (mg/l concentrations) but never uses the words the
// prompt looks for. This inspects the actual reported units instead — a real report reporting a
// clear majority of its results as liquid concentrations (a "/l" denominator) rather than solid
// total content (a "/kg" denominator) is a leachate sample regardless of what its prose says. A
// row whose unit matches neither pattern is excluded from both counts — absence of a recognized
// unit is not evidence either way. See docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
export function unitsIndicateLeachate(results: SampleResult[]): boolean {
  let liquidCount = 0;
  let solidCount = 0;
  for (const r of results) {
    if (LIQUID_UNIT_PATTERN.test(r.unitRaw)) {
      liquidCount++;
    } else if (SOLID_UNIT_PATTERN.test(r.unitRaw)) {
      solidCount++;
    }
  }
  const counted = liquidCount + solidCount;
  if (counted === 0) return false;
  return liquidCount / counted > 0.5;
}
```

Then replace the existing gate block (the `leachingOnly` const through the `if (leachingOnly) { ... }` block) in `classifySample` with:

```typescript
  // Real regulatory gap, not a bug: ristetest/kolonnetest (leaching test) results are governed
  // by avfallsforskriften kap. 9 (landfill acceptance criteria — a different, delegated
  // question), never by kap. 11's HP1-15 hazard classification, which requires total-content
  // data. A document confirmed to carry ONLY leaching-test data cannot answer "is this
  // hazardous waste" — classifyHazard is never called in that case; isHazardous is null, never
  // a fabricated true/false. See docs/superpowers/specs/2026-09-05-leachate-hp-routing-design.md.
  const keywordFlaggedLeachingOnly =
    (metadata.ristetestUtfort === true || metadata.kolonnetestUtfort === true) &&
    metadata.totalinnholdUtfort === false;

  // Deterministic fallback (see unitsIndicateLeachate above): units win, always — even overriding
  // an explicit totalinnholdUtfort: true from the extraction LLM. See
  // docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
  const unitFlaggedLeachingOnly = unitsIndicateLeachate(results);

  const leachingOnly = keywordFlaggedLeachingOnly || unitFlaggedLeachingOnly;

  if (leachingOnly) {
    // Distinct, traceable message: when the unit check alone is why this sample gated (the
    // keyword flag did NOT independently agree), the flag text must say so explicitly — a future
    // reader must be able to tell, from confidenceFlags alone, why a sample with e.g.
    // totalinnholdUtfort: true still ended up isHazardous: null. When both signals agree, reuse
    // the plain keyword-gate message unchanged.
    const confidenceFlags = keywordFlaggedLeachingOnly
      ? [
          "HP1-15 hazard classification not performed: this sample has leaching-test " +
          "(ristetest/kolonnetest) data only, no total content data — leaching-test results are " +
          "landfill-acceptance-criteria data (avfallsforskriften kap. 9), a different regulatory " +
          "question from hazardous-waste classification (kap. 11), which requires total content. " +
          "Manual review required.",
        ]
      : [
          "HP1-15 hazard classification not performed: reported result units indicate a " +
          "liquid/eluate sample (a majority of results use a mg/l-class concentration unit), " +
          "overriding the extraction's own totalinnhold_utfort flag — regardless of what the " +
          "report's language claimed, leaching-test results are landfill-acceptance-criteria " +
          "data (avfallsforskriften kap. 9), a different regulatory question from hazardous-" +
          "waste classification (kap. 11), which requires total content. Manual review required.",
        ];
    const confidenceFlagsNo = keywordFlaggedLeachingOnly
      ? [
          "HP1-15-klassifisering ikke utført: denne prøven har kun utlekkingstest-data " +
          "(ristetest/kolonnetest), ingen totalinnhold-data — utlekkingstest-resultater er " +
          "mottakskriterier-data for deponering (avfallsforskriften kap. 9), et annet " +
          "regelverksspørsmål enn farlig avfall-klassifisering (kap. 11), som krever totalinnhold. " +
          "Manuell gjennomgang kreves.",
        ]
      : [
          "HP1-15-klassifisering ikke utført: rapporterte resultatenheter indikerer en " +
          "væske-/eluatprøve (et flertall av resultatene bruker en mg/l-basert " +
          "konsentrasjonsenhet), som overstyrer ekstraksjonens eget totalinnhold_utfort-flagg — " +
          "uavhengig av hva rapportteksten hevdet, er utlekkingstest-resultater " +
          "mottakskriterier-data for deponering (avfallsforskriften kap. 9), et annet " +
          "regelverksspørsmål enn farlig avfall-klassifisering (kap. 11), som krever totalinnhold. " +
          "Manuell gjennomgang kreves.",
        ];
    const hazard: HazardClassification = {
      resultsByHp: {},
      triggeringSubstancesByHp: {},
      isHazardous: null,
      triggeredHps: [],
      confidenceFlags,
      confidenceFlagsNo,
    };
    const eal = assignEalCode(null, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);
    return { hazard, eal, noDataWarning: false };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: PASS — all existing tests still pass (the "does NOT gate when totalinnholdUtfort is explicitly true" test uses `unitRaw: "%"`, which is neither liquid nor solid, so `unitsIndicateLeachate` returns `false` and does not interfere), plus all 6 new `unitsIndicateLeachate` tests pass.

- [ ] **Step 5: Add a regression test proving the override case produces the distinct message**

Append to `tests/hp-classification/classify-sample.test.ts`, inside the existing `describe("classifySample", ...)` block (add as a new `it` after the existing `"does NOT gate when totalinnholdUtfort is explicitly true, even alongside a leaching flag"` test — that existing test's own `unitRaw: "%"` proves the non-liquid case is unaffected; this new test proves the liquid-unit case DOES gate and carries the override message):

```typescript
  it("gates via the unit check alone (overriding an explicit totalinnholdUtfort: true) and carries the distinct override message", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Ba",
        resultValue: 0.13, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
      { resultId: "r2", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Cr",
        resultValue: 0.059, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const metadataWithExplicitTotalContentClaim: SampleMetadata = {
      ...baseMetadata, totalinnholdUtfort: true,
    };
    const result = classifySample(metadataWithExplicitTotalContentClaim, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull();
    expect(result.hazard.confidenceFlags[0]).toContain("overriding the extraction's own totalinnhold_utfort flag");
    expect(result.hazard.confidenceFlagsNo?.[0]).toContain("overstyrer ekstraksjonens eget totalinnhold_utfort-flagg");
    expect(result.eal.code).toBeNull();
  });
```

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/classify-sample.ts tests/hp-classification/classify-sample.test.ts
git commit -m "feat: add unit-based leachate detection fallback to the HP classification gate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: § 11-2 methodology citation — resolve-legal-citations.ts entry and seeding

**Files:**
- Modify: `lib/compliance/resolve-legal-citations.ts`
- Modify: `scripts/seed-lovdata.ts`
- Test: `tests/compliance/resolve-legal-citations.test.ts`
- Test: `tests/compliance/seed-lovdata.test.ts`

**Interfaces:**
- Consumes: `resolveLegalCitations(store, source, corrections)` (unchanged signature) — this task only extends the internal `RESOLVED_FIELDS` array.
- Produces: `resolveLegalCitations(...)`'s returned record now includes a `"hp-methodology-basis"` key, resolving to a one-element `LegalCitationView` (§ 11-2, `primary: true`) when § 11-2 is cached, or `null` otherwise. `buildSeedLocations("avfallsforskriften")` now includes `{ documentId: "avfallsforskriften", article: "11", paragraph: "2" }`.

- [ ] **Step 1: Write the failing test for the new seed location**

Add to `tests/compliance/seed-lovdata.test.ts`, as a new `it` after the existing `"also returns § 9-5 and § 9-6..."` test:

```typescript
  it("also returns § 11-2 for the HP1-15 methodology citation", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "11", paragraph: "2" });
  });
```

- [ ] **Step 2: Write the failing test for the new resolved field**

Add to `tests/compliance/resolve-legal-citations.test.ts`. First add a new fixture paragraph near the existing `p11_4`/`p9_5`/`p9_6` declarations:

```typescript
const p11_2: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-11-2", article: "11", paragraph: "2", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-2" };
```

Then add a new `it` inside the `describe("resolveLegalCitations", ...)` block, after the existing `"resolves eal-legal-basis..."` test:

```typescript
  it("resolves hp-methodology-basis (§ 11-2, single location) to a one-element citations array, primary true", async () => {
    const store = fakeStore([p11_2]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]?.citations).toHaveLength(1);
    expect(result["hp-methodology-basis"]?.citations[0].paragraphId).toBe("no-avfallsforskriften-11-2");
    expect(result["hp-methodology-basis"]?.citations[0].primary).toBe(true);
  });

  it("hp-methodology-basis is null when § 11-2 is not cached", async () => {
    const store = fakeStore([]); // empty — § 11-2 absent
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts tests/compliance/seed-lovdata.test.ts`
Expected: FAIL — `buildSeedLocations` does not yet include § 11-2; `result["hp-methodology-basis"]` is `undefined`, not the expected shape.

- [ ] **Step 4: Add § 11-2 to `buildSeedLocations`**

In `scripts/seed-lovdata.ts`, modify the `buildSeedLocations` function:

```typescript
export function buildSeedLocations(documentId: string): { documentId: string; article: string; paragraph: string }[] {
  return [
    { documentId, article: "11", paragraph: "4" }, // hazardous-waste handling obligation (Checkbox10)
    { documentId, article: "9", paragraph: "5" },  // landfill categories (Checkbox1/2/3)
    { documentId, article: "9", paragraph: "6" },  // waste permitted per landfill category (Checkbox1/2/3)
    { documentId, article: "11", paragraph: "2" }, // HP1-15 methodology basis (TextField38, every sample)
  ];
}
```

- [ ] **Step 5: Add the `hp-methodology-basis` entry to `RESOLVED_FIELDS`**

In `lib/compliance/resolve-legal-citations.ts`, modify the `RESOLVED_FIELDS` array:

```typescript
const RESOLVED_FIELDS: ResolvedFieldConfig[] = [
  {
    key: "eal-legal-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "11", paragraph: "4", queryText: "farlig avfall håndtering", primary: true },
    ],
  },
  {
    key: "deponi-category-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "9", paragraph: "5", queryText: "kategorier av deponier" },
      { documentId: "avfallsforskriften", article: "9", paragraph: "6", queryText: "avfall som tillates deponert på de ulike deponikategoriene", primary: true },
    ],
  },
  {
    key: "hazard-indeterminate-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "9", paragraph: "6", queryText: "avfall som tillates deponert på de ulike deponikategoriene", primary: true },
    ],
  },
  {
    key: "hp-methodology-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "11", paragraph: "2", queryText: "definisjon av farlig avfall HP1-HP15 vedlegg", primary: true },
    ],
  },
];
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts tests/compliance/seed-lovdata.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/compliance/resolve-legal-citations.ts scripts/seed-lovdata.ts tests/compliance/resolve-legal-citations.test.ts tests/compliance/seed-lovdata.test.ts
git commit -m "feat: add hp-methodology-basis (§ 11-2) resolved legal citation field

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Run the real seed script against the live Supabase project**

This step requires real Supabase/Lovdata/Voyage credentials in the environment (same as every prior plan's seeding step — check `.env.local` is present and loaded).

Run: `npx tsx scripts/seed-lovdata.ts`
Expected output includes a line: `Seeded no-avfallsforskriften-11-2` (alongside the three already-seeded paragraphs from prior plans, which the script re-seeds idempotently — re-running is safe).

If the line does NOT appear (e.g. `No paragraph found for {"documentId":"avfallsforskriften","article":"11","paragraph":"2"} — skipping, not fabricating.`), STOP — do not proceed to Task 3. This means `LovdataSource`'s fetch for § 11-2 failed against the real archive; escalate rather than seeding a fabricated paragraph or silently leaving `hp-methodology-basis` permanently null in production.

- [ ] **Step 9: Verify the seeded row exists via a direct query**

Use the Supabase MCP tool (`mcp__4cb1564a-c04a-4cb1-9d6f-71b8b991fa4b__execute_sql`) against project `zrexxdnlonleijhlmnjp`, or the `supabase` CLI if available locally, to run:

```sql
select id, article, paragraph, in_force, last_verified_at from legal_paragraphs where id = 'no-avfallsforskriften-11-2';
```

Expected: exactly one row, `in_force = true`.

---

## Task 3: Attach the § 11-2 citation to TextField38 unconditionally

**Files:**
- Modify: `lib/bk-skjema/form-map.ts`
- Test: `tests/bk-skjema/from-datalab.test.ts`

**Interfaces:**
- Consumes: `s.legalCitations?.["hp-methodology-basis"]` (produced by Task 2's `resolveLegalCitations`, threaded into `BkSource.legalCitations` by the existing, unmodified `bkFromDatalab`/`analyse-bundle.ts` plumbing — no changes needed there since `legalCitations` is already a generic `Record<string, LegalCitationView | null>` passthrough).
- Produces: the `TextField38` entry in the array returned by `form-map.ts`'s field-building function now carries `legalCitation?: LegalCitationView | null`, populated unconditionally (every `isHazardous` state).

- [ ] **Step 1: Write the failing test**

Add to `tests/bk-skjema/from-datalab.test.ts`, immediately after the existing `"Checkbox10 has no legalCitation and a plain note when legalCitations is absent"` test (around line 150), following the exact same pattern those two tests already use — build a `BkSource` directly via `{ ...source, legalCitations: {...} }` and call `buildBkFields` on it, never routing through `bkFromDatalab`'s datalab-payload shape (which has no `isHazardous` field of its own — `isHazardous` lives on the derived `BkSource`, not the raw payload):

```typescript
  it("TextField38 carries the hp-methodology-basis legal citation unconditionally, regardless of isHazardous state", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const citation = {
      citations: [{
        paragraphId: "no-avfallsforskriften-11-2",
        label: "Avfallsforskriften § 11-2",
        sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-2",
        verifiedAt: "2026-09-06T00:00:00.000Z",
        disputed: false,
        primary: true,
      }],
    };
    for (const isHazardousOverride of [true, false, null]) {
      const withCitation: BkSource = {
        ...source, isHazardous: isHazardousOverride,
        legalCitations: { "hp-methodology-basis": citation },
      };
      const fields = buildBkFields(withCitation);
      const textField38 = fields.find(f => f.field === "TextField38")!;
      expect(textField38.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-11-2");
    }
  });

  it("TextField38 has no legalCitation when hp-methodology-basis wasn't resolved", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const fields = buildBkFields(source);
    const textField38 = fields.find(f => f.field === "TextField38")!;
    expect(textField38.legalCitation ?? null).toBeNull();
  });
```

No new import is needed — this reuses `BkSource` and `buildBkFields`, both already imported at the top of this file (line 4).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — `textField38.legalCitation` is `undefined`, not the expected citation.

- [ ] **Step 3: Attach the citation to TextField38**

In `lib/bk-skjema/form-map.ts`, modify the `TextField38` entry:

```typescript
    { field: "TextField38", label: "Beskriv avfallet og hvordan det oppstår", src: "derived", value: buildDescription(s),
      legalCitation: s.legalCitations?.["hp-methodology-basis"] ?? null },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — including all pre-existing tests in this file (this is an additive property on one field's object literal; no other field or return shape changes).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green (this plan touches `classify-sample.ts`, `resolve-legal-citations.ts`, `seed-lovdata.ts`, and `form-map.ts`; confirm no downstream consumer broke, e.g. `bk/fill-form.test.ts`).

- [ ] **Step 6: Run the build**

Run: `pnpm build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add lib/bk-skjema/form-map.ts tests/bk-skjema/from-datalab.test.ts
git commit -m "feat: attach hp-methodology-basis (§ 11-2) citation to TextField38 unconditionally

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Known follow-ups (not built in this plan, disclosed per the spec)

- False-positive risk: a genuinely liquid waste stream (not a leachate extract of a solid) reporting its real total-content basis in mg/l would also be gated by `unitsIndicateLeachate`. A future fix could disambiguate using `SampleMetadata.physicalState` (skip the unit check when `physicalState === "liquid"`) — not built here, to keep this plan's scope to what's confirmed needed.
- Part 1's actual HP threshold table (Vedlegg 2 to kap. 11) remains uncitable — same Vedlegg-addressing gap logged in memory (`lovdata-vedlegg-addressing-gap.md`). § 11-2 grounds "where this rule comes from," not the literal threshold numbers.
- Dispute scoping (`hasUnresolvedDispute()`'s paragraph-id-only scoping) is now materially closer to mattering with a third real citation added — still deferred, tracked since the prior two plans.
