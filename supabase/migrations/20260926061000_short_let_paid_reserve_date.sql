-- Paid Short Let Reserve date: separate Creator-controlled reservation fee,
-- date lock after verified fee payment, then later stay + refundable deposit payment.

alter table public.reservations
  add column if not exists reservation_fee_snapshot numeric(12,2),
  add column if not exists reservation_fee_status text not null default 'not_required',
  add column if not exists reservation_fee_paid_at timestamptz,
  add column if not exists short_stay_balance_due_at timestamptz;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='reservations_reservation_fee_status_check'
      and conrelid='public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_reservation_fee_status_check
      check (reservation_fee_status in ('not_required','payment_pending','paid','refunded'));
  end if;
end
$$;

-- Existing Long Let rows already use manual_payment_status as the reservation fee.
update public.reservations
set reservation_fee_status=case
      when coalesce(stay_type,'long_stay')='long_stay'
        and manual_payment_status in ('paid','completed') then 'paid'
      when coalesce(stay_type,'long_stay')='long_stay'
        and status='payment_pending' then 'payment_pending'
      else reservation_fee_status
    end,
    reservation_fee_snapshot=case
      when coalesce(stay_type,'long_stay')='long_stay' then amount
      else reservation_fee_snapshot
    end,
    reservation_fee_paid_at=case
      when coalesce(stay_type,'long_stay')='long_stay'
        and manual_payment_status in ('paid','completed') then coalesce(reservation_fee_paid_at,paid_at)
      else reservation_fee_paid_at
    end
where coalesce(stay_type,'long_stay')='long_stay';

-- Separate versioned policy for Short Let Reserve date. Default amount deliberately
-- matches the launch Long Let reservation amount; Creator may publish them independently.
do $$
declare
  v_now timestamptz:=now();
  v_version integer;
begin
  if not exists(
    select 1 from public.creator_policy_versions
    where policy_key='short_let_reservation_fee'
      and scope_type='global' and scope_key='*'
      and status='active'
      and effective_from<=v_now
      and (effective_until is null or effective_until>v_now)
  ) then
    select coalesce(max(version),0)+1 into v_version
    from public.creator_policy_versions
    where policy_key='short_let_reservation_fee'
      and scope_type='global' and scope_key='*';

    insert into public.creator_policy_versions(
      policy_key,scope_type,scope_key,version,value,value_schema,status,
      effective_from,public_disclosure,disclosure_text,legal_review_state,
      reason,checksum,published_at
    ) values(
      'short_let_reservation_fee','global','*',v_version,
      jsonb_build_object(
        'amount',10000,
        'currency','NGN',
        'payment_hold_minutes',30,
        'balance_due_hours',24,
        'customer_disclosure_required',true
      ),
      jsonb_build_object('type','fee_policy'),
      'active',v_now,true,
      'Short Let Reserve date uses a disclosed reservation payment. The later stay charge and any refundable security deposit remain separate.',
      'pending','Add paid Short Let Reserve date',
      md5('short_let_reservation_fee:'||v_version::text||':10000:30:24'),
      v_now
    );
  end if;
end
$$;

insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
select
  'short_let_reservation_fee',
  policy.value->>'amount',
  'payments',
  'Short Let Reserve date amount',
  'Compatibility mirror only. Creator short_let_reservation_fee policy is authoritative.',
  'number',false,true,now(),now()
from public.creator_policy_versions policy
where policy.policy_key='short_let_reservation_fee'
  and policy.scope_type='global' and policy.scope_key='*'
  and policy.status='active'
  and policy.effective_from<=now()
  and (policy.effective_until is null or policy.effective_until>now())
order by policy.effective_from desc,policy.version desc
limit 1
on conflict(key) do update set
  value=excluded.value,description=excluded.description,
  editable=false,is_active=true,updated_at=now();

create or replace function public.sync_short_let_reservation_fee_compatibility()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.policy_key='short_let_reservation_fee'
     and new.scope_type='global' and new.scope_key='*'
     and new.status='active' then
    if coalesce((new.value->>'amount')::numeric,0)<=0 then
      raise exception 'Invalid Short Let Reserve date amount';
    end if;
    insert into public.platform_settings(
      key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
    ) values(
      'short_let_reservation_fee',new.value->>'amount','payments',
      'Short Let Reserve date amount',
      'Compatibility mirror only. Creator short_let_reservation_fee policy is authoritative.',
      'number',false,true,now(),now()
    ) on conflict(key) do update set
      value=excluded.value,description=excluded.description,
      editable=false,is_active=true,updated_at=now();
  end if;
  return new;
end
$$;

drop trigger if exists sync_short_let_reservation_fee_compatibility_trigger
  on public.creator_policy_versions;
create trigger sync_short_let_reservation_fee_compatibility_trigger
after insert or update of value,status,effective_from,effective_until
on public.creator_policy_versions
for each row execute function public.sync_short_let_reservation_fee_compatibility();

create or replace function public.creator_get_short_let_reservation_rule()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_policy public.creator_policy_versions;
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Active Creator workspace required';
  end if;
  select * into v_policy
  from public.creator_policy_versions
  where policy_key='short_let_reservation_fee'
    and scope_type='global' and scope_key='*'
    and status='active'
    and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_policy.policy_version_id is null then
    raise exception 'Short Let Reserve date policy is missing';
  end if;
  return jsonb_build_object(
    'policy_version_id',v_policy.policy_version_id,
    'version',v_policy.version,
    'value',v_policy.value,
    'effective_from',v_policy.effective_from
  );
end
$$;
revoke all on function public.creator_get_short_let_reservation_rule() from public,anon;
grant execute on function public.creator_get_short_let_reservation_rule() to authenticated,service_role;

create or replace function public.creator_publish_short_let_reservation_rule(
  p_creator_elevation_id uuid,
  p_amount numeric,
  p_payment_hold_minutes integer,
  p_balance_due_hours integer,
  p_effective_from timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_published public.creator_policy_versions;
  v_value jsonb;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator policy authentication required';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000000 then
    raise exception 'Short Let Reserve date amount is invalid';
  end if;
  if p_payment_hold_minutes not between 5 and 120 then
    raise exception 'Short Let checkout hold must be 5 to 120 minutes';
  end if;
  if p_balance_due_hours not between 1 and 168 then
    raise exception 'Short Let balance window must be 1 to 168 hours';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<5 then
    raise exception 'Record why the Short Let rule changed';
  end if;
  v_value:=jsonb_build_object(
    'amount',round(p_amount,2),
    'currency','NGN',
    'payment_hold_minutes',p_payment_hold_minutes,
    'balance_due_hours',p_balance_due_hours,
    'customer_disclosure_required',true
  );
  select * into v_published
  from public.creator_publish_policy(
    p_creator_elevation_id,
    'short_let_reservation_fee','global','*',v_value,
    jsonb_build_object('type','fee_policy'),
    coalesce(p_effective_from,now()),true,
    'Short Let Reserve date uses a disclosed reservation payment. The later stay charge and any refundable security deposit remain separate.',
    'pending',btrim(p_reason)
  );
  return jsonb_build_object(
    'success',true,
    'policy_version_id',v_published.policy_version_id,
    'version',v_published.version,
    'status',v_published.status,
    'effective_from',v_published.effective_from
  );
end
$$;
revoke all on function public.creator_publish_short_let_reservation_rule(
  uuid,numeric,integer,integer,timestamptz,text
) from public,anon;
grant execute on function public.creator_publish_short_let_reservation_rule(
  uuid,numeric,integer,integer,timestamptz,text
) to authenticated,service_role;

create or replace function public.create_short_stay_reservation(
  p_listing_id text,
  p_check_in date,
  p_check_out date,
  p_guest_count integer
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_listing public.listings;
  v_created public.reservations;
  v_existing public.reservations;
  v_policy public.creator_policy_versions;
  v_checkout_minutes integer;
  v_fee numeric(12,2);
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_rate numeric(12,2);
  v_stay numeric(12,2);
  v_caution numeric(12,2);
  v_reference text;
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
  if p_check_in is null or p_check_out is null
     or p_check_in<timezone('Africa/Lagos',now())::date
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

  select * into v_policy
  from public.creator_policy_versions
  where policy_key='short_let_reservation_fee'
    and scope_type='global' and scope_key='*'
    and status='active'
    and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_policy.policy_version_id is null then
    raise exception 'Short Let Reserve date policy is unavailable';
  end if;
  v_fee:=round(coalesce((v_policy.value->>'amount')::numeric,0),2);
  v_checkout_minutes:=coalesce((v_policy.value->>'payment_hold_minutes')::integer,0);
  if v_fee<=0 or v_checkout_minutes not between 5 and 120 then
    raise exception 'Short Let Reserve date policy is invalid';
  end if;

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
    and r.reservation_fee_status='payment_pending'
    and coalesce(r.payment_expires_at,now()-interval '1 second')>now()
  order by r.created_at desc limit 1;
  if v_existing.id is not null then return v_existing; end if;

  v_rate:=round(coalesce(v_listing.price,0),2);
  v_caution:=round(coalesce(v_listing.security_deposit_amount,0),2);
  if v_rate<=0 then raise exception 'Nightly rate is not configured'; end if;
  if v_caution<0 then raise exception 'Refundable deposit cannot be negative'; end if;
  v_stay:=round(v_rate*v_nights,2);
  v_reference:='WHDATE-'||upper(replace(gen_random_uuid()::text,'-',''));

  insert into public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,
    listing_location,status,manual_payment_status,payment_reference,amount,
    currency,reservation_type,stay_type,stay_check_in,stay_check_out,stay_nights,
    nightly_rate_snapshot,stay_rent_total,security_deposit_snapshot,
    security_deposit_status,payment_expires_at,hold_expires_at,guest_count,
    occupant_count,canonical_state,reservation_policy_version_id,
    reservation_fee_snapshot,reservation_fee_status,created_at,updated_at
  ) values(
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,
    v_listing.title,v_listing.price,
    concat_ws(', ',nullif(v_listing.address,''),nullif(v_listing.city,''),nullif(v_listing.state,'')),
    'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment','short_let',
    p_check_in,p_check_out,v_nights,v_rate,v_stay,v_caution,
    case when v_caution=0 then 'not_required' else 'pending' end,
    now()+make_interval(mins=>v_checkout_minutes),null,p_guest_count,
    p_guest_count,'reservation_fee_pending',v_policy.policy_version_id,
    v_fee,'payment_pending',now(),now()
  ) returning * into v_created;

  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,
    amount,amount_total,currency,status,purpose,payment_method,paystack_reference,
    metadata,created_at,updated_at
  ) values(
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',
    v_listing.id::text,v_fee,v_fee,'NGN','pending','apartment_reservation',
    'paystack',v_reference,
    jsonb_build_object(
      'reservation_id',v_created.id,'listing_id',v_listing.id::text,
      'stay_type','short_let','payment_component','short_let_reservation_fee',
      'check_in',p_check_in,'check_out',p_check_out,'guest_count',p_guest_count,
      'reservation_fee',v_fee,'stay_rent_total',v_stay,
      'security_deposit_amount',v_caution,
      'policy_version_id',v_policy.policy_version_id
    ),
    now(),now()
  );

  insert into public.short_let_booking_transitions(
    reservation_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,metadata
  ) values(
    v_created.id,null,'reservation_fee_pending','reserve_date_checkout_opened',
    'short-let-reserve-date:'||v_created.id,v_profile.user_id,'customer',
    jsonb_build_object(
      'guest_count',p_guest_count,'check_in',p_check_in,'check_out',p_check_out,
      'reservation_fee',v_fee,'stay_price',v_stay,'security_deposit',v_caution,
      'policy_version_id',v_policy.policy_version_id
    )
  ) on conflict(event_key) do nothing;

  return v_created;
end
$$;

create or replace function public.fulfill_apartment_reservation_payment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_res public.reservations;
  v_listing public.listings;
  v_hold_days integer;
  v_hold_expires timestamptz;
  v_is_short boolean;
  v_balance_hours integer;
begin
  if new.purpose<>'apartment_reservation'
     or new.status not in ('paid','completed') then return new; end if;
  if tg_op='UPDATE' and old.status in ('paid','completed') then return new; end if;

  select * into v_res from public.reservations
  where payment_reference=new.paystack_reference
  limit 1 for update;
  if v_res.id is null then raise exception 'Apartment reservation payment has no reservation'; end if;
  if v_res.user_id is distinct from coalesce(new.payer_user_id,new.user_id) then
    raise exception 'Apartment reservation payment owner mismatch';
  end if;

  select * into v_listing from public.listings
  where id::text=v_res.listing_id limit 1 for update;
  if v_listing.id is null then raise exception 'Apartment reservation listing not found'; end if;
  v_is_short:=coalesce(v_res.stay_type,v_listing.sub_type,'long_stay')='short_let';

  if v_is_short then
    perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));
    if exists(
      select 1 from public.reservations r
      where r.listing_id=v_res.listing_id and r.id<>v_res.id
        and r.stay_type='short_let'
        and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(r.stay_check_in,r.stay_check_out,'[)')
          && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
    ) then
      update public.reservations
      set status='payment_conflict',manual_payment_status='paid',
          reservation_fee_status='paid',reservation_fee_paid_at=coalesce(reservation_fee_paid_at,now()),
          paid_at=coalesce(paid_at,now()),
          refund_reason='Reserve date payment completed after the selected dates became unavailable',
          processed_at=now(),updated_at=now()
      where id=v_res.id;
      return new;
    end if;

    select coalesce((p.value->>'balance_due_hours')::integer,0)
    into v_balance_hours
    from public.creator_policy_versions p
    where p.policy_version_id=v_res.reservation_policy_version_id
      and p.policy_key='short_let_reservation_fee'
    limit 1;
    if v_balance_hours not between 1 and 168 then
      raise exception 'Short Let balance window is invalid';
    end if;

    update public.reservations
    set status='reserved',
        canonical_state='date_reserved',
        manual_payment_status='paid',
        reservation_fee_status='paid',
        reservation_fee_paid_at=coalesce(reservation_fee_paid_at,now()),
        paid_at=coalesce(paid_at,now()),
        payment_expires_at=null,
        short_stay_balance_due_at=now()+make_interval(hours=>v_balance_hours),
        updated_at=now()
    where id=v_res.id;

    insert into public.short_let_booking_transitions(
      reservation_id,from_state,to_state,event_type,event_key,actor_type,metadata
    ) values(
      v_res.id,'reservation_fee_pending','date_reserved','reserve_date_payment_confirmed',
      'short-let-reserve-date-paid:'||v_res.id,'system',
      jsonb_build_object(
        'reservation_fee',coalesce(v_res.reservation_fee_snapshot,new.amount_total,new.amount),
        'balance_due_at',now()+make_interval(hours=>v_balance_hours)
      )
    ) on conflict(event_key) do nothing;
    return new;
  end if;

  if v_listing.current_reservation_id is distinct from v_res.id
     and v_listing.status<>'available' then
    update public.reservations
    set status='payment_conflict',manual_payment_status='paid',
        paid_at=coalesce(paid_at,now()),
        reservation_fee_status='paid',reservation_fee_paid_at=coalesce(reservation_fee_paid_at,now()),
        refund_reason='Payment completed after the property was assigned elsewhere',
        processed_at=now(),updated_at=now()
    where id=v_res.id;
    return new;
  end if;

  select nullif(value,'')::integer into v_hold_days
  from public.platform_settings
  where key='apartment_reservation_hold_days'
    and coalesce(is_active,true)=true limit 1;
  if v_hold_days is null or v_hold_days<1 or v_hold_days>30 then v_hold_days:=3; end if;
  v_hold_expires:=now()+make_interval(days=>v_hold_days);

  update public.reservations
  set status=case when status='payment_pending' then 'reserved' else status end,
      manual_payment_status='paid',
      reservation_fee_status='paid',
      reservation_fee_paid_at=coalesce(reservation_fee_paid_at,now()),
      reservation_fee_snapshot=coalesce(reservation_fee_snapshot,amount),
      paid_at=coalesce(paid_at,now()),
      payment_expires_at=null,
      hold_expires_at=v_hold_expires,
      updated_at=now()
  where id=v_res.id;

  update public.listings
  set status='reserved',availability_status='reserved',reserved_by=v_res.user_id,
      reservation_expiry=v_hold_expires,reservation_fee_paid=true,chat_unlocked=true,
      current_reservation_id=v_res.id,updated_at=now()
  where id=v_listing.id;
  return new;
end
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
  if v_res.id is null then raise exception 'Short Let reservation not found'; end if;
  if v_res.stay_type<>'short_let' then raise exception 'This is not a Short Let'; end if;
  if v_res.shared_payment_group_id is not null then
    raise exception 'Open the shared payment and pay only your own share';
  end if;
  if v_res.rent_payment_status='paid' then
    return jsonb_build_object('success',true,'already_paid',true,'status','paid');
  end if;
  if v_res.reservation_fee_status<>'paid'
     or v_res.manual_payment_status not in ('paid','completed')
     or v_res.reservation_fee_paid_at is null then
    raise exception 'Reserve date payment must be confirmed first';
  end if;
  if v_res.status not in ('reserved','ready_for_move_in') then
    raise exception 'This Short Let is not ready for the stay balance';
  end if;
  if v_res.short_stay_balance_due_at is not null
     and v_res.short_stay_balance_due_at<=now() then
    raise exception 'The stay balance deadline has passed. Reserve the dates again';
  end if;
  if v_res.stay_check_out<=timezone('Africa/Lagos',now())::date then
    raise exception 'This Short Let has ended';
  end if;

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
    and metadata->>'payment_component'='short_stay_balance'
    and round(coalesce(amount_total,amount),2)=v_total
  order by created_at desc limit 1;
  if v_pending.id is not null then
    update public.reservations
    set rent_payment_status='payment_pending',
        rent_payment_reference=v_pending.paystack_reference,updated_at=now()
    where id=v_res.id;
    return jsonb_build_object(
      'success',true,'reference',v_pending.paystack_reference,
      'amount',v_total,'reservation_fee_paid',v_res.reservation_fee_snapshot,
      'stay_price',v_stay,'security_deposit',v_caution,'existing',true
    );
  end if;

  v_reference:='WHSTAY-'||upper(replace(gen_random_uuid()::text,'-',''));
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,
    amount,amount_total,currency,status,purpose,payment_method,paystack_reference,
    metadata,created_at,updated_at
  ) values(
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,
    v_total,v_total,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object(
      'reservation_id',v_res.id,'listing_id',v_listing.id::text,
      'payment_component','short_stay_balance','check_in',v_res.stay_check_in,
      'check_out',v_res.stay_check_out,'nights',v_res.stay_nights,
      'guest_count',v_res.guest_count,'nightly_rate',v_res.nightly_rate_snapshot,
      'reservation_fee_paid',v_res.reservation_fee_snapshot,
      'stay_rent_total',v_stay,'security_deposit_amount',v_caution,
      'eligible_partner_amount',v_stay
    ),now(),now()
  );

  -- Reuse the existing Short Let checkout window for the payment session only.
  select (p.value->>'minutes')::integer into v_checkout_minutes
  from public.creator_policy_versions p
  where p.policy_key='short_let_reservation_hold'
    and p.scope_type='global' and p.scope_key='*'
    and p.status='active'
    and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
  order by p.effective_from desc,p.version desc limit 1;
  if v_checkout_minutes is null or v_checkout_minutes<5 or v_checkout_minutes>120 then
    v_checkout_minutes:=30;
  end if;

  update public.reservations
  set amount=v_total,
      rent_payment_status='payment_pending',
      rent_payment_reference=v_reference,
      payment_expires_at=now()+make_interval(mins=>v_checkout_minutes),
      updated_at=now()
  where id=v_res.id;

  return jsonb_build_object(
    'success',true,'reference',v_reference,'amount',v_total,
    'reservation_fee_paid',v_res.reservation_fee_snapshot,
    'stay_price',v_stay,'security_deposit',v_caution,'existing',false
  );
end
$$;

create or replace function public.expire_overdue_reservations()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_role text;
  v_count integer:=0;
  v_row record;
begin
  if auth.uid() is not null then
    select role into v_role from public.profiles
    where auth_id=auth.uid()::text
      and coalesce(deleted,false)=false
      and coalesce(suspended,false)=false
      and coalesce(banned,false)=false limit 1;
    if v_role<>'creator' then raise exception 'Creator or service execution required'; end if;
  end if;

  for v_row in
    select r.id,r.listing_id,r.status,r.payment_reference,
           r.rent_payment_reference,coalesce(r.stay_type,'long_stay') as stay_type,
           r.reservation_fee_status,r.short_stay_balance_due_at
    from public.reservations r
    where coalesce(r.rent_payment_status,'not_started') not in ('paid','upfront_paid')
      and (
        (r.status='payment_pending' and r.payment_expires_at<now())
        or (coalesce(r.stay_type,'long_stay')<>'short_let'
            and r.status in ('reserved','inspection_pending','ready_for_move_in')
            and r.hold_expires_at<now())
        or (r.stay_type='short_let'
            and r.status='reserved'
            and r.reservation_fee_status='paid'
            and r.short_stay_balance_due_at is not null
            and r.short_stay_balance_due_at<now())
      )
    for update
  loop
    if v_row.status='payment_pending' and exists(
      select 1 from public.booking_payments bp
      where bp.paystack_reference=v_row.payment_reference
        and bp.status in ('paid','completed')
    ) then continue; end if;

    update public.reservations
    set status='expired',
        refund_amount=0,
        refund_reason=case
          when v_row.stay_type='short_let' and v_row.reservation_fee_status='paid'
            then 'Short Let stay balance deadline expired'
          else 'Reservation hold expired'
        end,
        processed_at=now(),updated_at=now()
    where id=v_row.id
      and coalesce(rent_payment_status,'not_started') not in ('paid','upfront_paid');
    if not found then continue; end if;

    update public.booking_payments set status='expired',updated_at=now()
    where status='pending'
      and paystack_reference in (v_row.payment_reference,v_row.rent_payment_reference);

    if v_row.stay_type<>'short_let' then
      update public.listings
      set status='available',availability_status='available',reserved_by=null,
          reservation_expiry=null,reservation_fee_paid=false,chat_unlocked=false,
          current_reservation_id=null,updated_at=now()
      where id::text=v_row.listing_id and current_reservation_id=v_row.id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$$;

-- Browser may create and resume its own reservation/stay payment flows only.
revoke all on function public.create_short_stay_reservation(text,date,date,integer) from public,anon;
grant execute on function public.create_short_stay_reservation(text,date,date,integer) to authenticated;
revoke all on function public.create_short_stay_payment(text) from public,anon;
grant execute on function public.create_short_stay_payment(text) to authenticated;
