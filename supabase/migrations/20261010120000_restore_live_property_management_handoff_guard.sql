-- Restore the reviewed-handoff boundary that the production schema reconciliation
-- accidentally replaced with the older, unrestricted post-publication setter.
-- A configured live home may keep its current operator, but changing operators
-- requires a separately reviewed handoff; the client cannot bypass this rule.
create or replace function public.set_my_property_management_mode(p_listing_id uuid,p_mode text)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode is null or p_mode not in ('host','wehouse') then
    raise exception 'Choose Host or WeHouse management';
  end if;

  if not exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=p_listing_id
      and a.user_id=v_actor
      and a.assignment_role='owner'
      and a.status='active'
  ) then
    raise exception 'Only the property owner can choose who manages this home';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null or v_listing.approved_at is null then
    raise exception 'Choose management in the property request before publication';
  end if;

  if v_listing.management_updated_at is not null then
    if v_listing.management_mode=p_mode then
      return public.get_my_property_management(p_listing_id);
    end if;
    raise exception 'This live home has an operator. Ask WeHouse to review a handoff for future bookings';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=p_mode,
      management_host_user_id=case when p_mode='host' then v_actor else null end,
      wehouse_management_status=case when p_mode='host' then 'not_required' else 'requested' end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'legacy_property_management_choice','listing',p_listing_id::text,
    jsonb_build_object('management_mode',p_mode)::text,now());

  return public.get_my_property_management(p_listing_id);
end
$$;

revoke all on function public.set_my_property_management_mode(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_my_property_management_mode(uuid,text) to authenticated,service_role;

comment on function public.set_my_property_management_mode(uuid,text)
is 'Owner-only initial legacy operating choice. A configured live home requires a reviewed handoff.';
