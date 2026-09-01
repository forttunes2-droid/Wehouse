-- Keep one canonical hotel submission contract while preserving submissions
-- created by the earlier client shape (`rooms`, `rate`, `max_guests`).

update public.inspection_requests
set hotel_program = jsonb_set(
  hotel_program - 'rooms',
  '{room_types}',
  coalesce((
    select jsonb_agg(
      (room - 'rate' - 'max_guests') || jsonb_build_object(
        'nightly_rate', coalesce(room->'nightly_rate', room->'rate'),
        'guest_capacity', coalesce(room->'guest_capacity', room->'max_guests')
      )
      order by ordinal
    )
    from jsonb_array_elements(coalesce(hotel_program->'room_types', hotel_program->'rooms', '[]'::jsonb))
      with ordinality as submitted(room, ordinal)
  ), '[]'::jsonb),
  true
)
where property_type = 'hotel'
  and hotel_program is not null
  and (hotel_program ? 'rooms' or hotel_program ? 'room_types');

create or replace function public.normalize_hotel_submission_program()
returns trigger language plpgsql set search_path = 'pg_catalog','public' as $$
declare normalized_rooms jsonb;
begin
  if new.property_type <> 'hotel' or new.hotel_program is null then return new; end if;
  select coalesce(jsonb_agg(
    (room - 'rate' - 'max_guests') || jsonb_build_object(
      'nightly_rate', coalesce(room->'nightly_rate', room->'rate'),
      'guest_capacity', coalesce(room->'guest_capacity', room->'max_guests')
    ) order by ordinal
  ), '[]'::jsonb) into normalized_rooms
  from jsonb_array_elements(coalesce(new.hotel_program->'room_types', new.hotel_program->'rooms', '[]'::jsonb))
    with ordinality as submitted(room, ordinal);
  new.hotel_program := jsonb_set(new.hotel_program - 'rooms', '{room_types}', normalized_rooms, true);
  return new;
end $$;

drop trigger if exists inspection_requests_normalize_hotel_program on public.inspection_requests;
create trigger inspection_requests_normalize_hotel_program
before insert or update of hotel_program on public.inspection_requests
for each row execute function public.normalize_hotel_submission_program();

revoke all on function public.normalize_hotel_submission_program() from public,anon,authenticated;
