-- Phase 2: one immutable PDF per project/content hash, with independent processing attempts.
-- Bytes in PostgreSQL make upload metadata + content atomic. No storage service/bucket needed.
create table public.production_document_files (
  source_document_id uuid primary key,
  organisation_id uuid not null,
  project_id uuid not null,
  sha256 text not null,
  content bytea not null check (octet_length(content) between 5 and 26214400),
  unique (organisation_id, project_id, sha256),
  check (encode(sha256(content), 'hex') = sha256),
  check (substring(content from 1 for 5) = convert_to('%PDF-', 'UTF8')),
  foreign key (organisation_id, project_id, source_document_id)
    references public.source_documents(organisation_id, project_id, id)
);
create trigger production_files_immutable before update or delete on public.production_document_files
  for each row execute function public.production_reject_snapshot_change();

create table public.production_processing_runs (
  id uuid primary key,
  organisation_id uuid not null,
  project_id uuid not null,
  source_document_id uuid not null,
  origin_process text,
  status text not null default 'processing' check (status in ('processing','completed','partial','failed')),
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '10 minutes'),
  finished_at timestamptz,
  error_message text,
  unique (organisation_id, project_id, id),
  foreign key (organisation_id, project_id, source_document_id)
    references public.source_documents(organisation_id, project_id, id)
);
create unique index production_one_active_run on public.production_processing_runs(source_document_id) where status = 'processing';
create index production_runs_project on public.production_processing_runs(organisation_id, project_id, started_at);

create table public.production_processing_samples (
  organisation_id uuid not null,
  project_id uuid not null,
  run_id uuid not null,
  sample_index integer not null check (sample_index >= 0),
  source_metadata jsonb not null check (jsonb_typeof(source_metadata) = 'object'),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  assessment_id uuid,
  error_message text,
  bk_status text check (bk_status in ('needs_input','needs_review','draft_ready')),
  primary key (run_id, sample_index),
  check ((status = 'succeeded' and assessment_id is not null and bk_status is not null and error_message is null)
      or (status <> 'succeeded' and assessment_id is null and bk_status is null)),
  foreign key (organisation_id, project_id, run_id)
    references public.production_processing_runs(organisation_id, project_id, id),
  foreign key (organisation_id, project_id, assessment_id)
    references public.assessments(organisation_id, project_id, id)
);
create index production_samples_project on public.production_processing_samples(organisation_id, project_id);

alter table public.production_document_files enable row level security;
alter table public.production_processing_runs enable row level security;
alter table public.production_processing_samples enable row level security;
revoke all on public.production_document_files, public.production_processing_runs, public.production_processing_samples from anon, authenticated;
grant select on public.production_document_files, public.production_processing_runs, public.production_processing_samples to authenticated;
create policy production_files_read on public.production_document_files for select to authenticated using (public.production_is_member(organisation_id));
create policy production_runs_read on public.production_processing_runs for select to authenticated using (public.production_is_member(organisation_id));
create policy production_samples_read on public.production_processing_samples for select to authenticated using (public.production_is_member(organisation_id));

create function public.production_upload_document(p_organisation_id uuid, p_project_id uuid, p_filename text, p_sha256 text, p_content_base64 text)
returns public.source_documents language plpgsql security definer set search_path = '' as $$
declare result public.source_documents; document_id uuid; bytes bytea;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  perform 1 from public.projects where organisation_id=p_organisation_id and id=p_project_id for update;
  if not found then raise exception 'Project not found' using errcode='23503'; end if;
  bytes := decode(p_content_base64, 'base64');
  if bytes is null or octet_length(bytes) not between 5 and 26214400
      or substring(bytes from 1 for 5) <> convert_to('%PDF-', 'UTF8')
      or encode(sha256(bytes), 'hex') is distinct from p_sha256 then
    raise exception 'Invalid PDF or content hash' using errcode='22023';
  end if;
  select f.source_document_id into document_id from public.production_document_files f
    where f.organisation_id=p_organisation_id and f.project_id=p_project_id and f.sha256=p_sha256;
  if document_id is not null then
    select * into result from public.source_documents where id=document_id;
    return result;
  end if;
  document_id := gen_random_uuid();
  insert into public.source_documents(id,organisation_id,project_id,filename,sha256,storage_key)
    values(document_id,p_organisation_id,p_project_id,p_filename,p_sha256,
      p_organisation_id::text || '/' || p_project_id::text || '/' || document_id::text || '.pdf') returning * into result;
  insert into public.production_document_files values(document_id,p_organisation_id,p_project_id,p_sha256,bytes);
  return result;
end; $$;

create function public.production_read_document(p_organisation_id uuid, p_project_id uuid, p_document_id uuid)
returns text language sql security invoker set search_path = '' as $$
  select encode(content,'base64') from public.production_document_files
    where organisation_id=p_organisation_id and project_id=p_project_id and source_document_id=p_document_id;
$$;

create function public.production_begin_processing(p_organisation_id uuid, p_project_id uuid, p_document_id uuid, p_run_id uuid, p_origin_process text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.production_processing_runs; existing public.production_processing_runs;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  perform 1 from public.source_documents d join public.production_document_files f on f.source_document_id=d.id
    where d.organisation_id=p_organisation_id and d.project_id=p_project_id and d.id=p_document_id for update of d;
  if not found then raise exception 'Uploaded document not found in this project' using errcode='23503'; end if;
  select * into result from public.production_processing_runs where id=p_run_id;
  if found then
    if result.organisation_id<>p_organisation_id or result.project_id<>p_project_id
        or result.source_document_id<>p_document_id or result.origin_process is distinct from p_origin_process then
      raise exception 'Processing request ID conflicts with another request' using errcode='23505';
    end if;
    return jsonb_build_object('run',to_jsonb(result),'claimed',false);
  end if;
  select * into existing from public.production_processing_runs where source_document_id=p_document_id and status='processing' for update;
  if found then
    if existing.lease_expires_at>now() then raise exception 'Document already processing' using errcode='55P03'; end if;
    update public.production_processing_samples set status='failed',error_message='Processing interrupted before this sample was saved'
      where run_id=existing.id and status='pending';
    update public.production_processing_runs set status=case when exists(select 1 from public.production_processing_samples where run_id=existing.id and status='succeeded') then 'partial' else 'failed' end,finished_at=now(),error_message='Processing lease expired; saved assessments are retained' where id=existing.id;
  end if;
  insert into public.production_processing_runs(id,organisation_id,project_id,source_document_id,origin_process)
    values(p_run_id,p_organisation_id,p_project_id,p_document_id,p_origin_process) returning * into result;
  return jsonb_build_object('run',to_jsonb(result),'claimed',true);
end; $$;

create function public.production_register_samples(p_organisation_id uuid, p_project_id uuid, p_run_id uuid, p_samples jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare run public.production_processing_runs;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into run from public.production_processing_runs where id=p_run_id and organisation_id=p_organisation_id and project_id=p_project_id for update;
  if not found or run.status<>'processing' or run.lease_expires_at<=now() then raise exception 'Processing run is not active' using errcode='55000'; end if;
  if p_samples is null or jsonb_typeof(p_samples)<>'array' or jsonb_array_length(p_samples)=0 then raise exception 'Expected detected samples' using errcode='22023'; end if;
  if exists(select 1 from public.production_processing_samples where run_id=p_run_id) then raise exception 'Samples already registered' using errcode='23505'; end if;
  insert into public.production_processing_samples(organisation_id,project_id,run_id,sample_index,source_metadata)
    select p_organisation_id,p_project_id,p_run_id,(ordinality-1)::integer,value from jsonb_array_elements(p_samples) with ordinality;
end; $$;

-- One transaction per sample: failure cannot leave an orphan stream or partial assessment.
create function public.production_save_sample(p_organisation_id uuid, p_project_id uuid, p_run_id uuid, p_index integer,
  p_snapshot jsonb, p_bk_output jsonb, p_compliance_evidence jsonb, p_bk_status text, p_error text)
returns public.production_processing_samples language plpgsql security definer set search_path = '' as $$
declare run public.production_processing_runs; sample public.production_processing_samples; stream_id uuid; assessment public.assessments;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into run from public.production_processing_runs where id=p_run_id and organisation_id=p_organisation_id and project_id=p_project_id for update;
  if not found or run.status<>'processing' or run.lease_expires_at<=now() then raise exception 'Processing run is not active' using errcode='55000'; end if;
  select * into sample from public.production_processing_samples where run_id=p_run_id and sample_index=p_index for update;
  if not found then raise exception 'Sample not found' using errcode='23503'; end if;
  if sample.status<>'pending' then
    if sample.status='succeeded' and p_error is null then
      select * into assessment from public.assessments where id=sample.assessment_id;
      if assessment.decision_snapshot=p_snapshot and assessment.bk_output is not distinct from p_bk_output
          and assessment.compliance_evidence=p_compliance_evidence and sample.bk_status=p_bk_status then return sample; end if;
    elsif sample.status='failed' and sample.error_message=p_error then return sample;
    end if;
    raise exception 'A saved sample cannot be replaced' using errcode='55000';
  end if;
  if p_error is not null then
    update public.production_processing_samples set status='failed',error_message=p_error
      where run_id=p_run_id and sample_index=p_index returning * into sample;
    return sample;
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot->'classification') is distinct from 'object'
      or p_bk_status is null then raise exception 'Missing sample decision' using errcode='22023'; end if;
  stream_id := gen_random_uuid();
  insert into public.waste_streams(id,organisation_id,project_id,name,origin_process,description)
    values(stream_id,p_organisation_id,p_project_id,
      coalesce(nullif(sample.source_metadata->>'marking',''),sample.source_metadata->>'sampleNo','Sample ' || p_index::text),
      run.origin_process,'Created from document ' || run.source_document_id::text || ', sample ' || coalesce(sample.source_metadata->>'sampleNo',p_index::text));
  select * into assessment from public.production_create_assessment(
    p_organisation_id,p_project_id,stream_id,gen_random_uuid(),now(),p_snapshot#>>'{classification,eal,code}',
    (p_snapshot#>>'{classification,hazard,isHazardous}')::boolean,p_snapshot,
    jsonb_build_array(jsonb_build_object('source_document_id',run.source_document_id,'segment_key',p_run_id::text || ':' || p_index::text,
      'first_page',(sample.source_metadata->>'firstPage')::integer,'last_page',(sample.source_metadata->>'lastPage')::integer)),
    p_bk_output,p_compliance_evidence);
  update public.production_processing_samples set status='succeeded',assessment_id=assessment.id,bk_status=p_bk_status
    where run_id=p_run_id and sample_index=p_index returning * into sample;
  return sample;
end; $$;

create function public.production_finish_processing(p_organisation_id uuid, p_project_id uuid, p_run_id uuid, p_error text)
returns public.production_processing_runs language plpgsql security definer set search_path = '' as $$
declare result public.production_processing_runs; succeeded integer; failed integer;
begin
  if not public.production_is_member(p_organisation_id) then raise exception 'Organisation access denied' using errcode='42501'; end if;
  select * into result from public.production_processing_runs where id=p_run_id and organisation_id=p_organisation_id and project_id=p_project_id for update;
  if not found then raise exception 'Run not found' using errcode='23503'; end if;
  if result.status<>'processing' then return result; end if;
  update public.production_processing_samples set status='failed',error_message=coalesce(p_error,'Processing ended before this sample was saved') where run_id=p_run_id and status='pending';
  select count(*) filter(where status='succeeded'),count(*) filter(where status='failed') into succeeded,failed from public.production_processing_samples where run_id=p_run_id;
  update public.production_processing_runs set status=case when succeeded=0 then 'failed' when failed>0 or p_error is not null then 'partial' else 'completed' end,
    finished_at=now(),error_message=p_error where id=p_run_id returning * into result;
  return result;
end; $$;

revoke all on function public.production_upload_document(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.production_read_document(uuid,uuid,uuid) from public,anon;
revoke all on function public.production_begin_processing(uuid,uuid,uuid,uuid,text) from public,anon;
revoke all on function public.production_register_samples(uuid,uuid,uuid,jsonb) from public,anon;
revoke all on function public.production_save_sample(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text,text) from public,anon;
revoke all on function public.production_finish_processing(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.production_upload_document(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.production_read_document(uuid,uuid,uuid) to authenticated;
grant execute on function public.production_begin_processing(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.production_register_samples(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.production_save_sample(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text,text) to authenticated;
grant execute on function public.production_finish_processing(uuid,uuid,uuid,text) to authenticated;
