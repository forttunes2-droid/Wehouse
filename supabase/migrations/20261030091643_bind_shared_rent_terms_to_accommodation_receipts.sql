begin;
CREATE OR REPLACE FUNCTION public.prevent_paid_accommodation_snapshot_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_bound boolean:=false;
begin
  select exists(
    select 1 from public.booking_payments payment
    where payment.purpose='apartment_rent'
      and payment.status in ('paid','completed')
      and payment.metadata->>'reservation_id'=old.id
  ) or exists(
    select 1
    from public.shared_payment_groups payment_group
    join public.shared_payment_members member
      on member.shared_payment_group_id=payment_group.shared_payment_group_id
    where payment_group.reservation_id=old.id
      and member.payment_state='paid'
      and exists(select 1 from public.booking_payments receipt
        where receipt.paystack_reference=member.provider_reference
          and receipt.purpose='shared_housing_share' and receipt.status in('paid','completed')
          and receipt.metadata->>'payment_phase' in('contract_rent','short_stay'))
  ) or old.stay_payment_protection_id is not null
    or old.year_one_rent_protection_id is not null
  into v_bound;

  if not v_bound then return new; end if;

  if old.listing_id is distinct from new.listing_id
    or old.user_id is distinct from new.user_id
    or old.stay_type is distinct from new.stay_type
    or old.stay_check_in is distinct from new.stay_check_in
    or old.stay_check_out is distinct from new.stay_check_out
    or old.stay_nights is distinct from new.stay_nights
    or old.guest_count is distinct from new.guest_count
    or old.occupant_count is distinct from new.occupant_count
    or old.nightly_rate_snapshot is distinct from new.nightly_rate_snapshot
    or old.stay_rent_total is distinct from new.stay_rent_total
    or old.security_deposit_snapshot is distinct from new.security_deposit_snapshot
    or old.rental_plan_years is distinct from new.rental_plan_years
    or old.annual_rent_snapshot is distinct from new.annual_rent_snapshot
    or old.contract_rent_total is distinct from new.contract_rent_total
    or old.upfront_rent_required is distinct from new.upfront_rent_required
    or old.installment_balance is distinct from new.installment_balance
    or old.installment_count is distinct from new.installment_count
  then
    raise exception 'Paid accommodation terms are immutable; start a replacement checkout';
  end if;
  return new;
end
$function$;
commit;
