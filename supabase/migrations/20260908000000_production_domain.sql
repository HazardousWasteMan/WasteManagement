-- Additive foundation. Existing cases, browser storage and compliance tables are untouched.
-- Organisations/memberships are provisioned by an administrator, never by client input.
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.organisation_members (
  organisation_id uuid not null references public.organisations(id),
  user_id uuid not null references auth.users(id),
  primary key (organisation_id, user_id)
);
create index organisation_members_user_idx on public.organisation_members(user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  name text not null check (length(btrim(name)) > 0),
  location text not null default '',
  created_at timestamptz not null default now(),
  unique (organisation_id, id)
);

create table public.waste_streams (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  project_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  origin_process text,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (organisation_id, project_id, id),
  foreign key (organisation_id, project_id) references public.projects(organisation_id, id)
);

-- Metadata only: upload/storage integration is a later phase. A PDF is stored once and
-- referenced by as many assessments as needed. Storage locators and hashes are immutable.
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  project_id uuid not null,
  filename text not null check (length(btrim(filename)) > 0),
  storage_key text not null check (length(btrim(storage_key)) > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (organisation_id, project_id, id),
  unique (storage_key),
  check (starts_with(storage_key, organisation_id::text || '/' || project_id::text || '/')),
  foreign key (organisation_id, project_id) references public.projects(organisation_id, id)
);

-- Each row is an immutable decision snapshot, not a mutable draft or finalized declaration.
-- The lifecycle, extraction-run model and full BK/compliance records will be added later.
create table public.assessments (
  id uuid primary key,
  organisation_id uuid not null,
  project_id uuid not null,
  waste_stream_id uuid not null,
  version integer not null check (version > 0),
  previous_assessment_id uuid,
  assessed_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  eal_code text check (eal_code is null or length(btrim(eal_code)) > 0),
  is_hazardous boolean, -- NULL is indeterminate, never default to false.
  decision_snapshot jsonb not null check (jsonb_typeof(decision_snapshot) = 'object'),
  bk_output jsonb check (bk_output is null or jsonb_typeof(bk_output) = 'object'),
  compliance_evidence jsonb not null default '[]' check (jsonb_typeof(compliance_evidence) = 'array'),
  unique (organisation_id, project_id, id),
  unique (organisation_id, project_id, waste_stream_id, id),
  unique (organisation_id, waste_stream_id, version),
  check ((version = 1 and previous_assessment_id is null) or
         (version > 1 and previous_assessment_id is not null)),
  check (previous_assessment_id is distinct from id),
  foreign key (organisation_id, project_id, waste_stream_id)
    references public.waste_streams(organisation_id, project_id, id),
  foreign key (organisation_id, project_id, waste_stream_id, previous_assessment_id)
    references public.assessments(organisation_id, project_id, waste_stream_id, id)
);

create table public.assessment_source_documents (
  organisation_id uuid not null,
  project_id uuid not null,
  assessment_id uuid not null,
  source_document_id uuid not null,
  -- Empty segment_key means the whole document. Otherwise a stable extraction/sample key.
  segment_key text not null default '',
  first_page integer,
  last_page integer,
  primary key (assessment_id, source_document_id, segment_key),
  check ((first_page is null and last_page is null) or
         (first_page is not null and last_page is not null and first_page >= 0 and last_page >= first_page)),
  foreign key (organisation_id, project_id, assessment_id)
    references public.assessments(organisation_id, project_id, id),
  foreign key (organisation_id, project_id, source_document_id)
    references public.source_documents(organisation_id, project_id, id)
);
create index assessment_documents_source_idx
  on public.assessment_source_documents(organisation_id, project_id, source_document_id);

-- RLS applies even when callers bypass the TypeScript adapter. Membership is not inferred
-- from a caller-supplied organisation ID. No tenant privileges are granted to anon.
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.projects enable row level security;
alter table public.waste_streams enable row level security;
alter table public.source_documents enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_source_documents enable row level security;

create policy members_read_self on public.organisation_members for select to authenticated
  using (user_id = (select auth.uid()));

create function public.production_is_member(target_organisation uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.organisation_members
    where organisation_id = target_organisation and user_id = (select auth.uid()));
$$;
revoke all on function public.production_is_member(uuid) from public, anon;
grant execute on function public.production_is_member(uuid) to authenticated;

create policy organisations_read on public.organisations for select to authenticated
  using (public.production_is_member(id));

create policy projects_read on public.projects for select to authenticated
  using (public.production_is_member(organisation_id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.production_is_member(organisation_id));
create policy streams_read on public.waste_streams for select to authenticated
  using (public.production_is_member(organisation_id));
create policy streams_insert on public.waste_streams for insert to authenticated
  with check (public.production_is_member(organisation_id));
create policy documents_read on public.source_documents for select to authenticated
  using (public.production_is_member(organisation_id));
create policy documents_insert on public.source_documents for insert to authenticated
  with check (public.production_is_member(organisation_id));
create policy assessments_read on public.assessments for select to authenticated
  using (public.production_is_member(organisation_id));
create policy assessment_documents_read on public.assessment_source_documents for select to authenticated
  using (public.production_is_member(organisation_id));

-- Explicit grants override Supabase's permissive default table privileges.
revoke all on public.organisations, public.organisation_members, public.projects,
  public.waste_streams, public.source_documents, public.assessments,
  public.assessment_source_documents from anon, authenticated;
grant select on public.organisations, public.organisation_members, public.projects,
  public.waste_streams, public.source_documents, public.assessments,
  public.assessment_source_documents to authenticated;
grant insert on public.projects, public.waste_streams, public.source_documents to authenticated;

create function public.production_reject_snapshot_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Production evidence snapshots are append-only' using errcode = '55000';
end;
$$;
revoke all on function public.production_reject_snapshot_change() from public, anon, authenticated;
create trigger assessments_immutable before update or delete on public.assessments
  for each row execute function public.production_reject_snapshot_change();
create trigger assessment_documents_immutable before update or delete on public.assessment_source_documents
  for each row execute function public.production_reject_snapshot_change();
create trigger source_documents_immutable before update or delete on public.source_documents
  for each row execute function public.production_reject_snapshot_change();

-- The only authenticated write path for assessments and their complete evidence link set.
-- SECURITY DEFINER is needed because direct INSERT is deliberately not granted. Check
-- membership explicitly, use fully qualified names, and never trust a supplied actor ID.
create function public.production_create_assessment(
  p_organisation_id uuid,
  p_project_id uuid,
  p_waste_stream_id uuid,
  p_id uuid,
  p_assessed_at timestamptz,
  p_eal_code text,
  p_is_hazardous boolean,
  p_decision_snapshot jsonb,
  p_documents jsonb,
  p_bk_output jsonb default null,
  p_compliance_evidence jsonb default '[]'
) returns public.assessments
language plpgsql security definer set search_path = '' as $$
declare
  result public.assessments;
  previous public.assessments;
  actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1 from public.organisation_members where organisation_id = p_organisation_id and user_id = actor
  ) then
    raise exception 'Organisation access denied' using errcode = '42501';
  end if;
  if p_documents is null or jsonb_typeof(p_documents) <> 'array' then
    raise exception 'documents must be an array' using errcode = '22023';
  end if;

  -- Serialise assessment creation per stream; concurrent requests cannot reuse a version.
  perform 1 from public.waste_streams
    where organisation_id = p_organisation_id and project_id = p_project_id and id = p_waste_stream_id
    for update;
  if not found then
    raise exception 'Waste stream not found in this organisation/project' using errcode = '23503';
  end if;
  if exists (select 1 from public.assessments where id = p_id) then
    raise exception 'duplicate key: assessment ID already exists' using errcode = '23505';
  end if;
  select * into previous from public.assessments
    where organisation_id = p_organisation_id and waste_stream_id = p_waste_stream_id
    order by version desc limit 1;

  insert into public.assessments (
    id, organisation_id, project_id, waste_stream_id, version, previous_assessment_id,
    assessed_at, created_by, eal_code, is_hazardous, decision_snapshot, bk_output, compliance_evidence
  ) values (
    p_id, p_organisation_id, p_project_id, p_waste_stream_id, coalesce(previous.version, 0) + 1,
    previous.id, p_assessed_at, actor, p_eal_code, p_is_hazardous, p_decision_snapshot,
    p_bk_output, p_compliance_evidence
  ) returning * into result;

  insert into public.assessment_source_documents (
    organisation_id, project_id, assessment_id, source_document_id, segment_key, first_page, last_page
  ) select p_organisation_id, p_project_id, result.id, d.source_document_id,
      coalesce(d.segment_key, ''), d.first_page, d.last_page
    from jsonb_to_recordset(p_documents) as d(
      source_document_id uuid, segment_key text, first_page integer, last_page integer
    );
  return result;
end;
$$;
revoke all on function public.production_create_assessment(uuid, uuid, uuid, uuid, timestamptz, text, boolean, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.production_create_assessment(uuid, uuid, uuid, uuid, timestamptz, text, boolean, jsonb, jsonb, jsonb, jsonb)
  to authenticated;
