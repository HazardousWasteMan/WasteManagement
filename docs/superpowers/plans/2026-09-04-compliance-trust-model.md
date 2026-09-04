# Compliance Trust Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the one grounded BK-skjema field (Checkbox10) show its real legal citation live in
the UI, and let a person flag a citation they disagree with — without ever rewriting an
already-frozen record.

**Architecture:** A new `compliance_corrections` table records disputes as independent, layered
records (never edits to `compliance_form_freezes`). A pure `citation-view.ts` module shapes a
`LegalParagraph` + dispute state into what the UI needs. `BkField` gains an optional
`legalCitation` carrying that shape; a small React component renders it inline next to the
existing `note` text in `FieldsPane.tsx`, with a non-blocking "I disagree" action that posts to a
new API route. Real resolution (calling Phase 1's `search()` plus this plan's
`hasUnresolvedDispute()`) happens once, server-side, in `app/api/data-lab/route.ts`, for the one
field this slice grounds — the rest of `buildBkFields`/`bkFromDatalab` stays synchronous and
untouched.

**Tech Stack:** TypeScript, Next.js, React, Vitest, `@supabase/supabase-js` (already a
dependency, Task 1 of the Phase 1 plan).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-04-compliance-trust-model-design.md`. Builds on the
  Phase 1 slice (`docs/superpowers/plans/2026-09-03-compliance-cache-phase1-slice.md`) —
  `lib/compliance/search.ts`, `freeze.ts`, `store.ts`, `types.ts` all exist and are unmodified by
  this plan except where a task says otherwise.
- **Trust-by-default, dispute-by-exception**: a `grounded_high` citation is used automatically,
  with no approval gate. The only human action is disputing it after the fact.
- **No role gating in this slice** (spec decision, confirmed): the app has no per-user identity
  system (`proxy.ts` is one shared login for everyone). The dispute action is available to
  anyone with app access; the person raising it types a free-text name. Real role-gating is an
  explicit, disclosed follow-up once real auth exists — do not fake a role check.
- **A dispute never edits `compliance_form_freezes`.** Every dispute is a new row in
  `compliance_corrections` that points at what it disputes; historical frozen records are
  read-only from this plan onward, exactly as Phase 1 built them.
- **Deviation from the spec's literal correction-table sketch, deliberate:** the spec sketches
  `freeze_id` as a required reference. In practice, the inline "I disagree" action (spec UI
  surface #1) fires at fill time, before a form is ever submitted/frozen — there is often no
  freeze yet to reference. `freeze_id` is **nullable** here: a dispute always anchors on
  `disputed_paragraph_id` (the paragraph itself), and carries `freeze_id` only when a freeze
  already exists for that specific citation at the moment the dispute is raised. This preserves
  the spec's real intent (frozen history is provably distinct from a later dispute) without
  forcing every fill-time disagreement to wait for a submission that may never happen.
- **New citation of a disputed paragraph gets a visible flag, never a block** (spec decision):
  `hasUnresolvedDispute(paragraphId)` is checked wherever a citation is resolved, and the result
  is surfaced, not enforced.
- Every task ends green on `pnpm test` (`npx vitest run`) and `pnpm build`, matching this repo's
  existing verification standard. A compliance-layer failure (Supabase/Voyage/Lovdata down) must
  never break the surrounding extraction pipeline — Task 6 makes this explicit.

---

### Task 1: `compliance_corrections` schema and store

**Files:**
- Create: `supabase/migrations/20260904000000_compliance_corrections.sql`
- Create: `lib/compliance/corrections.ts`
- Test: `tests/compliance/corrections.test.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing Supabase project from Phase 1, id
  `zrexxdnlonleijhlmnjp`).
- Produces: `export interface DisputeRecord { id: string; freezeId: string | null;
  disputedParagraphId: string; raisedBy: string; raisedAt: string; reason: string; resolution:
  "upheld" | "corrected" | null; correctedParagraphId: string | null; resolvedBy: string | null;
  resolvedAt: string | null }`, `export interface CorrectionStore { raise(args: {
  disputedParagraphId: string; freezeId: string | null; raisedBy: string; reason: string }):
  Promise<DisputeRecord>; hasUnresolved(paragraphId: string): Promise<boolean> }`,
  `export function createSupabaseCorrectionStore(): CorrectionStore` — consumed by Task 5 (the
  dispute API route) and Task 6 (resolution wiring).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260904000000_compliance_corrections.sql
create table compliance_corrections (
  id uuid primary key default gen_random_uuid(),
  freeze_id uuid references compliance_form_freezes(id), -- nullable: see plan's Global Constraints
  disputed_paragraph_id text not null references legal_paragraphs(id),
  raised_by text not null,
  raised_at timestamptz not null default now(),
  reason text not null,
  resolution text check (resolution in ('upheld', 'corrected')),
  corrected_paragraph_id text references legal_paragraphs(id),
  resolved_by text,
  resolved_at timestamptz
);

create index compliance_corrections_paragraph_idx on compliance_corrections (disputed_paragraph_id);
create index compliance_corrections_freeze_idx on compliance_corrections (freeze_id);
```

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Use `apply_migration` with `project_id: "zrexxdnlonleijhlmnjp"`, name `compliance_corrections`,
the SQL above. Verify with `list_tables` on the same project — expect `compliance_corrections`
listed with all 9 columns and both indexes.

- [ ] **Step 3: Write the failing test**

```ts
// tests/compliance/corrections.test.ts
import { describe, it, expect } from "vitest";
import type { CorrectionStore, DisputeRecord } from "@/lib/compliance/corrections";

// In-memory double, reused by tests/compliance/dispute-route.test.ts (Task 5) as a test double
// for live Supabase — same role as store.test.ts's in-memory ParagraphStore in the Phase 1 plan.
export function createInMemoryCorrectionStore(seed: DisputeRecord[] = []): CorrectionStore {
  const rows = [...seed];
  return {
    async raise(args) {
      const record: DisputeRecord = {
        id: `dispute-${rows.length + 1}`,
        freezeId: args.freezeId,
        disputedParagraphId: args.disputedParagraphId,
        raisedBy: args.raisedBy,
        raisedAt: new Date().toISOString(),
        reason: args.reason,
        resolution: null,
        correctedParagraphId: null,
        resolvedBy: null,
        resolvedAt: null,
      };
      rows.push(record);
      return record;
    },
    async hasUnresolved(paragraphId) {
      return rows.some(r => r.disputedParagraphId === paragraphId && r.resolution === null);
    },
  };
}

describe("CorrectionStore interface (via in-memory implementation)", () => {
  it("raise() creates a record with resolution null and returns it", async () => {
    const store = createInMemoryCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "This waste stream doesn't match § 11-4's scope",
    });
    expect(record.resolution).toBeNull();
    expect(record.disputedParagraphId).toBe("no-avfallsforskriften-11-4");
    expect(record.freezeId).toBeNull();
  });

  it("hasUnresolved is true right after a dispute is raised", async () => {
    const store = createInMemoryCorrectionStore();
    await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4")).toBe(true);
  });

  it("hasUnresolved is false for a paragraph with no disputes at all", async () => {
    const store = createInMemoryCorrectionStore();
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4")).toBe(false);
  });

  it("hasUnresolved is false once every dispute on that paragraph is resolved", async () => {
    const resolved: DisputeRecord = {
      id: "dispute-1",
      freezeId: null,
      disputedParagraphId: "no-avfallsforskriften-11-4",
      raisedBy: "Kari Nordmann",
      raisedAt: new Date().toISOString(),
      reason: "reason",
      resolution: "upheld",
      correctedParagraphId: null,
      resolvedBy: "Ola Compliance",
      resolvedAt: new Date().toISOString(),
    };
    const store = createInMemoryCorrectionStore([resolved]);
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4")).toBe(false);
  });

  it("a dispute can carry a real freezeId when one already exists for the citation", async () => {
    const store = createInMemoryCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      freezeId: "freeze-abc-123",
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    expect(record.freezeId).toBe("freeze-abc-123");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/corrections.test.ts`
Expected: FAIL — `lib/compliance/corrections.ts` doesn't exist yet.

- [ ] **Step 5: Create `lib/compliance/corrections.ts`**

```ts
// lib/compliance/corrections.ts
import { createClient } from "@supabase/supabase-js";

export interface DisputeRecord {
  id: string;
  freezeId: string | null;
  disputedParagraphId: string;
  raisedBy: string;
  raisedAt: string;
  reason: string;
  resolution: "upheld" | "corrected" | null;
  correctedParagraphId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface CorrectionStore {
  raise(args: {
    disputedParagraphId: string;
    freezeId: string | null;
    raisedBy: string;
    reason: string;
  }): Promise<DisputeRecord>;
  hasUnresolved(paragraphId: string): Promise<boolean>;
}

interface Row {
  id: string;
  freeze_id: string | null;
  disputed_paragraph_id: string;
  raised_by: string;
  raised_at: string;
  reason: string;
  resolution: DisputeRecord["resolution"];
  corrected_paragraph_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

function rowToRecord(row: Row): DisputeRecord {
  return {
    id: row.id,
    freezeId: row.freeze_id,
    disputedParagraphId: row.disputed_paragraph_id,
    raisedBy: row.raised_by,
    raisedAt: row.raised_at,
    reason: row.reason,
    resolution: row.resolution,
    correctedParagraphId: row.corrected_paragraph_id,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
  };
}

export function createSupabaseCorrectionStore(): CorrectionStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  const client = createClient(url, key);

  return {
    async raise(args) {
      const { data, error } = await client
        .from("compliance_corrections")
        .insert({
          freeze_id: args.freezeId,
          disputed_paragraph_id: args.disputedParagraphId,
          raised_by: args.raisedBy,
          reason: args.reason,
        } as never)
        .select()
        .single();
      if (error) throw new Error(`raise dispute failed: ${error.message}`);
      return rowToRecord(data as Row);
    },

    async hasUnresolved(paragraphId) {
      const { data, error } = await client
        .from("compliance_corrections")
        .select("id")
        .eq("disputed_paragraph_id", paragraphId)
        .is("resolution", null)
        .limit(1);
      if (error) throw new Error(`hasUnresolved check failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/corrections.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260904000000_compliance_corrections.sql lib/compliance/corrections.ts tests/compliance/corrections.test.ts
git commit -m "feat(compliance): add compliance_corrections schema and CorrectionStore

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Citation view — pure UI-shaping module

**Files:**
- Create: `lib/compliance/citation-view.ts`
- Test: `tests/compliance/citation-view.test.ts`

**Interfaces:**
- Consumes: `LegalParagraph` from `lib/compliance/types.ts` (Phase 1, unmodified).
- Produces: `export interface LegalCitationView { paragraphId: string; label: string; sourceLink:
  string; verifiedAt: string; disputed: boolean }`, `export function buildLegalCitationView(
  paragraph: LegalParagraph, disputed: boolean): LegalCitationView` — consumed by Task 3
  (`BkField.legalCitation`'s type) and Task 6 (real resolution).

- [ ] **Step 1: Write the failing test**

```ts
// tests/compliance/citation-view.test.ts
import { describe, it, expect } from "vitest";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import type { LegalParagraph } from "@/lib/compliance/types";

const paragraph: LegalParagraph = {
  id: "no-avfallsforskriften-11-4",
  source: "no",
  jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften",
  article: "11",
  paragraph: "4",
  text: "farlig avfall skal håndteres forsvarlig",
  inForce: true,
  lastVerifiedAt: "2026-09-03T19:26:14.030Z",
  lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current",
  amendedBy: [],
  previousVersionId: null,
  humanSignedOff: false,
  sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
};

describe("buildLegalCitationView", () => {
  it("builds a human-readable label from a known document id", () => {
    const view = buildLegalCitationView(paragraph, false);
    expect(view.label).toBe("Avfallsforskriften § 11-4");
  });

  it("falls back to the raw documentId when it isn't in the known label map", () => {
    const unknownDoc: LegalParagraph = { ...paragraph, documentId: "some-future-forskrift", article: "3", paragraph: "1" };
    const view = buildLegalCitationView(unknownDoc, false);
    expect(view.label).toBe("some-future-forskrift § 3-1");
  });

  it("passes through paragraphId, sourceLink, and verifiedAt unchanged", () => {
    const view = buildLegalCitationView(paragraph, false);
    expect(view.paragraphId).toBe("no-avfallsforskriften-11-4");
    expect(view.sourceLink).toBe("https://lovdata.no/forskrift/2004-06-01-930/§11-4");
    expect(view.verifiedAt).toBe("2026-09-03T19:26:14.030Z");
  });

  it("carries the disputed flag through exactly as passed", () => {
    expect(buildLegalCitationView(paragraph, true).disputed).toBe(true);
    expect(buildLegalCitationView(paragraph, false).disputed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/compliance/citation-view.test.ts`
Expected: FAIL — `lib/compliance/citation-view.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/compliance/citation-view.ts`**

```ts
// lib/compliance/citation-view.ts
import type { LegalParagraph } from "@/lib/compliance/types";

export interface LegalCitationView {
  paragraphId: string;
  label: string;
  sourceLink: string;
  verifiedAt: string;
  disputed: boolean;
}

// Real, sourced document titles for the ids this cache currently seeds. Extend as the seed
// corpus grows (spec §10 in the Phase 1 design) — never guess a title for an id not listed here,
// fall back to the raw documentId instead (see DOCUMENT_LABELS[...] ?? paragraph.documentId
// below).
const DOCUMENT_LABELS: Record<string, string> = {
  avfallsforskriften: "Avfallsforskriften",
};

// Shapes a cached LegalParagraph plus its current dispute state into exactly what the UI needs
// to render an inline citation — kept as a pure function so the UI-facing shape can be unit
// tested without a live Supabase paragraph store or corrections store.
export function buildLegalCitationView(paragraph: LegalParagraph, disputed: boolean): LegalCitationView {
  const docLabel = DOCUMENT_LABELS[paragraph.documentId] ?? paragraph.documentId;
  return {
    paragraphId: paragraph.id,
    label: `${docLabel} § ${paragraph.article}-${paragraph.paragraph}`,
    sourceLink: paragraph.sourceLink,
    verifiedAt: paragraph.lastVerifiedAt,
    disputed,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/compliance/citation-view.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/compliance/citation-view.ts tests/compliance/citation-view.test.ts
git commit -m "feat(compliance): add pure LegalCitationView builder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire `legalCitation` into `BkField`/`BkSource`

**Files:**
- Modify: `lib/bk-skjema/form-map.ts`
- Test: `tests/bk-skjema/from-datalab.test.ts` (read first, add to it — do not remove existing
  assertions)

**Interfaces:**
- Consumes: `LegalCitationView` from `lib/compliance/citation-view.ts` (Task 2).
- Produces: `BkField.legalCitation?: LegalCitationView | null`, `BkSource.legalCitations?:
  Record<string, LegalCitationView | null>` — consumed by Task 4 (the UI component) and Task 6
  (real resolution, which populates this map before `buildBkFields` runs).

- [ ] **Step 1: Read the current Checkbox10 entry and its surrounding code**

Run: `grep -n "Checkbox10" lib/bk-skjema/form-map.ts` — confirm it's still the Phase 1 slice's
static-string version (the one with `"Rettslig grunnlag: Avfallsforskriften § 11-4..."` appended
to `note`). This task replaces that static string with a dynamic one built from
`legalCitations`, so the note stays correct if the underlying citation is ever missing (e.g. the
compliance lookup fails — Task 6 handles that fallback) rather than always claiming a citation
that wasn't actually resolved this time.

- [ ] **Step 2: Write the failing test**

Read `tests/bk-skjema/from-datalab.test.ts` first to match its exact import/fixture style before
adding. Add:

```ts
  it("Checkbox10's note includes the real legal citation when one is supplied via legalCitations", () => {
    const source: BkSource = {
      // ...spread whatever this file's existing minimal-fixture helper builds, then override:
      legalCitations: {
        "eal-legal-basis": {
          paragraphId: "no-avfallsforskriften-11-4",
          label: "Avfallsforskriften § 11-4",
          sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
          verifiedAt: "2026-09-03T19:26:14.030Z",
          disputed: false,
        },
      },
    } as BkSource; // cast: fill in this file's real minimal-source fixture fields around it
    const fields = buildBkFields(source);
    const checkbox10 = fields.find(f => f.field === "Checkbox10")!;
    expect(checkbox10.note).toContain("Avfallsforskriften § 11-4");
    expect(checkbox10.legalCitation?.paragraphId).toBe("no-avfallsforskriften-11-4");
  });

  it("Checkbox10 has no legalCitation and a plain note when legalCitations is absent", () => {
    const source: BkSource = { /* ...same minimal fixture, no legalCitations key */ } as BkSource;
    const fields = buildBkFields(source);
    const checkbox10 = fields.find(f => f.field === "Checkbox10")!;
    expect(checkbox10.legalCitation ?? null).toBeNull();
    expect(checkbox10.note).toContain("hazardous substances detected above LOQ");
  });
```

Fill in the two fixture spots (`/* ...spread... */`) using whatever minimal `BkSource` object
this test file's other tests already build — copy that exact pattern rather than inventing a new
one; do not guess field names not already used elsewhere in this file.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — `legalCitations`/`legalCitation` don't exist on the types yet.

- [ ] **Step 4: Add the types and wire Checkbox10**

In `lib/bk-skjema/form-map.ts`, add the import and extend the two interfaces:

```ts
import type { LegalCitationView } from "../compliance/citation-view";
```

In `BkField`, add alongside the existing optional fields:

```ts
  /** A live-verified legal citation grounding this field, when one has been resolved. */
  legalCitation?: LegalCitationView | null;
```

In `BkSource`, add alongside the existing `citations`/`scores` maps:

```ts
  /** Per-field resolved legal citations, keyed by a stable field identifier (e.g. "eal-legal-basis"). */
  legalCitations?: Record<string, LegalCitationView | null>;
```

Replace the Checkbox10 entry (found in Step 1) with:

```ts
    { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived", check: true,
      // Compliance trust model: legalCitation is resolved server-side (see
      // lib/compliance/search.ts + app/api/data-lab/route.ts) and passed in via
      // s.legalCitations["eal-legal-basis"]. The note stays truthful either way: it names the
      // real citation when one was resolved this time, and falls back to the plain classification
      // note when it wasn't (compliance lookup unavailable, or not yet wired for this call site) —
      // never claims a citation that isn't actually attached to this field.
      legalCitation: s.legalCitations?.["eal-legal-basis"] ?? null,
      note: s.legalCitations?.["eal-legal-basis"]
        ? `hazardous substances detected above LOQ, though all below HP thresholds. Rettslig grunnlag: ${s.legalCitations["eal-legal-basis"]!.label}.`
        : "hazardous substances detected above LOQ, though all below HP thresholds" },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — all tests pass, including the pre-existing 103-field-count and
derived-fields-must-cite invariants (this task doesn't touch `citations`, only adds
`legalCitation`, which those two invariants don't check).

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add lib/bk-skjema/form-map.ts tests/bk-skjema/from-datalab.test.ts
git commit -m "feat(compliance): wire legalCitation into BkField/BkSource, Checkbox10 first

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Inline citation UI + "I disagree" action

**Files:**
- Create: `components/data-lab/LegalCitationBadge.tsx`
- Modify: `components/data-lab/FieldsPane.tsx`
- Test: `tests/compliance/legal-citation-badge.test.tsx` (component logic only — see Step 1)

**Interfaces:**
- Consumes: `LegalCitationView` from `lib/compliance/citation-view.ts` (Task 2).
- Produces: `LegalCitationBadge` React component with props `{ citation: LegalCitationView;
  onDispute: (reason: string, raisedBy: string) => Promise<void> }` — consumed by
  `FieldsPane.tsx`, which itself is consumed by whatever page renders it (unmodified beyond this
  task's `FieldsPane.tsx` change).

- [ ] **Step 1: Check this repo's existing component-test conventions before writing one**

Run: `find tests -iname "*.test.tsx" -o -iname "*component*"` and, if any exist, read one to
match the exact testing-library/render setup already in use. If none exist yet, this repo has no
established React component test pattern — in that case, skip the component test file for this
task (do not invent a new testing setup unilaterally) and instead verify `LegalCitationBadge`
manually via `pnpm dev` (Step 6) plus a pure-logic extraction: pull the "should show the disputed
flag" and "reason must be non-empty before submit is enabled" logic into two small, exported pure
functions so at least that part is unit-tested without a component-rendering harness:

```ts
// still inside components/data-lab/LegalCitationBadge.tsx, exported for the pure-logic test below
export function canSubmitDispute(reason: string, raisedBy: string): boolean {
  return reason.trim().length > 0 && raisedBy.trim().length > 0;
}
```

- [ ] **Step 2: Write the failing test for the pure logic**

```ts
// tests/compliance/legal-citation-badge.test.tsx
import { describe, it, expect } from "vitest";
import { canSubmitDispute } from "@/components/data-lab/LegalCitationBadge";

describe("canSubmitDispute", () => {
  it("is false when reason is empty", () => {
    expect(canSubmitDispute("", "Kari Nordmann")).toBe(false);
  });
  it("is false when raisedBy is empty", () => {
    expect(canSubmitDispute("This doesn't apply here", "")).toBe(false);
  });
  it("is false when both are whitespace-only", () => {
    expect(canSubmitDispute("   ", "   ")).toBe(false);
  });
  it("is true when both are non-empty", () => {
    expect(canSubmitDispute("This doesn't apply here", "Kari Nordmann")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/compliance/legal-citation-badge.test.tsx`
Expected: FAIL — `components/data-lab/LegalCitationBadge.tsx` doesn't exist yet.

- [ ] **Step 4: Create `components/data-lab/LegalCitationBadge.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { LegalCitationView } from "@/lib/compliance/citation-view";

export function canSubmitDispute(reason: string, raisedBy: string): boolean {
  return reason.trim().length > 0 && raisedBy.trim().length > 0;
}

/**
 * Inline, non-blocking legal citation display. Trust-by-default: the citation is shown and used
 * without any approval step. The only action available is disputing it — no role gating (this
 * app has no per-user identity yet; see the plan's Global Constraints) — which posts a dispute
 * and never edits any already-frozen record; it only ever adds a new one.
 */
export function LegalCitationBadge({
  citation,
  onDispute,
}: {
  citation: LegalCitationView;
  onDispute: (reason: string, raisedBy: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justDisputed, setJustDisputed] = useState(false);

  const disputed = citation.disputed || justDisputed;

  async function submit() {
    if (!canSubmitDispute(reason, raisedBy)) return;
    setSubmitting(true);
    try {
      await onDispute(reason.trim(), raisedBy.trim());
      setJustDisputed(true);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        {disputed && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800" title="This citation has an unresolved dispute">
            disputed
          </span>
        )}
        <a
          href={citation.sourceLink}
          target="_blank"
          rel="noreferrer"
          className="text-forest/60 underline decoration-dotted underline-offset-2 hover:text-forest"
        >
          {citation.label}
        </a>
        <span className="text-forest/35">verified {new Date(citation.verifiedAt).toLocaleDateString("no-NO")}</span>
        {!disputed && (
          <button type="button" onClick={() => setOpen(v => !v)} className="text-forest/40 underline decoration-dotted hover:text-forest/70">
            I disagree
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-1 rounded-lg border border-forest/15 bg-white/60 p-2">
          <input
            value={raisedBy}
            onChange={e => setRaisedBy(e.target.value)}
            placeholder="Your name"
            className="rounded border border-forest/20 px-1.5 py-1 text-[11px]"
          />
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why doesn't this citation apply here?"
            rows={2}
            className="rounded border border-forest/20 px-1.5 py-1 text-[11px]"
          />
          <button
            type="button"
            disabled={!canSubmitDispute(reason, raisedBy) || submitting}
            onClick={submit}
            className="self-start rounded bg-forest px-2 py-1 text-[11px] text-lime disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit dispute"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/compliance/legal-citation-badge.test.tsx`
Expected: PASS — all 4 tests pass.

- [ ] **Step 6: Wire it into `FieldsPane.tsx`**

In `components/data-lab/FieldsPane.tsx`, add the import:

```tsx
import { LegalCitationBadge } from "./LegalCitationBadge";
```

Add an `onDispute` prop to `FieldsPane`'s props (alongside the existing `onEdit`):

```tsx
  /** Called when a person disputes a field's legal citation. */
  onDispute?: (field: BkField, reason: string, raisedBy: string) => Promise<void>;
```

and thread it through the function signature the same way `onEdit` already is.

Immediately after the existing `{f.note && (...)}` block (the one rendering `f.note` in muted
text), add:

```tsx
                    {f.legalCitation && onDispute && (
                      <LegalCitationBadge
                        citation={f.legalCitation}
                        onDispute={(reason, raisedBy) => onDispute(f, reason, raisedBy)}
                      />
                    )}
```

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 8: Commit**

```bash
git add components/data-lab/LegalCitationBadge.tsx components/data-lab/FieldsPane.tsx tests/compliance/legal-citation-badge.test.tsx
git commit -m "feat(compliance): inline citation badge with non-blocking dispute action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Dispute API route

**Files:**
- Create: `app/api/compliance/disputes/route.ts`
- Test: `tests/compliance/dispute-route.test.ts`
- Modify: whatever page currently renders `FieldsPane` with an `onEdit` handler (find it — see
  Step 1) to also pass `onDispute`, calling this route.

**Interfaces:**
- Consumes: `createSupabaseCorrectionStore`, `CorrectionStore` (Task 1).
- Produces: `POST /api/compliance/disputes` accepting `{ paragraphId: string; freezeId: string |
  null; raisedBy: string; reason: string }`, returning the created `DisputeRecord` as JSON on
  success or `{ error: string }` with a 4xx/5xx status on failure.

- [ ] **Step 1: Find the caller**

Run: `grep -rn "FieldsPane" app/ components/ | grep -v FieldsPane.tsx` to find the page(s)
rendering it with `onEdit`. Read that file's surrounding fetch/error-handling pattern before
writing the route, so the new `onDispute` handler you add there in Step 5 matches the file's
existing conventions (loading state, error display) rather than inventing a new pattern.

- [ ] **Step 2: Write the failing test**

```ts
// tests/compliance/dispute-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/compliance/disputes/route";
import * as corrections from "@/lib/compliance/corrections";

function req(body: unknown) {
  return new Request("http://localhost/api/compliance/disputes", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/compliance/disputes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns 400 when a required field is missing", async () => {
    const res = await POST(req({ paragraphId: "no-avfallsforskriften-11-4" }) as never);
    expect(res.status).toBe(400);
  });

  it("raises a dispute and returns it as JSON on success", async () => {
    vi.spyOn(corrections, "createSupabaseCorrectionStore").mockReturnValue({
      raise: vi.fn().mockResolvedValue({
        id: "dispute-1", freezeId: null, disputedParagraphId: "no-avfallsforskriften-11-4",
        raisedBy: "Kari Nordmann", raisedAt: "2026-09-04T00:00:00.000Z",
        reason: "doesn't apply", resolution: null, correctedParagraphId: null,
        resolvedBy: null, resolvedAt: null,
      }),
      hasUnresolved: vi.fn(),
    });

    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("dispute-1");
    expect(body.disputedParagraphId).toBe("no-avfallsforskriften-11-4");
  });

  it("returns 500 with a clear error when the store throws, never a fabricated success", async () => {
    vi.spyOn(corrections, "createSupabaseCorrectionStore").mockReturnValue({
      raise: vi.fn().mockRejectedValue(new Error("db unreachable")),
      hasUnresolved: vi.fn(),
    });

    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
    }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("db unreachable");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/dispute-route.test.ts`
Expected: FAIL — the route file doesn't exist yet.

- [ ] **Step 4: Create `app/api/compliance/disputes/route.ts`**

```ts
// app/api/compliance/disputes/route.ts
import { NextResponse } from "next/server";
import { createSupabaseCorrectionStore } from "@/lib/compliance/corrections";

interface DisputeRequest {
  paragraphId?: unknown;
  freezeId?: unknown;
  raisedBy?: unknown;
  reason?: unknown;
}

export async function POST(request: Request) {
  let body: DisputeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { paragraphId, freezeId, raisedBy, reason } = body;
  if (typeof paragraphId !== "string" || !paragraphId) {
    return NextResponse.json({ error: "paragraphId is required" }, { status: 400 });
  }
  if (typeof raisedBy !== "string" || !raisedBy.trim()) {
    return NextResponse.json({ error: "raisedBy is required" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  if (freezeId !== null && freezeId !== undefined && typeof freezeId !== "string") {
    return NextResponse.json({ error: "freezeId must be a string or null" }, { status: 400 });
  }

  try {
    const store = createSupabaseCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: paragraphId,
      freezeId: (freezeId as string | undefined) ?? null,
      raisedBy: raisedBy.trim(),
      reason: reason.trim(),
    });
    return NextResponse.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Wire `onDispute` into the caller found in Step 1**

Using the exact fetch/error-handling pattern that file already uses for its other handlers (e.g.
`onEdit`), add an `onDispute` handler passed to `FieldsPane`:

```tsx
async function handleDispute(field: BkField, reason: string, raisedBy: string) {
  if (!field.legalCitation) return;
  const res = await fetch("/api/compliance/disputes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paragraphId: field.legalCitation.paragraphId,
      freezeId: null, // this call site disputes at fill time, before any freeze exists
      raisedBy,
      reason,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error ?? "Could not submit dispute");
  }
}
```

Match this file's existing error-surfacing convention (found in Step 1) for how the thrown error
reaches the user — don't invent a new error-display pattern if one already exists.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/dispute-route.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 8: Commit**

```bash
git add app/api/compliance/disputes/route.ts tests/compliance/dispute-route.test.ts <the Step 1/5 caller file>
git commit -m "feat(compliance): add dispute API route and wire it into the fill-time UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Real resolution in the Datalab pipeline, with a safe fallback

**Files:**
- Modify: `app/api/data-lab/route.ts`
- Test: `tests/compliance/resolve-legal-citations.test.ts`
- Create: `lib/compliance/resolve-legal-citations.ts`

**Interfaces:**
- Consumes: `search` + a `ParagraphStore`/`LegalSource` pair (Phase 1), `hasUnresolvedDispute`
  (this plan's `CorrectionStore`, Task 1), `buildLegalCitationView` (Task 2).
- Produces: `export async function resolveLegalCitations(store: ParagraphStore, source:
  LegalSource, corrections: CorrectionStore): Promise<Record<string, LegalCitationView | null>>`
  — consumed only by `app/api/data-lab/route.ts` in this task; the return shape matches
  `BkSource.legalCitations` exactly (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// tests/compliance/resolve-legal-citations.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveLegalCitations } from "@/lib/compliance/resolve-legal-citations";
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalParagraph } from "@/lib/compliance/types";

vi.mock("@/lib/compliance/embeddings", () => ({ embedText: vi.fn().mockResolvedValue([0.1]) }));

const paragraph: LegalParagraph = {
  id: "no-avfallsforskriften-11-4", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "11", paragraph: "4",
  text: "farlig avfall skal håndteres forsvarlig", inForce: true,
  lastVerifiedAt: new Date().toISOString(), lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
};

function fakeStore(rows: LegalParagraph[]): ParagraphStore {
  return {
    async findByLocation(d, a, p) { return rows.find(r => r.documentId === d && r.article === a && r.paragraph === p) ?? null; },
    async hybridSearch() { throw new Error("not used in this test"); },
    async insert() {},
  };
}

describe("resolveLegalCitations", () => {
  it("resolves eal-legal-basis to the seeded § 11-4 citation, not disputed, on a cache hit", async () => {
    const store = fakeStore([paragraph]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]?.paragraphId).toBe("no-avfallsforskriften-11-4");
    expect(result["eal-legal-basis"]?.disputed).toBe(false);
  });

  it("marks the citation disputed when CorrectionStore reports an unresolved dispute", async () => {
    const store = fakeStore([paragraph]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(true) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]?.disputed).toBe(true);
  });

  it("returns eal-legal-basis: null, never throws, when the underlying search fails", async () => {
    const store: ParagraphStore = {
      async findByLocation() { throw new Error("supabase unreachable"); },
      async hybridSearch() { throw new Error("not used"); },
      async insert() {},
    };
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn() };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Create `lib/compliance/resolve-legal-citations.ts`**

```ts
// lib/compliance/resolve-legal-citations.ts
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalCitationView } from "@/lib/compliance/citation-view";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import { search } from "@/lib/compliance/search";

// The one field this slice grounds. Extending this to more fields is real, deliberate future
// work (Known follow-ups) — do not silently expand this list without also updating BkField's
// callers in form-map.ts.
const RESOLVED_FIELDS: { key: string; documentId: string; article: string; paragraph: string; queryText: string }[] = [
  { key: "eal-legal-basis", documentId: "avfallsforskriften", article: "11", paragraph: "4", queryText: "farlig avfall håndtering" },
];

// Resolves every field this slice grounds into a real, live-verified citation, checking dispute
// state for each. A failure anywhere in the compliance layer (Supabase down, Voyage down, a
// genuine no_match) degrades that one field to null rather than throwing — the surrounding
// extraction pipeline must never break because the compliance layer had a bad day. Callers that
// want the field's plain, uncited note (Task 3's fallback in form-map.ts) get exactly that when
// a key is null here.
export async function resolveLegalCitations(
  store: ParagraphStore,
  source: LegalSource,
  corrections: CorrectionStore
): Promise<Record<string, LegalCitationView | null>> {
  const result: Record<string, LegalCitationView | null> = {};
  for (const field of RESOLVED_FIELDS) {
    try {
      const grounded = await search(store, source, {
        queryText: field.queryText,
        documentId: field.documentId,
        article: field.article,
        paragraph: field.paragraph,
      });
      if (!grounded.paragraph) {
        result[field.key] = null;
        continue;
      }
      const disputed = await corrections.hasUnresolved(grounded.paragraph.id);
      result[field.key] = buildLegalCitationView(grounded.paragraph, disputed);
    } catch {
      // Never let a compliance-layer failure break the surrounding extraction pipeline.
      result[field.key] = null;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Wire it into `app/api/data-lab/route.ts`**

Read the route's current structure around where `analyseBundle`/`bkFromDatalab` produces each
sub-report's fields and is sent as an event (`send({...})`). Immediately before that send, add:

```ts
import { resolveLegalCitations } from "@/lib/compliance/resolve-legal-citations";
import { LovdataSource } from "@/lib/compliance/sources/lovdata-source";
import { createSupabaseParagraphStore } from "@/lib/compliance/store";
import { createSupabaseCorrectionStore } from "@/lib/compliance/corrections";
```

and, for each sub-report's `fields` array right before it's sent, merge in the resolved
citation onto whichever field carries it (Checkbox10 in this slice — matching Task 3's
`s.legalCitations["eal-legal-basis"]` lookup key):

```ts
const legalCitations = await resolveLegalCitations(
  createSupabaseParagraphStore(),
  new LovdataSource(),
  createSupabaseCorrectionStore()
);
const checkbox10 = fields.find(f => f.field === "Checkbox10");
if (checkbox10 && legalCitations["eal-legal-basis"]) {
  checkbox10.legalCitation = legalCitations["eal-legal-basis"];
  checkbox10.note = `hazardous substances detected above LOQ, though all below HP thresholds. Rettslig grunnlag: ${legalCitations["eal-legal-basis"]!.label}.`;
}
```

Match the route's real variable names for `fields` and the send call at the actual call site —
read the surrounding code first rather than guessing exact identifiers.

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 7: Manual verification**

Run `pnpm dev`, upload a real waste characterization report through the wizard/Data Lab flow,
and confirm on the resulting BK-skjema: Checkbox10 shows the live citation badge (label, verified
date, source link) rather than the Task 3 fallback plain note — this requires real
`SUPABASE_SERVICE_ROLE_KEY`/`VOYAGE_API_KEY`/`DATALAB_API_KEY` credentials in `.env.local`.
Confirm clicking "I disagree," filling in a name and reason, and submitting shows the "disputed"
flag appear on that badge without a page reload.

- [ ] **Step 8: Update the Phase 1 plan's Known follow-ups**

In `docs/superpowers/plans/2026-09-03-compliance-cache-phase1-slice.md`, find follow-up item 3
(the `BkField` prose-only-citation gap) and mark it resolved, dated, with a one-line pointer to
this plan — following the same `~~struck-through~~ **RESOLVED**` pattern already used for item 5
in that file.

- [ ] **Step 9: Commit**

```bash
git add lib/compliance/resolve-legal-citations.ts tests/compliance/resolve-legal-citations.test.ts app/api/data-lab/route.ts docs/superpowers/plans/2026-09-03-compliance-cache-phase1-slice.md
git commit -m "feat(compliance): resolve real legal citations in the Datalab pipeline

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Known follow-ups this plan surfaces but does not resolve

1. **No real role gating on disputes** (Global Constraints, disclosed deliberately) — anyone with
   app access can raise a dispute; real gating needs real per-user identity, which doesn't exist
   in this app yet.
2. **Dispute resolution UI doesn't exist.** `CorrectionStore` supports resolving a dispute
   (`resolution`/`correctedParagraphId`/`resolvedBy`/`resolvedAt` columns exist), but no task in
   this plan builds a UI for a compliance person to actually resolve one — disputes can be raised
   but not yet closed out except by direct database access.
3. **Only one field (`eal-legal-basis`/Checkbox10) is grounded.** `RESOLVED_FIELDS` in
   `resolve-legal-citations.ts` is a list of exactly one entry by design (matches the Phase 1
   slice's single-seeded-paragraph scope) — extending to more fields needs both more seeded
   paragraphs (Phase 1's own follow-up) and more entries here.
4. **The aggregated "legal basis used" list (spec UI surface #2) and the corrections-aware
   view on frozen records are both out of scope for this plan** — spec explicitly parked #2, and
   nothing here renders a correction record against a `compliance_form_freezes` row in the UI yet
   (the data model supports it; the view doesn't exist).
