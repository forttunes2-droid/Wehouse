-- Restore the accepted operating-choice contract without replaying old history.
-- The current batch body keeps its authority, identity and numeric validations.
alter table public.inspection_requests add column if not exists requested_management_mode text check(requested_management_mode in ('host','wehouse'));
CREATE OR REPLACE FUNCTION public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
  v_created jsonb;
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_max_guests integer;
  v_display_name text;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  if not exists(
    select 1 from public.property_submission_batches batch
    where batch.id=p_batch_id
      and batch.partner_user_id=v_auth_id
      and batch.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches
  set status='submitting',updated_at=now() where id=p_batch_id;
  perform public._validate_property_submission_facts(p_items);
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'property_type'='apartment' and coalesce(v_item->>'management_mode','') not in ('host','wehouse') then
      raise exception 'Choose who will manage each home before submission';
    end if;
  end loop;
  v_result:=public.create_my_property_inspection_batch_v3(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_item:=p_items->(v_position-1);
    v_max_guests:=nullif(v_item->>'max_guests','')::integer;
    v_display_name:=nullif(btrim(coalesce(v_item->>'property_display_name','')),'');
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',v_position;
    end if;
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and v_display_name is null then
      raise exception 'Property %: Short Let property or host name is required',v_position;
    end if;
    update public.inspection_requests set
      requested_management_mode=case when v_item->>'property_type'='apartment' then v_item->>'management_mode' else null end,
      submission_schema_version=2,
      hotel_program=case when v_item->>'property_type'='hotel'
        then v_item->'hotel_program' else null end,
      max_guests=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_max_guests else null end,
      property_display_name=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_display_name else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=v_request_id and owner_id=v_actor;
    update public.property_submission_items
    set inspection_request_id=v_request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches
  set status='submitted',submitted_at=now(),updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  return v_result||jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches
  set status='draft',updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  raise;
end;
$function$;
revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb) from public,anon; grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb) to authenticated,service_role;

create or replace function public.apply_requested_property_management()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.draft_listing_id is null or new.requested_management_mode is null then return new; end if;
  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=new.requested_management_mode,
      management_host_user_id=case when new.requested_management_mode='host' then new.owner_id else null end,
      wehouse_management_status=case when new.requested_management_mode='host' then 'not_required' else 'requested' end,
      management_updated_at=now(),updated_at=now()
  where id=new.draft_listing_id and approved_at is null and deleted_at is null
    and inspection_request_id=new.id and partner_id=new.owner_id;
  return new;
end
$$;
drop trigger if exists inspection_requested_management_to_draft on public.inspection_requests;
create trigger inspection_requested_management_to_draft
after insert or update of requested_management_mode,draft_listing_id on public.inspection_requests
for each row execute function public.apply_requested_property_management();

create or replace function public.prevent_published_request_operator_change()
returns trigger language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if (new.requested_management_mode is distinct from old.requested_management_mode
      or new.draft_listing_id is distinct from old.draft_listing_id)
     and (old.published_at is not null or exists(
       select 1 from public.listings l
       where l.id=old.draft_listing_id and l.approved_at is not null
     )) then
    raise exception 'A live home cannot change operator without a reviewed handoff';
  end if;
  return new;
end
$$;
drop trigger if exists inspection_prevent_published_operator_change on public.inspection_requests;
create trigger inspection_prevent_published_operator_change
before update of requested_management_mode,draft_listing_id on public.inspection_requests
for each row execute function public.prevent_published_request_operator_change();

create or replace function public.set_my_property_request_management_mode(p_request_id uuid,p_mode text)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_request public.inspection_requests;
begin
  if p_mode is null or p_mode not in ('host','wehouse') then raise exception 'Choose Host or WeHouse management'; end if;
  select * into v_request from public.inspection_requests
  where id=p_request_id and owner_id=v_actor and property_type='apartment' for update;
  if v_request.id is null then raise exception 'Your property request was not found'; end if;
  if v_request.published_at is not null or exists(select 1 from public.listings
    where id=v_request.draft_listing_id and approved_at is not null) then
    raise exception 'A live home cannot change operator without a reviewed handoff';
  end if;
  update public.inspection_requests set requested_management_mode=p_mode,updated_at=now()
  where id=p_request_id;
  return true;
end
$$;
revoke all on function public.set_my_property_request_management_mode(uuid,text) from public,anon;
grant execute on function public.set_my_property_request_management_mode(uuid,text) to authenticated,service_role;

create or replace function public.require_management_before_property_publication()
returns trigger language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if new.approved_at is null then return new; end if;
  if tg_op='UPDATE' and old.approved_at is not null then return new; end if;
  if new.inspection_request_id is not null and new.partner_id is not null
     and (new.management_updated_at is null or not exists(
       select 1 from public.inspection_requests r
       where r.id=new.inspection_request_id and r.owner_id=new.partner_id
         and r.requested_management_mode=new.management_mode
     )) then
    raise exception 'Property Partner must choose who manages this home before publication';
  end if;
  return new;
end
$$;
drop trigger if exists listings_management_choice_before_publication on public.listings;
create trigger listings_management_choice_before_publication
before insert or update of approved_at on public.listings
for each row execute function public.require_management_before_property_publication();

-- Legacy published homes may make one initial choice. A configured live home
-- cannot silently change operator, including through a direct RPC call.
create or replace function public.set_my_property_management_mode(p_listing_id uuid,p_mode text)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode is null or p_mode not in ('host','wehouse') then raise exception 'Choose Host or WeHouse management'; end if;
  if not exists(select 1 from public.property_host_assignments a
    where a.listing_id=p_listing_id and a.user_id=v_actor
      and a.assignment_role='owner' and a.status='active') then
    raise exception 'Only the property owner can choose who manages this home';
  end if;
  select * into v_listing from public.listings
  where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.approved_at is null then
    raise exception 'Choose management in the property request before publication';
  end if;
  if v_listing.management_updated_at is not null then
    if v_listing.management_mode=p_mode then return public.get_my_property_management(p_listing_id); end if;
    raise exception 'This live home has an operator. Ask WeHouse to review a handoff for future bookings';
  end if;
  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings set management_mode=p_mode,
    management_host_user_id=case when p_mode='host' then v_actor else null end,
    wehouse_management_status=case when p_mode='host' then 'not_required' else 'requested' end,
    management_updated_at=now(),updated_at=now()
  where id=p_listing_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'legacy_property_management_choice','listing',p_listing_id::text,
    jsonb_build_object('management_mode',p_mode)::text,now());
  return public.get_my_property_management(p_listing_id);
end
$$;
revoke all on function public.set_my_property_management_mode(uuid,text) from public,anon;
grant execute on function public.set_my_property_management_mode(uuid,text) to authenticated,service_role;

comment on function public.set_my_property_management_mode(uuid,text)
is 'Owner-only initial legacy operating choice. A configured live home requires a reviewed handoff.';

-- The active v4 command now calls v3 directly; its obsolete historical wrapper
-- base has no application or contract-test consumer.
drop function if exists public.create_my_property_inspection_batch_v4_base(uuid,jsonb);