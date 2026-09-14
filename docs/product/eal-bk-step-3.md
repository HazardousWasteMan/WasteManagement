# EAL and BK evidence separation — implementation Step 3

Implemented on `product/production-core` after the typed measurement and HP boundaries. No facility
matching, complete landfill-acceptance evaluator or general visual redesign is included. No commit,
push, merge, remote migration or confidential fixture was used.

## A. Replaced EAL behavior

The old implementation filtered an EAL chapter by the hazard boolean and assigned the first remaining
catalogue row. It could therefore turn catalogue order, chemistry and a broad chapter into a final
code. New processing retains every candidate and never treats array position as a decision. A
laboratory-stated code is evidence and a machine suggestion, not an automatic final selection.

## B. Structured EAL model

`eal-structured-2026-09-10.1` records `candidates`, nullable `suggestedCode` and `selectedCode`,
`resolutionStatus`, reason text, origin/process evidence, sample-material evidence, mirror/absolute
metadata, review state, machine suggestion and an optional human selection. Resolution status is
`resolved`, `ambiguous`, `insufficient_context`, `requires_human_review` or `not_applicable`.

The compatibility `code` field is only the selected-code projection. Legacy snapshots remain readable
through an explicit adapter, retain their old code and prose, and are marked `legacy` plus
`requires_human_review`; they cannot be promoted to current finalization evidence.

## C. Candidate and resolution policy

Origin/process must map to a chapter before candidates are generated. Material text is then compared
with leaf descriptions using normalized meaningful words. Exact material matches take precedence over
related matches. Candidates are normalized and sorted by code before evaluation.

A unique material-specific absolute entry can resolve without HP. For a supported material-specific
mirror pair, a reviewed `hazardous` or `non_hazardous` HP aggregate selects the corresponding entry.
An indeterminate HP aggregate leaves that mirror unresolved. Missing material in chapter 17 01 keeps
the full candidate set ambiguous and never defaults to concrete. If a multi-sample document receives
one shared origin value, every sample records that this origin is bundle-level rather than sample-
specific evidence.

The current mirror/absolute metadata is a conservative description-based heuristic over the existing
catalogue. It is intentionally small and must receive domain review before being treated as a complete
legal EAL ontology.

## D. Human review and audit

The existing assessment workspace contains a focused candidate selector and required reason. Saving a
review appends an immutable BK revision; it does not mutate the Assessment or machine suggestion.
PostgreSQL validates that the code belongs to the saved candidates and stamps the authenticated actor
and database timestamp. The revision retains the complete candidate set, reason and copied origin /
material evidence. A separate immutable `eal_reviewed` audit event records the revision, chosen code,
reason and original suggestion. Finalized assessments reject edits; a different EAL decision therefore
requires the existing successor workflow.

## E. BK narrative

The generated description now has explicit sections for waste/origin, analyses, relevant total-content
composition, HP conclusion and limits, EAL decision, landfill-acceptance evidence, and missing/review
items. Only rows identified as `total_content` appear in the composition summary. It never says that
unshown results are below detection, never converts indeterminate HP to non-hazardous, and never calls
an ambiguous suggestion assigned. A reviewed selection updates both the EAL digit fields and the EAL
section while preserving the earlier machine evidence.

## F. Landfill-acceptance separation

Classification snapshots now carry a separate evidence-inventory state: `not_evaluated`,
`evidence_available`, `requires_review` or `resolved`. Step 3 emits only the first two. Leaching,
column and physical/composition measurements can mark evidence available, but no criterion is evaluated.
HP status no longer selects ordinary/hazardous landfill category, an analysis no longer proves a
testing obligation, and absence of a triggered HP no longer emits “no extra precautions.” These BK
controls stay unresolved and explain that acceptance review is pending. Waste-type HP controls remain
separate from landfill-category controls.

## G. Tests and validation

Synthetic tests cover candidate-order independence, unknown chapter-17-01 material, indeterminate and
resolved mirror pairs, HP-independent absolute entries, missing origin, human override provenance,
legacy reading, PostgreSQL actor/timestamp stamping, missing-reason rejection, immutable finalized
records, safe BK wording and landfill separation. Existing Data Lab, HP, BK, production persistence,
clean migration-chain and schema regressions were included.

- Focused Step 3/type/migration run: **102 tests passed across 5 files**.
- Complete deterministic run: **776 tests passed across 49 files**.
- TypeScript and the Next.js production build passed.
- Targeted changed-file lint and `git diff --check` passed without findings.
- The live Lovdata archive check and four credential-dependent provider scripts remain excluded under
  the same stated Step 2 conditions; no fresh provider credentials or customer documents were used.

## H. Before confidential real-document regression

- Domain-review mirror/absolute metadata and representative origin/material vocabulary.
- Exercise reports where one PDF contains samples with different origins; current upload accepts one
  bundle-level origin and discloses that limitation.
- Verify human EAL review, audit actor and finalization through real Supabase Auth/PostgREST/RLS.
- Compare generated narrative against confidential total-content, batch, column and mixed reports
  locally without committing inputs or outputs.
- Independently validate HP/EAL outcomes and confirm legal-reference freshness with the team.

## I. Before visual redesign

- Decide how reviewers should search/filter a large candidate list and inspect evidence without hiding
  uncertainty.
- Decide whether origin and material need explicit sample-level correction workflows.
- Define a later landfill-acceptance evaluator and its review semantics before presenting any acceptance
  category as resolved.
- Confirm which classification/BK states the team will allow to finalize in staging. Current policy
  requires resolved current EAL and determinate HP, while landfill acceptance is explicitly outside the
  classification/BK finalization boundary.

## Files changed in Step 3

- `lib/hp-classification/eal.ts`, `landfill-acceptance.ts`, `classify-sample.ts`
- `lib/bk-skjema/form-map.ts`, `from-datalab.ts`, `analyse-bundle.ts`, `workspace.ts`, `questions.ts`
- `lib/production/bk-workspace.ts`, `bk-draft-store.ts`, `finalization-policy.ts`, `types.ts`, `versions.ts`
- `components/production/BkWorkspace.tsx`
- `app/api/production/projects/[projectId]/assessments/[assessmentId]/eal-review/route.ts`
- `supabase/migrations/20260914000000_structured_eal_finalization.sql`
- `tests/hp-classification/eal.test.ts`, `synthetic-basis-eal-review.test.ts`
- `tests/bk-skjema/from-datalab.test.ts`, `tests/production/project-processing.test.ts`
- `tests/production/bk-questions.test.tsx`
- `bk/fill-form.test.ts`
- `docs/product/production-core.md`, `docs/product/bk-questions.md`, `docs/product/eal-bk-step-3.md`
