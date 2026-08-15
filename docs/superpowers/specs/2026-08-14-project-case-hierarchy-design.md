# Project/Case Hierarchy — Design Spec

## Problem

Today's data model (`lib/analyses.ts`) is flat: one `Analysis` = one full wizard run = one waste
stream = one row on the "My analyses" homepage. This has two real gaps:

1. **No location.** Nothing captures where the waste physically is, which matters for facility
   matching (nearest/eligible receiver) even though that connection isn't being built yet.
2. **No multi-waste-type support.** A single uploaded document can genuinely describe several
   distinct waste streams from the same job (confirmed against the real Alta Lufthavn PDF: one
   report, several concrete/soil samples). `SampleSelectionStep` today forces picking exactly one
   sample per wizard run, silently discarding the others — the user has to re-upload the same
   document N times and lose the "these all came from one submission" context entirely.

## Real-world shape (confirmed during brainstorming)

A **Project** is a site/job (e.g. "Alta Lufthavn") — has one location, may receive multiple
document submissions over time, each tracked separately but grouped under the project. A **Case**
is one such submission (one wizard run through one uploaded document) — may itself describe
several distinct waste streams. A **waste entry** is what today's `Analysis` already represents:
one classified waste stream with an EAL code and hazard status.

```
Project (site/job, has a location)
  └── Case (one document submission)
        └── WasteEntry (one classified waste stream) × 1 or more
```

## Data model

Replaces `lib/analyses.ts`'s `Analysis`/`AnalysisResult` entirely (not additive — no code should
keep reading the old flat shape once this ships):

```ts
export interface Project {
  id: string;
  name: string;
  location: string;   // extracted from a document or entered manually; editable at any time
  createdAt: number;
}

export interface Case {
  id: string;
  projectId: string;
  name: string;        // derived from the source document's customerName/externalReportNo
  createdAt: number;
  wasteEntries: WasteEntry[];
}

export interface WasteEntry {
  id: string;
  sampleLabel: string;         // sampleMarking or sampleIdentifier — distinguishes entries within one case
  isHazardous: boolean;
  ealCode: string | null;
  avfallsstoffnr: string | null;
  summary: string;
}
```

Storage mirrors the existing `lib/analyses.ts` pattern exactly (localStorage in the browser, an
in-memory fallback for tests/SSR, JSON-serialized) — new keys (e.g. `projects-v1`, `cases-v1`),
new seed data reworked from today's 4 flat seeds into 2-3 seed projects (one of them modeled on
Alta Lufthavn: a project with a real location and 1-2 cases, each with 1-2 waste entries) so the
app isn't empty on first load.

## Location extraction

`lib/hp-classification/extract.ts`'s LLM metadata extraction schema gains one new field, following
the exact same never-fabricate discipline as every other extracted field (e.g. `originProcess`,
`labStatedEalCode`):

```ts
"location": string | null
```

Extracted from whatever the document states (site name, address, municipality) — `null`, never
guessed, when the document doesn't say. This flows through `Wizard.tsx`'s extraction state
alongside the existing metadata and is never trusted silently: it only ever pre-fills an editable
field the user confirms (see below), the same pattern already used for `originProcess` and
`labStatedEalCode` elsewhere in this wizard.

## Wizard flow changes

Two changes to the existing `upload → select-sample → review → results → facility-match` flow,
both additive to the sequence, not replacing any existing step's internals:

**1. Project assignment**, inserted once a waste entry's classification is confirmed (after
`results`, alongside or just before `facility-match` — exact placement decided at plan time). A
dropdown lists existing projects by name, plus a "+ New project" option. Choosing "+ New project"
reveals a name field and a location field, the location pre-filled from the extracted `location`
(editable, never silently trusted). Choosing an existing project skips location entry entirely —
the project's stored location is used, unchanged by this case. This determines which `Case` (new
or existing) the resulting `WasteEntry` gets appended to; the first waste entry submitted for a
brand-new project also creates that project's first `Case`.

**2. End-of-case choice**, replacing today's unconditional "Send analysis" button on the
facility-match step with two buttons:
- **"Add another sample from this document"** — shown only when the originally detected sample
  list had more than one entry and at least one hasn't been classified into this case yet. Returns
  to `SampleSelectionStep` with the same file and the same in-progress `Case`, so the next picked
  sample's resulting `WasteEntry` is appended to that *same* case rather than starting a new one.
- **"Finish case"** — always available. Navigates to the case's detail page.

This directly implements the "pick one at a time, repeatable" flow: the user controls pace and
which samples matter, and nothing forces N back-to-back LLM extraction calls.

## Pages

- **`app/page.tsx`** ("My analyses") becomes a **project overview**: one row per project — name,
  location, case count, aggregate hazardous-waste-entry count — linking to that project's detail
  page. This is the multi-project/multi-case overview requested.
- **New `app/projects/[id]/page.tsx`**: lists the project's cases (name, waste-entry count,
  created date), linking to case detail. Shows the project's location and lets it be edited.
- **`app/analyses/[id]/page.tsx`** becomes **`app/cases/[id]/page.tsx`**: shows the case's waste
  entries — today's single-result detail view (status, EAL code, facility match, shipment/map
  UI), now iterated once per entry instead of assuming exactly one.

This is a full replacement of the current homepage and analysis-detail page, not an addition
alongside them — consistent with Case/Project being the new top-level model rather than two
parallel systems coexisting.

## Non-goals

- No backend/database — this stays frontend-only/localStorage, matching the rest of the app's
  current demo scope.
- No case-level location override — location lives only on `Project`, per the real-world shape
  confirmed during brainstorming (a project is one site).
- No auto-matching of extracted location/customer name against existing projects — project
  assignment is always an explicit user choice (dropdown + "new project"), not fuzzy-matched.
- No automatic processing of every detected sample — multi-sample handling stays user-driven,
  one pick at a time.
- No change to facility-matching logic itself (`lib/hp-classification/facility-match.ts`) — this
  spec adds a location field to the data model but does not yet wire it into facility-match
  eligibility logic; that remains a real, separate follow-up once this foundation exists.

## Testing

- `lib/projects.ts`: unit tests for `listProjects`, `getProject`, `addProject`,
  `addCase`/case-creation, `addWasteEntry` (or equivalent), covering the localStorage/in-memory
  fallback split (mirroring `lib/analyses.ts`'s existing `__resetForTests` pattern), and seed data
  shape/count.
- `lib/hp-classification/extract.ts`: existing extraction tests extended to cover the new
  `location` field being present-but-nullable in the schema, and a real never-fabricate test (a
  document with no location text yields `location: null`, not a guess).
- Wizard flow: tests (to the extent this repo tests wizard components — extending the existing
  test coverage pattern) confirming the "Add another sample" button only appears when unclassified
  samples remain, and that finishing a case correctly appends multiple `WasteEntry`s to one `Case`
  rather than creating a new case per entry.
- Page-level: confirm `app/projects/[id]/page.tsx` and `app/cases/[id]/page.tsx` render real seed
  data correctly, matching the existing test-coverage style for `app/analyses/[id]/page.tsx` today
  (if any exists — checked at plan time).
