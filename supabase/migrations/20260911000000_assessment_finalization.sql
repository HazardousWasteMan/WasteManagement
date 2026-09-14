-- Phase 4: atomic immutable snapshot + exact PDF, with explicit successor assessments.
create table public.production_finalizations (
  id uuid primary key,
  organisation_id uuid not null,
  project_id uuid not null,
  assessment_id uuid not null unique,
  bk_revision integer not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  snapshot_sha256 text not null,
  pdf_sha256 text not null,
  pdf bytea not null check(octet_length(pdf) between 5 and 26214400),
  finalized_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  foreign key(organisation_id,project_id,assessment_id) references public.assessments(organisation_id,project_id,id),
  foreign key(assessment_id,bk_revision) references public.production_bk_revisions(assessment_id,revision),
  check(encode(sha256(pdf),'hex')=pdf_sha256),
  check(substring(pdf from 1 for 5)=convert_to('%PDF-','UTF8')),
  check(encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')=snapshot_sha256)
);
create trigger production_finalizations_immutable before update or delete on public.production_finalizations
  for each row execute function public.production_reject_snapshot_change();
alter table public.production_finalizations enable row level security;
revoke all on public.production_finalizations from anon,authenticated;
grant select(id,organisation_id,project_id,assessment_id,bk_revision,snapshot,snapshot_sha256,pdf_sha256,finalized_at,created_by) on public.production_finalizations to authenticated;
create policy production_finalizations_read on public.production_finalizations for select to authenticated using(public.production_is_member(organisation_id));

create table public.production_audit_events (
  id bigint generated always as identity primary key,
  organisation_id uuid not null,
  project_id uuid not null,
  assessment_id uuid not null,
  kind text not null,
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  actor_id uuid not null default auth.uid() references auth.users(id),
  foreign key(organisation_id,project_id,assessment_id) references public.assessments(organisation_id,project_id,id)
);
create index production_audit_assessment on public.production_audit_events(organisation_id,project_id,assessment_id,id);
create trigger production_audit_immutable before update or delete on public.production_audit_events for each row execute function public.production_reject_snapshot_change();
alter table public.production_audit_events enable row level security;
revoke all on public.production_audit_events from anon,authenticated;
grant select on public.production_audit_events to authenticated;
create policy production_audit_read on public.production_audit_events for select to authenticated using(public.production_is_member(organisation_id));

-- Serialize edit/finalize on the same assessment lock. Enforced even outside the HTTP API.
create function public.production_guard_finalized_edit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.assessments where id=new.assessment_id for update;
  if exists(select 1 from public.production_finalizations where assessment_id=new.assessment_id) then
    raise exception 'Assessment finalized; create a successor' using errcode='40001';
  end if;
  return new;
end; $$;
create trigger production_bk_finalized_guard before insert on public.production_bk_revisions for each row execute function public.production_guard_finalized_edit();

create function public.production_record_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='assessments' then
    insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
      values(new.organisation_id,new.project_id,new.id,'assessment_created',jsonb_build_object('version',new.version,'previousAssessmentId',new.previous_assessment_id));
    if new.decision_snapshot->'versions' is not null then
      insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail) values
        (new.organisation_id,new.project_id,new.id,'classification_recorded',jsonb_build_object('versions',new.decision_snapshot->'versions','hazardous',new.is_hazardous)),
        (new.organisation_id,new.project_id,new.id,'source_evidence_captured',jsonb_build_object('sourceDocumentId',new.decision_snapshot->'sourceDocumentId','processingRunId',new.decision_snapshot->'processingRunId'));
    end if;
    if jsonb_array_length(new.compliance_evidence)>0 then
      insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
        values(new.organisation_id,new.project_id,new.id,'legal_evidence_captured',jsonb_build_object('fieldCount',jsonb_array_length(new.compliance_evidence)));
    end if;
  elsif tg_table_name='production_bk_revisions' then
    insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
      values(new.organisation_id,new.project_id,new.assessment_id,'bk_revision_saved',jsonb_build_object('revision',new.revision,'state',new.state,'changedQuestions',(select coalesce(jsonb_agg(k),'[]') from jsonb_object_keys(new.answers) k
          where new.answers->k is distinct from (select answers->k from public.production_bk_revisions where assessment_id=new.assessment_id and revision<new.revision order by revision desc limit 1))));
  else
    insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
      values(new.organisation_id,new.project_id,new.assessment_id,'assessment_finalized',jsonb_build_object('finalizationId',new.id,'revision',new.bk_revision,'pdfSha256',new.pdf_sha256));
  end if;
  return new;
end; $$;
create trigger production_assessment_audit after insert on public.assessments for each row execute function public.production_record_audit();
create trigger production_bk_audit after insert on public.production_bk_revisions for each row execute function public.production_record_audit();
create trigger production_finalization_audit after insert on public.production_finalizations for each row execute function public.production_record_audit();

create function public.production_finalize_assessment(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,p_id uuid,
  p_expected_revision integer,p_pdf_base64 text,p_legal_freezes jsonb,p_acknowledged_gaps jsonb,p_artifact_version jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.assessments; r public.production_bk_revisions; existing public.production_finalizations;
  snap jsonb; sources jsonb; bytes bytea; gaps jsonb; run_id uuid; field jsonb; citation jsonb; legal jsonb;
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
    or r.workspace->>'mappingVersion' is null
    or r.workspace#>>'{summary,needsInput}' is distinct from '0'
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
  if a.decision_snapshot#>'{classification,noDataWarning}'='true'::jsonb or exists(
    select 1 from jsonb_array_elements(a.decision_snapshot#>'{normalizationTrace,normalized}') n,
      jsonb_array_elements_text(n->'confidenceFlags') flag
      where flag like 'unrecognized unit%' or flag like 'result not on dry basis%'
  ) then raise exception 'Classification basis needs review before finalization' using errcode='22023'; end if;
  run_id := (a.decision_snapshot->>'processingRunId')::uuid;
  if not exists(select 1 from public.production_processing_runs pr where pr.id=run_id and pr.organisation_id=p_organisation_id and pr.project_id=p_project_id and pr.status='completed') then
    raise exception 'Source processing must be complete without failures' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('link',to_jsonb(l),'document',to_jsonb(d)) order by d.id,l.segment_key) into sources
    from public.assessment_source_documents l join public.source_documents d on d.id=l.source_document_id
    join public.production_document_files f on f.source_document_id=d.id and f.sha256=d.sha256
    where l.assessment_id=a.id;
  if sources is null or jsonb_array_length(sources)<>(select count(*) from public.assessment_source_documents where assessment_id=a.id) then
    raise exception 'Persisted source evidence required' using errcode='22023';
  end if;
  if jsonb_typeof(p_legal_freezes) is distinct from 'array' or jsonb_typeof(p_artifact_version) is distinct from 'object' then raise exception 'Invalid freeze metadata' using errcode='22023'; end if;
  -- Every frozen legal location must come from THIS revision, and all cited locations
  -- must be frozen. Never accept arbitrary foreign/customer/cache data in a freeze.
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
  snap := jsonb_build_object('assessment',to_jsonb(a),'workspace',r.workspace,'sources',sources,'legalFreezes',p_legal_freezes,
    'acknowledgedGaps',gaps,'artifactVersion',p_artifact_version,'processingRun',(select to_jsonb(pr) from public.production_processing_runs pr where pr.id=run_id),'stream',(select to_jsonb(s) from public.waste_streams s where s.id=a.waste_stream_id));
  bytes := decode(p_pdf_base64,'base64');
  insert into public.production_finalizations(id,organisation_id,project_id,assessment_id,bk_revision,snapshot,snapshot_sha256,pdf_sha256,pdf)
    values(p_id,p_organisation_id,p_project_id,a.id,r.revision,snap,encode(sha256(convert_to(snap::text,'UTF8')),'hex'),encode(sha256(bytes),'hex'),bytes);
  return p_id;
end; $$;

create function public.production_read_finalized_pdf(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid)
returns text language sql security definer set search_path='' as $$
  select encode(pdf,'base64') from public.production_finalizations
    where organisation_id=p_organisation_id and project_id=p_project_id and assessment_id=p_assessment_id and public.production_is_member(p_organisation_id);
$$;

create function public.production_create_successor(p_organisation_id uuid,p_project_id uuid,p_assessment_id uuid,p_new_id uuid,p_replacement_id uuid default null,p_workspace jsonb default null)
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
  source := a; initial_workspace := f.snapshot->'workspace'; source_snapshot := a.decision_snapshot;
  if p_replacement_id is not null then
    select * into source from public.assessments where organisation_id=p_organisation_id and project_id=p_project_id and id=p_replacement_id and id<>a.id;
    if not found then raise exception 'Replacement analysis unavailable in project' using errcode='23503'; end if;
    if jsonb_typeof(source.decision_snapshot->'versions') is distinct from 'object' or jsonb_typeof(source.decision_snapshot->'normalizationTrace') is distinct from 'object'
      or not exists(select 1 from public.production_processing_runs pr where pr.id=(source.decision_snapshot->>'processingRunId')::uuid and pr.organisation_id=p_organisation_id and pr.project_id=p_project_id and pr.status='completed') then
      raise exception 'Replacement analysis must be fully processed with versioned evidence' using errcode='22023';
    end if;
    if p_workspace is null or p_workspace->>'modelVersion' is distinct from '1' or p_workspace->'answers' is distinct from '{}'::jsonb
      or p_workspace#>>'{context,projectId}' is distinct from p_project_id::text or p_workspace#>>'{context,streamId}' is distinct from a.waste_stream_id::text then
      raise exception 'A new analysis requires fresh scoped questions' using errcode='22023';
    end if;
    initial_workspace := p_workspace;
    source_snapshot := source.decision_snapshot || jsonb_build_object('revisionSourceAssessmentId',source.id,'basedOnFinalizationId',f.id);
  elsif p_workspace is not null then raise exception 'Unexpected replacement workspace' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('source_document_id',l.source_document_id,'segment_key',l.segment_key,'first_page',l.first_page,'last_page',l.last_page)) into docs from public.assessment_source_documents l where l.assessment_id=source.id;
  successor := public.production_create_assessment(p_organisation_id,p_project_id,a.waste_stream_id,p_new_id,source.assessed_at,source.eal_code,source.is_hazardous,
    source_snapshot,docs,source.bk_output,source.compliance_evidence);
  perform public.production_save_bk_revision(p_organisation_id,p_project_id,successor.id,gen_random_uuid(),0,initial_workspace->'answers',initial_workspace);
  insert into public.production_audit_events(organisation_id,project_id,assessment_id,kind,detail)
    values(p_organisation_id,p_project_id,successor.id,'successor_created',jsonb_build_object('previousAssessmentId',a.id,'finalizationId',f.id,'replacementAssessmentId',p_replacement_id));
  return successor.id;
end; $$;

revoke all on function public.production_finalize_assessment(uuid,uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb) from public,anon;
revoke all on function public.production_read_finalized_pdf(uuid,uuid,uuid) from public,anon;
revoke all on function public.production_create_successor(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.production_finalize_assessment(uuid,uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.production_read_finalized_pdf(uuid,uuid,uuid) to authenticated;
grant execute on function public.production_create_successor(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;
