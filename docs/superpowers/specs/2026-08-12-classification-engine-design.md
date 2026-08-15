# Stage 2 Classification Engine — Real EAL/HP-Criteria/Tilstandsklasse

Date: 2026-08-12

## Context

This spec implements Stage 2 ("Classification") of the customer's "Hazardous Waste Compliance & Matching Platform" project brief — the stage the brief itself identifies as "where the actual defensible IP lives." It evolves the existing WastemanagementPortal app (real PDF extraction, dashboard UI, real WMR partner-matching) rather than starting a new project: the wizard flow, extraction path, and partner-matching UI stay as they are; only the classification logic underneath is replaced for soil/stone matrices.

**Explicitly out of scope for this spec** (per the brief's own staging, confirmed with the user):
- Stage 1 (extraction) — reused as-is from the existing app, extended only with one new structured field (see §1).
- Stage 3 (cross-border compliance routing / shipment regime).
- Stage 4 (rebuilding the handler capability database against the new classification output — the existing `wmr-partners.json` matching keeps working off whatever EAL code this engine produces, unchanged).

## The measurement-type problem this spec solves

The existing `ExtractedWasteData.tclpMetalsMgL` field is **US EPA TCLP leachate data (mg/L)** — the method used in the app's current US-format sample reports. Norwegian tilstandsklasse and EU HP-criteria are defined against **total solid concentration in mg/kg dry matter** — a different lab test (total digestion), not a unit conversion of the same measurement. Feeding TCLP leachate values into a total-concentration threshold table would silently misclassify waste. This spec adds a new, separate field for total-concentration data and only runs the new engine when that data is actually present — it never approximates one measurement type as the other.

## Non-goals

- No tilstandsklasse→hazardous-designation mapping. Tilstandsklasse (1–5) is computed and surfaced as informational/severity output only. Whether a given tilstandsklasse implies "farlig avfall" hazard status is a real regulatory question this spec does not have a sourced answer for — the `hazardous` determination comes entirely from HP-criteria (§4), not from tilstandsklasse. Mapping tilstandsklasse to lead-time/urgency is called out in the brief under Stage 3 and stays there.
- No HP14 (Ecotoxic) computation. No sourced concentration-limit table was found for HP14 in EU Regulation 1357/2014 (Annex III to the Waste Framework Directive) — the text states HP14 criteria come from a separate act not yet fetched. The engine ships with an explicit `"needs-sourcing"` status for HP14 rather than a fabricated threshold.
- No independent confirmation of the brief's asbestos presence/absence rule. EU Regulation 1357/2014's text does not mention asbestos; under its general HP7 rule, asbestos (classified Carc.1A under CLP Annex VI) would in principle follow the same 0.1% concentration threshold as any other Carc.1A substance, not a presence/absence rule. This spec keeps the brief's presence/absence rule (matching the existing app's current asbestos-detection behavior) but marks it in code and docs as unverified against the EU text found, pending a further source (e.g. Norwegian national implementing guidance).
- No change to non-soil-matrix classification (oil sludge, solvents, drilling waste, used oil) — `pickEalCode()`'s existing keyword-based logic for those matrices is untouched.
- No change to the Files, samples, or search-classify path beyond the one new field on `ExtractedWasteData` (§1) — search-mode classification (`lib/search-classify.ts`) is unaffected since it never has total-concentration data to work with; it continues to use the existing keyword-based EAL lookup.

## Approach

### 1. Extraction schema extension

Add to `ExtractedWasteData` (`lib/types.ts`):

```typescript
totalConcentrationsMgKg: Record<string, number>; // total solid concentration, mg/kg dry matter — distinct from tclpMetalsMgL (leachate, mg/L)
```

Update `EXTRACTION_PROMPT` in `lib/extraction.ts` to describe this field distinctly from the existing TCLP fields — instructing Claude to populate it from "total concentration" / "total metals" / "bulk concentration" columns (as opposed to "TCLP" / "leachate" columns) when a lab report contains them, using the same substance-key naming convention already used for `tclpMetalsMgL`. Update `validateExtractedWasteData` to require the field exist (as an object, possibly empty) matching the pattern already used for `tclpMetalsMgL`.

The six existing US-format reference samples will predictably populate this field as `{}` (empty) — they only report TCLP leachate data. This is expected, not a defect: the new engine correctly reports "insufficient data" for them (§5).

### 2. Real threshold data

**`lib/data/tilstandsklasse-thresholds.json`** — transcribed verbatim from Miljødirektoratet's official TA-2553 table (source: miljodirektoratet.no, "Tilstandsklasser for forurenset grunn"), mg/kg tørrstoff:

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

`classBoundaries` is the upper bound of classes 1 through 5 in order (a concentration ≤ `classBoundaries[0]` is class 1; between `classBoundaries[0]` and `classBoundaries[1]` is class 2; above `classBoundaries[4]` is beyond class 5 / off the table — reported as `"above tilstandsklasse 5"`).

**`lib/data/hp-criteria-thresholds.json`** — transcribed from EU Regulation (EU) No 1357/2014, Annex III:

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

**`lib/data/substance-clp-classification.json`** — a small per-substance lookup mapping the substances this engine actually evaluates to their relevant CLP hazard classes, so `computeHpCriteria` knows which threshold row applies:

```json
[
  { "substance": "benzoAPyrene", "clpClass": "Carc. 1B (H350)", "appliesTo": ["HP7"] },
  { "substance": "arsenic", "clpClass": "Acute Tox. 3 Oral (H301)", "appliesTo": ["HP6"] }
]
```

This starts minimal (only substances with a clearly sourced CLP classification) and is explicitly documented as a "maintained reference table" per the brief's own instruction — not exhaustive, grows as more substances are sourced.

### 3. New logic modules

**`lib/tilstandsklasse.ts`**

```typescript
export interface TilstandsklasseResult {
  substance: string;
  concentrationMgKg: number;
  klasse: 1 | 2 | 3 | 4 | 5 | "above-5";
}

export function computeTilstandsklasse(concentrations: Record<string, number>): {
  perSubstance: TilstandsklasseResult[];
  overallKlasse: 1 | 2 | 3 | 4 | 5 | "above-5" | null; // null when no substances matched
}
```

Only substances present in both `concentrations` and `tilstandsklasse-thresholds.json` are evaluated — an extracted substance with no threshold entry is silently skipped (not guessed), and `overallKlasse` is the max klasse across evaluated substances.

**`lib/hp-criteria.ts`**

```typescript
export interface HpFlag {
  hpCode: string;
  substance: string;
  triggeredAtPercent: number;
  thresholdPercent: number;
}

export function computeHpCriteria(concentrations: Record<string, number>): {
  triggeredFlags: HpFlag[];
  hazardous: boolean; // true if triggeredFlags.length > 0 — the real WFD Art. 3(2) rule
}
```

Converts each substance's mg/kg to percent (`÷ 10000`), looks up its CLP classification via `substance-clp-classification.json`, finds the matching threshold row in `hp-criteria-thresholds.json`, and flags it if the percent meets or exceeds the threshold. A substance with no CLP classification entry is skipped (not guessed) — this is the same "narrow but honest" pattern as `computeTilstandsklasse`.

### 4. EAL selection integration

In `lib/classification.ts`, `pickEalCode()` gains a new branch, checked before the existing matrix-keyword logic, active only when `matrix` indicates soil/stone AND `totalConcentrationsMgKg` is non-empty:

1. Asbestos detected (existing keyword/matrix-text check, unchanged) → `17 06 05*`.
2. Else PCB/POP detected (existing `pops.json` alias check against `hazardIndicatorsNoted`, unchanged) → `17 09 02*`.
3. Else `computeHpCriteria(totalConcentrationsMgKg).hazardous === true` → `17 05 03*`.
4. Else → `17 05 04`.

If `totalConcentrationsMgKg` is empty for a soil-matrix sample, fall through to the existing TPH-based soil logic unchanged (today's behavior) — this is the "insufficient data for the new engine, existing behavior is the honest fallback" path, not silently broken.

`ClassificationResult` gains two new optional fields to carry the richer output through to the UI (Task-level detail deferred to the implementation plan):

```typescript
tilstandsklasse: { overallKlasse: 1 | 2 | 3 | 4 | 5 | "above-5" | null; perSubstance: TilstandsklasseResult[] } | null;
hpFlags: HpFlag[]; // empty array, not null, when no total-concentration data was available to evaluate
```

### 5. Error handling / honesty behavior

- No `totalConcentrationsMgKg` data (e.g. a US-format TCLP-only report): `tilstandsklasse` is `null`, `hpFlags` is `[]`, EAL selection falls through to existing TPH/keyword logic. No error is raised — this is an expected, valid outcome, not a failure state.
- A substance present in `totalConcentrationsMgKg` but absent from the threshold/CLP tables: silently excluded from that substance's specific computation, never guessed. (Future improvement, not this spec: surface which substances were skipped, so a reviewer knows what wasn't evaluated.)
- HP14 and the asbestos presence/absence rule: both ship with explicit "not sourced" / "unverified" markers in code comments and this doc — never silently presented as equally solid as the sourced HP4/HP5/HP6/HP7 numbers.

### 6. Testing

Real unit tests in `tests/tilstandsklasse.test.ts` and `tests/hp-criteria.test.ts` against the actual transcribed numbers from §2 — e.g. lead at 250 mg/kg → tilstandsklasse 3 (between the 100 and 300 boundaries); benzo[a]pyrene at 0.05 mg/kg (= 0.000005%) → does not trigger HP7 (well below 0.1%); benzo[a]pyrene at 150 mg/kg (= 0.015%) → still does not trigger HP7 in this specific case since 0.015% < 0.1% (illustrating that concentration thresholds for HP7 are far higher than tilstandsklasse boundaries for the same substance — a real, correct outcome worth a test asserting it, since it's easy to assume incorrectly that "high tilstandsklasse = automatically HP-flagged").

`tests/classification.test.ts` (existing) keeps passing unchanged — its test cases use non-soil matrices or soil matrices with no `totalConcentrationsMgKg`, both of which fall through to unchanged existing behavior.

Manual verification: since none of the app's current six reference samples have total-concentration data, this spec's manual verification step constructs 2–3 synthetic soil samples (real Norwegian-shaped data, using the real threshold numbers from §2) to exercise the new path end-to-end, documented in the implementation plan.
