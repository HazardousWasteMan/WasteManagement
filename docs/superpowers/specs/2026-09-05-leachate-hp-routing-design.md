# Leachate-Only Sample HP Routing Fix — Design

**Status:** Approved for planning
**Branch:** `compliance`
**Builds on:** the compliance-cache trust model (already built: `lib/compliance/search.ts`,
`resolve-legal-citations.ts`, `citation-view.ts`, `LegalCitationBadge`) and the existing
HP-classification engine (`lib/hp-classification/*`). Reuses both unchanged where possible.

## Problem, confirmed by real research

A document containing **only** a leaching test (ristetest/kolonnetest) — e.g. the user's "G5
Utlekkingstest 1-2 m ristetest" sample, analyte panel As/Ba/Cd/Cu/Hg/Mo — currently gets run
through HP1–15 hazard classification and produces a definitive "avfallet er farlig avfall"
verdict. That's a real category error, confirmed against two independent sources:

- **Eurofins' "Basiskarakterisering av avfall"** guide ([source](https://www.eurofins.no/media/2852897/basiskarakterisering-avfall.pdf)):
  ristetest/kolonnetest metals (As, Ba, Cd, Cr, Cu, Hg, Mo, Ni, Pb, Sb, Se, Zn) + Klorid/Fluorid/
  Sulfat/DOC/TSS are **landfill-acceptance-criteria data** (Avfallsforskriften kap. 9, Vedlegg
  II §2.1.1/2.3.1/2.4.1) — a completely different regulatory question from HP1–15 hazard
  classification (kap. 11), which needs **total-content** data.
- **§ 9-6 itself** (already seeded in `legal_paragraphs`, real text read directly from the
  archive): acceptance criteria are delegated to *"forurensningsmyndigheten"* (the pollution
  authority) — confirming this is a separate, delegated regulatory track from kap. 11's hazard
  determination, not an alternative path to the same answer.

## Confirmed code gaps

1. **No field anywhere distinguishes leachate concentrations from total-content concentrations.**
   `SampleMetadata`/`SampleResult` (`lib/hp-classification/types.ts`) have no such flag.
   `classifySample()` (`lib/hp-classification/classify-sample.ts:63`) feeds whatever `results`
   array it receives straight into `classifyHazard`, unconditionally.
2. **The raw signal already exists in extraction, but is discarded.** Datalab's extraction
   schema (`lib/bk-skjema/datalab.ts:318-319`) already asks for `ristetest_utfort`/
   `kolonnetest_utfort` (booleans: was a shake/column test performed) — but neither is read
   anywhere downstream. No symmetric `totalinnhold_utfort` flag exists yet.
3. **`HazardClassification.isHazardous` is a plain, non-nullable `boolean`** (`hazard.ts:29`) —
   there is no way to represent "cannot be determined," so any fix must either fabricate a
   value or add a real tri-state, matching this codebase's existing "never guess" pattern used
   everywhere else (`EalAssignment.code: string | null`, `search()`'s `no_match` tier, etc.).
4. **`HazardClassification.confidenceFlags`** (already exists, already rendered in the older
   wizard's `ClassificationResultsStep.tsx:81-86`) is the natural place to carry a human-readable
   explanation — but it is **not currently surfaced anywhere in the Data Lab / BK-skjema output**
   (`lib/bk-skjema/form-map.ts`), which is the pipeline this bug was actually found in.

## Design

1. **New extraction field**: `totalinnhold_utfort: boolean` in `lib/bk-skjema/datalab.ts`,
   mirroring the two existing flags — "True only if the report contains total-content (bulk)
   analysis results, not just leachate/eluate concentrations."
2. **`isHazardous` becomes `boolean | null`** in `HazardClassification` — `null` means
   "cannot be determined from the data available," never a guessed `true`/`false`. Every
   consumer (`assignEalCode`, `form-map.ts`'s Checkbox1/2/3/9/10 wiring, `buildDescription`)
   must handle the `null` case explicitly rather than coercing it.
3. **Gating rule in `classifySample`**: when `(ristetestUtfort || kolonnetestUtfort) &&
   !totalinnholdUtfort`, skip substance-level HP triggering entirely and set `isHazardous: null`,
   with a `confidenceFlags` entry explaining why (leaching-test-only data, total content
   required). This is a real, disclosed gap — never a fabricated hazardous/non-hazardous
   assertion on data that structurally cannot answer that question.
   **Default-absent handling, explicit (a real ambiguity caught in spec self-review):** the vast
   majority of existing/real reports genuinely do carry total-content data and simply won't have
   `totalinnhold_utfort` populated by extraction runs that predate this fix (or where the LLM
   didn't think to set it). Treat an absent/`undefined` `totalinnholdUtfort` as `true` (assume
   total content present, i.e. today's existing behavior), NOT `false` — the gate must only fire
   when `totalinnholdUtfort` is explicitly `false` (extraction positively confirmed no
   total-content data exists) AND at least one leaching flag is explicitly `true`. This keeps the
   fix scoped to the real bug (a document that genuinely has only leachate data) without turning
   every ordinary report indeterminate just because a field is missing.
4. **`assignEalCode` gets a new branch** for `isHazardous === null`: returns `code: null` with a
   clear `confidence`/`confidenceNo` message ("cannot assign an EAL code — hazard status could
   not be determined from leaching-test data alone"), reusing the existing
   `confidence`/`confidenceNo` pattern (the Norwegian-translation fix from earlier this session).
5. **BK-skjema wiring**: when `isHazardous === null`, Checkbox9/Checkbox10 (Innhold av farlige
   stoffer: Nei/Ja) both render unchecked (neither asserted) with a shared note explaining the
   indeterminate state; Checkbox1/2/3 (landfill category) likewise cannot be determined and
   render unchecked. `buildDescription`'s generated text gets a new sentence for this case.
6. **Legal grounding, zero new seeding required**: § 9-6 is already seeded (from the prior
   landfill-category plan). Add ONE new `resolve-legal-citations.ts` `RESOLVED_FIELDS` entry,
   key `"hazard-indeterminate-basis"`, pointing at the SAME already-cached § 9-6 paragraph,
   attached to the indeterminate-state note. This is the first real case of one paragraph
   grounding two different fields — exactly the scenario the trust-model plan's own disclosed
   follow-up (`hasUnresolvedDispute()` scoping by paragraph id alone) anticipated. Confirmed
   still a real, disclosed, deferred gap, not something this spec resolves — noted explicitly in
   Known follow-ups below.

## Explicitly deferred, not part of this spec

- **Citing kap. 9 Vedlegg II's actual limit-value table** (§2.1 and its numbered subsections).
  Confirmed via direct archive inspection that Vedlegg II exists (`data-lovdata-URL="SF/
  forskrift/2004-06-01-930/KAPITTEL_11-2"`, title "Karakterisering og kriterier for mottak av
  avfall") but isn't addressable by `LovdataSource`'s current `§article-paragraph` parser —
  Vedlegg sections use a different, currently-unhandled anchor scheme. This is real, scoped,
  separate work, not attempted here. § 9-6 alone is sufficient grounding for *this* fix, since
  the fix's claim is "acceptance criteria are delegated elsewhere," not "here are the specific
  limit values."
- **Expanding the seed corpus to other chapters** (kap. 10, 10a, 13/13A, 14A, 17, 18A — the
  roadmap confirmed with the user). Demand-driven only; nothing in this spec needs them.
- **Composite `(paragraphId, resolvedFieldKey)` dispute scoping.** Still deferred, but now
  materially closer to mattering, since § 9-6 is about to ground two fields at once.

## Testing

- Unit tests for the new tri-state `isHazardous` logic in `classify-sample.ts` and
  `assignEalCode`'s new `null` branch, following this codebase's existing real-fixture-driven
  test style.
- A `from-datalab.test.ts` case built from the real "G5 Utlekkingstest" pattern (ristetest
  metals only, `ristetest_utfort: true`, `totalinnhold_utfort: false`) proving the pipeline now
  produces `isHazardous: null`, no EAL code, and the § 9-6-grounded indeterminate note — instead
  of today's fabricated "farlig avfall" verdict.
- A regression case confirming a normal total-content report (e.g. the existing Eurofins
  concrete fixture) is completely unaffected — `totalinnhold_utfort: true` (or absent, defaulting
  non-blocking) still produces a real `true`/`false` verdict as today.
