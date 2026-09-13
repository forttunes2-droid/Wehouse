-- Exact followed-search identity must use the same semantic normalization as
-- the client: empty object values do not count, and set-like arrays have a
-- stable order.

create or replace function public.canonical_saved_search_criteria(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog','public'
as $$
declare v_result jsonb;
begin
  if p_value is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p_value)='object' then
    select coalesce(jsonb_object_agg(entry.key,public.canonical_saved_search_criteria(entry.value)),'{}'::jsonb)
    into v_result
    from jsonb_each(p_value) entry
    where entry.value<>'null'::jsonb and entry.value<>'""'::jsonb;
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)
    into v_result
    from (
      select public.canonical_saved_search_criteria(entry.value) value
      from jsonb_array_elements(p_value) entry
    ) normalized;
    return v_result;
  end if;
  return p_value;
end;
$$;

create or replace function public.set_saved_search_criteria_key()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  new.criteria:=public.canonical_saved_search_criteria(coalesce(new.criteria,'{}'::jsonb));
  new.criteria_key:=md5(new.criteria::text);
  return new;
end;
$$;

delete from public.saved_searches duplicate
using public.saved_searches keeper
where duplicate.user_id=keeper.user_id
  and duplicate.search_kind=keeper.search_kind
  and md5(public.canonical_saved_search_criteria(duplicate.criteria)::text)
      =md5(public.canonical_saved_search_criteria(keeper.criteria)::text)
  and (duplicate.updated_at,duplicate.id)<(keeper.updated_at,keeper.id);

update public.saved_searches
set criteria=public.canonical_saved_search_criteria(criteria),updated_at=updated_at;

create or replace function public.save_my_property_search(
  p_name text,
  p_search_kind text,
  p_criteria jsonb
)
returns uuid
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_result uuid;
  v_criteria jsonb:=public.canonical_saved_search_criteria(coalesce(p_criteria,'{}'::jsonb));
  v_key text;
begin
  if v_actor is null then raise exception 'Authenticated profile required'; end if;
  if p_search_kind not in ('homes','hotels') then raise exception 'Unsupported saved search'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Saved search name is required'; end if;
  v_key:=md5(v_criteria::text);
  insert into public.saved_searches(
    user_id,name,search_kind,criteria,criteria_key,notifications_enabled
  ) values(
    v_actor,btrim(p_name),p_search_kind,v_criteria,v_key,true
  )
  on conflict(user_id,search_kind,criteria_key) do update
  set name=excluded.name,criteria=excluded.criteria,
      notifications_enabled=true,updated_at=now()
  returning id into v_result;
  return v_result;
end;
$$;

create or replace function public.notify_matching_saved_hotel_searches(p_hotel_id integer)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_hotel public.hotels;
begin
  select * into v_hotel from public.hotels where hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null or v_hotel.status<>'active' or v_hotel.approved_at is null then return; end if;
  with matching as materialized (
    select search.id,search.user_id
    from public.saved_searches search
    where search.search_kind='hotels' and search.notifications_enabled
      and (coalesce(search.criteria->>'query','')='' or lower(v_hotel.name) like '%'||lower(search.criteria->>'query')||'%')
      and (coalesce(search.criteria->>'state','')='' or public.wehouse_state_key(search.criteria->>'state')=public.wehouse_state_key(v_hotel.state))
      and (coalesce(search.criteria->>'city','')='' or public.wehouse_lga_key(search.criteria->>'city')=public.wehouse_lga_key(v_hotel.city))
      and (
        coalesce(search.criteria->'amenities','[]'::jsonb)='[]'::jsonb
        or not exists(
          select 1 from jsonb_array_elements_text(search.criteria->'amenities') wanted
          where not exists(
            select 1 from unnest(coalesce(v_hotel.amenities,'{}'::text[])) available
            where lower(available)=lower(wanted.value)
          )
        )
      )
      and exists(
        select 1 from public.hotel_rooms room
        where room.hotel_id=v_hotel.hotel_id
          and (nullif(search.criteria->>'min_price','') is null or room.price_per_night>=(search.criteria->>'min_price')::numeric)
          and (nullif(search.criteria->>'max_price','') is null or room.price_per_night<=(search.criteria->>'max_price')::numeric)
      )
      and (
        nullif(search.criteria->>'radius_km','') is null
        or (
          v_hotel.gps_latitude is not null and v_hotel.gps_longitude is not null
          and nullif(search.criteria->>'latitude','') is not null
          and nullif(search.criteria->>'longitude','') is not null
          and 6371*acos(least(1,greatest(-1,
            cos(radians((search.criteria->>'latitude')::double precision))
            *cos(radians(v_hotel.gps_latitude::double precision))
            *cos(radians(v_hotel.gps_longitude::double precision)-radians((search.criteria->>'longitude')::double precision))
            +sin(radians((search.criteria->>'latitude')::double precision))
            *sin(radians(v_hotel.gps_latitude::double precision))
          )))<=(search.criteria->>'radius_km')::double precision
        )
      )
  ), inserted as (
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select matching.user_id,'saved_search_match','A hotel matches your search',
      v_hotel.name,v_hotel.hotel_id::text,'hotel',v_hotel.hotel_id::text,
      'hotel_detail',jsonb_build_object('hotel_id',v_hotel.hotel_id),
      concat('saved-search:',matching.id,':hotel:',v_hotel.hotel_id)
    from matching
    on conflict(recipient_id,event_key) where event_key is not null do nothing
    returning recipient_id,event_key
  )
  update public.saved_searches search
  set last_notified_at=now(),updated_at=now()
  from inserted
  where search.user_id=inserted.recipient_id
    and inserted.event_key=concat('saved-search:',search.id,':hotel:',v_hotel.hotel_id);
end;
$$;

create or replace function public.notify_matching_saved_home_searches()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.deleted_at is not null or new.status<>'available' or new.availability_status<>'available' then return new; end if;
  if tg_op='UPDATE' and old.status='available' and old.availability_status='available' then return new; end if;
  with matching as materialized (
    select search.id,search.user_id
    from public.saved_searches search
    where search.search_kind='homes' and search.notifications_enabled
      and (coalesce(search.criteria->>'state','')='' or public.wehouse_state_key(search.criteria->>'state')=public.wehouse_state_key(new.state))
      and (coalesce(search.criteria->>'city','')='' or public.wehouse_lga_key(search.criteria->>'city')=public.wehouse_lga_key(new.city))
      and coalesce((search.criteria->>'min_price')::numeric,0)<=new.price
      and (nullif(search.criteria->>'max_price','') is null or new.price<=(search.criteria->>'max_price')::numeric)
      and (nullif(search.criteria->>'bedrooms','') is null or new.bedrooms>=(search.criteria->>'bedrooms')::integer)
      and (nullif(search.criteria->>'bathrooms','') is null or new.bathrooms>=(search.criteria->>'bathrooms')::integer)
      and (coalesce(search.criteria->>'sub_type','')='' or search.criteria->>'sub_type'=coalesce(new.sub_type,''))
  ), inserted as (
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select matching.user_id,'saved_search_match','A new home matches your search',
      new.title,new.id::text,'listing',new.id::text,'detail',
      jsonb_build_object('listingId',new.id,'listing_id',new.id),
      concat('saved-search:',matching.id,':listing:',new.id)
    from matching
    on conflict(recipient_id,event_key) where event_key is not null do nothing
    returning recipient_id,event_key
  )
  update public.saved_searches search
  set last_notified_at=now(),updated_at=now()
  from inserted
  where search.user_id=inserted.recipient_id
    and inserted.event_key=concat('saved-search:',search.id,':listing:',new.id);
  return new;
end;
$$;

revoke all on function public.canonical_saved_search_criteria(jsonb) from public,anon;
revoke all on function public.set_saved_search_criteria_key() from public,anon,authenticated;
revoke all on function public.save_my_property_search(text,text,jsonb) from public,anon;
revoke all on function public.notify_matching_saved_hotel_searches(integer) from public,anon,authenticated;
revoke all on function public.notify_matching_saved_home_searches() from public,anon,authenticated;
grant execute on function public.canonical_saved_search_criteria(jsonb) to authenticated,service_role;
grant execute on function public.set_saved_search_criteria_key() to service_role;
grant execute on function public.save_my_property_search(text,text,jsonb) to authenticated,service_role;
grant execute on function public.notify_matching_saved_hotel_searches(integer) to service_role;
grant execute on function public.notify_matching_saved_home_searches() to service_role;
