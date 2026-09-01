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

  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key
  )
  select s.user_id,'saved_search_match','A hotel matches your search',v_hotel.name,
    v_hotel.hotel_id::text,'hotel',v_hotel.hotel_id::text,'hotel_detail',
    jsonb_build_object('hotel_id',v_hotel.hotel_id),
    concat('saved-search:',s.id,':hotel:',v_hotel.hotel_id)
  from public.saved_searches s
  where s.search_kind='hotels' and s.notifications_enabled
    and (coalesce(s.criteria->>'state','')='' or lower(s.criteria->>'state')=lower(coalesce(v_hotel.state,'')))
    and (coalesce(s.criteria->>'city','')='' or lower(s.criteria->>'city')=lower(coalesce(v_hotel.city,'')))
    and (
      coalesce(s.criteria->'amenities','[]'::jsonb)='[]'::jsonb
      or not exists (
        select 1 from jsonb_array_elements_text(s.criteria->'amenities') wanted
        where not (wanted.value=any(coalesce(v_hotel.amenities,'{}'::text[])))
      )
    )
    and exists (
      select 1 from public.hotel_rooms room
      where room.hotel_id=v_hotel.hotel_id
        and (nullif(s.criteria->>'min_price','') is null or room.price_per_night>=(s.criteria->>'min_price')::numeric)
        and (nullif(s.criteria->>'max_price','') is null or room.price_per_night<=(s.criteria->>'max_price')::numeric)
    )
  on conflict(recipient_id,event_key) where event_key is not null do nothing;
end;
$$;

revoke all on function public.notify_matching_saved_hotel_searches(integer) from public,anon,authenticated;

create or replace function public.notify_saved_hotel_searches_from_hotel()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $$ begin
  if new.status='active' and new.approved_at is not null
     and (tg_op='INSERT' or old.status is distinct from new.status or old.approved_at is distinct from new.approved_at) then
    perform public.notify_matching_saved_hotel_searches(new.hotel_id);
  end if;
  return new;
end $$;

create or replace function public.notify_saved_hotel_searches_from_room()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $$ begin
  perform public.notify_matching_saved_hotel_searches(new.hotel_id);
  return new;
end $$;

drop trigger if exists hotels_saved_search_activity on public.hotels;
create trigger hotels_saved_search_activity
after insert or update of status,approved_at on public.hotels
for each row execute function public.notify_saved_hotel_searches_from_hotel();

drop trigger if exists hotel_rooms_saved_search_activity on public.hotel_rooms;
create trigger hotel_rooms_saved_search_activity
after insert or update of price_per_night on public.hotel_rooms
for each row execute function public.notify_saved_hotel_searches_from_room();
