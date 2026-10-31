-- The final group status may be written after the reservation's rent signal.
-- Publish the same idempotent booking fact from either ordering, after all funds
-- are verified. Reservation-fee groups never announce rent or a confirmed stay.
create function private.notify_fully_paid_shared_home_booking() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare reservation_id text;stage text;
begin
 if new.status<>'fully_paid' or old.status is not distinct from new.status
  or new.product_type not in('long_let','short_let') or new.payment_phase not in('contract_rent','short_stay') then return new;end if;
 reservation_id:=coalesce(new.reservation_id,(select r.id from public.reservations r where r.shared_payment_group_id=new.shared_payment_group_id limit 1));
 if reservation_id is null then return new;end if;
 stage:=case when new.product_type='short_let' then 'reserved' else 'rent_confirmed' end;
 perform private.publish_shared_home_booking_activity(reservation_id,stage,stage);
 return new;
end $fn$;
revoke all on function private.notify_fully_paid_shared_home_booking() from public,anon,authenticated;
create trigger shared_home_booking_confirmed after update of status on public.shared_payment_groups
 for each row execute function private.notify_fully_paid_shared_home_booking();
