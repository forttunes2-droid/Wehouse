-- Only the explicit property owner may change who manages a home.
create or replace function public.set_my_property_management_mode(
  p_listing_id uuid,p_mode text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode not in ('host','wehouse') then raise exception 'Choose Host-managed or WeHouse-managed'; end if;
  if not exists(
    select 1 from public.property_host_assignments
    where listing_id=p_listing_id and user_id=v_actor
      and assignment_role='owner' and status='active'
  ) then raise exception 'Only the property owner can change management responsibility'; end if;

  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=p_mode,
      management_host_user_id=case when p_mode='host' then v_actor else null end,
      wehouse_management_status=case
        when p_mode='host' then 'not_required'
        when management_mode='wehouse' and wehouse_management_status='approved' then 'approved'
        else 'requested'
      end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'property_management_mode_changed','listing',p_listing_id::text,
    jsonb_build_object(
      'management_mode',v_listing.management_mode,
      'wehouse_management_status',v_listing.wehouse_management_status,
      'management_host_user_id',v_listing.management_host_user_id
    )::text,now());

  return public.get_my_property_management(p_listing_id);
end
$$;
revoke all on function public.set_my_property_management_mode(uuid,text) from public,anon;
grant execute on function public.set_my_property_management_mode(uuid,text) to authenticated;
