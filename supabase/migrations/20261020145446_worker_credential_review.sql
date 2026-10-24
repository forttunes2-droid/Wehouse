begin;
-- Requirements extend the existing verification aggregate. Credential evidence
-- does not create another Worker identity or replace account-level KYC.
alter table public.worker_verifications
 add column credential_requirements jsonb,
 add column credential_revision integer not null default 0,
 add column credential_context jsonb,
 add column credential_requirements_note text,
 add column credential_requirements_set_at timestamptz,
 add column credential_requirements_set_by text references public.profiles(user_id);
create table public.worker_credential_documents (
 id uuid primary key default gen_random_uuid(),
 worker_id text not null references public.profiles(user_id),
 requirement_code text not null,requirements_revision integer not null,version integer not null check(version>0),
 request_key uuid not null,original_name text not null check(length(original_name) between 1 and 180),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 byte_size bigint not null check(byte_size between 1 and 10485760),object_path text not null unique,
 status text not null default 'uploading' check(status in ('uploading','submitted','approved','correction_required','rejected','abandoned')),
 created_at timestamptz not null default now(),submitted_at timestamptz,reviewed_at timestamptz,
 reviewed_by text references public.profiles(user_id),review_note text,expires_at timestamptz,
 unique(worker_id,request_key),unique(worker_id,requirement_code,requirements_revision,version)
);
create index worker_credentials_latest_idx on public.worker_credential_documents(worker_id,requirements_revision,requirement_code,version desc);
alter table public.worker_credential_documents enable row level security;
revoke all on public.worker_credential_documents from public,anon,authenticated;
grant select on public.worker_credential_documents to authenticated;
grant all on public.worker_credential_documents to service_role;

create function private.worker_credential_context(p_worker_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('occupation',p.worker_occupation,'skills',p.worker_skills,'country',p.country,'state',p.state,
  'category_id',v.service_category_id,'subcategory_id',v.service_subcategory_id,
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('state',c.state,'lga',c.lga) order by c.state,c.lga) from public.worker_service_coverage c where c.worker_id=p.user_id),'[]'::jsonb))
 from public.profiles p left join public.worker_verifications v on v.worker_id=p.user_id where p.user_id=p_worker_id;
$$;
revoke all on function private.worker_credential_context(text) from public,anon,authenticated;

create function public.can_access_worker_credentials(p_worker_id text,p_review boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare a text:=public.current_profile_user_id(); session_id uuid;
begin
 begin session_id:=nullif(auth.jwt()->>'session_id','')::uuid;exception when invalid_text_representation then return false;end;
 if a is null or session_id is null or not public.auth_session_is_active(auth.uid(),session_id)
  or exists(select 1 from public.user_sessions s where s.auth_id=auth.uid()::text and s.auth_session_id=session_id::text and s.trust_status<>'trusted') then return false;end if;
 if not public.user_has_active_workspace(p_worker_id,'worker') then return false;end if;
 if a=p_worker_id then return not p_review;end if;
 if public.current_actor_has_workspace('creator',null) then
  return exists(select 1 from public.creator_elevation_grants g where public.creator_has_elevation(g.creator_elevation_id,'private_evidence'));
 end if;
 return public.current_staff_can_review_worker(p_worker_id) or public.current_oversight_can_review_worker(p_worker_id);
end $$;
revoke all on function public.can_access_worker_credentials(text,boolean) from public,anon;
grant execute on function public.can_access_worker_credentials(text,boolean) to authenticated;
create policy worker_credentials_read on public.worker_credential_documents for select to authenticated using(public.can_access_worker_credentials(worker_id,false));

create function private.worker_credentials_current(p_worker_id text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.worker_verifications v where v.worker_id=p_worker_id and v.credential_requirements is not null
  and v.credential_context=private.worker_credential_context(p_worker_id)
  and not exists(select 1 from jsonb_array_elements(v.credential_requirements) rule where not exists(
   select 1 from public.worker_credential_documents d where d.worker_id=p_worker_id and d.requirements_revision=v.credential_revision
    and d.requirement_code=rule->>'code' and d.status='approved' and (d.expires_at is null or d.expires_at>now())
    and (not coalesce((rule->>'requires_expiry')::boolean,false) or d.expires_at is not null)
    and not exists(select 1 from public.worker_credential_documents newer where newer.worker_id=d.worker_id and newer.requirements_revision=d.requirements_revision
     and newer.requirement_code=d.requirement_code and newer.version>d.version and newer.status<>'abandoned'))));
$$;
revoke all on function private.worker_credentials_current(text) from public,anon,authenticated;

create function private.guard_worker_credential_fields() returns trigger language plpgsql set search_path='' as $$
begin
 if current_setting('wehouse.worker_credential_command',true) is distinct from 'configure' then
  if tg_op='INSERT' then
   if new.credential_requirements is not null or new.credential_revision<>0 or new.credential_context is not null or new.credential_requirements_set_by is not null or new.credential_requirements_set_at is not null or new.credential_requirements_note is not null then raise exception 'Use credential requirement review';end if;
  elsif row(new.credential_requirements,new.credential_revision,new.credential_context,new.credential_requirements_note,new.credential_requirements_set_at,new.credential_requirements_set_by)
    is distinct from row(old.credential_requirements,old.credential_revision,old.credential_context,old.credential_requirements_note,old.credential_requirements_set_at,old.credential_requirements_set_by) then raise exception 'Use credential requirement review';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_worker_credential_fields() from public,anon,authenticated;
create trigger worker_credential_fields before insert or update on public.worker_verifications for each row execute function private.guard_worker_credential_fields();

create function public.configure_worker_credential_requirements(p_worker_id text,p_expected_revision integer,p_requirements jsonb,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.worker_verifications;item jsonb;previous text;
begin
 if not public.can_access_worker_credentials(p_worker_id,true) then raise exception 'Credential review is outside your authority or requires fresh Creator confirmation';end if;
 perform 1 from public.profiles where user_id=p_worker_id for update;
 select * into v from public.worker_verifications where worker_id=p_worker_id for update;
 if v.id is null then raise exception 'The Worker must save professional evidence first';end if;
 if v.credential_revision is distinct from p_expected_revision then raise exception 'Requirements changed. Refresh before saving';end if;
 if jsonb_typeof(p_requirements) is distinct from 'array' or jsonb_array_length(p_requirements)>20 or length(btrim(coalesce(p_note,''))) not between 20 and 2000 then raise exception 'Confirm accepted evidence and the service/location review basis';end if;
 for item in select value from jsonb_array_elements(p_requirements) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'code','') !~ '^[a-z][a-z0-9_]{1,59}$'
   or length(btrim(coalesce(item->>'label',''))) not between 3 and 120 or length(btrim(coalesce(item->>'instructions',''))) not between 10 and 2000
   or jsonb_typeof(item->'requires_expiry') is distinct from 'boolean' then raise exception 'Each credential needs a unique code, name, accepted alternatives and expiry rule';end if;
 end loop;
 if (select count(distinct value->>'code') from jsonb_array_elements(p_requirements))<>jsonb_array_length(p_requirements) then raise exception 'Credential codes must be unique';end if;
 previous:=current_setting('wehouse.worker_credential_command',true);perform set_config('wehouse.worker_credential_command','configure',true);
 update public.worker_verifications set credential_requirements=p_requirements,credential_revision=credential_revision+1,
  credential_context=private.worker_credential_context(p_worker_id),credential_requirements_note=btrim(p_note),credential_requirements_set_at=now(),credential_requirements_set_by=public.current_profile_user_id()
  where id=v.id returning * into v;
 perform set_config('wehouse.worker_credential_command',coalesce(previous,''),true);
 update public.profiles set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() where user_id=p_worker_id;
 insert into public.audit_logs(action,target_type,target_id,details,admin_id) values('WORKER_CREDENTIAL_REQUIREMENTS_SET','worker',p_worker_id,jsonb_build_object('revision',v.credential_revision,'requirements',p_requirements,'basis',btrim(p_note))::text,public.current_profile_user_id());
 return jsonb_build_object('success',true,'revision',v.credential_revision);
end $$;
revoke all on function public.configure_worker_credential_requirements(text,integer,jsonb,text) from public,anon;
grant execute on function public.configure_worker_credential_requirements(text,integer,jsonb,text) to authenticated;

create function public.get_worker_credential_review(p_worker_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.worker_verifications;docs jsonb;context_current boolean;
begin
 if not public.can_access_worker_credentials(p_worker_id,false) then raise exception 'Credentials are unavailable to this account or require fresh Creator confirmation';end if;
 select * into v from public.worker_verifications where worker_id=p_worker_id;
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('request_id',d.worker_id) order by d.requirement_code),'[]'::jsonb) into docs from(
  select distinct on(requirement_code) * from public.worker_credential_documents where worker_id=p_worker_id and requirements_revision=v.credential_revision and status<>'abandoned' order by requirement_code,version desc)d;
 context_current:=v.credential_context=private.worker_credential_context(p_worker_id);
 return jsonb_build_object('configured',v.credential_requirements is not null,'revision',coalesce(v.credential_revision,0),'context_current',coalesce(context_current,false),
  'requirements',coalesce(v.credential_requirements,'[]'::jsonb),'requirements_note',v.credential_requirements_note,'requirements_set_at',v.credential_requirements_set_at,
  'documents',docs,'ready',private.worker_credentials_current(p_worker_id),'can_review',public.can_access_worker_credentials(p_worker_id,true),
  'can_submit',public.current_profile_user_id()=p_worker_id and v.credential_requirements is not null and coalesce(context_current,false));
end $$;
revoke all on function public.get_worker_credential_review(text) from public,anon;
grant execute on function public.get_worker_credential_review(text) to authenticated;

create function public.begin_worker_credential_upload(p_worker_id text,p_requirement_code text,p_request_key uuid,p_mime_type text,p_byte_size bigint,p_original_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.worker_verifications;d public.worker_credential_documents;next_version integer;suffix text;
begin
 if public.current_profile_user_id() is distinct from p_worker_id or not public.can_access_worker_credentials(p_worker_id,false) then raise exception 'The active Worker must upload their evidence';end if;
 perform 1 from public.profiles where user_id=p_worker_id for update;
 select * into v from public.worker_verifications where worker_id=p_worker_id for update;
 if v.credential_requirements is null or v.credential_context is distinct from private.worker_credential_context(p_worker_id) then raise exception 'WeHouse must confirm the service/location requirements first';end if;
 if not exists(select 1 from jsonb_array_elements(v.credential_requirements) r where r->>'code'=p_requirement_code) then raise exception 'Unknown credential requirement';end if;
 if p_request_key is null or p_mime_type is null or p_mime_type not in('application/pdf','image/jpeg','image/png','image/webp') or p_byte_size is null or p_byte_size not between 1 and 10485760 or length(btrim(coalesce(p_original_name,''))) not between 1 and 180 then raise exception 'Choose a PDF, JPG, PNG or WebP up to 10 MB';end if;
 select * into d from public.worker_credential_documents where worker_id=p_worker_id and request_key=p_request_key;
 if found then
  if row(d.requirement_code,d.requirements_revision,d.mime_type,d.byte_size,d.original_name) is distinct from row(p_requirement_code,v.credential_revision,p_mime_type,p_byte_size,btrim(p_original_name)) then raise exception 'Upload reference belongs to different evidence';end if;
  return to_jsonb(d)||jsonb_build_object('request_id',d.worker_id);
 end if;
 if (select count(*) from public.worker_credential_documents where worker_id=p_worker_id)>=200 then raise exception 'Credential revision limit reached. Contact Support';end if;
 if exists(select 1 from public.worker_credential_documents where worker_id=p_worker_id and requirement_code=p_requirement_code and requirements_revision=v.credential_revision and status='uploading') then raise exception 'Confirm or discard the unfinished upload first';end if;
 select coalesce(max(version),0)+1 into next_version from public.worker_credential_documents where worker_id=p_worker_id and requirement_code=p_requirement_code and requirements_revision=v.credential_revision;
 suffix:=case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;d.id:=gen_random_uuid();
 insert into public.worker_credential_documents(id,worker_id,requirement_code,requirements_revision,version,request_key,original_name,mime_type,byte_size,object_path)
  values(d.id,p_worker_id,p_requirement_code,v.credential_revision,next_version,p_request_key,btrim(p_original_name),p_mime_type,p_byte_size,p_worker_id||'/'||d.id::text||'.'||suffix) returning * into d;
 return to_jsonb(d)||jsonb_build_object('request_id',d.worker_id);
end $$;
revoke all on function public.begin_worker_credential_upload(text,text,uuid,text,bigint,text) from public,anon;
grant execute on function public.begin_worker_credential_upload(text,text,uuid,text,bigint,text) to authenticated;

create function public.finish_worker_credential_upload(p_document_id uuid,p_discard boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.worker_credential_documents;v public.worker_verifications;metadata jsonb;
begin
 select * into d from public.worker_credential_documents where id=p_document_id;
 if d.id is null or public.current_profile_user_id() is distinct from d.worker_id or not public.can_access_worker_credentials(d.worker_id,false) then raise exception 'This upload is unavailable';end if;
 perform 1 from public.profiles where user_id=d.worker_id for update;
 select * into v from public.worker_verifications where worker_id=d.worker_id for update;
 select * into d from public.worker_credential_documents where id=p_document_id for update;
 if d.status<>'uploading' then return to_jsonb(d)||jsonb_build_object('request_id',d.worker_id);end if;
 if p_discard then update public.worker_credential_documents set status='abandoned' where id=d.id returning * into d;
 else
  if d.requirements_revision<>v.credential_revision or v.credential_context is distinct from private.worker_credential_context(d.worker_id) then raise exception 'Requirements changed. Discard this upload and use current requirements';end if;
  select o.metadata into metadata from storage.objects o where o.bucket_id='worker-credentials' and o.name=d.object_path;
  if metadata is null or coalesce((metadata->>'size')::bigint,0)<>d.byte_size or metadata->>'mimetype' is distinct from d.mime_type then raise exception 'The uploaded file has not been confirmed';end if;
  update public.worker_credential_documents set status='submitted',submitted_at=now() where id=d.id returning * into d;
  update public.profiles set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() where user_id=d.worker_id;
 end if;
 return to_jsonb(d)||jsonb_build_object('request_id',d.worker_id);
end $$;
revoke all on function public.finish_worker_credential_upload(uuid,boolean) from public,anon;
grant execute on function public.finish_worker_credential_upload(uuid,boolean) to authenticated;

create function public.review_worker_credential(p_document_id uuid,p_decision text,p_note text,p_expires_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.worker_credential_documents;v public.worker_verifications;rule jsonb;
begin
 select * into d from public.worker_credential_documents where id=p_document_id;
 if not public.can_access_worker_credentials(d.worker_id,true) then raise exception 'Independent credential review authority required';end if;
 perform 1 from public.profiles where user_id=d.worker_id for update;
 select * into v from public.worker_verifications where worker_id=d.worker_id for update;
 select * into d from public.worker_credential_documents where id=p_document_id for update;
 if p_decision is null or p_decision not in('approved','correction_required','rejected') or length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Provide a decision and review reason';end if;
 if v.credential_context is distinct from private.worker_credential_context(d.worker_id) or d.requirements_revision<>v.credential_revision or d.status not in('submitted','approved','correction_required','rejected')
  or exists(select 1 from public.worker_credential_documents newer where newer.worker_id=d.worker_id and newer.requirements_revision=d.requirements_revision and newer.requirement_code=d.requirement_code and newer.version>d.version and newer.status<>'abandoned') then raise exception 'Review the latest submitted evidence under current requirements';end if;
 select value into rule from jsonb_array_elements(v.credential_requirements) where value->>'code'=d.requirement_code;
 if rule is null or p_decision='approved' and ((rule->>'requires_expiry')::boolean and p_expires_at is null or p_expires_at is not null and p_expires_at<=now()) then raise exception 'Confirm a future expiry for time-limited evidence';end if;
 update public.worker_credential_documents set status=p_decision,review_note=btrim(p_note),reviewed_by=public.current_profile_user_id(),reviewed_at=now(),expires_at=case when p_decision='approved' then p_expires_at end where id=d.id returning * into d;
 insert into public.audit_logs(action,target_type,target_id,details,admin_id) values('WORKER_CREDENTIAL_REVIEWED','worker',d.worker_id,jsonb_build_object('document_id',d.id,'decision',p_decision,'note',btrim(p_note),'expires_at',d.expires_at)::text,public.current_profile_user_id());
 return to_jsonb(d)||jsonb_build_object('request_id',d.worker_id);
end $$;
revoke all on function public.review_worker_credential(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.review_worker_credential(uuid,text,text,timestamptz) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('worker-credentials','worker-credentials',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create function public.can_access_worker_credential_object(p_path text,p_write boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.worker_credential_documents;v public.worker_verifications;
begin
 select * into d from public.worker_credential_documents where object_path=p_path;
 if d.id is null or not public.can_access_worker_credentials(d.worker_id,false) then return false;end if;
 if not p_write then return true;end if;
 select * into v from public.worker_verifications where worker_id=d.worker_id;
 return d.worker_id=public.current_profile_user_id() and d.status='uploading' and d.requirements_revision=v.credential_revision and v.credential_context=private.worker_credential_context(d.worker_id);
end $$;
revoke all on function public.can_access_worker_credential_object(text,boolean) from public,anon;
grant execute on function public.can_access_worker_credential_object(text,boolean) to authenticated;
create policy worker_credential_object_read on storage.objects for select to authenticated using(bucket_id='worker-credentials' and public.can_access_worker_credential_object(name,false));
create policy worker_credential_object_insert on storage.objects for insert to authenticated with check(bucket_id='worker-credentials' and public.can_access_worker_credential_object(name,true));
create policy worker_credential_anon_boundary on storage.objects as restrictive for all to anon using(bucket_id<>'worker-credentials') with check(bucket_id<>'worker-credentials');
create policy worker_credential_read_boundary on storage.objects as restrictive for select to authenticated using(bucket_id<>'worker-credentials' or public.can_access_worker_credential_object(name,false));
create policy worker_credential_insert_boundary on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'worker-credentials' or public.can_access_worker_credential_object(name,true));
create policy worker_credential_update_boundary on storage.objects as restrictive for update to authenticated using(bucket_id<>'worker-credentials') with check(bucket_id<>'worker-credentials');
create policy worker_credential_delete_boundary on storage.objects as restrictive for delete to authenticated using(bucket_id<>'worker-credentials');

-- Every existing review route updates this profile; this guard prevents any of
-- them bypassing credentials. Ongoing bookings are not cancelled on expiry.
create function private.guard_worker_credential_publication() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.worker_verified and (tg_op='INSERT' or old.worker_verified is distinct from true or old.worker_status is distinct from new.worker_status)
  and public.current_profile_user_id()=new.user_id then raise exception 'Another authorized reviewer must approve your Worker profile';end if;
 if new.worker_verified and (tg_op='INSERT' or old.worker_verified is distinct from true or old.worker_status is distinct from new.worker_status)
  and not private.worker_credentials_current(new.user_id) then raise exception 'Current service and location credentials must be reviewed before Worker approval';end if;
 return new;
end $$;
revoke all on function private.guard_worker_credential_publication() from public,anon,authenticated;
create trigger zz_worker_credential_publication before insert or update on public.profiles for each row execute function private.guard_worker_credential_publication();

-- Preserve the function OID and its grants: RLS expressions may depend on that
-- exact object. Moving/renaming it would leave those dependencies on the old gate.
do $upgrade$
declare definition text:=pg_get_functiondef('public._worker_publication_state(text)'::regprocedure);
 needle text:=$needle$return jsonb_build_object('eligible',cardinality$needle$;
begin
 if position(needle in definition)=0 then raise exception 'Inspect the current Worker publication gate before upgrading';end if;
 definition:=replace(definition,needle,$replacement$if not private.worker_credentials_current(p_worker_id) then
  reasons:=array_append(reasons,'Service and location credential review is incomplete or expired');end if;
 return jsonb_build_object('eligible',cardinality$replacement$);
 execute definition;
end $upgrade$;

create function private.guard_new_worker_job_credentials() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or old.worker_id is distinct from new.worker_id or coalesce(new.worker_approved,false) and not coalesce(old.worker_approved,false)) and not private.worker_credentials_current(new.worker_id) then raise exception 'The service provider needs current credential approval before accepting new work';end if;
 return new;
end $$;
revoke all on function private.guard_new_worker_job_credentials() from public,anon,authenticated;
create trigger worker_job_credential_gate before insert or update of worker_id,worker_approved on public.worker_bookings for each row execute function private.guard_new_worker_job_credentials();
commit;
