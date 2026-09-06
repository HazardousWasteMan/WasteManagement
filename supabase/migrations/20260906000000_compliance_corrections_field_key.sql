-- supabase/migrations/20260906000000_compliance_corrections_field_key.sql
--
-- compliance_corrections is confirmed EMPTY in production (verified via direct query,
-- 2026-09-06) — no legacy rows, so this column is NOT NULL with no default and no backfill.
alter table compliance_corrections
  add column cited_field_key text not null;

create index compliance_corrections_paragraph_field_idx
  on compliance_corrections (disputed_paragraph_id, cited_field_key);

-- The old single-column index is now redundant: hasUnresolved always filters on both columns,
-- and the new composite index above already covers any query that only uses the leading column.
drop index if exists compliance_corrections_paragraph_idx;
