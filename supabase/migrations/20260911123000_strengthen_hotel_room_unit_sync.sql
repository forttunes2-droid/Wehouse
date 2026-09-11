-- Keep the physical room board aligned when a room type grows or shrinks.

create unique index if not exists hotel_room_units_current_booking_unique
  on public.hotel_room_units(current_booking_id)
  where current_booking_id is not null;

create or replace function public.sync_hotel_room_units()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  unit_count integer;
  remove_count integer;
  removed_count integer;
  candidate_number integer:=1;
  inserted_count integer;
begin
  select count(*) into unit_count
  from public.hotel_room_units
  where room_id=new.room_id;

  if unit_count>new.total_rooms then
    remove_count:=unit_count-new.total_rooms;
    with removable as (
      select unit_id
      from public.hotel_room_units
      where room_id=new.room_id and current_booking_id is null
      order by
        case status
          when 'out_of_service' then 1
          when 'maintenance' then 2
          when 'cleaning' then 3
          else 4
        end,
        unit_id desc
      limit remove_count
    ), deleted as (
      delete from public.hotel_room_units target
      using removable
      where target.unit_id=removable.unit_id
      returning target.unit_id
    )
    select count(*) into removed_count from deleted;

    if removed_count<remove_count then
      raise exception 'Room count cannot be lower than the number of occupied rooms';
    end if;
    unit_count:=new.total_rooms;
  end if;

  while unit_count<new.total_rooms loop
    insert into public.hotel_room_units(hotel_id,room_id,unit_label,status)
    values (new.hotel_id,new.room_id,new.room_type||' '||candidate_number,'ready')
    on conflict do nothing;
    get diagnostics inserted_count=row_count;
    unit_count:=unit_count+inserted_count;
    candidate_number:=candidate_number+1;
    if candidate_number>new.total_rooms+10000 then
      raise exception 'Physical room labels could not be generated';
    end if;
  end loop;

  return new;
end;
$$;

-- Re-run the sync once for every room so older rows are also reconciled.
update public.hotel_rooms
set total_rooms=total_rooms;
