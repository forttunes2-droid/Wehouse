begin;
create or replace function public.broadcast_service_booking_change() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare destination text;
begin
 if (new.status,new.negotiated_amount,new.agreed_amount,new.scheduled_date,new.user_id,new.worker_id,new.service_quote,new.service_quote_accepted_revision,new.service_quote_accepted_at)
  is not distinct from (old.status,old.negotiated_amount,old.agreed_amount,old.scheduled_date,old.user_id,old.worker_id,old.service_quote,old.service_quote_accepted_revision,old.service_quote_accepted_at) then return null;end if;
 for destination in select distinct p.auth_id from public.profiles p
  where p.user_id in(new.user_id,new.worker_id) and p.auth_id is not null
   and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
 loop
  perform realtime.send(jsonb_build_object('booking_id',new.id),'service_booking_changed',
   'wehouse:service-booking:'||destination,true);
 end loop;
 return null;
end $fn$;
commit;
