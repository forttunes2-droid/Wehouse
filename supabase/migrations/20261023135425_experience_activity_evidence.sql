begin;
-- Activity evidence extends the existing application; identity remains account-level.
alter table public.experience_activities
 add column credential_requirements jsonb,
 add column credential_revision integer not null default 0,
 add column credential_context jsonb,
 add column credential_requirements_note text,
 add column credential_requirements_set_at timestamptz,
 add column credential_requirements_set_by text references public.profiles(user_id);
create table public.experience_evidence_documents (
 id uuid primary key default gen_random_uuid(),
 activity_id uuid not null references public.experience_activities(id),
 requirement_code text not null,requirements_revision integer not null,version integer not null check(version>0),
 request_key uuid not null,original_name text not null check(length(original_name) between 1 and 180),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 byte_size bigint not null check(byte_size between 1 and 10485760),object_path text not null unique,
 status text not null default 'uploading' check(status in ('uploading','submitted','approved','correction_required','rejected','abandoned')),
 created_at timestamptz not null default now(),submitted_at timestamptz,reviewed_at timestamptz,
 reviewed_by text references public.profiles(user_id),review_note text,expires_at timestamptz,
 unique(activity_id,request_key),unique(activity_id,requirement_code,requirements_revision,version)
);
create index experience_evidence_latest_idx on public.experience_evidence_documents(activity_id,requirements_revision,requirement_code,version desc);
alter table public.experience_evidence_documents enable row level security;
revoke all on public.experience_evidence_documents from public,anon,authenticated;
grant select on public.experience_evidence_documents to authenticated;
grant all on public.experience_evidence_documents to service_role;

create function private.experience_evidence_context(p_activity_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select details from public.experience_activities where id=p_activity_id;
$$;
revoke all on function private.experience_evidence_context(uuid) from public,anon,authenticated;
create function public.can_access_experience_evidence(p_activity_id uuid,p_review boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor text; activity public.experience_activities;
begin
 if p_review is null then return false;end if;
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null then return false;end if;
 if public.current_profile_user_id()=activity.host_user_id then
  actor:=private.experience_host_actor();return not p_review;
 end if;
 actor:=private.experience_creator_actor();
 return actor<>activity.host_user_id and activity.submitted_at is not null and activity.status in ('submitted','changes_required','declined','withdrawn');
exception when insufficient_privilege then return false;
end $$;
revoke all on function public.can_access_experience_evidence(uuid,boolean) from public,anon;
grant execute on function public.can_access_experience_evidence(uuid,boolean) to authenticated;
create policy experience_evidence_read on public.experience_evidence_documents for select to authenticated using(public.can_access_experience_evidence(activity_id,false));
create function private.experience_evidence_current(p_activity_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.experience_activities v where v.id=p_activity_id and v.credential_requirements is not null
  and v.credential_context=private.experience_evidence_context(p_activity_id)
  and not exists(select 1 from jsonb_array_elements(v.credential_requirements) rule where not exists(
   select 1 from public.experience_evidence_documents d where d.activity_id=p_activity_id and d.requirements_revision=v.credential_revision
    and d.requirement_code=rule->>'code' and d.status='approved' and (d.expires_at is null or d.expires_at>now())
    and (not coalesce((rule->>'requires_expiry')::boolean,false) or d.expires_at is not null)
    and not exists(select 1 from public.experience_evidence_documents newer where newer.activity_id=d.activity_id and newer.requirements_revision=d.requirements_revision
     and newer.requirement_code=d.requirement_code and newer.version>d.version and newer.status<>'abandoned'))));
$$;
revoke all on function private.experience_evidence_current(uuid) from public,anon,authenticated;

create function private.guard_experience_evidence_fields() returns trigger language plpgsql set search_path='' as $$
begin
 if current_setting('wehouse.experience_evidence_command',true) is distinct from 'configure' then
  if tg_op='INSERT' then
   if new.credential_requirements is not null or new.credential_revision<>0 or new.credential_context is not null or new.credential_requirements_set_by is not null or new.credential_requirements_set_at is not null or new.credential_requirements_note is not null then raise exception 'Use credential requirement review';end if;
  elsif row(new.credential_requirements,new.credential_revision,new.credential_context,new.credential_requirements_note,new.credential_requirements_set_at,new.credential_requirements_set_by)
    is distinct from row(old.credential_requirements,old.credential_revision,old.credential_context,old.credential_requirements_note,old.credential_requirements_set_at,old.credential_requirements_set_by) then raise exception 'Use credential requirement review';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_experience_evidence_fields() from public,anon,authenticated;
create trigger experience_evidence_fields before insert or update on public.experience_activities for each row execute function private.guard_experience_evidence_fields();

create function public.configure_experience_evidence_requirements(p_activity_id uuid,p_expected_revision integer,p_requirements jsonb,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.experience_activities;item jsonb;previous text;
begin
 if not public.can_access_experience_evidence(p_activity_id,true) then raise exception 'Credential review is outside your authority or requires fresh Creator confirmation';end if;
 perform 1 from public.experience_activities where id=p_activity_id for update;
 select * into v from public.experience_activities where id=p_activity_id for update;
 if v.id is null then raise exception 'Save the activity before configuring evidence';end if;
 if v.credential_revision is distinct from p_expected_revision then raise exception 'Requirements changed. Refresh before saving';end if;
 if jsonb_typeof(p_requirements) is distinct from 'array' or jsonb_array_length(p_requirements)>20 or length(btrim(coalesce(p_note,''))) not between 20 and 2000 then raise exception 'Confirm accepted evidence and the activity/location review basis';end if;
 for item in select value from jsonb_array_elements(p_requirements) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'code','') !~ '^[a-z][a-z0-9_]{1,59}$'
   or length(btrim(coalesce(item->>'label',''))) not between 3 and 120 or length(btrim(coalesce(item->>'instructions',''))) not between 10 and 2000
   or jsonb_typeof(item->'requires_expiry') is distinct from 'boolean' then raise exception 'Each credential needs a unique code, name, accepted alternatives and expiry rule';end if;
 end loop;
 if (select count(distinct value->>'code') from jsonb_array_elements(p_requirements))<>jsonb_array_length(p_requirements) then raise exception 'Credential codes must be unique';end if;
 previous:=current_setting('wehouse.experience_evidence_command',true);perform set_config('wehouse.experience_evidence_command','configure',true);
 update public.experience_activities set credential_requirements=p_requirements,credential_revision=credential_revision+1,
  credential_context=private.experience_evidence_context(p_activity_id),credential_requirements_note=btrim(p_note),credential_requirements_set_at=now(),credential_requirements_set_by=public.current_profile_user_id()
  where id=v.id returning * into v;
 perform set_config('wehouse.experience_evidence_command',coalesce(previous,''),true);
 
 insert into public.audit_logs(action,target_type,target_id,details,admin_id) values('EXPERIENCE_EVIDENCE_REQUIREMENTS_SET','experience',p_activity_id::text,jsonb_build_object('revision',v.credential_revision,'requirements',p_requirements,'basis',btrim(p_note))::text,public.current_profile_user_id());
 return jsonb_build_object('success',true,'revision',v.credential_revision);
end $$;
revoke all on function public.configure_experience_evidence_requirements(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.configure_experience_evidence_requirements(uuid,integer,jsonb,text) to authenticated;

create function public.get_experience_evidence_review(p_activity_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  'can_submit',public.current_profile_user_id()=(select host_user_id from public.experience_activities where id=p_activity_id) and v.credential_requirements is not null and coalesce(context_current,false));
end $$;
revoke all on function public.get_experience_evidence_review(uuid) from public,anon;
grant execute on function public.get_experience_evidence_review(uuid) to authenticated;

create function public.begin_experience_evidence_upload(p_activity_id uuid,p_requirement_code text,p_request_key uuid,p_mime_type text,p_byte_size bigint,p_original_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.experience_activities;d public.experience_evidence_documents;next_version integer;suffix text;
begin
 if public.current_profile_user_id() is distinct from (select host_user_id from public.experience_activities where id=p_activity_id) or not public.can_access_experience_evidence(p_activity_id,false) then raise exception 'The Experience host must upload their evidence';end if;
 perform 1 from public.experience_activities where id=p_activity_id for update;
 select * into v from public.experience_activities where id=p_activity_id for update;
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
revoke all on function public.begin_experience_evidence_upload(uuid,text,uuid,text,bigint,text) from public,anon;
grant execute on function public.begin_experience_evidence_upload(uuid,text,uuid,text,bigint,text) to authenticated;

create function public.finish_experience_evidence_upload(p_document_id uuid,p_discard boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if d.requirements_revision<>v.credential_revision or v.credential_context is distinct from private.experience_evidence_context(d.activity_id) then raise exception 'Requirements changed. Discard this upload and use current requirements';end if;
  select o.metadata into metadata from storage.objects o where o.bucket_id='experience-evidence' and o.name=d.object_path;
  if metadata is null or coalesce((metadata->>'size')::bigint,0)<>d.byte_size or metadata->>'mimetype' is distinct from d.mime_type then raise exception 'The uploaded file has not been confirmed';end if;
  update public.experience_evidence_documents set status='submitted',submitted_at=now() where id=d.id returning * into d;
  
 end if;
 return to_jsonb(d)||jsonb_build_object('request_id',d.activity_id);
end $$;
revoke all on function public.finish_experience_evidence_upload(uuid,boolean) from public,anon;
grant execute on function public.finish_experience_evidence_upload(uuid,boolean) to authenticated;

create function public.review_experience_evidence(p_document_id uuid,p_decision text,p_note text,p_expires_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.experience_evidence_documents;v public.experience_activities;rule jsonb;
begin
 select * into d from public.experience_evidence_documents where id=p_document_id;
 if not public.can_access_experience_evidence(d.activity_id,true) then raise exception 'Independent credential review authority required';end if;
 perform 1 from public.experience_activities where id=d.activity_id for update;
 select * into v from public.experience_activities where id=d.activity_id for update;
 select * into d from public.experience_evidence_documents where id=p_document_id for update;
 if p_decision is null or p_decision not in('approved','correction_required','rejected') or length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Provide a decision and review reason';end if;
 if v.credential_context is distinct from private.experience_evidence_context(d.activity_id) or d.requirements_revision<>v.credential_revision or d.status not in('submitted','approved','correction_required','rejected')
  or exists(select 1 from public.experience_evidence_documents newer where newer.activity_id=d.activity_id and newer.requirements_revision=d.requirements_revision and newer.requirement_code=d.requirement_code and newer.version>d.version and newer.status<>'abandoned') then raise exception 'Review the latest submitted evidence under current requirements';end if;
 select value into rule from jsonb_array_elements(v.credential_requirements) where value->>'code'=d.requirement_code;
 if rule is null or p_decision='approved' and ((rule->>'requires_expiry')::boolean and p_expires_at is null or p_expires_at is not null and p_expires_at<=now()) then raise exception 'Confirm a future expiry for time-limited evidence';end if;
 update public.experience_evidence_documents set status=p_decision,review_note=btrim(p_note),reviewed_by=public.current_profile_user_id(),reviewed_at=now(),expires_at=case when p_decision='approved' then p_expires_at end where id=d.id returning * into d;
 insert into public.audit_logs(action,target_type,target_id,details,admin_id) values('EXPERIENCE_EVIDENCE_REVIEWED','experience',d.activity_id::text,jsonb_build_object('document_id',d.id,'decision',p_decision,'note',btrim(p_note),'expires_at',d.expires_at)::text,public.current_profile_user_id());
 return to_jsonb(d)||jsonb_build_object('request_id',d.activity_id);
end $$;
revoke all on function public.review_experience_evidence(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.review_experience_evidence(uuid,text,text,timestamptz) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('experience-evidence','experience-evidence',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create function public.can_access_experience_evidence_object(p_path text,p_write boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.experience_evidence_documents;v public.experience_activities;
begin
 select * into d from public.experience_evidence_documents where object_path=p_path;
 if d.id is null or not public.can_access_experience_evidence(d.activity_id,false) then return false;end if;
 if not p_write then return true;end if;
 select * into v from public.experience_activities where id=d.activity_id;
 return v.host_user_id=public.current_profile_user_id() and d.status='uploading' and d.requirements_revision=v.credential_revision and v.credential_context=private.experience_evidence_context(d.activity_id);
end $$;
revoke all on function public.can_access_experience_evidence_object(text,boolean) from public,anon;
grant execute on function public.can_access_experience_evidence_object(text,boolean) to authenticated;
create policy experience_evidence_object_read on storage.objects for select to authenticated using(bucket_id='experience-evidence' and public.can_access_experience_evidence_object(name,false));
create policy experience_evidence_object_insert on storage.objects for insert to authenticated with check(bucket_id='experience-evidence' and public.can_access_experience_evidence_object(name,true));
create policy experience_evidence_anon_boundary on storage.objects as restrictive for all to anon using(bucket_id<>'experience-evidence') with check(bucket_id<>'experience-evidence');
create policy experience_evidence_read_boundary on storage.objects as restrictive for select to authenticated using(bucket_id<>'experience-evidence' or public.can_access_experience_evidence_object(name,false));
create policy experience_evidence_insert_boundary on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'experience-evidence' or public.can_access_experience_evidence_object(name,true));
create policy experience_evidence_update_boundary on storage.objects as restrictive for update to authenticated using(bucket_id<>'experience-evidence') with check(bucket_id<>'experience-evidence');
create policy experience_evidence_delete_boundary on storage.objects as restrictive for delete to authenticated using(bucket_id<>'experience-evidence');


create index experience_evidence_reviewer_idx on public.experience_evidence_documents(reviewed_by);
create index experience_evidence_config_actor_idx on public.experience_activities(credential_requirements_set_by);
commit;
