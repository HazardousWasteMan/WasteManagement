# big_test — how much of a real BK-skjema does the current extraction actually get right?

Four folders in `../big_test`, each holding the chemical report(s) and the BK-skjema a human
filled in from them. (test_1 was re-supplied with a real `bk_fasit.pdf` after the first run; the
before-column below is the four-folder baseline re-measured, so both columns cover all four.) The current pipeline (Datalab convert → per-sub-report extract →
`bkFromDatalab` → `classifySample`) was run live over every chemical PDF and scored field by
field against the human forms.

Reproduce:

```bash
set -a && . ./.env.local && set +a
npx vitest run bk/big-test.test.ts     # live Datalab, ~6 min, 63c, writes bk/big-test-out/*.json
python3 bk/big-test-score.py           # no API, prints the table below
```

- `bk/big-test-gold.json` — the human forms, hand-transcribed.
- `bk/big-test-derivable.json` — per test, which gold fields the chemical report can supply at
  all (verified by grepping the source text for the gold value). Everything else is out of scope
  for extraction by construction.

## Headline

Fixes 1-6 below are implemented; both columns are live runs over the same six documents.

| | before | after |
|---|---:|---:|
| Fields the human filled in, across the four folders | 105 | 105 |
| Correct | 28 (27 %) | **35 (33 %)** |
| **Of the 44 fields the chemical reports can actually supply** | **28 = 64 %** | **35 = 80 %** |
| Wrong, asserted as a fact | 31 | **2** |
| Wrong, but flagged as a suggestion for a person to confirm | 0 | 18 |
| Blank | 46 | 50 |
| Wrong "farlig / ikke farlig" verdicts | 3 | **0** |

Per folder, restricted to what the reports can supply: test_2 **93 %** (13/14, was 12/14),
test_4 **89 %** (8/9, was 7/9), test_1 **67 %** (6/9), test_3 **67 %** (8/12, was 3/12).

The two values still asserted wrong are both test_3, and both trace to one thing: Eurofins booked
the betongslam delivery in as `Uspesifisert jord`. That word is the matrix on the form, and it is
the only hint the EAL picker has to choose among chapter 1013's nine non-hazardous candidates.
`Betongslam` appears nowhere in the lab report.

The three values still asserted wrong are all test_3: the EAL code (finding 7 — `10 13 14` is
unreachable from the origin dropdown), the matrix text (`Uspesifisert jord`, which is what the
report says; finding 5 stopped it ticking a wrong checkbox but the field still carries the lab's
word), and "innhold av farlige stoffer: ja", which is hardcoded true whenever an analysis exists
and was `Nei` on the Veidekke form.

Cost: 63 cents, 6 minutes, 12 sub-reports across 6 documents (the merge in fix 2 turned test_3's
three extractions into one, so the after-run is slightly cheaper).

### test_1

Originally shipped with an empty template. Now holds `bk_fasit.pdf` — the Svåheia/COWI form, the
same one test_2 uses — filled for Eramet AS, EAL **17 05 03**, farlig avfall. Its two sources are
both pure scans with no text layer: `Gravemasser Analyser G5.pdf` (5 pages, ALS Laboratory Group
avd. Oslo) and `Gravemasser TOC analyse G5.pdf` (1 page, a screenshot of ALS's Excel support
sheet). Extraction reads both, 59 and 42 rows. See finding 9 for what it concludes from them.

## The scoreboard

```
test_2 (Envir filterkaker, Svåheia-skjema)   12/14 in scope   ✓ produsent, adresse, postnr, poststed,
                                                                kontaktperson, EAL 17 05 04, deponikategori,
                                                                avfallstype, ristetest, kolonnetest, matrise,
                                                                prøvemerking
                                                              ✗ labnavn, hentested
test_3 (Veidekke betongslam)                  3/12 in scope   ✓ testpliktig, TOC 2,1 %, prøvemerking
                                                              ✗ EAL, deponikategori, avfallstype, farlige
                                                                stoffer, ristetest, kolonnetest, materialtype,
                                                                matrise, labnavn
test_4 (Avinor/Anlegg Nord asfalt)            7/9 in scope    ✓ EAL 17 03 02, deponikategori, avfallstype,
                                                                testpliktig, farlige stoffer, matrise,
                                                                prøvemerking
                                                              ✗ materialtype, labnavn
```

## Findings, worst first

### 1. Any unit that is not `%`, `mg/kg` or `µg/kg` is silently used as a **percentage** — FIXED

`normalize.ts` still has the `else` branch that part 1 of `FINDINGS.md` blamed for the
18 000× arsenic error. The `TS` fix closed one door; leaching reports walk in the other.

Leachate results are quoted in **`mg/l`**. `0.069 mg/l` molybdenum becomes `0.069 %`.
`280 mg/l` DOC becomes `280 %`.

Two independent false verdicts in this test set:

| document | rows in mg/l | verdict | triggered |
|---|---:|---|---|
| test_3 kolonnetest sub-report | 21 | **farlig avfall** (gold: ordinært) | HP4, HP7 |
| test_1 Gravemasser G5 | 33 | **farlig avfall** (no gold, but Pb 3.64 mg/kg is clean) | HP7, HP10 |

`nickel-monoxide` triggering HP7 in test_3 is a **below-LOQ** row: `<0.1 mg/l` → 0.1 % →
carcinogenic. A non-detect flipped the form to hazardous waste.

`hazard.confidenceFlags` was `[]` in both cases. `normalizeSample` does raise
`unrecognized unit "mg/l"`, but nothing propagates it up to the classification result, so the
wrong answer arrives with no warning attached — the same gap `FINDINGS.md` part 1 recorded and
that was never closed.

`% tørrvekt` (test_1) is a third unrecognised variant: the dry-basis strip regex handles
`TS|tørrstoff|ss|dw` but not `tørrvekt`.

**Fix**: a leaching result is not a total content and must never reach the HP engine. Drop rows
whose unit is per-volume (`mg/l`, `µg/l`) or whose parameter name carries `L/S=`, and make the
`else` branch **skip the row and flag it** rather than pretend it is a percentage. Surface
`normalizeSample`'s flags on `hazard.confidenceFlags`.

### 2. One delivery, three Prøvenr., three separate forms — FIXED

test_3's report is one sample analysed three ways — total analysis (`439-2026-06010138`),
ristetest (`…0141`), kolonnetest (`…0142`) — all three carrying the **same prøvemerking**,
`1 prøve - 2 bokser`. `detectSubReports` keys on Prøvenr. and produces three forms, none of
which is the form the human wrote:

| sub-report | TOC | ristetest | kolonnetest | verdict |
|---|---|---|---|---|
| …0138 total | 2.1 | nei | nei | ikke farlig |
| …0141 riste | – | **ja** | nei | ikke farlig |
| …0142 kolonne | – | ja | **ja** | **farlig** (finding 1) |
| gold | 2.1 | ja | ja | ikke farlig |

The facts are all there, spread across three forms. Merging sub-reports that share prøvemerking
+ prøvetakingsdato would make ristetest/kolonnetest/TOC correct on one form — 3 more fields, and
it is what makes `Checkbox2 (deponi for inert avfall)` answerable at all.

test_1's scanned ALS report is the mirror problem: it uses no `Prøvenr.:` label, so detection
returned nothing and the whole document fell back to one form — with the same element appearing
twice, once in mg/kg and once in mg/l.

### 3. The lab report's customer is not the waste producer — and we fill part 2 with it anyway — FIXED

| | gold avfallsprodusent | lab report's oppdragsgiver |
|---|---|---|
| test_2 | Envir AS | Envir AS ✓ |
| test_3 | **Veidekke Prefab AS** | Prosjektil AS (the consultant) |
| test_4 | **Anlegg Nord AS** | Avinor AS (the site owner) |

In two of three cases the whole part-2 block — produsent, adresse, postnummer, poststed,
kontaktperson — is a different legal entity from the one that must sign the declaration. That is
**12 wrong values on fields the report cannot supply**, and it is worse than leaving them blank:
a blank field is visibly unfinished, a plausible wrong company is not.

Nothing in the document distinguishes the two cases, so extraction cannot fix this. The fix is
labelling: fill the block from the report but mark it `oppdragsgiver på analyserapporten —
bekreft at dette er avfallsprodusenten`, and default the form's producer field to blank rather
than to the customer.

### 4. `labName` is wrong on 5 of 6 documents — FIXED

Every Eurofins report ends with an `Utførende laboratorium/Underleverandør` list naming Swedish
sub-labs. Extraction takes that list instead of the page-1 header:

| got | should be |
|---|---|
| Eurofins Food & Feed Testing Sweden (Lidköping) | Eurofins Environment Testing Norway (Bergen) / (Moss) |
| Eurofins Environment Sweden AB (Lidköping) | Eurofins Environment Testing Norway (Moss) |

Known from `FINDINGS.md` part 2 as a one-off; it is in fact the default behaviour. The lab name
is in the top-right block of page 1 every time. Either restrict the field to page 1 or tell the
schema explicitly to ignore the subcontractor list.

### 5. `Prøvetype` is the lab's sample category, not the waste type — FIXED

test_3's betongslam is booked in as **`Uspesifisert jord`**, so the materiale column ticks
"Jord og sediment som er forurenset" where the human ticked "Avløpsslam". test_4's `Asfalt`
correctly ticks nothing on the form's list — but the pipeline ticks **"Annet"**, and the human
left the whole column blank. The matrix→checkbox map is right; the input to it is a lab
housekeeping field.

### 6. `hentested` picks up the `Referanse:` field, label and all — FIXED

Returned `"Referanse: PFAS-prosjektet Alta"` and `"Referanse: Testforsøk, fase 1"` — the label
prefix leaking into the value is a plain bug. Beyond that, the real hentested (`Alta Lufthavn`,
`Bedriftsveien 6`) is nowhere in any of these reports; `Referanse` is a job reference, not a
site. The field should be blank, not a job reference.

### 7. EAL: the origin dropdown cannot express two of the three gold codes — FIXED (chapter), OPEN (leaf)

- test_2 → `17 05 04` ✓, test_4 → `17 03 02` ✓
- test_3 → gold **`10 13 14`** (betongavfall og betongslam). Chapter **10 is not in
  `ORIGIN_OPTIONS` at all** — it offers 7 chapters (17, 13, 14, 08, 15, 16, 20). No user choice
  produces this code. Picking the closest available option gives `17 01 01`, which is wrong.

`assignEalCode`'s `candidates[0]` guess happened to be right twice here, but only because
chapter 1703 has exactly one non-hazardous code and 1705's first one is the common answer.

**Fixed in two parts.** `ORIGIN_OPTIONS` is now the 25 curated entries (kept verbatim — their
value strings are stored in submissions and keyed on by the Italian fixture) plus every remaining
nivaa-2 chapter generated from `eal-koder-full.json`, so all 112 real chapters are selectable and
`deriveOriginFromLabCode` resolves a lab-stated code in any of them. And `assignEalCode` now ranks
candidates by how well their own description matches the waste instead of taking file order,
falling back to `candidates[0]` with the AMBIGUOUS flag when no single candidate wins.

Given the right chapter and the right words, this lands the code: `matrise: "Betongslam"` +
chapter 1013 → **10 13 14**, pinned in `tests/bk-skjema/from-datalab.test.ts`. What it cannot do
is invent the words. The live report says `Uspesifisert jord`, which first scored a *win* against
`10 13 99 "Avfall som ikke er spesifisert andre steder"` — a confident wrong code off a word that
means the lab did not know. Catalogue boilerplate and lab non-answers are now stopwords and a
partial match needs five characters, so the hint goes empty and the answer falls back to
`10 13 01` marked AMBIGUOUS. Honestly wrong beats confidently wrong, but it is still wrong: the
leaf code needs a human to say "betongslam".

### 8. Avfallsstoffnummer NS 9431 is never filled — 0 of 3 — OPEN

Gold: `1603`, `1681`, `1619`. The crosswalk has 4 entries and none of these. Every gold form has
it filled, so it is not an optional field in practice.

### 9. ALS quotes the *leached* amount in mg/kg TS under a heading reading "Totale elementer/metaller" — FIXED

test_1's two documents are leaching data end to end: a ristetest (EN 12457-2, L/S=10) and a
kolonnetest (L/S=0,1), plus ALS's Excel support sheet for the same two samples. There is **no
total-content analysis anywhere in the folder**. The fasit's "farlig avfall, 17 05 03" rests on
lead, zinc and manganese contents from the COWI Miljørapport A272536 and other ALS analyses that
were not supplied.

Fix 1 catches a leaching row two ways: a per-volume unit, or `L/S=` in the parameter name. ALS's
ristetest page defeats both. It prints the released mass as **`mg/kg TS`**, with plain element
names (`Pb (Bly)`, `Zn (Sink)`), under a section heading that literally reads **"Totale
elementer/metaller"** — inside a table whose sample label is `G5 Utlekkingstest 1-2 m ristetest`.

So eleven metals at L/S=10 release levels (Pb 3.64, Zn 13.4 mg/kg TS) went into the engine as if
they were total contents, and the pipeline asserted **"ikke farlig avfall, EAL 17 05 04,
deponi for ordinært avfall"** on waste the producer classified as hazardous. Three of test_1's
six misses are that one verdict.

The direction matters: findings 1's false positives called clean waste hazardous, which a
reviewer catches. This calls hazardous waste clean, which a reviewer does not.

**Fixed**, at sub-report level rather than row level, because the row is genuinely
indistinguishable in isolation. Three signals, and the model can only ever add to them:

- the sub-report's own sample label says `Utlekkingstest` / `ristetest` / `kolonnetest` / `L/S=`;
- the schema asks the document per row (`er_utlekkingsresultat`), naming the mg/kg-TS-under-
  "Totale elementer/metaller" trap explicitly;
- and per sample (`har_totalanalyse`) — needed because the ALS Excel support sheet has **no
  `Prøvemerking:` field at all**: its two column headings are the sample labels, so label matching
  missed it on the first attempt and 19 leaching rows in mg/kg TS were still classified.

A per-volume unit, an `L/S=` in the parameter name, or a leaching sample label force the flag on
whatever the extractor answered. When nothing survives, `classifySample` now halts the EAL code
outright rather than returning the non-hazardous mirror, and `buildBkFields` leaves the
deponikategori and avfallstype columns blank and `human` with a note, instead of ticking
"ordinært avfall".

Both test_1 documents now halt: 63/63 and 42/42 rows flagged, `eal.code: null`,
`HALT — no usable total-content analysis in the document`. The form says it does not know, which
is the true answer — the classification the fasit rests on is in a document nobody supplied.

Two bad analyte mappings surfaced alongside it, both from the same enum: `Totalt løst stoff`
(TDS) and `DOC L/S=0,1` both map to `total-hydrocarbons`, and `Antimon (Sb)` maps to
`tin-organostannic-compounds`. All three are leaching rows, so they no longer reach the engine
here — but the mappings are still wrong. **OPEN.**

## What is genuinely out of scope, and correctly blank

34 of the 81 gold fields were left blank, and for most of them that is the right answer:
organisasjonsnummer, transportør, produsentens telefon/e-post, avfallets opprinnelse,
forbehandling, farge, lukt, ekstra forhåndsregler, jevnlig leveranse. None of these appear in
any of the six chemical reports (verified by text search). `fysisk_form` stayed empty on all 12
sub-reports, which remains correct — the gold answers (`Flytende`, `Sammensatt / heterogent`)
describe the delivery, not the analysed sample.

## What was changed

| # | fix | where | effect measured |
|---|---|---|---|
| 1 | A row whose unit is per-volume, or whose parameter name carries `L/S=`, is excluded from hazard classification instead of read as a percentage; an unknown unit is excluded rather than guessed; `normalizeSample`'s flags now ride on `hazard.confidenceFlags` | `lib/hp-classification/normalize.ts`, `classify-sample.ts` | both false "farlig avfall" verdicts gone; 21 and 22 named flags respectively say which rows were set aside |
| 2 | Adjacent sub-reports agreeing on a stated Prøvemerking **and** Prøvetakingsdato are folded into one form | `lib/bk-skjema/segment.ts` | test_3's three forms became one; ristetest, kolonnetest and TOC land together, 3/12 → 8/12 |
| 3 | A `laboratorium` whose citations all land in the subcontractor list is dropped with a note saying where to look; the schema description names the trap too | `lib/bk-skjema/from-datalab.ts`, `datalab.ts` | 3 wrong lab names → 1 right (test_3, via the merge) and 2 honest blanks |
| 4 | Part 2 is `human` with the report's customer prefilled as a suggestion to confirm, not `extracted` | `lib/bk-skjema/form-map.ts` | 11 values that were asserted as fact are now flagged for confirmation |
| 5 | A `hentested` that is really the `Referanse` field is dropped | `lib/bk-skjema/from-datalab.ts`, `datalab.ts` | 2 wrong → blank |
| 6 | No "Annet" catch-all; a Prøvetype that states no material (`Uspesifisert …`) ticks nothing; a matched row is a `human` suggestion | `lib/bk-skjema/form-map.ts` | test_4's column correctly blank; test_3 no longer ticks the wrong row |

| 7 | `ORIGIN_OPTIONS` generated from the whole catalogue (112 chapters, curated 25 kept verbatim and first); `assignEalCode` ranks candidates by description instead of file order | `lib/hp-classification/origin-options.ts`, `eal.ts` | chapter 1013 selectable at all; `10 13 99` false match killed |
| 9 | Leaching detected per sub-report (sample label, `er_utlekkingsresultat`, `har_totalanalyse`), with deterministic floors; no total content → EAL halts and the hazard columns stay blank and `human` | `lib/bk-skjema/datalab.ts`, `from-datalab.ts`, `lib/hp-classification/normalize.ts`, `classify-sample.ts`, `form-map.ts` | test_1's wrong "ikke farlig" verdict gone; 3 asserted-wrong → 0 |
| — | `Checkbox9/10 "Innhold av farlige stoffer"` is a suggestion, not an assertion — the same facts are filed both ways on real forms (Veidekke `Nei`, Avinor `Ja`) | `lib/bk-skjema/form-map.ts` | 1 asserted-wrong → suggestion |

Still open: **8** (the NS 9431 crosswalk has 4 entries; all four gold forms fill this field), the
`10 13 14` leaf code (needs the matrix, which the report does not carry), and the three bad
analyte mappings noted under finding 9.

Verified: `npx tsc --noEmit` clean, `next build` clean, **525 unit tests pass** (19 new). `eslint`
reports 12 errors, all pre-existing and all in files this work did not touch.

One live run in this session hit a 900 s Datalab timeout on test_4 (57 s in every other run) and
passed unchanged on retry — an API hiccup, not a regression.
