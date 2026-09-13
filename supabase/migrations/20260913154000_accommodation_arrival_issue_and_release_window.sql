-- L-27/L-30: paid Hotel and Short Let accommodation remains protected until
-- authorized check-in plus the snapshotted arrival-issue window. The platform
-- default and minimum are two hours; a property/package may extend to four.
-- A timely formal issue freezes release. Checkout is not the accommodation
-- earning release event.

alter table public.reservations
  add column if not exists arrival_issue_policy_version_id uuid,
  add column if not exists arrival_issue_window_hours integer,
  add column if not exists arrival_issue_deadline_at timestamptz;

alter table public.hotel_bookings
  add column if not exists arrival_issue_policy_version_id uuid,
  add column if not exists arrival_issue_window_hours integer,
  add column if not exists arrival_issue_deadline_at timestamptz;

alter table public.listings
  add column if not exists arrival_issue_window_hours integer not null default 2;

alter table public.hotels
  add column if not exists arrival_issue_window_hours integer not null default 2;

alter table public.hotel_rate_plans
  add column if not exists arrival_issue_window_hours integer;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.listings'::regclass
      and conname='listings_arrival_issue_window_hours_check'
  ) then
    alter table public.listings add constraint listings_arrival_issue_window_hours_check
      check(arrival_issue_window_hours between 2 and 4);
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.hotels'::regclass
      and conname='hotels_arrival_issue_window_hours_check'
  ) then
    alter table public.hotels add constraint hotels_arrival_issue_window_hours_check
      check(arrival_issue_window_hours between 2 and 4);
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.hotel_rate_plans'::regclass
      and conname='hotel_rate_plans_arrival_issue_window_hours_check'
  ) then
    alter table public.hotel_rate_plans add constraint hotel_rate_plans_arrival_issue_window_hours_check
      check(arrival_issue_window_hours is null or arrival_issue_window_hours between 2 and 4);
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.reservations'::regclass
      and conname='reservations_arrival_issue_window_hours_check'
  ) then
    alter table public.reservations add constraint reservations_arrival_issue_window_hours_check
      check(arrival_issue_window_hours is null or arrival_issue_window_hours between 2 and 4);
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.hotel_bookings'::regclass
      and conname='hotel_bookings_arrival_issue_window_hours_check'
  ) then
    alter table public.hotel_bookings add constraint hotel_bookings_arrival_issue_window_hours_check
      check(arrival_issue_window_hours is null or arrival_issue_window_hours between 2 and 4);
  end if;
end
$$;

-- The canonical policy table exists on the integrated preview line. Keep this
-- seed idempotent so the locked default is explicit and versioned.
insert into public.creator_policy_versions(
  policy_key,scope_type,scope_key,version,value,value_schema,status,
  effective_from,public_disclosure,disclosure_text,legal_review_state,reason,checksum,published_at
)
select
  'accommodation_arrival_issue_window','global','*',1,
  jsonb_build_object('default_hours',2,'minimum_hours',2,'maximum_hours',4),
  jsonb_build_object('type','bounded_duration_policy','unit','hours'),
  'active',now(),true,
  'Accommodation money remains Payment Protected for at least two hours after authorized check-in. A published property/package policy may extend this to four hours.',
  'pending','Locked L-30 accommodation arrival-issue window',
  encode(digest('accommodation_arrival_issue_window:v1:2:2:4','sha256'),'hex'),now()
where not exists(
  select 1 from public.creator_policy_versions
  where policy_key='accommodation_arrival_issue_window'
    and scope_type='global' and scope_key='*' and version=1
);

insert into public.case_reason_registry(
  reason_code,label,owning_domain,allowed_subject_types,requires_evidence,
  customer_description,active,version
)
values(
  'arrival_issue','Arrival issue','property_operations',array['short_let','hotel']::text[],false,
  'Report a material arrival problem during the booking''s displayed arrival-issue window. The accommodation payment is frozen for WeHouse review.',
  true,1
)
on conflict(reason_code) do update set
  label=excluded.label,owning_domain=excluded.owning_domain,
  allowed_subject_types=excluded.allowed_subject_types,
  customer_description=excluded.customer_description,active=true,
  version=greatest(public.case_reason_registry.version,excluded.version);

create or replace function public.current_accommodation_arrival_policy()
returns table(policy_version_id uuid,default_hours integer,minimum_hours integer,maximum_hours integer)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select policy.policy_version_id,
    (policy.value->>'default_hours')::integer,
    (policy.value->>'minimum_hours')::integer,
    (policy.value->>'maximum_hours')::integer
  from public.creator_policy_versions policy
  where policy.policy_key='accommodation_arrival_issue_window'
    and policy.scope_type='global' and policy.scope_key='*'
    and policy.status='active' and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc,policy.version desc
  limit 1
$$;

create or replace function public.snapshot_short_stay_arrival_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy record;
  v_hours integer;
begin
  if new.stay_type is distinct from 'short_let' then return new; end if;
  if tg_op='UPDATE'
     and old.arrival_issue_policy_version_id is not null
     and new.arrival_issue_policy_version_id is distinct from old.arrival_issue_policy_version_id then
    raise exception 'A booked arrival policy snapshot is immutable';
  end if;
  if new.arrival_issue_policy_version_id is not null then return new; end if;
  select * into v_policy from public.current_accommodation_arrival_policy();
  if v_policy.policy_version_id is null then
    raise exception 'Active accommodation arrival-issue policy required';
  end if;
  select listing.arrival_issue_window_hours into v_hours
  from public.listings listing
  where listing.listing_id=new.listing_id or listing.id::text=new.listing_id
  limit 1;
  v_hours:=coalesce(v_hours,v_policy.default_hours);
  if v_hours<v_policy.minimum_hours or v_hours>v_policy.maximum_hours then
    raise exception 'Short Let arrival-issue window must be between % and % hours',
      v_policy.minimum_hours,v_policy.maximum_hours;
  end if;
  new.arrival_issue_policy_version_id:=v_policy.policy_version_id;
  new.arrival_issue_window_hours:=v_hours;
  return new;
end
$$;

create or replace function public.snapshot_hotel_arrival_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy record;
  v_hours integer;
begin
  if tg_op='UPDATE'
     and old.arrival_issue_policy_version_id is not null
     and new.arrival_issue_policy_version_id is distinct from old.arrival_issue_policy_version_id then
    raise exception 'A booked arrival policy snapshot is immutable';
  end if;
  if new.arrival_issue_policy_version_id is not null then return new; end if;
  select * into v_policy from public.current_accommodation_arrival_policy();
  if v_policy.policy_version_id is null then
    raise exception 'Active accommodation arrival-issue policy required';
  end if;
  select coalesce(plan.arrival_issue_window_hours,hotel.arrival_issue_window_hours)
  into v_hours
  from public.hotels hotel
  left join public.hotel_rate_plans plan on plan.rate_plan_id=new.rate_plan_id
    and plan.hotel_id=hotel.hotel_id
  where hotel.hotel_id=new.hotel_id;
  v_hours:=coalesce(v_hours,v_policy.default_hours);
  if v_hours<v_policy.minimum_hours or v_hours>v_policy.maximum_hours then
    raise exception 'Hotel arrival-issue window must be between % and % hours',
      v_policy.minimum_hours,v_policy.maximum_hours;
  end if;
  new.arrival_issue_policy_version_id:=v_policy.policy_version_id;
  new.arrival_issue_window_hours:=v_hours;
  return new;
end
$$;

drop trigger if exists reservations_snapshot_arrival_policy on public.reservations;
create trigger reservations_snapshot_arrival_policy
before insert or update of stay_type,listing_id,arrival_issue_policy_version_id
on public.reservations for each row
execute function public.snapshot_short_stay_arrival_policy();

drop trigger if exists hotel_bookings_snapshot_arrival_policy on public.hotel_bookings;
create trigger hotel_bookings_snapshot_arrival_policy
before insert or update of hotel_id,rate_plan_id,arrival_issue_policy_version_id
on public.hotel_bookings for each row
execute function public.snapshot_hotel_arrival_policy();

-- Snapshot currently open/paid records without changing any completed receipt.
update public.reservations reservation
set arrival_issue_policy_version_id=policy.policy_version_id,
    arrival_issue_window_hours=coalesce(listing.arrival_issue_window_hours,policy.default_hours),
    arrival_issue_deadline_at=case
      when reservation.checked_in_at is not null then
        reservation.checked_in_at+make_interval(hours=>coalesce(listing.arrival_issue_window_hours,policy.default_hours))
      else null end
from public.listings listing
cross join lateral public.current_accommodation_arrival_policy() policy
where reservation.stay_type='short_let'
  and (listing.listing_id=reservation.listing_id or listing.id::text=reservation.listing_id)
  and reservation.arrival_issue_policy_version_id is null;

update public.hotel_bookings booking
set arrival_issue_policy_version_id=policy.policy_version_id,
    arrival_issue_window_hours=coalesce(
      (select plan.arrival_issue_window_hours from public.hotel_rate_plans plan
       where plan.rate_plan_id=booking.rate_plan_id and plan.hotel_id=booking.hotel_id),
      hotel.arrival_issue_window_hours,policy.default_hours),
    arrival_issue_deadline_at=case
      when booking.checked_in_at is not null then booking.checked_in_at+make_interval(
        hours=>coalesce(
          (select plan.arrival_issue_window_hours from public.hotel_rate_plans plan
           where plan.rate_plan_id=booking.rate_plan_id and plan.hotel_id=booking.hotel_id),
          hotel.arrival_issue_window_hours,policy.default_hours))
      else null end
from public.hotels hotel
cross join lateral public.current_accommodation_arrival_policy() policy
where hotel.hotel_id=booking.hotel_id
  and booking.arrival_issue_policy_version_id is null;

create or replace function public.set_short_stay_arrival_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.stay_type='short_let' and new.checked_in_at is not null
     and (old.checked_in_at is null or new.checked_in_at is distinct from old.checked_in_at) then
    if new.arrival_issue_policy_version_id is null
       or new.arrival_issue_window_hours not between 2 and 4 then
      raise exception 'Short Let arrival policy snapshot required before check-in';
    end if;
    new.arrival_issue_deadline_at:=new.checked_in_at
      +make_interval(hours=>new.arrival_issue_window_hours);
  end if;
  return new;
end
$$;

create or replace function public.set_hotel_arrival_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.checked_in_at is not null
     and (old.checked_in_at is null or new.checked_in_at is distinct from old.checked_in_at) then
    if new.arrival_issue_policy_version_id is null
       or new.arrival_issue_window_hours not between 2 and 4 then
      raise exception 'Hotel arrival policy snapshot required before check-in';
    end if;
    new.arrival_issue_deadline_at:=new.checked_in_at
      +make_interval(hours=>new.arrival_issue_window_hours);
  end if;
  return new;
end
$$;

drop trigger if exists reservations_set_arrival_deadline on public.reservations;
create trigger reservations_set_arrival_deadline
before update of checked_in_at on public.reservations for each row
execute function public.set_short_stay_arrival_deadline();

drop trigger if exists hotel_bookings_set_arrival_deadline on public.hotel_bookings;
create trigger hotel_bookings_set_arrival_deadline
before update of checked_in_at on public.hotel_bookings for each row
execute function public.set_hotel_arrival_deadline();

-- This replaces the legacy Short Let check-in command that attempted to move
-- Partner money at check-in (and now calls a retired release function).
create or replace function public.activate_short_stay(
  p_reservation_id text,
  p_actual_check_in date default current_date
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
  v_protection public.payment_protection_transactions;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Housing Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let' for update;
  if v_res.id is null then raise exception 'Short Stay reservation not found'; end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id for update;
  if v_listing.id is null or v_listing.sub_type<>'short_let' then
    raise exception 'Short Stay listing not found';
  end if;
  if v_actor.role<>'creator'
     and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available' then
    raise exception 'This Short Stay is not currently open for guest stays';
  end if;
  if v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid'
     or v_res.rent_paid_at is null then
    raise exception 'Short Stay payment must be verified before check-in';
  end if;
  if p_actual_check_in<v_res.stay_check_in or p_actual_check_in>=v_res.stay_check_out then
    raise exception 'Check-in must fall inside the reserved stay dates';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_res.stay_payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state<>'protected' then
    raise exception 'Current Short Stay Payment Protection is required before check-in';
  end if;
  if exists(
    select 1 from public.reservations reservation
    where reservation.listing_id=v_res.listing_id and reservation.id<>v_res.id
      and reservation.stay_type='short_let' and reservation.status='occupied'
      and daterange(reservation.stay_check_in,reservation.stay_check_out,'[)')
        && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then raise exception 'Those Short Stay dates are already occupied'; end if;

  update public.reservations
  set status='occupied',tenancy_start_date=p_actual_check_in,
      tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),checked_in_at=now(),updated_at=now()
  where id=v_res.id returning * into v_result;

  insert into public.obligation_policy_snapshots(
    subject_type,subject_id,policy_version_id,calculated_value
  ) values(
    'short_let',v_res.id,v_result.arrival_issue_policy_version_id,
    jsonb_build_object('arrival_issue_window_hours',v_result.arrival_issue_window_hours,
      'arrival_issue_deadline_at',v_result.arrival_issue_deadline_at,
      'authorized_check_in_at',v_result.checked_in_at)
  ) on conflict(subject_type,subject_id,policy_version_id) do nothing;

  update public.listings set
    status='available',availability_status='available',reserved_by=null,
    reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,
    current_reservation_id=null,updated_at=now()
  where id=v_listing.id and status in ('reserved','occupied');
  return v_result;
end
$$;

create or replace function public.snapshot_hotel_arrival_policy_event()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.checked_in_at is not null and old.checked_in_at is null then
    insert into public.obligation_policy_snapshots(
      subject_type,subject_id,policy_version_id,calculated_value
    ) values(
      'hotel',new.booking_id::text,new.arrival_issue_policy_version_id,
      jsonb_build_object('arrival_issue_window_hours',new.arrival_issue_window_hours,
        'arrival_issue_deadline_at',new.arrival_issue_deadline_at,
        'authorized_check_in_at',new.checked_in_at)
    ) on conflict(subject_type,subject_id,policy_version_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists hotel_bookings_snapshot_arrival_policy_event on public.hotel_bookings;
create trigger hotel_bookings_snapshot_arrival_policy_event
after update of checked_in_at on public.hotel_bookings for each row
execute function public.snapshot_hotel_arrival_policy_event();

-- A formal arrival issue is distinct from an ordinary Message WeHouse request.
-- It is the only authenticated customer command in this window that freezes
-- the accommodation obligation.
create or replace function public.report_my_accommodation_arrival_issue(
  p_subject_type text,
  p_subject_id text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_protection_id uuid;
  v_deadline timestamptz;
  v_protection public.payment_protection_transactions;
  v_case_id uuid;
  v_from_state text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_subject_type not in ('short_let','hotel') then
    raise exception 'Arrival issues apply only to Hotel or Short Let stays';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Explain the arrival issue';
  end if;
  if p_subject_type='short_let' then
    select reservation.stay_payment_protection_id,reservation.arrival_issue_deadline_at
    into v_protection_id,v_deadline
    from public.reservations reservation
    where reservation.id=p_subject_id and reservation.user_id=v_actor
      and reservation.stay_type='short_let' and reservation.checked_in_at is not null
      and reservation.status in ('occupied','completed');
  else
    select booking.payment_protection_id,booking.arrival_issue_deadline_at
    into v_protection_id,v_deadline
    from public.hotel_bookings booking
    where booking.booking_id::text=p_subject_id and booking.user_id=v_actor
      and booking.checked_in_at is not null
      and coalesce(booking.canonical_state,booking.status) in ('checked_in','checked_out','completed');
  end if;
  if v_protection_id is null or v_deadline is null then
    raise exception 'This stay is not eligible for an arrival issue';
  end if;
  if now()>v_deadline then raise exception 'The arrival-issue window is closed'; end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_protection_id for update;
  if v_protection.id is null
     or v_protection.protection_state not in ('protected','release_eligible','disputed') then
    raise exception 'Accommodation money is no longer eligible for an arrival issue';
  end if;
  v_case_id:=public.open_contextual_case(
    'arrival_issue',p_subject_type,p_subject_id,btrim(p_reason)
  );
  if v_protection.protection_state<>'disputed' then
    v_from_state:=v_protection.protection_state;
    insert into public.payment_protection_transitions(
      payment_protection_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,reason,metadata
    ) values(
      v_protection.id,v_from_state,'disputed','arrival_issue_reported',
      'arrival-issue:'||v_case_id::text,v_actor,'customer',btrim(p_reason),
      jsonb_build_object('operational_case_id',v_case_id,'deadline_at',v_deadline)
    ) on conflict(event_key) do nothing;
    update public.payment_protection_transactions set
      protection_state='disputed',status='disputed',risk_held_at=now(),
      dispute_case_id=v_case_id,updated_at=now()
    where id=v_protection.id;
    update public.property_partner_earning_releases earning
    set status='held',held_at=now(),hold_reason='Arrival issue '||v_case_id::text,
        updated_at=now()
    from public.booking_payments payment
    where payment.id=earning.payment_id
      and payment.paystack_reference=v_protection.paystack_reference
      and earning.status='pending';
    update public.financial_action_outbox set
      status='manual_review',claimed_by=null,claimed_at=null,
      last_error='Frozen by timely arrival issue '||v_case_id::text,
      metadata=metadata||jsonb_build_object('arrival_issue_case_id',v_case_id),
      updated_at=now()
    where payment_protection_id=v_protection.id
      and action_type in ('release_short_let_stay','release_hotel_stay')
      and status in ('pending','claimed');
  end if;
  return v_case_id;
end
$$;

-- Final backstop: neither the batch scheduler nor any other server path may
-- enqueue an accommodation release before the snapshotted deadline or while a
-- formal case is open. Returning null leaves the protected money untouched.
create or replace function public.guard_accommodation_release_outbox()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_deadline timestamptz;
  v_open_issue boolean;
  v_state text;
begin
  if new.action_type not in ('release_short_let_stay','release_hotel_stay') then
    return new;
  end if;
  if new.status not in ('pending','claimed') then return new; end if;
  if new.action_type='release_short_let_stay' then
    select reservation.arrival_issue_deadline_at,
      exists(select 1 from public.operational_cases case_row
        where case_row.subject_type='short_let' and case_row.subject_id=reservation.id
          and case_row.status not in ('resolved','closed'))
    into v_deadline,v_open_issue
    from public.reservations reservation where reservation.id=new.subject_id;
  else
    select booking.arrival_issue_deadline_at,
      exists(select 1 from public.operational_cases case_row
        where case_row.subject_type='hotel' and case_row.subject_id=booking.booking_id::text
          and case_row.status not in ('resolved','closed'))
    into v_deadline,v_open_issue
    from public.hotel_bookings booking where booking.booking_id::text=new.subject_id;
  end if;
  select protection_state into v_state from public.payment_protection_transactions
  where id=new.payment_protection_id;
  if v_deadline is null or now()<v_deadline or coalesce(v_open_issue,false)
     or v_state not in ('protected','release_eligible') then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists guard_accommodation_release_outbox on public.financial_action_outbox;
create trigger guard_accommodation_release_outbox
before insert or update of status,available_at,amount on public.financial_action_outbox
for each row execute function public.guard_accommodation_release_outbox();

create or replace function public.get_my_accommodation_protection(
  p_subject_type text,
  p_subject_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_owner boolean:=false;
  v_protection_id uuid;
  v_deadline timestamptz;
  v_hours integer;
  v_checked_in_at timestamptz;
  v_policy_id uuid;
  v_protection public.payment_protection_transactions;
  v_case_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_subject_type='short_let' then
    select reservation.user_id=v_actor,reservation.stay_payment_protection_id,
      reservation.arrival_issue_deadline_at,reservation.arrival_issue_window_hours,
      reservation.checked_in_at,reservation.arrival_issue_policy_version_id
    into v_owner,v_protection_id,v_deadline,v_hours,v_checked_in_at,v_policy_id
    from public.reservations reservation where reservation.id=p_subject_id;
  elsif p_subject_type='hotel' then
    select booking.user_id=v_actor,booking.payment_protection_id,
      booking.arrival_issue_deadline_at,booking.arrival_issue_window_hours,
      booking.checked_in_at,booking.arrival_issue_policy_version_id
    into v_owner,v_protection_id,v_deadline,v_hours,v_checked_in_at,v_policy_id
    from public.hotel_bookings booking where booking.booking_id::text=p_subject_id;
  else raise exception 'Unsupported accommodation subject'; end if;
  if not coalesce(v_owner,false) then raise exception 'Booking participant access required'; end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_protection_id;
  select case_row.operational_case_id into v_case_id
  from public.operational_cases case_row
  where case_row.reason_code='arrival_issue' and case_row.subject_type=p_subject_type
    and case_row.subject_id=p_subject_id and case_row.requester_user_id=v_actor
    and case_row.status not in ('resolved','closed')
  order by case_row.created_at desc limit 1;
  return jsonb_build_object(
    'subject_type',p_subject_type,'subject_id',p_subject_id,
    'protection_state',v_protection.protection_state,
    'amount_total',v_protection.amount_total,
    'checked_in_at',v_checked_in_at,'arrival_issue_window_hours',v_hours,
    'arrival_issue_deadline_at',v_deadline,'policy_version_id',v_policy_id,
    'can_report_arrival_issue',v_checked_in_at is not null and v_deadline is not null
      and now()<=v_deadline and v_case_id is null
      and v_protection.protection_state in ('protected','release_eligible'),
    'arrival_issue_case_id',v_case_id
  );
end
$$;

revoke all on function public.current_accommodation_arrival_policy() from public,anon,authenticated;
revoke all on function public.snapshot_short_stay_arrival_policy() from public,anon,authenticated;
revoke all on function public.snapshot_hotel_arrival_policy() from public,anon,authenticated;
revoke all on function public.set_short_stay_arrival_deadline() from public,anon,authenticated;
revoke all on function public.set_hotel_arrival_deadline() from public,anon,authenticated;
revoke all on function public.snapshot_hotel_arrival_policy_event() from public,anon,authenticated;
revoke all on function public.guard_accommodation_release_outbox() from public,anon,authenticated;
revoke all on function public.report_my_accommodation_arrival_issue(text,text,text) from public,anon;
revoke all on function public.get_my_accommodation_protection(text,text) from public,anon;

grant execute on function public.current_accommodation_arrival_policy() to service_role;
grant execute on function public.report_my_accommodation_arrival_issue(text,text,text) to authenticated,service_role;
grant execute on function public.get_my_accommodation_protection(text,text) to authenticated,service_role;

comment on function public.report_my_accommodation_arrival_issue(text,text,text) is
  'Formal, deadline-gated Hotel/Short Let arrival issue. Freezes only the linked accommodation Payment Protection and opens one specialist case.';
comment on column public.reservations.arrival_issue_deadline_at is
  'Immutable release/reporting deadline calculated from authorized Short Let check-in and the booking policy snapshot.';
comment on column public.hotel_bookings.arrival_issue_deadline_at is
  'Immutable release/reporting deadline calculated from authorized Hotel check-in and the booking policy snapshot.';
