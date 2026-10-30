begin;
CREATE OR REPLACE FUNCTION public.enforce_management_commission_on_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_res public.reservations;
  v_listing public.listings;
  v_policy record;
  v_group public.shared_housing_groups;
begin
  if new.subject_type not in ('short_let_stay','long_let_year_one','shared_housing_share') then
    return new;
  end if;

  if new.subject_type='shared_housing_share' then
    select g.* into v_group
    from public.shared_housing_members m
    join public.shared_housing_groups g on g.id=m.group_id
    join public.booking_payments payment on payment.paystack_reference=new.paystack_reference
      and payment.purpose='shared_housing_share'
      and payment.metadata->>'legacy_shared_member_id'=m.id::text
      and (payment.metadata->>'shared_member_id'=new.subject_id or m.id::text=new.subject_id)
      and payment.metadata->>'shared_group_id'=g.id::text
      and payment.amount_total=new.amount_total
    where m.id::text=new.subject_id or payment.metadata->>'shared_member_id'=new.subject_id;
    if v_group.id is null then
      raise exception 'Shared payment group is missing';
    end if;
    -- A coordinated reservation fee remains refundable until the shared
    -- checkout succeeds. It is not accommodation rent or Partner commission.
    if v_group.product_type='long_let' and exists(select 1 from public.booking_payments payment
      where payment.paystack_reference=new.paystack_reference and payment.metadata->>'payment_phase'='reservation_fee') then
      new.commission_rate:=0;new.amount_commission:=0;new.amount_payee:=new.amount_total;
      return new;
    end if;
    if v_group.reservation_id is not null then
      select * into v_res from public.reservations where id=v_group.reservation_id;
    end if;
    select * into v_listing from public.listings where id=v_group.listing_id;
  else
    select * into v_res from public.reservations where id=new.subject_id;
    if v_res.id is not null then
      select * into v_listing from public.listings
      where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
    end if;
  end if;

  if v_listing.id is null then raise exception 'Apartment listing is missing'; end if;
  select * into v_policy
  from private.resolve_apartment_commission_policy(
    case when new.subject_type='short_let_stay' or v_listing.sub_type='short_let'
      then 'short_let' else 'long_stay' end,
    coalesce(v_res.management_mode_snapshot,v_listing.management_mode,'wehouse'),
    v_res.commission_policy_version_id
  );
  if v_policy.policy_version_id is null or v_policy.percent not between 0 and 50 then
    raise exception 'Snapshotted apartment commission policy is missing or invalid';
  end if;
  new.commission_rate:=v_policy.percent;
  new.amount_commission:=round(new.amount_total*v_policy.percent/100,2);
  new.amount_payee:=new.amount_total-new.amount_commission;
  return new;
end
$function$;

commit;
