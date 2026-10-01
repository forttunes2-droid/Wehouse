begin;
create or replace function public.sync_hotel_cancellation_refund()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if new.action_type='refund_hotel_cancellation' and new.status='completed' and old.status<>'completed' then
  if not exists(select 1 from public.payment_protection_transactions where id=new.payment_protection_id
   and refunded_amount=amount_total and protection_state='refunded') then raise exception 'Verified refund ledger required'; end if;
  update public.hotel_bookings set payment_status='refunded',updated_at=now()
   where booking_id=new.subject_id::integer and payment_protection_id=new.payment_protection_id and status='cancelled';
  update public.booking_payments set status='refunded',refund_processed_at=now(),updated_at=now()
   where hotel_booking_id=new.subject_id::integer and paystack_reference=(select paystack_reference from public.payment_protection_transactions where id=new.payment_protection_id)
    and purpose='hotel_booking' and status='paid';
 end if;
 return new;
end $$;

CREATE OR REPLACE FUNCTION public.get_my_payment_receipts(p_reference text DEFAULT NULL::text, p_subject_type text DEFAULT NULL::text, p_subject_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_user is null then raise exception 'Active account required'; end if;
  select coalesce(jsonb_agg(receipt order by paid_at desc),'[]'::jsonb) into v_result
  from (
    select coalesce(bp.paid_at,bp.verified_at) paid_at,
      jsonb_build_object(
        'id',bp.id,'reference',coalesce(bp.paystack_reference,bp.payment_reference),
        'purpose',bp.purpose,'amount',bp.verified_amount,'currency',bp.currency,
        'paid_at',coalesce(bp.paid_at,bp.verified_at),'status',bp.status,
        'refund_processed_at',bp.refund_processed_at,
        'environment',case when bp.metadata->>'paystack_domain' in ('test','live') then bp.metadata->>'paystack_domain' else null end,
        'payer_name',coalesce(nullif(hb.guest_name,''),nullif(p.full_name,''),p.username,'WeHouse customer'),
        'merchant_name',coalesce(h.name,r.listing_title,nullif(worker.full_name,''),worker.username,'WeHouse'),
        'description',case when bp.purpose='hotel_booking' then coalesce(hr.room_type,'Hotel stay')
          when bp.purpose='worker_booking' then coalesce(wb.service_type,'Service booking')
          when r.stay_type='short_let' then 'Short Let stay'
          when bp.purpose='apartment_reservation' then 'Apartment reservation fee'
          when bp.purpose='apartment_rent' then 'Apartment rent'
          when bp.purpose='worker_pro_subscription' then 'Worker Pro subscription'
          when bp.purpose='shared_housing_share' then 'Shared home contribution'
          else 'WeHouse payment' end,
        'package_name',hb.rate_plan_name,'cancellation_snapshot',hb.cancellation_snapshot,
        'booking_id',coalesce(hb.booking_id::text,wb.id::text,r.id),
        'booking_type',case when hb.booking_id is not null then 'hotel' when wb.id is not null then 'service' when r.id is not null then 'housing' else null end,
        'check_in',coalesce(hb.check_in,r.stay_check_in),'check_out',coalesce(hb.check_out,r.stay_check_out),
        'nights',coalesce(hb.total_nights,r.stay_nights),'guests',coalesce(hb.guest_count,r.guest_count),
        'stay_amount',case when r.stay_type='short_let' then r.stay_rent_total else null end,
        'deposit_amount',case when r.stay_type='short_let' then r.security_deposit_snapshot else null end
      ) receipt
    from public.booking_payments bp
    join public.profiles p on p.user_id=v_user
    left join public.hotel_bookings hb on hb.booking_id=bp.hotel_booking_id
    left join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.hotel_rooms hr on hr.room_id=hb.room_id
    left join public.worker_bookings wb on wb.id=bp.worker_booking_id
    left join public.profiles worker on worker.user_id=wb.worker_id
    left join public.reservations r on r.id=bp.metadata->>'reservation_id'
    where coalesce(bp.payer_user_id,bp.user_id)=v_user
      and bp.status in ('paid','completed','refunded','partially_refunded')
      and bp.verified_at is not null and bp.paystack_transaction_id is not null
      and bp.verified_amount is not null
      and (p_reference is null or p_reference=coalesce(bp.paystack_reference,bp.payment_reference))
      and (p_subject_type is null
        or (p_subject_type='hotel' and hb.booking_id::text=p_subject_id)
        or (p_subject_type='service' and wb.id::text=p_subject_id)
        or (p_subject_type='housing' and r.id=p_subject_id))
    order by coalesce(bp.paid_at,bp.verified_at) desc
    limit 100
  ) receipts;
  return v_result;
end;
$function$;
commit;
