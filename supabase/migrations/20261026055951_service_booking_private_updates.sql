begin;
-- ID-only invalidation hints. Price, scope, identity and messages remain private.
create policy "Service booking signals belong to their recipient"
on realtime.messages for select to authenticated
using(extension='broadcast' and topic='wehouse:service-booking:'||(select auth.uid())::text);
create function public.broadcast_service_booking_change() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare destination text;
begin
 if (new.status,new.negotiated_amount,new.agreed_amount,new.scheduled_date,new.user_id,new.worker_id)
  is not distinct from (old.status,old.negotiated_amount,old.agreed_amount,old.scheduled_date,old.user_id,old.worker_id) then return null;end if;
 for destination in select distinct p.auth_id from public.profiles p
  where p.user_id in(new.user_id,new.worker_id) and p.auth_id is not null
   and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
 loop
  perform realtime.send(jsonb_build_object('booking_id',new.id),'service_booking_changed',
   'wehouse:service-booking:'||destination,true);
 end loop;
 return null;
end $fn$;
revoke all on function public.broadcast_service_booking_change() from public,anon,authenticated,service_role;
create trigger service_booking_private_change after update on public.worker_bookings
 for each row execute function public.broadcast_service_booking_change();
commit;
