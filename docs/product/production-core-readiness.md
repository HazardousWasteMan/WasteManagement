# Production-core readiness review

## Final pre-PR blocker pass — 2026-09-11

The final local blocker pass is implemented and remains uncommitted on
`product/production-core`. Migration `20260915000000_pre_pr_integrity.sql` restricts machine
assessment, processing, BK-revision and final-artifact writes to an explicitly provisioned
backend application identity. It validates the complete declared processing-run set for both
legacy single-document and explicit multi-document assessments, requires exact organisation,
project and source-document relationships, freezes every run, and rejects incomplete extraction
at the database finalization boundary. Existing stored assessments and finalizations are not
rewritten.

Local bootstrap registers its generated app user in `production_backend_identities`. A staging
or production installation must provision the intended server application user in that table
through an administrative migration/bootstrap step. Browser clients receive neither this table
nor backend credentials. Ordinary authenticated-member RPC attempts to forge an assessment,
machine EAL/BK state, processing state or finalized PDF are covered by negative tests.

The production-core tests, offline provider preload and smoke inputs are generated or invented.
They do not load customer PDFs, extracted text, names, sample identifiers or recorded provider
payloads. Two changed legacy fixture regressions were replaced with synthetic limited-evidence
and unknown-basis/EAL-review cases. Existing customer-derived legacy files elsewhere in repository
history are outside this change and were not used for this validation.

Current validation:

- 439 confidential-data-free production/BK/HP/compliance tests passed across 40 files.
- The focused persistence and production UX set passed 48 tests; the SQL integration file passed
  41 tests, including multi-document freeze, tenant/run-scope rejection, direct-RPC negatives,
  immutability, partial extraction and successor cases.
- TypeScript, production build, changed-surface lint and `git diff --check` passed.
- All 13 migrations applied to a clean local PGlite/PostgreSQL database. The harness simulated
  Supabase Auth; it contacted no remote database.
- Repository-wide lint remains separate: 12 errors and 1,477 warnings in legacy pages/components,
  compliance stubs and the generated PDF worker.
- The unrestricted full repository test command was intentionally not used because the legacy
  suite still contains customer-derived fixtures and credential-dependent provider tests.

Draft PR/local checkpoint readiness is subject to the staging gates below. Real Supabase
Auth/PostgREST/RLS, controlled live-provider extraction, backend-identity provisioning,
multi-user/concurrency, backup/restore and migration rollback have not been validated here.

## Classification validation — Step 2

HP rule corrections and typed assessment semantics are implemented.
See [hp-assessment-step-2.md](hp-assessment-step-2.md) for exact rules, sources,
aggregation, compatibility, migration and remaining staging checks. This supersedes
historical statements below that HP calculations are unchanged. EAL/landfill rules
and visual design remain outside this slice; no commit, push or merge.

Status: **ready for team review; production/staging approval is still required**. Phase 4 is
implemented locally on `product/production-core`. Nothing was committed, pushed, merged,
deployed or migrated remotely. This is not a claim that live integrations or disposal eligibility
have been approved.

## 1. What changed from main

The comparison uses local `main` at `ff9e85e` and the current working tree based on
`df208b8c3e6c5d45584956275794d886b1c74744`. There are 94 inherited commits between those refs,
plus uncommitted production-core work. The branch already includes compliance/Lovdata,
tri-state liquid/leachate handling, field-specific disputes, hazardous-substance checkbox fixes
and related tests. Those are part of a prospective merge and must not be confused with new
Phase 4 chemical changes.

Phases 1–4 add organisation-scoped production persistence, one centrally resolved customer
context, Project/PDF intake, sample assessments, logical BK completion/evidence and immutable
finalization. Legacy Data Lab and legacy project/shipment screens remain. No facility matching,
map, shipment, billing or role-management feature was built in these phases.

`git diff main` does not include untracked files. Review the entire working tree, including
`lib/production`, production routes/components, migrations, tests and this documentation, before
preparing any commit or PR. Do not infer the complete change set from tracked diff statistics.

## 2. Architecture

Organisation → Project → WasteStream → immutable Assessment → append-only BK revisions →
immutable finalization. SourceDocument is a separate immutable project-scoped file that can
support multiple sample assessments. EAL and hazard belong to the assessment, not Project.

`getProductionApplication()` resolves and authenticates the configured customer once per
application request. The scoped adapters expose domain, processing, BK revision, finalization
and audit operations. Features do not select arbitrary organisation IDs. Finalization runs in a
single database transaction under the same assessment lock used by edits.

## 3. User workflow

Create/open Project → upload PDF → process samples → open Assessment → inspect BK/Evidence →
answer logical questions → Ready → acknowledge unresolved evidence → Finalize BK → download
stored finalized PDF. Green markers still select the original PDF's page and exact region.

Finalized workspaces are read-only. “Create new draft revision” creates a linked successor
Assessment on the same WasteStream, copying the existing analysis, source associations,
context and human answers. It is editable and may already be Ready because answers were
inherited. This does not imply that classification ran again. Edit answers there; v1 remains
accessible through the previous-assessment link.

Project metadata updates do not rewrite saved context. A successor deliberately inherits the
context actually used; its pickup answer can be explicitly changed. For changed classification inputs or source analysis, first upload/reprocess through the existing
Project flow. Then select that processed assessment under “Evidence for the new revision” in the
finalized workspace. The successor uses its analysis/classification/source links, retains the
original WasteStream and predecessor, and starts fresh human questions. It records the selected
source-assessment identity in its snapshot and audit. Scope checks reject another project's
analysis; inherited answers are rejected for replacement evidence. “Create revision” does not
rerun a classifier itself. Matching the correct sample to the same real-world stream is an
explicit user choice, not an automatic material-identity inference. Known unusable, incomplete or
unversioned replacement evidence is rejected before creating the successor. The selected intake
assessment/stream remains preserved; automatic stream deduplication is not implemented.

## 4. Database/schema changes

Eight additive production migrations follow the existing five compliance migrations:

| Migration | Purpose |
| --- | --- |
| `20260908000000_production_domain.sql` | Organisations/membership, Projects, WasteStreams, SourceDocuments, immutable Assessments/links, RLS and creation RPC |
| `20260909000000_project_document_processing.sql` | Immutable source PDF bytes, processing runs/samples and atomic per-sample persistence |
| `20260910000000_bk_draft_revisions.sql` | Append-only BK answers/context/fields, expected-revision checks and retry identity |
| `20260911000000_assessment_finalization.sql` | Immutable snapshot/PDF, hashes, audit events, finalized edit guard and successor creation |
| `20260912000000_measurement_boundary_finalization.sql` | Blocks unsafe measurement/basis evidence from finalization |
| `20260913000000_hp_outcome_finalization.sql` | Requires structured HP outcomes and preserves indeterminate status |
| `20260914000000_structured_eal_finalization.sql` | Requires structured resolved EAL evidence and audited review metadata |
| `20260915000000_pre_pr_integrity.sql` | Trusted backend writes, complete multi-document run validation and atomic all-run freeze |

Phase 4 adds `production_finalizations` and `production_audit_events`. The exact PDF is stored
as PostgreSQL `bytea` (maximum 25 MiB), alongside JSON evidence and SHA-256 digests. No remote
Storage bucket is needed. Ordinary application users cannot directly write these tables or
select the PDF column. Scoped RPCs perform finalization and artifact downloads.

The schema stores one finalization per Assessment and references its exact BK revision.
Composite ownership keys and membership RLS isolate tenants. Source rows, source bytes,
associations, assessments, revisions, finalizations and audit rows reject changes/deletions.
Audit events are generated transactionally by triggers; callers cannot insert arbitrary events.

Older rows are not backfilled with guessed versions or current legal text. They remain readable,
but require source reprocessing before finalization when original provenance is missing.

## 5. Classification and compliance behavior

Phase 4 does not alter HP formulas, EAL selection, unit conversion, LOQ treatment or thresholds.
An optional trace observer copies the actual normalized values and HP inputs while classification
runs; the indeterminate-basis path records that normalization/HP calculation was not performed.
The normal Data Lab classifier return shape and decisions remain unchanged.

Versions are explicit identifiers in `lib/production/versions.ts` and the logical BK mapping
constant in `lib/bk-skjema/questions.ts`. They are captured at analysis/revision creation, not
assigned retrospectively at finalization. Bump the corresponding identifier when engine logic,
HP/reference data, normalization, EAL logic or BK mapping changes. The release review must tie
these identifiers to the reviewed source commit; the current uncommitted work is not a release
SHA. The PDF template SHA-256 and finalization implementation version are captured separately.

Legal citation resolution now retains a copy of each original `LegalParagraph`, including
text, source, provision identity, verification/change dates, previous-version/amendment metadata
and dispute state. Finalization extends the existing `buildFormFreeze`/`freezeFormField`
copy-by-value architecture. Every cited location is frozen, with its stable field key, paragraph
snapshot and text hash, inside the organisation-scoped finalization transaction. It does not
re-read a mutable legal cache or invent a replacement citation. Existing compliance freeze
clients continue to work.

Source metadata is preserved where the current legal model has it. No new legal verification,
EU/EEA consolidation metadata or legal coverage is claimed. The policy freezes evidence of the
recorded decision, not a certification that current law or all acceptance criteria were checked.

## 6. Finalization lifecycle and validation

- **Draft:** applicable human questions remain; answers append BK revisions.
- **Ready:** all applicable user-resolvable questions are complete. Receiver-only fields do
  not block readiness. Ready alone is insufficient to finalize.
- **Finalized:** one immutable evidence/PDF record. Further edits require a successor.

Finalization requires the latest Ready revision, source bytes/associations, a completed source
processing run without failed/pending samples, recorded implementation/normalization provenance,
a valid matching hazard/EAL state, valid available legal references and successful PDF generation.
The saved AcroForm text is read back before storage. A failed render publishes no final record.

Every cannot-determine decision, including missing TOC/loss-on-ignition evidence, must be
explicitly acknowledged by its exact key. Complete absence of legal citations requires a
separate acknowledgement. Available citations lacking their original text/version are rejected;
a new current-cache lookup cannot repair a historical gap. Receiver-only controls do not appear
in this list. Indeterminate remains `null`; acknowledgement never turns it into `false`.

Known unsupported-unit and unconverted dry-basis normalization flags **block finalization**.
No-usable-data classifications also block it. This is a finalization safety gate, not a rewrite
of the existing classifier. Liquid/leachate indeterminate cases can still be recorded with
explicitly acknowledged limitations. This does not authorize disposal, signing or submission.

Concurrent edits invalidate stale finalization requests. Finalization and successor creation
have stable request IDs; successful retries return the existing record. A concurrent successor
request cannot create two successors from the same finalized head. Finalized PDF downloads read
the stored artifact directly, independently of the current renderer/question model/template.

## 7. Auditability and tests

Per-assessment history includes creation/version linkage, captured classification/source/legal
evidence, saved BK revisions with changed logical question IDs, finalization and successor
creation. Timestamps and actor IDs are retained. A copied successor records captured evidence,
not a falsely claimed recalculation. Failed transactions do not leave successful audit events.
Earlier records retain their original creation timestamp; no invented historical events are
backfilled. The actor is the portal's dedicated application identity, not an individually
verified employee. Draft previews/downloads are not separately logged.

Final validation results are recorded below and in `production-core.md`:

| Check | Result |
| --- | --- |
| Full suite | 722 passed; four credential-dependent provider tests failed |
| Focused Phase 1–4/BK/classification/compliance | 659 passed |
| Production tests, included above | 107 passed, including 14 new Phase 4 cases |
| TypeScript/build | Passed |
| Changed-file lint | Passed |
| Repository-wide lint | 12 existing errors, 1,477 warnings; see section 13 |
| Clean local schema | All nine migrations applied unchanged; organisation membership checks passed |
| Chromium offline workflow | Multi-sample upload, completion, finalization, frozen download, later context change, successor edit, replacement-analysis successor and preservation of original passed |

The new invented fixtures contain no customer names, contact details, report excerpts or live
provider payloads. They cover ordinary, hazardous, indeterminate, unsupported-unit and wet-basis
cases through the actual BK/classification code. The existing checked-in multi-sample PDF/recorded
provider responses exercise segmentation, mapping and source highlighting. No new customer data
was added to the repository. Reconfirm permissions before using or expanding existing real files.

The browser test updates project metadata directly in its disposable database; the production
project page has no metadata editor. Auth/PostgREST transport is simulated, while real SQL,
constraints, route handlers, PDF generation and browser interactions run. Provider responses
are replayed locally. This is not a successful live extraction or Supabase Auth test.

Reproduce after build:

```sh
DATALAB_API_KEY= ANTHROPIC_API_KEY= ANTHROPIC_AUTH_TOKEN= pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm production:verify-local
node --import tsx scripts/production/smoke-bk-workspace.mjs --finalize
```

The browser smoke needs Playwright and Chromium. Set `PRODUCTION_SMOKE_PLAYWRIGHT_PATH` if using
an external installed runtime. It starts disposable loopback services and blocks external fetches.

## 8. Known limitations

No digital signatures, external submission, facility acceptance matching, shipments, role
management, organisation switcher or billing. Finalization records an artifact, not approval to
use it at a particular facility. Missing evidence remains visible and can still require real
laboratory work. A source-processing partial failure blocks finalization of that run's samples;
reprocess the document rather than silently ignoring siblings.

No automatic sample-to-stream matching or direct editing of saved analytical values. A newly
processed assessment can explicitly supply a successor, with fresh human questions.
Request-bound processing, provider availability, payload limits, pagination and long-history
performance remain operational constraints. Very long text/glyph coverage needs a broader PDF
fixture matrix; unsupported glyphs are rejected at finalization. Downloaded interactive copies can be edited in PDF software; this never changes the stored
artifact. Hash comparison detects changed bytes but is not a digital signature. Finalized bytes remain available
even if the current renderer cannot read a historic assessment model.

Project editing is not introduced. Successors copy prior context deliberately. Existing draft
history does not refresh automatically after every answer until reload. Audit events are scoped
but do not identify individual employees. No restore/load/concurrent multi-connection deployment
benchmark was performed. Version identifiers require release discipline. Only one successor can be created from a
finalized head; draft abandonment/rebasing is not implemented. Human answers can be corrected
in an open successor, but replacing its analytical snapshot again requires another lifecycle
transition. Validate selected evidence before creating that successor. Original classification narrative is retained when
operational human answers change; source-derived narrative and corrected producer/context values
can therefore differ. This is not automatic reclassification or reconciliation of new evidence.

## 9. Security considerations

Features obtain scope through the server organisation context. Ordinary Supabase sessions and
membership RLS remain mandatory; no production adapter uses a service-role key. New RPCs have
fixed search paths, check membership and scope, and do not trust an arbitrary artifact identifier
as authorization. Source and finalized bytes remain private. The credentialed application and its generation/validation
code remain part of the trusted write boundary; never expose the shared application credentials
to the browser. Read/update/delete/cross-scope and
successor tests cover application and database boundaries; immutability also holds for ordinary
owner-level updates while triggers remain enabled.

Database administrators can alter schema/disable triggers; backups and operator access remain
part of the trust boundary. PDF and raw laboratory data are sensitive. Logs, retention, backup
encryption and access revocation need staging/operational review. The global public-law cache is
shared; the existing compliance dispute service is not a new tenant-specific employee audit
system. Saved dispute flags reflect capture time and are not silently refreshed in finalized
records. Review shared dispute visibility and authorization before supporting multiple customers.

## 10. Unverified live integrations

Actual Supabase Auth token issuance/refresh/revocation, real PostgREST schemas/permissions/error
shapes, deployed reverse-proxy origins, live Datalab/Anthropic extraction, Lovdata/Voyage availability,
remote limits and production storage/backup operations remain unverified. No remote migration,
provider document upload or deployment was performed. Local PGlite simulates Auth roles/claims;
Docker/local Supabase was not available for a full local stack test.

## 11. Required staging tests

Before requesting any staging write/deployment authorization, prepare and review exact migration
and configuration artifacts. Then, in an explicitly approved isolated environment:

- Apply all migrations to a clean Supabase instance and to a restored pre-upgrade copy; verify
  roles, RLS, RPC grants and expected PostgREST column access. Test two distinct organisations,
  revoked membership and wrong project/assessment IDs, including artifact/history endpoints.
- Exercise real portal authentication, HTTPS/proxy origin checks, session expiry, retry behavior
  and refusal of service-role configuration. Verify an unauthenticated request cannot access data.
- Use consented/sanitized single- and multi-sample PDFs with fresh extraction providers; compare
  raw/normalized values, hazardous/ordinary/indeterminate decisions and green source geometry.
- Exercise complete → finalize → byte-identical download → context/legal-cache change → successor.
  Race finalization against an edit and race successor creation using independent connections.
- Verify actual Lovdata snapshots and all cited locations, cache outages, old summaries without
  text, disputed evidence, missing evidence policy and reference/rule versions with a domain owner.
- Confirm upload/download sizes, function timeouts, failed/interrupted processing recovery,
  PDF font/rendering coverage, pagination, mobile/browser behavior, backup/restore and retention.
- Preserve fixture/results evidence in the team review; do not mark any of these tests passed
  merely because the offline harness passed.

## 12. Migration and rollback considerations

Back up and verify restoration before any approved deployment. Source bytes and final PDF bytes
increase database storage/backup size; account for JSON snapshots repeated by revision. Never
rewrite prior evidence to add guessed versions. Decide how pre-versioned assessments will be
reprocessed and explained to users.

Prefer a forward fix or disable the production write entry points while retaining scoped
finalized downloads. Do not drop the finalization/audit tables or immutable guards after real
records exist. Rolling back to a pre-finalization app can mislabel or regenerate finalized BKs;
retain a compatible artifact-reading path. Exporting/migrating artifact storage later must
preserve hashes, ownership, immutability and atomic publication. A rollback/restore drill on
staging is still required; no destructive down migration was run or supplied.

## 13. Existing failures and comparison with main

A disposable archive of local main was tested using the same installed test dependencies,
without branch switching or fresh dependency installation. It had **498 passes and the same
four provider-authentication failures**: `bk/build-seed.test.ts`, `bk/data-lab.test.ts`,
`bk/run-pipeline.test.ts` and `bk/segment.test.ts`. The branch has 722 passes and these same four
failures with credentials deliberately disabled. No additional failing regression was found.
This comparison does not prove all semantic behavior unchanged or replace a fresh locked-dependency
staging build. Inherited branch changes intentionally differ from main's classification behavior.

Main lint has five errors: synchronous effect state updates in `app/cases/[id]/page.tsx`,
`app/page.tsx`, `app/projects/[id]/page.tsx`, `app/shipments/page.tsx`, and an unescaped apostrophe
in `components/wizard/ExtractionReviewStep.tsx`. The current repository has those same errors
plus seven errors in generated `public/pdf.worker.min.mjs`; its 1,477 warnings are predominantly
that generated worker. The clean main archive does not contain the generated worker. These
are separate from the clean Phase 4 changed-file check.

## 14. Recommended team-review checklist

- Review the entire branch, including inherited compliance/classification changes and untracked
  production files; agree branch dependencies before discussing a merge.
- Confirm the recorded-artifact meaning of Finalized, acknowledgement policy, blocking basis
  gaps, receiver exclusion and the absence of signature/disposal approval claims.
- Inspect snapshots, stored PDF hashes, source links, rule identifiers, legal text/version
  capture and successor lineage. Confirm no version is assigned retrospectively.
- Review SQL grants, locks, RLS, immutable triggers, retries and tenant-boundary tests.
- Have a domain owner review known normalization/sufficiency/legal coverage limitations.
- Complete the explicit staging and rollback checklist; resolve or formally accept existing
  lint/live-provider gaps. Assign owners for operational limits and shared dispute visibility.
- Only then decide whether the team wants this branch merged. **No merge, push or deployment
  authorization is implied by this report.**
