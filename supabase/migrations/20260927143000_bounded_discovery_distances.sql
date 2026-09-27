-- Distance calculations for visible cards only. Avoid assembling coordinates
-- for the entire public catalog on every geolocation request.
create or replace function public.get_my_page_distances(
  p_lat double precision,
  p_lng double precision,
  p_listing_ids uuid[] default '{}',
  p_hotel_ids integer[] default '{}'
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_result jsonb;
begin
  if public.current_profile_user_id() is null then raise exception 'Authentication required'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or coalesce(cardinality(p_listing_ids),0) > 100 or coalesce(cardinality(p_hotel_ids),0) > 100 then
    raise exception 'Valid location and bounded property ids required';
  end if;
  select coalesce(jsonb_agg(row_value),'[]'::jsonb) into v_result from (
    select jsonb_build_object('subject_type','listing','subject_id',l.id::text,
      'distance_km',round((6371.0*2*asin(least(1.0,sqrt(
        power(sin(radians(l.gps_latitude::double precision-p_lat)/2),2)
        +cos(radians(p_lat))*cos(radians(l.gps_latitude::double precision))
        *power(sin(radians(l.gps_longitude::double precision-p_lng)/2),2)
      ))))::numeric,2)) row_value
    from public.listings l where l.id=any(p_listing_ids)
      and l.deleted_at is null and l.inspection_request_id is not null
      and l.approved_at is not null and l.status='available'
      and l.availability_status='available'
      and l.gps_latitude is not null and l.gps_longitude is not null
    union all
    select jsonb_build_object('subject_type','hotel','subject_id',h.hotel_id::text,
      'distance_km',round((6371.0*2*asin(least(1.0,sqrt(
        power(sin(radians(h.gps_latitude::double precision-p_lat)/2),2)
        +cos(radians(p_lat))*cos(radians(h.gps_latitude::double precision))
        *power(sin(radians(h.gps_longitude::double precision-p_lng)/2),2)
      ))))::numeric,2)) row_value
    from public.hotels h where h.hotel_id=any(p_hotel_ids)
      and h.status='active' and h.approved_at is not null and h.published_at is not null
      and h.gps_latitude is not null and h.gps_longitude is not null
  ) distances;
  return v_result;
end;
$$;

revoke all on function public.get_my_page_distances(double precision,double precision,uuid[],integer[]) from public;
grant execute on function public.get_my_page_distances(double precision,double precision,uuid[],integer[]) to authenticated,service_role;
