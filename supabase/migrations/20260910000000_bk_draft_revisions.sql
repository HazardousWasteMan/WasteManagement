-- Phase 3: mutable work progresses by appending immutable draft revisions. Assessments
-- remain immutable extraction/classification snapshots; ready is NOT signed/finalized.
create table public.production_bk_revisions (
  id uuid primary key,
  organisation_id uuid not null,
  project_id uuid not null,
  assessment_id uuid not null,
  revision integer not null check (revision > 0),
  state text not null check (state in ('draft','ready')),
  answers jsonb not null check (jsonb_typeof(answers)='object'),
  workspace jsonb not null check (jsonb_typeof(workspace)='object' and workspace->>'modelVersion'='1' and jsonb_typeof(workspace->'fields')='array'),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  unique(assessment_id,revision),
  foreign key(organisation_id,project_id,assessment_id) references public.assessments(organisation_id,project_id,id),
  check (workspace->>'state'=state and workspace->'answers'=answers)
);
create index production_bk_revisions_project on public.production_bk_revisions(organisation_id,project_id,assessment_id,revision desc);
create trigger production_bk_revisions_immutable before update or delete on public.production_bk_revisions
  for each row execute function public.production_reject_snapshot_change();
alter table public.production_bk_revisions enable row level security;
revoke all on public.production_bk_revisions from anon,authenticated;
grant select on public.production_bk_revisions to authenticated;
create policy production_bk_revisions_read on public.production_bk_revisions for select to authenticated using(public.production_is_member(organisation_id));

create function public.production_save_bk_revision(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,
  p_id uuid,p_expected_revision integer,p_answers jsonb,p_workspace jsonb)
returns public.production_bk_revisions language plpgsql security definer set search_path='' as $$
declare result public.production_bk_revisions; current_revision integer;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  perform 1 from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id and id=p_assessment_id for update;
  if not found then raise exception 'Assessment not found in project' using errcode='23503'; end if;
  select * into result from public.production_bk_revisions where id=p_id;
  if found then
    if result.organisation_id=p_organisation_id and result.project_id=p_project_id and result.assessment_id=p_assessment_id
      and result.revision=p_expected_revision+1 and result.answers=p_answers and result.workspace=p_workspace then return result; end if;
    raise exception 'Draft request identifier conflicts' using errcode='23505';
  end if;
  select coalesce(max(revision),0) into current_revision from public.production_bk_revisions where assessment_id=p_assessment_id;
  if current_revision is distinct from p_expected_revision then raise exception 'Draft changed in another request; reload before saving' using errcode='40001'; end if;
  if p_workspace->>'state' is null or p_workspace->'answers' is distinct from p_answers or p_workspace->>'modelVersion' is distinct from '1'
      or jsonb_typeof(p_workspace->'fields') is distinct from 'array' then raise exception 'Invalid draft snapshot' using errcode='22023'; end if;
  insert into public.production_bk_revisions(id,organisation_id,project_id,assessment_id,revision,state,answers,workspace)
    values(p_id,p_organisation_id,p_project_id,p_assessment_id,current_revision+1,p_workspace->>'state',p_answers,p_workspace) returning * into result;
  return result;
end; $$;
revoke all on function public.production_save_bk_revision(uuid,uuid,uuid,uuid,integer,jsonb,jsonb) from public,anon;
grant execute on function public.production_save_bk_revision(uuid,uuid,uuid,uuid,integer,jsonb,jsonb) to authenticated;
