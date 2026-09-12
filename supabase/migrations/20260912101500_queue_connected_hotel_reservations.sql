-- Paid confirmed WeHouse bookings become delivery work for an active PMS connection.
-- PMS acknowledgement never determines WeHouse payment truth and rejection never
-- silently cancels/refunds a paid guest.

create or replace function public.queue_hotel_booking_for_pms()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare integration uuid;
begin
  if new.payment_status='paid' and new.status in ('confirmed','checked_in','checked_out','completed') then
    select i.id into integration
    from public.hotel_integrations i
    where i.hotel_id=new.hotel_id and i.status='active'
      and 'reservations.read'=any(i.scopes)
    order by i.created_at
    limit 1;
    if integration is not null then
      if new.integration_id is null then new.integration_id:=integration; end if;
      if coalesce(new.pms_sync_status,'not_connected') in ('not_connected','pending','delivered')
         and new.pms_external_reservation_id is null then
        new.pms_sync_status:='pending';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_bookings_queue_pms on public.hotel_bookings;
create trigger hotel_bookings_queue_pms
before insert or update of payment_status,status,hotel_id on public.hotel_bookings
for each row execute function public.queue_hotel_booking_for_pms();

update public.hotel_bookings b
set integration_id=i.id,
    pms_sync_status=case when b.pms_external_reservation_id is null then 'pending' else b.pms_sync_status end,
    updated_at=b.updated_at
from lateral (
  select x.id from public.hotel_integrations x
  where x.hotel_id=b.hotel_id and x.status='active' and 'reservations.read'=any(x.scopes)
  order by x.created_at limit 1
) i
where b.payment_status='paid'
  and b.status in ('confirmed','checked_in','checked_out','completed')
  and b.integration_id is null;

revoke all on function public.queue_hotel_booking_for_pms() from public,anon,authenticated;
grant execute on function public.queue_hotel_booking_for_pms() to service_role;
