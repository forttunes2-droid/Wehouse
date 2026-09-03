-- A Property Partner proves present access while preparing each property.
-- The private live recording is a prerequisite of submission, not listing media.

create table if not exists public.property_access_challenges (
  id uuid primary key default gen_random_uuid(),
  partner_id text not null references public.profiles(user_id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  video_path text,
  status text not null default 'prepared' check (status in ('prepared','submitted','consumed','expired')),
  submitted_at timestamptz,
  consumed_at timestamptz,
  request_id uuid references public.inspection_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists property_access_challenges_partner_status_idx
  on public.property_access_challenges(partner_id,status,created_at desc);

alter table public.property_access_challenges enable row level security;
revoke all on table public.property_access_challenges from public,anon,authenticated;
grant all on table public.property_access_challenges to service_role;

create or replace function public.create_my_property_access_challenge() returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_row public.property_access_challenges; v_code text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if not public.account_identity_is_current(v_actor.user_id) then raise exception 'Complete the private identity check before adding properties'; end if;
  v_code:=lpad(((('x'||substr(encode(gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at)
  values(v_actor.user_id,v_code,now()+interval '1 hour') returning * into v_row;
  return jsonb_build_object('id',v_row.id,'code',v_row.code,'expires_at',v_row.expires_at);
end $$;

create or replace function public.submit_my_property_access_challenge(p_challenge_id uuid,p_video_path text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','storage' as $$
declare v_actor public.profiles; v_row public.property_access_challenges;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_row from public.property_access_challenges
    where id=p_challenge_id and partner_id=v_actor.user_id for update;
  if v_row.id is null then raise exception 'Property access challenge not found'; end if;
  if v_row.status<>'prepared' then raise exception 'This property access challenge has already been used'; end if;
  if v_row.expires_at<=now() then
    update public.property_access_challenges set status='expired' where id=v_row.id;
    raise exception 'The one-use code expired. Create a new code and record again';
  end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id or split_part(p_video_path,'/',2)<>p_challenge_id::text then
    raise exception 'Invalid private property access path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='property-access-private' and name=p_video_path) then
    raise exception 'Private property access recording was not found';
  end if;
  update public.property_access_challenges set video_path=p_video_path,status='submitted',submitted_at=now()
    where id=v_row.id;
  return jsonb_build_object('success',true,'status','submitted');
end $$;

create or replace function public.create_my_property_inspection_batch_v3(p_items jsonb) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_result jsonb; v_created jsonb; v_item jsonb;
  v_position integer; v_challenge_id uuid; v_challenge public.property_access_challenges; v_request_id uuid;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Add at least one property'; end if;

  -- Lock and validate every one-use recording before creating any property request.
  for v_item,v_position in select value,ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    begin v_challenge_id:=(v_item->>'access_challenge_id')::uuid;
    exception when others then raise exception 'Property %: valid live access recording required',v_position; end;
    select * into v_challenge from public.property_access_challenges
      where id=v_challenge_id and partner_id=v_actor.user_id for update;
    if v_challenge.id is null or v_challenge.status<>'submitted' or v_challenge.video_path is null then
      raise exception 'Property %: complete the live access recording before submitting',v_position;
    end if;
    if v_challenge.expires_at<=now() then raise exception 'Property %: the one-use code expired. Record again',v_position; end if;
  end loop;

  v_result:=public.create_my_property_inspection_batch_v2(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_challenge_id:=(p_items->(v_position-1)->>'access_challenge_id')::uuid;
    select * into v_challenge from public.property_access_challenges where id=v_challenge_id for update;
    update public.inspection_requests set
      access_challenge_code=v_challenge.code,
      access_challenge_expires_at=v_challenge.expires_at,
      access_evidence_video_path=v_challenge.video_path,
      access_evidence_status='submitted',
      access_evidence_submitted_at=v_challenge.submitted_at,
      updated_at=now()
    where id=v_request_id and owner_id=v_actor.user_id;
    update public.property_access_challenges set status='consumed',consumed_at=now(),request_id=v_request_id
      where id=v_challenge_id and partner_id=v_actor.user_id and status='submitted';
    if not found then raise exception 'Property %: access recording was already used',v_position; end if;
  end loop;
  return v_result;
end $$;

-- Assignment is allowed only after an explicit evidence-review decision.
create or replace function public.enforce_property_access_before_assignment() returns trigger
language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
  if new.authority_relationship is not null
     and coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to)
       is distinct from coalesce(old.assigned_field_officer_id,old.field_officer_id,old.assigned_to)
     and new.access_evidence_status<>'verified' then
    raise exception 'Accept the private property access recording before assigning a field visit';
  end if;
  return new;
end $$;

create or replace function public.review_property_access_evidence(p_request_id uuid,p_decision text,p_note text default null) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_request public.inspection_requests; v_status text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and role in ('creator','admin') and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Authorized property reviewer required'; end if;
  select * into v_request from public.inspection_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then raise exception 'Property is outside your assigned area'; end if;
  if v_request.access_evidence_status<>'submitted' or v_request.access_evidence_video_path is null then raise exception 'No submitted property access recording to review'; end if;
  if p_decision not in ('accept','reject') then raise exception 'Choose accept or reject'; end if;
  if p_decision='reject' and nullif(btrim(p_note),'') is null then raise exception 'Explain what must be recorded again'; end if;
  v_status:=case when p_decision='accept' then 'verified' else 'rejected' end;
  update public.inspection_requests set access_evidence_status=v_status,
    access_evidence_verified_at=case when v_status='verified' then now() else null end,
    access_evidence_verified_by=case when v_status='verified' then v_actor.user_id else null end,
    rejection_reason=case when v_status='rejected' then btrim(p_note) else rejection_reason end,
    updated_at=now() where id=p_request_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(case when v_status='verified' then 'PROPERTY_ACCESS_EVIDENCE_ACCEPTED' else 'PROPERTY_ACCESS_EVIDENCE_REJECTED' end,
    'inspection_requests',p_request_id::text,jsonb_build_object('note',nullif(btrim(p_note),''))::text,v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'status',v_status);
end $$;

revoke all on function public.create_my_property_access_challenge(),public.submit_my_property_access_challenge(uuid,text),
  public.create_my_property_inspection_batch_v3(jsonb),public.review_property_access_evidence(uuid,text,text) from public,anon;
grant execute on function public.create_my_property_access_challenge(),public.submit_my_property_access_challenge(uuid,text),
  public.create_my_property_inspection_batch_v3(jsonb),public.review_property_access_evidence(uuid,text,text) to authenticated;

