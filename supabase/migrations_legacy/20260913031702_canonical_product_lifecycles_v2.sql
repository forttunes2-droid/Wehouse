-- Canonical product lifecycles. Product state and money state are deliberately
-- separate. Every transition has an idempotent event key and immutable history.

alter table public.listings
  add column if not exists max_occupants integer,
  add column if not exists future_installments_allowed boolean not null default false;
update public.listings
set max_occupants=greatest(coalesce(bedrooms,1)*2,1)
where sub_type='long_stay' and max_occupants is null;
alter table public.listings drop constraint if exists listings_max_occupants_check;
alter table public.listings add constraint listings_max_occupants_check
  check(max_occupants is null or max_occupants>=1);

alter table public.reservations
  add column if not exists canonical_state text,
  add column if not exists material_process_started_at timestamptz,
  add column if not exists verified_handover_at timestamptz,
  add column if not exists handover_confirmed_by_customer_at timestamptz,
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_out_at timestamptz,
  add column if not exists year_one_rent_protection_id uuid
    references public.payment_protection_transactions(id),
  add column if not exists stay_payment_protection_id uuid
    references public.payment_protection_transactions(id),
  add column if not exists caution_payment_protection_id uuid
    references public.payment_protection_transactions(id),
  add column if not exists reservation_policy_version_id uuid
    references public.creator_policy_versions(policy_version_id),
  add column if not exists commission_policy_version_id uuid
    references public.creator_policy_versions(policy_version_id),
  add column if not exists occupant_count integer not null default 1,
  add column if not exists cancellation_stage text,
  add column if not exists cancellation_calculation jsonb;
alter table public.reservations drop constraint if exists reservations_occupant_count_check;
alter table public.reservations add constraint reservations_occupant_count_check
  check(occupant_count>=1);

alter table public.hotel_bookings
  add column if not exists canonical_state text,
  add column if not exists payment_protection_id uuid
    references public.payment_protection_transactions(id),
  add column if not exists policy_version_id uuid
    references public.creator_policy_versions(policy_version_id),
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_out_at timestamptz;

alter table public.worker_bookings
  add column if not exists canonical_job_state text,
  add column if not exists payment_protection_id uuid
    references public.payment_protection_transactions(id),
  add column if not exists completion_reminder_sent_at timestamptz,
  add column if not exists release_eligible_at timestamptz,
  add column if not exists help_until timestamptz,
  add column if not exists risk_flag boolean not null default false,
  add column if not exists payment_conflict boolean not null default false,
  add column if not exists chargeback_open boolean not null default false,
  add column if not exists review_edit_until timestamptz,
  add column if not exists policy_version_id uuid
    references public.creator_policy_versions(policy_version_id);

create table if not exists public.long_let_reservation_transitions(
  transition_id uuid primary key default gen_random_uuid(),
  reservation_id text not null references public.reservations(id) on delete restrict,
  from_state text,
  to_state text not null,
  event_type text not null,
  event_key text not null unique,
  actor_user_id text,
  actor_type text not null,
  material_process boolean not null default false,
  policy_version_id uuid references public.creator_policy_versions(policy_version_id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.short_let_booking_transitions(
  transition_id uuid primary key default gen_random_uuid(),
  reservation_id text not null references public.reservations(id) on delete restrict,
  from_state text,
  to_state text not null,
  event_type text not null,
  event_key text not null unique,
  actor_user_id text,
  actor_type text not null,
  policy_version_id uuid references public.creator_policy_versions(policy_version_id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.hotel_stay_transitions(
  transition_id uuid primary key default gen_random_uuid(),
  hotel_booking_id integer not null references public.hotel_bookings(booking_id)
    on delete restrict,
  from_state text,
  to_state text not null,
  event_type text not null,
  event_key text not null unique,
  actor_user_id text,
  actor_type text not null,
  policy_version_id uuid references public.creator_policy_versions(policy_version_id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.worker_job_transitions(
  transition_id uuid primary key default gen_random_uuid(),
  worker_booking_id uuid not null references public.worker_bookings(id)
    on delete restrict,
  from_state text,
  to_state text not null,
  event_type text not null,
  event_key text not null unique,
  actor_user_id text,
  actor_type text not null,
  policy_version_id uuid references public.creator_policy_versions(policy_version_id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.long_let_reservation_transitions enable row level security;
alter table public.short_let_booking_transitions enable row level security;
alter table public.hotel_stay_transitions enable row level security;
alter table public.worker_job_transitions enable row level security;
revoke all on table public.long_let_reservation_transitions from public,anon,authenticated;
revoke all on table public.short_let_booking_transitions from public,anon,authenticated;
revoke all on table public.hotel_stay_transitions from public,anon,authenticated;
revoke all on table public.worker_job_transitions from public,anon,authenticated;
grant all on table public.long_let_reservation_transitions to service_role;
grant all on table public.short_let_booking_transitions to service_role;
grant all on table public.hotel_stay_transitions to service_role;
grant all on table public.worker_job_transitions to service_role;

create or replace function public.canonical_product_transition_allowed(
  p_product text,p_from text,p_to text
)
returns boolean
language sql
immutable
as $$
  select case p_product
    when 'long_let' then (p_from,p_to) in (
      ('reservation_fee_pending','hold_active'),
      ('hold_active','inspection_requested'),
      ('hold_active','rent_pending'),
      ('hold_active','cancelled'),
      ('hold_active','expired'),
      ('inspection_requested','inspection_completed'),
      ('inspection_requested','cancelled'),
      ('inspection_completed','rent_pending'),
      ('rent_pending','rent_protected'),
      ('rent_pending','cancelled'),
      ('rent_protected','handover_pending'),
      ('rent_protected','disputed'),
      ('handover_pending','handover_verified'),
      ('handover_pending','disputed'),
      ('handover_verified','active'),
      ('handover_verified','disputed'),
      ('active','renewal_offered'),
      ('active','ended'),
      ('renewal_offered','renewing'),
      ('renewal_offered','ended'),
      ('renewing','active'),
      ('disputed','rent_protected'),
      ('disputed','cancelled'),
      ('disputed','refunded')
    )
    when 'short_let' then (p_from,p_to) in (
      ('checkout_pending','confirmed'),
      ('checkout_pending','expired'),
      ('confirmed','check_in_ready'),
      ('confirmed','cancelled'),
      ('confirmed','disputed'),
      ('check_in_ready','checked_in'),
      ('checked_in','checked_out'),
      ('checked_in','disputed'),
      ('checked_out','completed'),
      ('checked_out','disputed'),
      ('disputed','confirmed'),
      ('disputed','completed'),
      ('disputed','refunded')
    )
    when 'hotel' then (p_from,p_to) in (
      ('checkout_pending','confirmed'),
      ('checkout_pending','expired'),
      ('confirmed','check_in_ready'),
      ('confirmed','cancelled'),
      ('confirmed','disputed'),
      ('check_in_ready','checked_in'),
      ('checked_in','checked_out'),
      ('checked_in','disputed'),
      ('checked_out','completed'),
      ('disputed','confirmed'),
      ('disputed','completed'),
      ('disputed','refunded')
    )
    when 'worker' then (p_from,p_to) in (
      ('requested','negotiating'),
      ('requested','cancelled'),
      ('negotiating','awaiting_payment'),
      ('negotiating','cancelled'),
      ('awaiting_payment','confirmed'),
      ('awaiting_payment','cancelled'),
      ('confirmed','in_progress'),
      ('confirmed','cancelled'),
      ('in_progress','completion_marked'),
      ('in_progress','disputed'),
      ('completion_marked','completed'),
      ('completion_marked','disputed'),
      ('disputed','in_progress'),
      ('disputed','completed'),
      ('disputed','refunded')
    )
    else false
  end
$$;

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
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and coalesce(stay_type,'long_stay')='long_stay'
  for update;
  if v_res.id is null then raise exception 'Long Let reservation not found'; end if;
  if not exists(
    select 1 from public.verified_provider_events
    where provider_event_id=p_provider_event_id and processed_at is not null
  ) then raise exception 'Verified provider event required'; end if;
  select * into v_listing from public.listings
  where listing_id=v_res.listing_id or id::text=v_res.listing_id for update;
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
      and coalesce(r.canonical_state,r.status) in (
        'hold_active','inspection_requested','inspection_completed',
        'rent_pending','rent_protected','handover_pending',
        'handover_verified','active'
      )
      and coalesce(r.hold_expires_at,'infinity')>now()
  ) then raise exception 'Property already has an active Long Let obligation'; end if;
  select * into v_policy from public.creator_policy_versions
  where policy_key='long_let_reservation_hold' and scope_type='global'
    and scope_key='*' and status='active'
  order by effective_from desc limit 1;
  if v_policy.policy_version_id is null then raise exception 'Long Let hold policy missing'; end if;

  update public.reservations
  set canonical_state='hold_active',status='reserved',
      hold_expires_at=now()+interval '3 days',
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
      'full_refund_until',v_res.paid_at+interval '24 hours'
    )
  ) on conflict(event_key) do nothing;
  return v_res;
end
$$;

create or replace function public.transition_long_let_reservation(
  p_reservation_id text,p_to_state text,p_event_type text,p_event_key text,
  p_actor_user_id text,p_actor_type text,p_metadata jsonb default '{}'::jsonb
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_from text; v_material boolean;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  v_from:=coalesce(v_res.canonical_state,'reservation_fee_pending');
  if exists(select 1 from public.long_let_reservation_transitions where event_key=p_event_key)
    then return v_res; end if;
  if not public.canonical_product_transition_allowed('long_let',v_from,p_to_state)
    then raise exception 'Illegal Long Let transition: % -> %',v_from,p_to_state; end if;
  v_material:=p_to_state in (
    'inspection_requested','inspection_completed','rent_pending','rent_protected',
    'handover_pending','handover_verified','active'
  );
  if p_to_state not in ('cancelled','expired') and v_res.hold_expires_at<=now()
    and v_from in ('hold_active','inspection_requested','inspection_completed') then
    raise exception 'Long Let hold expired'; end if;
  update public.reservations set
    canonical_state=p_to_state,
    material_process_started_at=case when v_material then
      coalesce(material_process_started_at,now()) else material_process_started_at end,
    verified_handover_at=case when p_to_state='handover_verified' then now()
      else verified_handover_at end,
    updated_at=now()
  where id=p_reservation_id returning * into v_res;
  insert into public.long_let_reservation_transitions(
    reservation_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,material_process,policy_version_id,metadata
  ) values(
    p_reservation_id,v_from,p_to_state,p_event_type,p_event_key,p_actor_user_id,
    p_actor_type,v_material,v_res.reservation_policy_version_id,
    coalesce(p_metadata,'{}'::jsonb)
  );
  return v_res;
end
$$;

create or replace function public.transition_short_let_booking(
  p_reservation_id text,p_to_state text,p_event_type text,p_event_key text,
  p_actor_user_id text,p_actor_type text,p_metadata jsonb default '{}'::jsonb
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_from text; v_listing public.listings;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let' for update;
  if v_res.id is null then raise exception 'Short Let booking not found'; end if;
  v_from:=coalesce(v_res.canonical_state,'checkout_pending');
  if exists(select 1 from public.short_let_booking_transitions where event_key=p_event_key)
    then return v_res; end if;
  if not public.canonical_product_transition_allowed('short_let',v_from,p_to_state)
    then raise exception 'Illegal Short Let transition: % -> %',v_from,p_to_state; end if;
  select * into v_listing from public.listings
  where listing_id=v_res.listing_id or id::text=v_res.listing_id for update;
  if v_res.guest_count>coalesce(v_listing.max_guests,1) then
    raise exception 'Guest capacity exceeded';
  end if;
  if p_to_state='confirmed' and v_res.rent_payment_status<>'paid' then
    raise exception 'Verified full checkout required';
  end if;
  update public.reservations set
    canonical_state=p_to_state,
    occupancy_started_at=case when p_to_state='checked_in' then now()
      else occupancy_started_at end,
    checked_in_at=case when p_to_state='checked_in' then now()
      else checked_in_at end,
    checked_out_at=case when p_to_state='checked_out' then now()
      else checked_out_at end,
    completed_at=case when p_to_state in ('checked_out','completed') then now()
      else completed_at end,
    updated_at=now()
  where id=p_reservation_id returning * into v_res;
  insert into public.short_let_booking_transitions(
    reservation_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(
    p_reservation_id,v_from,p_to_state,p_event_type,p_event_key,p_actor_user_id,
    p_actor_type,v_res.reservation_policy_version_id,coalesce(p_metadata,'{}'::jsonb)
  );
  return v_res;
end
$$;

create or replace function public.transition_hotel_stay(
  p_hotel_booking_id integer,p_to_state text,p_event_type text,p_event_key text,
  p_actor_user_id text,p_actor_type text,p_metadata jsonb default '{}'::jsonb
)
returns public.hotel_bookings
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_booking public.hotel_bookings; v_from text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_hotel_booking_id for update;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  v_from:=coalesce(v_booking.canonical_state,'checkout_pending');
  if exists(select 1 from public.hotel_stay_transitions where event_key=p_event_key)
    then return v_booking; end if;
  if not public.canonical_product_transition_allowed('hotel',v_from,p_to_state)
    then raise exception 'Illegal Hotel transition: % -> %',v_from,p_to_state; end if;
  if p_to_state='confirmed' and v_booking.payment_status<>'paid' then
    raise exception 'Verified Hotel payment required'; end if;
  update public.hotel_bookings set
    canonical_state=p_to_state,
    checked_in_at=case when p_to_state='checked_in' then now() else checked_in_at end,
    checked_out_at=case when p_to_state='checked_out' then now() else checked_out_at end,
    updated_at=now()
  where booking_id=p_hotel_booking_id returning * into v_booking;
  insert into public.hotel_stay_transitions(
    hotel_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(
    p_hotel_booking_id,v_from,p_to_state,p_event_type,p_event_key,p_actor_user_id,
    p_actor_type,v_booking.policy_version_id,coalesce(p_metadata,'{}'::jsonb)
  );
  return v_booking;
end
$$;

create or replace function public.transition_worker_job(
  p_worker_booking_id uuid,p_to_state text,p_event_type text,p_event_key text,
  p_actor_user_id text,p_actor_type text,p_metadata jsonb default '{}'::jsonb
)
returns public.worker_bookings
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_booking public.worker_bookings; v_from text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_booking from public.worker_bookings
  where id=p_worker_booking_id for update;
  if v_booking.id is null then raise exception 'Worker job not found'; end if;
  v_from:=coalesce(v_booking.canonical_job_state,'requested');
  if exists(select 1 from public.worker_job_transitions where event_key=p_event_key)
    then return v_booking; end if;
  if not public.canonical_product_transition_allowed('worker',v_from,p_to_state)
    then raise exception 'Illegal Worker transition: % -> %',v_from,p_to_state; end if;
  if p_to_state='confirmed' and not exists(
    select 1 from public.payment_protection_transactions pt
    where pt.id=v_booking.payment_protection_id
      and pt.protection_state in ('protected','release_eligible')
  ) then raise exception 'Payment Protection required before confirming job'; end if;
  if p_to_state='completed' and (
    v_booking.risk_flag or v_booking.payment_conflict
    or v_booking.chargeback_open
    or exists(select 1 from public.worker_user_blocks b
      where (b.blocker_user_id=v_booking.user_id and b.blocked_user_id=v_booking.worker_id)
         or (b.blocker_user_id=v_booking.worker_id and b.blocked_user_id=v_booking.user_id))
  ) then raise exception 'Worker release requires operations review'; end if;
  update public.worker_bookings set
    canonical_job_state=p_to_state,
    marked_complete_at=case when p_to_state='completion_marked' then now()
      else marked_complete_at end,
    release_eligible_at=case when p_to_state='completion_marked'
      then now()+interval '24 hours' else release_eligible_at end,
    help_until=case when p_to_state in ('completion_marked','completed')
      then coalesce(help_until,now()+interval '3 days') else help_until end,
    review_edit_until=case when p_to_state='completed'
      then now()+interval '48 hours' else review_edit_until end,
    completed_at=case when p_to_state='completed' then now() else completed_at end,
    updated_at=now()
  where id=p_worker_booking_id returning * into v_booking;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(
    p_worker_booking_id,v_from,p_to_state,p_event_type,p_event_key,p_actor_user_id,
    p_actor_type,v_booking.policy_version_id,coalesce(p_metadata,'{}'::jsonb)
  );
  return v_booking;
end
$$;

revoke all on function public.begin_long_let_hold(text,uuid,text) from public,anon,authenticated;
revoke all on function public.transition_long_let_reservation(
  text,text,text,text,text,text,jsonb
) from public,anon,authenticated;
revoke all on function public.transition_short_let_booking(
  text,text,text,text,text,text,jsonb
) from public,anon,authenticated;
revoke all on function public.transition_hotel_stay(
  integer,text,text,text,text,text,jsonb
) from public,anon,authenticated;
revoke all on function public.transition_worker_job(
  uuid,text,text,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.begin_long_let_hold(text,uuid,text) to service_role;
grant execute on function public.transition_long_let_reservation(
  text,text,text,text,text,text,jsonb
) to service_role;
grant execute on function public.transition_short_let_booking(
  text,text,text,text,text,text,jsonb
) to service_role;
grant execute on function public.transition_hotel_stay(
  integer,text,text,text,text,text,jsonb
) to service_role;
grant execute on function public.transition_worker_job(
  uuid,text,text,text,text,text,jsonb
) to service_role;

-- Short Let Caution fee: only the disputed amount stays held.
create table if not exists public.caution_claims(
  caution_claim_id uuid primary key default gen_random_uuid(),
  reservation_id text not null references public.reservations(id) on delete restrict,
  payment_protection_id uuid not null
    references public.payment_protection_transactions(id) on delete restrict,
  deposit_amount numeric(12,2) not null check(deposit_amount>=0),
  claimed_amount numeric(12,2) not null check(claimed_amount>0),
  disputed_amount numeric(12,2) not null check(disputed_amount>=0),
  undisputed_refund_amount numeric(12,2) not null check(undisputed_refund_amount>=0),
  reason text not null,
  status text not null default 'awaiting_guest_response' check(status in (
    'awaiting_guest_response','facts_review','finance_review','resolved','appealed','closed'
  )),
  partner_submitted_at timestamptz not null default now(),
  guest_response_due_at timestamptz not null,
  guest_response text,
  guest_responded_at timestamptz,
  property_facts_reviewed_by text,
  property_facts_reviewed_at timestamptz,
  finance_resolved_by text,
  finance_resolved_at timestamptz,
  partner_award numeric(12,2),
  customer_refund numeric(12,2),
  refund_destination text not null default 'original_payment',
  appeal_due_at timestamptz,
  appeal_reviewer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(claimed_amount<=deposit_amount),
  check(disputed_amount+undisputed_refund_amount=deposit_amount),
  check(refund_destination='original_payment')
);

create unique index if not exists one_open_caution_claim_per_reservation
  on public.caution_claims(reservation_id)
  where status not in ('resolved','closed');

create table if not exists public.caution_evidence(
  evidence_id uuid primary key default gen_random_uuid(),
  reservation_id text not null references public.reservations(id) on delete restrict,
  caution_claim_id uuid references public.caution_claims(caution_claim_id)
    on delete restrict,
  submitted_by text not null references public.profiles(user_id),
  evidence_type text not null check(evidence_type in (
    'check_in_condition','guest_preexisting_damage','partner_damage_claim',
    'guest_response','operations_finding','appeal'
  )),
  object_path text not null,
  description text,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.caution_claims enable row level security;
alter table public.caution_evidence enable row level security;
revoke all on table public.caution_claims from public,anon,authenticated;
revoke all on table public.caution_evidence from public,anon,authenticated;
grant all on table public.caution_claims to service_role;
grant all on table public.caution_evidence to service_role;

create table if not exists public.financial_action_outbox(
  financial_action_id uuid primary key default gen_random_uuid(),
  action_type text not null check(action_type in (
    'refund_caution_undisputed','refund_caution_balance','release_caution_award',
    'refund_unclaimed_caution','release_worker_payment'
  )),
  subject_type text not null,
  subject_id text not null,
  payment_protection_id uuid not null
    references public.payment_protection_transactions(id) on delete restrict,
  amount numeric(12,2) not null check(amount>=0),
  idempotency_key text not null unique,
  status text not null default 'pending' check(status in (
    'pending','processing','completed','failed','manual_review'
  )),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.financial_action_outbox enable row level security;
revoke all on table public.financial_action_outbox from public,anon,authenticated;
grant all on table public.financial_action_outbox to service_role;

create or replace function public.guest_submit_short_let_check_in_evidence(
  p_reservation_id text,p_evidence_paths text[],p_description text default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_res public.reservations;
  v_path text;
  v_count integer:=0;
begin
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let'
    and user_id=v_actor and canonical_state='checked_in' for update;
  if v_res.id is null then raise exception 'Checked-in Short Let guest required'; end if;
  if v_res.checked_in_at is null or now()>v_res.checked_in_at+interval '4 hours' then
    raise exception 'The four-hour check-in evidence window is closed';
  end if;
  if coalesce(cardinality(p_evidence_paths),0)=0 then
    raise exception 'At least one evidence file is required'; end if;
  foreach v_path in array p_evidence_paths loop
    insert into public.caution_evidence(
      reservation_id,submitted_by,evidence_type,object_path,description,captured_at
    ) values(
      v_res.id,v_actor,'check_in_condition',v_path,nullif(btrim(p_description),''),now()
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$$;

create or replace function public.partner_raise_caution_claim(
  p_reservation_id text,p_claimed_amount numeric,p_reason text,p_evidence_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_res public.reservations;
  v_listing public.listings;
  v_id uuid;
  v_path text;
begin
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let'
    and canonical_state in ('checked_out','completed') for update;
  if v_res.id is null then raise exception 'Completed Short Let required'; end if;
  select * into v_listing from public.listings
  where listing_id=v_res.listing_id or id::text=v_res.listing_id;
  if v_actor is null or v_actor not in (v_listing.owner_id,v_listing.partner_id) then
    raise exception 'Property Partner access required'; end if;
  if v_res.completed_at is null or now()>v_res.completed_at+interval '24 hours' then
    raise exception 'Caution claim window closed'; end if;
  if coalesce(p_claimed_amount,0)<=0
    or p_claimed_amount>coalesce(v_res.security_deposit_snapshot,0) then
    raise exception 'Claim must be within the Caution fee';
  end if;
  if coalesce(cardinality(p_evidence_paths),0)=0 then
    raise exception 'Damage evidence is required'; end if;
  insert into public.caution_claims(
    reservation_id,payment_protection_id,deposit_amount,claimed_amount,
    disputed_amount,undisputed_refund_amount,reason,guest_response_due_at
  ) values(
    v_res.id,v_res.caution_payment_protection_id,v_res.security_deposit_snapshot,
    p_claimed_amount,p_claimed_amount,
    v_res.security_deposit_snapshot-p_claimed_amount,btrim(p_reason),
    now()+interval '48 hours'
  ) returning caution_claim_id into v_id;
  foreach v_path in array p_evidence_paths loop
    insert into public.caution_evidence(
      reservation_id,caution_claim_id,submitted_by,evidence_type,object_path
    ) values(v_res.id,v_id,v_actor,'partner_damage_claim',v_path);
  end loop;
  if v_res.security_deposit_snapshot-p_claimed_amount>0 then
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,
      idempotency_key,metadata
    ) values(
      'refund_caution_undisputed','caution_claim',v_id::text,
      v_res.caution_payment_protection_id,
      v_res.security_deposit_snapshot-p_claimed_amount,
      'caution-undisputed-refund:'||v_id,
      jsonb_build_object('refund_destination','original_payment')
    );
  end if;
  return v_id;
end
$$;

create or replace function public.guest_respond_to_caution_claim(
  p_caution_claim_id uuid,p_response text,p_evidence_paths text[] default '{}'
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_claim public.caution_claims;
  v_path text;
begin
  select c.* into v_claim
  from public.caution_claims c
  join public.reservations r on r.id=c.reservation_id
  where c.caution_claim_id=p_caution_claim_id and r.user_id=v_actor
  for update of c;
  if v_claim.caution_claim_id is null then raise exception 'Caution claim not found'; end if;
  if v_claim.status<>'awaiting_guest_response' or now()>v_claim.guest_response_due_at then
    raise exception 'The 48-hour response window is closed'; end if;
  if nullif(btrim(p_response),'') is null then raise exception 'A response is required'; end if;
  foreach v_path in array coalesce(p_evidence_paths,'{}'::text[]) loop
    insert into public.caution_evidence(
      reservation_id,caution_claim_id,submitted_by,evidence_type,object_path
    ) values(v_claim.reservation_id,v_claim.caution_claim_id,v_actor,'guest_response',v_path);
  end loop;
  update public.caution_claims set
    guest_response=btrim(p_response),guest_responded_at=now(),
    status='facts_review',updated_at=now()
  where caution_claim_id=p_caution_claim_id returning * into v_claim;
  return v_claim;
end
$$;

create or replace function public.advance_silent_caution_claim_from_service(
  p_caution_claim_id uuid
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_claim public.caution_claims;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  update public.caution_claims set
    guest_response='No response received; silence is not admission of liability.',
    status='facts_review',updated_at=now()
  where caution_claim_id=p_caution_claim_id
    and status='awaiting_guest_response' and guest_response_due_at<=now()
  returning * into v_claim;
  if v_claim.caution_claim_id is null then raise exception 'Claim is not due'; end if;
  return v_claim;
end
$$;

create or replace function public.record_caution_property_finding(
  p_caution_claim_id uuid,p_supported_amount numeric,p_finding text,
  p_evidence_paths text[] default '{}'
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_claim public.caution_claims;
  v_state text;
  v_path text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select c.* into v_claim
  from public.caution_claims c
  join public.reservations r on r.id=c.reservation_id
  join public.listings l on l.listing_id=r.listing_id or l.id::text=r.listing_id
  where c.caution_claim_id=p_caution_claim_id for update of c;
  if v_claim.caution_claim_id is null then raise exception 'Caution claim not found'; end if;
  select listing.state into v_state
  from public.reservations reservation
  join public.listings listing
    on listing.listing_id=reservation.listing_id
    or listing.id::text=reservation.listing_id
  where reservation.id=v_claim.reservation_id
  limit 1;
  if not (
    v_actor.role='creator'
    or (v_actor.role='admin' and lower(btrim(v_actor.assigned_state))=lower(btrim(v_state)))
    or public.current_actor_has_workspace('property_operations',v_state)
  ) then raise exception 'Property Operations access required'; end if;
  if v_claim.status<>'facts_review' then raise exception 'Claim is not in facts review'; end if;
  if p_supported_amount<0 or p_supported_amount>v_claim.claimed_amount then
    raise exception 'Supported amount must remain within the Partner claim'; end if;
  foreach v_path in array coalesce(p_evidence_paths,'{}'::text[]) loop
    insert into public.caution_evidence(
      reservation_id,caution_claim_id,submitted_by,evidence_type,object_path,description
    ) values(v_claim.reservation_id,v_claim.caution_claim_id,v_actor.user_id,
      'operations_finding',v_path,btrim(p_finding));
  end loop;
  update public.caution_claims set
    disputed_amount=p_supported_amount,
    property_facts_reviewed_by=v_actor.user_id,property_facts_reviewed_at=now(),
    status='finance_review',updated_at=now()
  where caution_claim_id=p_caution_claim_id returning * into v_claim;
  return v_claim;
end
$$;

create or replace function public.resolve_caution_finance(
  p_caution_claim_id uuid,p_partner_award numeric,p_resolution text
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_claim public.caution_claims; v_refund numeric;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if not (v_actor.role='creator' or public.current_actor_has_workspace('finance_operations',null)) then
    raise exception 'Finance Operations access required'; end if;
  select * into v_claim from public.caution_claims
  where caution_claim_id=p_caution_claim_id for update;
  if v_claim.caution_claim_id is null or v_claim.status<>'finance_review' then
    raise exception 'Claim is not ready for Finance Operations'; end if;
  if p_partner_award<0 or p_partner_award>v_claim.disputed_amount then
    raise exception 'Award cannot exceed the Property Operations supported amount'; end if;
  v_refund:=v_claim.deposit_amount-p_partner_award;
  update public.caution_claims set
    partner_award=p_partner_award,customer_refund=v_refund,
    finance_resolved_by=v_actor.user_id,finance_resolved_at=now(),
    guest_response=concat_ws(E'\n',guest_response,'Finance resolution: '||btrim(p_resolution)),
    appeal_due_at=now()+interval '48 hours',status='resolved',updated_at=now()
  where caution_claim_id=p_caution_claim_id returning * into v_claim;
  if p_partner_award>0 then
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key
    ) values('release_caution_award','caution_claim',p_caution_claim_id::text,
      v_claim.payment_protection_id,p_partner_award,'caution-award:'||p_caution_claim_id);
  end if;
  if v_refund>v_claim.undisputed_refund_amount then
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,
      metadata
    ) values('refund_caution_balance','caution_claim',p_caution_claim_id::text,
      v_claim.payment_protection_id,v_refund-v_claim.undisputed_refund_amount,
      'caution-balance-refund:'||p_caution_claim_id,
      jsonb_build_object('refund_destination','original_payment'));
  end if;
  return v_claim;
end
$$;

create or replace function public.appeal_caution_resolution(
  p_caution_claim_id uuid,p_reason text,p_evidence_paths text[] default '{}'
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_claim public.caution_claims; v_path text;
begin
  select c.* into v_claim
  from public.caution_claims c
  join public.reservations r on r.id=c.reservation_id
  join public.listings l on l.listing_id=r.listing_id or l.id::text=r.listing_id
  where c.caution_claim_id=p_caution_claim_id
    and v_actor in (r.user_id,l.owner_id,l.partner_id) for update of c;
  if v_claim.caution_claim_id is null then raise exception 'Caution claim not found'; end if;
  if v_claim.status<>'resolved' or v_claim.appeal_due_at<now() then
    raise exception 'The 48-hour appeal window is closed'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Appeal reason required'; end if;
  foreach v_path in array coalesce(p_evidence_paths,'{}'::text[]) loop
    insert into public.caution_evidence(
      reservation_id,caution_claim_id,submitted_by,evidence_type,object_path,description
    ) values(v_claim.reservation_id,v_claim.caution_claim_id,v_actor,'appeal',v_path,btrim(p_reason));
  end loop;
  update public.caution_claims set status='appealed',updated_at=now()
  where caution_claim_id=p_caution_claim_id returning * into v_claim;
  return v_claim;
end
$$;

create or replace function public.release_unclaimed_caution_from_service(
  p_reservation_id text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_action uuid;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let' for update;
  if v_res.completed_at is null or v_res.completed_at+interval '24 hours'>now() then
    raise exception 'Partner claim window is still open'; end if;
  if exists(select 1 from public.caution_claims where reservation_id=v_res.id) then
    raise exception 'Caution claim exists'; end if;
  insert into public.financial_action_outbox(
    action_type,subject_type,subject_id,payment_protection_id,amount,
    idempotency_key,metadata
  ) values('refund_unclaimed_caution','short_let',v_res.id,
    v_res.caution_payment_protection_id,v_res.security_deposit_snapshot,
    'caution-unclaimed-refund:'||v_res.id,
    jsonb_build_object('refund_destination','original_payment'))
  on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning financial_action_id into v_action;
  return v_action;
end
$$;

create table if not exists public.worker_completion_reminder_requests(
  reminder_request_id uuid primary key default gen_random_uuid(),
  worker_booking_id uuid not null references public.worker_bookings(id) on delete restrict,
  requested_by text not null references public.profiles(user_id),
  requested_at timestamptz not null default now(),
  delivery_status text not null default 'pending' check(delivery_status in (
    'pending','sent','failed'
  )),
  delivered_at timestamptz,
  unique(worker_booking_id)
);
alter table public.worker_completion_reminder_requests enable row level security;
revoke all on table public.worker_completion_reminder_requests from public,anon,authenticated;
grant all on table public.worker_completion_reminder_requests to service_role;

create or replace function public.worker_request_completion_reminder(
  p_worker_booking_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_booking public.worker_bookings; v_id uuid;
begin
  select * into v_booking from public.worker_bookings
  where id=p_worker_booking_id and worker_id=v_actor for update;
  if v_booking.id is null then raise exception 'Worker job not found'; end if;
  if coalesce(v_booking.canonical_job_state,'')<>'completion_marked'
    or v_booking.marked_complete_at+interval '12 hours'>now() then
    raise exception 'The completion reminder becomes available after 12 hours'; end if;
  if v_booking.risk_flag or v_booking.payment_conflict or v_booking.chargeback_open then
    raise exception 'This job is already in controlled review'; end if;
  insert into public.worker_completion_reminder_requests(worker_booking_id,requested_by)
  values(v_booking.id,v_actor)
  on conflict(worker_booking_id) do update set requested_by=excluded.requested_by
  returning reminder_request_id into v_id;
  update public.worker_bookings set completion_reminder_sent_at=coalesce(
    completion_reminder_sent_at,now()
  ),updated_at=now() where id=v_booking.id;
  return v_id;
end
$$;

-- Shared checkout is distinct from sharing a rich property object in chat.
create table if not exists public.shared_payment_groups(
  shared_payment_group_id uuid primary key default gen_random_uuid(),
  product_type text not null check(product_type in ('long_let','short_let')),
  listing_id text not null,
  reservation_id text references public.reservations(id) on delete restrict,
  created_by text not null references public.profiles(user_id),
  total_amount numeric(12,2) not null check(total_amount>0),
  capacity integer not null check(capacity>=2),
  status text not null default 'inviting' check(status in (
    'inviting','ready','checkout_open','fully_paid','expired','cancelled','refunding','refunded'
  )),
  checkout_expires_at timestamptz,
  policy_version_id uuid references public.creator_policy_versions(policy_version_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(product_type<>'hotel')
);

create table if not exists public.shared_payment_members(
  shared_payment_member_id uuid primary key default gen_random_uuid(),
  shared_payment_group_id uuid not null
    references public.shared_payment_groups(shared_payment_group_id) on delete restrict,
  user_id text not null references public.profiles(user_id),
  share_amount numeric(12,2) not null check(share_amount>0),
  invitation_state text not null default 'invited'
    check(invitation_state in ('invited','accepted','declined','removed')),
  payment_state text not null default 'not_started'
    check(payment_state in ('not_started','provider_pending','paid','failed','refunded')),
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shared_payment_group_id,user_id)
);

alter table public.shared_payment_groups enable row level security;
alter table public.shared_payment_members enable row level security;
revoke all on table public.shared_payment_groups from public,anon,authenticated;
revoke all on table public.shared_payment_members from public,anon,authenticated;
grant all on table public.shared_payment_groups to service_role;
grant all on table public.shared_payment_members to service_role;

create or replace function public.open_shared_payment_checkout(
  p_group_id uuid,p_event_key text
)
returns public.shared_payment_groups
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_group public.shared_payment_groups;
  v_member_count integer;
  v_accepted_count integer;
  v_share_total numeric;
  v_window interval;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  perform p_event_key;
  select * into v_group from public.shared_payment_groups
  where shared_payment_group_id=p_group_id for update;
  if v_group.shared_payment_group_id is null then raise exception 'Shared payment not found'; end if;
  if v_group.product_type not in ('long_let','short_let') then
    raise exception 'Hotel shared payment is not allowed'; end if;
  select count(*),count(*) filter(where invitation_state='accepted'),
    coalesce(sum(share_amount) filter(where invitation_state='accepted'),0)
  into v_member_count,v_accepted_count,v_share_total
  from public.shared_payment_members where shared_payment_group_id=p_group_id;
  if v_member_count>v_group.capacity or v_accepted_count>v_group.capacity then
    raise exception 'Property capacity exceeded'; end if;
  if v_accepted_count<2 or v_share_total<>v_group.total_amount then
    raise exception 'Accepted share amounts must equal the checkout total'; end if;
  v_window:=case when v_group.product_type='short_let' then interval '30 minutes'
    else interval '3 days' end;
  update public.shared_payment_groups set
    status='checkout_open',checkout_expires_at=now()+v_window,updated_at=now()
  where shared_payment_group_id=p_group_id returning * into v_group;
  return v_group;
end
$$;

revoke all on function public.partner_raise_caution_claim(
  text,numeric,text,text[]
) from public,anon;
grant execute on function public.partner_raise_caution_claim(
  text,numeric,text,text[]
) to authenticated,service_role;
revoke all on function public.guest_submit_short_let_check_in_evidence(
  text,text[],text
) from public,anon;
revoke all on function public.guest_respond_to_caution_claim(
  uuid,text,text[]
) from public,anon;
revoke all on function public.record_caution_property_finding(
  uuid,numeric,text,text[]
) from public,anon;
revoke all on function public.resolve_caution_finance(uuid,numeric,text)
from public,anon;
revoke all on function public.appeal_caution_resolution(uuid,text,text[])
from public,anon;
revoke all on function public.worker_request_completion_reminder(uuid)
from public,anon;
grant execute on function public.guest_submit_short_let_check_in_evidence(
  text,text[],text
) to authenticated,service_role;
grant execute on function public.guest_respond_to_caution_claim(
  uuid,text,text[]
) to authenticated,service_role;
grant execute on function public.record_caution_property_finding(
  uuid,numeric,text,text[]
) to authenticated,service_role;
grant execute on function public.resolve_caution_finance(uuid,numeric,text)
to authenticated,service_role;
grant execute on function public.appeal_caution_resolution(uuid,text,text[])
to authenticated,service_role;
grant execute on function public.worker_request_completion_reminder(uuid)
to authenticated,service_role;
revoke all on function public.advance_silent_caution_claim_from_service(uuid)
from public,anon,authenticated;
revoke all on function public.release_unclaimed_caution_from_service(text)
from public,anon,authenticated;
grant execute on function public.advance_silent_caution_claim_from_service(uuid)
to service_role;
grant execute on function public.release_unclaimed_caution_from_service(text)
to service_role;
revoke all on function public.open_shared_payment_checkout(uuid,text)
from public,anon,authenticated;
grant execute on function public.open_shared_payment_checkout(uuid,text)
to service_role;

comment on table public.shared_payment_groups
is 'Atomic Long Let or Short Let cost sharing. It is never a Hotel booking and never a chat share.';
comment on table public.caution_claims
is 'Short Let Caution evidence flow. The undisputed amount returns to original_payment.';
