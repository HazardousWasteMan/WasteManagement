-- supabase/migrations/20260903000000_compliance_schema.sql
create extension if not exists vector;

create table legal_paragraphs (
  id text primary key,
  source text not null check (source in ('no', 'eu')),
  jurisdiction_applies text[] not null,
  document_id text not null, -- Lovdata document id (this slice) or base_celex (future EU source)
  article text not null,
  paragraph text not null,
  text text not null,
  embedding vector(1024) not null, -- MUST match the real Voyage output dimension confirmed in Step 1
  in_force boolean not null default true,
  last_verified_at timestamptz not null,
  last_changed_at timestamptz not null,
  verification_status text not null check (verification_status in ('current', 'updated', 'needs_reverification')),
  amended_by text[] not null default '{}',
  previous_version_id text references legal_paragraphs(id),
  human_signed_off boolean not null default false,
  source_link text not null,
  created_at timestamptz not null default now()
);

create index legal_paragraphs_embedding_idx on legal_paragraphs
  using hnsw (embedding vector_cosine_ops);
create index legal_paragraphs_document_idx on legal_paragraphs (document_id, article, paragraph);
create index legal_paragraphs_jurisdiction_idx on legal_paragraphs using gin (jurisdiction_applies);

create table compliance_form_freezes (
  id uuid primary key default gen_random_uuid(),
  case_id text not null,
  field_name text not null,
  cited_paragraph_id text not null references legal_paragraphs(id),
  paragraph_text_at_freeze text not null,
  last_verified_at_at_freeze timestamptz not null,
  source_link_at_freeze text not null,
  frozen_at timestamptz not null default now()
);

create index compliance_form_freezes_case_idx on compliance_form_freezes (case_id, field_name);
