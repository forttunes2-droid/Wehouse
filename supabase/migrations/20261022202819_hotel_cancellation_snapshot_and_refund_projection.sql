-- Restore the saved cancellation agreement consumed by the canonical cancellation RPC.
-- Historical bookings remain NULL: current rate terms must not be substituted for an old agreement.
alter table public.hotel_bookings add column if not exists cancellation_snapshot jsonb;

create or replace function public.snapshot_hotel_cancellation_terms()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare hotel public.hotels; refundable boolean; hours integer; deadline timestamptz;
begin
 if tg_op='UPDATE' then
  if new.cancellation_snapshot is distinct from old.cancellation_snapshot then
   raise exception 'Booked cancellation terms are immutable';
  end if;
  if old.cancellation_snapshot is not null and
   (new.hotel_id,new.room_id,new.rate_plan_id,new.user_id,new.check_in,new.check_out,new.total_price,new.rate_plan_snapshot)
   is distinct from
   (old.hotel_id,old.room_id,old.rate_plan_id,old.user_id,old.check_in,old.check_out,old.total_price,old.rate_plan_snapshot) then
   raise exception 'Booked stay and rate terms are immutable; create a new booking for different terms';
  end if;
  return new;
 end if;
 -- The preceding booking-integrity trigger sets the authoritative rate and total.
 select * into hotel from public.hotels where hotel_id=new.hotel_id;
 refundable:=coalesce((new.rate_plan_snapshot->>'refundable')::boolean,false);
 hours:=(new.rate_plan_snapshot->>'cancellation_hours')::integer;
 if hotel.hotel_id is null or new.rate_plan_snapshot is null or new.total_price<=0
  or refundable and (hours is null or hours<0 or hours>8760) then
  raise exception 'A valid saved Hotel rate and cancellation window are required';
 end if;
 deadline:=((new.check_in+coalesce(hotel.check_in_time,time '14:00'))
  at time zone coalesce(nullif(hotel.timezone,''),'Africa/Lagos'))-make_interval(hours=>coalesce(hours,0));
 new.cancellation_snapshot:=jsonb_build_object('version',1,'currency','NGN',
  'policy_version_id',new.cancellation_policy_version_id,
  'timezone',coalesce(nullif(hotel.timezone,''),'Africa/Lagos'),
  'check_in_time',coalesce(hotel.check_in_time,time '14:00'),
  'refundable',refundable,'deadline',case when refundable then deadline else null end,
  'refund_amount_ngn',case when refundable then new.total_price else 0 end,'fee_ngn',0,
  'terms','Full booking amount returned to the original payment method if cancelled by the saved deadline before check-in. Later cancellations and exceptions require WeHouse review.');
 return new;
end; $$;
revoke all on function public.snapshot_hotel_cancellation_terms() from public,anon,authenticated,service_role;
drop trigger if exists zz_snapshot_hotel_cancellation_terms on public.hotel_bookings;
drop trigger if exists zzz_hotel_booking_cancellation_terms on public.hotel_bookings;
create trigger zzz_hotel_booking_cancellation_terms before insert or update on public.hotel_bookings
 for each row execute function public.snapshot_hotel_cancellation_terms();

-- Refund completion is a projection of the existing verified Protection ledger/outbox.
create or replace function public.sync_hotel_cancellation_refund()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare protection public.payment_protection_transactions; booking public.hotel_bookings;
begin
 if new.action_type<>'refund_hotel_cancellation' or new.status<>'completed' or old.status='completed' then return new;end if;
 select * into protection from public.payment_protection_transactions where id=new.payment_protection_id;
 if protection.id is null or protection.refunded_amount<>protection.amount_total
  or protection.protection_state<>'refunded' or new.amount is distinct from protection.amount_total
  or new.subject_type<>'hotel' then raise exception 'Verified Hotel refund ledger required';end if;
 select * into booking from public.hotel_bookings where booking_id::text=new.subject_id
  and payment_protection_id=protection.id for update;
 if booking.booking_id is null or booking.status<>'cancelled'
  or booking.user_id is distinct from protection.payer_user_id
  or nullif(booking.payment_reference,'') is null
  or booking.payment_reference is distinct from protection.paystack_reference then
  raise exception 'Hotel refund does not match the cancelled booking';
 end if;
 update public.hotel_bookings set payment_status='refunded',updated_at=now() where booking_id=booking.booking_id;
 update public.booking_payments set status='refunded',refund_processed_at=now(),updated_at=now()
 where hotel_booking_id=booking.booking_id and paystack_reference=protection.paystack_reference
  and purpose='hotel_booking' and status='paid';
 return new;
end; $$;
revoke all on function public.sync_hotel_cancellation_refund() from public,anon,authenticated,service_role;
drop trigger if exists sync_hotel_cancellation_refund on public.financial_action_outbox;
create trigger sync_hotel_cancellation_refund after update of status on public.financial_action_outbox
 for each row when(new.action_type='refund_hotel_cancellation' and new.status='completed' and old.status is distinct from new.status)
 execute function public.sync_hotel_cancellation_refund();
