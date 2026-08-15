# Eurofins Concrete Sample — Second Regression Fixture

Date: 2026-08-13

## Context

Every real-data validation of the HP1-15 engine so far runs against a single fixture: the Italian LabAnalysis excavated-soil report (hazardous, arsenic-driven). A real Norwegian Eurofins report is now available — a scanned PDF (no text layer, confirmed via the same `pdf-parse` check used in the scanned-PDF extraction slice) bundling five lab sub-reports for an Alta lufthavn (Avinor) concrete/asphalt sampling project: a PFAS panel and four "Totalanalyse betong" (total concrete analysis) metals/hydrocarbon/PAH/PCB panels, one of which uses a different measurement basis (`mg/kg` rather than `mg/kg TS`).

This spec adds the fullest single concrete sub-report (sample `ENAT-BØF1-BO9OB1`) as a second real, hand-transcribed regression fixture. Unlike the Italian sample, this one is genuinely non-hazardous at every measured value — it proves the engine correctly resolves a clean sample to a real non-hazardous EAL code, not just that it can detect hazards.

This is explicitly the start of an incremental pattern, not a one-off: each new real report added as a fixture both proves the engine against one more real-world case and grows `AnalyteReference`/`hp-thresholds`/`element-compound-forms` toward covering more substances — the engine and its prompt get more general over time as more real reports are run through it, not by trying to anticipate every possible report shape up front.

## Scope of this slice

**In scope:**
- One real fixture: `fixtures/eurofins-concrete-sample.json`, hand-transcribed from the `ENAT-BØF1-BO9OB1` sub-report (pages 3-5 of the source PDF): dry-matter %, physical state, and the full metals/Cr(VI)/hydrocarbon/PAH16/PCB7 result table.
- Three new `AnalyteReference` entries with real, sourced CLP classifications: mercury (Hg), chromium VI, and benzo[a]pyrene — the substances in this sample that could plausibly affect its hazard determination.
- A second end-to-end regression test proving: (a) the engine correctly normalizes and classifies this sample, (b) it resolves to a real **non-hazardous** EAL code (`17 01 07` — mixtures of concrete/brick/tile/ceramic NOT containing hazardous substances) since nothing in this sample triggers any HP category.

**Explicitly out of scope:**
- The other four sub-reports in the same bundled PDF (PFAS panel, the three remaining concrete samples, the DS-259-method sample) — one fixture proves generalization; the others are real, available follow-on fixtures for a later slice, not discarded.
- Exhaustive `AnalyteReference` coverage of every substance this sample's report mentions (the remaining PAH16 members, PCB7 congeners, aliphatic/aromatic hydrocarbon fractions) — these extract and normalize correctly but are honestly excluded from hazard classification with no CLP entry, same "skip, never guess" discipline already established, not silently dropped or approximated.
- Live extraction of this specific PDF through the browser — the fixture is hand-transcribed and used for the function-level regression test, matching how the Italian sample's fixture was built before its own live-extraction slice came later.
- Stage 4 facility matching — still doesn't exist; nowhere for an "insufficient data" path to attach regardless of which sample is used.

## Data — the fixture

Transcribed from the real report (Prøvenr. `439-2025-10080994`, referanse "Alta lufthavn - PFAS-prosjektet"):

- **Metadata**: matrix = concrete ("Betong"), physical state = solid, dry matter (`Tørrstoff`) = 94.6%, origin process = "concrete, brick, tile, or ceramic waste" (existing chapter-1701 dropdown option).
- **Results** (all `mg/kg TS`, i.e. already dry-basis): Arsenic 1.8, Lead 3.3, Cadmium <0.20 (below LOQ), Copper 13, Chromium (total) 15, Mercury <0.0096 (below LOQ), Nickel 9.4, Zinc 41, Chromium VI 1.6, plus the aliphatic/aromatic hydrocarbon fractions and PAH16/PCB7 rows (extracted but not all hazard-classified, per scope above) — Fluorene 76 µg/kg, Phenanthrene 320 µg/kg, Fluoranthene 38 µg/kg, Pyrene 57 µg/kg are the only PAH16 members with values above LOQ; Benzo[a]pyrene itself is `<30 µg/kg TS` (below LOQ, i.e. 0.003% — far below any real threshold even if it had been detected).

Every value in this sample is far below any HP threshold already in `hp-thresholds.json` — this is expected and is exactly what makes it a good non-hazardous-path fixture: chromium VI at 1.6 mg/kg (0.00016%) is nowhere near HP7's Carc. 2 0.1% threshold; mercury is below LOQ entirely.

## Reference data — three new entries

**`lib/data/analyte-reference.json`** gains:
- `mercury` — CAS `7439-97-6`, real EU CLP classification (Acute Tox. 1 Oral/Dermal, per Annex VI — exact H-statement/threshold to be sourced during implementation from the real hp-thresholds table, not guessed).
- `chromium-vi` — CAS `18540-29-9`, real EU CLP classification (Carc. 1B, H350 — chromium VI compounds are harmonised carcinogens under CLP Annex VI).
- `benzo-a-pyrene` — CAS `50-32-8`, Carc. 1B, H350, 0.1% threshold — the same HP7 entry class the Italian sample's arsenic pentoxide/trioxide already use, just a different substance.

No new `hp-thresholds.json` rows are needed — HP6/HP7/HP8's existing threshold rows already cover Acute Tox./Carc. categories these substances fall into; this is purely adding substances to the CLP-classification lookup, not new regulatory categories.

## Testing

- `tests/hp-classification/eurofins-concrete-sample.test.ts` — the second end-to-end regression test, structured identically to `italian-sample.test.ts`: `classifySample()` called with the transcribed fixture, asserting `hazard.isHazardous === false`, `hazard.triggeredHps` is empty, and `eal.code === "17 01 07"`.
- Existing `italian-sample.test.ts` is untouched and must keep passing — this slice adds a second fixture/test, it doesn't modify the first.
- Unit tests for the three new `AnalyteReference`/`hp-thresholds` lookups follow the same hand-worked-number discipline as existing tests (e.g. confirm chromium VI at 1.6 mg/kg normalizes to 0.00016% and correctly does NOT trigger HP7's 0.1% threshold).
