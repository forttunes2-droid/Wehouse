create or replace function public.expire_overdue_reservations()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_role text;
  v_count integer := 0;
  v_row record;
begin
  if auth.uid() is not null then
    select role into v_role
    from public.profiles
    where auth_id=auth.uid()::text
      and coalesce(deleted,false)=false
      and coalesce(suspended,false)=false
      and coalesce(banned,false)=false
    limit 1;
    if v_role <> 'creator' then raise exception 'Creator or service execution required'; end if;
  end if;

  for v_row in
    select r.id,r.listing_id,r.status,r.payment_reference
    from public.reservations r
    where coalesce(r.rent_payment_status,'not_started') not in ('paid','upfront_paid')
      and ((r.status='payment_pending' and r.payment_expires_at<now())
        or (r.status in ('reserved','inspection_pending','ready_for_move_in') and r.hold_expires_at<now()))
    for update
  loop
    if v_row.status='payment_pending' and exists(
      select 1 from public.booking_payments bp
      where bp.paystack_reference=v_row.payment_reference and bp.status in ('paid','completed')
    ) then continue; end if;

    update public.reservations
    set status='expired',refund_amount=0,refund_reason='Reservation hold expired',processed_at=now(),updated_at=now()
    where id=v_row.id and coalesce(rent_payment_status,'not_started') not in ('paid','upfront_paid');
    if not found then continue; end if;

    update public.booking_payments set status='expired',updated_at=now()
    where paystack_reference=v_row.payment_reference and status='pending';
    update public.listings
    set status='available',availability_status='available',reserved_by=null,reservation_expiry=null,
        reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=null,updated_at=now()
    where id::text=v_row.listing_id and current_reservation_id=v_row.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

with affected as (
  update public.reservations
  set status='ready_for_move_in',hold_expires_at=null,payment_expires_at=null,
      refund_amount=null,refund_reason=null,processed_at=null,updated_at=now()
  where status='expired' and rent_payment_status in ('paid','upfront_paid') and rent_paid_at is not null
  returning id,listing_id,user_id
)
update public.listings l
set status='reserved',availability_status='reserved',reserved_by=a.user_id,reservation_expiry=null,
    reservation_fee_paid=true,chat_unlocked=true,current_reservation_id=a.id,updated_at=now()
from affected a
where l.id::text=a.listing_id
  and not exists (
    select 1 from public.reservations other
    where other.listing_id=a.listing_id and other.id<>a.id
      and other.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
  );
