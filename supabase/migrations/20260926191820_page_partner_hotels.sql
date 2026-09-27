-- Published hotel inventory for the Partner workspace, with the same grant
-- check for list pages and direct navigation to older authorized hotels.
create index if not exists hotels_owner_active_page_idx
  on public.hotels(owner_id,
    (coalesce(updated_at,created_at,'epoch'::timestamptz)) desc,hotel_id desc)
  where status='active';

create or replace function public.get_my_owned_hotels_page(
  p_limit integer default 41,
  p_before_updated_at timestamptz default null,
  p_before_hotel_id integer default null,
  p_hotel_id integer default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if p_limit is null or p_limit<1 or p_limit>51 then
    raise exception 'Page size must be between 1 and 51';
  end if;
  if (p_before_updated_at is null)<>(p_before_hotel_id is null) then
    raise exception 'Incomplete hotel page cursor';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'hotel_id',hotel.hotel_id,'name',hotel.name,'description',hotel.description,
    'state',hotel.state,'city',hotel.city,'area',hotel.area,'address',hotel.address,
    'images',hotel.images,'amenities',hotel.amenities,'owner_id',hotel.owner_id,
    'status',hotel.status,'rating',hotel.rating,'review_count',hotel.review_count,
    'featured',hotel.featured,'check_in_time',hotel.check_in_time,
    'check_out_time',hotel.check_out_time,'timezone',hotel.timezone,
    'created_at',hotel.created_at,'updated_at',hotel.updated_at,
    'page_updated_at',hotel.page_updated_at,
    'room_type_count',(select count(*) from public.hotel_rooms r where r.hotel_id=hotel.hotel_id),
    'total_room_count',(select coalesce(sum(r.total_rooms),0) from public.hotel_rooms r where r.hotel_id=hotel.hotel_id),
    'starting_rate',(select min(r.price_per_night) filter(where r.price_per_night>0) from public.hotel_rooms r where r.hotel_id=hotel.hotel_id),
    'access_role','owner','capabilities',to_jsonb(public.hotel_default_capabilities('owner'))
  ) order by hotel.page_updated_at desc,hotel.hotel_id desc),'[]'::jsonb)
  into v_result
  from (
    select h.*,coalesce(h.updated_at,h.created_at,'epoch'::timestamptz) page_updated_at
    from public.hotels h
    where h.owner_id=v_actor and h.status='active'
      and public.current_actor_hotel_role(h.hotel_id)='owner'
      and (p_hotel_id is null or h.hotel_id=p_hotel_id)
      and (p_before_updated_at is null or
        (coalesce(h.updated_at,h.created_at,'epoch'::timestamptz),h.hotel_id)
          <(p_before_updated_at,p_before_hotel_id))
    order by coalesce(h.updated_at,h.created_at,'epoch'::timestamptz) desc,h.hotel_id desc
    limit case when p_hotel_id is null then p_limit else 1 end
  ) hotel;
  return v_result;
end
$$;
revoke all on function public.get_my_owned_hotels_page(integer,timestamptz,integer,integer)
  from public,anon;
grant execute on function public.get_my_owned_hotels_page(integer,timestamptz,integer,integer)
  to authenticated,service_role;
