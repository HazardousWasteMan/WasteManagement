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

---

# Part 3 — one form per chemical test, and completing the rest by hand

## The bundle holds six tests, not five

The Alta PDF was described in the specs as five sub-reports. Detection over the converted blocks
finds **six** distinct Prøvenr., and page 15 is a genuine sixth: its own report number
`AR-25-MM-115718-01`, sample `439-2025-10081002`, marking `ENAT-BØF1-MK01`, analysed by
**DS 259:2003** and — unlike every other sub-report — quoting results in `mg/kg`, not `mg/kg TS`.
That is the "different measurement basis" sample the fixture spec mentions. Nine analytes, which
matches what the extraction returns for it.

`docs/superpowers/specs/2026-08-13-eurofins-concrete-fixture-design.md` says five. It also says
the gold sample resolves to EAL `17 01 07` where the test asserts `17 01 01`. Treat that spec as
stale on both counts.

| pages | matrix | marking | rows |
|---|---|---|---:|
| 0–1 | Aske Asfalt | ENAT-BØF1-MK11 | 40 |
| 2–4 | Betong | ENAT-BØF1-BO9OB1 | 50 |
| 5–7 | Betong | ENAT-BØF1-BO96B1 | 50 |
| 8–10 | Betong | ENAT-BØF1-BO97B1 | 46 |
| 11–13 | Betong | ENAT-BØF1-BO98B1 | 50 |
| 14 | Betong (DS 259) | ENAT-BØF1-MK01 | 9 |

## Splitting is what made it fast, not just correct

Sub-reports are detected from the already-converted block text — every one repeats a
`Prøvenr.: <id>` header row, and pages sharing an id belong together — so detection costs nothing
extra. Each is then extracted against the shared checkpoint with its own `page_range`, four at a
time.

The whole document as one extraction took **4.3 minutes** and produced one form with five samples
blended into it. Six separate extractions of the same document take **89 seconds** and produce six
correct forms, for 11 cents. Datalab's guidance — "use page ranges and document segmentation to
improve speed and accuracy" — understates it: the split is what makes the output usable at all,
because one BK-skjema describes one delivery.

The UI switches between them as tabs. Each tab is an independent form with its own filled PDF,
its own citations, and only its own pages in the document pane.

## Loading on a real result

`public/data-lab-seed.json` (572 KB) holds the analysed Alta bundle, so the tab opens on six
finished forms instead of an empty dropzone. It is built by `bk/build-seed.test.ts` calling the
same `analyseBundle` a live upload calls, so the demo cannot drift from real behaviour. Blocks are
trimmed to only those some citation refers to — 27 of several hundred.

## Filling in the rest

Two things were conflated in "the form is mostly blank", and they needed different answers.

**Some of it was in the document and we weren't asking.** The customer address block on a Eurofins
report carries most of BK-skjema part 2 — Adresse, Postnummer, Poststed and the `Attn:` contact.
The schema now asks for those, and they extract with citations like any other field.

**The rest genuinely is not in a lab report,** and this is a regulatory declaration someone signs.
Organisasjonsnummer, transporter, waste origin, physical form, pre-treatment, colour and odour are
not in the document, and inventing them would be fabricating a compliance record. So instead of
guessing, the fields are now **editable**: every "You fill in" field is a real input in the field
list, typed values flow into the PDF, and a marker appears on the form as each is completed. The
summary counts "Still blank" so it is obvious what remains.

Telephone is deliberately left blank rather than filled from the report: the only numbers on a
Eurofins report are Eurofins's own, and the schema tells the extractor not to use them.

---

# Part 4 — the two part-4 columns, and a second real report

Felix pointed at the two columns the forms were leaving entirely blank: **Avfallets fysiske
egenskaper** and **Har avfallet vært forbehandlet?**. A second report came with the question —
`Asfaltprøver forurensede masser 4 av 4.pdf`, four asphalt sub-reports, and unlike the Alta bundle
it has a real text layer.

## Pre-treatment is not in a lab report, and the one thing that looks like it is a trap

The Alta report has a row that reads exactly like an answer:

```
Homogenisering, knusing    1.0    SS-EN 15002:2015
```

**SS-EN 15002** is *"Characterization of waste — Preparation of test portions from the laboratory
sample."* It is the laboratory crushing a sub-sample so it can be analysed. It says nothing about
whether the waste stream was ever crushed, sorted, burned or treated. Ticking "Oppmaling /
kverning" from that row would put a false statement on a signed regulatory declaration — and it is
exactly the inference an extractor will make if left to its own devices.

The asphalt report contains no such row at all, and states its own limit outright:

> Resultater gjelder prøven slik den ble mottatt hos laboratoriet.

So the column is genuinely underivable. The first attempt was to ask for it anyway, with the
SS-EN 15002 case named explicitly in the field description as *not* an answer.

**That did not work, and the failure is the finding.** Re-running the Alta bundle with that schema
returned `forbehandling: "Oppmaling / kverning"` on **four of the six** sub-reports:

| sub-report | lab-prep row in its results | returned |
|---|---|---|
| ENAT-BØF1-MK11 | no | — |
| ENAT-BØF1-BO9OB1 | **no** | **Oppmaling / kverning** |
| ENAT-BØF1-BO96B1 | yes | Oppmaling / kverning |
| ENAT-BØF1-BO97B1 | yes | Oppmaling / kverning |
| ENAT-BØF1-BO98B1 | yes | Oppmaling / kverning |
| ENAT-BØF1-MK01 | no | — |

Note row two: it asserted the waste had been crushed on a sub-report where no such row appears in
its own extracted results at all. The asphalt report returned nothing only because it lacks the
row, not because the instruction held.

So the question was removed from the schema entirely. Part 4's forbehandling column is a person's
to answer, and a blank field is honest where a confabulated one is a false statement on a signed
declaration. Two tests pin this: the schema must not offer a `forbehandling` property, and a
"Homogenisering, knusing" row present in the results must leave all six boxes clear. Re-adding it
needs a better answer than a stronger prompt.

The general lesson, worth carrying to other fields: for a value that is genuinely absent from the
source, "ask and instruct it not to guess" is not a control. The model fills the slot because the
slot is there. Not offering the slot is the control.

## Physical form is partly derivable, and we were not asking at all

The old schema asked for `fysisk_form` as "fast, flytende eller pulver" — three values against a
form that offers six, none of them "fast". Even a liquid sample therefore ticked nothing.

The physical-form column now mirrors the form's own six options as a schema `enum`, the same trick
used for `analyte_id`, so mapping is a string compare and Datalab decides from the report text
with a citation. It is described as report-only, with instructions to omit rather than guess, and
has returned empty on all ten sub-reports tried across both reports — correct in every case, but
given what `forbehandling` did, treat that as unproven rather than safe. On the asphalt report it
came back empty, correctly: "Prøvetype: Asfalt" is a *material*, and says
nothing about whether the delivery arrives as a monolithic core or crushed heterogeneous masses.

The coarse solid/liquid/powder the hazard engine needs moved to its own `fysisk_tilstand` field,
so the two purposes stop fighting over one value.

## The asphalt report also fixed a hole in the waste-type column

| | |
|---|---|
| sub-reports | 4 (ASF1–ASF4), one form each |
| pages | 8, with a text layer |
| EAL | `17 03 02` — bituminous mixtures, non-hazardous |
| rows | 40 each |
| cost | 19 cents, 79 s |

`matrixType` came back "Asfalt", and the form's waste-type list has no asphalt row — so all ten
boxes stayed blank with a "matched none" note. "Annet" is the right answer there, and is now the
fallback for any matrix the form does not name. A matrix that was never read still ticks nothing,
which a latent bug had got wrong: the old catch-all regex `/^$/` matched the empty string, so an
unread matrix would have ticked "Annet".

## What still cannot be filled, and why that is the correct answer

Organisasjonsnummer, transporter, waste origin, pre-treatment, colour and odour are not in a lab
report and are not inferable from one. They are editable in the UI, and the summary counts them as
"Still blank". The alternative — plausible defaults — would produce a form that looks complete and
is partly invented, on a document someone signs.
