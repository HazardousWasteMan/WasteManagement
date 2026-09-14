# Production core: product brief and architecture review

## Final pre-PR integrity pass

The current uncommitted branch includes the final production-core blocker fixes described in
[production-core-readiness.md](production-core-readiness.md). Machine-derived persistence is
restricted to the centrally configured backend application identity; ordinary authenticated
members cannot forge assessment/BK/EAL/processing/final-PDF payloads through the public RPCs.
Multi-document finalization validates and freezes every explicitly associated completed run and
its source document. A partial or review-required extraction cannot be finalized as a clean
result, including at the database boundary.

All new production regression inputs are invented or generated locally. Production tests and
offline smoke scripts do not read customer documents, extracted text, identifiers or recorded
provider payloads. The current confidential-data-free validation is 439 passing tests across 40
files, a passing Next production build, passing TypeScript and changed-surface lint, and all 13
migrations applied to a clean local PGlite/PostgreSQL database without contacting a remote system.
Repository-wide lint separately retains 12 errors and 1,477 warnings in legacy/generated files.
Real Supabase Auth/PostgREST/RLS and controlled live-provider testing remain staging gates.

## Classification validation — Step 3

Structured EAL decisions, audited pre-finalization review, truthful BK narrative and explicit
landfill-acceptance separation are implemented. See
[eal-bk-step-3.md](eal-bk-step-3.md) for the model, resolution policy, persistence,
tests and remaining real-document/staging boundaries. This supersedes historical EAL first-match,
BK certainty and landfill-category behavior below. No facility matching, general UX redesign,
complete acceptance evaluator, commit, push, merge or remote migration is included.

## Classification validation — Step 2

HP rule corrections and typed assessment semantics are implemented.
See [hp-assessment-step-2.md](hp-assessment-step-2.md) for exact rules, sources,
aggregation, compatibility, migration and remaining staging checks. This supersedes
historical statements below that HP calculations are unchanged. EAL/landfill rules
and visual design remain outside this slice; no commit, push or merge.

## Classification validation — measurement boundary Step 1

The shared extraction-to-HP measurement boundary is implemented. See
[measurement-boundary.md](measurement-boundary.md) for its model, exact role/unit/basis policy,
compatibility changes, local migration coverage and remaining correctness risks.
This supersedes historical normalization fallback assumptions below, without changing HP
formulas, EAL rules, BK descriptions or the UI design. No Step 2 work is included.

## Phase 4 — finalization, auditability and readiness

Phase 4 is implemented on `product/production-core`, with all earlier work preserved and no
commit, push, merge, remote migration or deployment. This section supersedes the historical
Phase 3 finalization boundary below. The complete team review and staging/rollback checklist
is in **[production-core-readiness.md](production-core-readiness.md)**.

### Lifecycle and frozen record

Draft → Ready → Finalized. Ready means applicable user questions are complete; receiver-only
fields never block it. Finalize requires the latest Ready BK revision, persisted source evidence,
a completed source processing run, recorded classification/normalization versions, internally
valid available legal evidence and successful PDF generation/read-back. All indeterminate
questions/measurement gaps and complete absence of legal citations require explicit acknowledgement.
Acknowledgement does not resolve a gap or turn `null` into `false`. Unsupported units,
unconverted dry-basis results and no-usable-data classifications block finalization without
changing the classifier. Finalized does not mean signed, submitted or approved for disposal.

One atomic transaction stores the exact generated PDF bytes, PDF SHA-256, snapshot SHA-256,
organisation/project/assessment/revision IDs, actor and timestamp together with:

- the immutable Assessment, raw extraction, analytical values/units and classification outputs;
- the normalized values and actual HP inputs captured during the original calculation;
- EAL/hazard tri-state, context and human answers actually used;
- all source associations, source identities/hashes and processing-run state;
- the saved BK field/evidence projection and stream identity;
- every cited legal location's original paragraph text, source, version/change/verification
  metadata, field key, dispute state, freeze timestamp and text hash;
- recorded engine/HP/EAL/normalization/BK versions and the PDF template hash.

`production_finalizations` stores JSON plus PostgreSQL `bytea`, following the existing atomic
source-file storage approach. Finalized downloads bypass current question/renderer/template
logic and return the stored bytes. Immutable triggers, restricted grants, tenant RLS and scoped
RPCs protect artifacts and history. Edit/finalize operations share an assessment lock. Stale
requests are rejected; idempotent retries return the existing finalization.

### Evidence and version capture

The existing compliance freeze architecture is extended, not replaced. `buildFormFreeze` is the
shared copy-by-value builder used by `freezeFormField` and the new transactional finalization.
Citation resolution carries the original `LegalParagraph` snapshot; finalization never silently
substitutes the latest cache text. Summaries without their original legal text/version cannot be
finalized. Missing citations remain explicitly missing. Existing verification dates are not a
claim of a fresh legal verification, and saved dispute flags do not refresh retrospectively.

An optional classification trace captures the already-calculated normalized values and HP inputs
without changing engine results or formulas. Gated liquid/leachate cases record an indeterminate
basis with no fabricated normalized result. `lib/production/versions.ts` contains explicit engine,
HP, EAL and normalization identifiers; the BK mapping identifier lives with the question catalog.
Bump the relevant identifier when implementation/reference data changes and tie it to the reviewed
release commit. No historical assessment is assigned the current version retrospectively.

The Evidence panel retains document highlighting and classification/legal disclosure, and adds
optional saved normalization/version details. The lifecycle panel exposes frozen legal text and
artifact identity. Original classification narrative is retained when operational human answers
change; source-derived narrative and a later human correction can therefore differ. Review this
reconciliation boundary before relying on such a correction as a change to analytical evidence.

### Successors and audit history

Finalized workspaces have no answer editor. “Create new draft revision” creates the next
Assessment on the same WasteStream, preserving `previous_assessment_id` and version ordering.
It copies the frozen source/analysis/context/answers and starts an editable BK revision; inherited
answers may already make it Ready. This is not a recalculation. Concurrent/retried creation
cannot duplicate a successor. A later edit never changes the prior final record or PDF.

Current project values are not silently substituted into the successor; edit the appropriate
logical answer explicitly. New source analysis uses the existing processing path and creates
new assessments. A finalized workspace can explicitly select one of those processed assessments
from the same project as evidence for its successor. The successor remains on the original
WasteStream, references both its predecessor and selected source assessment, and resets human
answers. Its classification/source snapshot is copied from the selected new analysis. Cross-project
replacement, known unusable/unversioned analysis and stale inherited answers are rejected before
creating the successor. The original intake assessment/stream remains preserved. The user explicitly matches the correct
sample to the same waste stream; there is no automatic identity inference or in-place recalculation.

History shows assessment creation/linkage, classification/source/legal evidence capture, answer
revision saves with changed question names, finalization and successor creation. Events are
transactional and immutable, scoped to the organisation/project/assessment. The actor is the
portal application identity, not an individually verified employee. Historical events are not
invented/backfilled; draft PDF reads are not audit events.

### Local validation and boundaries

- **659 focused tests passed**, covering Phase 1–4, BK, Data Lab, classification and compliance.
  Production tests total **107**, including 14 new Phase 4 cases covering ordinary/hazardous/
  indeterminate fixtures, gap policy, failed processing, legal freezes, stable artifacts,
  context changes, successors, tenant isolation, stale writes, basis guards and PDF failure.
- Full suite: **722 passed, four live-provider authentication failures** with credentials
  deliberately disabled. A disposable local-main archive has 498 passes and those same four
  failures. No new failing regression was found; see the readiness report for comparison limits.
- TypeScript, build and changed-file lint passed. Repository lint retains 12 errors and 1,477
  warnings: five application errors also on main, plus generated PDF-worker issues.
- All **nine migrations** passed against a clean local PostgreSQL/PGlite database at
  `/var/folders/db/h3blb3lx69z4xqfp113dwnrc0000gn/T/waste-production-local-UnbubG`.
  Actual Supabase Auth/PostgREST is simulated; Docker is unavailable. No remote DB was contacted.
- Chromium smoke passed with a generated two-sample PDF and invented provider structures: upload → two assessments/one source →
  green source selection → answer required questions → acknowledge gaps → finalize → download →
  change project metadata in disposable DB → verify frozen bytes/evidence → create/edit successor
  → verify original unchanged → finalize successor. No provider request or customer-derived input is used.
- Final PDF pages were rendered and inspected. All 103 canonical fields/109 widgets remain
  interactive; saved values agree with widget appearances. PDF metadata includes assessment,
  revision and finalization identity. Frozen bytes do not change after context/successor edits.

The full live-stack, fresh-provider, concurrency/load, authentication revocation and rollback
checks are still staging gates. No disposal matching, maps, shipments, billing, organisation
switcher, role overhaul, digital signing or authority submission was built. No production
merge/deployment readiness is implied by local checks. The readiness document assigns an explicit
team-review checklist and migration/rollback considerations; later work requires a separate request.

### Changed files in Phase 4

| File | Change |
| --- | --- |
| `lib/hp-classification/classify-sample.ts` | Optional trace observer copies real normalized/HP inputs; calculation behavior unchanged |
| `lib/bk-skjema/from-datalab.ts` | Captures trace from the existing classifier |
| `lib/bk-skjema/analyse-bundle.ts` | Carries the original normalization trace with each sample |
| `lib/bk-skjema/questions.ts` | Central logical BK mapping version |
| `lib/bk-skjema/workspace.ts` | Records mapping version and uses lifecycle-neutral unresolved-evidence wording |
| `lib/compliance/citation-view.ts` | Retains original paragraph snapshots at resolution |
| `lib/compliance/freeze.ts` | Shared copy-by-value freeze builder with existing store compatibility |
| `lib/production/application.ts` | Binds the scoped finalization adapter to the current organisation |
| `lib/production/bk-workspace.ts` | Loads frozen evidence/context, eligibility, versions and scoped audit history |
| `lib/production/finalization-policy.ts` | Gap acknowledgement, readiness/provenance and basis/sufficiency gates |
| `lib/production/finalization-store.ts` | Scoped snapshot/artifact/audit/successor storage abstraction |
| `lib/production/finalize-assessment.ts` | Validates evidence, extends legal freezes, generates/checks PDF and finalizes atomically |
| `lib/production/http.ts` | Reports validation failures without publishing a final artifact |
| `lib/production/process-document.ts` | Snapshots original implementation versions and processing-run identity |
| `lib/production/types.ts` | New finalization/audit/RPC contracts |
| `lib/production/versions.ts` | Explicit version policy and engine/rules identifiers |
| `components/production/BkWorkspace.tsx` | Finalized download/state and normalized-input evidence integration |
| `components/production/FinalizationControls.tsx` | Readiness, gap acknowledgement, finalization, successor and history UI |
| `app/production/projects/[projectId]/assessments/[assessmentId]/page.tsx` | Read-only finalized views and state reset on version/navigation changes |
| `app/api/production/projects/[projectId]/assessments/[assessmentId]/bk/route.ts` | Stored finalized downloads independent of the current renderer |
| `app/api/production/projects/[projectId]/assessments/[assessmentId]/finalize/route.ts` | Scoped finalization endpoint |
| `app/api/production/projects/[projectId]/assessments/[assessmentId]/successor/route.ts` | Scoped idempotent successor endpoint, optionally using a newly processed assessment |
| `supabase/migrations/20260911000000_assessment_finalization.sql` | Atomic final artifact/snapshot, immutable audit, scoped RPCs and edit guards |
| `scripts/production/smoke-bk-workspace.mjs` | Extends the offline full-browser workflow with finalization/context/successor checks |
| `tests/production/project-processing.test.ts` | Real SQL/adapters/routes tests for finalization, failure paths, isolation and history |
| `tests/production/synthetic-fixtures.ts` | Invented single-sample PDFs and classification inputs, without customer data |
| `eslint.config.mjs` | Keeps finalization storage behind the application context |
| `docs/product/production-core-readiness.md` | Dedicated architecture, validation, migration, security and staging/team-review report |
| `docs/product/production-core.md` | Current Phase 4 source-of-truth record and file inventory |

## Phase 3 — BK completion workspace, logical questions and evidence (historical completion record)

This section records the current Phase 3 implementation and supersedes the historical
Phase 2 boundary below. Work stays uncommitted on `product/production-core`. No commit,
push, merge, remote migration or deployment was performed. At Phase 3 completion, Phase 4 had not started; the current Phase 4 record is above.

### Logical question model and inspected mapping

The actual two-page BK template, its widget geometry, raw geometric label mapping and
`form-map.ts` were inspected before building the UI. The PDF contains **103 named controls
across 109 widgets**. The bundled report marks **44 controls as human**. These collapse into
**12 logical user questions plus 2 missing-measurement decisions** (TOC and loss on ignition).
The **3 receiver controls** form a separate receiver group and never inflate user tasks.

Human counts depend on extraction: up to 59 existing controls can carry `src: human` when
optional metadata/material recognition is unavailable. The full Phase 3 catalog has
**24 potential user questions**, including the optional generated-narrative review, missing extracted metadata and seven conditional
recurring-waste questions, plus two measurement decisions and one receiver group. This is a
catalog ceiling, not a requirement for every assessment to answer 23 questions.

The full field-by-field mapping, printed options and radio export values are documented in
**[bk-questions.md](bk-questions.md)**. The executable catalog is `lib/bk-skjema/questions.ts`.
Notable mappings:

- Delivery type and recurrence are one consistent question: `group1` exports Radio1/3/4/5
  and `group6` exports Radio1/2. Unsupported legacy commercial defaults are cleared in the
  production projection until answered; standalone Data Lab keeps its existing defaults.
- Origin maps Checkbox11–18; physical form Checkbox27–32; pretreatment Checkbox33–38.
  Each answer selects its option and clears alternatives. These are a single best-description
  choice in this slice; multiple-treatment modeling is not introduced. “Other” requires a
  description, appended as a human supplement without replacing the classification narrative.
- Material maps Checkbox19–26 plus Checkbox39/40; colour is TextField39 and smell TextField40.
- Producer identity/contact, address and transporter details use logical grouped editors.
  NS 9431, industry and municipality answers split into their actual digit controls.
- Recurring fractions pair measured fields 42–45 with variation fields 46–49. Verification
  dates are 50–51, parameters 52 and supporting documentation 53. These questions are inactive
  for single deliveries and become user tasks for recurring waste.
- Receiver customer number, project reference and remarks (TextField1–3) are left to the
  receiving facility. The application's project number is not substituted into these fields.
- Missing TOC/loss-on-ignition measurements are explicit evidence gaps, not invitations to
  guess an analytical value. New analytical evidence remains necessary to resolve them.

### User flow and evidence experience

Open a production Project → **Open assessment · BK workspace**. The route is
`/production/projects/[projectId]/assessments/[assessmentId]`.

The left pane is the real generated BK PDF using shared `FormPane`; the right pane is
**Evidence**. The heading counts logical decisions: ready, needs you and cannot determine.
There are no prominent extraction costs or raw AcroForm coverage counters.

Green extracted-field markers retain their exact citation/page/bbox selection, using the
unchanged `DocumentPane` coordinate normalization. A populated field stays green even when
another part of its logical question is missing. Amber dashed markers expose unanswered
controls; slate markers expose indeterminate decisions. Clicking a missing marker opens the
logical question in Evidence. **Next required** traverses outstanding questions. Save appends
a draft revision and regenerates the PDF. Page geometry is reserved during regeneration to
avoid collapsing the form. Human answers are not saved through arbitrary raw control names.

Supported evidence:

| Evidence | What the workspace shows |
| --- | --- |
| Document | Saved text, absolute page, original PDF and exact stored highlight geometry |
| Classification | Saved hazard/EAL decision, HP flags/triggered categories and progressively disclosed results/calculation detail |
| Legal/compliance | Existing saved `legalCitation` source links, verification dates, dispute flags and stable field keys, including mapping the EAL basis to the logical EAL decision |
| Project/context | Explicit project/stream provenance and the contextual value used |
| Human | The logical saved answer, its explanation and a new immutable draft revision |
| Insufficient evidence | An explicit cannot-determine state and explanation; never an ordinary blank or a false negative declaration |

Legal details are optional disclosure. There is no mandatory “Review compliance” step and no
forced approval of machine-completed values. “I disagree” uses the existing
`/api/compliance/disputes` infrastructure and exact `legalCitationKey`; failed submissions now
remain visibly failed rather than appearing saved. No classification/compliance branch was
merged and no legal reasoning was rewritten. If no verified citation was saved, the UI says
so. Saved verification dates describe the evidence at capture, not a fresh legal verification.

### Context reuse and provenance

All page, draft and download operations start with the existing no-tenant-argument
`getProductionApplication()`. Its centrally bound `drafts` adapter uses the same ordinary
Supabase Auth app identity and organisation scope as Phases 1–2. Reads explicitly filter
organisation/project/assessment; source links authorize the evidence document.

Existing extracted values take precedence. A missing pickup location can use Project.location.
The exact saved excavation origin hint maps to excavation/dredging; broad concrete/demolition
hints are not guessed to mean the PDF's “new construction” option. Exact powder/liquid metadata
can map to those printed physical choices; generic “solid” does not imply homogeneity.
Context values have `project/context` provenance and no fabricated PDF citation.

The current Organisation model has no producer registration/contact profile and the portal
customer may be a handler. We do not invent an organisation number or assume customer name
means producer name. Existing producer/address/contact extraction is reused; remaining gaps
stay grouped human questions. Original extracted evidence remains immutable when an explicit
human answer supersedes part of a draft.

### Status and lifecycle rules

`buildBkWorkspace` is a pure projection over the immutable assessment, selected context and
logical answers. It does not rerun or change HP/EAL classification.

- **Complete:** a supplied document, context or human value.
- **Calculated / derived:** the existing classification/mapping result, with optional reasoning.
- **Needs input:** an applicable human-resolvable question still lacks an answer.
- **Cannot determine:** evidence is insufficient. Includes unknown hazard/EAL, absent laboratory
  measurements, applicable soil condition class not established by the pipeline, and prohibited
  properties not proved by the saved pipeline. Unticked prohibited-waste boxes are not evidence
  of a negative result.
- **Not applicable:** conditional questions outside the chosen delivery pattern; receiver
  responsibility is separately labeled “Receiver completes this”.

A draft is **ready** when all applicable user-resolvable questions are complete. Evidence gaps
remain counted, highlighted and listed in the PDF's Norwegian draft note. “Ready” explicitly
means user questions complete; it is not a disposal approval or signed declaration. Missing
measurements and indeterminate hazard remain distinct from false/non-hazardous.

The additive `20260910000000_bk_draft_revisions.sql` migration adds one table,
`production_bk_revisions`, and one membership-checked save RPC. Each revision stores:
organisation/project/assessment, revision number, request ID, draft/ready state, logical answers,
model version, context snapshot, rendered-field/evidence projection, creation time and app user.
The assessment and earlier BK revisions are never updated. Both draft and ready revisions are
append-only, with an immutable trigger, membership RLS and composite scope foreign key.

A save checks the expected current revision under an assessment row lock. A competing stale
save returns 409 and asks for reload instead of silently overwriting another answer. Identical
request-ID retries return the existing revision; conflicting request payloads are rejected.
Saved revisions can be opened read-only via `?revision=N` and downloaded independently. Before
the first answer there is an unsaved revision-0 projection; GET never silently inserts records.

There is **no finalized/signed state** in this slice. Draft PDFs regenerate from saved fields
and the current template. Final immutable PDF bytes, signatures and submission are deliberately
not claimed. Production generation fits text against real widget bounds and synchronizes the
template's widget-level font overrides. Appearance wrapping uses actual unkerned glyph advances,
matching PDF drawing operators so long description lines do not clip. The regression test checks
the rendered appearance widths as well as the unchanged canonical value; legacy generation defaults
remain unchanged.

### Validation and local migration status

- Phase 1–3 production tests: **93 passed**. Phase 3 adds 25 cases across question/evidence tests
  and the existing SQL/route integration suite. Coverage includes actual controls/options,
  multi-control answers, smell, physical form, origin, context, receiver exclusions, legal
  evidence, tri-state status, green source geometry, draft edits, stale writes, retries,
  immutable history and scoped historical downloads.
- Full relevant Phase 1–3/Data Lab/BK/classification/compliance suite: **645 passed**.
- Full automated suite: **708 passed, 4 existing live-provider failures**. Datalab and Anthropic
  credentials were explicitly disabled to prevent document uploads; those four tests fail
  authentication locally. No new regression failure was found.
- TypeScript, production build and changed-file lint: passed.
- Repository-wide lint still reports **12 existing errors and 1,477 warnings**, separate from
  the clean changed-file check.
- `pnpm production:verify-local` applied all **eight migrations unchanged** to a fresh local
  PostgreSQL/PGlite database and passed seeded organisation membership checks. Database:
  `/var/folders/db/h3blb3lx69z4xqfp113dwnrc0000gn/T/waste-production-local-ptW9ab`.
- The browser smoke created a Project, uploaded a generated PDF, persisted one
  source and two assessments, opened the BK workspace, clicked a green source field, displayed
  the exact highlighted region, answered smell, regenerated/downloaded the draft, checked the
  saved AcroForm value and verified persistence after reload. There were no browser page errors.
  The browser uncovered and fixed a Phase 2 same-origin check that used Next's reconstructed
  internal hostname rather than the incoming Host; a regression test covers foreign-origin
  rejection and the legitimate browser host.
- Browser screenshots and both generated PDF pages were visually inspected. The PDF's 103
  canonical fields and 109 widgets remained intact; the saved smell value agrees between the
  canonical field and widget parent, with an appearance stream. No flattening was performed.

The reproducible offline smoke lives in `scripts/production/smoke-bk-workspace.mjs` and
`smoke-provider.mjs`. After `pnpm build`, run:

```sh
node --import tsx scripts/production/smoke-bk-workspace.mjs
```

It requires Playwright plus an installed Chromium browser. If Playwright is provided by an
external runtime, set `PRODUCTION_SMOKE_PLAYWRIGHT_PATH` to that runtime's Playwright package
directory. The smoke creates fresh temporary data and loopback servers; its test-only provider
preload generates invented provider structures in memory and blocks non-loopback remote fetches. It never loads a
real organisation into its database or uses customer credentials. Auth/PostgREST transport
is simulated; real SQL, app routes, pipeline mapping, PDF rendering and browser interactions run.
Recorded provider responses are not proof of a fresh live extraction or real Supabase Auth.

### Known limitations and explicit Phase 4 boundary

Docker remains unavailable, so actual local Supabase Auth/PostgREST provisioning and live
provider extraction remain untested. Real hosting payload/time limits, multi-connection load,
backup/restore, browser/mobile matrix and remote deployment are not validated. The smoke uses
Chromium and invented provider output, not a live provider. Prior request-bound processing and
PostgREST pagination limits remain. Administrative codes are format-checked, not registry-
verified; recurring composition/supporting evidence is recorded as human input, not audited.

Workspace support requires the full sample/evidence snapshot produced by Phase 2; arbitrary
foundation-only assessments without that snapshot do not invent a usable BK workspace. Missing
laboratory evidence cannot be supplied by simply typing a number. There is no additional-report
attachment or safe reclassification workflow for resolving those gaps in this slice.

Legal evidence is the saved snapshot. Disputes use the existing shared compliance service and
may fail when it is unavailable; reopening a saved revision does not merge new legal corrections
into immutable evidence or provide a live dispute-status refresh. No additional per-user
identity was introduced: `created_by` remains the portal's dedicated app identity. Historical
PDF bytes are regenerated, not frozen final artifacts. Very long narratives and characters
outside the template font's supported glyphs need further template/input validation.

Phase 4 requires a separate agreed request. Remaining work may include resolving missing
analytical evidence, safe reclassification, richer producer/context profiles, finalized artifact
storage/signing, live-stack deployment validation and operational hardening. Disposal matching,
map UI, permits/acceptance criteria, shipments/deliveries, organisation switching and advanced
roles are unimplemented and outside this Phase 3 work. No Phase 4 implementation has begun.

### Changed files in Phase 3

| File | Change |
| --- | --- |
| `lib/bk-skjema/questions.ts` | Verified logical catalog, answer shape and validation |
| `docs/product/bk-questions.md` | Complete raw-control/question/options mapping and counts |
| `lib/bk-skjema/workspace.ts` | Context/answer projection, statuses, task counts, per-control markers and legal-key association |
| `lib/bk-skjema/evidence.ts` | Shared original citation-to-highlight selection |
| `components/production/BkWorkspace.tsx` | Two-pane workspace, logical editors, evidence, task navigation and revisions |
| `components/data-lab/FormPane.tsx` | Optional unresolved markers; keeps legacy defaults, green source treatment and page geometry |
| `components/data-lab/LegalCitationBadge.tsx` | Visible failed dispute submission state |
| `app/data-lab/page.tsx` | Uses shared unchanged highlight selector |
| `lib/bk-skjema/fill-pdf.ts` | Explicit unresolved radio clearing and opt-in production text fitting |
| `lib/production/bk-workspace.ts` | Scoped load/edit service over immutable assessments |
| `lib/production/bk-draft-store.ts` | Scoped revision/source-link queries and save RPC adapter |
| `lib/production/application.ts` | Centrally creates the organisation-bound draft adapter |
| `lib/production/types.ts` | Typed revision table/RPC contract |
| `lib/production/http.ts` | Question/conflict errors and corrected browser-origin validation |
| `app/production/projects/[projectId]/assessments/[assessmentId]/page.tsx` | Current/read-only historical assessment workspace |
| `app/production/projects/[projectId]/page.tsx` | Assessment workspace links; labels initial BK status as historical |
| `app/api/production/projects/[projectId]/assessments/[assessmentId]/draft/route.ts` | Validated logical-answer save endpoint |
| `app/api/production/projects/[projectId]/assessments/[assessmentId]/bk/route.ts` | Current or historical draft PDF download |
| `supabase/migrations/20260910000000_bk_draft_revisions.sql` | Append-only revisions, constraints, RLS and concurrency/idempotency RPC |
| `tests/production/bk-questions.test.tsx` | Logical mapping, PDF controls, evidence, status and marker tests |
| `tests/production/project-processing.test.ts` | Extends Phase 2 SQL integration with immutable draft edits/history/downloads |
| `scripts/production/smoke-bk-workspace.mjs` | Disposable full-browser Project-to-BK verification |
| `scripts/production/smoke-provider.mjs` | Test-only invented provider structures and outbound-fetch guard |
| `eslint.config.mjs` | Prevents feature imports of the low-level draft adapter |
| `docs/product/production-core.md` | This implementation, validation and boundary record |


## Phase 2 — project document intake and persisted sample assessments (historical completion record)

The current user request authorizes Phase 2 on `product/production-core`, using the completed
Phase 1 foundation. This section supersedes the historical “before Phase 2” status below.
At Phase 2 completion, Phase 3 had not started. The current Phase 3 implementation is documented above.

### Actual user flow

1. Open **Production projects** in the sidebar (`/production/projects`). Create a named
   project with an optional location, or open an existing project. The legacy project pages
   remain separate and unchanged.
2. Upload an analysis PDF (25 MiB maximum) and optionally select the existing origin/process
   hint. This hint applies to the whole processing attempt, as in standalone Data Lab.
3. The application stores the PDF and its SourceDocument metadata, then processes the saved
   bytes through the existing `analyseBundle` pipeline. It registers detected sample metadata
   before extraction and persists successful samples as they finish. The page refreshes while
   an attempt is active, showing successful and failed samples independently.
4. Each successful sample creates a new WasteStream and an immutable Assessment referencing
   the one SourceDocument. The page displays EAL/hazard decisions and draft BK status.
   Download links return the stored source PDF or generate a draft BK from saved mapped fields
   with the existing `fillBkPdf` implementation.
5. **Reprocess document** explicitly starts another attempt against the saved PDF. Earlier
   streams, assessments, evidence and attempt results remain available. A project is never
   marked “complete” merely because an upload finished.

Missing organisation configuration or an unavailable production service produces an explicit
unavailable state. Standalone `/data-lab` remains usable with its original requirements.
The full configured browser-to-Supabase/provider flow still needs local-stack validation below.

### Architecture and persisted relationships

All feature routes resolve `getProductionApplication()` without an organisation argument.
The Phase 1 resolver now returns `{ organisation, store, processing }`. `processing` is an
organisation-bound adapter created centrally with the same ordinary authenticated Supabase
client. No feature supplies an organisation ID or receives database credentials. Every
project/document/assessment read in the new adapter filters organisation **and** project.
ESLint also blocks feature imports of this low-level adapter.

The additive `20260909000000_project_document_processing.sql` migration introduces:

| Table | Purpose |
| --- | --- |
| `production_document_files` | Immutable PDF bytes and verified SHA-256; one file per organisation/project/hash |
| `production_processing_runs` | Document, explicit attempt ID, origin hint, bounded lease, status and terminal error |
| `production_processing_samples` | Detected sample index/number/marking/matrix/page range, result status, assessment reference, error and draft BK status |

These tables use membership RLS, composite organisation/project foreign keys, and explicit
read grants. Membership-checked functions with fixed search paths handle writes. Ordinary
clients cannot directly edit file bytes, run states or sample outcomes. Phase 1 assessment
and source-document immutability remains intact. No existing compliance schema is changed.

**PDF storage choice:** bytes are held privately in PostgreSQL for this small integration
slice. Metadata and bytes are committed in one upload RPC transaction, avoiding orphan
metadata when storage fails. The server verifies the hash and PDF header/size; the database
verifies them again. The `storage_key` remains an immutable opaque locator, not a public URL
or an existing object-storage bucket path. The download route returns bytes only after the
normal portal, organisation and project checks, with private/no-store response headers.

One document can support any number of sample assessments. The assessment/document link uses
`attempt-id:sample-index` as its segment identity and stores zero-based inclusive page ranges.
The assessment snapshot records raw extracted data, normalized results, classification,
mapped BK fields, sample metadata, source ID/hash, origin hint, and cited block/page evidence.
Resolved legal citations are copied into assessment compliance evidence when available; the
existing fallback notes remain when resolution is unavailable.

There is still only one extraction implementation. `analyseBundle` now awaits optional async
event consumers and supplies cited evidence to a persistence consumer. It waits for sibling
workers before reporting a failed persistence callback. The standalone NDJSON event payload,
segmentation, extraction schema, HP/EAL classification and BK mapping remain unchanged.
The existing once-per-bundle legal-citation resolution was moved into one shared helper.

### Creation, idempotency and failure policy

- Every successful sample in a **new explicit attempt** creates a fresh WasteStream and
  Assessment. No automatic matching to old streams, merging, or inferred continuity occurs.
  Consequently these new streams begin at assessment version 1; Phase 1 still supports many
  versions on a stream when a later explicitly scoped workflow needs them.
- Identical PDF bytes uploaded again into the same project reuse the original SourceDocument,
  filename and upload timestamp. The processing attempt records the new processing time.
  The same bytes in different projects remain separate scoped documents. There is no
  cross-customer deduplication or document-identity disclosure.
- A client-generated UUID identifies each attempt. Repeating the same ID with the same
  project/document/origin returns its existing state without provider calls or new results.
  Reusing an ID with different inputs is rejected. Forms retain their attempt key following
  an ambiguous network failure; a confirmed response or changed inputs permits a new attempt.
  Re-uploading after a confirmed result is a new explicit analysis, as the form explains.
- A database lock and unique partial index allow only one active attempt per document. A
  ten-minute lease bounds interrupted work. There is no automatic retry or background queue.
  An explicit new attempt after expiry marks pending old samples failed and the old attempt
  partial/failed, preserving all successful assessments. Late writes to the old run fail.
- Upload, sample registration, each sample result, and run completion are separate atomic
  transactions. A successful sample commits its stream, assessment, evidence link and status
  together. A failed sample has a visible error and no invented stream/classification.
  A failed sample transaction leaves no orphan stream or assessment.
- Run completion marks remaining pending samples failed. All-success attempts are completed;
  mixed outcomes are partial; no-success attempts are failed. Conversion failure retains the
  uploaded document. If the database itself becomes unavailable, the lease and explicit retry
  path expose the interrupted attempt once service returns.
- Saved assessments and evidence are never updated in place. Repeating an identical sample
  save while its run is active is harmless; a conflicting saved result is rejected.

Draft BK status is deliberately limited: unresolved hazard/EAL needs review; otherwise missing
human fields need input; otherwise the mapped draft is ready. This is not declaration
finalization, a compliance approval or a project completion signal. Draft downloads regenerate
from saved fields using the current blank template; freezing a final PDF is later work.

### Local migration and validation status

`pnpm production:verify-local` applied **all seven migrations unchanged** to a fresh on-disk
PGlite/PostgreSQL database and verified a seeded organisation's membership-scoped read:
`/var/folders/db/h3blb3lx69z4xqfp113dwnrc0000gn/T/waste-production-local-wCD8zo`.
The integration suite independently rebuilds the entire chain in memory and exercises real
SQL functions, constraints and RLS through the real Supabase query builder. Only the
Auth/PostgREST transport and remote document-provider results are simulated.

Docker remains unavailable on this machine (no local Docker socket). Actual local Supabase
Auth/PostgREST startup, CLI bootstrap, concurrent database connections and a configured-customer
browser session have **not** been validated. No remote migrations or remote provisioning were
performed. The Phase 1 localhost-only bootstrap instructions still apply when Docker is ready.

Validation results:

- Phase 1, Phase 2, Data Lab/BK, HP/classification and compliance focused suite: **618 passed**.
- New Phase 2 integration file: **14 passed**. It covers context-based project creation,
  upload/download, one PDF/many streams/assessments, shared evidence links, organisation and
  project boundaries, partial failures, historical immutability, repeated/expired attempts,
  atomic rollback, server-rendered status UI and unchanged standalone NDJSON behavior.
- Generated PDFs and invented extraction structures run through the actual segmenter,
  classification, BK mapper and persistence. The offline tests do not read customer documents,
  extracted text, provider payloads or identifying fixture data.
- Complete suite: **683 passed, 4 failed**. The four existing live `bk/` tests require absent
  Datalab/Anthropic credentials; no new regression failure was found.
- TypeScript, production build and changed-file lint: passed.
- Repository-wide lint: the same **12 errors and 1,477 warnings** in existing code/generated
  PDF worker; reported separately from this slice.
- Built-app loopback smoke: unauthenticated request 401; legacy `/` and `/data-lab` plus
  `/production/projects` render with explicit unconfigured organisation state; existing BK
  fill returns a valid PDF with the expected field round-trip. No remote production DB used.

### Known limitations and Phase 3 boundary

This is a minimal production integration, not a deployment-readiness sign-off. Processing is
request-bound (route maximum 300 seconds), not a durable job system. Navigating away, hosting
limits or process termination may leave partial work until lease expiry and explicit retry.
The 25 MiB application ceiling may exceed a host's request-body limit; PostgreSQL/base64
storage also adds memory, transport and backup overhead. Validate host limits and real local
Supabase RPC payload sizes before customer deployment. Consider private object storage and
durable jobs separately as volume grows. The overview has no pagination yet and inherits
PostgREST response limits; large project histories need pagination before broad usage.

Live extraction/compliance providers, browser hydration with configured Supabase, real network
interruption, multi-connection race/load behavior, deployment and backup/restore remain
untested. The basic PDF check is a format/size guard, not a full parser or malware scanner.
The existing dedicated app identity still represents all portal users; there is no new
individual attribution, organisation switcher or role-management UI.

Phase 3 may address the BK/evidence workspace and logical human-input questions under a
separate request. Draft/finalized lifecycle, frozen BK artifacts, compliance approval, explicit
stream association, legacy-data import and richer history navigation remain unimplemented.
Disposal matching, organisation switching, advanced project management, classification changes
and compliance branch merges are outside this slice. Do not infer authorization to begin them.

### Files changed in Phase 2 (in addition to the uncommitted Phase 1 foundation)

| File | Change |
| --- | --- |
| `app/production/projects/page.tsx` | Scoped project list and creation entry point |
| `app/production/projects/[projectId]/page.tsx` | Project upload, source/attempt/sample history and assessment summary |
| `components/production/ProjectForms.tsx` | Creation/upload/reprocess forms, attempt keys and status refresh |
| `components/dashboard/Sidebar.tsx` | Adds Production projects link |
| `app/api/production/projects/route.ts` | Context-scoped project creation |
| `app/api/production/projects/[projectId]/documents/route.ts` | Validated PDF upload and shared processing |
| `app/api/production/projects/[projectId]/documents/[documentId]/route.ts` | Scoped private source download |
| `app/api/production/projects/[projectId]/documents/[documentId]/process/route.ts` | Explicit document reprocessing |
| `app/api/production/projects/[projectId]/assessments/[assessmentId]/bk/route.ts` | Draft PDF from persisted BK fields |
| `lib/production/application.ts` | Creates the processing adapter in the organisation context |
| `lib/production/types.ts` | Typed processing tables and RPC signatures |
| `lib/production/processing-types.ts` | Attempt/sample/overview DTOs |
| `lib/production/processing-store.ts` | Organisation/project-filtered reads and RPC adapter |
| `lib/production/process-document.ts` | PDF validation/hash and shared pipeline-to-persistence consumer |
| `lib/production/http.ts` | Request validation, same-origin guard and safe public errors |
| `lib/bk-skjema/analyse-bundle.ts` | Awaitable evidence-aware callbacks and sibling completion handling |
| `lib/bk-skjema/legal-citations.ts` | Existing citation-resolution behavior shared by both entry points |
| `app/api/data-lab/route.ts` | Uses shared citation helper; existing NDJSON flow retained |
| `supabase/migrations/20260909000000_project_document_processing.sql` | Files, runs, samples, scoped RPCs, constraints and RLS |
| `tests/production/project-processing.test.ts` | Offline SQL/pipeline/route/rendering regression integration |
| `eslint.config.mjs` | Restricts direct feature imports of the processing adapter |
| `docs/product/production-core.md` | This architecture, policies, validation and phase boundary record |


## Phase 1 — domain, persistence and application organisation context (historical completion record)

The user's follow-ups define Phase 1 as the domain/persistence foundation **including a
single-organisation application context**. This supersedes the original stage numbering and
planning-only scope below. The following records Phase 1 completion; current Phase 2 status is above.

### Domain and persistence foundation

`lib/production/types.ts` defines organisation-scoped Project → WasteStream → Assessment
records alongside the legacy browser/demo model. Projects have no authoritative EAL decision.
A stream can have many assessments with different EAL decisions, nullable hazard status,
decision snapshots, optional BK output and compliance evidence. Assessments and their initial
evidence links are append-only. The database assigns per-stream versions and predecessors
inside an atomic, membership-checked creation RPC with a per-stream row lock.

The additive `20260908000000_production_domain.sql` migration introduces organisations,
memberships, projects, streams, source-document metadata, assessments and assessment/document
links. Composite foreign keys enforce organisation and project ownership. A document can
support multiple assessments/streams in the same project with independent segment keys and
zero-based page ranges. Its hash and storage locator are immutable metadata; actual object
upload/access is not yet implemented. No existing compliance table or browser-storage key is
changed. These are decision snapshots, not the full draft/finalized BK lifecycle.

### How the current organisation is resolved

There is one feature entry point: **`getProductionApplication()` in
`lib/production/server.ts`**. It accepts no organisation argument.

1. It checks the current request against the existing Basic Auth portal credentials using
   the same constant-time helper as `proxy.ts`. A UI provider alone never authorises writes.
2. `lib/production/application.ts` reads the five server-only configuration variables below.
   It never reads a tenant from a URL, request body, localStorage or the first database row.
3. It signs in as one dedicated **ordinary Supabase Auth application user**, using a
   publishable/anon project key and server-held credentials. It never uses a service-role
   client. This preserves the single-customer portal UX without adding login or role screens.
4. It resolves the exact configured organisation through RLS. Missing configuration,
   missing membership or a different returned organisation fails closed; there is no fallback
   writable store. The low-level adapter adds explicit organisation filters to its queries.
5. It returns `{ organisation, store }`. Feature operations obtain their scope from this
   object. React's request cache deduplicates resolution within a request; there is no global
   tenant/session cache. Database requests have bounded timeouts and bypass response caching.

Example for a **future** authenticated server operation (not a new Project workflow):

```ts
import { getProductionApplication } from "@/lib/production/server";

const { store } = await getProductionApplication();
const project = await store.createProject({ name: "Site/job", location: "Site address" });
```

Feature code supplies neither an organisation ID nor a database client. ESLint restricts
`app/` and `components/` from importing the low-level store or configurable resolver directly.
The adapter remains infrastructure for tests and the central resolver, not a page API.

`app/layout.tsx` passes only the public organisation ID/name or explicit unavailable state
to `OrganisationProvider`. `useOrganisation()` provides read-only UI context; the sidebar
shows the customer name. There is no organisation switcher, setter or management screen.
If setup is missing or unavailable, the sidebar says so and existing legacy pages still
render. Production operations themselves throw rather than silently writing demo data.
Next.js rendering/navigation signals are rethrown instead of being swallowed by this fallback.

### Configuration and first-customer bootstrap

All five variables are server-only (no `NEXT_PUBLIC_` equivalents):

| Variable | Purpose |
| --- | --- |
| `PRODUCTION_ORGANISATION_ID` | Exact organisation UUID for this portal installation |
| `PRODUCTION_SUPABASE_URL` | Supabase API origin; HTTPS, or loopback HTTP for local development |
| `PRODUCTION_SUPABASE_PUBLISHABLE_KEY` | Publishable key or legacy anon JWT; secret/service-role keys are rejected |
| `PRODUCTION_APP_EMAIL` | Dedicated ordinary application user's email |
| `PRODUCTION_APP_PASSWORD` | That user's password; never sent to the browser |

There are no hard-coded production UUIDs or implicit customer seeds in feature code. There is
also no fallback to existing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` compliance settings.
Deployment operators must provision the organisation and the application user's membership
explicitly. This task has not provisioned or migrated a remote customer database.

For a local Supabase stack, with Docker running:

```bash
supabase start
supabase migration up --local
pnpm production:bootstrap-local "Local customer name"
pnpm dev
```

`supabase/config.toml` contains local configuration only. The bootstrap command reads
**local** `supabase status --output json`; it cannot accept a remote URL, linked-project
argument or environment fallback. It only permits loopback HTTP origins and rejects HTTP
redirects. It uses the local service key solely to create a named organisation, an ordinary
Auth user and membership. UUIDs and a strong random password are generated during provisioning.
It writes the five application variables to `.env.development.local` with mode `0600`, without
printing credentials or saving the service key. Next loads that file for `pnpm dev`.

The command reserves the file before creating any database records and refuses to overwrite
an existing file; rerunning against an already configured checkout does not seed duplicates.
If the file already contains unrelated settings, preserve it and provision/configure manually
or use a separate local checkout. Database provisioning failures compensate only records
created by that invocation. No runtime code automatically creates organisations or memberships.
The generated file is git-ignored. Existing `.env.local` credentials are not modified.

For a disposable clean-stack check, `supabase db reset --local` rebuilds local data from the
migration chain. **It erases local data**, so use it only on a deliberately disposable stack.
No reset or migration command targeting a remote database is part of this workflow.

### Local migration status and validation

This machine has Supabase CLI 2.98.2 but no available Docker daemon. `supabase start` was
attempted and reported that it could not connect to the local Docker socket. Consequently,
the actual local Supabase Auth/PostgREST stack and the successful CLI bootstrap path could
not be exercised here. No remote Supabase migration, provisioning or connection was used
as a substitute.

The Docker-independent command **`pnpm production:verify-local`** was executed successfully.
It created a fresh on-disk local PostgreSQL (PGlite) database, applied **all six repository
migrations unchanged**, including the original compliance schema and pgvector, then seeded a
local development organisation and verified a membership-scoped read. Its database was written
to `/var/folders/db/h3blb3lx69z4xqfp113dwnrc0000gn/T/waste-production-local-8i3sss`.
Each run uses a new temporary directory; it accepts no remote connection string. This is a
local PostgreSQL verification harness with simulated Auth roles/`auth.uid()`, not a hidden
application persistence fallback or proof that Supabase Auth/PostgREST deployment works.

Verification results for this slice:

- Phase 1 plus portal-auth tests: **59 passed**. Coverage includes expected organisation
  resolution, missing membership/configuration, forged tenant inputs, context-based project
  creation, provider behaviour, localhost-only bootstrap, framework rendering signals, and
  the original domain invariants.
- Clean-chain integration tests exercise the real application resolver and Supabase query
  builder against PostgreSQL queries and actual RLS. Only the HTTP/Auth service transport is
  simulated; another organisation's projects remain invisible.
- Full regression suite: **668 passed, 4 failed**. The four failures are the existing live
  `bk/` tests requiring Datalab/Anthropic credentials. The final framework-signal fix was then
  covered by the 59-test focused run and a fresh build.
- TypeScript: passed. Production build: passed, with request-time app-shell rendering.
- Lint for all new/modified context files: passed. Repository-wide lint remains **12 errors,
  1,477 warnings**, in existing pages, wizard text and the generated PDF worker.
- Local HTTP smoke check with temporary test credentials and production DB configuration
  explicitly disabled: unauthenticated request returned 401; `/` and `/data-lab` returned 200
  with the explicit unconfigured organisation state; `/api/data-lab/fill` returned a valid PDF
  whose text field matched the supplied value. No organisation/runtime errors were logged.
- Test-generated BK output fixtures were restored; extraction, HP, EAL, BK and compliance
  implementation files remain unchanged.

Untested paths/limitations: real Supabase Auth/PostgREST bootstrap and configured-customer
browser hydration; live provider extraction; multi-connection version contention; actual
source-object durability/access; production deployment. The dedicated app identity is shared
by this portal's Basic Auth users, so `created_by` records the portal identity, not individual
human attribution. Keep its membership restricted to this installation's customer. Per-user
identity, membership management and richer roles are future scope. Context resolution adds
Auth/database calls to configured page requests; outages show an explicit unavailable state.

### Remaining boundaries recorded at Phase 1 completion

Single-organisation application context is now integrated. **The existing Project/case UI
still uses its legacy browser store**, and Data Lab retains its working extraction/BK paths.
No page has been switched to production intake or assessment creation in this slice.

Phase 2 may separately introduce:

1. Project/intake adapters using `getProductionApplication()`, plus sample-to-stream
   association and production assessment creation without changing working engines.
2. Private source uploads/access and persisted extraction runs, blocks and segmentation
   evidence, including retry-safe jobs.
3. Explicit inventory/export and idempotent legacy browser-data import, with human stream
   mapping and provenance-gap reporting where history is incomplete.

Before using the configured production store in a running local workflow, start Docker,
apply local migrations, run the local bootstrap and exercise the Auth/PostgREST path. Human
questions, full decision/compliance entities, finalized BK artifacts, classification safety
fixes and shipment/facility matching remain separately scoped later work. No Phase 2 workflow
had been implemented at that point; current Phase 2 implementation and validation are above.

### Files changed for this integration slice

| File | Change |
| --- | --- |
| `lib/production/application.ts` | Central configuration validation, app-user sign-in and exact organisation resolution |
| `lib/production/server.ts` | Authenticated, no-tenant-argument feature entry point and safe shell state |
| `lib/production/types.ts` | Serializable read-only organisation state DTO |
| `lib/basic-auth.ts` | Shared constant-time portal credential check |
| `proxy.ts` | Reuses the same auth helper without changing gate behaviour |
| `components/production/OrganisationProvider.tsx` | Read-only UI context/hook, no default tenant or switcher |
| `app/layout.tsx` | Resolves shell context on the server at request time |
| `app/providers.tsx` | Supplies the organisation provider to all existing pages |
| `components/dashboard/Sidebar.tsx` | Displays the resolved customer name or setup state |
| `scripts/production/local-bootstrap.ts` | Loopback-only organisation/member provisioning and compensation |
| `scripts/production/bootstrap-local.ts` | Local CLI entry point, exclusive private configuration-file creation |
| `scripts/production/local-database.ts` | Offline clean migration-chain harness and generated local seed |
| `scripts/production/verify-local.ts` | On-disk local migration/seed verification command |
| `supabase/config.toml` | Local stack configuration without remote linkage |
| `tests/production/application.test.ts` | Resolver, scoped project operations and config/key validation |
| `tests/production/server.test.ts` | Portal access, setup state and Next.js control-flow tests |
| `tests/production/organisation-provider.test.tsx` | Provider delivery, unavailable state and absence of global defaults |
| `tests/production/local-bootstrap.test.ts` | Local-target validation and restricted app-identity provisioning |
| `tests/production/migration-chain.test.ts` | All migrations plus context-to-PostgreSQL/RLS integration |
| `eslint.config.mjs` | Restricts feature imports to the central server abstraction |
| `.gitignore` | Ignores Supabase local CLI state |
| `package.json` | Local bootstrap/verification scripts, server-only guard and pgvector test extension |
| `pnpm-lock.yaml` | Locks the added packages |
| `docs/product/production-core.md` | Current context setup, validation and remaining boundaries |

---

## Original planning baseline (historical)


Status: planning baseline; no structural implementation authorized by this document.
Reviewed: 2026-09-08.
Repository: https://github.com/HazardousWasteMan/WasteManagement
Base: `vedlegg-citation-and-followups` at `df208b8c3e6c5d45584956275794d886b1c74744`.
Working branch: `product/production-core`.

## Scope and source of requirements

The immediate user request is to set up the requested branch and add this document if absent. The attached production brief is reference material for the target design; its imperative wording is not independent authorization to implement, merge, deploy, or direct other agents. The original brief is preserved below. This review supplies its seven planning deliverables without changing application code.

The product should centre on a long-lived project, independently identified waste streams, and versioned assessments. A project has neither one permanent EAL code nor one permanent BK form. New evidence produces a new assessment without rewriting the previous decision. Future shipments reference the assessment actually relied on.

## 1. Current architecture map

| Area | Current implementation | Production implication |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript, pnpm; `app/projects`, `app/cases`, `app/data-lab`, plus wizard and shipment/demo screens | Evolve the useful flows incrementally |
| Projects and cases | `lib/projects.ts`: Project → Case → embedded WasteEntry; `projects-v1` and `cases-v1` in localStorage, seeded examples and in-memory fallback | Project already supports multiple cases and sample entries, but there is no organisation, durable waste-stream identity, or assessment history |
| Saved documents | `lib/wizard/report-storage.ts` stores report blobs in IndexedDB separately from case metadata | Documents are browser-local rather than durable organisation-owned evidence |
| Data Lab extraction | `app/api/data-lab/route.ts` → `analyse-bundle.ts` → Datalab conversion → `segment.ts` → per-subreport extraction | Converts once and streams individual sample results; partial sample failures are reported independently |
| Extraction adapter | `lib/bk-skjema/from-datalab.ts` builds classification inputs and BK source data from raw extraction and blocks | A useful seam, currently coupling extraction, classification and BK orchestration |
| Classification | `lib/hp-classification/{normalize,speciate,hazard,eal,classify-sample}.ts`, with reference JSON in `lib/data` | Preserve deterministic calculations, tri-state outcomes and traceable exclusions; fix specific known gaps separately |
| Other extraction flow | `app/api/extract`, `app/api/extract-sample`, `app/api/classify`, wizard components | A second intake path that must converge on shared persisted contracts without losing its safeguards |
| BK presentation | `app/data-lab/page.tsx`, `FormPane`, `DocumentPane`, `FieldsPane`, `SampleSwitcher` | Two-pane form/source inspection and sample selection already exist; working state is held in the page |
| BK generation | `form-map.ts` maps 103 controls; `fill-pdf.ts` and `/api/data-lab/fill` generate a PDF | Retain the low-level map beneath a human-question layer; generation is not durable finalization |
| Compliance | `lib/compliance`: explicit citation locations, Lovdata archive parsing, search/cache, citation views, corrections and freeze helpers | Strong reusable evidence foundation; no complete assessment finalization flow yet |
| Persistence/security | Supabase migrations contain legal paragraphs, freezes and corrections; `proxy.ts` uses shared Basic Auth | RLS on compliance tables closes anonymous table access, but service-role access and Basic Auth do not implement organisation membership |
| Shipments | `lib/shipments.ts`: localStorage, analysis name and depot, simulated time-based status | Prototype only; future shipment records need stable waste-stream and assessment references |

Current Data Lab path:

```text
PDF → conversion and source blocks → subreports → extraction per subreport
    → bkFromDatalab → classifySample → buildBkFields → filled PDF
                                         ↑
                              resolved legal citations
```

PR history was inspected through GitHub, with implementation checked locally:

- [PR #1](https://github.com/HazardousWasteMan/WasteManagement/pull/1), `main` → `compliance`: legal grounding, cache, freeze helper, disputes, tri-state hazard safety and leachate filtering. Open at review time.
- [PR #2](https://github.com/HazardousWasteMan/WasteManagement/pull/2), `compliance` → `vedlegg-citation-and-followups`: chapter-specific Vedlegg addressing, liquid-stream explanations without bypassing safety gates, dispute field keys, RLS and detected-substance Checkbox9/10 logic. Open at review time. Its history includes the compliance branch.
- Local `case-view-legal-citations` is six commits ahead of this base, ending at `2d0c23f`. It adds citation propagation through classification/WasteEntry and case-page display/disputes. These changes are not in this branch. Coordinate their later integration; do not silently duplicate or discard them.

## 2. What already fits

- Project is already a small site/context object; EAL and hazard results are held on waste entries rather than on Project itself.
- One source bundle can yield several subreports and individual BK forms. Segmentation is a starting point for assessment intake, not proof that every sample represents a distinct long-lived stream.
- Raw extraction is retained for reclassification without another extraction call. BK rows retain raw analyte names, units, LOQ and citations; fields can carry provider confidence.
- Source citations carry block IDs, page, source text and bounding boxes. Form clicks navigate to the original report region.
- BK field provenance already distinguishes extracted, derived, human, receiver and not-applicable values.
- Classification supports `boolean | null`; liquid/leachate safety gates and non-detect handling are explicitly tested.
- Legal grounding uses real source locations, verification metadata, all-or-nothing multi-location resolution and disputes scoped by paragraph plus resolved-field key.

These are implemented capabilities, not a claim that all production requirements are satisfied.

## 3. What to preserve unchanged during structural work

Preserve classification formulas, reference datasets, LOQ treatment, substance resolution, EAL assistance, liquid-row exclusions and tri-state rendering while introducing persistence adapters. Changes to chemical semantics need their own focused review and regression evidence.

Preserve source-coordinate transforms, absolute page indexing, source-block IDs, highlighting and the existing PDF field mapping. `DocumentPane` uses Datalab page frames: persist the coordinate frame rather than assuming every bbox is in PDF points.

Preserve verified Lovdata links and text, chapter-disambiguated annex resolution, citation keys, dispute scoping, graceful extraction fallback when legal services fail, and copy-by-value freeze semantics. A missing citation must remain visible as missing evidence, not become a fabricated legal conclusion.

Preserve wizard protections against duplicate commits and stale responses, and the multi-sample flow. Do not remove existing paths until the replacement can represent their saved records and pass their regression cases.

## 4. Required data-model changes

Target aggregate relationships:

```text
Organisation → Project → WasteStream → Assessment (versioned)
                                      ├─ SourceDocument links
                                      ├─ ExtractedAnalysis
                                      ├─ ClassificationDecision
                                      ├─ ComplianceEvidence
                                      └─ BKDocument
                         └─ Delivery / Shipment → relied-on Assessment
```

The hierarchy expresses ownership and decision context. Source files should be stored once per authorised project context and linked to multiple assessments through explicit sample/segment references. Do not duplicate a PDF for each stream or make a source file synonymous with a stream.

| Entity | Proposed minimum contract |
| --- | --- |
| Organisation and membership | Stable ID, customer identity, membership and roles; authenticated server-side access checks |
| Project | Organisation ID, stable project ID, site/customer context and editable metadata |
| WasteStream | Organisation/project IDs, stable stream ID, label, origin/process and contextual description; no permanent classification verdict |
| Assessment | Organisation/stream IDs, version and predecessor, lifecycle, evidence date, creator, timestamps and revision/concurrency token |
| SourceDocument / assessment link | Organisation/project ownership, content hash, immutable object reference, original filename; link includes extraction run and segment identity/page range |
| ExtractedAnalysis | Raw provider payload, extractor/schema version, raw values, units, LOQ, basis, source text, confidence and document/block/page/bbox references; retain missing values explicitly |
| ClassificationDecision | Exact input snapshot, engine and reference-data versions, normalisation and mapping results, HP outcomes, hazard tri-state, EAL assistance/selection, assumptions and reasons |
| ComplianceEvidence | Decision/field key, source and context evidence, classification reasoning, legal locations, verified text/version/link, disputes and finalized snapshots |
| HumanAnswer | Logical question key, typed answer, scope, provenance, actor/time and applicable mapping version; one answer may populate several controls |
| BKDocument | Assessment/revision ID, template/mapping version, rendered field snapshot, immutable generated artifact and hash, finalization metadata |
| Delivery / Shipment | Organisation/stream IDs and exact finalized assessment/BK reference, plus delivery facts; implementation deferred |

Scope customer records to an organisation and enforce parent-child ownership through database constraints, API checks and object-storage access controls. A shared public legal-text cache can remain global; customer disputes and assessment freezes need tenant context. Service-role credentials bypass RLS, so server-side authorisation remains essential.

A draft may be revised; finalization freezes the evidence and artifact actually used. Later results create a successor assessment. Use transactional or recoverable finalization with idempotency so retries cannot create mismatched snapshots or mark a missing PDF finalized. Snapshot every cited legal location, not just the primary dispute anchor.

Do not equate technical completion with a non-hazardous verdict. Preserve indeterminate assessments, explain missing evidence, and define explicit readiness/manual-review requirements before production finalization.

## 5. Required UX and component changes

Target flow: Projects → Project → upload → detect samples → associate/create streams → create assessments → answer remaining questions → BK ready → finalize/download.

- Extend the project detail view with streams, assessment history and uploaded documents. Let users associate a new sample with an existing stream or create a new one; do not auto-merge by sample label.
- Keep the left BK preview and green source navigation. Evolve the right pane into Evidence with source document, classification reasoning and legal basis shown according to selection.
- Introduce a typed logical-question registry over `form-map.ts`: organisation number, pickup location, origin/process, physical form, pre-treatment, colour, smell, transporter and recurring waste. Include applicability, validation, answer scope and mapped controls.
- Show “BK is almost ready. We need N answers from you.” Count applicable unresolved questions, not blank PDF controls; receiver-only and not-applicable controls do not inflate that count.
- Apply project/organisation defaults with provenance and allow assessment-specific overrides. Origin is currently changed for all samples in a Data Lab bundle; the target must support independent stream context.
- Preserve human answers across reclassification or explicitly surface conflicts. The current reclassify path replaces each sample's field array, so persistence must separate answers from generated values.
- Make partial extraction failures, unassigned samples, unknown substances, unsupported units and missing legal evidence actionable without exposing all implementation detail by default.
- Distinguish draft download from finalization and show historical finalized records using their saved evidence rather than current cache contents.

## 6. Migration risks and known gaps

1. **Browser-only data:** localStorage and IndexedDB live per browser/origin. Inventory and export both before migration. Import idempotently with legacy-ID mappings and an explicit customer organisation assignment; exclude demo seeds. Never clear legacy storage merely because an import started.
2. **Ambiguous history:** Case currently represents a report/workflow grouping and WasteEntry stores only summary classification. Do not mechanically rename Case to Assessment or claim missing provenance exists. Import entries as legacy assessments with provenance gaps; stream identity may need human reconciliation.
3. **Unsafe unit fallback:** `normalize.ts` currently treats unrecognised units as raw percentages with a warning. PR #2 also discloses this wider gap. Unsupported units such as `ppm` require explicit interpretation or indeterminate handling in a separately reviewed safety change before production use. Wet/dry-basis uncertainty also needs explicit handling; do not assume a conversion occurred.
4. **Incomplete classification evidence:** unmapped analytes are skipped by normalisation. Review sufficiency rules so incomplete coverage cannot silently imply safety, while preserving proven classification behaviour in the structural migration.
5. **Freeze integration:** `freezeFormField` is called by tests but not the current application finalization/download path. The helper is insert-oriented, but the schema does not itself enforce full record immutability or finalization idempotency. Extend this foundation rather than treating production auditability as finished.
6. **Legal coverage:** annexes are currently cached as whole sections; precise threshold-row addressing and broader EU/EEA evidence coverage remain work to verify. This review inventories code, not the current legal validity of threshold data. Semantic search locates candidates; explicit rules and evidence support decisions.
7. **Availability and concurrency:** keep extraction usable during legal-service outages, while making readiness policy explicit. Persist sample jobs and partial failures, and prevent stale reclassification responses from replacing newer revisions. Voyage quota handling remains tracked in `docs/ISSUES.md`.
8. **Branch drift:** PRs #1/#2 are stacked and open; case-view citations are on a separate local branch. Record dependencies and review merges deliberately. Agents sharing one checkout must coordinate branch changes; independent worktrees are preferable for concurrent implementation.

## 7. Staged implementation plan

| Stage | Bounded outcome | Exit evidence |
| --- | --- | --- |
| 0 — Baseline and coordination | Confirm this model, capture existing fixtures and branch dependencies, inventory browser records and setup requirements | Agreed migration mapping and reproducible baseline; no structural rewrite |
| 1 — Safety gaps | Fix unknown-unit/basis behaviour and evidence-sufficiency gaps in focused changes | Known-unit results preserved; unsupported inputs cannot produce an unqualified verdict; mixed/leachate/liquid/LOQ regressions covered |
| 2 — Ownership and persistence | Add organisation membership, project/stream/assessment schemas and durable source storage behind adapters | Cross-organisation read/write denied, stable document links, repeatable import with legacy data retained |
| 3 — Assessment intake | Persist segmentation/extraction runs and sample-to-stream association; support successive assessments | One PDF feeds multiple assessments; later samples reuse a stream; retries/partial failures do not duplicate records |
| 4 — Decision and evidence records | Wrap existing engines with versioned inputs/results and linked compliance/context evidence; reconcile case-view citation work | Reclassification creates a traceable revision; historical results survive source/cache changes |
| 5 — Human completion and Evidence UI | Add logical questions, durable answers, correct readiness count and progressive evidence panels | Answers survive reload/reclassification; independent origins supported; exact source highlighting retained |
| 6 — BK finalization and migration rollout | Add validated artifact generation, full evidence snapshots, idempotent finalization and legacy read adapters | Re-download returns the saved artifact; every legal location is frozen; concurrent/retried finalization remains consistent; restore path verified |

Shipment integration and disposal-site matching follow completed assessments in a later phase. Do not build a disposal map, unrelated dashboards, or replace proven engines to make the architecture look cleaner.

### Setup and validation notes

- Requested checkout, fast-forward pull and branch creation completed; the base was already current. No existing production-core document was found.
- `package.json` declares pnpm `11.21.0`; dependencies are present locally. Use the declared package manager and lockfile for future setup. Read `AGENTS.md` and the bundled Next.js guides before code changes.
- `.env.local` exists; its secrets were not inspected or changed. `.env.local.example` lists Anthropic and Basic Auth only; Data Lab/compliance also reference `DATALAB_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and Voyage configuration. Verify setup documentation in the implementation phase without copying secrets into git.
- This change adds documentation only. No dependency installation, live provider call, database migration, app startup, deployment, or test-suite run is required for this review. PR descriptions report earlier test/build results; those are not fresh verification by this task.
- Structural implementation remains a subsequent user-directed task.

## Original attached product brief

The following is the supplied reference text, preserved verbatim inside a quotation fence. It describes the intended product and planning expectations; it does not expand the immediate setup task's authorization.

```text
We are restructuring this repository from an MVP/prototype into the production core
for a hazardous-waste management product.

Do NOT start implementing immediately.

First inspect the repository, especially:

- app/data-lab
- components/data-lab
- lib/bk-skjema
- lib/hp-classification
- lib/compliance
- current project models
- PR #1 compliance work
- PR #2 vedlegg/compliance follow-ups

The product architecture we have decided on is:

Organisation
  -> Project
      -> WasteStream
          -> Assessment
              -> SourceDocument
              -> ExtractedAnalysis
              -> ClassificationDecision
              -> ComplianceEvidence
              -> BKDocument
          -> Delivery / Shipment

PRODUCT PRINCIPLES

1. MULTI-ORGANISATION
The product will eventually be used by multiple waste handlers/customers.
We start with one real customer, but core persisted entities should be organisation-scoped.

2. PROJECT IS LONG-LIVED
A project represents a real site/job/customer project.
A project may contain:
- many uploaded analysis documents
- many waste streams
- many EAL codes
- repeated sampling over months/years
- multiple assessments of the same waste stream
- future shipments/deliveries

Do not associate one Project with one EAL code or one BK form.

3. SOURCE DOCUMENT != WASTE STREAM
One laboratory PDF can contain multiple independent samples/waste streams.
The existing Data Lab segmentation already detects multiple sub-reports.

Each relevant sample can produce its own assessment and BK form.

4. ASSESSMENT IS VERSIONED
Classification is a decision based on evidence at a point in time.

EAL code, hazardous status and BK conclusions belong primarily to an Assessment,
not permanently to the Project.

A later chemical analysis may create a new Assessment without overwriting the old one.

5. THREE SEPARATE ENGINES

A. Document intelligence:
"What does the source document say?"

Keep:
- raw value
- unit
- LOQ
- page
- bbox
- original source text
- extraction confidence

B. Chemical / waste classification:
"What does the analytical evidence mean?"

Includes:
- analyte normalization
- substance resolution
- units/basis normalization
- HP1-HP15
- hazardous status
- EAL assistance

This should be deterministic wherever possible.

Unknown/insufficient evidence MUST NOT be silently interpreted as non-hazardous.
Preserve the existing yes/no/indeterminate philosophy.

C. BK / compliance:
"What does the BK declaration require and what evidence supports each decision?"

Values may come from:
- source document
- project data
- user input
- deterministic classification
- legal/compliance rules

6. COMPLIANCE IS EVIDENCE OF A DECISION

Compliance should not primarily be a separate wizard.

For important decisions a user should be able to inspect:

Decision
 -> document evidence
 -> project/context evidence
 -> classification reasoning
 -> legal basis

Preserve the existing legal-citation work:
- Lovdata-backed provisions
- legalCitation attached to fields
- verified source information
- immutable/frozen evidence for finalized records
- disputes by exception
- relevant EU/EEA legal grounding

Semantic/embedding search can locate candidate law.
It must not itself be the final compliance decision mechanism.

7. BK UX

The existing two-pane interaction is valuable:

LEFT:
filled BK form

RIGHT:
source/evidence

Clicking a green extracted field must continue to jump to and highlight the exact
source location in the laboratory report.

However, unresolved human inputs must become first-class work.

Do not force users to think about 103 AcroForm fields.

Group underlying PDF controls into human questions, for example:
- organisation number
- pickup location
- waste origin/process
- physical form
- pre-treatment
- colour
- smell
- transporter information
- recurring waste

One logical answer may populate several PDF fields.

The primary UX should communicate:
"BK is almost ready. We need N answers from you."

8. EVIDENCE PANEL

The right-hand side should evolve conceptually from "Original report" into "Evidence".

Depending on the selected field, it may show:
- Source document
- Classification reasoning
- Legal basis

Do not show all technical/legal detail by default.
Use progressive disclosure.

9. PROJECT UX

Target flow:

Projects
 -> Project
 -> upload analysis document
 -> detect N samples/waste streams
 -> associate/create waste streams
 -> create assessments
 -> complete remaining human questions
 -> BK ready
 -> finalize/download

Future disposal-site matching should consume completed Assessments.
Do NOT build the disposal map as part of this task.

10. MVP / PRODUCTION PRIORITY

The immediate product goal is to nail:

- document segmentation
- reliable chemical extraction
- unit/LOQ/basis normalization
- substance mapping
- HP classification
- EAL assistance
- real Norwegian/EU compliance evidence
- human-input completion
- correct BK generation
- auditability/provenance

Do not spend this phase building unrelated dashboard features.

FIRST TASK

Inspect the current repository against this model.

Produce:
1. Current architecture map.
2. What already fits this target.
3. What should be preserved unchanged.
4. Data-model changes required.
5. UX/component changes required.
6. Migration risks.
7. A staged implementation plan.

Be especially conservative around classification and compliance code.
Do not replace proven logic just to make the architecture cleaner.

After the plan, wait before making large structural changes.
```
