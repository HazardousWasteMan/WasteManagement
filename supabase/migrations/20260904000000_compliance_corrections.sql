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
