-- Step 3: new finalizations require a versioned, resolved EAL decision saved in the BK revision.
-- Existing assessments, revisions and finalizations remain immutable and untouched.
create function public.production_validate_structured_eal_finalization() returns trigger
language plpgsql set search_path='' as $$
declare eal jsonb;
begin
  eal := new.snapshot#>'{workspace,ealDecision}';
  if eal is null or eal->>'modelVersion' is distinct from 'eal-structured-2026-09-10.1' then
    raise exception 'Structured EAL evidence is required' using errcode='22023';
  end if;
  if eal->>'resolutionStatus' is distinct from 'resolved' or nullif(eal->>'selectedCode','') is null then
    raise exception 'EAL decision must be resolved' using errcode='22023';
  end if;
  if eal->>'reviewState'='human_resolved' and (nullif(btrim(eal#>>'{humanSelection,reason}'),'') is null
    or nullif(eal#>>'{humanSelection,actor}','') is null or nullif(eal#>>'{humanSelection,timestamp}','') is null) then
    raise exception 'Human EAL selection requires reason, actor and timestamp' using errcode='22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(eal->'candidates','[]'::jsonb)) c
    where replace(c->>'code',' ','')=replace(eal->>'selectedCode',' ','')
  ) then raise exception 'Selected EAL code is outside the saved candidates' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.production_validate_structured_eal_finalization() from public,anon,authenticated;
create trigger production_finalizations_structured_eal before insert on public.production_finalizations
  for each row execute function public.production_validate_structured_eal_finalization();

create function public.production_review_eal(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,
  p_id uuid,p_expected_revision integer,p_workspace jsonb)
returns public.production_bk_revisions language plpgsql security definer set search_path='' as $$
declare result public.production_bk_revisions; current_revision integer; stamped jsonb; selection jsonb;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  perform 1 from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id and id=p_assessment_id for update;
  if not found then raise exception 'Assessment not found in project' using errcode='23503'; end if;
  if exists(select 1 from public.production_finalizations where assessment_id=p_assessment_id) then raise exception 'Assessment finalized; create a successor' using errcode='40001'; end if;
  selection:=p_workspace#>'{ealDecision,humanSelection}';
  if p_workspace#>>'{ealDecision,modelVersion}' is distinct from 'eal-structured-2026-09-10.1'
    or p_workspace#>>'{ealDecision,resolutionStatus}' is distinct from 'resolved'
    or p_workspace#>>'{ealDecision,reviewState}' is distinct from 'human_resolved'
    or nullif(btrim(selection->>'reason'),'') is null then raise exception 'Invalid reviewed EAL decision' using errcode='22023'; end if;
  if not exists(select 1 from jsonb_array_elements(p_workspace#>'{ealDecision,candidates}') candidate where replace(candidate->>'code',' ','')=replace(selection->>'selectedCode',' ','')) then raise exception 'Selected EAL code is outside the saved candidates' using errcode='22023'; end if;
  select * into result from public.production_bk_revisions where id=p_id;
  if found then
    if result.organisation_id=p_organisation_id and result.project_id=p_project_id and result.assessment_id=p_assessment_id and result.revision=p_expected_revision+1
      and result.workspace#>>'{ealDecision,humanSelection,selectedCode}'=selection->>'selectedCode'
      and result.workspace#>>'{ealDecision,humanSelection,reason}'=selection->>'reason' then return result; end if;
    raise exception 'Draft request identifier conflicts' using errcode='23505';
  end if;
  select coalesce(max(revision),0) into current_revision from public.production_bk_revisions where assessment_id=p_assessment_id;
  if current_revision is distinct from p_expected_revision then raise exception 'Draft changed in another request; reload before saving' using errcode='40001'; end if;
  stamped:=jsonb_set(jsonb_set(p_workspace,'{ealDecision,humanSelection,actor}',to_jsonb(auth.uid()::text),true),'{ealDecision,humanSelection,timestamp}',to_jsonb(current_timestamp::text),true);
  insert into public.production_bk_revisions(id,organisation_id,project_id,assessment_id,revision,state,answers,workspace)
    values(p_id,p_organisation_id,p_project_id,p_assessment_id,current_revision+1,stamped->>'state',stamped->'answers',stamped) returning * into result;
  insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
    values(p_organisation_id,p_project_id,p_assessment_id,'eal_reviewed',jsonb_build_object('revision',result.revision,'selectedCode',selection->>'selectedCode','reason',selection->>'reason','machineSuggestion',p_workspace#>>'{ealDecision,machineSuggestion,code}'));
  return result;
end; $$;
revoke all on function public.production_review_eal(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.production_review_eal(uuid,uuid,uuid,uuid,integer,jsonb) to authenticated;
