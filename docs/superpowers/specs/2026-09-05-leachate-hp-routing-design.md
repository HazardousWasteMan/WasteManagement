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
   analysis results, not just leachate/eluate concentrations." **Granularity, confirmed against
   the real schema**: `buildBkPageSchema()` (where all three flags live) is extracted **per
   sample**, not per document — its field descriptions already say "denne prøven" (this sample).
   A bundle with multiple sub-reports already gets one independent schema instance per sample
   (the existing multi-sample-per-bundle pipeline). So a document containing sample A (both
   leaching and total-content data) and sample B (leaching only) correctly produces two
   independent flag sets and two independent gating decisions — this is architecturally already
   correct, not something this fix has to build; it only has to not break it. Proven explicitly
   by a dedicated test case (see Testing).
2. **`isHazardous` becomes `boolean | null`** in `HazardClassification` — `null` means
   "cannot be determined from the data available," never a guessed `true`/`false`.

   **Full consumer inventory, confirmed by grepping the whole tree (this is bigger than the
   original draft of this spec estimated — every one of these needs an explicit decision, not
   silent boolean coercion):**

   | File | Current behavior | Required change |
   |---|---|---|
   | `lib/hp-classification/eal.ts` (`assignEalCode`) | `isHazardous: boolean` param | New `null` branch: `code: null`, explicit "cannot assign — hazard status indeterminate" message |
   | `lib/bk-skjema/form-map.ts` (`BkSource.isHazardous`, Checkbox1/3/4/6, buildDescription) | `boolean` | `boolean \| null`; indeterminate → all four checkboxes unchecked + shared note (§ 9-6-grounded) |
   | `lib/bk-skjema/from-datalab.ts` | passes `classification.hazard.isHazardous` straight through | passes the `boolean \| null` through unchanged, threads the three new extraction flags into `classifySample` |
   | `lib/hp-classification/facility-match.ts` (`FacilityMatchInput.isHazardous`, `checkStoleheia`/`checkReturkraft`) | `boolean`; falsy branch currently *assumes non-hazardous* and describes an "ordinary/contaminated mass path" | **Safety-relevant**: `null` must NOT fall into the non-hazardous branch — route it to the existing `eligible: "insufficient data"` state (already used elsewhere in this file for a different gap) with a reason naming the indeterminate hazard status. Falling through to "assume non-hazardous" here would be the exact kind of fabrication this whole fix exists to prevent, just relocated to facility-matching instead of HP classification. |
   | `app/api/facility-match/route.ts` | validates `typeof isHazardous !== "boolean"` → 400 | accept `isHazardous: boolean \| null` explicitly (reject only if neither) |
   | `lib/projects.ts` (`WasteEntry.isHazardous`) | `boolean`, persisted (localStorage-based case data) | `boolean \| null` — a committed case entry can genuinely be indeterminate; this is real data, not a fixable default |
   | `app/page.tsx`, `app/projects/[id]/page.tsx` (`hazardousEntryCount`) | `entries.filter(e => e.isHazardous).length` | add a SEPARATE `indeterminateEntryCount` stat, shown alongside — `null` naturally falls out of the existing filter (undercounts hazardous, never overcounts, safe by construction) but must not be silently invisible as its own count |
   | `app/cases/[id]/page.tsx` (Chip) | `entry.isHazardous ? "Hazardous" : "Non-hazardous"` | third branch: `null` → "Indeterminate — manual review required" chip (distinct color, not reusing hazardous-red or non-hazardous-green) |
   | `components/wizard/Wizard.tsx` (case-flow commit) | reads `hazard.isHazardous` off the SAME shared `classifySample()` — the older wizard pipeline is not a separate code path from this bug | must allow committing an indeterminate entry (don't block the workflow — matches this codebase's existing HP1-3/HP9/HP12/HP15 "case-specific, not-automatable" precedent of deferring to a human rather than blocking) |
   | `components/wizard/ClassificationResultsStep.tsx`, `FacilityMatchStep.tsx` | `"Yes"/"No"` boolean display | third state: "Indeterminate" / matching Norwegian if applicable |
   | `components/data-lab/SampleSwitcher.tsx` (tab label) | `isHazardous ? "farlig avfall" : ealCode` ternary | third branch for `null` |
   | `components/dashboard/DepotMap.tsx` / `lib/depots.ts` (`depotIsLit`) | `analysisIsHazardous: boolean` param, already has a separate `isHazardous?: boolean` OPTIONAL prop upstream (used for "no filter" today) | `null` (indeterminate) → no depot lit, same as "no filter today," since this is a display convenience, not a routing decision — lower stakes than facility-match's actual eligibility logic |

   This is a real, larger-than-originally-estimated blast radius, confirmed with the user before
   planning (2026-09-06) — deliberately chosen over the narrower alternative (a separate,
   additive `hazardDeterminable` flag with `isHazardous` staying a plain, conservatively-defaulted
   boolean) specifically so the whole app — not just the BK-skjema output — is honest about an
   indeterminate hazard status rather than silently defaulting it anywhere, including in
   safety-relevant facility-matching.
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
   **Single source of truth for the explanation text (a real gap caught in review):** the
   indeterminate-state wording must exist in exactly ONE place — the new `confidenceFlags` entry
   added in Step 3 — and every downstream renderer (Checkbox9/10's shared note, Checkbox1/2/3's
   note, `buildDescription`'s new sentence) reads that same string, rather than each independently
   hardcoding its own paraphrase. If `classify-sample.ts`'s confidenceFlags text and
   `form-map.ts`'s note text were separate literals, they could drift apart and say subtly
   different things about the same field on the same form. The implementation plan must wire
   `s.hazard.confidenceFlags` (or the specific indeterminate-reason entry within it) through to
   `form-map.ts` as the literal source `buildDescription`/the checkbox notes quote — not restate
   it.
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
- **A mixed-document case, proving gating is per-sample, not per-document** (a real gap caught in
  review): one bundle with two samples — sample A carries both leaching and total-content data
  (`totalinnhold_utfort: true`), sample B carries leaching data only
  (`totalinnhold_utfort: false`). Assert sample A still gets a real `true`/`false` verdict while
  sample B gets `null` — proving the fix operates on each sample's own extracted flags
  independently, since `buildBkPageSchema()` is already a per-sample schema and must stay that
  way through this change.
- **A single-string-source test** proving the confidenceFlags text and the rendered BK-skjema
  note are the same value, not independently duplicated: assert `checkbox9.note` (or whichever
  field carries it) equals the exact string in `hazard.confidenceFlags`, not merely "contains
  similar words."
