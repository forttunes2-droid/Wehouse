-- Hotel base tables are reached only through masked or capability-checked RPCs.
-- Supabase default privileges had left browser roles with table-level grants
-- (including TRUNCATE, which row security does not protect).
do $$
declare t text;
begin
  foreach t in array array['hotels','hotel_rooms','hotel_room_units','hotel_rate_plans','hotel_inventory_daily','hotel_bookings','hotel_team_members'] loop
    if to_regclass('public.'||t) is not null then
      execute format('revoke all on table public.%I from anon', t);
      execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated', t);
    end if;
  end loop;
end $$;
