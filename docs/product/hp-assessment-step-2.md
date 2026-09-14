# HP assessment — implementation Step 2

Implemented on `product/production-core`, following the measurement boundary. No EAL selection,
landfill acceptance or visual design changes. No commit, push, merge or remote migration.

## Rule sources and changes

The repository's Norwegian source is [Avfallsforskriften chapter 11, Annex 2](https://lovdata.no/dokument/SF/forskrift/2004-06-01-930/KAPITTEL_14-2).
The matching primary EU instruments are [Regulation 1357/2014](https://eur-lex.europa.eu/eli/reg/2014/1357/oj/eng/pdf)
and [Regulation 2017/997](https://eur-lex.europa.eu/eli/reg/2017/997/oj/eng/pdf).
These sources, rather than old test expectations, determine the rule boundaries. The HP14 PDF
was retrieved; Lovdata and the 2014 instrument were cross-checked through indexed primary-source
text because direct retrieval was blocked. This is not a fresh verification of every CLP reference
entry. Existing compliance citation resolution/freezing is unchanged.

- HP10: individual H360-family concentration ≥0.3%, H361-family ≥3%. Independent substances
  are not summed. Qualified F/D/FD/DF variants are matched through a normalized family code;
  the original code remains in the input trace. H350i maps to H350; unknown suffixes fail closed.
- HP14: any individual H420 ≥0.1%; ΣH400 ≥25%; 100ΣH410 + 10ΣH411 + ΣH412 ≥25%; or
  ΣH410 + ΣH411 + ΣH412 + ΣH413 ≥25%. Per-substance cutoffs: H400/H410 0.1%; H411/412/413 1%.
  M factors do not enter these waste equations. Each equation is evaluated and recorded.
- HP4: H314 is restricted to Skin Corr. 1A for the 1% sum threshold. H318 sum threshold 10%;
  H315+H319 combined threshold 20%; individual cutoff 1%. Unknown H314 subclass creates an issue.
- HP8: all H314 corrosive subclasses, sum threshold 5%, individual cutoff 1%. Confirmed HP8
  explicitly supersedes HP4 through `supersededBy`, with an evidenced not-applicable result.
- HP6: retain category/route-specific thresholds, apply 0.1% cutoffs for acute categories 1–3 and
  1% for category 4. Unknown category/route is unresolved, not silently negative.
- HP5: retain individual STOT and conditional aspiration calculation. Missing/invalid liquid
  viscosity is an assessment issue. HP7/11/13 retain individual thresholds.
- HP1/2/3 have no default exemption. Relevant hazard indicators retain input IDs for review.
  Missing physical evidence is not-assessable. A generic negative flammability result does not
  establish that every HP3 condition is absent.
- HP9 remains manual without appropriate contextual evidence. Norwegian HP12 presence codes
  EUH029/031/032 and HP15 H205/EUH001/019/044 are recognized. Confirmed presence invokes the
  property absent an evidenced exception; assumed species or censored presence requires review.
  With no such evidence these properties remain manual, not automatically inapplicable.

Reported positive physical tests can establish a trigger. Negative tests have no verified method,
full property scope or applicability in the current schema. They cannot certify absence; a negative
corrosion/irritation test conflicting with a positive calculation requires review. This is a safe
limitation of the current evidence schema, not a claim that calculations legally outrank valid tests.

## Typed outcomes and aggregation

Every new `resultsByHp` entry is a `HpOutcome` with HP code, status, coverage, reason, measurement
and input IDs, rule version, calculations, issues, conservative-assumption flag, and optional
supersession. Status is one of:

- triggered
- not_triggered
- not_assessable
- not_applicable
- requires_manual_assessment

`coverage` distinguishes a calculation on supplied inputs (`screening_only`) from an established
property decision (`property_assessed`). Calculations preserve formula, threshold, cutoffs, lower
and upper values, strict/inclusive upper bound, candidate input IDs and selected maximum-contribution
scenario per measurement. Qualitative/manual rules have no invented concentration threshold.

`aggregate.status` is authoritative machine state. `isHazardous` is its compatibility projection:
true / false / null. Neither English nor Norwegian prose controls calculations or readiness.

Exact policy:

1. Any confirmed triggered property → hazardous, even if other properties need review.
2. Otherwise, non_hazardous requires all 15 properties to be explicitly resolved as not_triggered
   or evidenced not_applicable, with property_assessed coverage and no unresolved issues.
3. Missing properties, screening-only negative results, manual/not-assessable outcomes, invalid
   inputs and exclusion/mapping issues → indeterminate.

Current lab-only extraction does not establish comprehensive composition or resolve all contextual
properties. Therefore it cannot certify non-hazardous waste merely by finding no calculated trigger.
The pure aggregate supports a complete evidenced assessment, but no manual review UI or external
sign-off API is introduced in this slice. A confirmed hazardous result remains possible and can be
finalized subject to existing readiness checks; unresolved other HP details remain structured review
issues, visible in saved calculation evidence. Indeterminate HP issues are blocking.

## Censoring and speciation

Detected inputs contribute their measured concentration to both bounds. Censored inputs contribute
zero to the lower bound and their reported limit to the upper bound. `<` has an open upper bound;
`<=` has a closed bound. A strict limit equal to a cutoff cannot contribute to that sum. Generic
non-detects use a closed conservative bound when the operator is unknown.

A confirmed lower-bound crossing triggers. A crossing possible only at the upper bound requires
manual assessment and records the uncertainty. If neither bound reaches a threshold, the supplied
inputs do not trigger that rule; this does not establish complete waste evidence. The below-LOQ
numeric substitution remains in normalization for compatibility, but the HP engine now consumes
its censoring state rather than treating that number as a measured detection.

`speciateElement` returns candidate conversions marked alternative_species. Each elemental
measurement has a mutually exclusive alternative group. For each equation, contributions are summed
inside a candidate, then the maximum candidate contribution is selected per measurement. Alternatives
are never added together as simultaneous elemental mass. Different equations can select different
worst-case candidates, and that selection is recorded. No exponential full-combination search or
chemistry ontology is introduced.

Assumed species contribute only to the screening upper bound. The candidate list is not proven
exhaustive: even a non-crossing screen leaves species completeness unresolved. Element-only evidence
also cannot assert that a particular hazardous compound was actually detected; the existing detection
flag becomes null unless a reported, detected hazardous compound supplies positive evidence.

## Persistence and backward compatibility

Version: `hp-waste-2026-09-10.2`; production engine version also advances. Old assessment snapshots,
raw data, finalized artifacts and stored bytes are never rewritten. Legacy boolean/string outcomes
remain readable via the compatibility adapter; they are not promoted to modern negative evidence.
The existing result component only adapts rendering to typed values and labels legacy results.

Production eligibility now returns structured HP issues with blocking/review disposition. New
finalization rejects indeterminate or legacy HP state. The additive migration
`20260913000000_hp_outcome_finalization.sql` also checks the current per-property version/status,
confirmed trigger for hazardous claims, and fully assessed resolved properties without issues for
non-hazardous claims. All eleven migrations are exercised from clean offline PGlite databases.
No running remote Supabase project is migrated. Real Supabase/Auth/PostgREST validation is still a
staging gate. Existing finalized downloads remain available, while old unfinalized assessments
require reprocessing. New processing uses the new rule version; a successor copying an old analysis
retains its old evidence honestly and cannot bypass the reprocessing requirement.

EAL code is untouched. Its output can change because it receives null more often. Its old null-status
explanation still mentions leaching-only data; that wording is a known Step 3 issue, not a new HP
machine state. BK and landfill mapping receive the truthful tri-state without changes to their rules.

## Tests, validation and remaining boundaries

Independent synthetic tests cover all requested rule cases: HP10 individual/suffix boundaries,
HP14 equations/H420/cutoffs/M-factor independence, HP4 subclasses/HP8 supersession, strict and inclusive
LOQ bounds, alternative-species grouping, aggregate coverage and manual properties, invalid inputs,
legacy reading, and application/direct-RPC finalization rejection. Existing unsafe formula and
boolean expectations were replaced, not used as rule authorities. Existing checked-in regressions
use invented inputs; no customer documents, excerpts, identifiers or provider payloads are used.

The two existing live Lovdata archive routing tests failed with connection/test timeouts during the
broad regression run. Deterministic validation excludes that network-dependent file, not the rest of
compliance. Real provider calls, confidential real documents, accredited physical-test interpretation
and a full browser workflow were not tested in this implementation.

Final validation: **777 tests passed across 49 files** in the complete deterministic suite.
The production webpack build and its TypeScript check passed; standalone TypeScript also passed.
Targeted lint passed with one existing unused-import warning in `classify-sample.test.ts`.
Repository-wide lint is not claimed clean by this validation. `git diff --check` passed.

The broad run also reached four credential-dependent local scripts (`bk/build-seed.test.ts`,
`bk/data-lab.test.ts`, `bk/run-pipeline.test.ts`, `bk/segment.test.ts`); these failed without provider
credentials and were excluded from the deterministic rerun alongside the live Lovdata file.
No provider credentials were supplied for these runs. The tracked reclassification test was updated
for indeterminate output. Generated BK/PDF/coverage artifacts were restored after the tests and are
not part of Step 2. Logs are retained locally under `/tmp/wm-step2/`.

Before Step 3/team review:

- EAL mirror-entry selection, missing origin and the misleading legacy null-status explanation.
- Independent domain review of the rule implementation and reference CLP/species completeness.
- Evidence-backed manual/physical assessment and test-method applicability before enabling a
  non-hazardous certification path. No override is added merely to unblock finalization.
- Representative confidential local-document/provider regressions, without committing originals.
- Dry-basis versus waste-as-received mass-fraction policy, moisture/density conversion, report
  segmentation completeness and uncertainty beyond censoring remain outside this slice.
- Verify migration and finalization through real Supabase Auth/PostgREST/RLS in staging.

## Files changed in Step 2

- `lib/hp-classification/hp-outcome.ts` (new): typed outcomes, aggregate policy, H-code matcher,
  read-only legacy adapter.
- `lib/hp-classification/hazard.ts`: corrected calculations, bounds, scenarios and outcome evidence.
- `lib/hp-classification/classify-sample.ts`: propagates censoring/scenarios and boundary issues;
  removes the pre-classification shortcut so even excluded reports receive all 15 outcomes.
- `lib/hp-classification/speciate.ts`: explicit candidate/assumption metadata.
- `lib/data/hp-thresholds.json`: HP10 and HP14 evaluation-basis metadata corrected.
- `components/wizard/ClassificationResultsStep.tsx`: typed/legacy display compatibility only.
- `lib/production/versions.ts`: new engine and HP rule version.
- `lib/production/finalization-policy.ts`: structured HP review/blocking issues and version/state gate.
- `supabase/migrations/20260913000000_hp_outcome_finalization.sql` (new): database enforcement.
- `tests/hp-classification/hp-rules-v2.test.ts` (new): independently derived synthetic rule cases.
- `tests/hp-classification/hazard.test.ts`: typed expectations, replaces obsolete HP14 cascade tests.
- `tests/hp-classification/classify-sample.test.ts`: tri-state and evidence expectations.
- `tests/hp-classification/measurement.test.ts`: path parity by status and assumed-species detection.
- `tests/hp-classification/synthetic-basis-eal-review.test.ts`: unknown-basis evidence is excluded and a laboratory code remains review-only.
- `tests/hp-classification/synthetic-limited-evidence.test.ts`: limited evidence no longer certifies a negative.
- `tests/bk-skjema/from-datalab.test.ts`: tri-state expectations; keeps isolated legacy BK mapping tests.
- `bk/reclassify.test.ts`: existing saved-extraction regression now expects indeterminate status.
- `tests/production/synthetic-fixtures.ts`: known-compound synthetic happy path, no assumed species.
- `tests/production/project-processing.test.ts`: finalization blockers, legacy immutability and successors.
- `docs/product/production-core.md`, `docs/product/production-core-readiness.md`: current scope notes.
- `docs/product/hp-assessment-step-2.md` (new): this report.
