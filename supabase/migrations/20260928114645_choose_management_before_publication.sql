alter table public.inspection_requests
  add column requested_management_mode text
  check (requested_management_mode in ('host','wehouse'));

-- Keep the existing batch validation and its atomicity, then persist the
-- owner's operating choice in the same transaction as the submitted request.
alter function public.create_my_property_inspection_batch_v4(uuid,jsonb)
  rename to create_my_property_inspection_batch_v4_base;
revoke all on function public.create_my_property_inspection_batch_v4_base(uuid,jsonb)
  from public,anon,authenticated;

create function public.create_my_property_inspection_batch_v4(p_batch_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_item jsonb; v_created jsonb; v_result jsonb; v_mode text;
begin
  if jsonb_typeof(p_items)<>'array' then raise exception 'Property batch is invalid'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'property_type'='apartment'
       and coalesce(v_item->>'management_mode','') not in ('host','wehouse') then
      raise exception 'Choose who will manage each home before submission';
    end if;
  end loop;
  v_result:=public.create_my_property_inspection_batch_v4_base(p_batch_id,p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_item:=p_items->((v_created->>'position')::integer-1);
    v_mode:=case when v_item->>'property_type'='apartment' then v_item->>'management_mode' else null end;
    update public.inspection_requests
    set requested_management_mode=v_mode,updated_at=now()
    where id=(v_created->>'id')::uuid and owner_id=v_actor;
    if not found then raise exception 'Property management choice could not be recorded'; end if;
  end loop;
  return v_result;
end
$$;
revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb) from public,anon;
grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb) to authenticated,service_role;

create function public.apply_requested_property_management()
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
create trigger inspection_requested_management_to_draft
after insert or update of requested_management_mode,draft_listing_id on public.inspection_requests
for each row execute function public.apply_requested_property_management();

create function public.prevent_published_request_operator_change()
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
create trigger inspection_prevent_published_operator_change
before update of requested_management_mode,draft_listing_id on public.inspection_requests
for each row execute function public.prevent_published_request_operator_change();

create function public.set_my_property_request_management_mode(p_request_id uuid,p_mode text)
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

create function public.require_management_before_property_publication()
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
