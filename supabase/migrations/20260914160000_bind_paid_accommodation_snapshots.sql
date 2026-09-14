-- Bind accommodation fulfillment to the commercial terms that were presented
-- at checkout. Payment Protection answers whether verified money is currently
-- protected; this migration separately prevents a paid booking from becoming a
-- different stay after the provider charge succeeds.

create or replace function public.validate_paid_accommodation_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_reservation public.reservations;
  v_group public.shared_payment_groups;
  v_legacy_group public.shared_housing_groups;
  v_member public.shared_payment_members;
  v_legacy_member public.shared_housing_members;
  v_payer text:=coalesce(new.payer_user_id,new.user_id);
  v_total numeric(12,2):=round(coalesce(new.verified_amount,new.amount_total,new.amount,0),2);
  v_expected numeric(12,2);
begin
  if new.status not in ('paid','completed')
    or (tg_op='UPDATE' and old.status in ('paid','completed')) then
    return new;
  end if;

  if new.purpose='apartment_rent' then
    select * into v_reservation
    from public.reservations reservation
    where reservation.id=new.metadata->>'reservation_id'
    for share;

    if v_reservation.id is null
      or v_reservation.user_id is distinct from v_payer
      or v_reservation.listing_id is distinct from new.listing_id
      or v_reservation.listing_id is distinct from new.metadata->>'listing_id'
      or v_reservation.rent_payment_reference is distinct from new.paystack_reference
      or upper(coalesce(new.currency,''))<>'NGN'
    then
      raise exception 'Accommodation payment identity does not match its paid snapshot';
    end if;

    if v_reservation.stay_type='short_let' then
      if new.metadata->>'payment_component'<>'short_stay_rent'
        or nullif(new.metadata->>'check_in','')::date
          is distinct from v_reservation.stay_check_in
        or nullif(new.metadata->>'check_out','')::date
          is distinct from v_reservation.stay_check_out
        or nullif(new.metadata->>'nights','')::integer
          is distinct from v_reservation.stay_nights
        or nullif(new.metadata->>'guest_count','')::integer
          is distinct from v_reservation.guest_count
        or round(coalesce(nullif(new.metadata->>'nightly_rate','')::numeric,-1),2)
          is distinct from round(coalesce(v_reservation.nightly_rate_snapshot,-1),2)
        or round(coalesce(nullif(new.metadata->>'stay_rent_total','')::numeric,-1),2)
          is distinct from round(coalesce(v_reservation.stay_rent_total,-1),2)
        or round(coalesce(nullif(new.metadata->>'security_deposit_amount','')::numeric,-1),2)
          is distinct from round(coalesce(v_reservation.security_deposit_snapshot,0),2)
      then
        raise exception 'Short Let payment does not match its dates, guests and price snapshot';
      end if;
      v_expected:=round(
        coalesce(v_reservation.stay_rent_total,0)
        +coalesce(v_reservation.security_deposit_snapshot,0),2
      );
    elsif v_reservation.stay_type='long_stay' then
      if new.metadata->>'payment_component'<>'long_stay_rent'
        or nullif(new.metadata->>'tenure_years','')::integer
          is distinct from v_reservation.rental_plan_years
        or round(coalesce(nullif(new.metadata->>'total_contract_rent','')::numeric,-1),2)
          is distinct from round(coalesce(v_reservation.contract_rent_total,-1),2)
        or round(coalesce(nullif(new.metadata->>'year_one_upfront','')::numeric,-1),2)
          is distinct from round(coalesce(v_reservation.upfront_rent_required,-1),2)
        or round(coalesce(nullif(new.metadata->>'future_rent_balance','')::numeric,-1),2)
          is distinct from round(coalesce(v_reservation.installment_balance,0),2)
        or nullif(new.metadata->>'contribution_count','')::integer
          is distinct from v_reservation.installment_count
        or round(coalesce(nullif(new.metadata->>'security_deposit_amount','')::numeric,0),2)<>0
        or round(coalesce(v_reservation.security_deposit_snapshot,0),2)<>0
      then
        raise exception 'Long Let payment does not match its tenure and contract snapshot';
      end if;
      v_expected:=round(coalesce(v_reservation.upfront_rent_required,0),2);
    else
      raise exception 'Accommodation payment has no supported stay type';
    end if;

    if v_expected<=0
      or v_total is distinct from v_expected
      or round(coalesce(new.amount_total,new.amount,0),2) is distinct from v_expected
    then
      raise exception 'Accommodation verified amount does not match its paid snapshot';
    end if;
    return new;
  end if;

  if new.purpose<>'shared_housing_share' then
    return new;
  end if;

  select * into v_group from public.shared_payment_groups payment_group
  where payment_group.shared_payment_group_id=
    nullif(new.metadata->>'canonical_shared_payment_group_id','')::uuid
  for share;
  select * into v_member from public.shared_payment_members member
  where member.shared_payment_member_id=
    nullif(new.metadata->>'canonical_shared_payment_member_id','')::uuid
  for share;
  select * into v_legacy_group from public.shared_housing_groups payment_group
  where payment_group.id=nullif(new.metadata->>'shared_group_id','')::uuid
  for share;
  select * into v_legacy_member from public.shared_housing_members member
  where member.id=nullif(new.metadata->>'legacy_shared_member_id','')::uuid
  for share;

  if v_group.shared_payment_group_id is null
    or v_member.shared_payment_member_id is null
    or v_legacy_group.id is null
    or v_legacy_member.id is null
    or v_member.shared_payment_group_id is distinct from v_group.shared_payment_group_id
    or v_legacy_group.canonical_group_id is distinct from v_group.shared_payment_group_id
    or v_legacy_member.canonical_member_id is distinct from v_member.shared_payment_member_id
    or v_legacy_member.group_id is distinct from v_legacy_group.id
    or v_member.legacy_member_id is distinct from v_legacy_member.id
    or v_group.listing_id is distinct from new.listing_id
    or v_legacy_group.listing_id::text is distinct from new.listing_id
    or v_group.product_type is distinct from new.metadata->>'canonical_product_type'
    or v_legacy_group.product_type is distinct from v_group.product_type
    or v_group.checkout_attempt is distinct from
      nullif(new.metadata->>'checkout_attempt','')::integer
    or v_legacy_group.checkout_attempt is distinct from v_group.checkout_attempt
    or v_member.user_id is distinct from v_payer
    or v_legacy_member.user_id is distinct from v_payer
    or v_member.provider_reference is distinct from new.paystack_reference
    or v_legacy_member.payment_reference is distinct from new.paystack_reference
    or round(v_member.share_amount,2) is distinct from round(v_legacy_member.share_amount,2)
    or round(v_member.share_amount,2) is distinct from v_total
    or round(coalesce(new.amount_total,new.amount,0),2) is distinct from v_total
    or round(v_member.eligible_partner_share,2) is distinct from
      round(coalesce(nullif(new.metadata->>'eligible_partner_amount','')::numeric,-1),2)
    or round(v_member.refundable_share,2) is distinct from
      round(coalesce(nullif(new.metadata->>'refundable_amount','')::numeric,-1),2)
    or upper(coalesce(new.currency,''))<>'NGN'
  then
    raise exception 'Shared accommodation payment identity does not match its checkout snapshot';
  end if;

  if v_group.product_type='short_let' then
    select * into v_reservation from public.reservations reservation
    where reservation.id=v_group.reservation_id for share;
    if v_reservation.id is null
      or v_group.payment_phase<>'short_stay'
      or v_legacy_group.payment_phase<>'short_stay'
      or v_reservation.shared_payment_group_id is distinct from v_group.shared_payment_group_id
      or v_reservation.listing_id is distinct from v_group.listing_id
      or v_group.stay_check_in is distinct from v_reservation.stay_check_in
      or v_group.stay_check_out is distinct from v_reservation.stay_check_out
      or v_group.guest_count is distinct from v_reservation.guest_count
      or v_legacy_group.stay_check_in is distinct from v_group.stay_check_in
      or v_legacy_group.stay_check_out is distinct from v_group.stay_check_out
      or v_legacy_group.guest_count is distinct from v_group.guest_count
      or round(v_group.total_amount,2) is distinct from round(
        coalesce(v_reservation.stay_rent_total,0)
        +coalesce(v_reservation.security_deposit_snapshot,0),2
      )
      or round(v_legacy_group.total_amount,2) is distinct from round(v_group.total_amount,2)
      or round((select coalesce(sum(member.share_amount),0)
        from public.shared_payment_members member
        where member.shared_payment_group_id=v_group.shared_payment_group_id
          and member.invitation_state='accepted'),2)
        is distinct from round(v_group.total_amount,2)
      or round((select coalesce(sum(member.eligible_partner_share),0)
        from public.shared_payment_members member
        where member.shared_payment_group_id=v_group.shared_payment_group_id
          and member.invitation_state='accepted'),2)
        is distinct from round(coalesce(v_reservation.stay_rent_total,0),2)
      or round((select coalesce(sum(member.refundable_share),0)
        from public.shared_payment_members member
        where member.shared_payment_group_id=v_group.shared_payment_group_id
          and member.invitation_state='accepted'),2)
        is distinct from round(coalesce(v_reservation.security_deposit_snapshot,0),2)
    then
      raise exception 'Shared Short Let payment does not match its dates, guests and split snapshot';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.validate_paid_accommodation_snapshot() from public,anon,authenticated;
grant execute on function public.validate_paid_accommodation_snapshot() to service_role;

drop trigger if exists booking_payments_validate_accommodation_snapshot
on public.booking_payments;
create trigger booking_payments_validate_accommodation_snapshot
before insert or update of status on public.booking_payments
for each row execute function public.validate_paid_accommodation_snapshot();

create or replace function public.prevent_paid_accommodation_snapshot_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
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
$$;

revoke all on function public.prevent_paid_accommodation_snapshot_change() from public,anon,authenticated;
grant execute on function public.prevent_paid_accommodation_snapshot_change() to service_role;

drop trigger if exists reservations_prevent_paid_snapshot_change
on public.reservations;
create trigger reservations_prevent_paid_snapshot_change
before update of listing_id,user_id,stay_type,stay_check_in,stay_check_out,
  stay_nights,guest_count,occupant_count,nightly_rate_snapshot,
  stay_rent_total,security_deposit_snapshot,rental_plan_years,
  annual_rent_snapshot,contract_rent_total,upfront_rent_required,
  installment_balance,installment_count
on public.reservations
for each row execute function public.prevent_paid_accommodation_snapshot_change();

create or replace function public.prevent_shared_checkout_snapshot_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if (old.status in ('checkout_open','fully_paid')
      or new.status in ('checkout_open','fully_paid'))
    and (
      old.product_type is distinct from new.product_type
      or old.listing_id is distinct from new.listing_id
      or old.reservation_id is distinct from new.reservation_id
      or old.total_amount is distinct from new.total_amount
      or old.capacity is distinct from new.capacity
      or old.payment_phase is distinct from new.payment_phase
      or old.stay_check_in is distinct from new.stay_check_in
      or old.stay_check_out is distinct from new.stay_check_out
      or old.guest_count is distinct from new.guest_count
      or old.checkout_attempt is distinct from new.checkout_attempt
    )
  then
    raise exception 'Open or paid shared checkout terms are immutable';
  end if;
  return new;
end
$$;

revoke all on function public.prevent_shared_checkout_snapshot_change() from public,anon,authenticated;
grant execute on function public.prevent_shared_checkout_snapshot_change() to service_role;

drop trigger if exists shared_payment_groups_prevent_snapshot_change
on public.shared_payment_groups;
create trigger shared_payment_groups_prevent_snapshot_change
before update of product_type,listing_id,reservation_id,total_amount,capacity,
  payment_phase,stay_check_in,stay_check_out,guest_count,checkout_attempt
on public.shared_payment_groups
for each row execute function public.prevent_shared_checkout_snapshot_change();

create or replace function public.prevent_legacy_shared_checkout_snapshot_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_canonical_status text;
begin
  select payment_group.status into v_canonical_status
  from public.shared_payment_groups payment_group
  where payment_group.shared_payment_group_id=old.canonical_group_id;
  if (old.status in ('payment_pending','paid')
      or new.status in ('payment_pending','paid')
      or v_canonical_status in ('checkout_open','fully_paid'))
    and (
      old.product_type is distinct from new.product_type
      or old.listing_id is distinct from new.listing_id
      or old.reservation_id is distinct from new.reservation_id
      or old.total_amount is distinct from new.total_amount
      or old.member_limit is distinct from new.member_limit
      or old.reservation_fee_total is distinct from new.reservation_fee_total
      or old.contract_total is distinct from new.contract_total
      or old.stay_check_in is distinct from new.stay_check_in
      or old.stay_check_out is distinct from new.stay_check_out
      or old.guest_count is distinct from new.guest_count
      or old.checkout_attempt is distinct from new.checkout_attempt
    )
  then
    raise exception 'Open or paid shared checkout terms are immutable';
  end if;
  return new;
end
$$;

revoke all on function public.prevent_legacy_shared_checkout_snapshot_change() from public,anon,authenticated;
grant execute on function public.prevent_legacy_shared_checkout_snapshot_change() to service_role;

drop trigger if exists shared_housing_groups_prevent_snapshot_change
on public.shared_housing_groups;
create trigger shared_housing_groups_prevent_snapshot_change
before update of product_type,listing_id,reservation_id,total_amount,member_limit,
  reservation_fee_total,contract_total,stay_check_in,stay_check_out,guest_count,
  checkout_attempt
on public.shared_housing_groups
for each row execute function public.prevent_legacy_shared_checkout_snapshot_change();

-- Keep the function review registry aligned with the privilege changes made in
-- the earlier adult-signup migration. The trigger helper is service-only; the
-- date-of-birth setter remains an authenticated self-service RPC.
insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select procedure.oid::regprocedure::text,procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case when procedure.proname='require_adult_before_profile_completion'
    then 'approved_policy_helper' else 'approved_client_rpc' end,
  case when procedure.proname='require_adult_before_profile_completion'
    then 'Trigger-only enforcement of the 18+ profile completion boundary'
    else 'Authenticated actor may record only their own date of birth subject to the 18+ rule' end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
  and procedure.proname in(
    'require_adult_before_profile_completion','set_my_date_of_birth'
  )
on conflict(function_signature) do update set
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;
