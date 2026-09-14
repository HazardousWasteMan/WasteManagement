# Measurement-to-classification boundary — Step 1

Implemented on `product/production-core`. No HP formulas, HP aggregation semantics, EAL rules,
BK descriptions or visual design were changed. No commit, push, merge or remote migration.

## Model and flow

Extraction → `prepareMeasurements` → eligible rows → normalization → existing speciation/CLP
mapping → existing HP formulas → existing EAL/BK projection.

`MeasurementBoundary.version = measurement-boundary-1`. Every row is retained with:

- `measurementId`, `sampleId`: document/report + sample + result identity. Duplicate result IDs
  receive deterministic occurrence suffixes. Stable for the same extraction, not a promise of
  identity across a fresh provider extraction with reordered rows.
- `rawLabel`, `rawValueText`, `rawUnit`; `rawValueTextOrigin` distinguishes reported text from
  reconstruction when an old extraction only contains a number. Original supplied lexemes survive.
- `parsedValue`: finite non-negative detected value, otherwise null. `reportedLimit` is separate.
- `censoring`: `<`, `<=`, `non-detect`, `detected`, `missing`. Decimal comma is supported.
- `source[]`: reference plus optional document hash, page, region, block ID. Datalab retains
  existing citations and the PDF hash. Anthropic has the original PDF hash and row reference;
  verified page/region coordinates are unavailable and are not invented.
- `analyticalRole`: total_content, leaching_batch, leaching_column,
  physical_or_composition, unknown.
- `roleReview`: established/needs_review plus the evidence/rule used. This is deterministic
  review state, not a calibrated model-confidence probability.
- `basis`: dry, as_received, liquid_volume, unknown; `method`, `testContext`.
- `mapping`: mapped/unmapped plus reference analyte ID. This means reference membership,
  not verified species identity or completeness of its CLP classifications.
- `hpEligibility`: boolean and all exclusion reasons.

Both provider adapters reach `classifySample`, and direct `normalizeSample` callers also run
this gate. Provider-supplied eligibility is never trusted. Normalized rows and expanded HP inputs
carry the originating measurement ID. Data Lab origin reclassification forwards the same evidence
identity. Production snapshots automatically retain the envelope in `normalizationTrace` and
classification, with the new normalization/boundary versions. Historical snapshots are untouched.

## Exact role policy

Evaluate raw label + quoted row/table context + method:

1. Recognized negated test phrases (no/not/without/ikke/ingen/uten near a test term, or test
   terms followed by not performed/ikke utført/not measured/absent) stay unknown.
2. Labels starting sum/summa stay unknown for mapping review. Physical labels starting pH,
   TOC, DOC, TDS, dry matter, moisture, tørrstoff, glødetap, loss on ignition, total organic carbon
   or temperature become physical_or_composition.
3. Conflicting bulk/leaching or batch/column evidence stays unknown.
4. Column/kolonne/kolonnetest/percolation → leaching_column.
5. Batch/ristetest/shake test/shaking test → leaching_batch.
6. Leach/eluate/eluat/utlek/utvask/L/S context without a known test kind stays unknown.
7. Total-content/total content/total_content/totalinnhold/bulk concentration/total concentration/
   contenuto totale → total_content.
8. A true sample total-content flag may establish bulk only if no row or sample flag indicates
   leaching. An explicitly false total-content flag plus exactly one positive batch/column flag
   establishes that leaching role. Otherwise unknown.

Units and matrix alone never establish a role. Mixed reports need row/table-specific evidence.
An L/S ratio alone proves that the row is unsuitable for bulk HP here, but does not distinguish
batch from column. This is deliberately a small semantic recognizer, not an ontology or vendor parser.

## Exact bulk HP eligibility

All conditions are required:

- Role is explicitly total_content.
- Unit is `%`, `mg/kg`, `µg/kg`, `μg/kg` or `ug/kg`, case/whitespace normalized, with optional
  TS/dw/ss/s.s./tørrstoff suffix. Divisors to percent: 1, 10,000, 10,000,000 respectively.
- Basis is unambiguously dry, using the reported basis/dry flag or recognized unit/context marker.
  Conflicting basis signals become unknown. A liquid denominator establishes liquid_volume,
  never leaching. No density, moisture, wet-to-dry or liquid conversion is performed.
- Analyte exists in the reference table.
- Detected numeric value or censored limit is finite and non-negative, with no invalid,
  conflicting or unparsed numeric/censoring evidence.

Every failed condition is retained as a reason. Unknown/unsupported units yield no normalized
concentration and can never fall through to raw percent. Physical/composition, leaching and
unknown rows do not enter concentration formulas. Existing separate contextual/test inputs are
unchanged; this slice adds no new non-concentration rule consumption.

Censored values retain the existing conservative limit-substitution policy. This change does
not claim that a limit-based trigger is an established detection or resolve censoring uncertainty.

## Persistence and compatibility

New exclusion records replace the old invalid normalized rows. Application finalization and
an additive database trigger both block excluded total-content/unknown evidence so this change
cannot remove the prior review barrier. Explicit physical/leaching exclusions alone are not such
blockers; existing readiness, no-data and gap-acknowledgement policies still apply. There is no
new override or review UI.

Migration: `20260912000000_measurement_boundary_finalization.sql`. Tested with all ten migrations
from a clean offline PGlite database, including authenticated direct-RPC rejection of a mixed
valid/unsupported report. No remote database was touched. This does not substitute for applying
and validating it against the team's running local/staging Supabase/PostgREST/Auth stack.

Existing snapshots remain readable and immutable; reprocessing produces new versioned results.
Old extractions without role/basis evidence now exclude those rows. An existing legacy regression
previously obtained extra HP triggers from an unestablished-basis row; its expectation now verifies
exclusion. The underlying HP formulas and EAL selection code are unchanged.

## Validation and limits

Run from the repository root, with provider credentials disabled for deterministic tests:

```sh
DATALAB_API_KEY= ANTHROPIC_API_KEY= ANTHROPIC_AUTH_TOKEN= node node_modules/vitest/vitest.mjs run tests/hp-classification tests/bk-skjema tests/production tests/compliance
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build --webpack
```

Tests cover the ten requested cases, negated/conflicting context, invalid values, duplicated IDs,
raw lexemes, censoring limits, stable reclassification identity, legacy extraction provenance,
and application/database finalization safety. Inputs used by the production-core regression
surface are invented and generated locally; provider calls and customer-derived fixtures are not used.

Remaining risks before Step 2:

- Role context is extracted by providers; wrong/omitted context remains possible. These lexical
  rules are intentionally incomplete, including negation/languages and calculated-sum terminology.
  Real-provider and confidential local-document validation remain necessary.
- Unknown HP evidence can still aggregate to false with `noDataWarning`, and partial eligible
  evidence can still yield an overconfident aggregate. Finalization guards help production, but
  existing Data Lab/BK/EAL displays retain their old semantics. Step 1 is not full classification
  correctness approval.
- HP10, HP14, other formula/aggregation gaps, species assumptions, mirror-entry/EAL ambiguity and
  BK wording remain deferred. No landfill acceptance decision is added.
- Wet/as-received and liquid-volume calculations remain unsupported. LOQ uncertainty is retained
  but not resolved. Reference membership does not verify actual species or complete H-statements.
- Segmentation completeness, legacy partial-batch failure and indistinguishable repeated rows
  remain existing limitations. No segmentation redesign was made.
- Live provider extraction, confidential PDFs, real Supabase Auth/PostgREST and a browser
  regression were not exercised by this implementation's automated checks.

## Files changed in this slice

This inventory excludes the earlier, already-uncommitted Phase 1–4 implementation.

| File | Change |
| --- | --- |
| `lib/hp-classification/measurement.ts` (new) | Typed evidence envelope, role/basis detection and shared eligibility policy. |
| `lib/hp-classification/types.ts` | Optional extraction evidence fields and normalized measurement identity. |
| `lib/hp-classification/normalize.ts` | Eligibility filtering and supported-unit conversion; removes unsafe percent fallback. |
| `lib/hp-classification/classify-sample.ts` | Gate before speciation, retained envelope/trace, per-input identity and exclusion notes. Legacy unit diagnostic is unused by classification. |
| `lib/hp-classification/hazard.ts` | Optional measurement ID on the input type only; no formula changes. |
| `lib/hp-classification/extract.ts` | Anthropic evidence/context instructions and document/row provenance. |
| `lib/hp-classification/pdf-batching.ts` | Deduplication includes censoring limit, context, method, mapping and provenance. |
| `lib/bk-skjema/datalab.ts` | Optional raw text, role context, basis and method in extraction schema. |
| `lib/bk-skjema/from-datalab.ts` | Maps extracted evidence and existing citations into the shared input contract. |
| `lib/bk-skjema/analyse-bundle.ts` | Original PDF hash and sample identity passed to the adapter. |
| `app/api/classify/route.ts` | Returns retained boundary for the legacy path; rejects a null/non-object body. |
| `app/api/data-lab/reclassify/route.ts` | Forwards evidence identity when classifying the same extraction again. |
| `app/data-lab/page.tsx` | Sends existing envelope identity with reclassification requests; no visual change. |
| `lib/production/versions.ts` | New normalization and measurement-boundary version identifiers. |
| `lib/production/finalization-policy.ts` | Keeps unresolved concentration evidence blocking after normalization exclusion. |
| `supabase/migrations/20260912000000_measurement_boundary_finalization.sql` (new) | Equivalent additive database finalization guard. |
| `tests/hp-classification/measurement.test.ts` (new) | Synthetic boundary, provider-path parity, evidence preservation and reclassification tests. |
| `tests/hp-classification/normalize.test.ts` | Explicit bulk context for concentration tests and additive identity expectation. |
| `tests/hp-classification/classify-sample.test.ts` | Updates old missing-context/unit assumptions to explicit evidence and exclusions. |
| `tests/hp-classification/extract.test.ts` | Context-preservation prompt contract and source provenance checks. |
| `tests/hp-classification/synthetic-basis-eal-review.test.ts` | Invented regression checks exclusion of an unestablished-basis row and safe EAL review state. |
| `tests/production/synthetic-fixtures.ts` | Explicit leaching-only and mixed-invalid invented cases. |
| `tests/production/project-processing.test.ts` | Finalization exclusion assertions and direct-RPC mixed-evidence rejection. |
| `docs/product/production-core.md` | Links this completed slice and supersedes older normalization assumptions. |
| `docs/product/measurement-boundary.md` (new) | Model, exact policy, compatibility, migration, validation and file inventory. |

Deterministic regression result: **688 tests passed across 38 files**, including HP, Data Lab/BK,
production persistence/finalization and compliance unit tests. The compliance integration folder
is excluded by the repository's Vitest configuration. Focused lint has no errors and two existing
unused-import/variable warnings. Repository-wide lint separately reports **12 errors and 1,477
warnings**, in unchanged legacy pages/components and the existing PDF worker; no lint cleanup
was included in this slice.

Final `tsc --noEmit --incremental false`, Next.js production webpack build, additional
reclassification-request lint, and `git diff --check` all passed.
