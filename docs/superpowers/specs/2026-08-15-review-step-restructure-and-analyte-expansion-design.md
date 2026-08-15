# Review-Step Restructure & Analyte Reference Expansion — Design Spec

## Problem

`ExtractionReviewStep.tsx`'s analyte-results table is one long flat list — for a real multi-panel
report (confirmed against the real "Alta Lufthavn PFAS-prosjektet" Eurofins report: PFAS, metals,
TPH hydrocarbon fractions, PAH(16), PCB(7) — ~90 result rows), this is unreadable. Every unmatched
substance is ALSO duplicated in a separate "Not evaluated — no reference match" bullet list below
the table, doubling the visual length for reports with many gaps (this report alone has ~40
unmatched rows today).

Separately: `analyte-reference.json` has real, verified gaps this exact report exposes — 35 PFAS
compounds and 7 indicator PCBs have no reference entry at all, and Chromium VI is reported
separately from total chromium with no entry of its own. And the extraction pipeline currently
reports non-substance rows (dry-matter %, calculated aggregate sums) as if they were unmatched
analytes, which is noise, not a genuine data gap — confirmed by reading `normalize.ts`: the raw
dry-matter percentage is never used by any calculation (only a separately-derived boolean flag
is), and sum rows are redundant with `classifyHazard`'s own per-substance summation.

## Fix 1: Group the analyte-results table by substance category

Group rows by `substanceGroup` — a field every matched `AnalyteReference` entry already carries
(metal, PAH, hydrocarbon, and the new PFAS/PCB groups this spec adds) — into collapsible sections
with a match-count header, e.g. "Metals (8)", "PFAS (35)", "PCB (7)". Rows with no match (no
`substanceGroup` to group by) go into their own "Not in reference table (N)" section, rather than
being force-fit into a guessed category. No new categorization logic is needed beyond grouping by
a field that already exists on every matched row.

## Fix 2: Replace the separate unmatched list with an inline indicator

Remove the "Not evaluated — no reference match" bullet-list block entirely. Each unmatched row's
existing "— unmatched —" cell gains a small warning-triangle icon with a hover tooltip carrying
the same explanation the removed block gave ("excluded from hazard classification rather than
guessed"). The row itself is the notice — no separate block duplicating every name a second time.

## Fix 3: Extraction prompt — exclude genuine non-substances, as a general rule

Extend `buildSchemaInstructions` in `lib/hp-classification/extract.ts` with a general instruction
— described by what a row IS, not by enumerating this one report's exact Norwegian labels — so it
generalizes across languages and report formats:

> Do not report a row as an analyte result if it is a quality-control/methodology parameter (e.g.
> dry-matter or moisture content, measurement uncertainty, temperature) or a pre-calculated
> aggregate sum of other rows already being reported individually (e.g. a "Sum X" total). Only
> report individual, substance-identifiable analyte results.

This is deliberately a *rule*, not a list of literal strings — it must correctly skip "Tørrstoff"
today and "residuo secco"/moisture-content wording in a differently-formatted report tomorrow,
without needing a prompt edit each time a new report uses different phrasing.

**Explicitly NOT excluded by this rule**: TPH/hydrocarbon carbon-range fraction rows (e.g.
"Alifater >C12-C35", "Aromater >C10-C16"). These are real, hazard-classification-relevant
substances — `analyte-reference.json` already has a working pattern for representing them
(`hydrocarbons-c10-c40`, `casNumber: null`, real `H411`/`H304`/`H319` classifications feeding
HP5/HP14) — they are unmatched today only because this report's real Norwegian SPI-2011 fraction
naming doesn't textually resemble the existing entries' names, not because they're non-substances.
Excluding them from extraction would silently discard genuinely important classification data for
oil-contaminated soil, which is exactly the mistake this spec's review caught before implementation.

## Fix 4: Analyte-reference expansion — three real, sourced additions

All entries below follow this project's established discipline: real CAS numbers and CLP hazard
classifications sourced from ECHA/PubChem (or the Norwegian regulatory source noted for the
TPH fractions), cross-verified, honest `null`/gap markers over any fabricated value — the same
process used for every prior analyte-reference round this session.

1. **35 PFAS compounds**, confirmed present and currently unmatched in the real report: 4:2 FTS,
   6:2 FTS, 8:2 FTS, HPFHpA, PF-3,7-DMOA, PFDA, PFBA, PFBS, PFDoDA, PFTrDA, PFDS, PFHpA, PFHpS,
   PFHxA, PFHxDA, PFHxS, PFNA, PFOA, PFOS, PFOSA, PFPeA, PFTeDA, PFUnDA, EtFOSA, EtFOSAA, EtFOSE,
   MeFOSAA, MeFOSE, MeFOSA, FOSAA, PFPeS, PFNS, PFUnDS, PFDoDs, PFTrDS. New `substanceGroup: "PFAS"`.
2. **7 indicator PCBs**: PCB 28, 52, 101, 118, 138, 153, 180. New `substanceGroup: "PCB"`.
3. **Chromium VI** as an entry distinct from total chromium (`elementSymbol`/CAS specific to the
   Cr(VI) oxidation state, not the metal generally) — the real report states both separately with
   different toxicological profiles (Cr VI is a real CLP carcinogen category, unlike Cr generally).
4. **Real Norwegian TPH hydrocarbon-fraction naming**, so this report's `Alifater`/`Aromater`
   carbon-range rows can actually match: research the real Norwegian regulatory source for how
   these SPI-2011-method fractions map to CLP hazard statements (Norway's guidance for
   oil-contaminated soil classification is the right real source to check first, not an
   invented mapping) and add fraction-specific `AnalyteReference` entries — or confirm during
   implementation that the existing `hydrocarbons-c10-c40`-style entries can legitimately extend
   to cover these fraction names, whichever the real source actually supports. If no real,
   verifiable source exists for a specific fraction's hazard classification by the time this is
   implemented, that fraction stays honestly unmatched rather than getting a guessed
   classification — same discipline as everything else in this codebase.

## Non-goals

- No change to `classifyHazard`'s HP1-15 logic itself — this spec only expands what data reaches
  it and how results are displayed, not the classification rules.
- No change to the case/project data model or wizard flow — this is scoped to the extraction
  review step's UI and the underlying reference data.
- No attempt to map every possible non-English/non-Norwegian/non-Italian report format's
  QA-parameter vocabulary exhaustively — the general rule in Fix 3 is designed to generalize, but
  verifying it against every conceivable report language is out of scope; real reports encountered
  going forward remain the actual test of whether the rule generalizes well enough.

## Testing

- Component/rendering tests confirming the analyte-results table groups rows by `substanceGroup`
  correctly, including the "Not in reference table" fallback group for unmatched rows.
- A test confirming the hover-triangle indicator renders for unmatched rows and the old bullet-list
  block is gone.
- Extraction schema tests (matching the existing `buildMessageContent`-string-assertion pattern)
  confirming the new exclusion-rule wording is present in the built prompt.
- `analyte-reference.json` tests extending the existing pattern: entry count increases by exactly
  the real number of substances added, every new entry has a real CAS number (or an honest `null`
  with a documented reason, for range-substances), and spot-checks against real, cross-verified
  values (mirroring how prior analyte-reference rounds this session verified specific entries like
  `170101`/`010101` against real source data).
- A real, sourced test confirming the 4 previously-unmatched TPH fraction rows for THIS report
  (or whichever subset the real research in Fix 4 supports) now match and produce a real, non-null
  hazard classification.
