create or replace function public.get_experience_evidence_review(p_activity_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.experience_activities;docs jsonb;context_current boolean;
begin
 if not public.can_access_experience_evidence(p_activity_id,false) then raise exception 'Credentials are unavailable to this account or require fresh Creator confirmation';end if;
 select * into v from public.experience_activities where id=p_activity_id;
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('request_id',d.activity_id) order by d.requirement_code),'[]'::jsonb) into docs from(
  select distinct on(requirement_code) * from public.experience_evidence_documents where activity_id=p_activity_id and requirements_revision=v.credential_revision and status<>'abandoned' order by requirement_code,version desc)d;
 context_current:=v.credential_context=private.experience_evidence_context(p_activity_id);
 return jsonb_build_object('configured',v.credential_requirements is not null,'revision',coalesce(v.credential_revision,0),'context_current',coalesce(context_current,false),
  'requirements',coalesce(v.credential_requirements,'[]'::jsonb),'requirements_note',v.credential_requirements_note,'requirements_set_at',v.credential_requirements_set_at,
  'documents',docs,'ready',private.experience_evidence_current(p_activity_id),'can_review',public.can_access_experience_evidence(p_activity_id,true),
  'can_submit',public.current_profile_user_id()=(select host_user_id from public.experience_activities where id=p_activity_id) and v.status in ('draft','submitted','changes_required','withdrawn') and v.credential_requirements is not null and coalesce(context_current,false));
end $$;

create or replace function public.begin_experience_evidence_upload(p_activity_id uuid,p_requirement_code text,p_request_key uuid,p_mime_type text,p_byte_size bigint,p_original_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.experience_activities;d public.experience_evidence_documents;next_version integer;suffix text;
begin
 if public.current_profile_user_id() is distinct from (select host_user_id from public.experience_activities where id=p_activity_id) or not public.can_access_experience_evidence(p_activity_id,false) then raise exception 'The Experience host must upload their evidence';end if;
 perform 1 from public.experience_activities where id=p_activity_id for update;
 select * into v from public.experience_activities where id=p_activity_id for update;
 if v.status not in ('draft','submitted','changes_required','withdrawn') then raise exception 'Revise the activity before changing its evidence';end if;
 if v.credential_requirements is null or v.credential_context is distinct from private.experience_evidence_context(p_activity_id) then raise exception 'WeHouse must confirm the activity/location requirements first';end if;
 if not exists(select 1 from jsonb_array_elements(v.credential_requirements) r where r->>'code'=p_requirement_code) then raise exception 'Unknown credential requirement';end if;
 if p_request_key is null or p_mime_type is null or p_mime_type not in('application/pdf','image/jpeg','image/png','image/webp') or p_byte_size is null or p_byte_size not between 1 and 10485760 or length(btrim(coalesce(p_original_name,''))) not between 1 and 180 then raise exception 'Choose a PDF, JPG, PNG or WebP up to 10 MB';end if;
 select * into d from public.experience_evidence_documents where activity_id=p_activity_id and request_key=p_request_key;
 if found then
  if row(d.requirement_code,d.requirements_revision,d.mime_type,d.byte_size,d.original_name) is distinct from row(p_requirement_code,v.credential_revision,p_mime_type,p_byte_size,btrim(p_original_name)) then raise exception 'Upload reference belongs to different evidence';end if;
  return to_jsonb(d)||jsonb_build_object('request_id',d.activity_id);
 end if;
 if (select count(*) from public.experience_evidence_documents where activity_id=p_activity_id)>=200 then raise exception 'Credential revision limit reached. Contact Support';end if;
 if exists(select 1 from public.experience_evidence_documents where activity_id=p_activity_id and requirement_code=p_requirement_code and requirements_revision=v.credential_revision and status='uploading') then raise exception 'Confirm or discard the unfinished upload first';end if;
 select coalesce(max(version),0)+1 into next_version from public.experience_evidence_documents where activity_id=p_activity_id and requirement_code=p_requirement_code and requirements_revision=v.credential_revision;
 suffix:=case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;d.id:=gen_random_uuid();
 insert into public.experience_evidence_documents(id,activity_id,requirement_code,requirements_revision,version,request_key,original_name,mime_type,byte_size,object_path)
  values(d.id,p_activity_id,p_requirement_code,v.credential_revision,next_version,p_request_key,btrim(p_original_name),p_mime_type,p_byte_size,p_activity_id||'/'||d.id::text||'.'||suffix) returning * into d;
 return to_jsonb(d)||jsonb_build_object('request_id',d.activity_id);
end $$;

create or replace function public.finish_experience_evidence_upload(p_document_id uuid,p_discard boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.experience_evidence_documents;v public.experience_activities;metadata jsonb;
begin
 select * into d from public.experience_evidence_documents where id=p_document_id;
 if d.id is null or public.current_profile_user_id() is distinct from (select host_user_id from public.experience_activities where id=d.activity_id) or not public.can_access_experience_evidence(d.activity_id,false) then raise exception 'This upload is unavailable';end if;
 perform 1 from public.experience_activities where id=d.activity_id for update;
 select * into v from public.experience_activities where id=d.activity_id for update;
 select * into d from public.experience_evidence_documents where id=p_document_id for update;
 if d.status<>'uploading' then return to_jsonb(d)||jsonb_build_object('request_id',d.activity_id);end if;
 if p_discard then update public.experience_evidence_documents set status='abandoned' where id=d.id returning * into d;
 else
  if v.status not in ('draft','submitted','changes_required','withdrawn') then raise exception 'Revise the activity before changing its evidence';end if;
  if d.requirements_revision<>v.credential_revision or v.credential_context is distinct from private.experience_evidence_context(d.activity_id) then raise exception 'Requirements changed. Discard this upload and use current requirements';end if;
  select o.metadata into metadata from storage.objects o where o.bucket_id='experience-evidence' and o.name=d.object_path;
  if metadata is null or coalesce((metadata->>'size')::bigint,0)<>d.byte_size or metadata->>'mimetype' is distinct from d.mime_type then raise exception 'The uploaded file has not been confirmed';end if;
  update public.experience_evidence_documents set status='submitted',submitted_at=now() where id=d.id returning * into d;
  
 end if;
 return to_jsonb(d)||jsonb_build_object('request_id',d.activity_id);
end $$;

create or replace function public.can_access_experience_evidence_object(p_path text,p_write boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.experience_evidence_documents;v public.experience_activities;
begin
 select * into d from public.experience_evidence_documents where object_path=p_path;
 if d.id is null or not public.can_access_experience_evidence(d.activity_id,false) then return false;end if;
 if not p_write then return true;end if;
 select * into v from public.experience_activities where id=d.activity_id;
 return v.status in ('draft','submitted','changes_required','withdrawn') and v.host_user_id=public.current_profile_user_id() and d.status='uploading' and d.requirements_revision=v.credential_revision and v.credential_context=private.experience_evidence_context(d.activity_id);
end $$;

create or replace function public.archive_my_experience_session(p_activity_id uuid,p_session_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); saved public.experience_sessions;
begin
 perform 1 from public.experience_activities where id=p_activity_id and host_user_id=actor for update;
 if not found then raise exception 'Activity unavailable' using errcode='42501';end if;
 if exists(select 1 from public.experience_activities where id=p_activity_id and status in ('submitted','approved')) then raise exception 'Withdraw the application before changing its submitted sessions';end if;
 select * into saved from public.experience_sessions where id=p_session_id and activity_id=p_activity_id for update;
 if saved.id is null then raise exception 'Session unavailable';end if;
 if saved.status='archived' and saved.revision=p_expected_revision+1 then return to_jsonb(saved);end if;
 if saved.status<>'draft' or saved.revision is distinct from p_expected_revision then raise exception 'Session changed. Refresh before archiving';end if;
 update public.experience_sessions set status='archived',revision=revision+1,updated_at=now() where id=saved.id returning * into saved;
 insert into public.experience_session_events(session_id,revision,actor_user_id,snapshot) values(saved.id,saved.revision,actor,to_jsonb(saved));
 return to_jsonb(saved);
end $$;
