-- Pre-PR integrity hardening. This migration is additive for stored records: existing
-- assessments/finalizations are not rewritten. Machine-derived writes are restricted to the
-- dedicated backend identity, and evidence-set finalization validates/freezes every run.

create table public.production_backend_identities (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.production_backend_identities enable row level security;
revoke all on public.production_backend_identities from anon, authenticated;

create function public.production_is_backend()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.production_backend_identities where user_id=(select auth.uid()));
$$;
revoke all on function public.production_is_backend() from public, anon;
grant execute on function public.production_is_backend() to authenticated;

create function public.production_require_backend_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.production_is_backend() then
    raise exception 'Trusted production backend required' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.production_require_backend_write() from public, anon, authenticated;

-- These rows contain classification evidence, a reconstructed BK workspace, or final artifact
-- bytes. Ordinary organisation members retain scoped read access but cannot author them through
-- a SECURITY DEFINER RPC with a forged payload.
create trigger assessments_backend_write before insert on public.assessments
  for each row execute function public.production_require_backend_write();
create trigger production_bk_revisions_backend_write before insert on public.production_bk_revisions
  for each row execute function public.production_require_backend_write();
create trigger production_finalizations_backend_write before insert on public.production_finalizations
  for each row execute function public.production_require_backend_write();
create trigger production_processing_runs_backend_write before insert or update on public.production_processing_runs
  for each row execute function public.production_require_backend_write();
create trigger production_processing_samples_backend_write before insert or update on public.production_processing_samples
  for each row execute function public.production_require_backend_write();

-- Keep the existing RPC shape for compatibility, but a BK answer save cannot also replace the
-- persisted EAL decision. The server rebuilds human-answer projections; EAL review has its own RPC.
create or replace function public.production_save_bk_revision(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,
  p_id uuid,p_expected_revision integer,p_answers jsonb,p_workspace jsonb)
returns public.production_bk_revisions language plpgsql security definer set search_path='' as $$
declare result public.production_bk_revisions; current_row public.production_bk_revisions;
  current_revision integer; a public.assessments; trusted_eal jsonb;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into a from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id and id=p_assessment_id for update;
  if not found then raise exception 'Assessment not found in project' using errcode='23503'; end if;
  select * into result from public.production_bk_revisions where id=p_id;
  if found then
    if result.organisation_id=p_organisation_id and result.project_id=p_project_id and result.assessment_id=p_assessment_id
      and result.revision=p_expected_revision+1 and result.answers=p_answers and result.workspace=p_workspace then return result; end if;
    raise exception 'Draft request identifier conflicts' using errcode='23505';
  end if;
  select * into current_row from public.production_bk_revisions where assessment_id=p_assessment_id order by revision desc limit 1;
  current_revision:=coalesce(current_row.revision,0);
  if current_revision is distinct from p_expected_revision then raise exception 'Draft changed in another request; reload before saving' using errcode='40001'; end if;
  trusted_eal:=case when current_revision=0 then a.decision_snapshot#>'{classification,eal}' else current_row.workspace->'ealDecision' end;
  if p_workspace->>'state' is null or p_workspace->'answers' is distinct from p_answers or p_workspace->>'modelVersion' is distinct from '1'
      or jsonb_typeof(p_workspace->'fields') is distinct from 'array'
      or p_workspace#>>'{context,projectId}' is distinct from p_project_id::text
      or p_workspace#>>'{context,streamId}' is distinct from a.waste_stream_id::text
      or p_workspace->'ealDecision' is distinct from trusted_eal then
    raise exception 'Invalid draft snapshot or altered machine EAL evidence' using errcode='22023';
  end if;
  insert into public.production_bk_revisions(id,organisation_id,project_id,assessment_id,revision,state,answers,workspace)
    values(p_id,p_organisation_id,p_project_id,p_assessment_id,current_revision+1,p_workspace->>'state',p_answers,p_workspace) returning * into result;
  return result;
end; $$;

-- Candidate and machine evidence come from the immutable assessment (revision zero) or the
-- latest persisted BK revision. Client-supplied candidates can neither expand nor replace it.
create or replace function public.production_review_eal(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,
  p_id uuid,p_expected_revision integer,p_workspace jsonb)
returns public.production_bk_revisions language plpgsql security definer set search_path='' as $$
declare result public.production_bk_revisions; current_row public.production_bk_revisions; a public.assessments;
  current_revision integer; trusted_eal jsonb; submitted_eal jsonb; selection jsonb; candidate jsonb;
  stamped_selection jsonb; stamped_eal jsonb; stamped jsonb;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into a from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id and id=p_assessment_id for update;
  if not found then raise exception 'Assessment not found in project' using errcode='23503'; end if;
  if exists(select 1 from public.production_finalizations where assessment_id=p_assessment_id) then raise exception 'Assessment finalized; create a successor' using errcode='40001'; end if;
  submitted_eal:=p_workspace->'ealDecision'; selection:=submitted_eal->'humanSelection';
  if submitted_eal->>'modelVersion' is distinct from 'eal-structured-2026-09-10.1'
    or submitted_eal->>'resolutionStatus' is distinct from 'resolved'
    or submitted_eal->>'reviewState' is distinct from 'human_resolved'
    or nullif(btrim(selection->>'reason'),'') is null
    or selection->>'selectedCode' is distinct from submitted_eal->>'selectedCode' then
    raise exception 'Invalid reviewed EAL decision' using errcode='22023';
  end if;
  select * into result from public.production_bk_revisions where id=p_id;
  if found then
    if result.organisation_id=p_organisation_id and result.project_id=p_project_id and result.assessment_id=p_assessment_id and result.revision=p_expected_revision+1
      and result.workspace#>>'{ealDecision,humanSelection,selectedCode}'=selection->>'selectedCode'
      and result.workspace#>>'{ealDecision,humanSelection,reason}'=selection->>'reason' then return result; end if;
    raise exception 'Draft request identifier conflicts' using errcode='23505';
  end if;
  select * into current_row from public.production_bk_revisions where assessment_id=p_assessment_id order by revision desc limit 1;
  current_revision:=coalesce(current_row.revision,0);
  if current_revision is distinct from p_expected_revision then raise exception 'Draft changed in another request; reload before saving' using errcode='40001'; end if;
  trusted_eal:=case when current_revision=0 then a.decision_snapshot#>'{classification,eal}' else current_row.workspace->'ealDecision' end;
  if trusted_eal->>'modelVersion' is distinct from 'eal-structured-2026-09-10.1'
    or submitted_eal->'candidates' is distinct from trusted_eal->'candidates'
    or submitted_eal->'suggestedCode' is distinct from trusted_eal->'suggestedCode'
    or submitted_eal->'machineSuggestion' is distinct from trusted_eal->'machineSuggestion'
    or submitted_eal->'originEvidence' is distinct from trusted_eal->'originEvidence'
    or submitted_eal->'materialEvidence' is distinct from trusted_eal->'materialEvidence' then
    raise exception 'Reviewed EAL machine evidence does not match persisted evidence' using errcode='22023';
  end if;
  select c into candidate from jsonb_array_elements(coalesce(trusted_eal->'candidates','[]'::jsonb)) c
    where replace(c->>'code',' ','')=replace(selection->>'selectedCode',' ','') limit 1;
  if candidate is null then raise exception 'Selected EAL code is outside the persisted candidates' using errcode='22023'; end if;
  stamped_selection:=jsonb_build_object('selectedCode',candidate->>'code','reason',btrim(selection->>'reason'),
    'actor',auth.uid()::text,'timestamp',current_timestamp::text,'evidenceSnapshot',
    coalesce(trusted_eal->'originEvidence','[]'::jsonb)||coalesce(trusted_eal->'materialEvidence','[]'::jsonb));
  stamped_eal:=trusted_eal||jsonb_build_object('selectedCode',candidate->>'code','resolutionStatus','resolved','reviewState','human_resolved',
    'reason',submitted_eal->>'reason','reasonNo',submitted_eal->>'reasonNo','humanSelection',stamped_selection,
    'code',candidate->>'code','description',candidate->>'description','confidence',submitted_eal->>'confidence','confidenceNo',submitted_eal->>'confidenceNo');
  stamped:=jsonb_set(p_workspace,'{ealDecision}',stamped_eal,true);
  insert into public.production_bk_revisions(id,organisation_id,project_id,assessment_id,revision,state,answers,workspace)
    values(p_id,p_organisation_id,p_project_id,p_assessment_id,current_revision+1,stamped->>'state',stamped->'answers',stamped) returning * into result;
  insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
    values(p_organisation_id,p_project_id,p_assessment_id,'eal_reviewed',jsonb_build_object('revision',result.revision,'selectedCode',candidate->>'code',
      'reason',selection->>'reason','machineSuggestion',trusted_eal#>>'{machineSuggestion,code}'));
  return result;
end; $$;

create function public.production_snapshot_run_ids(p_snapshot jsonb)
returns table(run_id uuid) language plpgsql set search_path='' as $$
begin
  if p_snapshot ? 'evidenceSet' then
    if jsonb_typeof(p_snapshot#>'{evidenceSet,processingRunIds}') is distinct from 'array'
      or jsonb_array_length(p_snapshot#>'{evidenceSet,processingRunIds}')=0 then
      raise exception 'Evidence set processing runs are missing' using errcode='22023';
    end if;
    return query select value::uuid from jsonb_array_elements_text(p_snapshot#>'{evidenceSet,processingRunIds}');
  else
    if nullif(p_snapshot->>'processingRunId','') is null then
      raise exception 'Assessment processing run is missing' using errcode='22023';
    end if;
    return query select (p_snapshot->>'processingRunId')::uuid;
  end if;
end; $$;
revoke all on function public.production_snapshot_run_ids(jsonb) from public, anon, authenticated;

create function public.production_validated_processing_runs(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.assessments; declared_ids uuid[]; expected_ids uuid[]; source_count integer; result jsonb;
begin
  select * into a from public.assessments
    where organisation_id=p_organisation_id and project_id=p_project_id and id=p_assessment_id;
  if not found then raise exception 'Assessment evidence unavailable' using errcode='23503'; end if;

  select array_agg(run_id order by run_id) into declared_ids
    from public.production_snapshot_run_ids(a.decision_snapshot);
  if declared_ids is null or cardinality(declared_ids)=0
    or cardinality(declared_ids)<>(select count(distinct declared.run_id) from unnest(declared_ids) as declared(run_id)) then
    raise exception 'Assessment processing runs are missing or duplicated' using errcode='22023';
  end if;

  if a.decision_snapshot ? 'evidenceSet' then
    if jsonb_typeof(a.decision_snapshot#>'{evidenceSet,sourceAssessmentIds}') is distinct from 'array'
      or jsonb_array_length(a.decision_snapshot#>'{evidenceSet,sourceAssessmentIds}')=0 then
      raise exception 'Evidence set source assessments are missing' using errcode='22023';
    end if;
    select count(*) into source_count from public.assessments source
      where source.organisation_id=p_organisation_id and source.project_id=p_project_id
        and source.id in (select value::uuid from jsonb_array_elements_text(a.decision_snapshot#>'{evidenceSet,sourceAssessmentIds}'));
    if source_count<>jsonb_array_length(a.decision_snapshot#>'{evidenceSet,sourceAssessmentIds}') then
      raise exception 'Evidence set contains an incompatible source assessment' using errcode='22023';
    end if;
    select array_agg(distinct source_run.run_id order by source_run.run_id) into expected_ids
      from public.assessments source
      cross join lateral public.production_snapshot_run_ids(source.decision_snapshot) source_run
      where source.organisation_id=p_organisation_id and source.project_id=p_project_id
        and source.id in (select value::uuid from jsonb_array_elements_text(a.decision_snapshot#>'{evidenceSet,sourceAssessmentIds}'));
    if expected_ids is distinct from declared_ids then
      raise exception 'Evidence set processing runs do not match its source assessments' using errcode='22023';
    end if;
  end if;

  if exists(
    select 1 from unnest(declared_ids) as declared(run_id)
    left join public.production_processing_runs run on run.id=declared.run_id
    where run.id is null or run.organisation_id<>p_organisation_id or run.project_id<>p_project_id
      or run.status<>'completed' or run.finished_at is null or run.error_message is not null
  ) then raise exception 'Source processing must be complete without failures' using errcode='22023'; end if;
  if exists(
    select 1 from unnest(declared_ids) as declared(run_id) join public.production_processing_runs run on run.id=declared.run_id
    where not exists(select 1 from public.assessment_source_documents link
      where link.assessment_id=a.id and link.organisation_id=p_organisation_id
        and link.project_id=p_project_id and link.source_document_id=run.source_document_id)
  ) or exists(
    select 1 from public.assessment_source_documents link where link.assessment_id=a.id
      and not exists(select 1 from unnest(declared_ids) as declared(run_id) join public.production_processing_runs run on run.id=declared.run_id
        where run.source_document_id=link.source_document_id)
  ) then raise exception 'Processing runs and assessment documents are incompatible' using errcode='22023'; end if;

  select jsonb_agg(to_jsonb(run) order by run.id) into result
    from public.production_processing_runs run where run.id=any(declared_ids);
  return result;
end; $$;
revoke all on function public.production_validated_processing_runs(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.production_finalize_assessment(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,p_id uuid,
  p_expected_revision integer,p_pdf_base64 text,p_legal_freezes jsonb,p_acknowledged_gaps jsonb,p_artifact_version jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.assessments; r public.production_bk_revisions; existing public.production_finalizations;
  snap jsonb; sources jsonb; bytes bytea; gaps jsonb; runs jsonb; field jsonb; citation jsonb; legal jsonb;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into a from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id and id=p_assessment_id for update;
  if not found then raise exception 'Assessment unavailable' using errcode='23503'; end if;
  select * into existing from public.production_finalizations where assessment_id=a.id;
  if found then
    if existing.id=p_id and existing.bk_revision=p_expected_revision and existing.snapshot->'acknowledgedGaps'=p_acknowledged_gaps then return existing.id; end if;
    raise exception 'Assessment already finalized' using errcode='40001';
  end if;
  select * into r from public.production_bk_revisions where assessment_id=a.id order by revision desc limit 1;
  if r.revision is distinct from p_expected_revision or r.state is distinct from 'ready'
    or r.workspace->>'mappingVersion' is null or r.workspace#>>'{summary,needsInput}' is distinct from '0'
    or exists(select 1 from jsonb_array_elements(r.workspace->'decisions') d where d->>'status'='needs_input') then
    raise exception 'Current ready revision required' using errcode='40001';
  end if;
  select coalesce(jsonb_agg(g.id order by g.id),'[]') into gaps from (
    select d->>'id' as id from jsonb_array_elements(r.workspace->'decisions') d where d->>'status'='cannot_determine'
    union all select 'legal-evidence' where not exists(select 1 from jsonb_array_elements(r.workspace->'fields') f where jsonb_array_length(coalesce(f#>'{legalCitation,citations}','[]'))>0)
  ) g;
  if gaps is distinct from p_acknowledged_gaps then raise exception 'Acknowledge every unresolved decision' using errcode='22023'; end if;
  if jsonb_typeof(a.decision_snapshot->'versions') is distinct from 'object' or jsonb_typeof(a.decision_snapshot->'normalizationTrace') is distinct from 'object'
    or a.decision_snapshot#>'{classification,hazard,isHazardous}' is distinct from coalesce(to_jsonb(a.is_hazardous),'null'::jsonb)
    or a.decision_snapshot#>'{classification,eal,code}' is distinct from coalesce(to_jsonb(a.eal_code),'null'::jsonb) then
    raise exception 'Incomplete classification provenance; reprocess source' using errcode='22023';
  end if;
  if a.decision_snapshot->>'extractionState' is distinct from 'complete' then
    raise exception 'Complete source extraction is required' using errcode='22023';
  end if;
  if a.decision_snapshot#>'{classification,noDataWarning}'='true'::jsonb or exists(
    select 1 from jsonb_array_elements(a.decision_snapshot#>'{normalizationTrace,normalized}') n,
      jsonb_array_elements_text(n->'confidenceFlags') flag
      where flag like 'unrecognized unit%' or flag like 'result not on dry basis%'
  ) then raise exception 'Classification basis needs review before finalization' using errcode='22023'; end if;
  runs:=public.production_validated_processing_runs(p_organisation_id,p_project_id,a.id);
  select jsonb_agg(jsonb_build_object('link',to_jsonb(l),'document',to_jsonb(d)) order by d.id,l.segment_key) into sources
    from public.assessment_source_documents l join public.source_documents d on d.id=l.source_document_id
    join public.production_document_files f on f.source_document_id=d.id and f.sha256=d.sha256
    where l.assessment_id=a.id;
  if sources is null or jsonb_array_length(sources)<>(select count(*) from public.assessment_source_documents where assessment_id=a.id) then
    raise exception 'Persisted source evidence required' using errcode='22023';
  end if;
  if jsonb_typeof(p_legal_freezes) is distinct from 'array' or jsonb_typeof(p_artifact_version) is distinct from 'object' then raise exception 'Invalid freeze metadata' using errcode='22023'; end if;
  for field in select f from jsonb_array_elements(r.workspace->'fields') f where f->'legalCitation' is not null and f->'legalCitation'<>'null'::jsonb loop
    if field->>'legalCitationKey' is null or jsonb_array_length(field#>'{legalCitation,citations}')=0 then raise exception 'Invalid legal field key' using errcode='22023'; end if;
    for citation in select c from jsonb_array_elements(field#>'{legalCitation,citations}') c loop
      if not exists(select 1 from jsonb_array_elements(p_legal_freezes) lf where lf->>'fieldName'=field->>'legalCitationKey' and lf->>'citedParagraphId'=citation->>'paragraphId'
        and lf->'paragraph'=citation->'paragraphSnapshot' and lf->>'paragraphTextAtFreeze'=citation#>>'{paragraphSnapshot,text}'
        and lf->>'lastVerifiedAtAtFreeze'=citation->>'verifiedAt' and lf->>'sourceLinkAtFreeze'=citation->>'sourceLink'
        and lf->>'contentSha256'=encode(sha256(convert_to(citation#>>'{paragraphSnapshot,text}','UTF8')),'hex')
        and lf->'disputed'=citation->'disputed' and lf->>'caseId'=a.id::text) then raise exception 'Legal snapshot incomplete or mismatched' using errcode='22023'; end if;
    end loop;
  end loop;
  for legal in select lf from jsonb_array_elements(p_legal_freezes) lf loop
    if not exists(select 1 from jsonb_array_elements(r.workspace->'fields') f, jsonb_array_elements(coalesce(f#>'{legalCitation,citations}','[]')) c
      where f->>'legalCitationKey'=legal->>'fieldName' and c->>'paragraphId'=legal->>'citedParagraphId' and c->'paragraphSnapshot'=legal->'paragraph') then
      raise exception 'Unrelated legal evidence' using errcode='22023';
    end if;
  end loop;
  snap:=jsonb_build_object('assessment',to_jsonb(a),'workspace',r.workspace,'sources',sources,'legalFreezes',p_legal_freezes,
    'acknowledgedGaps',gaps,'artifactVersion',p_artifact_version,'processingRuns',runs,
    'processingRun',case when jsonb_array_length(runs)=1 then runs->0 else null end,
    'stream',(select to_jsonb(s) from public.waste_streams s where s.id=a.waste_stream_id));
  bytes:=decode(p_pdf_base64,'base64');
  insert into public.production_finalizations(id,organisation_id,project_id,assessment_id,bk_revision,snapshot,snapshot_sha256,pdf_sha256,pdf)
    values(p_id,p_organisation_id,p_project_id,a.id,r.revision,snap,encode(sha256(convert_to(snap::text,'UTF8')),'hex'),encode(sha256(bytes),'hex'),bytes);
  return p_id;
end; $$;

create or replace function public.production_create_successor(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,p_new_id uuid,p_replacement_id uuid default null,p_workspace jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare f public.production_finalizations; a public.assessments; successor public.assessments; source public.assessments; docs jsonb; initial_workspace jsonb; source_snapshot jsonb;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into f from public.production_finalizations where organisation_id=p_organisation_id and project_id=p_project_id and assessment_id=p_assessment_id;
  if not found then raise exception 'Finalized assessment unavailable' using errcode='23503'; end if;
  select * into a from public.assessments where id=p_assessment_id;
  perform 1 from public.waste_streams where id=a.waste_stream_id for update;
  select * into successor from public.assessments where id=p_new_id;
  if found then
    if successor.previous_assessment_id=a.id and successor.organisation_id=p_organisation_id and successor.project_id=p_project_id
      and exists(select 1 from public.production_audit_events e where e.assessment_id=successor.id and e.kind='successor_created' and e.detail->'replacementAssessmentId'=coalesce(to_jsonb(p_replacement_id),'null')) then return successor.id; end if;
    raise exception 'Revision identifier conflict' using errcode='23505';
  end if;
  if exists(select 1 from public.assessments where waste_stream_id=a.waste_stream_id and version>a.version) then raise exception 'A successor already exists; open latest assessment' using errcode='40001'; end if;
  source:=a; initial_workspace:=f.snapshot->'workspace'; source_snapshot:=a.decision_snapshot;
  if p_replacement_id is not null then
    select * into source from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id
      and waste_stream_id=a.waste_stream_id and id=p_replacement_id and id<>a.id;
    if not found then raise exception 'Replacement analysis must belong to this waste stream' using errcode='23503'; end if;
    perform public.production_validated_processing_runs(p_organisation_id,p_project_id,source.id);
    if jsonb_typeof(source.decision_snapshot->'versions') is distinct from 'object' or jsonb_typeof(source.decision_snapshot->'normalizationTrace') is distinct from 'object' then
      raise exception 'Replacement analysis must be fully processed with versioned evidence' using errcode='22023';
    end if;
    if p_workspace is null or p_workspace->>'modelVersion' is distinct from '1' or p_workspace->'answers' is distinct from '{}'::jsonb
      or p_workspace#>>'{context,projectId}' is distinct from p_project_id::text or p_workspace#>>'{context,streamId}' is distinct from a.waste_stream_id::text then
      raise exception 'A new analysis requires fresh scoped questions' using errcode='22023';
    end if;
    initial_workspace:=p_workspace;
    source_snapshot:=source.decision_snapshot||jsonb_build_object('revisionSourceAssessmentId',source.id,'basedOnFinalizationId',f.id);
  elsif p_workspace is not null then raise exception 'Unexpected replacement workspace' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('source_document_id',l.source_document_id,'segment_key',l.segment_key,'first_page',l.first_page,'last_page',l.last_page)) into docs
    from public.assessment_source_documents l where l.assessment_id=source.id;
  successor:=public.production_create_assessment(p_organisation_id,p_project_id,a.waste_stream_id,p_new_id,source.assessed_at,source.eal_code,source.is_hazardous,
    source_snapshot,docs,source.bk_output,source.compliance_evidence);
  perform public.production_save_bk_revision(p_organisation_id,p_project_id,successor.id,gen_random_uuid(),0,initial_workspace->'answers',initial_workspace);
  insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
    values(p_organisation_id,p_project_id,successor.id,'successor_created',jsonb_build_object('previousAssessmentId',a.id,'finalizationId',f.id,'replacementAssessmentId',p_replacement_id));
  return successor.id;
end; $$;
