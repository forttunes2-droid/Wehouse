-- Prevent dual-master edits after a PMS connection becomes authoritative.
-- Service-role PMS ingestion may write connected domains; browser/team RPCs may not.

create or replace function public.guard_pms_owned_hotel_domain()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare hotel_id_value integer; domain_value text;
begin
  if coalesce((select auth.role()),'')='service_role' then return coalesce(new,old); end if;
  if tg_table_name='hotel_rooms' then
    hotel_id_value:=coalesce(new.hotel_id,old.hotel_id); domain_value:='rooms';
  elsif tg_table_name='hotel_rate_plans' then
    hotel_id_value:=coalesce(new.hotel_id,old.hotel_id); domain_value:='rates';
  elsif tg_table_name='hotel_inventory_daily' then
    hotel_id_value:=coalesce(new.hotel_id,old.hotel_id); domain_value:='inventory';
  else return coalesce(new,old); end if;
  if public.hotel_integration_owns_domain(hotel_id_value,domain_value) then
    raise exception 'This hotel % domain is managed by its connected PMS. Update it in the source system or pause the integration first.',domain_value;
  end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists hotel_rooms_pms_authority_guard on public.hotel_rooms;
create trigger hotel_rooms_pms_authority_guard before insert or update or delete on public.hotel_rooms
for each row execute function public.guard_pms_owned_hotel_domain();

drop trigger if exists hotel_rate_plans_pms_authority_guard on public.hotel_rate_plans;
create trigger hotel_rate_plans_pms_authority_guard before insert or update or delete on public.hotel_rate_plans
for each row execute function public.guard_pms_owned_hotel_domain();

drop trigger if exists hotel_inventory_pms_authority_guard on public.hotel_inventory_daily;
create trigger hotel_inventory_pms_authority_guard before insert or update or delete on public.hotel_inventory_daily
for each row execute function public.guard_pms_owned_hotel_domain();

revoke all on function public.guard_pms_owned_hotel_domain() from public,anon,authenticated;
grant execute on function public.guard_pms_owned_hotel_domain() to service_role;
