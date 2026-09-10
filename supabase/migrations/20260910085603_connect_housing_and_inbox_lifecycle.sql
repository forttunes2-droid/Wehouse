-- A reservation fee holds a property. It must never create a customer-facing
-- move-in code or start a tenancy. Rent, arrival choice and verified handover
-- are separate authoritative transitions.

alter table public.reservations
  add column if not exists requested_move_in_at timestamptz,
  add column if not exists move_in_requested_at timestamptz;

comment on column public.reservations.requested_move_in_at is
  'Customer preferred arrival time after verified rent; this does not start occupancy.';
comment on column public.reservations.move_in_requested_at is
  'Audit timestamp for the latest customer move-in request.';

create or replace function public.set_reservation_booking_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lga text;
  v_can_issue boolean;
begin
  v_can_issue :=
    new.status in ('ready_for_move_in', 'occupied', 'completed')
    and coalesce(new.manual_payment_status, 'unpaid') in ('paid', 'completed')
    and new.paid_at is not null
    and coalesce(new.rent_payment_status, 'not_started') in ('paid', 'upfront_paid')
    and new.rent_paid_at is not null;

  if not v_can_issue then
    new.booking_code := null;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and nullif(btrim(coalesce(old.booking_code, '')), '') is not null then
    new.booking_code := old.booking_code;
    return new;
  end if;

  if nullif(btrim(coalesce(new.booking_code, '')), '') is not null then
    insert into public.booking_code_registry(code)
    values (upper(btrim(new.booking_code)))
    on conflict do nothing;
    new.booking_code := upper(btrim(new.booking_code));
    return new;
  end if;

  select coalesce(nullif(btrim(l.city), ''), nullif(btrim(l.state), ''), 'General')
  into v_lga
  from public.listings l
  where l.id::text = new.listing_id or l.listing_id = new.listing_id
  limit 1;

  new.booking_code := public.reserve_lga_booking_code(coalesce(v_lga, 'General'));
  return new;
end;
$$;

drop trigger if exists set_reservation_booking_code_trigger on public.reservations;
create trigger set_reservation_booking_code_trigger
before insert or update of booking_code, status, manual_payment_status, paid_at,
  rent_payment_status, rent_paid_at
on public.reservations
for each row execute function public.set_reservation_booking_code();

-- Remove premature codes that were issued after the reservation fee alone.
update public.reservations
set booking_code = null,
    updated_at = now()
where booking_code is not null
  and not (
    status in ('ready_for_move_in', 'occupied', 'completed')
    and coalesce(manual_payment_status, 'unpaid') in ('paid', 'completed')
    and paid_at is not null
    and coalesce(rent_payment_status, 'not_started') in ('paid', 'upfront_paid')
    and rent_paid_at is not null
  );

create or replace function public.request_my_apartment_move_in(
  p_reservation_id text,
  p_requested_at timestamptz
)
returns public.reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
begin
  select * into v_actor
  from public.profiles
  where auth_id = (select auth.uid())::text
    and role = 'user'
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;
  if v_actor is null then raise exception 'Active customer account required'; end if;

  select * into v_res
  from public.reservations
  where id = p_reservation_id and user_id = v_actor.user_id
  for update;
  if v_res is null then raise exception 'Apartment reservation not found'; end if;
  if coalesce(v_res.stay_type, 'long_stay') <> 'long_stay' then
    raise exception 'Use the reserved check-in time for a Short Let';
  end if;
  if v_res.status <> 'ready_for_move_in'
     or v_res.rent_payment_status not in ('paid', 'upfront_paid')
     or v_res.rent_paid_at is null then
    raise exception 'Verified Year 1 rent is required before choosing move-in';
  end if;
  if p_requested_at is null
     or p_requested_at < now() - interval '15 minutes'
     or p_requested_at > now() + interval '3 days' then
    raise exception 'Choose a move-in time within the next 3 days';
  end if;

  select * into v_listing
  from public.listings
  where id::text = v_res.listing_id or listing_id = v_res.listing_id
  limit 1;
  if v_listing is null then raise exception 'Apartment listing not found'; end if;

  update public.reservations
  set requested_move_in_at = p_requested_at,
      move_in_requested_at = now(),
      updated_at = now()
  where id = v_res.id
  returning * into v_result;

  insert into public.notifications(
    recipient_id, type, title, message, read, source_type, source_id,
    destination_route, destination_params, workspace_scope
  ) values (
    v_actor.user_id, 'move_in_request_saved', 'Move-in time sent',
    'Property Operations received your preferred arrival time. Your tenancy has not started yet.',
    false, 'apartment_reservation', v_res.id, 'my_reservations',
    jsonb_build_object('reservation_id', v_res.id), 'personal'
  );

  insert into public.notifications(
    recipient_id, type, title, message, read, source_type, source_id,
    destination_route, destination_params, workspace_scope
  )
  select staff.user_id, 'property_move_in_requested', 'Move-in time requested',
    coalesce(nullif(v_actor.full_name, ''), nullif(v_actor.username, ''), 'A customer') ||
      ' chose an arrival time for ' || coalesce(v_listing.title, 'an apartment') || '.',
    false, 'apartment_reservation', v_res.id, 'operations_bookings',
    jsonb_build_object('reservation_id', v_res.id, 'listing_id', v_res.listing_id),
    case staff.role when 'creator' then 'creator' when 'admin' then 'admin' else 'staff' end
  from public.profiles staff
  where staff.role in ('staff', 'admin', 'creator')
    and not coalesce(staff.deleted, false)
    and not coalesce(staff.suspended, false)
    and not coalesce(staff.banned, false)
    and (
      staff.role in ('admin', 'creator')
      or (
        lower(btrim(coalesce(staff.state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
        and lower(btrim(coalesce(staff.local_government, staff.city, ''))) = lower(btrim(coalesce(v_listing.city, '')))
      )
    );

  return v_result;
end;
$$;

revoke all on function public.request_my_apartment_move_in(text, timestamptz) from public, anon;
grant execute on function public.request_my_apartment_move_in(text, timestamptz) to authenticated, service_role;

drop function if exists public.get_my_housing_operations();
create function public.get_my_housing_operations()
returns table(
  listing_id text,
  listing_title text,
  listing_status text,
  property_type text,
  sub_type text,
  state text,
  lga text,
  address text,
  annual_rent numeric,
  current_reservation_id text,
  reservation_status text,
  customer_user_id text,
  customer_name text,
  customer_username text,
  reservation_fee_paid boolean,
  payment_status text,
  rental_plan_years integer,
  contract_rent_total numeric,
  upfront_rent_required numeric,
  installment_balance numeric,
  installment_count integer,
  rent_payment_status text,
  rent_paid_at timestamptz,
  hold_expires_at timestamptz,
  requested_move_in_at timestamptz,
  move_in_requested_at timestamptz,
  tenancy_start_date date,
  tenancy_end_date date,
  move_out_grace_until date,
  occupied_at timestamptz
)
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id = (select auth.uid())::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  return query
  select
    l.id::text,l.title,l.status,l.property_type,l.sub_type,l.state,l.city,l.address,l.price,
    r.id,r.status,r.user_id,coalesce(p.full_name,p.username,p.email),p.username,
    (coalesce(r.manual_payment_status,'unpaid') in ('paid','completed') and r.paid_at is not null),
    r.manual_payment_status,r.rental_plan_years,r.contract_rent_total,r.upfront_rent_required,
    r.installment_balance,r.installment_count,r.rent_payment_status,r.rent_paid_at,
    r.hold_expires_at,r.requested_move_in_at,r.move_in_requested_at,
    r.tenancy_start_date,r.tenancy_end_date,r.move_out_grace_until,l.occupied_at
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where coalesce(r.stay_type,'long_stay')='long_stay'
    and r.status not in ('cancelled','expired')
    and (v_actor.role='creator' or public.current_actor_in_scope(l.state,l.city))
  order by
    case r.status
      when 'payment_conflict' then 1 when 'ready_for_move_in' then 2
      when 'inspection_pending' then 3 when 'reserved' then 4
      when 'payment_pending' then 5 when 'occupied' then 6 else 7
    end,
    r.updated_at desc;
end;
$$;

revoke all on function public.get_my_housing_operations() from public, anon;
grant execute on function public.get_my_housing_operations() to authenticated, service_role;

create or replace function public.verify_branch_booking_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_code text:=upper(btrim(coalesce(p_code,'')));
  v_result jsonb;
  v_state text;
  v_lga text;
begin
  if v_code !~ '^[A-Z]{3}WH[0-9]{5}$' then raise exception 'Enter a valid WeHouse booking code'; end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations module required';
  end if;

  select jsonb_build_object(
    'kind','housing','code',r.booking_code,'status',r.status,'payment_status',r.rent_payment_status,
    'reservation_fee_status',r.manual_payment_status,'stay_type',coalesce(r.stay_type,'long_stay'),
    'customer_name',coalesce(p.full_name,p.username,r.user_email),'customer_phone',coalesce(p.phone,r.user_phone),
    'property_name',coalesce(l.title,r.listing_title),'state',l.state,'lga',l.city,'reservation_id',r.id,
    'listing_id',r.listing_id,'check_in',r.stay_check_in,'check_out',r.stay_check_out,
    'guest_count',coalesce(r.guest_count,1),'requested_move_in_at',r.requested_move_in_at,
    'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date,
    'valid',(r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null),
    'can_handover',(coalesce(r.stay_type,'long_stay')='long_stay' and r.status='ready_for_move_in'
      and r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null
      and r.requested_move_in_at is not null),
    'can_check_in',(r.stay_type='short_let' and r.status='ready_for_move_in'
      and r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status='paid' and r.rent_paid_at is not null
      and current_date>=r.stay_check_in and current_date<r.stay_check_out)
  ),l.state,l.city
  into v_result,v_state,v_lga
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.booking_code=v_code
  limit 1;

  if v_result is null then
    select jsonb_build_object(
      'kind','hotel','code',hb.booking_code,'status',hb.status,'payment_status',hb.payment_status,
      'customer_name',coalesce(p.full_name,p.username,hb.guest_name),'customer_phone',coalesce(p.phone,hb.guest_phone),
      'property_name',h.name,'state',h.state,'lga',h.city,'booking_id',hb.booking_id,'hotel_id',hb.hotel_id,
      'check_in',hb.check_in,'check_out',hb.check_out,'guest_count',hb.guest_count,
      'valid',(hb.payment_status='paid' and hb.status not in ('cancelled','refunded')),
      'can_check_in',(hb.payment_status='paid' and hb.status in ('confirmed','paid')
        and current_date>=hb.check_in and current_date<hb.check_out)
    ),h.state,h.city
    into v_result,v_state,v_lga
    from public.hotel_bookings hb
    join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.profiles p on p.user_id=hb.user_id
    where hb.booking_code=v_code
    limit 1;
  end if;
  if v_result is null then return null; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_state,v_lga) then
    raise exception 'This booking belongs to another WeHouse branch';
  end if;
  return v_result;
end;
$$;

revoke all on function public.verify_branch_booking_code(text) from public, anon;
grant execute on function public.verify_branch_booking_code(text) to authenticated, service_role;

create or replace function public.confirm_apartment_handover(
  p_booking_code text,
  p_start_date date default current_date
)
returns public.reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_verified jsonb;
  v_result public.reservations;
begin
  v_verified := public.verify_branch_booking_code(p_booking_code);
  if v_verified is null or v_verified ->> 'kind' <> 'housing' then
    raise exception 'Enter a valid housing move-in code';
  end if;
  if coalesce((v_verified ->> 'can_handover')::boolean, false) is not true then
    raise exception 'Verified rent and a customer move-in time are required before handover';
  end if;
  if p_start_date <> ((v_verified ->> 'requested_move_in_at')::timestamptz)::date then
    raise exception 'The tenancy start date must match the customer move-in request';
  end if;

  select public.activate_apartment_tenancy(
    v_verified ->> 'reservation_id',
    p_start_date
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.confirm_apartment_handover(text, date) from public, anon;
grant execute on function public.confirm_apartment_handover(text, date) to authenticated, service_role;

-- Reading an incoming roommate request is not the same as resolving it. When
-- the recipient accepts or passes, convert that Activity item into a resolved
-- lifecycle update so it leaves "Needs my action" without disappearing from
-- history.
create or replace function public.resolve_roommate_interest_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interest public.roommate_search_results;
begin
  if new.status not in ('accepted', 'declined') then return new; end if;

  select * into v_interest
  from public.roommate_search_results r
  where r.searcher_id = new.matched_user_id
    and r.matched_user_id = new.searcher_id
    and r.status = 'accepted'
  limit 1;
  if v_interest is null then return new; end if;

  update public.notifications
  set type = 'roommate_interest_resolved',
      title = case when new.status = 'accepted'
        then 'Roommate request accepted'
        else 'Roommate request passed'
      end,
      message = case when new.status = 'accepted'
        then 'You accepted this request. The mutual match is ready in Roommates.'
        else 'You passed this request privately. No conversation was created.'
      end,
      read = true,
      read_at = coalesce(read_at, now()),
      source_type = 'roommate_match',
      source_id = v_interest.id::text,
      destination_route = 'roommate',
      destination_params = jsonb_build_object('interest_id', v_interest.id)
  where recipient_id = new.searcher_id
    and type = 'roommate_interest'
    and coalesce(source_id, related_id) = v_interest.id::text;

  return new;
end;
$$;

drop trigger if exists resolve_roommate_interest_activity_trigger
on public.roommate_search_results;
create trigger resolve_roommate_interest_activity_trigger
after insert or update of status on public.roommate_search_results
for each row execute function public.resolve_roommate_interest_activity();

revoke all on function public.resolve_roommate_interest_activity() from public, anon, authenticated;
grant execute on function public.resolve_roommate_interest_activity() to service_role;
