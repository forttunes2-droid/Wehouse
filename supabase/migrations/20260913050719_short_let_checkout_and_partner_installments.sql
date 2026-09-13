-- Resolve two launch-contract conflicts:
--   1. Short Let has one Stay checkout, not a preliminary reservation fee.
--   2. Future Long Let installments exist only when the Property Partner opts in.

-- A provisional Short Let checkout must not make dates unavailable. Paid and
-- operational stays remain mutually exclusive at the database boundary.
alter table public.reservations
  drop constraint if exists reservations_no_overlapping_short_stays;
alter table public.reservations
  add constraint reservations_no_overlapping_short_stays
  exclude using gist (
    listing_id with =,
    daterange(stay_check_in,stay_check_out,'[)') with &&
  ) where (
    stay_type='short_let'
    and status=any(array['reserved','ready_for_move_in','occupied']::text[])
  );

create or replace function public.create_short_stay_reservation(
  p_listing_id text,
  p_check_in date,
  p_check_out date,
  p_guest_count integer
) returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_listing public.listings;
  v_created public.reservations;
  v_existing public.reservations;
  v_checkout_minutes integer;
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_rate numeric(12,2);
  v_stay numeric(12,2);
  v_caution numeric(12,2);
begin
  select * into v_profile from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;

  select * into v_listing from public.listings
  where (id::text=p_listing_id or listing_id=p_listing_id)
    and deleted_at is null and sub_type='short_let'
  limit 1 for share;
  if v_listing.id is null then raise exception 'Short Let not found'; end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available' then
    raise exception 'This Short Let is not published';
  end if;
  if coalesce(v_listing.max_guests,0)<1 then
    raise exception 'Property Partner has not chosen the guest capacity';
  end if;
  if coalesce(p_guest_count,0)<1 or p_guest_count>v_listing.max_guests then
    raise exception 'Choose between 1 and % guests',v_listing.max_guests;
  end if;
  if p_check_in is null or p_check_out is null or p_check_in<current_date
    or p_check_out<=p_check_in then
    raise exception 'Choose valid future check-in and check-out dates';
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_min_nights
  from public.platform_settings where key='short_stay_min_nights'
    and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_max_nights
  from public.platform_settings where key='short_stay_max_nights'
    and coalesce(is_active,true) limit 1;
  v_min_nights:=greatest(coalesce(v_min_nights,1),1);
  v_max_nights:=greatest(coalesce(v_max_nights,90),v_min_nights);
  v_nights:=p_check_out-p_check_in;
  if v_nights<v_min_nights or v_nights>v_max_nights then
    raise exception 'Short Let must be between % and % nights',v_min_nights,v_max_nights;
  end if;

  -- Serialize availability checks only for the selected listing. Opening a
  -- checkout is provisional; an already paid/operational stay blocks it.
  perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));
  if exists(
    select 1 from public.reservations r
    where r.listing_id=v_listing.id::text
      and r.stay_type='short_let'
      and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
      and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(p_check_in,p_check_out,'[)')
  ) then raise exception 'Those Short Let dates are no longer available'; end if;

  select * into v_existing from public.reservations r
  where r.user_id=v_profile.user_id and r.listing_id=v_listing.id::text
    and r.stay_type='short_let' and r.stay_check_in=p_check_in
    and r.stay_check_out=p_check_out and r.guest_count=p_guest_count
    and r.status='payment_pending'
    and coalesce(r.payment_expires_at,now()+interval '1 minute')>now()
  order by r.created_at desc limit 1;
  if v_existing.id is not null then return v_existing; end if;

  v_rate:=round(coalesce(v_listing.price,0),2);
  v_caution:=round(coalesce(v_listing.security_deposit_amount,0),2);
  if v_rate<=0 then raise exception 'Nightly rate is not configured'; end if;
  if v_caution<0 then raise exception 'Caution fee cannot be negative'; end if;
  v_stay:=round(v_rate*v_nights,2);
  select nullif(value,'')::integer into v_checkout_minutes
  from public.platform_settings where key='apartment_payment_hold_minutes'
    and coalesce(is_active,true) limit 1;
  if v_checkout_minutes is null or v_checkout_minutes<5 or v_checkout_minutes>120 then
    v_checkout_minutes:=30;
  end if;

  insert into public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,
    listing_location,status,manual_payment_status,payment_reference,amount,
    currency,reservation_type,stay_type,stay_check_in,stay_check_out,stay_nights,
    nightly_rate_snapshot,stay_rent_total,security_deposit_snapshot,
    security_deposit_status,payment_expires_at,hold_expires_at,guest_count,
    occupant_count,canonical_state,created_at,updated_at
  ) values(
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,
    v_listing.title,v_listing.price,
    concat_ws(', ',nullif(v_listing.address,''),nullif(v_listing.city,''),nullif(v_listing.state,'')),
    'payment_pending','unpaid',null,v_stay+v_caution,'NGN','apartment','short_let',
    p_check_in,p_check_out,v_nights,v_rate,v_stay,v_caution,
    case when v_caution=0 then 'not_required' else 'pending' end,
    now()+make_interval(mins=>v_checkout_minutes),null,p_guest_count,
    p_guest_count,'checkout_pending',now(),now()
  ) returning * into v_created;

  insert into public.short_let_booking_transitions(
    reservation_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,metadata
  ) values(
    v_created.id,null,'checkout_pending','checkout_opened',
    'short-let-checkout:'||v_created.id,v_profile.user_id,'customer',
    jsonb_build_object('guest_count',p_guest_count,'check_in',p_check_in,
      'check_out',p_check_out,'stay_price',v_stay,'caution_fee',v_caution,
      'separate_reservation_fee',false)
  ) on conflict(event_key) do nothing;
  return v_created;
end
$$;

create or replace function public.create_short_stay_reservation(
  p_listing_id text,p_check_in date,p_check_out date
) returns public.reservations
language sql
security definer
set search_path to 'pg_catalog','public'
as $$
  select public.create_short_stay_reservation(p_listing_id,p_check_in,p_check_out,1)
$$;

create or replace function public.create_short_stay_payment(p_reservation_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text;
  v_res public.reservations;
  v_listing public.listings;
  v_pending public.booking_payments;
  v_reference text;
  v_stay numeric(12,2);
  v_caution numeric(12,2);
  v_total numeric(12,2);
  v_checkout_minutes integer;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and user_id=v_user_id for update;
  if v_res.id is null then raise exception 'Short Let checkout not found'; end if;
  if v_res.stay_type<>'short_let' then raise exception 'This is not a Short Let'; end if;
  if v_res.rent_payment_status='paid' then
    return jsonb_build_object('success',true,'already_paid',true,'status','paid');
  end if;
  if v_res.status not in ('payment_pending','reserved','ready_for_move_in') then
    raise exception 'This Short Let checkout cannot be paid';
  end if;
  if v_res.stay_check_out<=current_date then raise exception 'This Short Let has ended'; end if;

  select * into v_listing from public.listings
  where id::text=v_res.listing_id and deleted_at is null and sub_type='short_let'
  for share;
  if v_listing.id is null then raise exception 'Short Let not found'; end if;
  if coalesce(v_res.guest_count,1)>coalesce(v_listing.max_guests,0) then
    raise exception 'Guest count exceeds this Short Let capacity';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));
  if exists(
    select 1 from public.reservations r
    where r.listing_id=v_res.listing_id and r.id<>v_res.id
      and r.stay_type='short_let'
      and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
      and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then raise exception 'Those Short Let dates are no longer available'; end if;

  v_stay:=round(coalesce(v_res.stay_rent_total,
    v_res.nightly_rate_snapshot*v_res.stay_nights),2);
  v_caution:=round(coalesce(v_res.security_deposit_snapshot,0),2);
  v_total:=v_stay+v_caution;
  if v_stay<=0 or v_caution<0 then raise exception 'Short Let checkout amount is invalid'; end if;

  select * into v_pending from public.booking_payments
  where user_id=v_user_id and purpose='apartment_rent' and status='pending'
    and metadata->>'reservation_id'=v_res.id
    and metadata->>'payment_component'='short_stay_rent'
    and round(coalesce(amount_total,amount),2)=v_total
  order by created_at desc limit 1;
  if v_pending.id is not null then
    update public.reservations set
      payment_reference=v_pending.paystack_reference,
      rent_payment_status='payment_pending',
      rent_payment_reference=v_pending.paystack_reference,updated_at=now()
    where id=v_res.id;
    return jsonb_build_object('success',true,'reference',v_pending.paystack_reference,
      'amount',v_total,'stay_price',v_stay,'caution_fee',v_caution,'existing',true);
  end if;

  v_reference:='WHSTAY-'||upper(replace(gen_random_uuid()::text,'-',''));
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,
    amount,amount_total,currency,status,purpose,payment_method,paystack_reference,
    metadata,created_at,updated_at
  ) values(
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,
    v_total,v_total,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,
      'payment_component','short_stay_rent','check_in',v_res.stay_check_in,
      'check_out',v_res.stay_check_out,'nights',v_res.stay_nights,
      'guest_count',v_res.guest_count,'nightly_rate',v_res.nightly_rate_snapshot,
      'stay_rent_total',v_stay,'security_deposit_amount',v_caution,
      'eligible_partner_amount',v_stay,'separate_reservation_fee',false),
    now(),now()
  );
  select nullif(value,'')::integer into v_checkout_minutes
  from public.platform_settings where key='apartment_payment_hold_minutes'
    and coalesce(is_active,true) limit 1;
  if v_checkout_minutes is null or v_checkout_minutes<5 or v_checkout_minutes>120 then
    v_checkout_minutes:=30;
  end if;
  update public.reservations set
    amount=v_total,payment_reference=v_reference,manual_payment_status='unpaid',
    stay_rent_total=v_stay,security_deposit_snapshot=v_caution,
    security_deposit_status=case when v_caution=0 then 'not_required' else 'pending' end,
    rent_payment_status='payment_pending',rent_payment_reference=v_reference,
    payment_expires_at=now()+make_interval(mins=>v_checkout_minutes),updated_at=now()
  where id=v_res.id;
  return jsonb_build_object('success',true,'reference',v_reference,'amount',v_total,
    'stay_price',v_stay,'caution_fee',v_caution,'existing',false);
end
$$;

-- Preserve the Long Let branch of the legacy fulfillment function, while the
-- Short Let branch now treats the single verified checkout as the booking.
create or replace function public.fulfill_apartment_rent_payment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_res public.reservations;
  v_listing public.listings;
  v_start_months integer:=4;
  v_installment_amount numeric;
  v_upfront_percent numeric;
  v_expected numeric;
  v_conflict boolean:=false;
begin
  if new.purpose<>'apartment_rent' or new.status not in ('paid','completed') then return new; end if;
  if tg_op='UPDATE' and old.status in ('paid','completed') then return new; end if;
  select * into v_res from public.reservations
  where id=new.metadata->>'reservation_id'
    and user_id=coalesce(new.payer_user_id,new.user_id) for update;
  if v_res.id is null then raise exception 'Apartment payment has no matching reservation'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id for share;
  if v_listing.id is null then raise exception 'Listing not found'; end if;
  if v_res.rent_payment_reference is distinct from new.paystack_reference then
    raise exception 'Apartment payment reference mismatch';
  end if;

  if coalesce(v_res.stay_type,v_listing.sub_type)='short_let' then
    if new.metadata->>'payment_component'<>'short_stay_rent' then
      raise exception 'Short Let payment component mismatch';
    end if;
    if v_res.status not in ('payment_pending','reserved','ready_for_move_in') then
      raise exception 'Short Let checkout is not payable';
    end if;
    v_expected:=round(coalesce(v_res.stay_rent_total,0)+coalesce(v_res.security_deposit_snapshot,0),2);
    if round(coalesce(new.verified_amount,new.amount_total,new.amount),2)<>v_expected then
      raise exception 'Short Let payment amount mismatch';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));
    select exists(
      select 1 from public.reservations r
      where r.listing_id=v_res.listing_id and r.id<>v_res.id
        and r.stay_type='short_let'
        and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(r.stay_check_in,r.stay_check_out,'[)')
          && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
    ) into v_conflict;
    update public.reservations set
      manual_payment_status='completed',paid_at=coalesce(paid_at,now()),
      rent_payment_status='paid',rent_paid_at=coalesce(rent_paid_at,now()),
      security_deposit_status=case when coalesce(security_deposit_snapshot,0)>0 then 'held' else 'not_required' end,
      status=case when v_conflict then 'payment_conflict' else 'ready_for_move_in' end,
      canonical_state=case when v_conflict then 'payment_conflict' else 'stay_paid' end,
      refund_reason=case when v_conflict then 'Verified payment completed after the dates became unavailable' else refund_reason end,
      payment_expires_at=null,updated_at=now()
    where id=v_res.id;
    insert into public.short_let_booking_transitions(
      reservation_id,from_state,to_state,event_type,event_key,actor_type,metadata
    ) values(
      v_res.id,coalesce(v_res.canonical_state,'checkout_pending'),
      case when v_conflict then 'payment_conflict' else 'stay_paid' end,
      case when v_conflict then 'verified_payment_conflict' else 'stay_payment_verified' end,
      'short-let-paid:'||new.paystack_reference,'paystack',
      jsonb_build_object('booking_payment_id',new.id,'date_conflict',v_conflict)
    ) on conflict(event_key) do nothing;
    return new;
  end if;

  if new.metadata->>'payment_component'<>'long_stay_rent' then
    raise exception 'Long Let payment component mismatch';
  end if;
  if v_res.status not in ('reserved','ready_for_move_in') then
    raise exception 'Long Let reservation is not ready for rent settlement';
  end if;
  if round(coalesce(new.verified_amount,new.amount_total,new.amount),2)
      <>round(coalesce(v_res.annual_rent_snapshot,v_res.upfront_rent_required,0),2) then
    raise exception 'Year 1 rent payment amount mismatch';
  end if;
  update public.reservations set
    rent_payment_status=case when installment_balance>0 then 'upfront_paid' else 'paid' end,
    rent_paid_at=coalesce(rent_paid_at,now()),
    status=case when status='reserved' then 'ready_for_move_in' else status end,
    updated_at=now()
  where id=v_res.id;

  if coalesce(v_res.installment_balance,0)>0 then
    select coalesce(nullif(value,'')::integer,4) into v_start_months
    from public.platform_settings where key='rent_plan_start_after_months'
      and coalesce(is_active,true) limit 1;
    if v_start_months is null or v_start_months<>4 then v_start_months:=4; end if;
    v_installment_amount:=round(coalesce(v_res.annual_rent_snapshot,0)/8.0,2);
    v_upfront_percent:=round(100.0/greatest(coalesce(v_res.rental_plan_years,1),1),2);
    insert into public.rent_plans(
      user_id,listing_id,reservation_id,target_amount,start_after_months,
      cancellation_fee_percent,accepted_terms,status,total_contract_rent,
      upfront_percent,upfront_amount,installment_count,installment_amount,
      installment_balance,paid_installments,created_at,updated_at
    ) values(
      v_res.user_id,v_res.listing_id::uuid,v_res.id,v_res.installment_balance,
      v_start_months,coalesce((select nullif(value,'')::numeric
        from public.platform_settings where key='rent_plan_cancellation_fee_percent' limit 1),10),
      jsonb_build_object('tenure_years',v_res.rental_plan_years,
        'annual_rent',v_res.annual_rent_snapshot,'year_one_paid_in_full',true,
        'future_rent_balance',v_res.installment_balance,'start_after_months',4,
        'contributions_per_future_year',8,'partner_opt_in',true,
        'payment_protection_hold',false,'snapshot_at',now())::text,
      'active',v_res.contract_rent_total,v_upfront_percent,v_res.upfront_rent_required,
      v_res.installment_count,v_installment_amount,v_res.installment_balance,0,now(),now()
    ) on conflict do nothing;
  end if;
  return new;
end
$$;

-- Publish the corrected launch policy as a new immutable version.
with prior as (
  update public.creator_policy_versions
  set status='retired',effective_until=now(),retired_at=now()
  where policy_key='future_long_let_installments' and scope_type='global'
    and scope_key='*' and status='active'
  returning policy_version_id
)
insert into public.creator_policy_versions(
  policy_key,scope_type,scope_key,version,value,value_schema,status,
  effective_from,public_disclosure,disclosure_text,legal_review_state,reason,
  supersedes,checksum,published_at
)
select 'future_long_let_installments','global','*',
  coalesce((select max(version)+1 from public.creator_policy_versions
    where policy_key='future_long_let_installments' and scope_type='global' and scope_key='*'),1),
  '{"enabled":true,"partner_opt_in":true,"payment_protection_hold":false,"normal_settlement_after_verified_payment":true,"grace_days":7,"automatic_late_fee":false,"automatic_eviction":false}'::jsonb,
  '{"type":"feature_policy"}'::jsonb,'active',now(),true,
  'Future-year Long Let installments are available only on Partner-enabled listings and settle normally after verified payment at launch.',
  'pending','Locked launch correction: optional Partner installments without a long funds hold',
  (select policy_version_id from prior limit 1),
  md5('future_long_let_installments:partner-opt-in:normal-settlement'),now()
where not exists(
  select 1 from public.creator_policy_versions where policy_key='future_long_let_installments'
    and scope_type='global' and scope_key='*' and status='active'
    and value->>'enabled'='true'
);

create or replace function public.set_my_listing_future_installments(
  p_listing_id uuid,p_allowed boolean
) returns public.listings
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner') then
    raise exception 'Property Partner workspace required';
  end if;
  select * into v_listing from public.listings where id=p_listing_id
    and deleted_at is null for update;
  if v_listing.id is null then raise exception 'Listing not found'; end if;
  if coalesce(v_listing.partner_id,v_listing.owner_id)<>v_actor then
    raise exception 'Only the Property Partner can change this listing';
  end if;
  if coalesce(v_listing.sub_type,'')<>'long_stay' then
    raise exception 'Installments apply only to Long Let';
  end if;
  update public.listings set future_installments_allowed=coalesce(p_allowed,false),
    updated_at=now() where id=v_listing.id returning * into v_listing;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id)
  values('PARTNER_INSTALLMENT_OPTION_CHANGED','listings',v_listing.id::text,
    jsonb_build_object('allowed',v_listing.future_installments_allowed)::text,v_actor);
  return v_listing;
end
$$;

create or replace function public.update_my_reservation_plan(
  p_reservation_id text,p_plan_years integer
) returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text; v_res public.reservations; v_listing public.listings;
  v_annual numeric; v_total numeric; v_upfront numeric; v_balance numeric;
  v_count integer; v_policy public.creator_policy_versions;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_plan_years<1 or p_plan_years>5 then raise exception 'Choose a supported 1 to 5 year tenure'; end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and user_id=v_user_id
    and status=any(array['payment_pending','reserved','inspection_pending','ready_for_move_in']::text[])
  for update;
  if v_res.id is null then raise exception 'Active reservation not found'; end if;
  if v_res.rent_payment_status not in ('not_started','payment_pending') then
    raise exception 'Tenure cannot change after Year 1 rent has been paid';
  end if;
  if v_res.rent_payment_status='payment_pending' and exists(
    select 1 from public.booking_payments where paystack_reference=v_res.rent_payment_reference
      and status='pending'
  ) then raise exception 'Complete the current rent checkout before changing tenure'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id for share;
  if v_listing.id is null or coalesce(v_listing.sub_type,'long_stay')<>'long_stay' then
    raise exception 'Yearly tenure plans apply only to Long Let';
  end if;
  if coalesce(v_listing.price,0)<=0 then raise exception 'Listing rent is invalid'; end if;
  if p_plan_years>1 then
    if not coalesce(v_listing.future_installments_allowed,false) then
      raise exception 'This Property Partner has not enabled future-year installments';
    end if;
    select * into v_policy from public.creator_policy_versions
    where policy_key='future_long_let_installments' and scope_type='global'
      and scope_key='*' and status='active' and effective_from<=now()
      and (effective_until is null or effective_until>now())
    order by effective_from desc limit 1;
    if v_policy.policy_version_id is null or coalesce((v_policy.value->>'enabled')::boolean,false)=false
      or coalesce((v_policy.value->>'partner_opt_in')::boolean,false)=false
      or coalesce((v_policy.value->>'payment_protection_hold')::boolean,true)=true then
      raise exception 'Future-year installment policy is unavailable';
    end if;
  end if;
  v_annual:=round(v_listing.price,2); v_total:=round(v_annual*p_plan_years,2);
  v_upfront:=v_annual; v_balance:=round(v_annual*greatest(p_plan_years-1,0),2);
  v_count:=8*greatest(p_plan_years-1,0);
  update public.reservations set rental_plan_years=p_plan_years,
    rental_plan_selected_at=now(),annual_rent_snapshot=v_annual,
    contract_rent_total=v_total,upfront_rent_required=v_upfront,
    installment_balance=v_balance,installment_count=v_count,
    rent_payment_status='not_started',rent_payment_reference=null,updated_at=now()
  where id=v_res.id returning * into v_res;
  if p_plan_years>1 then
    insert into public.obligation_policy_snapshots(
      subject_type,subject_id,policy_version_id,calculated_value
    ) values('long_let_installment_plan',v_res.id,v_policy.policy_version_id,
      jsonb_build_object('listing_id',v_listing.id,'partner_opt_in',true,
        'years',p_plan_years,'year_one_due',v_upfront,'future_balance',v_balance,
        'installment_count',v_count,'payment_protection_hold',false))
    on conflict(subject_type,subject_id,policy_version_id) do nothing;
  end if;
  return v_res;
end
$$;

-- Every future-year contribution rechecks the Partner opt-in and current
-- Creator policy. It is a normal verified Partner payment, not a long hold.
create or replace function public.create_rent_plan_contribution_payment(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text; v_contribution public.rent_plan_contributions;
  v_plan public.rent_plans; v_res public.reservations; v_listing public.listings;
  v_policy public.creator_policy_versions; v_reference text;
  v_pending public.booking_payments;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_contribution from public.rent_plan_contributions
    where id=p_contribution_id for update;
  if v_contribution.id is null then raise exception 'Rent contribution not found'; end if;
  select * into v_plan from public.rent_plans
    where id=v_contribution.rent_plan_id and user_id=v_user_id for update;
  if v_plan.id is null or v_plan.status<>'active' then raise exception 'Active rent plan not found'; end if;
  select * into v_res from public.reservations
    where id=v_plan.reservation_id and user_id=v_user_id for share;
  if v_res.id is null or v_res.status<>'occupied' then raise exception 'Active tenancy required'; end if;
  select * into v_listing from public.listings where id=v_plan.listing_id for share;
  if v_listing.id is null or not coalesce(v_listing.future_installments_allowed,false) then
    raise exception 'The Property Partner has not enabled installments';
  end if;
  select * into v_policy from public.creator_policy_versions
  where policy_key='future_long_let_installments' and scope_type='global'
    and scope_key='*' and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  if v_policy.policy_version_id is null or not coalesce((v_policy.value->>'enabled')::boolean,false)
    or coalesce((v_policy.value->>'payment_protection_hold')::boolean,true) then
    raise exception 'Future-year installments are unavailable';
  end if;
  if v_contribution.status in ('paid','completed') then
    return jsonb_build_object('success',true,'already_paid',true,'contribution_id',v_contribution.id);
  end if;
  if v_contribution.status not in ('scheduled','payment_pending','pending')
    or coalesce(v_contribution.amount,0)<=0 then raise exception 'This contribution cannot be paid'; end if;
  select * into v_pending from public.booking_payments
  where user_id=v_user_id and purpose='rent_plan_contribution' and status='pending'
    and metadata->>'contribution_id'=v_contribution.id::text
    and round(coalesce(amount_total,amount),2)=round(v_contribution.amount,2)
  order by created_at desc limit 1;
  if v_pending.id is not null then
    update public.rent_plan_contributions set status='payment_pending',
      payment_reference=v_pending.payment_reference,paystack_reference=v_pending.paystack_reference,
      updated_at=now() where id=v_contribution.id;
    return jsonb_build_object('success',true,'reference',v_pending.paystack_reference,
      'amount',coalesce(v_pending.amount_total,v_pending.amount),'existing',true);
  end if;
  v_reference:='WHNEXT-'||upper(replace(gen_random_uuid()::text,'-',''));
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,
    amount,amount_total,currency,status,purpose,payment_method,paystack_reference,
    metadata,created_at,updated_at
  ) values(
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_plan.listing_id::text,
    v_contribution.amount,v_contribution.amount,'NGN','pending',
    'rent_plan_contribution','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_plan.listing_id::text,
      'rent_plan_id',v_plan.id,'contribution_id',v_contribution.id,
      'target_year',v_contribution.target_year,'installment_number',v_contribution.installment_number,
      'due_date',v_contribution.due_date,'payment_component','rent_plan_contribution',
      'security_deposit_amount',0,'eligible_partner_amount',v_contribution.amount,
      'policy_version_id',v_policy.policy_version_id,'payment_protection_hold',false,
      'partner_opt_in',true),now(),now()
  );
  update public.rent_plan_contributions set status='payment_pending',
    payment_reference=v_reference,paystack_reference=v_reference,updated_at=now()
  where id=v_contribution.id;
  return jsonb_build_object('success',true,'reference',v_reference,
    'amount',v_contribution.amount,'existing',false);
end
$$;

revoke all on function public.create_short_stay_reservation(text,date,date,integer) from public,anon;
revoke all on function public.create_short_stay_reservation(text,date,date) from public,anon;
revoke all on function public.create_short_stay_payment(text) from public,anon;
revoke all on function public.set_my_listing_future_installments(uuid,boolean) from public,anon;
revoke all on function public.update_my_reservation_plan(text,integer) from public,anon;
revoke all on function public.create_rent_plan_contribution_payment(uuid) from public,anon;
grant execute on function public.create_short_stay_reservation(text,date,date,integer) to authenticated,service_role;
grant execute on function public.create_short_stay_reservation(text,date,date) to authenticated,service_role;
grant execute on function public.create_short_stay_payment(text) to authenticated,service_role;
grant execute on function public.set_my_listing_future_installments(uuid,boolean) to authenticated,service_role;
grant execute on function public.update_my_reservation_plan(text,integer) to authenticated,service_role;
grant execute on function public.create_rent_plan_contribution_payment(uuid) to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc','Actor-bound canonical booking or Partner setting RPC',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'create_short_stay_reservation','create_short_stay_payment',
  'set_my_listing_future_installments','update_my_reservation_plan',
  'create_rent_plan_contribution_payment'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.create_short_stay_reservation(text,date,date,integer) is
  'Opens a provisional Short Let Stay checkout. No separate reservation charge is created.';
comment on function public.create_rent_plan_contribution_payment(uuid) is
  'Creates a normal-settlement future Long Let contribution only for a Partner-enabled listing.';
