-- Product rule: Long Let is rent only. Refundable caution money belongs only
-- to Short Let. Reject any future listing, reservation or paid Long Let that
-- attempts to introduce a security-deposit amount.

do $$
begin
  if exists(
    select 1 from public.listings listing
    where listing.sub_type='long_stay'
      and coalesce(listing.security_deposit_amount,0)<>0
  ) or exists(
    select 1 from public.reservations reservation
    where reservation.stay_type='long_stay'
      and coalesce(reservation.security_deposit_snapshot,0)<>0
  ) then
    raise exception 'Existing Long Let deposit data must be reconciled before enforcing rent-only Long Let';
  end if;
end
$$;

alter table public.listings
drop constraint if exists listings_long_let_rent_only;
alter table public.listings
add constraint listings_long_let_rent_only check(
  sub_type is distinct from 'long_stay'
  or coalesce(security_deposit_amount,0)=0
);

alter table public.reservations
drop constraint if exists reservations_long_let_rent_only;
alter table public.reservations
add constraint reservations_long_let_rent_only check(
  stay_type is distinct from 'long_stay'
  or coalesce(security_deposit_snapshot,0)=0
);

create or replace function public.reject_long_let_deposit_payment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_reservation public.reservations;
begin
  if new.purpose<>'apartment_rent'
    or new.status not in ('paid','completed')
    or (tg_op='UPDATE' and old.status in ('paid','completed'))
  then return new;
  end if;

  select * into v_reservation from public.reservations reservation
  where reservation.id=new.metadata->>'reservation_id';
  if v_reservation.stay_type='long_stay' and (
    round(coalesce(v_reservation.security_deposit_snapshot,0),2)<>0
    or round(coalesce(nullif(new.metadata->>'security_deposit_amount','')::numeric,0),2)<>0
    or round(coalesce(new.verified_amount,new.amount_total,new.amount,0),2)
      is distinct from round(coalesce(v_reservation.upfront_rent_required,0),2)
  ) then
    raise exception 'Long Let payment must contain rent only';
  end if;
  return new;
end
$$;

revoke all on function public.reject_long_let_deposit_payment()
from public,anon,authenticated;
grant execute on function public.reject_long_let_deposit_payment()
to service_role;

drop trigger if exists booking_payments_reject_long_let_deposit
on public.booking_payments;
create trigger booking_payments_reject_long_let_deposit
before insert or update of status on public.booking_payments
for each row execute function public.reject_long_let_deposit_payment();

-- Keep shared Long Let disabled until its per-payer rent protection is complete.
-- The reason is shared rent allocation, not a deposit requirement.
create or replace function public.start_my_shared_contract_split(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  perform p_group_id;
  raise exception using
    message='Shared Long Let contract payment is temporarily unavailable',
    detail='Each payer needs a canonical rent protection component before checkout can reopen.',
    hint='Use one payer for this Long Let or complete the shared rent protection implementation.';
end;
$$;

