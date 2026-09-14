# Dispute Scoping by Resolved-Field Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dispute be scoped to (paragraph, resolved-field key) instead of paragraph alone, so a reviewer disputing § 9-6's use as `"deponi-category-basis"` no longer also marks its unrelated use as `"hazard-indeterminate-basis"` disputed.

**Architecture:** Thread a new required `citedFieldKey` string through the entire dispute path: schema → `CorrectionStore` interface → `resolveLegalCitations`'s dispute check → `BkField`'s new `legalCitationKey` → the dispute API route → the UI's `handleDispute`. The `compliance_corrections` table is confirmed empty in production, so the new column is `NOT NULL` from day one — no legacy-data migration path needed.

**Tech Stack:** TypeScript, Vitest, Supabase (Postgres migration), Next.js API route.

## Global Constraints

- `compliance_corrections` is confirmed EMPTY in production (verified via direct SQL query) — the new `cited_field_key` column is `NOT NULL`, no default, no backfill logic anywhere in this plan.
- This whole plan lands on one branch and merges/deploys as ONE unit — do NOT deploy or merge after only Task 1 (the schema migration) completes on its own; the migration and the code that actually sends `citedFieldKey` (Task 4) must ship together, since a `raise()` call between those two points would hard-fail on the `NOT NULL` constraint.
- Only separates disputes ACROSS different `RESOLVED_FIELDS` keys that happen to cite the same paragraph. Multiple checkboxes intentionally sharing ONE key's citation (e.g. Checkbox1/3/4/6 sharing `"deponi-category-basis"`) is correct, existing, unchanged behavior — never split within one key.
- The dispute API route validates `citedFieldKey` against the real, single source of truth (`RESOLVED_FIELD_KEYS`, derived from `RESOLVED_FIELDS`, not a second hand-maintained list) — an unrecognized key is a 400, never silently stored.
- No UI is added to surface `citedFieldKey` to a reviewer browsing disputes — no such read-side screen exists yet to extend.

---

## Task 1: Schema migration and CorrectionStore interface

**Files:**
- Create: `supabase/migrations/20260906000000_compliance_corrections_field_key.sql`
- Modify: `lib/compliance/corrections.ts`
- Test: `tests/compliance/corrections.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DisputeRecord.citedFieldKey: string`; `CorrectionStore.raise(args: {..., citedFieldKey: string})`; `CorrectionStore.hasUnresolved(paragraphId: string, fieldKey: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Modify `tests/compliance/corrections.test.ts` — update `createInMemoryCorrectionStore` and every existing test to carry `citedFieldKey`, and add new tests proving field-key scoping:

```typescript
// tests/compliance/corrections.test.ts
import { describe, it, expect } from "vitest";
import type { CorrectionStore, DisputeRecord } from "@/lib/compliance/corrections";

// In-memory double, reused by tests/compliance/dispute-route.test.ts (Task 4) as a test double
// for live Supabase — same role as store.test.ts's in-memory ParagraphStore in the Phase 1 plan.
export function createInMemoryCorrectionStore(seed: DisputeRecord[] = []): CorrectionStore {
  const rows = [...seed];
  return {
    async raise(args) {
      const record: DisputeRecord = {
        id: `dispute-${rows.length + 1}`,
        freezeId: args.freezeId,
        disputedParagraphId: args.disputedParagraphId,
        citedFieldKey: args.citedFieldKey,
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
    async hasUnresolved(paragraphId, fieldKey) {
      return rows.some(r =>
        r.disputedParagraphId === paragraphId && r.citedFieldKey === fieldKey && r.resolution === null
      );
    },
  };
}

describe("CorrectionStore interface (via in-memory implementation)", () => {
  it("raise() creates a record with resolution null and returns it", async () => {
    const store = createInMemoryCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      citedFieldKey: "eal-legal-basis",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "This waste stream doesn't match § 11-4's scope",
    });
    expect(record.resolution).toBeNull();
    expect(record.disputedParagraphId).toBe("no-avfallsforskriften-11-4");
    expect(record.citedFieldKey).toBe("eal-legal-basis");
    expect(record.freezeId).toBeNull();
  });

  it("hasUnresolved is true right after a dispute is raised, for the same paragraph AND field key", async () => {
    const store = createInMemoryCorrectionStore();
    await store.raise({
      disputedParagraphId: "no-avfallsforskriften-9-6",
      citedFieldKey: "deponi-category-basis",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    expect(await store.hasUnresolved("no-avfallsforskriften-9-6", "deponi-category-basis")).toBe(true);
  });

  it("hasUnresolved is false for the same paragraph under a DIFFERENT field key (the real fix this plan makes)", async () => {
    const store = createInMemoryCorrectionStore();
    await store.raise({
      disputedParagraphId: "no-avfallsforskriften-9-6",
      citedFieldKey: "deponi-category-basis",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    // Same paragraph § 9-6, but disputed only as "deponi-category-basis" — its OTHER real use as
    // "hazard-indeterminate-basis" must not be affected.
    expect(await store.hasUnresolved("no-avfallsforskriften-9-6", "hazard-indeterminate-basis")).toBe(false);
  });

  it("hasUnresolved is false for a paragraph with no disputes at all", async () => {
    const store = createInMemoryCorrectionStore();
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4", "eal-legal-basis")).toBe(false);
  });

  it("hasUnresolved is false once every dispute on that (paragraph, field key) pair is resolved", async () => {
    const resolved: DisputeRecord = {
      id: "dispute-1",
      freezeId: null,
      disputedParagraphId: "no-avfallsforskriften-11-4",
      citedFieldKey: "eal-legal-basis",
      raisedBy: "Kari Nordmann",
      raisedAt: new Date().toISOString(),
      reason: "reason",
      resolution: "upheld",
      correctedParagraphId: null,
      resolvedBy: "Ola Compliance",
      resolvedAt: new Date().toISOString(),
    };
    const store = createInMemoryCorrectionStore([resolved]);
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4", "eal-legal-basis")).toBe(false);
  });

  it("a dispute can carry a real freezeId when one already exists for the citation", async () => {
    const store = createInMemoryCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      citedFieldKey: "eal-legal-basis",
      freezeId: "freeze-abc-123",
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    expect(record.freezeId).toBe("freeze-abc-123");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/corrections.test.ts`
Expected: FAIL — `citedFieldKey` doesn't exist on `DisputeRecord`/`raise`'s args yet, and `hasUnresolved` doesn't accept a second argument (TypeScript compile error surfacing as a test failure).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260906000000_compliance_corrections_field_key.sql`:

```sql
-- supabase/migrations/20260906000000_compliance_corrections_field_key.sql
--
-- compliance_corrections is confirmed EMPTY in production (verified via direct query,
-- 2026-09-06) — no legacy rows, so this column is NOT NULL with no default and no backfill.
alter table compliance_corrections
  add column cited_field_key text not null;

create index compliance_corrections_paragraph_field_idx
  on compliance_corrections (disputed_paragraph_id, cited_field_key);
```

- [ ] **Step 4: Update `lib/compliance/corrections.ts`**

```typescript
// lib/compliance/corrections.ts
import { createClient } from "@supabase/supabase-js";

export interface DisputeRecord {
  id: string;
  freezeId: string | null;
  disputedParagraphId: string;
  citedFieldKey: string;
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
    citedFieldKey: string;
    freezeId: string | null;
    raisedBy: string;
    reason: string;
  }): Promise<DisputeRecord>;
  hasUnresolved(paragraphId: string, fieldKey: string): Promise<boolean>;
}

interface Row {
  id: string;
  freeze_id: string | null;
  disputed_paragraph_id: string;
  cited_field_key: string;
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
    citedFieldKey: row.cited_field_key,
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
          cited_field_key: args.citedFieldKey,
          raised_by: args.raisedBy,
          reason: args.reason,
        } as never)
        .select()
        .single();
      if (error) throw new Error(`raise dispute failed: ${error.message}`);
      return rowToRecord(data as Row);
    },

    async hasUnresolved(paragraphId, fieldKey) {
      const { data, error } = await client
        .from("compliance_corrections")
        .select("id")
        .eq("disputed_paragraph_id", paragraphId)
        .eq("cited_field_key", fieldKey)
        .is("resolution", null)
        .limit(1);
      if (error) throw new Error(`hasUnresolved check failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/corrections.test.ts`
Expected: PASS — all tests, including the two new field-key-scoping tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906000000_compliance_corrections_field_key.sql lib/compliance/corrections.ts tests/compliance/corrections.test.ts
git commit -m "feat: scope disputes by (paragraphId, citedFieldKey) instead of paragraphId alone

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Run the real migration against the live Supabase project**

Use the Supabase MCP tool (`mcp__4cb1564a-c04a-4cb1-9d6f-71b8b991fa4b__apply_migration`) against project `zrexxdnlonleijhlmnjp` with the exact SQL from Step 3 (name: `compliance_corrections_field_key`).

- [ ] **Step 8: Verify the schema change via a direct query**

```sql
select column_name, is_nullable, data_type from information_schema.columns
where table_name = 'compliance_corrections' and column_name = 'cited_field_key';
```

Expected: one row, `is_nullable = 'NO'`, `data_type = 'text'`.

---

## Task 2: Wire the field key through resolveLegalCitations, and export RESOLVED_FIELD_KEYS

**Files:**
- Modify: `lib/compliance/resolve-legal-citations.ts`
- Test: `tests/compliance/resolve-legal-citations.test.ts`

**Interfaces:**
- Consumes: `CorrectionStore.hasUnresolved(paragraphId, fieldKey)` (Task 1).
- Produces: `resolveLegalCitations` now calls `hasUnresolved(paragraph.id, field.key)` (was `hasUnresolved(paragraph.id)`). New export: `RESOLVED_FIELD_KEYS: string[]` (derived from `RESOLVED_FIELDS`), for Task 4's server-side validation to import.

- [ ] **Step 1: Write the failing test**

Add to `tests/compliance/resolve-legal-citations.test.ts`, replacing the existing `"checks dispute status independently per paragraph within a multi-location field"` test (it currently asserts `hasUnresolved` is called with one argument — it must now be called with two, and the fake mock's signature needs updating):

```typescript
  it("checks dispute status independently per (paragraph, field key) within a multi-location field", async () => {
    const store = fakeStore([p11_4, p9_5, p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = {
      raise: vi.fn(),
      hasUnresolved: vi.fn().mockImplementation(
        async (paragraphId: string, fieldKey: string) =>
          paragraphId === "no-avfallsforskriften-9-6" && fieldKey === "deponi-category-basis"
      ),
    };

    const result = await resolveLegalCitations(store, source, corrections);
    const citations = result["deponi-category-basis"]?.citations ?? [];
    expect(citations.find(c => c.paragraphId === "no-avfallsforskriften-9-5")?.disputed).toBe(false);
    expect(citations.find(c => c.paragraphId === "no-avfallsforskriften-9-6")?.disputed).toBe(true);
  });

  it("the SAME paragraph disputed under one field key does not affect its citation under a DIFFERENT field key", async () => {
    const store = fakeStore([p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = {
      raise: vi.fn(),
      // § 9-6 is disputed as "deponi-category-basis" ONLY — its "hazard-indeterminate-basis" use
      // (a different RESOLVED_FIELDS key reusing the same paragraph) must show disputed: false.
      hasUnresolved: vi.fn().mockImplementation(
        async (paragraphId: string, fieldKey: string) =>
          paragraphId === "no-avfallsforskriften-9-6" && fieldKey === "deponi-category-basis"
      ),
    };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hazard-indeterminate-basis"]?.citations[0]?.disputed).toBe(false);
  });

  it("exports RESOLVED_FIELD_KEYS matching every real RESOLVED_FIELDS entry, as the single source of truth", async () => {
    const { RESOLVED_FIELD_KEYS } = await import("@/lib/compliance/resolve-legal-citations");
    expect(RESOLVED_FIELD_KEYS).toEqual(
      expect.arrayContaining(["eal-legal-basis", "deponi-category-basis", "hazard-indeterminate-basis", "hp-methodology-basis"])
    );
    expect(RESOLVED_FIELD_KEYS).toHaveLength(4);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: FAIL — `hasUnresolved` is still called with one argument in the source, and `RESOLVED_FIELD_KEYS` doesn't exist yet.

- [ ] **Step 3: Wire `field.key` through and export `RESOLVED_FIELD_KEYS`**

In `lib/compliance/resolve-legal-citations.ts`, modify the single call site:

```typescript
      const disputedByParagraphId: Record<string, boolean> = {};
      for (const { paragraph } of resolved) {
        disputedByParagraphId[paragraph.id] = await corrections.hasUnresolved(paragraph.id, field.key);
      }
```

(This is the only line inside `resolveLegalCitations`'s outer `for (const field of RESOLVED_FIELDS)` loop that calls `hasUnresolved` — `field.key` is already in scope there.)

Add this export near the `RESOLVED_FIELDS` declaration (after it, so `RESOLVED_FIELDS` is already defined):

```typescript
// Single source of truth for every valid dispute-scoping key — Task 4's dispute API route
// validates a caller-supplied citedFieldKey against this list, so an unrecognized/mistyped key
// is rejected rather than silently stored as an orphaned, unmatchable dispute.
export const RESOLVED_FIELD_KEYS: string[] = RESOLVED_FIELDS.map(f => f.key);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: PASS — all tests, including the two updated/new dispute-scoping tests and the `RESOLVED_FIELD_KEYS` export test.

- [ ] **Step 5: Commit**

```bash
git add lib/compliance/resolve-legal-citations.ts tests/compliance/resolve-legal-citations.test.ts
git commit -m "feat: check dispute status per (paragraph, field key), export RESOLVED_FIELD_KEYS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Attach legalCitationKey to every citation-bearing BkField

**Files:**
- Modify: `lib/bk-skjema/form-map.ts`
- Test: `tests/bk-skjema/from-datalab.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses `s.legalCitations` (unchanged), `s.isHazardous` (unchanged).
- Produces: `BkField` gains `legalCitationKey?: string`, set on Checkbox1/3/4/6/10 and TextField38 alongside their existing `legalCitation`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bk-skjema/from-datalab.test.ts`, after the existing `"TextField38 has no legalCitation when hp-methodology-basis wasn't resolved"` test:

```typescript
  it("every citation-bearing field carries the correct legalCitationKey alongside its legalCitation", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);

    const nonHazardous: BkSource = { ...source, isHazardous: false };
    const nonHazardousFields = buildBkFields(nonHazardous);
    expect(nonHazardousFields.find(f => f.field === "Checkbox1")!.legalCitationKey).toBe("deponi-category-basis");
    expect(nonHazardousFields.find(f => f.field === "Checkbox3")!.legalCitationKey).toBe("deponi-category-basis");
    expect(nonHazardousFields.find(f => f.field === "Checkbox4")!.legalCitationKey).toBe("deponi-category-basis");
    expect(nonHazardousFields.find(f => f.field === "Checkbox6")!.legalCitationKey).toBe("deponi-category-basis");

    const indeterminate: BkSource = { ...source, isHazardous: null };
    const indeterminateFields = buildBkFields(indeterminate);
    expect(indeterminateFields.find(f => f.field === "Checkbox1")!.legalCitationKey).toBe("hazard-indeterminate-basis");
    expect(indeterminateFields.find(f => f.field === "Checkbox3")!.legalCitationKey).toBe("hazard-indeterminate-basis");
    expect(indeterminateFields.find(f => f.field === "Checkbox4")!.legalCitationKey).toBe("hazard-indeterminate-basis");
    expect(indeterminateFields.find(f => f.field === "Checkbox6")!.legalCitationKey).toBe("hazard-indeterminate-basis");

    const fields = buildBkFields(source);
    expect(fields.find(f => f.field === "Checkbox10")!.legalCitationKey).toBe("eal-legal-basis");
    expect(fields.find(f => f.field === "TextField38")!.legalCitationKey).toBe("hp-methodology-basis");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — `legalCitationKey` is `undefined` on every field.

- [ ] **Step 3: Add `legalCitationKey` to `BkField` and set it on every citation-bearing site**

In `lib/bk-skjema/form-map.ts`, modify the `BkField` interface:

```typescript
  /** A live-verified legal citation grounding this field, when one has been resolved. */
  legalCitation?: LegalCitationView | null;
  /** The RESOLVED_FIELDS key this field's legalCitation came from — lets a dispute raised on
   * this field be scoped to exactly this key, not every field/context sharing the cited
   * paragraph. Set alongside legalCitation on every field that has one. */
  legalCitationKey?: string;
```

Then modify each of the five existing sites (find the exact lines by searching for `legalCitation:` in this file — six occurrences, three of them are the repeated Checkbox1/4/6 ternary, one is Checkbox3's inline version, one is Checkbox10, one is TextField38):

Checkbox1 (currently a single ternary expression) — refactor to compute the key once:
```typescript
    { field: "Checkbox1", label: "Deponi for ordinært avfall", src: "derived",
      check: s.isHazardous === null ? false : !s.isHazardous,
      // Same shared citation as Checkbox2/3 — see the comment on Checkbox3 below for why.
      legalCitation: s.isHazardous === null ? (s.legalCitations?.["hazard-indeterminate-basis"] ?? null) : (s.legalCitations?.["deponi-category-basis"] ?? null),
      legalCitationKey: s.isHazardous === null ? "hazard-indeterminate-basis" : "deponi-category-basis",
      note: s.isHazardous === null ? s.hazardConfidenceFlags?.[0] : "CONSERVATIVE: inert cannot be claimed without a leaching test" },
```

Checkbox3:
```typescript
    { field: "Checkbox3", label: "Deponi for farlig avfall", src: "derived", check: s.isHazardous === true,
      legalCitation: s.isHazardous === null ? (s.legalCitations?.["hazard-indeterminate-basis"] ?? null) : (s.legalCitations?.["deponi-category-basis"] ?? null),
      legalCitationKey: s.isHazardous === null ? "hazard-indeterminate-basis" : "deponi-category-basis" },
```

Checkbox4:
```typescript
    { field: "Checkbox4", label: "Avfallstype: Ordinært avfall", src: "derived",
      check: s.isHazardous === null ? false : !s.isHazardous,
      legalCitation: s.isHazardous === null ? (s.legalCitations?.["hazard-indeterminate-basis"] ?? null) : (s.legalCitations?.["deponi-category-basis"] ?? null),
      legalCitationKey: s.isHazardous === null ? "hazard-indeterminate-basis" : "deponi-category-basis",
      note: s.isHazardous === null ? s.hazardConfidenceFlags?.[0] : undefined },
```

Checkbox6:
```typescript
    { field: "Checkbox6", label: "Avfallstype: Farlig avfall", src: "derived", check: s.isHazardous === true,
      legalCitation: s.isHazardous === null ? (s.legalCitations?.["hazard-indeterminate-basis"] ?? null) : (s.legalCitations?.["deponi-category-basis"] ?? null),
      legalCitationKey: s.isHazardous === null ? "hazard-indeterminate-basis" : "deponi-category-basis",
      note: s.isHazardous === null ? s.hazardConfidenceFlags?.[0] : undefined },
```

Checkbox10 (single-key site — literal string, no ternary):
```typescript
      legalCitation: s.legalCitations?.["eal-legal-basis"] ?? null,
      legalCitationKey: "eal-legal-basis",
```
(Insert this new line immediately after the existing `legalCitation:` line in Checkbox10's object — do not otherwise change Checkbox10's structure, e.g. its `note` line stays exactly as it is today.)

TextField38 (single-key site):
```typescript
    { field: "TextField38", label: "Beskriv avfallet og hvordan det oppstår", src: "derived", value: buildDescription(s),
      legalCitation: s.legalCitations?.["hp-methodology-basis"] ?? null,
      legalCitationKey: "hp-methodology-basis" },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — the new test plus every pre-existing test in this file (this is purely additive — no existing field's `check`/`legalCitation`/`note` values change).

- [ ] **Step 5: Commit**

```bash
git add lib/bk-skjema/form-map.ts tests/bk-skjema/from-datalab.test.ts
git commit -m "feat: attach legalCitationKey to every citation-bearing BkField

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Dispute API route validation and UI wiring

**Files:**
- Modify: `app/api/compliance/disputes/route.ts`
- Modify: `app/data-lab/page.tsx`
- Test: `tests/compliance/dispute-route.test.ts`

**Interfaces:**
- Consumes: `RESOLVED_FIELD_KEYS` (Task 2), `CorrectionStore.raise` with `citedFieldKey` (Task 1), `BkField.legalCitationKey` (Task 3).
- Produces: no new exports — this is the terminal task wiring everything together end-to-end.

- [ ] **Step 1: Write the failing tests**

Modify `tests/compliance/dispute-route.test.ts` — every existing request body needs a `citedFieldKey` added, and two new tests cover the new validation:

```typescript
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

  it("returns 400 when citedFieldKey is missing", async () => {
    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
    }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when citedFieldKey isn't a real RESOLVED_FIELDS key", async () => {
    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
      citedFieldKey: "not-a-real-key",
    }) as never);
    expect(res.status).toBe(400);
  });

  it("raises a dispute and returns it as JSON on success", async () => {
    vi.spyOn(corrections, "createSupabaseCorrectionStore").mockReturnValue({
      raise: vi.fn().mockResolvedValue({
        id: "dispute-1", freezeId: null, disputedParagraphId: "no-avfallsforskriften-11-4",
        citedFieldKey: "eal-legal-basis",
        raisedBy: "Kari Nordmann", raisedAt: "2026-09-04T00:00:00.000Z",
        reason: "doesn't apply", resolution: null, correctedParagraphId: null,
        resolvedBy: null, resolvedAt: null,
      }),
      hasUnresolved: vi.fn(),
    });

    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
      citedFieldKey: "eal-legal-basis",
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("dispute-1");
    expect(body.disputedParagraphId).toBe("no-avfallsforskriften-11-4");
    expect(body.citedFieldKey).toBe("eal-legal-basis");
  });

  it("returns 500 with a clear error when the store throws, never a fabricated success", async () => {
    vi.spyOn(corrections, "createSupabaseCorrectionStore").mockReturnValue({
      raise: vi.fn().mockRejectedValue(new Error("db unreachable")),
      hasUnresolved: vi.fn(),
    });

    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
      citedFieldKey: "eal-legal-basis",
    }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("db unreachable");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/dispute-route.test.ts`
Expected: FAIL — the route doesn't validate/accept `citedFieldKey` yet, so the "missing"/"not a real key" tests get a 200 or the wrong status, and the "success" test's assertion on `body.citedFieldKey` fails.

- [ ] **Step 3: Update the route**

Replace `app/api/compliance/disputes/route.ts` entirely:

```typescript
import { NextResponse } from "next/server";
import { createSupabaseCorrectionStore } from "@/lib/compliance/corrections";
import { RESOLVED_FIELD_KEYS } from "@/lib/compliance/resolve-legal-citations";

interface DisputeRequest {
  paragraphId?: unknown;
  citedFieldKey?: unknown;
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

  const { paragraphId, citedFieldKey, freezeId, raisedBy, reason } = body;
  if (typeof paragraphId !== "string" || !paragraphId) {
    return NextResponse.json({ error: "paragraphId is required" }, { status: 400 });
  }
  if (typeof citedFieldKey !== "string" || !citedFieldKey) {
    return NextResponse.json({ error: "citedFieldKey is required" }, { status: 400 });
  }
  if (!RESOLVED_FIELD_KEYS.includes(citedFieldKey)) {
    return NextResponse.json({ error: `citedFieldKey "${citedFieldKey}" is not a recognized field key` }, { status: 400 });
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
      citedFieldKey,
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

- [ ] **Step 4: Update `handleDispute` in `app/data-lab/page.tsx`**

Replace the existing `handleDispute` function:

```typescript
  async function handleDispute(field: BkField, reason: string, raisedBy: string) {
    if (!field.legalCitation) return;
    if (!field.legalCitationKey) {
      setError("This citation has no associated field key — cannot raise a scoped dispute.");
      throw new Error("legalCitationKey missing");
    }
    const primary = field.legalCitation.citations.find(c => c.primary) ?? field.legalCitation.citations[0];
    if (!primary) return;
    let res: Response;
    try {
      res = await fetch("/api/compliance/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paragraphId: primary.paragraphId,
          citedFieldKey: field.legalCitationKey,
          freezeId: null, // this call site disputes at fill time, before any freeze exists
          raisedBy,
          reason,
        }),
      });
    } catch {
      const message = "Could not reach the compliance service. Check your connection and try again.";
      setError(message);
      throw new Error(message);
    }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const message = json.error ?? `The request failed (${res.status}).`;
      setError(message);
      throw new Error(message);
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/dispute-route.test.ts`
Expected: PASS — all tests, including the two new validation tests.

- [ ] **Step 6: Run the full test suite and build**

Run: `npx vitest run`
Expected: same pre-existing/unrelated failures as before this plan (missing `DATALAB_API_KEY`/Anthropic auth in `bk/*.test.ts`), everything else green.

Run: `pnpm build`
Expected: clean — this task touches a client component (`app/data-lab/page.tsx`); confirm no type errors surface there.

- [ ] **Step 7: Commit**

```bash
git add app/api/compliance/disputes/route.ts app/data-lab/page.tsx tests/compliance/dispute-route.test.ts
git commit -m "feat: validate and thread citedFieldKey through the dispute API route and UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## Known follow-ups (not built in this plan, disclosed per the spec)

- No UI surfaces `citedFieldKey` to a reviewer browsing past disputes — no such read-side screen exists yet to extend.
- Disputes remain all-or-nothing WITHIN one `RESOLVED_FIELDS` key's shared citation (e.g. Checkbox1/3/4/6 sharing `"deponi-category-basis"`) — that sharing is intentional and unchanged.
