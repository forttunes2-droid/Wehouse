-- Consolidate booking and money authority under immutable Creator policy versions.
-- Legacy platform_settings remain one-way compatibility mirrors only.
-- Existing bookings keep their snapshotted/accepted policy versions.

create or replace function public.sync_creator_commission_compatibility()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_value text;
begin
  if new.scope_type<>'global' or new.scope_key<>'*' or new.status<>'active' then
    return new;
  end if;

  if new.policy_key='commission_worker' then
    v_value:=new.value->>'percent';
    if v_value is null or v_value::numeric<0 or v_value::numeric>50 then
      raise exception 'Invalid Creator Service Worker commission';
    end if;
    insert into public.platform_settings(
      key,value,category,label,description,data_type,editable,is_active,
      created_at,updated_at
    ) values(
      'worker_commission_rate',v_value,'payments','Service Worker commission rate',
      'Compatibility mirror only. Creator policy registry is authoritative.',
      'number',false,true,now(),now()
    ) on conflict(key) do update set
      value=excluded.value,description=excluded.description,
      editable=false,is_active=true,updated_at=now();
  elsif new.policy_key='commission_hotel' then
    v_value:=new.value->>'percent';
    if v_value is null or v_value::numeric<0 or v_value::numeric>50 then
      raise exception 'Invalid Creator Hotel commission';
    end if;
    insert into public.platform_settings(
      key,value,category,label,description,data_type,editable,is_active,
      created_at,updated_at
    ) values(
      'commission_hotel',v_value,'payments','Hotel commission rate',
      'Compatibility mirror only. Creator policy registry is authoritative.',
      'number',false,true,now(),now()
    ) on conflict(key) do update set
      value=excluded.value,description=excluded.description,
      editable=false,is_active=true,updated_at=now();
  elsif new.policy_key='long_let_reservation_fee' then
    v_value:=new.value->>'amount';
    if v_value is null or v_value::numeric<=0 then
      raise exception 'Invalid Long Let reservation amount';
    end if;
    insert into public.platform_settings(
      key,value,category,label,description,data_type,editable,is_active,
      created_at,updated_at
    ) values(
      'reservation_fee',v_value,'payments','Long Let reservation amount',
      'Compatibility mirror only. Creator policy registry is authoritative.',
      'number',false,true,now(),now()
    ) on conflict(key) do update set
      value=excluded.value,description=excluded.description,
      editable=false,is_active=true,updated_at=now();
  elsif new.policy_key='short_let_reservation_hold' then
    v_value:=new.value->>'minutes';
    if v_value is null or v_value::integer<5 or v_value::integer>120 then
      raise exception 'Invalid Short Let checkout hold';
    end if;
    insert into public.platform_settings(
      key,value,category,label,description,data_type,editable,is_active,
      created_at,updated_at
    ) values(
      'apartment_payment_hold_minutes',v_value,'payments','Short Let payment hold',
      'Compatibility mirror only. Creator policy registry is authoritative.',
      'number',false,true,now(),now()
    ) on conflict(key) do update set
      value=excluded.value,description=excluded.description,
      editable=false,is_active=true,updated_at=now();
  end if;
  return new;
end
$$;

create or replace function public.calculate_commission(
  p_amount numeric,
  p_type text default 'worker'
)
returns numeric
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_key text;
  v_percent numeric;
begin
  if p_amount is null or p_amount<0 then
    raise exception 'Amount must be zero or greater';
  end if;

  v_key:=case lower(btrim(coalesce(p_type,'')))
    when 'worker' then 'commission_worker'
    when 'service_worker' then 'commission_worker'
    when 'hotel' then 'commission_hotel'
    when 'short_let' then 'commission_short_let'
    when 'long_let' then 'commission_long_let'
    else null
  end;
  if v_key is null then
    raise exception 'Commission type must be Service Worker, Hotel, Short Let or Long Let';
  end if;

  select (policy.value->>'percent')::numeric into v_percent
  from public.creator_policy_versions policy
  where policy.policy_key=v_key
    and policy.scope_type='global'
    and policy.scope_key='*'
    and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc
  limit 1;

  if v_percent is null or v_percent<0 or v_percent>50 then
    raise exception 'Active Creator commission policy is missing or invalid';
  end if;
  return round(p_amount*v_percent/100,2);
end
$;

-- calculate_commission is an internal money helper. Keep it off the browser RPC
-- surface even though it is SECURITY DEFINER; only trusted server-side flows may
-- execute it.
revoke all on function public.calculate_commission(numeric,text) from public;
revoke execute on function public.calculate_commission(numeric,text) from anon, authenticated;
grant execute on function public.calculate_commission(numeric,text) to service_role;

create or replace function public.set_apartment_commission_on_reservation(
  p_reservation_id text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_stay_type text;
  v_rate numeric;
begin
  select coalesce(stay_type,'long_stay') into v_stay_type
  from public.reservations
  where id=p_reservation_id
  for update;
  if v_stay_type is null then
    raise exception 'Reservation not found';
  end if;

  select (policy.value->>'percent')::numeric into v_rate
  from public.creator_policy_versions policy
  where policy.policy_key=case
      when v_stay_type='short_let' then 'commission_short_let'
      else 'commission_long_let'
    end
    and policy.scope_type='global'
    and policy.scope_key='*'
    and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc
  limit 1;

  if v_rate is null or v_rate<0 or v_rate>50 then
    raise exception 'Active Creator apartment commission policy is missing';
  end if;
  update public.reservations
  set commission_rate=v_rate,updated_at=now()
  where id=p_reservation_id;
  return true;
end
$$;

create or replace function public.enforce_listing_caution_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy jsonb;
  v_amount numeric:=coalesce(new.security_deposit_amount,0);
  v_max_amount numeric;
  v_max_nights numeric;
  v_effective_cap numeric;
begin
  if v_amount<0 then raise exception 'Caution amount cannot be negative'; end if;
  if v_amount=0 then return new; end if;
  if new.sub_type<>'short_let' then
    raise exception 'Caution is available only for Short Let listings';
  end if;

  select policy.value into v_policy
  from public.creator_policy_versions policy
  where policy.policy_key='short_let_caution_cap'
    and policy.scope_type='global'
    and policy.scope_key='*'
    and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc
  limit 1;

  if not coalesce((v_policy->>'enabled')::boolean,false) then
    raise exception 'Short Let refundable security deposits are disabled';
  end if;

  v_max_amount:=nullif(v_policy->>'maximum_amount','')::numeric;
  v_max_nights:=nullif(v_policy->>'maximum_nights','')::numeric;
  if v_max_nights is not null then
    if v_max_nights<=0 or coalesce(new.price,0)<=0 then
      raise exception 'Short Let deposit policy or nightly rate is invalid';
    end if;
    v_effective_cap:=round(new.price*v_max_nights,2);
  end if;
  if v_max_amount is not null then
    v_effective_cap:=case
      when v_effective_cap is null then v_max_amount
      else least(v_effective_cap,v_max_amount)
    end;
  end if;
  if v_effective_cap is null or v_amount>v_effective_cap then
    raise exception 'Short Let refundable security deposit exceeds the active Creator policy';
  end if;
  return new;
end
$$;

create or replace function public.enforce_short_let_checkout_window()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_minutes integer;
  v_deadline timestamptz;
begin
  if new.stay_type<>'short_let'
     or new.status<>'payment_pending'
     or coalesce(new.rent_payment_status,'not_started') in ('paid','upfront_paid') then
    return new;
  end if;

  select (policy.value->>'minutes')::integer into v_minutes
  from public.creator_policy_versions policy
  where policy.policy_key='short_let_reservation_hold'
    and policy.scope_type='global'
    and policy.scope_key='*'
    and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc
  limit 1;
  if v_minutes is null or v_minutes<5 or v_minutes>120 then
    raise exception 'Active Short Let reservation hold policy is missing or invalid';
  end if;

  v_deadline:=now()+make_interval(mins=>v_minutes);
  if new.payment_expires_at is null or new.payment_expires_at>v_deadline then
    new.payment_expires_at:=v_deadline;
  end if;
  return new;
end
$$;

drop trigger if exists enforce_short_let_checkout_window_trigger on public.reservations;
create trigger enforce_short_let_checkout_window_trigger
before insert or update of payment_expires_at,status,rent_payment_status
on public.reservations
for each row execute function public.enforce_short_let_checkout_window();

create or replace function public.enforce_shared_short_let_checkout_window()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_minutes integer;
  v_deadline timestamptz;
begin
  if new.product_type<>'short_let' then return new; end if;
  select (policy.value->>'minutes')::integer into v_minutes
  from public.creator_policy_versions policy
  where policy.policy_key='short_let_reservation_hold'
    and policy.scope_type='global'
    and policy.scope_key='*'
    and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc limit 1;
  if v_minutes is null or v_minutes<5 or v_minutes>120 then
    raise exception 'Active Short Let reservation hold policy is missing or invalid';
  end if;
  v_deadline:=now()+make_interval(mins=>v_minutes);

  if tg_table_name='shared_housing_groups' then
    if new.expires_at is null or new.expires_at>v_deadline then
      new.expires_at:=v_deadline;
    end if;
  else
    if new.checkout_expires_at is null or new.checkout_expires_at>v_deadline then
      new.checkout_expires_at:=v_deadline;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists enforce_shared_short_let_checkout_window_housing
  on public.shared_housing_groups;
create trigger enforce_shared_short_let_checkout_window_housing
before insert or update of expires_at,status,product_type
on public.shared_housing_groups
for each row execute function public.enforce_shared_short_let_checkout_window();

drop trigger if exists enforce_shared_short_let_checkout_window_payment
  on public.shared_payment_groups;
create trigger enforce_shared_short_let_checkout_window_payment
before insert or update of checkout_expires_at,status,product_type
on public.shared_payment_groups
for each row execute function public.enforce_shared_short_let_checkout_window();

create or replace function public.begin_long_let_hold(
  p_reservation_id text,
  p_provider_event_id uuid,
  p_event_key text
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_res public.reservations;
  v_listing public.listings;
  v_policy public.creator_policy_versions;
  v_hold_hours integer;
  v_refund_hours integer;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and coalesce(stay_type,'long_stay')='long_stay'
  for update;
  if v_res.id is null then raise exception 'Long Let reservation not found'; end if;
  if not exists(
    select 1 from public.verified_provider_events
    where provider_event_id=p_provider_event_id and processed_at is not null
  ) then raise exception 'Verified provider event required'; end if;

  select * into v_listing from public.listings
  where listing_id=v_res.listing_id or id::text=v_res.listing_id
  for update;
  if v_listing.id is null or v_listing.sub_type<>'long_stay'
     or v_listing.deleted_at is not null then
    raise exception 'Long Let property not available';
  end if;
  if v_res.occupant_count>coalesce(v_listing.max_occupants,1) then
    raise exception 'Occupant capacity exceeded';
  end if;
  if exists(
    select 1 from public.reservations r
    where r.id<>v_res.id and r.listing_id=v_res.listing_id
      and coalesce(r.stay_type,'long_stay')='long_stay'
      and coalesce(r.canonical_state,r.status) in(
        'hold_active','inspection_requested','inspection_completed',
        'rent_pending','rent_protected','handover_pending',
        'handover_verified','active'
      )
      and coalesce(r.hold_expires_at,'infinity')>now()
  ) then raise exception 'Property already has an active Long Let obligation'; end if;

  select * into v_policy
  from public.creator_policy_versions
  where policy_key='long_let_reservation_hold'
    and scope_type='global' and scope_key='*'
    and status='active'
    and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  if v_policy.policy_version_id is null then
    raise exception 'Long Let hold policy missing';
  end if;
  v_hold_hours:=coalesce((v_policy.value->>'hours')::integer,0);
  v_refund_hours:=coalesce((v_policy.value->>'full_refund_hours')::integer,0);
  if v_hold_hours<1 or v_hold_hours>168 or v_refund_hours<0 or v_refund_hours>v_hold_hours then
    raise exception 'Long Let hold policy is invalid';
  end if;

  update public.reservations
  set canonical_state='hold_active',status='reserved',
      hold_expires_at=now()+make_interval(hours=>v_hold_hours),
      reservation_policy_version_id=v_policy.policy_version_id,
      paid_at=coalesce(paid_at,now()),updated_at=now()
  where id=v_res.id returning * into v_res;

  insert into public.long_let_reservation_transitions(
    reservation_id,from_state,to_state,event_type,event_key,actor_type,
    policy_version_id,metadata
  ) values(
    v_res.id,'reservation_fee_pending','hold_active','reservation_fee_confirmed',
    p_event_key,'system',v_policy.policy_version_id,
    jsonb_build_object(
      'provider_event_id',p_provider_event_id,
      'hold_expires_at',v_res.hold_expires_at,
      'full_refund_until',v_res.paid_at+make_interval(hours=>v_refund_hours)
    )
  ) on conflict(event_key) do nothing;
  return v_res;
end
$$;

create or replace function public.creator_get_booking_money_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_active jsonb;
  v_scheduled jsonb;
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Active Creator workspace required';
  end if;

  select coalesce(jsonb_object_agg(policy_key,payload),'{}'::jsonb)
  into v_active
  from (
    select distinct on(policy_key)
      policy_key,
      jsonb_build_object(
        'policy_version_id',policy_version_id,
        'version',version,
        'value',value,
        'effective_from',effective_from,
        'legal_review_state',legal_review_state,
        'disclosure_text',disclosure_text
      ) payload
    from public.creator_policy_versions
    where scope_type='global' and scope_key='*'
      and status='active'
      and policy_key=any(array[
        'short_let_reservation_hold','short_let_cancellation',
        'short_let_caution_cap','caution_claim_windows',
        'accommodation_arrival_issue_window',
        'long_let_reservation_fee','long_let_reservation_hold',
        'long_let_cancellation','future_long_let_installments',
        'commission_short_let','commission_long_let',
        'commission_hotel','commission_worker',
        'worker_completion_release'
      ])
    order by policy_key,effective_from desc,version desc
  ) active_rows;

  select coalesce(jsonb_object_agg(policy_key,payload),'{}'::jsonb)
  into v_scheduled
  from (
    select distinct on(policy_key)
      policy_key,
      jsonb_build_object(
        'policy_version_id',policy_version_id,
        'version',version,
        'value',value,
        'effective_from',effective_from,
        'legal_review_state',legal_review_state,
        'disclosure_text',disclosure_text
      ) payload
    from public.creator_policy_versions
    where scope_type='global' and scope_key='*'
      and status='scheduled'
      and policy_key=any(array[
        'short_let_reservation_hold','short_let_cancellation',
        'short_let_caution_cap','caution_claim_windows',
        'accommodation_arrival_issue_window',
        'long_let_reservation_fee','long_let_reservation_hold',
        'long_let_cancellation','future_long_let_installments',
        'commission_short_let','commission_long_let',
        'commission_hotel','commission_worker',
        'worker_completion_release'
      ])
    order by policy_key,effective_from desc,version desc
  ) scheduled_rows;

  return jsonb_build_object(
    'active',v_active,
    'scheduled',v_scheduled,
    'source_of_truth','creator_policy_versions',
    'finance_is_read_only',true
  );
end
$$;

revoke all on function public.creator_get_booking_money_rules()
from public,anon;
grant execute on function public.creator_get_booking_money_rules()
to authenticated,service_role;

create or replace function public.creator_publish_booking_money_rules(
  p_creator_elevation_id uuid,
  p_rules jsonb,
  p_effective_from timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_effective timestamptz:=coalesce(p_effective_from,now());
  v_reason text:=btrim(coalesce(p_reason,''));
  v_short jsonb:=p_rules->'short_let';
  v_long jsonb:=p_rules->'long_let';
  v_comm jsonb:=p_rules->'commissions';
  v_worker jsonb:=p_rules->'service_worker';
  v_item jsonb;
  v_value jsonb;
  v_current jsonb;
  v_key text;
  v_changed integer:=0;
  v_result jsonb:='{}'::jsonb;
  v_published public.creator_policy_versions;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator policy authentication required';
  end if;
  if jsonb_typeof(p_rules)<>'object'
     or jsonb_typeof(v_short)<>'object'
     or jsonb_typeof(v_long)<>'object'
     or jsonb_typeof(v_comm)<>'object'
     or jsonb_typeof(v_worker)<>'object' then
    raise exception 'Complete Booking & money rules are required';
  end if;
  if char_length(v_reason)<5 then
    raise exception 'Record why the Booking & money rules changed';
  end if;
  if v_effective<now()-interval '5 minutes'
     or v_effective>now()+interval '366 days' then
    raise exception 'Choose a valid effective date';
  end if;

  if coalesce((v_short->>'reservation_hold_minutes')::integer,0) not between 5 and 120 then
    raise exception 'Short Let reserve-date hold must be 5 to 120 minutes';
  end if;
  if coalesce((v_short->>'full_refund_hours_before_check_in')::integer,-1) not between 0 and 720 then
    raise exception 'Short Let full-refund cutoff is invalid';
  end if;
  if coalesce((v_short->>'late_cancel_max_nights')::numeric,-1) not between 0 and 7
     or coalesce((v_short->>'no_show_max_nights')::numeric,-1) not between 0 and 7 then
    raise exception 'Short Let cancellation/no-show cap is invalid';
  end if;
  if coalesce((v_short->>'security_deposit_max_nights')::numeric,-1) not between 0 and 7 then
    raise exception 'Short Let refundable security deposit cap is invalid';
  end if;
  if coalesce((v_short->>'partner_claim_hours')::integer,0) not between 1 and 168
     or coalesce((v_short->>'guest_response_hours')::integer,0) not between 1 and 168 then
    raise exception 'Short Let deposit claim windows are invalid';
  end if;
  if coalesce((v_short->>'arrival_issue_hours')::integer,0) not between 1 and 24 then
    raise exception 'Arrival issue window is invalid';
  end if;

  if coalesce((v_long->>'reservation_amount')::numeric,0)<=0 then
    raise exception 'Long Let reservation amount must be greater than zero';
  end if;
  if coalesce((v_long->>'payment_hold_minutes')::integer,0) not between 5 and 120 then
    raise exception 'Long Let payment checkout hold is invalid';
  end if;
  if coalesce((v_long->>'hold_hours')::integer,0) not between 1 and 168 then
    raise exception 'Long Let reservation hold is invalid';
  end if;
  if coalesce((v_long->>'full_refund_hours')::integer,-1) not between 0 and 168 then
    raise exception 'Long Let refund window is invalid';
  end if;
  if coalesce((v_long->>'installments_enabled')::boolean,false) then
    raise exception 'Long Let installments are disabled for launch';
  end if;
  if coalesce((v_long->>'security_deposit_enabled')::boolean,false) then
    raise exception 'Long Let security deposits are disabled for launch';
  end if;

  if coalesce((v_comm->>'short_let_percent')::numeric,-1) not between 0 and 50
     or coalesce((v_comm->>'long_let_percent')::numeric,-1) not between 0 and 50
     or coalesce((v_comm->>'hotel_percent')::numeric,-1) not between 0 and 50
     or coalesce((v_comm->>'service_worker_percent')::numeric,-1) not between 0 and 50 then
    raise exception 'Commission percentages must be between 0 and 50';
  end if;
  if coalesce((v_worker->>'completion_reminder_hours')::integer,0) not between 1 and 168
     or coalesce((v_worker->>'release_eligible_hours')::integer,0) not between 1 and 168 then
    raise exception 'Service Worker completion timing is invalid';
  end if;

  for v_item in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object(
        'key','short_let_reservation_hold',
        'value',jsonb_build_object(
          'minutes',(v_short->>'reservation_hold_minutes')::integer,
          'payment_required',true
        ),
        'schema',jsonb_build_object('type','duration_policy'),
        'disclosure','Short Let dates are held only while checkout is completed.'
      ),
      jsonb_build_object(
        'key','short_let_cancellation',
        'value',jsonb_build_object(
          'full_refund_hours_before_check_in',(v_short->>'full_refund_hours_before_check_in')::integer,
          'late_cancel_max_nights',(v_short->>'late_cancel_max_nights')::numeric,
          'no_show_max_nights',(v_short->>'no_show_max_nights')::numeric,
          'death_or_hospitalisation_waives_fee',true,
          'rebooking_mitigation',true,
          'security_deposit_never_cancellation_charge',true
        ),
        'schema',jsonb_build_object('type','cancellation_policy'),
        'disclosure','Short Let cancellation and no-show charges are capped and disclosed before payment.'
      ),
      jsonb_build_object(
        'key','short_let_caution_cap',
        'value',jsonb_build_object(
          'enabled',(v_short->>'security_deposit_enabled')::boolean,
          'maximum_nights',(v_short->>'security_deposit_max_nights')::numeric,
          'maximum_amount',null,
          'currency','NGN'
        ),
        'schema',jsonb_build_object('type','nightly_rate_cap'),
        'disclosure','A Short Let refundable security deposit is damage protection only and is not commission or a cancellation charge.'
      ),
      jsonb_build_object(
        'key','caution_claim_windows',
        'value',jsonb_build_object(
          'guest_damage_hours',4,
          'partner_claim_hours',(v_short->>'partner_claim_hours')::integer,
          'guest_response_hours',(v_short->>'guest_response_hours')::integer,
          'appeal_hours',48
        ),
        'schema',jsonb_build_object('type','duration_policy'),
        'disclosure','Short Let security-deposit claims require evidence and a response window.'
      ),
      jsonb_build_object(
        'key','accommodation_arrival_issue_window',
        'value',jsonb_build_object(
          'default_hours',(v_short->>'arrival_issue_hours')::integer,
          'minimum_hours',least((v_short->>'arrival_issue_hours')::integer,2),
          'maximum_hours',greatest((v_short->>'arrival_issue_hours')::integer,4)
        ),
        'schema',jsonb_build_object('type','duration_policy'),
        'disclosure','Hotel and Short Let arrival issues can be reported during the displayed protection window.'
      ),
      jsonb_build_object(
        'key','long_let_reservation_fee',
        'value',jsonb_build_object(
          'amount',(v_long->>'reservation_amount')::numeric,
          'currency','NGN',
          'payment_hold_minutes',(v_long->>'payment_hold_minutes')::integer,
          'customer_disclosure_required',true
        ),
        'schema',jsonb_build_object('type','fee_policy'),
        'disclosure','Long Let uses a disclosed reservation payment before the housing process begins.'
      ),
      jsonb_build_object(
        'key','long_let_reservation_hold',
        'value',jsonb_build_object(
          'hours',(v_long->>'hold_hours')::integer,
          'full_refund_hours',(v_long->>'full_refund_hours')::integer,
          'reminders_hours_remaining',jsonb_build_array(24,6,0)
        ),
        'schema',jsonb_build_object('type','duration_policy'),
        'disclosure','A paid Long Let reservation starts a time-limited housing process.'
      ),
      jsonb_build_object(
        'key','long_let_cancellation',
        'value',jsonb_build_object(
          'full_refund_hours',(v_long->>'full_refund_hours')::integer,
          'requires_no_material_process',true,
          'later_refund','reasonable_stage_calculation',
          'legal_exceptions_reviewable',true
        ),
        'schema',jsonb_build_object('type','cancellation_policy'),
        'disclosure','Long Let cancellation outcomes depend on timing and whether material housing work has begun.'
      ),
      jsonb_build_object(
        'key','future_long_let_installments',
        'value',jsonb_build_object(
          'enabled',false,'partner_opt_in',true,
          'payment_protection_hold',false,'grace_days',7,
          'automatic_late_fee',false,'automatic_eviction',false
        ),
        'schema',jsonb_build_object('type','feature_policy'),
        'disclosure','Long Let installments are unavailable at launch.'
      ),
      jsonb_build_object(
        'key','commission_short_let',
        'value',jsonb_build_object('percent',(v_comm->>'short_let_percent')::numeric),
        'schema',jsonb_build_object('type','percent'),
        'disclosure','WeHouse commission on Short Let accommodation value.'
      ),
      jsonb_build_object(
        'key','commission_long_let',
        'value',jsonb_build_object('percent',(v_comm->>'long_let_percent')::numeric),
        'schema',jsonb_build_object('type','percent'),
        'disclosure','WeHouse commission on Long Let eligible rent value.'
      ),
      jsonb_build_object(
        'key','commission_hotel',
        'value',jsonb_build_object('percent',(v_comm->>'hotel_percent')::numeric),
        'schema',jsonb_build_object('type','percent'),
        'disclosure','WeHouse commission on Hotel booking value.'
      ),
      jsonb_build_object(
        'key','commission_worker',
        'value',jsonb_build_object('percent',(v_comm->>'service_worker_percent')::numeric),
        'schema',jsonb_build_object('type','percent'),
        'disclosure','WeHouse commission on Service Worker booking value.'
      ),
      jsonb_build_object(
        'key','worker_completion_release',
        'value',jsonb_build_object(
          'reminder_hours',(v_worker->>'completion_reminder_hours')::integer,
          'release_eligible_hours',(v_worker->>'release_eligible_hours')::integer,
          'help_days',3,'review_edit_hours',48
        ),
        'schema',jsonb_build_object('type','duration_policy'),
        'disclosure','Service Worker funds remain protected until confirmed or controlled completion.'
      )
    ))
  loop
    v_key:=v_item->>'key';
    v_value:=v_item->'value';

    select policy.value into v_current
    from public.creator_policy_versions policy
    where policy.policy_key=v_key
      and policy.scope_type='global'
      and policy.scope_key='*'
      and policy.status=case when v_effective>now() then 'scheduled' else 'active' end
    order by policy.effective_from desc,policy.version desc
    limit 1;

    if v_current is distinct from v_value then
      select * into v_published
      from public.creator_publish_policy(
        p_creator_elevation_id,
        v_key,'global','*',v_value,v_item->'schema',v_effective,
        true,v_item->>'disclosure','pending',v_reason
      );
      v_result:=v_result||jsonb_build_object(
        v_key,
        jsonb_build_object(
          'policy_version_id',v_published.policy_version_id,
          'version',v_published.version,
          'status',v_published.status,
          'effective_from',v_published.effective_from
        )
      );
      v_changed:=v_changed+1;
    end if;
  end loop;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    public.current_profile_user_id(),
    'creator_publish_booking_money_rules',
    'creator_policy_bundle',
    md5(v_effective::text||v_reason),
    jsonb_build_object(
      'changed_policy_count',v_changed,
      'effective_from',v_effective,
      'reason',v_reason,
      'creator_elevation_id',p_creator_elevation_id
    )::text,
    now()
  );

  return jsonb_build_object(
    'success',true,
    'changed_policy_count',v_changed,
    'effective_from',v_effective,
    'published',v_result
  );
end
$$;

revoke all on function public.creator_publish_booking_money_rules(
  uuid,jsonb,timestamptz,text
) from public,anon;
grant execute on function public.creator_publish_booking_money_rules(
  uuid,jsonb,timestamptz,text
) to authenticated,service_role;

-- Lock the agreed launch defaults as immutable policy versions. This is
-- additive: existing active versions are retired, never rewritten.
do $$
declare
  v_item jsonb;
  v_current public.creator_policy_versions;
  v_version integer;
  v_now timestamptz:=now();
begin
  for v_item in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object(
        'key','short_let_reservation_hold',
        'value',jsonb_build_object('minutes',30,'payment_required',true),
        'schema',jsonb_build_object('type','duration_policy'),
        'disclosure','Short Let dates are held only while checkout is completed.',
        'reason','Locked Short Let reserve-date checkout policy'
      ),
      jsonb_build_object(
        'key','short_let_cancellation',
        'value',jsonb_build_object(
          'full_refund_hours_before_check_in',48,
          'late_cancel_max_nights',1,
          'no_show_max_nights',1,
          'death_or_hospitalisation_waives_fee',true,
          'rebooking_mitigation',true,
          'security_deposit_never_cancellation_charge',true
        ),
        'schema',jsonb_build_object('type','cancellation_policy'),
        'disclosure','Short Let cancellation and no-show charges are capped and disclosed before payment.',
        'reason','Locked launch cancellation and no-show policy'
      ),
      jsonb_build_object(
        'key','short_let_caution_cap',
        'value',jsonb_build_object(
          'enabled',true,'maximum_nights',1,
          'maximum_amount',null,'currency','NGN'
        ),
        'schema',jsonb_build_object('type','nightly_rate_cap'),
        'disclosure','A Short Let refundable security deposit is damage protection only.',
        'reason','Enable capped refundable Short Let damage deposit'
      ),
      jsonb_build_object(
        'key','long_let_reservation_fee',
        'value',jsonb_build_object(
          'amount',10000,'currency','NGN',
          'payment_hold_minutes',30,'customer_disclosure_required',true
        ),
        'schema',jsonb_build_object('type','fee_policy'),
        'disclosure','Long Let uses a disclosed reservation payment before the housing process begins.',
        'reason','Canonical Long Let reservation payment'
      ),
      jsonb_build_object(
        'key','future_long_let_installments',
        'value',jsonb_build_object(
          'enabled',false,'partner_opt_in',true,
          'payment_protection_hold',false,'grace_days',7,
          'automatic_late_fee',false,'automatic_eviction',false
        ),
        'schema',jsonb_build_object('type','feature_policy'),
        'disclosure','Long Let installments are unavailable at launch.',
        'reason','Disable Long Let installments for launch'
      )
    ))
  loop
    select * into v_current
    from public.creator_policy_versions
    where policy_key=v_item->>'key'
      and scope_type='global' and scope_key='*' and status='active'
    order by effective_from desc,version desc
    limit 1;

    if v_current.policy_version_id is null
       or v_current.value is distinct from v_item->'value' then
      if v_current.policy_version_id is not null then
        update public.creator_policy_versions
        set status='retired',effective_until=v_now,retired_at=v_now
        where policy_version_id=v_current.policy_version_id;
      end if;
      select coalesce(max(version),0)+1 into v_version
      from public.creator_policy_versions
      where policy_key=v_item->>'key'
        and scope_type='global' and scope_key='*';

      insert into public.creator_policy_versions(
        policy_key,scope_type,scope_key,version,value,value_schema,status,
        effective_from,public_disclosure,disclosure_text,legal_review_state,
        reason,created_by,approved_by,supersedes,checksum,published_at
      ) values(
        v_item->>'key','global','*',v_version,v_item->'value',
        v_item->'schema','active',v_now,true,v_item->>'disclosure','pending',
        v_item->>'reason',null,null,v_current.policy_version_id,
        md5((v_item->>'key')||':'||v_version::text||':'||(v_item->'value')::text),
        v_now
      );
    end if;
  end loop;
end
$$;

-- One-way compatibility mirrors for remaining legacy readers. Creator cannot
-- edit these directly; policy versions remain the only product authority.
insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
select
  'worker_commission_rate',policy.value->>'percent','payments',
  'Service Worker commission rate',
  'Compatibility mirror only. Creator policy registry is authoritative.',
  'number',false,true,now(),now()
from public.creator_policy_versions policy
where policy.policy_key='commission_worker'
  and policy.scope_type='global' and policy.scope_key='*' and policy.status='active'
order by policy.effective_from desc limit 1
on conflict(key) do update set
  value=excluded.value,description=excluded.description,
  editable=false,is_active=true,updated_at=now();

insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
select
  'commission_hotel',policy.value->>'percent','payments',
  'Hotel commission rate',
  'Compatibility mirror only. Creator policy registry is authoritative.',
  'number',false,true,now(),now()
from public.creator_policy_versions policy
where policy.policy_key='commission_hotel'
  and policy.scope_type='global' and policy.scope_key='*' and policy.status='active'
order by policy.effective_from desc limit 1
on conflict(key) do update set
  value=excluded.value,description=excluded.description,
  editable=false,is_active=true,updated_at=now();

insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
select
  'reservation_fee',policy.value->>'amount','payments',
  'Long Let reservation amount',
  'Compatibility mirror only. Creator policy registry is authoritative.',
  'number',false,true,now(),now()
from public.creator_policy_versions policy
where policy.policy_key='long_let_reservation_fee'
  and policy.scope_type='global' and policy.scope_key='*' and policy.status='active'
order by policy.effective_from desc limit 1
on conflict(key) do update set
  value=excluded.value,description=excluded.description,
  editable=false,is_active=true,updated_at=now();

insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
select
  'apartment_payment_hold_minutes',policy.value->>'minutes','payments',
  'Short Let checkout hold',
  'Compatibility mirror only. Creator policy registry is authoritative.',
  'number',false,true,now(),now()
from public.creator_policy_versions policy
where policy.policy_key='short_let_reservation_hold'
  and policy.scope_type='global' and policy.scope_key='*' and policy.status='active'
order by policy.effective_from desc limit 1
on conflict(key) do update set
  value=excluded.value,description=excluded.description,
  editable=false,is_active=true,updated_at=now();

update public.platform_settings
set editable=false,
    description=case
      when key in(
        'commission_apartment','commission_rate_listing','property_commission',
        'commission_rate_partner','partner_commission_rate'
      )
      then 'Legacy ambiguous apartment/partner commission alias. Do not edit; versioned product commission policies are authoritative.'
      when key in('commission_worker','commission_rate_worker')
      then 'Legacy Service Worker commission alias. Do not edit; commission_worker policy is authoritative.'
      when key in('hotel_commission','commission_rate_hotel')
      then 'Legacy Hotel commission alias. Do not edit; commission_hotel policy is authoritative.'
      when key in('apartment_reservation_fee','reservation_fee')
      then 'Compatibility mirror for Long Let reservation payment. Do not edit directly.'
      else description
    end,
    updated_at=now()
where key in(
  'commission_apartment','commission_rate_listing','property_commission',
  'commission_rate_partner','partner_commission_rate',
  'commission_worker','commission_rate_worker',
  'hotel_commission','commission_rate_hotel',
  'apartment_reservation_fee','reservation_fee',
  'apartment_payment_hold_minutes'
);
