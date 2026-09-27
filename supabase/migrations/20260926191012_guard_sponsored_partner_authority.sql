-- Sponsored quotes and draft campaigns must lose property authority when the
-- Property Partner grant is revoked, even if legacy ownership rows remain.
create or replace function public._my_sponsored_resource_context(
  p_resource_type text,p_resource_id text
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_profile public.profiles;
  v_listing public.listings;
  v_hotel public.hotels;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_resource_type in ('property','hotel')
     and not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;

  if p_resource_type='worker' then
    if p_resource_id<>v_actor then raise exception 'You can promote only your own Worker profile'; end if;
    select * into v_profile
    from public.profiles
    where user_id=v_actor
      and public.user_has_active_workspace(user_id,'worker')
      and worker_status='verified' and worker_verified=true
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false);
    if v_profile.user_id is null then raise exception 'A live Service Worker profile is required'; end if;
    return jsonb_build_object(
      'state_name',v_profile.state,
      'state_key',public.wehouse_state_key(v_profile.state),
      'lga_name',coalesce(nullif(v_profile.local_government,''),v_profile.city),
      'lga_key',public.worker_market_text_key(coalesce(nullif(v_profile.local_government,''),v_profile.city)),
      'category_key',public.worker_market_text_key(v_profile.worker_occupation)
    );
  elsif p_resource_type='property' then
    select l.* into v_listing
    from public.listings l
    join public.property_host_assignments owner_assignment
      on owner_assignment.listing_id=l.id
     and owner_assignment.user_id=v_actor
     and owner_assignment.assignment_role='owner'
     and owner_assignment.status='active'
    where l.id=p_resource_id::uuid
      and l.deleted_at is null
      and l.approved_at is not null
      and l.status in ('available','unavailable','reserved','occupied','maintenance','closed');
    if v_listing.id is null then raise exception 'A live property you own is required'; end if;
    return jsonb_build_object(
      'state_name',v_listing.state,
      'state_key',public.wehouse_state_key(v_listing.state),
      'lga_name',nullif(v_listing.city,''),
      'lga_key',public.worker_market_text_key(v_listing.city),
      'category_key',public.worker_market_text_key(v_listing.sub_type)
    );
  elsif p_resource_type='hotel' then
    select * into v_hotel
    from public.hotels
    where hotel_id=p_resource_id::integer
      and owner_id=v_actor
      and status='active';
    if v_hotel.hotel_id is null then raise exception 'An active hotel you own is required'; end if;
    return jsonb_build_object(
      'state_name',v_hotel.state,
      'state_key',public.wehouse_state_key(v_hotel.state),
      'lga_name',coalesce(nullif(v_hotel.city,''),v_hotel.area),
      'lga_key',public.worker_market_text_key(coalesce(nullif(v_hotel.city,''),v_hotel.area)),
      'category_key','hotel'
    );
  end if;

  raise exception 'Unsupported Sponsored resource';
end
$$;
