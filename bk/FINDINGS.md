# BK-skjema fill test — how well does extraction actually cover the form?

Test: run the real extraction pipeline over a real Norwegian lab report, then fill the
official *Sammendrag av basiskarakterisering for avfall til deponi* form from nothing but
what came out of it.

- **Form**: `bk-skjema-blank.pdf` — 2-page AcroForm, 103 fields, all generically named
  (`TextField1..53`, `Checkbox1..46`, `group1/2/3/6`). Mapped to their printed labels
  geometrically by `map_fields.py` (widget rects joined to nearest label) → `field-map-raw.json`.
- **Analysis**: `analyse-eurofins-betong.pdf` — Eurofins Norway, Avinor / Alta lufthavn,
  5 bundled sub-reports. Scanned, **no text layer** (`hasUsableText: false`), so extraction ran
  the vision/document path. Target sub-report: lab Prøvenr. `439-2025-10080994`, the one
  `fixtures/eurofins-concrete-sample.json` hand-transcribes — so there is a gold standard.
- **Outputs**: `bk-skjema-utfylt.pdf` (filled form), `pipeline-output.json` (raw extraction),
  `classified.json` (hazard + EAL), `coverage-report.json` (per-field provenance).

## Extraction quality: good

Against the hand-transcribed gold fixture, extraction from a **scanned** PDF got:

- `externalReportNo` `AR-25-MM-118438-01` ✓, `labName` ✓, `customerName` `Avinor AS` ✓,
  `matrixType` `Betong` ✓, `physicalState` `solid` ✓, sampling/receipt dates ✓
- **45 result rows** vs the fixture's ~40 — every metal, Cr(VI), aliphatic/aromatic fraction,
  all 16 PAH and all 7 PCB congeners, with correct values, LOQs, units and below-LOQ flags.
  Spot-checked against the fixture: As 1.8, Pb 3.3, Cd <0.20, Cu 13, Cr 15, Hg <0.0096,
  Ni 9.4, Zn 41, Cr(VI) 1.6, Fluoren 76, Fenantren 320, Fluoranten 38, Pyren 57 — all exact.
- After the fix below, classification reproduces the gold verdict exactly: **not hazardous,
  no HP category triggered, EAL 17 01 01** (asserted in `reclassify.test.ts`).

Reading numbers off a scanned lab table is the hard part, and it is the part that works.

## What the test found

### 1. Unit strings ending in "TS" were read as percentages — 4 orders of magnitude wrong (FIXED)

`normalize.ts` matched units literally (`unitRaw === "mg/kg"`). Real reports — and therefore
real extraction output — write the dry-basis marker into the unit: **`"mg/kg TS"`**,
`"µg/kg TS"`. Every such row fell through to the `else` branch and was used **as-is as a
percentage**: arsenic 1.8 mg/kg became 1.8 %, 18 000× too high.

Result on a genuinely clean concrete sample: **hazardous, HP4 HP5 HP6 HP7 HP10 HP11 HP13 HP14**
(see `pipeline-output.json` → `classification`, produced before the fix). The `unrecognized
unit` confidence flag that normalize does raise never surfaced — `hazard.confidenceFlags` was
`[]`.

This was invisible to the test suite because both fixtures are *hand-transcribed* with
`unitRaw: "mg/kg"`, with the TS fact moved into `expressedOnDryBasis`. Nothing between
`extract` and `normalize` canonicalizes units — `/api/classify` validates `unitRaw` is a string
and passes it through. `tests/wizard/group-analyte-results.test.ts:18` already uses
`"µg/kg TS"` as a realistic value, so the codebase knew the shape.

**Fixed** in `lib/hp-classification/normalize.ts`: strip a trailing dry-basis marker
(`TS`/`tørrstoff`/`ss`/`dw`) before matching. Two regression tests added in
`tests/hp-classification/normalize.test.ts`. All 480 pre-existing tests still pass.

### 2. `listSamples` is nondeterministic and can hand back a report number as a sample

Three runs over the same PDF, three different answers:

| run | returned |
|---|---|
| 1 | 5 samples keyed on lab Prøvenr. (`439-2025-09301193`, `…-10080994`, …) |
| 2 | `AR-25-MM-120316-01` — the **report number**, offered as a top-level sample |
| 3 | (pinned identifier, detection bypassed) |

It also keys on the lab's Prøvenr., never the customer's own marking, so looking a sample up by
the marking a user would recognise (`ENAT-BØF1-BO9OB1`) silently falls through — in run 1 that
pointed extraction at the wrong sub-report (an ash/asphalt PFAS panel) and produced a fully
plausible, entirely wrong form. Saved as `pipeline-output-wrongsample*.json`. Not fixed.

### 3. `originProcess` is never extracted, and it hard-halts EAL assignment

`suggestedOriginProcess: null` on every run. `assignEalCode` then returns
`HALT — missing origin/process metadata, cannot select EAL chapter`, so **no EAL code at all**
without a human. It is one dropdown pick, but it gates the single most important field on the
form. `classified.json` records both verdicts: `asExtracted` (halted) and `withOrigin`.

### 4. `cupric-oxide.canonicalNameNo` contains Italian text

`lib/data/analyte-reference.json:293` — `"canonicalNameNo": "ossido rameico"`. The extraction
prompt builds its known-analyte list from the canonical names, so `"Kobber (Cu)"` had no
Norwegian string to match and came back `analyteId: null` (the gold fixture maps it to
`cupric-oxide`). Copper is silently dropped from hazard classification. Not fixed — one-word
data edit, but it is reference data with a sourcing convention I did not want to guess at.

### 5. Dry matter is extracted, then dropped on the floor

`Tørrstoff` 94.6 % came through — OCR'd as `"Terrstoff"`, hence unmatched — as a result row with
`analyteId: null`. `ExtractionResult` has no `dryMatterPct` field at all; `dryMatterPct` exists
**only** in the two fixture files and nothing in `lib/` reads it. Harmless here because every
value is already `mg/kg TS`, but a report quoting wet-weight values has no conversion path.

### 6. EAL 17 01 01 is a first-match guess, and the design doc disagrees with the test

`assignEalCode` takes `candidates[0]` from `170101, 170102, 170103, 170107` and flags
`AMBIGUOUS`. That flag is honest, but it means the form's most important field is a coin flip
needing manual review. Note also that
`docs/superpowers/specs/2026-08-13-eurofins-concrete-fixture-design.md` claims `17 01 07`
while `tests/hp-classification/eurofins-concrete-sample.test.ts:31` asserts `17 01 01` — the
test is the authority; the spec is stale.

## Coverage: 17 of 103 fields fill themselves

| provenance | fields |
|---|---:|
| filled from extraction | 3 |
| filled by the classification engine | 14 |
| filled with a stated assumption (`group1`, `group6` — delivery is a commercial fact) | 2 |
| needs a human | 49 |
| landfill fills (section 1) | 3 |
| not applicable (section 5, tilstandsklasse) | 13 |
| **total mapped** | **103** |

The honest read: extraction covers **section 3** (waste type, code, hazard status, test status,
description) almost entirely, and that is the technically hard half of the form. What it cannot
touch:

- **Section 2 in full** — producer org.nr., address, contact, transporter. Never in a lab
  report; needs a customer record, not better extraction.
- **TOC / glødetap** — not measured in this report, and required for *deponi for ordinært
  avfall*. The form cannot be legitimately completed from this analysis alone.
- **Leaching tests** (ristetest/kolonnetest) — absent, so `deponi for inert avfall` cannot be
  claimed even though the sample is clean. Ticked *ordinært* conservatively.
- **Avfallets opprinnelse** — blocked by finding 3.
- **Fysiske egenskaper** — `physicalState: "solid"` maps onto none of the form's six options
  (pulver / flytende / monolittisk / heterogent / homogent / annet).
- **Farge, lukt** — visual observations a lab report does not carry.
- **Avfallsstoffnummer NS 9431** — `avfallsstoffnummer-eal-crosswalk.json` has 4 entries, none
  in chapter 1701.

`Checkbox41..46` (forbidden-to-landfill) are deliberately left unticked as a negative
declaration — but since TOC and glødetap were never measured, two of those six cannot honestly
be confirmed either way.

## Reproducing

```bash
set -a && . ./.env.local && set +a
npx vitest run bk/run-pipeline.test.ts   # live API, ~27s, writes pipeline-output.json
npx vitest run bk/reclassify.test.ts     # no API, re-classifies, asserts gold verdict
npx vitest run bk/fill-form.test.ts      # no API, writes bk-skjema-utfylt.pdf + coverage-report.json
```

`map_fields.py` needs `pypdf` and the `pdftotext` binary; its output is committed, so it only
needs re-running if the form itself changes.

---

# Part 2 — the Data Lab tab, and Datalab vs the Anthropic pipeline

A new tab (`/data-lab`, "Data Lab" in the sidebar) takes a chemical analysis and returns the
BK-skjema's fields, with a side-by-side view: the document on the left, the form's 103 fields on
the right, and clicking a field draws a box on the exact region the value came from.

## How it works

Extraction is [Datalab](https://datalab.to)'s structured-extraction API, in two calls:

1. `POST /api/v1/convert` — `output_format=json`, `add_block_ids=true`, `save_checkpoint=true`.
   Returns a block tree where every block has an id (`/page/2/Table/11`), a `bbox` and its html,
   plus a `checkpoint_id`.
2. `POST /api/v1/extract` — `checkpoint_id` + `page_schema`. Returns the schema filled in, with a
   `<field>_citations` sibling for **every field and every table cell**, holding those same ids.

Passing the checkpoint means the document is parsed and billed once. The block ids are the join
key that makes "press the field, see the original text" possible — resolving a citation gives the
page, the bbox and the verbatim text. Cost for the 3-page concrete sub-report: **2–5 cents**.

Two design notes worth keeping:

- **The schema mirrors the form, not a generic lab report** (`buildBkPageSchema`), because the
  tab's job is "put in the sample, get the form's fields". `analyte_id` is a JSON-schema `enum` of
  the real 92-entry `AnalyteReference` vocabulary, so Datalab matches analyte names against the
  same ids the classification engine keys on instead of us guessing Norwegian synonyms locally.
- **Datalab bboxes are in its own rendered-page pixel space.** The `Page` block's own bbox is the
  frame they share, so the overlay normalizes to fractions of it and positions in percentages —
  aligned at any zoom, with no canvas-pixel bookkeeping and no need to know Datalab's DPI.

Origin/process still cannot be extracted (no lab report states it) and still gates the EAL code,
so the tab asks for it up front. Changing it afterwards hits `/api/data-lab/reclassify`, which
re-derives the form from the extraction already paid for — free and instant.

## Datalab vs the Anthropic pipeline, same sub-report

| | Anthropic pipeline | Datalab |
|---|---|---|
| Result rows | 45 | 51 |
| `provemerking` | ✗ lab Prøvenr. `439-2025-10080994` | ✓ **`ENAT-BØF1-BO9OB1`**, the customer's own marking |
| Dry matter | extracted then dropped (no field consumes it) | ✓ `torrstoff_prosent` 94.6 |
| Hentested | ✗ not extracted | ✓ "Alta lufthavn - PFAS-prosjektet" |
| Copper | ✗ unmatched (finding 4) | ✓ matched — the enum bypasses the bad `canonicalNameNo` |
| `labName` | ✓ Eurofins Norway | ✗ "Eurofins Environment **Sweden** AB (Lidköping)" |
| Per-value provenance | none | ✓ page + bbox + verbatim text, per field and per cell |
| Sample detection | nondeterministic (finding 2) | not used — page range is explicit |
| Fields filled | 19 of 103 | **20 of 103** (4 from the document, 14 classified, 2 assumed) |
| Verdict | not hazardous, EAL 17 01 01 | not hazardous, EAL 17 01 01 (both match gold) |

Datalab wins on nearly every field, and the one place it loses is instructive: it reported the
*subcontracted* Swedish lab, citing a list on page 4 rather than the report header. Because the
value is cited, a reviewer clicks it and sees immediately where it came from — which is the
argument for the whole feature. An uncited wrong value is indistinguishable from a right one.

The 20 unmatched analytes are sums and hydrocarbon fractions with no CLP entry (`Sum PAH(16) EPA`,
`Alifater >C12-C16`, …). They are surfaced in the UI, not silently dropped, and correctly excluded
from hazard classification — the same "skip, never guess" discipline the engine already uses.

Note the unit fix from Part 1 is load-bearing here: Datalab returns `enhet: "mg/kg TS"` verbatim,
so without it this backend would have hit the same 18 000× error.

## Verified / not verified

Verified: `next build` clean, `eslint` clean, 490 unit tests pass, the live route returns 103
fields with citations resolving to real pages and bboxes (`bk/data-lab.test.ts`), the page renders
and serves its controls, and the pdf.js worker is served.

**Not verified: the interactive UI in a real browser.** There is no browser tool in this session,
so the upload → render → click-to-highlight loop has not been exercised visually. The pieces it
depends on are individually checked (bbox maths unit-tested, pdf.js `render()` signature checked
against the installed 5.4.296, worker served with the right content type), but the assembled
interaction has not been seen working.

## Reproducing

```bash
set -a && . ./.env.local && set +a
npx vitest run tests/                      # 490 unit tests, no API calls
npx vitest run bk/data-lab.test.ts         # live Datalab, ~2-5c, writes bk/datalab-output.json
npx vitest run bk/fill-form.test.ts        # no API; fills from the Anthropic dump
pnpm dev                                   # then open /data-lab
```

`DATALAB_API_KEY` must be set in `.env.local` (it is gitignored).
