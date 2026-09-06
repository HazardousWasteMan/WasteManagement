# Enable RLS on Compliance Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable row-level security on `legal_paragraphs`, `compliance_form_freezes`, and `compliance_corrections`, with zero policies, closing the current anon/authenticated exposure with no change to this app's behavior.

**Architecture:** One migration, three `alter table ... enable row level security` statements. No policies, since `service_role` (the only role this codebase ever uses) bypasses RLS by default.

**Tech Stack:** Supabase (Postgres migration).

## Global Constraints

- No policies are added on any of the three tables — deny-by-default for `anon`/`authenticated`, confirmed to be a no-op for `service_role` (has `rolbypassrls = true`, confirmed via direct query).
- Every Supabase client in this codebase uses `SUPABASE_SERVICE_ROLE_KEY` exclusively (confirmed via repo-wide grep of `lib/compliance/store.ts`, `freeze.ts`, `corrections.ts`) — this task must not add any anon-key usage anywhere.

---

## Task 1: Enable RLS on all three compliance tables

**Files:**
- Create: `supabase/migrations/20260906000001_enable_rls_compliance_tables.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable — this is a database-only change with no application code interface.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260906000001_enable_rls_compliance_tables.sql`:

```sql
-- supabase/migrations/20260906000001_enable_rls_compliance_tables.sql
--
-- Confirmed via direct query (2026-09-06): service_role has rolbypassrls = true; anon and
-- authenticated do not. Every Supabase client in this codebase (lib/compliance/store.ts,
-- freeze.ts, corrections.ts) uses SUPABASE_SERVICE_ROLE_KEY exclusively — no anon/publishable
-- key is ever created or used anywhere in this repo. Enabling RLS with zero policies is
-- therefore a no-op for every existing code path, while closing the real gap: these tables
-- were previously readable/writable by anyone holding the project's anon key via Supabase's
-- public REST API, entirely bypassing this application's server code.
alter table legal_paragraphs enable row level security;
alter table compliance_form_freezes enable row level security;
alter table compliance_corrections enable row level security;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use the Supabase MCP tool (`mcp__4cb1564a-c04a-4cb1-9d6f-71b8b991fa4b__apply_migration`) against project `zrexxdnlonleijhlmnjp`, with the exact SQL above (name: `enable_rls_compliance_tables`).

- [ ] **Step 3: Verify via direct query**

Run:

```sql
select tablename, rowsecurity from pg_tables
where tablename in ('legal_paragraphs', 'compliance_form_freezes', 'compliance_corrections');
```

Expected: all three rows show `rowsecurity = true`.

- [ ] **Step 4: Run the full test suite and build to confirm zero regressions**

Run: `npx vitest run`
Expected: same pre-existing/unrelated failures as before this plan (missing `DATALAB_API_KEY`/Anthropic auth in `bk/*.test.ts`), everything else green — no new failures, since every test touching these tables already goes through the service-role-backed stores or in-memory test doubles.

Run: `pnpm build`
Expected: clean (this task adds no application code, so this is a sanity check, not expected to catch anything).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260906000001_enable_rls_compliance_tables.sql
git commit -m "fix: enable RLS on legal_paragraphs, compliance_form_freezes, compliance_corrections

Confirmed via direct query: service_role (the only role this codebase ever uses) has
rolbypassrls = true, so this is a no-op for the app's own behavior while closing anon/
authenticated exposure via Supabase's public REST API.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
