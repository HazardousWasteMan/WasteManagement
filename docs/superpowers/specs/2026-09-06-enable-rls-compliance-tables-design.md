# Enable RLS on Compliance Tables — Design

**Status:** Approved for planning
**Branch:** `vedlegg-citation-and-followups` (first of three follow-on items — RLS, then Checkbox9/10 hardcoding, then seed-lovdata rate-limit retry — from PR #1's disclosed follow-ups, sequenced per user's explicit ordering choice)
**Builds on:** `supabase/migrations/20260903000000_compliance_schema.sql` and `supabase/migrations/20260904000000_compliance_corrections.sql`, which created the three tables with row-level security left disabled.

## Purpose

`legal_paragraphs`, `compliance_form_freezes`, and `compliance_corrections` all have `rowsecurity = false` in production (confirmed via direct query, 2026-09-06). This means any caller holding the project's anon key can read or write these tables directly through Supabase's public PostgREST API, entirely bypassing this application's server code and any business logic it enforces.

## Real research confirming this is safe to fix with zero behavior change

Confirmed via direct SQL query against the live project (not assumed):
- `select rolname, rolbypassrls from pg_roles where rolname in ('service_role','anon','authenticated');` → `service_role: true`, `anon: false`, `authenticated: false`.
- Every Supabase client construction in this codebase (`lib/compliance/store.ts`, `lib/compliance/freeze.ts`, `lib/compliance/corrections.ts`) uses `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` — server-side only, confirmed via repo-wide grep. No anon/publishable key is ever created, distributed, or used anywhere in this codebase.

Because `service_role` bypasses row-level security by default in Postgres/Supabase, enabling RLS with zero policies is a genuine no-op for every existing code path in this app, while fully closing the `anon`/`authenticated` exposure that exists today.

## Design

One migration enables RLS on all three tables, no policies added:

```sql
alter table legal_paragraphs enable row level security;
alter table compliance_form_freezes enable row level security;
alter table compliance_corrections enable row level security;
```

**Scope decision (confirmed with the user):** deny-by-default on all three, no anon-readable policy added anywhere. No current or planned feature needs anon/authenticated access to these tables — if one arises later, that's a new, real, scoped policy decision at that time, not something to speculatively build now.

## Explicitly disclosed, not solved by this spec

- If a future feature adds a client-side Supabase client (anon key) needing to read any of these tables directly, a real policy must be added then — this spec deliberately does not anticipate that.

## Testing

- No unit tests apply — this is pure database configuration, not application code.
- Real verification: after applying the migration, a direct SQL query (`select tablename, rowsecurity from pg_tables where tablename in (...)`) against the live project confirms `rowsecurity = true` on all three tables.
- Run the full existing test suite and `pnpm build` to confirm zero regressions — every existing test already exercises these tables through the service-role-backed stores or in-memory test doubles, none of which are affected by this change.
