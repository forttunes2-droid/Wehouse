-- One request-linked, private document workflow. Person-level identity stays
-- separate; no NIN, bank account or public trust claim is stored here.
alter table public.inspection_requests
  add column document_requirements jsonb,
  add column document_requirements_revision integer not null default 0,
  add column document_requirements_set_by text references public.profiles(user_id),
  add column document_requirements_set_at timestamptz,
  add column document_requirements_note text;

create table public.property_submission_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.inspection_requests(id),
  requirement_code text not null,
  requirements_revision integer not null,
  version integer not null check (version > 0),
  request_key uuid not null,
  submitted_by text not null references public.profiles(user_id),
  original_name text not null check (length(original_name) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  object_path text not null unique,
  status text not null default 'uploading' check (status in ('uploading','submitted','approved','correction_required','rejected','abandoned')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text references public.profiles(user_id),
  review_note text,
  expires_at timestamptz,
  unique (submitted_by, request_key),
  unique (request_id, requirement_code, requirements_revision, version)
);
create index property_submission_documents_latest_idx
  on public.property_submission_documents(request_id,requirements_revision,requirement_code,version desc);
create index property_submission_documents_review_idx
  on public.property_submission_documents(request_id,status) where status='submitted';
alter table public.property_submission_documents enable row level security;
revoke all on public.property_submission_documents from public,anon,authenticated;
grant select on public.property_submission_documents to authenticated;
grant all on public.property_submission_documents to service_role;

create function public._property_document_session_active()
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare session_key uuid;
begin
  begin session_key:=nullif(auth.jwt()->>'session_id','')::uuid; exception when invalid_text_representation then return false; end;
  return session_key is not null and exists(select 1 from auth.sessions s where s.id=session_key and s.user_id=(select auth.uid()) and (s.not_after is null or s.not_after>now()));
end $$;
revoke all on function public._property_document_session_active() from public,anon,authenticated;

create function public.can_access_property_documents(p_request_id uuid, p_review boolean default false)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.profiles; r public.inspection_requests;
begin
  if not public._property_document_session_active() then return false; end if;
  select * into a from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if a.user_id is null then return false; end if;
  select * into r from public.inspection_requests where id=p_request_id;
  if r.id is null then return false; end if;
  if not p_review and r.owner_id=a.user_id then return true; end if;
  if public.user_has_active_workspace(a.user_id,'creator') then return true; end if;
  return public.current_actor_in_scope(r.property_state,r.property_city) and (
    public.user_has_active_workspace(a.user_id,'admin') or
    (public.user_has_active_workspace(a.user_id,'staff') and public.current_staff_has_permission('operations'))
  );
end $$;
revoke all on function public.can_access_property_documents(uuid,boolean) from public,anon;
grant execute on function public.can_access_property_documents(uuid,boolean) to authenticated;
create policy property_documents_read on public.property_submission_documents for select to authenticated
  using (public.can_access_property_documents(request_id,false));

create function public._property_document_reviewer(p_request_id uuid)
returns public.profiles language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.profiles; r public.inspection_requests;
begin
  a:=public._current_team_actor();
  if not public.can_access_property_documents(p_request_id,true) then raise exception 'Property document review is outside your authority'; end if;
  select * into r from public.inspection_requests where id=p_request_id;
  if r.owner_id=a.user_id or r.partner_id in (
    select id from public.property_partners where profile_id=a.user_id
  ) then raise exception 'You cannot review documents for your own property'; end if;
  return a;
end $$;
revoke all on function public._property_document_reviewer(uuid) from public,anon,authenticated;

create function public._default_property_document_requirements(p_type text,p_subtype text)
returns jsonb language sql immutable set search_path=pg_catalog as $$
select '[{"code":"authority","label":"Authority to list","instructions":"Ownership evidence or a current signed letting or management authorization identifying the property, parties and permitted use.","requires_expiry":false},{"code":"address","label":"Property address evidence","instructions":"Accepted evidence matching this property address. A utility bill alone does not establish ownership.","requires_expiry":false}]'::jsonb
 || case when p_type='hotel' then '[{"code":"business_registration","label":"Hotel operator registration","instructions":"Applicable operator/entity registration and representative authority. WeHouse must confirm the accepted local forms.","requires_expiry":false},{"code":"operating_permission","label":"Applicable operating permissions","instructions":"WeHouse must specify the locally applicable accommodation, fire, health or other permissions and accepted evidence before collection.","requires_expiry":false}]'::jsonb else '[]'::jsonb end
 || case when p_subtype='long_stay' and p_type<>'hotel' then '[{"code":"tenancy_terms","label":"Proposed tenancy terms","instructions":"Proposed agreement covering term, rent schedule, charges, repairs, utilities, notice, renewal, exit and deposit return. Do not include a prospective tenant identity document.","requires_expiry":false}]'::jsonb
 else '[{"code":"stay_terms","label":"Guest stay terms","instructions":"Arrival/departure, house rules, capacity, mandatory charges, refundable caution where applicable, cancellation/no-show and support terms.","requires_expiry":false}]'::jsonb end
$$;
revoke all on function public._default_property_document_requirements(text,text) from public,anon,authenticated;

create function public.guard_property_document_requirement_command()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    if new.document_requirements is not null or new.document_requirements_revision<>0 or new.document_requirements_set_by is not null
      or new.document_requirements_set_at is not null or new.document_requirements_note is not null or cardinality(new.document_urls)>0 then
      raise exception 'New requests must use the private document workflow';
    end if;
    return new;
  end if;
  if new.document_urls is distinct from old.document_urls then raise exception 'Use the private property document workflow'; end if;
  if (new.document_requirements,new.document_requirements_revision,new.document_requirements_set_by,
      new.document_requirements_set_at,new.document_requirements_note) is distinct from
     (old.document_requirements,old.document_requirements_revision,old.document_requirements_set_by,
      old.document_requirements_set_at,old.document_requirements_note)
     and current_setting('wehouse.property_document_command',true) is distinct from 'configure' then
    raise exception 'Use the scoped property document requirements command';
  end if;
  if (new.property_type,new.sub_type,new.authority_relationship,new.owner_id,new.property_address,new.property_state,new.property_city)
     is distinct from (old.property_type,old.sub_type,old.authority_relationship,old.owner_id,old.property_address,old.property_state,old.property_city)
     and old.document_requirements is not null then
    new.document_requirements:=null; new.document_requirements_set_at:=null;
    new.document_requirements_set_by:=null; new.document_requirements_note:=null;
    new.document_requirements_revision:=old.document_requirements_revision+1;
  end if;
  return new;
end $$;
revoke all on function public.guard_property_document_requirement_command() from public,anon,authenticated;
create trigger guard_property_document_requirement_command before insert or update on public.inspection_requests
  for each row execute function public.guard_property_document_requirement_command();

create function public.configure_property_document_requirements(p_request_id uuid,p_expected_revision integer,p_requirements jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.profiles; r public.inspection_requests; item jsonb; required_code text; previous_command text;
begin
  select * into r from public.inspection_requests where id=p_request_id for update;
  a:=public._property_document_reviewer(p_request_id);
  if r.document_requirements_revision is distinct from p_expected_revision then raise exception 'Requirements changed. Refresh before saving'; end if;
  if jsonb_typeof(p_requirements) is distinct from 'array' then raise exception 'Provide the document requirements'; end if;
  if jsonb_array_length(p_requirements) not between 2 and 20 then raise exception 'Use between 2 and 20 requirements'; end if;
  if length(btrim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'Record the applicable requirements and review basis'; end if;
  for item in select value from jsonb_array_elements(p_requirements) loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'code','') !~ '^[a-z][a-z0-9_]{1,59}$'
       or length(btrim(coalesce(item->>'label',''))) not between 3 and 120
       or length(btrim(coalesce(item->>'instructions',''))) not between 10 and 2000
       or jsonb_typeof(item->'requires_expiry') is distinct from 'boolean' then raise exception 'Each requirement needs a unique code, label, accepted evidence instructions and expiry rule'; end if;
  end loop;
  if (select count(distinct value->>'code') from jsonb_array_elements(p_requirements))<>jsonb_array_length(p_requirements) then raise exception 'Requirement codes must be unique'; end if;
  for required_code in select value->>'code' from jsonb_array_elements(public._default_property_document_requirements(r.property_type,r.sub_type)) loop
    if not exists(select 1 from jsonb_array_elements(p_requirements) x where x->>'code'=required_code) then raise exception 'Required evidence category is missing: %',required_code; end if;
  end loop;
  previous_command:=current_setting('wehouse.property_document_command',true);
  perform set_config('wehouse.property_document_command','configure',true);
  update public.inspection_requests set document_requirements=p_requirements,
    document_requirements_revision=document_requirements_revision+1,document_requirements_set_by=a.user_id,
    document_requirements_set_at=now(),document_requirements_note=btrim(p_note) where id=p_request_id returning * into r;
  perform set_config('wehouse.property_document_command',coalesce(previous_command,''),true);
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    values('PROPERTY_DOCUMENT_REQUIREMENTS_SET','inspection_requests',r.id::text,
      jsonb_build_object('revision',r.document_requirements_revision,'note',btrim(p_note),'requirements',p_requirements)::text,a.user_id,a.email);
  return jsonb_build_object('success',true,'revision',r.document_requirements_revision);
end $$;
revoke all on function public.configure_property_document_requirements(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.configure_property_document_requirements(uuid,integer,jsonb,text) to authenticated;

create function public.get_property_document_review(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r public.inspection_requests; a public.profiles; documents jsonb; ready boolean;
begin
  if not public.can_access_property_documents(p_request_id,false) then raise exception 'Property documents are not available to this account'; end if;
  select * into r from public.inspection_requests where id=p_request_id;
  select * into a from public.profiles where auth_id=(select auth.uid())::text limit 1;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.requirement_code),'[]'::jsonb) into documents from (
    select distinct on (requirement_code) * from public.property_submission_documents
    where request_id=r.id and requirements_revision=r.document_requirements_revision and status<>'abandoned'
    order by requirement_code,version desc
  ) d;
  ready:=r.document_requirements is not null and not exists(
    select 1 from jsonb_array_elements(r.document_requirements) req
    where not exists(select 1 from jsonb_array_elements(documents) doc where doc->>'requirement_code'=req->>'code'
      and doc->>'status'='approved' and (doc->>'expires_at' is null or (doc->>'expires_at')::timestamptz>now()))
  );
  return jsonb_build_object('configured',r.document_requirements is not null,'revision',r.document_requirements_revision,
    'requirements',coalesce(r.document_requirements,public._default_property_document_requirements(r.property_type,r.sub_type)),
    'requirements_note',r.document_requirements_note,'requirements_set_at',r.document_requirements_set_at,
    'documents',documents,'ready',ready,'can_review',public.can_access_property_documents(r.id,true) and a.user_id<>r.owner_id,
    'can_submit',a.user_id=r.owner_id and public.user_has_active_workspace(a.user_id,'property_partner') and r.document_requirements is not null);
end $$;
revoke all on function public.get_property_document_review(uuid) from public,anon;
grant execute on function public.get_property_document_review(uuid) to authenticated;

create function public.begin_property_document_upload(p_request_id uuid,p_requirement_code text,p_request_key uuid,p_mime_type text,p_byte_size bigint,p_original_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.inspection_requests; a public.profiles; d public.property_submission_documents; next_version integer; suffix text;
begin
  select * into r from public.inspection_requests where id=p_request_id for update;
  if not public.can_access_property_documents(p_request_id,false) then raise exception 'Property documents are unavailable'; end if;
  select * into a from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if a.user_id<>r.owner_id or not public.user_has_active_workspace(a.user_id,'property_partner') then raise exception 'The active submitting Property Partner must upload this evidence'; end if;
  if r.document_requirements is null then raise exception 'WeHouse must confirm the applicable requirements before document collection'; end if;
  if not exists(select 1 from jsonb_array_elements(r.document_requirements) x where x->>'code'=p_requirement_code) then raise exception 'Unknown document requirement'; end if;
  if p_request_key is null or p_byte_size is null or p_byte_size not between 1 and 10485760
    or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
    or length(btrim(coalesce(p_original_name,''))) not between 1 and 180 then raise exception 'Choose a PDF, JPG, PNG or WebP document up to 10 MB'; end if;
  select * into d from public.property_submission_documents where submitted_by=a.user_id and request_key=p_request_key;
  if found then
    if (d.request_id,d.requirement_code,d.requirements_revision,d.mime_type,d.byte_size,d.original_name) is distinct from
       (p_request_id,p_requirement_code,r.document_requirements_revision,p_mime_type,p_byte_size,btrim(p_original_name)) then raise exception 'This upload reference belongs to different document details'; end if;
    return to_jsonb(d);
  end if;
  if (select count(*) from public.property_submission_documents where request_id=r.id)>199 then raise exception 'Document revision limit reached. Contact WeHouse Support'; end if;
  if exists(select 1 from public.property_submission_documents where request_id=r.id and requirement_code=p_requirement_code
    and requirements_revision=r.document_requirements_revision and status='uploading') then raise exception 'Finish or discard the unfinished upload before replacing it'; end if;
  select coalesce(max(version),0)+1 into next_version from public.property_submission_documents
    where request_id=r.id and requirement_code=p_requirement_code and requirements_revision=r.document_requirements_revision;
  suffix:=case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  d.id:=gen_random_uuid();
  insert into public.property_submission_documents(id,request_id,requirement_code,requirements_revision,version,request_key,submitted_by,original_name,mime_type,byte_size,object_path)
    values(d.id,r.id,p_requirement_code,r.document_requirements_revision,next_version,p_request_key,a.user_id,btrim(p_original_name),p_mime_type,p_byte_size,r.id::text||'/'||d.id::text||'.'||suffix) returning * into d;
  return to_jsonb(d);
end $$;
revoke all on function public.begin_property_document_upload(uuid,text,uuid,text,bigint,text) from public,anon;
grant execute on function public.begin_property_document_upload(uuid,text,uuid,text,bigint,text) to authenticated;

create function public.finish_property_document_upload(p_document_id uuid,p_discard boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.property_submission_documents; r public.inspection_requests; a public.profiles; metadata jsonb;
begin
  select * into d from public.property_submission_documents where id=p_document_id;
  select * into r from public.inspection_requests where id=d.request_id for update;
  select * into d from public.property_submission_documents where id=p_document_id for update;
  if not public.can_access_property_documents(r.id,false) then raise exception 'Document is not available'; end if;
  select * into a from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if a.user_id<>r.owner_id or a.user_id<>d.submitted_by or not public.user_has_active_workspace(a.user_id,'property_partner') then raise exception 'The active submitting Property Partner must finish this upload'; end if;
  if d.status<>'uploading' then return to_jsonb(d); end if;
  if p_discard then
    update public.property_submission_documents set status='abandoned' where id=d.id returning * into d;
    return to_jsonb(d);
  end if;
  if r.document_requirements is null or d.requirements_revision<>r.document_requirements_revision then raise exception 'Requirements changed. Discard this upload and use the current requirements'; end if;
  select o.metadata into metadata from storage.objects o where o.bucket_id='property-documents' and o.name=d.object_path;
  if metadata is null or coalesce((metadata->>'size')::bigint,0)<>d.byte_size or metadata->>'mimetype' is distinct from d.mime_type then raise exception 'The uploaded file has not been confirmed. Retry the same upload reference'; end if;
  update public.property_submission_documents set status='submitted',submitted_at=now() where id=d.id returning * into d;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    values('PROPERTY_DOCUMENT_SUBMITTED','inspection_requests',r.id::text,jsonb_build_object('document_id',d.id,'requirement',d.requirement_code,'revision',d.requirements_revision,'version',d.version)::text,a.user_id,a.email);
  return to_jsonb(d);
end $$;
revoke all on function public.finish_property_document_upload(uuid,boolean) from public,anon;
grant execute on function public.finish_property_document_upload(uuid,boolean) to authenticated;

create function public.review_property_document(p_document_id uuid,p_decision text,p_note text,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.property_submission_documents; r public.inspection_requests; a public.profiles; rule jsonb;
begin
  select * into d from public.property_submission_documents where id=p_document_id;
  select * into r from public.inspection_requests where id=d.request_id for update;
  a:=public._property_document_reviewer(r.id);
  select * into d from public.property_submission_documents where id=p_document_id for update;
  if p_decision is null or p_decision not in ('approved','correction_required','rejected') then raise exception 'Choose a document review decision'; end if;
  if length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Record a review reason or the correction needed'; end if;
  if r.document_requirements is null or d.requirements_revision<>r.document_requirements_revision or d.status not in ('submitted','approved','correction_required','rejected')
    or exists(select 1 from public.property_submission_documents other where other.request_id=r.id and other.requirement_code=d.requirement_code
      and other.requirements_revision=d.requirements_revision and other.version>d.version and other.status<>'abandoned') then raise exception 'Review the latest submitted document under the current requirements'; end if;
  select value into rule from jsonb_array_elements(r.document_requirements) where value->>'code'=d.requirement_code;
  if rule is null then raise exception 'Document requirement changed'; end if;
  if p_decision='approved' and ((rule->>'requires_expiry')::boolean and p_expires_at is null
    or p_expires_at is not null and p_expires_at<=now()) then raise exception 'Record a future expiry for time-limited evidence'; end if;
  update public.property_submission_documents set status=p_decision,review_note=btrim(p_note),reviewed_by=a.user_id,reviewed_at=now(),
    expires_at=case when p_decision='approved' then p_expires_at else null end where id=d.id returning * into d;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    values('PROPERTY_DOCUMENT_REVIEWED','inspection_requests',r.id::text,jsonb_build_object('document_id',d.id,'requirement',d.requirement_code,'decision',p_decision,'note',btrim(p_note),'expires_at',d.expires_at)::text,a.user_id,a.email);
  return to_jsonb(d);
end $$;
revoke all on function public.review_property_document(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.review_property_document(uuid,text,text,timestamptz) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('property-documents','property-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create function public.can_access_property_document_object(p_path text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare d public.property_submission_documents; a text;
begin
  select * into d from public.property_submission_documents where object_path=p_path;
  if d.id is null or not public.can_access_property_documents(d.request_id,false) then return false; end if;
  if not p_write then return true; end if;
  select user_id into a from public.profiles where auth_id=(select auth.uid())::text limit 1;
  return d.status='uploading' and d.submitted_by=a and public.user_has_active_workspace(a,'property_partner')
    and exists(select 1 from public.inspection_requests r where r.id=d.request_id and r.owner_id=a
      and r.document_requirements is not null and r.document_requirements_revision=d.requirements_revision);
end $$;
revoke all on function public.can_access_property_document_object(text,boolean) from public,anon;
grant execute on function public.can_access_property_document_object(text,boolean) to authenticated;
create policy property_documents_object_read on storage.objects for select to authenticated
  using(bucket_id='property-documents' and public.can_access_property_document_object(name,false));
create policy property_documents_object_insert on storage.objects for insert to authenticated
  with check(bucket_id='property-documents' and public.can_access_property_document_object(name,true));
-- Restrictive boundaries also apply if older permissive Storage policies exist.
create policy property_documents_anonymous_boundary on storage.objects as restrictive for all to anon
  using(bucket_id<>'property-documents') with check(bucket_id<>'property-documents');
create policy property_documents_read_boundary on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'property-documents' or public.can_access_property_document_object(name,false));
create policy property_documents_insert_boundary on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'property-documents' or public.can_access_property_document_object(name,true));
create policy property_documents_update_boundary on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'property-documents') with check(bucket_id<>'property-documents');
create policy property_documents_delete_boundary on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'property-documents');
-- No overwrite or deletion of submitted evidence. Retention/deletion is an
-- authorized server process; this migration does not invent its retention period.

create function public._assert_property_documents_ready(p_request_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.inspection_requests; rule jsonb; d public.property_submission_documents;
begin
  select * into r from public.inspection_requests where id=p_request_id;
  if r.id is null or r.document_requirements is null or r.document_requirements_set_at is null then raise exception 'Confirm and review the required property documents before publication'; end if;
  for rule in select value from jsonb_array_elements(r.document_requirements) loop
    select * into d from public.property_submission_documents where request_id=r.id and requirement_code=rule->>'code'
      and requirements_revision=r.document_requirements_revision and status<>'abandoned' order by version desc limit 1;
    if d.id is null or d.status<>'approved' or d.reviewed_by is null or d.reviewed_at is null or d.reviewed_by=r.owner_id
      or (rule->>'requires_expiry')::boolean and d.expires_at is null
      or d.expires_at is not null and d.expires_at<=now() then raise exception 'Required document is missing, awaiting review or expired: %',rule->>'label'; end if;
  end loop;
end $$;
revoke all on function public._assert_property_documents_ready(uuid) from public,anon,authenticated;

create or replace function public.guard_inspected_public_listing()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare v_status text; was_public boolean:=false;
begin
  if tg_op='UPDATE' then was_public:=old.status='available' or old.availability_status='available'; end if;
  if new.status='available' or new.availability_status='available' then
    if new.inspection_request_id is null or new.approved_by is null or new.approved_at is null then raise exception 'Public listings must come through the completed inspection publication workflow'; end if;
    select status into v_status from public.inspection_requests where id=new.inspection_request_id;
    if v_status is null or v_status not in ('completed','approved') then raise exception 'Linked inspection must be complete before publication'; end if;
    if not was_public then perform public._assert_property_documents_ready(new.inspection_request_id); end if;
  end if;
  return new;
end $$;
create or replace function public.guard_inspected_public_hotel()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare v_status text; was_public boolean:=false;
begin
  if tg_op='UPDATE' then was_public:=old.status='active'; end if;
  if new.status='active' then
    if new.inspection_request_id is null or new.approved_by is null or new.approved_at is null then raise exception 'Public hotels must come through the inspection publication workflow'; end if;
    select status into v_status from public.inspection_requests where id=new.inspection_request_id;
    if v_status is null or v_status not in ('completed','approved') then raise exception 'Linked inspection must be complete before publication'; end if;
    if not was_public then perform public._assert_property_documents_ready(new.inspection_request_id); end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_inspected_public_listing(),public.guard_inspected_public_hotel() from public,anon,authenticated;
