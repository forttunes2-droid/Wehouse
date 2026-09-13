-- Hotel alerts must preserve every filter the user followed.

create or replace function public.notify_matching_saved_hotel_searches(
  p_hotel_id integer
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_hotel public.hotels;
begin
  select * into v_hotel from public.hotels where hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null or v_hotel.status<>'active' or v_hotel.approved_at is null then
    return;
  end if;

  with matching as materialized (
    select search.id,search.user_id
    from public.saved_searches search
    where search.search_kind='hotels'
      and search.notifications_enabled
      and (
        coalesce(search.criteria->>'query','')=''
        or lower(v_hotel.name) like '%'||lower(search.criteria->>'query')||'%'
      )
      and (
        coalesce(search.criteria->>'state','')=''
        or lower(search.criteria->>'state')=lower(coalesce(v_hotel.state,''))
      )
      and (
        coalesce(search.criteria->>'city','')=''
        or lower(search.criteria->>'city')=lower(coalesce(v_hotel.city,''))
      )
      and (
        coalesce(search.criteria->'amenities','[]'::jsonb)='[]'::jsonb
        or not exists (
          select 1
          from jsonb_array_elements_text(search.criteria->'amenities') wanted
          where not (wanted.value=any(coalesce(v_hotel.amenities,'{}'::text[])))
        )
      )
      and exists (
        select 1
        from public.hotel_rooms room
        where room.hotel_id=v_hotel.hotel_id
          and (
            nullif(search.criteria->>'min_price','') is null
            or room.price_per_night>=(search.criteria->>'min_price')::numeric
          )
          and (
            nullif(search.criteria->>'max_price','') is null
            or room.price_per_night<=(search.criteria->>'max_price')::numeric
          )
      )
      and (
        nullif(search.criteria->>'radius_km','') is null
        or (
          v_hotel.gps_latitude is not null
          and v_hotel.gps_longitude is not null
          and nullif(search.criteria->>'latitude','') is not null
          and nullif(search.criteria->>'longitude','') is not null
          and 6371*acos(
            least(1,greatest(-1,
              cos(radians((search.criteria->>'latitude')::double precision))
              *cos(radians(v_hotel.gps_latitude::double precision))
              *cos(
                radians(v_hotel.gps_longitude::double precision)
                -radians((search.criteria->>'longitude')::double precision)
              )
              +sin(radians((search.criteria->>'latitude')::double precision))
              *sin(radians(v_hotel.gps_latitude::double precision))
            ))
          )<=(search.criteria->>'radius_km')::double precision
        )
      )
  ), inserted as (
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select
      matching.user_id,
      'saved_search_match',
      'A hotel matches your search',
      v_hotel.name,
      v_hotel.hotel_id::text,
      'hotel',
      v_hotel.hotel_id::text,
      'hotel_detail',
      jsonb_build_object('hotel_id',v_hotel.hotel_id),
      concat('saved-search:',matching.id,':hotel:',v_hotel.hotel_id)
    from matching
    on conflict(recipient_id,event_key) where event_key is not null do nothing
    returning recipient_id
  )
  update public.saved_searches search
  set last_notified_at=now(),updated_at=now()
  from matching
  where search.id=matching.id;
end;
$$;

revoke all on function public.notify_matching_saved_hotel_searches(integer)
  from public,anon,authenticated;
grant execute on function public.notify_matching_saved_hotel_searches(integer)
  to service_role;
