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
