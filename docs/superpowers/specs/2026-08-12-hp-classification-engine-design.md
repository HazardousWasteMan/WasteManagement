# HP1-15 Waste Classification Engine — Real EAL/HP/Facility Foundation

Date: 2026-08-12

## Context

The prior Stage 2 classification engine (tilstandsklasse + a narrow HP4-7 subset, built and merged in the previous work session) is **superseded and removed** by this spec. That engine was built against best-effort research; this one is built against real, uploaded source documents: two real lab reports (an Italian LabAnalysis soil/rock report that already includes the lab's own HP1-15 classification and final EAL code, and Norwegian Eurofins concrete/asphalt reports with raw analytical data only), the official avfallsdeklarering.no EAL/avfallsstoffnummer CSVs, real facility permits (Støleheia deponi, Returkraft forbrenningsanlegg), and five design documents (`hp_thresholds.csv`, `hp_special_rules.md`, `eal_koder_kapittel17.csv`, `sample_schema.md`, `decision_engine.md`) that already specify the full pipeline in detail. This spec formalizes that existing design into an implementable first slice — it does not redesign the pipeline logic, which the source documents already validated against both real uploaded samples.

**Why replace rather than extend:** the previous engine's tilstandsklasse/HP-criteria modules covered only soil-matrix samples, only HP4-7, and used best-effort-sourced thresholds. The real HP1-15 table covers all 15 hazard properties (including test-only HP1-3, sum-vs-individual-substance distinctions per category, the HP5 physical-state carve-out, and HP14's M-factor cascade — none of which the prior engine modeled), sourced from EU Regulation 1357/2014 Annex III directly rather than reconstructed from memory. Keeping both would mean two parallel, disagreeing classification systems in the same codebase.

## Scope of this slice

**In scope:**
- Stage 1 (normalize) + Stage 2 (HP1-15 classification) + Stage 3 (EAL code assignment) from `decision_engine.md`, implemented as pure TypeScript modules.
- One real regression fixture: the Italian LabAnalysis sample, hand-transcribed, validated against the lab's own stated HP triggers and `17 05 03*` EAL code.
- Full verbatim reference data: `hp_thresholds.csv`, `eal_koder_kapittel17.csv`, and an `analyte_reference` table seeded only with the Italian sample's ~30-40 substances.

**Explicitly out of scope for this slice** (real, already-designed follow-on work, not abandoned):
- Stage 4 (facility matching against Støleheia/Returkraft permits) and Stage 5 (output record assembly).
- The Eurofins samples and the "insufficient data — no leachate test" path they exercise.
- The `avfallsstoffnummer ↔ EAL` crosswalk, the `origin_process → EAL chapter` lookup table beyond what the Italian sample needs, and HP14's ECHA M-factor sourcing beyond the substances the Italian sample requires.
- Wiring into the Next.js wizard UI (`ReviewStep`/`MatchesStep`) or the PDF report — this slice is logic + tests only.
- PDF extraction targeting the new schema — sample data enters as a hand-transcribed JSON fixture, matching `decision_engine.md`'s own Stage 0 assumption that structured input is available and extraction is a separate, later engineering problem.

## Removal of the prior engine

Delete entirely (all from the previous session's work, now superseded):
- `lib/tilstandsklasse.ts`, `lib/hp-criteria.ts`, and their data files (`lib/data/tilstandsklasse-thresholds.json`, `lib/data/hp-criteria-thresholds.json`, `lib/data/substance-clp-classification.json`).
- The soil-branch wiring in `lib/classification.ts`'s `pickEalCode()` and the `tilstandsklasse`/`hpFlags` fields on `ClassificationResult` (`lib/types.ts`).
- Their associated tests: `tests/tilstandsklasse.test.ts`, `tests/hp-criteria.test.ts`, and the soil-branch cases in `tests/classification.test.ts`.
- The `totalConcentrationsMgKg` field on `ExtractedWasteData` — the new engine uses its own `SampleResult` schema (below), not the old extraction schema.

Kept untouched: the Next.js app shell, HeroUI wizard components (`components/wizard/*`), PDF extraction plumbing (`lib/extraction.ts`), WMR partner-matching data/logic (`lib/wmr-partners.json`, `lib/wmr-cases.ts`, `lib/chemical-coverage.ts`) — none of this is touched by or dependent on the classification engine being replaced.

## Data model

New directory `lib/hp-classification/` for the engine; new files in `lib/data/` for reference tables; a fixture directory for real sample data.

**`lib/hp-classification/types.ts`** — TypeScript types matching `sample_schema.md` exactly:

```typescript
export interface SampleMetadata {
  sampleId: string;
  externalReportNo: string;
  labName: string;
  customerName: string;
  sampleMarking: string;
  matrixType: string;               // free text: 'jord' | 'betong' | 'aske' | 'slam' | 'grunnvann' | ...
  samplingDate: string | null;
  receiptDate: string | null;
  analysisStartDate: string | null;
  analysisEndDate: string | null;
  originProcess: string | null;     // required input, never inferred — Stage 0 halts if null
  producerName: string | null;
  physicalState: "solid" | "liquid";
  viscosity40cMm2s: number | null;  // only relevant if physicalState === "liquid"
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}

export interface SampleResult {
  resultId: string;
  sampleId: string;
  analyteId: string | null;         // FK into AnalyteReference, nullable while unmapped
  rawAnalyteName: string;           // exactly as printed in the source report
  resultValue: number | null;       // null if pure "<LOQ" with no reported value
  isBelowLoq: boolean;
  loqValue: number | null;
  unitRaw: string;
  expressedOnDryBasis: boolean;
  uncertaintyValue: number | null;
  uncertaintyType: "expanded_absolute" | "expanded_percent" | null;
  method: string | null;
  accredited: boolean;
  matchesEluatSampleId: string | null;
}

export interface AnalyteReference {
  analyteId: string;
  canonicalNameNo: string;
  canonicalNameIt: string | null;
  canonicalNameEn: string;
  casNumber: string;
  defaultUnit: string;
  substanceGroup: string;           // 'metal' | 'PAH' | 'PCB' | 'PFAS' | 'hydrocarbon' | ... (reporting/QA only, not logic)
  mFactorAcute: number | null;      // HP14 — null unless the substance is aquatic-toxic classified
  mFactorChronic: number | null;
}
```

**`lib/data/hp-thresholds.json`** — full verbatim transcription of `hp_thresholds.csv` (all 15 HP categories, every row, including `evaluation_basis` and `cutoff_value_pct` columns). Test-only categories (HP1, HP2, HP3) and case-specific categories (HP9, HP12, HP15) carry no `concentration_limit_pct` — this is preserved as-is, not filled in.

**`lib/data/eal-koder-kapittel17.json`** — full verbatim transcription of `eal_koder_kapittel17.csv` (all chapter 17 codes, all three levels, `farlig`/hazardous flag per code).

**`lib/data/analyte-reference.json`** — seeded with only the substances present in the Italian sample (arsenic, PAH16 constituents present in that report, TPH fractions, and any other analyte rows in the sample's own results table) — approximately 30-40 entries. This is explicitly a "living reference table," per `sample_schema.md`'s own framing — grows with future samples, not built exhaustively now.

**`fixtures/italian-sample.json`** — hand-transcribed `SampleMetadata` + `SampleResult[]` for the real Italian LabAnalysis report, transcribed from the source PDF during implementation (pages with the substance/concentration table and the lab's own HP1-15/EAL determination). This is both the engine's input fixture and the regression test's expected-output source.

## Element-to-compound speciation (a real gap the source docs didn't cover)

The Italian lab's HP classification does not run on raw element concentrations. It speciates certain elements (arsenic, in this sample) into multiple candidate regulatory compound-forms — each with its own CAS number, molecular weight, CLP hazard classification, and computed % w/w — and evaluates every candidate form independently. This is the standard "worst-case single-compound" approach per Decision 2014/955/EU for waste where actual chemical speciation is unknown: assume the entire element mass could be present as compound X, for each hazardous compound X the element is known to form, and classify against all of them.

The conversion formula, verified against the Italian sample's real reported numbers (all three reproduce the report's stated % to within OCR rounding):

```
elementMassFraction = (atomsOfElement × atomicWeightElement) / compoundMolecularWeight
compoundPct = elementPct / elementMassFraction
```

Verified for arsenic (element %w/w = 5.17%, from 51700 mg/kg raw XRF result):
- Diarsenic trioxide (As₂O₃, MW 197.84, 2 As atoms, atomic weight 74.92): mass fraction = 149.84/197.84 = 0.7573 → 5.17/0.7573 = 6.83% (report: 6.82%)
- Diarsenic pentoxide (As₂O₅, MW 229.84): mass fraction = 149.84/229.84 = 0.6520 → 5.17/0.6520 = 7.93% (report: 7.90%)
- Generic "arsenic compounds, except those specified elsewhere" category: no compound-form conversion — uses the raw elemental % directly (5.17%)

**`lib/data/element-compound-forms.json`** — per-element candidate compound forms, seeded only with arsenic's three forms this sample needs:

```json
[
  {
    "elementSymbol": "As",
    "compoundName": "Triossido di diarsenico",
    "casNumber": "1327-53-3",
    "molecularWeightCompound": 197.84,
    "atomsOfElement": 2,
    "atomicWeightElement": 74.92,
    "clpClassifications": [
      { "hStatement": "H300", "hazardClass": "Acute Tox. 2" },
      { "hStatement": "H314", "hazardClass": "Skin Corr. 1B" },
      { "hStatement": "H350", "hazardClass": "Carc. 1A" },
      { "hStatement": "H400", "hazardClass": "Aquatic Acute 1" },
      { "hStatement": "H410", "hazardClass": "Aquatic Chronic 1" }
    ]
  },
  {
    "elementSymbol": "As",
    "compoundName": "Pentaossido di diarsenico",
    "casNumber": "1303-28-2",
    "molecularWeightCompound": 229.84,
    "atomsOfElement": 2,
    "atomicWeightElement": 74.92,
    "clpClassifications": [
      { "hStatement": "H301", "hazardClass": "Acute Tox. 3" },
      { "hStatement": "H331", "hazardClass": "Acute Tox. 3" },
      { "hStatement": "H350", "hazardClass": "Carc. 1A" },
      { "hStatement": "H400", "hazardClass": "Aquatic Acute 1" },
      { "hStatement": "H410", "hazardClass": "Aquatic Chronic 1" }
    ]
  },
  {
    "elementSymbol": "As",
    "compoundName": "Composti dell'arsenico, ad eccezione di quelli specificati altrove nel Reg 2008/1272",
    "casNumber": null,
    "molecularWeightCompound": null,
    "atomsOfElement": null,
    "atomicWeightElement": null,
    "clpClassifications": [
      { "hStatement": "H301", "hazardClass": "Acute Tox. 3" },
      { "hStatement": "H331", "hazardClass": "Acute Tox. 3" },
      { "hStatement": "H400", "hazardClass": "Aquatic Acute 1" },
      { "hStatement": "H410", "hazardClass": "Aquatic Chronic 1" }
    ]
  }
]
```

A form with `molecularWeightCompound: null` (the generic residual category) uses the raw element % directly, no conversion — this is the one entry where `elementMassFraction` is treated as 1.

**`lib/hp-classification/speciate.ts`** — `speciateElement(elementSymbol: string, elementPct: number, forms: ElementCompoundForm[]): CompoundResult[]`, returning one `{ compoundName, casNumber, resultPct, clpClassifications }` per candidate form registered for that element. Runs between `normalizeSample` and `classifyHazard`: any normalized result whose analyte has registered compound forms in `element-compound-forms.json` is expanded into its compound-form results (each entered into the HP7/HP6/etc. per-substance evaluation independently, per `hp_special_rules.md`'s individual-substance-not-summed rule for HP7/HP11, or summed within its own H-statement category for HP6/HP10/HP13); an element with no registered forms passes through unchanged as its own raw-element result.

This is explicitly scoped to arsenic only for this slice — a general, complete element→compound speciation table covering every metal is real follow-on work, not built now. Any element without registered compound forms (all others in this sample: cadmium, cobalt, manganese, molybdenum, nickel, lead, copper, tin, vanadium, zinc) is classified directly from its element-level CAS/CLP entry in `AnalyteReference`, matching what the source report itself does for those elements (the report speciates only arsenic into multiple named compounds; every other metal gets one direct element-or-generic-compound classification, already representable by the existing flat `AnalyteReference` model without speciation).

## Pipeline logic

Three pure functions in `lib/hp-classification/`, each in its own file per the "one clear purpose" file-structure convention already used in this codebase:

**`lib/hp-classification/normalize.ts`** — `normalizeSample(metadata: SampleMetadata, results: SampleResult[], analyteRef: AnalyteReference[]): NormalizedResult[]`. Implements `decision_engine.md` Stage 1: converts every result to dry-basis mg/kg (using the sample's own tørrstoff/residuo-a-105°C value; flags the row `"cannot normalize to dry basis"` and passes the as-received value through unconverted when no dry-matter value exists for that sample), converts units to mg/kg (µg/kg ÷ 1000) and separately to % where an HP calculation needs it (mg/kg ÷ 10000), and for `isBelowLoq` rows carries the LOQ value forward as the conservative estimate rather than treating it as zero — emitting a confidence flag when that LOQ-as-conservative-value would itself change an HP outcome.

```typescript
export interface NormalizedResult {
  analyteId: string;
  resultDryBasisPct: number;        // the value used by every downstream HP calculation
  isBelowLoq: boolean;
  confidenceFlags: string[];        // e.g. "no tørrstoff value — normalization skipped", "LOQ exceeds HP6 threshold — non-detect inconclusive"
}
```

**`lib/hp-classification/hazard.ts`** — `classifyHazard(normalized: NormalizedResult[], metadata: SampleMetadata, analyteRef: AnalyteReference[], compoundForms: ElementCompoundForm[]): HazardClassification`. Before running the HP sub-routines, expands any normalized result for an element with registered compound forms (via `speciateElement`, see "Element-to-compound speciation" above) into its compound-form results, each carrying its own CLP classification and % w/w — these compound-form results, not the raw element result, feed every HP sub-routine below. Implements `decision_engine.md` Stage 2 and every rule in `hp_special_rules.md`:
- HP1-HP3: test-result-only — look for a matching test-result row in the sample's results (via `rawAnalyteName` matching a physical-test description); if none, report `"not tested — assumed not applicable"`, never a fabricated pass/fail.
- HP4/HP8: test-result overrides calculation. If a skin-corrosion/irritation test result exists (matched by `rawAnalyteName`), use it directly. Otherwise sum Skin Corr. 1A/1B/1C substances (≥5% → HP8) and Skin Irrit./Eye Dam./Eye Irrit. substances per the H314/H315+H319-pair/H318 rules from `hp_thresholds.csv`; if HP8 triggers, HP4 is reported `"superseded by HP8"`, not independently flagged.
- HP5: the physical-state/viscosity carve-out — `physicalState === "solid"` or `viscosity40cMm2s > 20.5` means Asp. Tox. 1 (H304) can never trigger regardless of concentration; other HP5 sub-categories (H335/H370-H373) evaluate independently, no-sum, per their individual thresholds.
- HP6, HP10, HP13: sum within category (never across categories, per HP6's per-oral/dermal/inhalation split).
- HP7, HP11: individual substance only — one substance alone must clear its threshold; concentrations of different carcinogens/mutagens are never added together.
- HP9, HP12, HP15: always report `"requires case-specific assessment — not automatable from lab data alone"` — never computed.
- HP14: the full M-factor cascade from `hp_special_rules.md` (Aquatic Acute 1 → Chronic 1 → Chronic 2 → Chronic 3 → Chronic 4, each `Σ(M-factor × concentration)` compared to 25%, evaluated top-to-bottom, stop at first match), using `mFactorAcute`/`mFactorChronic` from `AnalyteReference`. A substance with no M-factor recorded defaults to M-factor 1 per the CLP Annex I §4.1.3.5.5 baseline, and is never excluded from the sum.

```typescript
export interface HazardClassification {
  resultsByHp: Record<string, boolean | "not tested — assumed not applicable" | "requires case-specific assessment — not automatable from lab data alone" | "superseded by HP8">;
  isHazardous: boolean;             // true if any HP resolves to boolean true
  triggeredHps: string[];
  confidenceFlags: string[];
}
```

**`lib/hp-classification/eal.ts`** — `assignEalCode(isHazardous: boolean, originProcess: string, labStatedEalCode: string | null): EalAssignment`. Implements Stage 3: looks up the chapter-17 candidate pair (hazardous/non-hazardous mirror codes, e.g. `17 05 03*`/`17 05 04`) via a small hand-built `originProcess → chapter` lookup table seeded only with the mapping the Italian sample needs (not NLP-matched against the full EAL table, per `decision_engine.md`'s explicit caution against that). When `labStatedEalCode` is present, cross-checks the engine's own result against it and reports `"high — engine agrees with lab's own classification"` or `"FLAG FOR REVIEW — engine disagrees with lab, do not auto-proceed"` rather than silently picking one.

```typescript
export interface EalAssignment {
  code: string;
  description: string;
  confidence: "high — engine agrees with lab's own classification" | "FLAG FOR REVIEW — engine disagrees with lab, do not auto-proceed" | "engine-derived, no independent lab classification to cross-check against";
}
```

## Testing

**Regression test** (`tests/hp-classification/italian-sample.test.ts`): runs `normalizeSample` → `classifyHazard` → `assignEalCode` against `fixtures/italian-sample.json` end-to-end, asserting the pipeline reproduces the lab's own stated HP triggers (HP6, HP7, HP10, HP14 per the source report) and final EAL code (`17 05 03*`). This is the single most important test in this slice — it's the real-world proof the engine is correct, not just internally consistent.

**Unit tests per module**, using hand-worked numbers (same discipline as the prior engine's tests):
- `tests/hp-classification/normalize.test.ts` — dry-basis conversion math, LOQ-as-conservative-value carrying forward, the "no tørrstoff value" fallback flag.
- `tests/hp-classification/speciate.test.ts` — asserts arsenic at 5.17% element expands to the three compound-form % values (6.83%, 7.93%, 5.17%) matching the derivation above, and an element with no registered compound forms passes through unchanged.
- `tests/hp-classification/hazard.test.ts` — HP6 sum-within-category (not across categories), HP7/HP11 individual-substance-not-summed (two carcinogens at 0.06% each must NOT trigger HP7, only one at ≥0.1% should), HP5's solid/viscosity carve-out (a solid waste at any concentration never triggers Asp. Tox. 1), HP4-superseded-by-HP8 when both would otherwise trigger, and the HP14 M-factor cascade evaluated top-to-bottom stopping at first match (a case that would trigger both Chronic 1 and Chronic 2 thresholds should report only Aquatic Chronic 1, per the "stop at first match" rule).
- `tests/hp-classification/eal.test.ts` — the lab-agreement and lab-disagreement cross-check paths, and the origin-process-not-found halt behavior from Stage 0.

## Error handling / honesty behavior

- Stage 0's halt-on-missing-`originProcess` is preserved exactly as `decision_engine.md` specifies — the engine never guesses a chapter from matrix type alone.
- Every "not automatable" and "not tested — assumed not applicable" outcome is a literal string result, never coerced to a boolean — callers must handle the three-state (true/false/not-automatable) nature of `resultsByHp` explicitly.
- A substance with no `AnalyteReference` entry (unmapped `analyteId: null`) is excluded from every HP calculation that would otherwise use it, with a confidence flag noting the exclusion — never guessed into a category.
- A substance with no M-factor recorded defaults to M-factor 1 per the CLP Annex I §4.1.3.5.5 baseline, and is never excluded from the HP14 sum — this is called out separately because silently excluding it would understate HP14 risk, the opposite direction of error from the tool's job.
