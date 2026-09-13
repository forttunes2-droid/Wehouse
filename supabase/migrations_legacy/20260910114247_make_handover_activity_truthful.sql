-- Rent confirmation, move-in scheduling and physical handover are separate
-- lifecycle events. Activity must never ask Operations to coordinate a
-- handover before the customer has chosen an arrival time.

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

  -- The reservation hold ends when verified rent makes the booking eligible
  -- for move-in. Keeping its old deadline visible after this point is false.
  new.hold_expires_at := null;

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

update public.reservations
set hold_expires_at = null,
    updated_at = now()
where hold_expires_at is not null
  and rent_payment_status in ('paid', 'upfront_paid')
  and rent_paid_at is not null;

create or replace function public.notify_reservation_operations_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_recipient text;
  v_type text;
  v_title text;
  v_message text;
  v_state_key text;
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.rent_payment_status is not distinct from new.rent_payment_status
     and old.rent_paid_at is not distinct from new.rent_paid_at then
    return new;
  end if;

  select * into v_listing
  from public.listings l
  where l.id::text = new.listing_id or l.listing_id = new.listing_id
  limit 1;
  if v_listing is null then return new; end if;

  if new.status = 'inspection_pending' then
    v_type := 'property_inspection_coordination_required';
    v_title := 'Inspection request needs coordination';
    v_message := format('%s · assign or continue the requested apartment visit.', v_listing.title);
    v_state_key := 'inspection_pending';
  elsif new.status = 'payment_conflict' then
    v_type := 'reservation_payment_conflict';
    v_title := 'Reservation payment needs review';
    v_message := format('%s · payment must be reviewed before this reservation can continue.', v_listing.title);
    v_state_key := 'payment_conflict';
  elsif new.status = 'ready_for_move_in'
    and new.rent_payment_status in ('paid', 'upfront_paid')
    and new.rent_paid_at is not null
    and new.requested_move_in_at is null then
    v_type := 'property_rent_confirmed';
    v_title := 'Year 1 rent confirmed';
    v_message := format('%s · waiting for the customer to choose a move-in time.', v_listing.title);
    v_state_key := 'rent_confirmed_waiting_customer';
  else
    -- Paid reservation fees, unpaid rent and completed transitions remain in
    -- the booking record. They are not operational actions by themselves.
    return new;
  end if;

  for v_recipient in
    select distinct p.user_id
    from public.profiles p
    where not coalesce(p.deleted, false)
      and not coalesce(p.suspended, false)
      and not coalesce(p.banned, false)
      and (
        (p.role = 'admin'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(v_listing.city, ''))))
        or (p.role = 'staff'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(v_listing.city, '')))
          and exists (
            select 1 from public.staff_permissions sp
            where sp.staff_id = p.user_id
              and sp.permission = 'operations'
              and sp.is_active
          ))
      )
  loop
    insert into public.notifications(
      recipient_id, type, title, message, read, related_id, source_type, source_id,
      destination_route, destination_params, event_key, created_at
    ) values (
      v_recipient, v_type, v_title, v_message, false, new.id::text,
      'reservation', new.id::text, 'operations_bookings',
      jsonb_build_object(
        'reservation_id', new.id,
        'listing_id', v_listing.id::text,
        'status', new.status,
        'workflow_state', v_state_key
      ),
      'operations_reservation:' || new.id::text || ':' || v_state_key,
      now()
    ) on conflict (recipient_id, event_key) where event_key is not null do nothing;
  end loop;
  return new;
end;
$$;

revoke all on function public.notify_reservation_operations_activity() from public, anon, authenticated;
grant execute on function public.notify_reservation_operations_activity() to service_role;

drop trigger if exists reservations_operations_activity on public.reservations;
create trigger reservations_operations_activity
after insert or update of status, rent_payment_status, rent_paid_at
on public.reservations
for each row execute function public.notify_reservation_operations_activity();

-- A completed reservation fee does not require Property Operations to review
-- anything. Remove the old action, including its obsolete pre-rent code.
delete from public.notifications n
using public.reservations r
where n.source_type = 'reservation'
  and n.source_id = r.id::text
  and n.type = 'reservation_action_required'
  and n.title = 'Paid reservation needs review';

-- Convert the false handover action into a truthful informational update when
-- rent is verified but the customer has not selected an arrival time.
update public.notifications n
set type = 'property_rent_confirmed',
    title = 'Year 1 rent confirmed',
    message = format('%s · waiting for the customer to choose a move-in time.', l.title),
    destination_route = 'operations_bookings',
    destination_params = coalesce(n.destination_params, '{}'::jsonb)
      || jsonb_build_object(
        'reservation_id', r.id,
        'listing_id', l.id::text,
        'status', r.status,
        'workflow_state', 'rent_confirmed_waiting_customer'
      ),
    event_key = 'operations_reservation:' || r.id::text || ':rent_confirmed_waiting_customer'
from public.reservations r
join public.listings l
  on l.id::text = r.listing_id or l.listing_id = r.listing_id
where n.source_type = 'reservation'
  and n.source_id = r.id::text
  and n.type = 'reservation_action_required'
  and n.title in ('Handover needs coordination', 'Booking ready for handover')
  and r.status = 'ready_for_move_in'
  and r.rent_payment_status in ('paid', 'upfront_paid')
  and r.rent_paid_at is not null
  and r.requested_move_in_at is null;

-- Once a genuine move-in request exists, its dedicated
-- property_move_in_requested event is the only handover action.
delete from public.notifications n
using public.reservations r
where n.source_type = 'reservation'
  and n.source_id = r.id::text
  and n.type = 'reservation_action_required'
  and n.title in ('Handover needs coordination', 'Booking ready for handover')
  and r.requested_move_in_at is not null;

create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_actor public.profiles; v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='property_partner'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;

  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select
      r.id as reservation_id,
      r.booking_code,
      coalesce(r.stay_type,'long_stay') as stay_type,
      r.status,
      r.rent_payment_status as payment_status,
      r.rent_paid_at,
      r.stay_check_in as check_in,
      r.stay_check_out as check_out,
      r.stay_nights as nights,
      coalesce(r.guest_count,1) as guest_count,
      r.requested_move_in_at,
      r.move_in_requested_at,
      r.tenancy_start_date,
      r.tenancy_end_date,
      r.created_at,
      l.id::text as listing_id,
      l.listing_id as public_listing_code,
      l.title as listing_title
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    where (l.owner_id=v_actor.user_id or l.partner_id=v_actor.user_id)
      and (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and (
        (
          coalesce(r.stay_type,'long_stay')='short_let'
          and (
            (r.rent_payment_status='paid' and r.rent_paid_at is not null)
            or r.status in ('occupied','completed')
          )
        )
        or (
          coalesce(r.stay_type,'long_stay')<>'short_let'
          and (
            (r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null)
            or r.status in ('occupied','completed')
          )
        )
      )
    order by r.created_at desc
    limit 50
  ) stay;
  return v_result;
end;
$function$;

revoke all on function public.get_my_property_partner_stays(text) from public,anon;
grant execute on function public.get_my_property_partner_stays(text) to authenticated,service_role;

create or replace function public.notify_property_partner_reservation_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_listing public.listings;
  v_partner_id text;
  v_stage text;
  v_title text;
  v_message text;
  v_short_let boolean:=coalesce(new.stay_type,'long_stay')='short_let';
begin
  select * into v_listing
  from public.listings
  where id::text=new.listing_id or listing_id=new.listing_id
  limit 1;
  if v_listing is null then return new; end if;
  v_partner_id:=coalesce(v_listing.partner_id,v_listing.owner_id);
  if v_partner_id is null then return new; end if;

  if v_short_let then
    if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
      v_stage:='checkout';
      v_title:='Guest checked out';
      v_message:=format('The guest left %s on %s. WeHouse is handling the final stay and deposit checks.',v_listing.title,to_char(new.stay_check_out,'DD Mon YYYY'));
    elsif new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status) then
      v_stage:='checkin';
      v_title:='Guest checked in';
      v_message:=format('A guest entered %s on %s for the booked stay.',v_listing.title,to_char(new.stay_check_in,'DD Mon YYYY'));
    elsif new.rent_payment_status='paid' and new.rent_paid_at is not null
      and (tg_op='INSERT' or old.rent_payment_status is distinct from new.rent_payment_status or old.rent_paid_at is distinct from new.rent_paid_at) then
      v_stage:='reserved';
      v_title:='Short Let booked';
      v_message:=format('%s is booked from %s to %s. WeHouse is handling the guest arrival.',v_listing.title,to_char(new.stay_check_in,'DD Mon YYYY'),to_char(new.stay_check_out,'DD Mon YYYY'));
    else
      return new;
    end if;
  else
    if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
      v_stage:='completed';
      v_title:='Tenancy completed';
      v_message:=format('The tenancy at %s has ended.',v_listing.title);
    elsif new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status) then
      v_stage:='occupied';
      v_title:='Tenant moved in';
      v_message:=format('WeHouse verified the handover for %s. The tenancy is now active.',v_listing.title);
    elsif new.status='ready_for_move_in'
      and new.rent_payment_status in ('paid','upfront_paid')
      and new.rent_paid_at is not null
      and new.requested_move_in_at is not null
      and (tg_op='INSERT' or old.requested_move_in_at is distinct from new.requested_move_in_at) then
      v_stage:='move_in_scheduled';
      v_title:='Move-in time selected';
      v_message:=format('The customer selected %s for %s. WeHouse will verify the code and hand over access at arrival.',to_char(new.requested_move_in_at,'DD Mon YYYY, HH12:MI AM'),v_listing.title);
    elsif new.rent_payment_status in ('paid','upfront_paid')
      and new.rent_paid_at is not null
      and (tg_op='INSERT' or old.rent_payment_status is distinct from new.rent_payment_status or old.rent_paid_at is distinct from new.rent_paid_at) then
      v_stage:='rent_confirmed';
      v_title:='Year 1 rent confirmed';
      v_message:=format('Rent is confirmed for %s. WeHouse is waiting for the customer to choose a move-in time; the tenancy has not started.',v_listing.title);
    else
      return new;
    end if;
  end if;

  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,
    destination_params,event_key,workspace_scope,read,created_at
  ) values (
    v_partner_id,'property_booking',v_title,v_message,v_listing.id::text,'property_booking',new.id,
    'property_detail',jsonb_build_object('listing_id',v_listing.id::text,'reservation_id',new.id),
    'property_partner_stay:'||new.id||':'||v_stage,'partner',false,now()
  ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$function$;

revoke all on function public.notify_property_partner_reservation_lifecycle() from public,anon,authenticated;

drop trigger if exists reservations_notify_property_partner_lifecycle on public.reservations;
create trigger reservations_notify_property_partner_lifecycle
after insert or update of status,manual_payment_status,paid_at,rent_payment_status,
  rent_paid_at,requested_move_in_at,tenancy_start_date,completed_at
on public.reservations
for each row execute function public.notify_property_partner_reservation_lifecycle();

update public.notifications n
set title = 'Year 1 rent confirmed',
    message = format('Rent is confirmed for %s. WeHouse is waiting for the customer to choose a move-in time; the tenancy has not started.', l.title),
    event_key = 'property_partner_stay:' || r.id::text || ':rent_confirmed',
    workspace_scope = 'partner'
from public.reservations r
join public.listings l
  on l.id::text = r.listing_id or l.listing_id = r.listing_id
where n.type = 'property_booking'
  and n.source_id = r.id::text
  and n.title in ('Tenant ready for move-in', 'Tenancy ready for handover')
  and r.requested_move_in_at is null;
