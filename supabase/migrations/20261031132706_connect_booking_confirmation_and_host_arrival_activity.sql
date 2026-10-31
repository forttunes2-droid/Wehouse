-- Booking facts, ownership and arrival tasks share the existing Activity system.
-- This migration changes notifications/read history only; no payment, protection,
-- wallet, code credential or payout authority is replaced.
begin;

-- A Hotel has one booking for its team, while accepted paying guests open their
-- shared receipt. Reuse Activity audiences and preserve the original room record.
create function private.fanout_shared_hotel_guest_activity(p_event_id uuid,p_booking_id integer) returns void
language plpgsql security definer set search_path='' as $fn$
declare b public.hotel_bookings;g public.shared_payment_groups;e public.activity_events;event_id uuid;person record;area text;
begin
 select * into b from public.hotel_bookings where booking_id=p_booking_id;
 select * into g from public.shared_payment_groups where shared_payment_group_id=b.shared_payment_group_id and product_type='hotel';
 select * into e from public.activity_events where activity_event_id=p_event_id and subject_type='hotel_booking' and subject_id=p_booking_id::text;
 if g.shared_payment_group_id is null or e.activity_event_id is null then return;end if;
 if e.event_type='hotel.stay_confirmed' and (g.status<>'fully_paid' or b.payment_status<>'paid') then return;end if;
 select state into area from public.hotels where hotel_id=b.hotel_id;
 event_id:=private.upsert_activity_event('shared-hotel-lifecycle:'||g.shared_payment_group_id||':'||e.event_type,
  e.event_type,'shared_payment',g.shared_payment_group_id::text,g.created_by,e.title,e.summary,
  'my_reservations',jsonb_build_object('booking_id',coalesce(g.legacy_group_id,g.shared_payment_group_id)::text),e.occurred_at);
 for person in select user_id from public.shared_payment_members where shared_payment_group_id=g.shared_payment_group_id
  and invitation_state='accepted' and (e.event_type not in('hotel.stay_confirmed','hotel.checked_in','hotel.checked_out') or payment_state='paid') loop
  perform private.add_activity_audience(event_id,person.user_id,'personal','hotel',area,false);
 end loop;
end $fn$;
revoke all on function private.fanout_shared_hotel_guest_activity(uuid,integer) from public,anon,authenticated;

-- Shared tenants receive the final booking fact on their existing shared
-- booking, independently from each payment receipt and from the Partner's view.
create function private.publish_shared_home_booking_activity(p_reservation_id text,p_stage text,p_stage_key text) returns void
language plpgsql security definer set search_path='' as $fn$
declare r public.reservations;g public.shared_payment_groups;l public.listings;event_id uuid;person record;heading text;body text;
begin
 select * into r from public.reservations where id=p_reservation_id;
 select * into g from public.shared_payment_groups where shared_payment_group_id=r.shared_payment_group_id and product_type in('long_let','short_let');
 if g.shared_payment_group_id is null or p_stage='reservation_fee' then return;end if;
 select * into l from public.listings where id::text=r.listing_id or listing_id=r.listing_id limit 1;
 if p_stage in('reserved','rent_confirmed') then
  if g.status<>'fully_paid' or exists(select 1 from public.shared_payment_members where shared_payment_group_id=g.shared_payment_group_id
    and (invitation_state<>'accepted' or payment_state<>'paid')) then return;end if;
  heading:=case when g.product_type='short_let' then 'Shared stay confirmed' else 'Shared rent confirmed' end;
  body:=case when g.product_type='short_let' then format('%s is booked from %s to %s. Open your booking for arrival details.',l.title,to_char(r.stay_check_in,'DD Mon YYYY'),to_char(r.stay_check_out,'DD Mon YYYY'))
   else format('The agreed upfront rent for %s is confirmed. The organiser can choose the move-in time; tenancy starts at verified handover.',l.title) end;
 elsif p_stage='move_in_scheduled' then
  heading:='Shared move-in time selected';
  body:=format('Move-in for %s is planned for %s (Africa/Lagos). %s will confirm handover at the property.',l.title,
   to_char(timezone('Africa/Lagos',r.requested_move_in_at),'DD Mon YYYY, HH12:MI AM'),
   case when r.management_mode_snapshot='host' then 'Your assigned Host' else 'WeHouse Property Operations' end);
 elsif p_stage in('occupied','checkin') then
  heading:=case when g.product_type='short_let' then 'Your shared stay has started' else 'Your shared tenancy has started' end;
  body:=format('Arrival and handover were recorded for %s. Open the booking for your current stay and Payment Protection details.',l.title);
 elsif p_stage in('completed','checkout') then
  heading:=case when g.product_type='short_let' then 'Your shared stay has ended' else 'Your shared tenancy has ended' end;
  body:=format('Departure was recorded for %s. Any deposit or payment review follows the saved booking terms.',l.title);
 elsif p_stage in('cancelled','expired','refunded','payment_conflict') then
  heading:=case p_stage when 'cancelled' then 'Shared booking cancelled' when 'expired' then 'Shared booking hold expired'
   when 'refunded' then 'Shared booking refund updated' else 'Shared booking payment needs review' end;
  body:=format('%s: open the shared booking for each person’s recorded payments, refunds and next steps.',l.title);
 else return;end if;
 event_id:=private.upsert_activity_event('shared-home-lifecycle:'||g.shared_payment_group_id||':'||p_stage_key,
  'reservation.'||p_stage,'shared_payment',g.shared_payment_group_id::text,g.created_by,heading,body,'my_reservations',
  jsonb_build_object('booking_id',coalesce(g.legacy_group_id,g.shared_payment_group_id)::text),coalesce(r.updated_at,now()));
 for person in select user_id from public.shared_payment_members where shared_payment_group_id=g.shared_payment_group_id and invitation_state='accepted'
  and (p_stage<>'move_in_scheduled' or user_id<>r.user_id) loop
  perform private.add_activity_audience(event_id,person.user_id,'personal','property',l.state,false);
 end loop;
end $fn$;
revoke all on function private.publish_shared_home_booking_activity(text,text,text) from public,anon,authenticated;

create or replace function public.notify_property_partner_reservation_lifecycle() returns trigger
language plpgsql security definer set search_path='pg_catalog','public','private' as $fn$
declare l public.listings;partner_id text;stage text;stage_key text;heading text;body text;
 short boolean:=coalesce(new.stay_type,'long_stay')='short_let';host_managed boolean:=coalesce(new.management_mode_snapshot,'wehouse')='host';
begin
 select * into l from public.listings where id::text=new.listing_id or listing_id=new.listing_id limit 1;
 if l.id is null then return new;end if;
 partner_id:=coalesce(l.partner_id,l.owner_id);
 if new.status in('cancelled','expired','refunded','payment_conflict') and tg_op='UPDATE' and old.status is distinct from new.status then
  if (host_managed and coalesce(new.paid_at,new.reservation_fee_paid_at,new.rent_paid_at) is null) or (not host_managed and new.rent_paid_at is null) then return new;end if;
  stage:=new.status;
  heading:=case stage when 'cancelled' then 'Home booking cancelled' when 'expired' then 'Home reservation hold expired'
   when 'refunded' then 'Home booking refund updated' else 'Home booking payment needs review' end;
  body:=format('%s: open the reservation for the recorded status, payments and next steps.',l.title);
 elsif host_managed and new.manual_payment_status in('paid','completed') and new.paid_at is not null
  and coalesce(new.rent_payment_status,'not_started') not in('paid','upfront_paid')
  and (tg_op='INSERT' or old.manual_payment_status is distinct from new.manual_payment_status or old.paid_at is distinct from new.paid_at) then
  stage:='reservation_fee';heading:='Reservation fee confirmed';
  body:=format('%s has a paid reservation hold. The remaining accommodation payment must be confirmed before arrival.',l.title);
 elsif short then
  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
   stage:='checkout';heading:='Guest checked out';
   body:=format('Departure was recorded for %s on %s. Any deposit review follows the saved booking terms.',l.title,to_char(new.stay_check_out,'DD Mon YYYY'));
  elsif new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status) then
   stage:='checkin';heading:='Guest checked in';body:=format('A guest entered %s on %s for the booked stay.',l.title,to_char(new.stay_check_in,'DD Mon YYYY'));
  elsif new.rent_payment_status='paid' and new.rent_paid_at is not null
   and (tg_op='INSERT' or old.rent_payment_status is distinct from new.rent_payment_status or old.rent_paid_at is distinct from new.rent_paid_at) then
   stage:='reserved';heading:='Short Let booked';
   body:=format('%s is booked from %s to %s. %s will confirm guest arrival.',l.title,to_char(new.stay_check_in,'DD Mon YYYY'),to_char(new.stay_check_out,'DD Mon YYYY'),
    case when host_managed then 'The assigned property Host' else 'WeHouse Property Operations' end);
  else return new;end if;
 else
  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
   stage:='completed';heading:='Tenancy completed';body:=format('The tenancy at %s has ended.',l.title);
  elsif new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status) then
   stage:='occupied';heading:='Tenant moved in';
   body:=format('%s confirmed the handover for %s. The tenancy is now active.',case when host_managed then 'The assigned property Host' else 'WeHouse' end,l.title);
  elsif new.status='ready_for_move_in' and new.rent_payment_status in('paid','upfront_paid') and new.rent_paid_at is not null
   and new.requested_move_in_at is not null and (tg_op='INSERT' or old.requested_move_in_at is distinct from new.requested_move_in_at) then
   stage:='move_in_scheduled';heading:='Move-in time selected';
   body:=format('The customer selected %s (Africa/Lagos) for %s. %s will verify handover at the property.',
    to_char(timezone('Africa/Lagos',new.requested_move_in_at),'DD Mon YYYY, HH12:MI AM'),l.title,
    case when host_managed then 'The assigned property Host' else 'WeHouse Property Operations' end);
  elsif new.rent_payment_status in('paid','upfront_paid') and new.rent_paid_at is not null
   and (tg_op='INSERT' or old.rent_payment_status is distinct from new.rent_payment_status or old.rent_paid_at is distinct from new.rent_paid_at) then
   stage:='rent_confirmed';heading:='Rent confirmed';
   body:=format('The required upfront rent for %s is confirmed. %s is waiting for the customer to choose a move-in time; the tenancy has not started.',l.title,
    case when host_managed then 'The assigned property Host' else 'WeHouse' end);
  else return new;end if;
 end if;
 stage_key:=stage||case when stage='move_in_scheduled' then ':'||new.requested_move_in_at::text||':'||coalesce(new.move_in_requested_at,new.updated_at,now())::text else '' end;
 if partner_id is not null then
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope,read,created_at)
  values(partner_id,'property_booking',heading,body,l.id::text,'property_booking',new.id,'property_detail',
   jsonb_build_object('listing_id',l.id::text,'reservation_id',new.id),'property_partner_stay:'||new.id||':'||stage_key,'partner',false,now())
  on conflict(recipient_id,event_key) where event_key is not null do nothing;
 end if;
 if host_managed and new.responsible_host_user_id is not null and new.responsible_host_user_id is distinct from partner_id
  and exists(select 1 from public.property_host_assignments a join public.profiles p on p.user_id=a.user_id
   where a.listing_id=l.id and a.user_id=new.responsible_host_user_id and a.status='active'
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope,read,created_at)
  values(new.responsible_host_user_id,'property_booking',heading,body,l.id::text,'property_booking',new.id,'hosting',
   jsonb_build_object('listing_id',l.id::text,'reservation_id',new.id),'property_host_stay:'||new.id||':'||stage_key,'hosting',false,now())
  on conflict(recipient_id,event_key) where event_key is not null do nothing;
 end if;
 perform private.publish_shared_home_booking_activity(new.id,stage,stage_key);
 return new;
end $fn$;

CREATE OR REPLACE FUNCTION public.notify_reservation_operations_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_listing public.listings;
  v_event_id uuid;
  v_status_changed boolean:=true;
  v_move_in_changed boolean:=true;
begin
  if tg_op='UPDATE' then
    v_status_changed:=old.status is distinct from new.status;
    v_move_in_changed:=old.requested_move_in_at is distinct from new.requested_move_in_at;
  end if;
  select * into v_listing
  from public.listings listing
  where listing.id::text=new.listing_id or listing.listing_id=new.listing_id
  limit 1;
  if v_listing is null then return new; end if;

  if new.status<>'inspection_pending' then
    perform private.resolve_subject_activity(
      'reservation',new.id,'reservation.inspection_coordination','property_operations'
    );
  end if;
  if new.status<>'payment_conflict' then
    perform private.resolve_subject_activity(
      'reservation',new.id,'reservation.payment_conflict','finance_operations'
    );
  end if;
  if new.management_mode_snapshot='host'
     or new.requested_move_in_at is null
     or new.verified_handover_at is not null
     or new.status in ('occupied','completed','cancelled','refunded') then
    perform private.resolve_subject_activity(
      'reservation',new.id,'reservation.move_in_requested','property_operations'
    );
  end if;

  if new.status='inspection_pending' and v_status_changed then
    v_event_id:=private.upsert_activity_event(
      'operations_reservation:'||new.id||':inspection_pending',
      'reservation.inspection_coordination',
      'reservation',new.id,new.user_id,
      'Inspection request needs coordination',
      coalesce(v_listing.title,'Apartment')||' · assign or continue the requested visit.',
      'operations_bookings',
      jsonb_build_object(
        'reservation_id',new.id,'listing_id',v_listing.id::text,
        'workflow_state','inspection_pending'
      ),
      coalesce(new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'property_operations',v_listing.state,v_listing.city,true
    );
  end if;

  if new.status='payment_conflict' and v_status_changed then
    v_event_id:=private.upsert_activity_event(
      'operations_reservation:'||new.id||':payment_conflict',
      'reservation.payment_conflict',
      'reservation',new.id,new.user_id,
      'Reservation payment needs review',
      coalesce(v_listing.title,'Apartment')||' · payment must be reviewed before this reservation can continue.',
      'operations_bookings',
      jsonb_build_object(
        'reservation_id',new.id,'listing_id',v_listing.id::text,
        'workflow_state','payment_conflict'
      ),
      coalesce(new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'finance_operations',v_listing.state,v_listing.city,true
    );
  end if;

  if coalesce(new.management_mode_snapshot,'wehouse')<>'host'
     and new.requested_move_in_at is not null
     and new.verified_handover_at is null
     and v_move_in_changed then
    v_event_id:=private.upsert_activity_event(
      'operations_reservation:'||new.id||':move_in_requested:'||new.requested_move_in_at::text,
      'reservation.move_in_requested',
      'reservation',new.id,new.user_id,
      'Customer selected a move-in time',
      coalesce(v_listing.title,'Apartment')||' · prepare the verified handover.',
      'operations_bookings',
      jsonb_build_object(
        'reservation_id',new.id,'listing_id',v_listing.id::text,
        'requested_move_in_at',new.requested_move_in_at
      ),
      coalesce(new.move_in_requested_at,new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'property_operations',v_listing.state,v_listing.city,true
    );
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.request_my_apartment_move_in(p_reservation_id text, p_requested_at timestamp with time zone)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
  decision jsonb;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id for update;
  if v_res is null then raise exception 'Apartment reservation not found'; end if;
  if coalesce(v_res.stay_type,'long_stay')<>'long_stay' then
    raise exception 'Use the reserved check-in time for a Short Let';
  end if;
  if v_res.status<>'ready_for_move_in'
     or v_res.rent_payment_status not in ('paid','upfront_paid')
     or v_res.rent_paid_at is null then
    raise exception 'Verified Year 1 rent is required before choosing move-in';
  end if;
  if p_requested_at is null
     or p_requested_at<now()-interval '15 minutes'
     or p_requested_at>now()+interval '3 days' then
    raise exception 'Choose a move-in time within the next 3 days';
  end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing is null then raise exception 'Apartment listing not found'; end if;
  decision:=public.accommodation_access_authorization(
    v_res.id,v_res.listing_id,v_res.user_id,v_res.stay_type,v_res.status,v_res.manual_payment_status,v_res.paid_at,
    v_res.rent_payment_status,v_res.rent_paid_at,v_res.rent_payment_reference,v_res.stay_payment_protection_id,
    v_res.year_one_rent_protection_id,v_res.shared_payment_group_id,coalesce(v_res.upfront_rent_required,v_res.annual_rent_snapshot),'handover');
  if not coalesce((decision->>'authorized')::boolean,false) then raise exception 'Verified protected rent is required before choosing move-in'; end if;
  if v_res.requested_move_in_at is not distinct from p_requested_at then return v_res; end if;
  update public.reservations
  set requested_move_in_at=p_requested_at,move_in_requested_at=now(),
      updated_at=now()
  where id=v_res.id returning * into v_result;
  insert into public.notifications(
    recipient_id,type,title,message,read,source_type,source_id,
    destination_route,destination_params,workspace_scope
  ) values(
    v_actor.user_id,'move_in_request_saved','Move-in time sent',
    case when v_res.management_mode_snapshot='host' then 'Your property host received your preferred arrival time. Your tenancy has not started yet.' else 'Property Operations received your preferred arrival time. Your tenancy has not started yet.' end,
    false,'apartment_reservation',v_res.id,'my_reservations',
    jsonb_build_object('reservation_id',v_res.id),'personal'
  );

  -- Owner/Host booking notices are emitted once by the reservation lifecycle trigger.
  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION public.notify_shared_housing_member_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  group_row public.shared_housing_groups;
  listing_title text;
  actor_name text;
  member_name text;
  label text;
begin
  select * into group_row from public.shared_housing_groups where id=new.group_id;
  select title into listing_title from public.listings where id=group_row.listing_id;
  if group_row.product_type='hotel' then
    select concat_ws(' · ',h.name,r.room_type) into listing_title from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
     join public.hotel_rooms r on r.room_id=b.room_id where b.booking_id=group_row.hotel_booking_id;
  end if;
  label:=case group_row.product_type when 'hotel' then 'Shared Hotel' when 'short_let' then 'Shared stay' else 'Shared home' end;
  select coalesce(full_name, username, 'WeHouse member') into actor_name
    from public.profiles where user_id=coalesce(group_row.created_by,new.user_id);

  select coalesce(nullif(btrim(full_name),''),nullif(btrim(username),''),'Your connection') into member_name
    from public.profiles where user_id=new.user_id;

  if tg_op='INSERT' and new.invitation_status='invited' then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    ) values (
      new.user_id,'shared_home_invite',label||' invitation',
      actor_name||' invited you to share '||coalesce(listing_title,'the booking')||'.',
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_invite:'||new.group_id::text||':'||new.user_id
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  elsif tg_op='UPDATE' and new.invitation_status is distinct from old.invitation_status
    and new.invitation_status in ('accepted','declined') then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    ) values (
      group_row.created_by,'shared_home_response',
      case when new.invitation_status='accepted' then label||' accepted' else label||' declined' end,
      case when new.invitation_status='accepted'
        then member_name||' accepted the invitation for '||coalesce(listing_title,'the booking')||'.'
        else member_name||' declined the invitation for '||coalesce(listing_title,'the booking')||'.' end,
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_response:'||new.group_id::text||':'||new.user_id||':'||new.invitation_status
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  elsif tg_op='UPDATE' and new.payment_status='paid'
    and old.payment_status is distinct from 'paid' then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select member.user_id,'shared_home_payment','Booking share confirmed',
      member_name||' paid their share for '||coalesce(listing_title,'the booking')||'. Open the booking to see what is paid and what remains.',
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_payment:'||new.group_id::text||':'||new.id::text
    from public.shared_housing_members member
    where member.group_id=new.group_id and member.user_id<>new.user_id and member.invitation_status='accepted'
    on conflict (recipient_id,event_key) where event_key is not null do nothing;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_hotel_booking_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_hotel public.hotels;
  v_event_id uuid;
begin
  select * into v_hotel from public.hotels where hotel_id=new.hotel_id;
  if v_hotel.hotel_id is null then return new; end if;

  if new.status='confirmed' and new.payment_status='paid'
     and (tg_op='INSERT'
       or old.status is distinct from new.status
       or old.payment_status is distinct from new.payment_status) then
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':confirmed',
      'hotel.stay_confirmed',
      'hotel_booking',new.booking_id::text,new.user_id,
      'Hotel stay confirmed',
      v_hotel.name||' · '||to_char(new.check_in,'Mon DD')||' to '||to_char(new.check_out,'Mon DD')||'.',
      'hotel_booking',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      coalesce(new.updated_at,new.created_at,now())
    );
    if new.shared_payment_group_id is null then
      perform private.add_activity_audience(v_event_id,new.user_id,'personal','hotel',v_hotel.state,false);
    else
      perform private.fanout_shared_hotel_guest_activity(v_event_id,new.booking_id);
    end if;
    if v_hotel.owner_id is not null then
      perform private.add_activity_audience(
        v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,false
      );
    end if;
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,true);
    return new;
  end if;

  if tg_op='UPDATE' and new.status is distinct from old.status
     and new.status in ('checked_in','checked_out') then
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':'||new.status,
      case when new.status='checked_in'
        then 'hotel.checked_in' else 'hotel.checked_out' end,
      'hotel_booking',new.booking_id::text,new.user_id,
      case when new.status='checked_in'
        then 'Hotel check-in completed' else 'Hotel checkout completed' end,
      case when new.status='checked_in'
        then 'Guest checked in at '||v_hotel.name||'.'
        else 'Guest checked out of '||v_hotel.name||'.' end,
      'hotel_booking',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      coalesce(new.updated_at,now())
    );
    if new.shared_payment_group_id is null then
      perform private.add_activity_audience(v_event_id,new.user_id,'personal','hotel',v_hotel.state,false);
    else
      perform private.fanout_shared_hotel_guest_activity(v_event_id,new.booking_id);
    end if;
    if v_hotel.owner_id is not null then
      perform private.add_activity_audience(v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,false);
    end if;
    perform private.resolve_subject_activity('hotel_booking',new.booking_id::text,'hotel.stay_confirmed','hotel');
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,false);
  end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('cancelled','expired','refunded','payment_conflict') then
    perform private.resolve_subject_activity('hotel_booking',new.booking_id::text,'hotel.stay_confirmed','hotel');
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':'||new.status,'hotel.'||new.status,'hotel_booking',new.booking_id::text,new.user_id,
      case new.status when 'cancelled' then 'Hotel stay cancelled' when 'expired' then 'Hotel payment hold expired' when 'refunded' then 'Hotel payment refunded' else 'Hotel payment needs review' end,
      v_hotel.name||' · '||to_char(new.check_in,'Mon DD')||' to '||to_char(new.check_out,'Mon DD'),
      'hotel_booking',jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),coalesce(new.updated_at,now())
    );
    if new.shared_payment_group_id is null then
      perform private.add_activity_audience(v_event_id,new.user_id,'personal','hotel',v_hotel.state,false);
    else
      perform private.fanout_shared_hotel_guest_activity(v_event_id,new.booking_id);
    end if;
    if v_hotel.owner_id is not null then perform private.add_activity_audience(v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,new.status='payment_conflict'); end if;
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,new.status='payment_conflict');
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_my_property_partner_stays(p_listing_id text DEFAULT NULL::text, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id text DEFAULT NULL::text, p_limit integer DEFAULT 51, p_reservation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_limit is null or p_limit<1 or p_limit>51 then raise exception 'Page size must be between 1 and 51';end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'Complete reservation cursor required';end if;
  if p_reservation_id is not null and (length(btrim(p_reservation_id)) not between 1 and 128 or p_before_id is not null) then raise exception 'Invalid reservation target';end if;
  if p_listing_id is not null and length(btrim(p_listing_id)) not between 1 and 128 then raise exception 'Invalid property target';end if;
  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.page_created_at desc,stay.reservation_id desc),'[]'::jsonb)
  into v_result from (
    select r.id reservation_id,coalesce(r.stay_type,'long_stay') stay_type,r.status,
      r.rent_payment_status payment_status,r.manual_payment_status,
      r.reservation_fee_status,r.reservation_fee_snapshot,r.reservation_fee_paid_at,
      r.rent_paid_at,r.stay_check_in check_in,r.stay_check_out check_out,r.stay_nights nights,
      coalesce(r.guest_count,1) guest_count,r.requested_move_in_at,r.move_in_requested_at,
      r.tenancy_start_date,r.tenancy_end_date,r.created_at,coalesce(r.created_at,timestamptz '1970-01-01 00:00:00+00') page_created_at,
      r.management_mode_snapshot,r.responsible_host_user_id,
      l.id::text listing_id,l.listing_id public_listing_code,l.title listing_title,
      a.assignment_role,
      case when a.assignment_role='owner' then 'full_hosting' else a.access_level end access_level
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id and a.user_id=v_actor and a.status='active'
    where (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and(p_reservation_id is null or r.id=p_reservation_id)
      and(p_before_created_at is null or (coalesce(r.created_at,timestamptz '1970-01-01 00:00:00+00'),r.id)<(p_before_created_at,p_before_id))
      and public.current_actor_can_manage_property(l.id)
      and (
        (r.management_mode_snapshot='host'
          and (a.assignment_role='owner' or r.responsible_host_user_id=v_actor)
          and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed') or r.reservation_fee_paid_at is not null or r.paid_at is not null))
        or (r.management_mode_snapshot='wehouse' and a.assignment_role='owner'
          and (r.rent_paid_at is not null or (coalesce(r.stay_type,'long_stay')='short_let'
            and ((r.rent_payment_status='paid' and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))
          or (coalesce(r.stay_type,'long_stay')<>'short_let'
            and ((r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))))
      )
    order by coalesce(r.created_at,timestamptz '1970-01-01 00:00:00+00') desc,r.id desc limit case when p_reservation_id is null then p_limit else 1 end
  ) stay;
  return v_result;
end
$function$;

-- Expand the canonical check-in row; a single composite column loses its fields.
CREATE OR REPLACE FUNCTION public.confirm_short_stay_check_in_by_code(p_booking_code text, p_check_in_date date DEFAULT (timezone('Africa/Lagos'::text, now()))::date)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_verified jsonb; v_result public.reservations;
begin
  v_verified:=public.verify_branch_booking_code(p_booking_code);
  if v_verified is null
    or v_verified->>'kind'<>'housing'
    or v_verified->>'stay_type'<>'short_let'
  then
    raise exception 'Enter a valid Short Let booking code';
  end if;
  if coalesce((v_verified->>'can_check_in')::boolean,false) is not true then
    raise exception 'Check-in requires verified stay payment and arrival within the booked dates';
  end if;
  select * into v_result from public.activate_short_stay(v_verified->>'reservation_id',p_check_in_date);
  return v_result;
end;
$function$;
-- A solo Creator can perform the Field handover task as the same identity.
-- This grants no Staff role, and ordinary candidates still need current scoped
-- Staff + Field Operations access; a Field-only suspension remains effective.
create function private.can_assign_handover_officer(p_candidate text,p_state text,p_lga text) returns boolean
language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.profiles p where p.user_id=p_candidate
  and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  and ((p.user_id=public.current_profile_user_id() and public.user_has_active_workspace(p.user_id,'creator'))
   or (public.user_has_active_workspace(p.user_id,'staff') and public.user_has_active_workspace(p.user_id,'field_operations')
    and public.user_workspace_covers(p.user_id,'field_operations',p_state,p_lga))))
$fn$;
revoke all on function private.can_assign_handover_officer(text,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_reservation_handover_assignment(p_reservation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_case public.partner_support_conversations;
  v_candidates jsonb;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;

  select * into v_res from public.reservations where id=p_reservation_id;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Reservation is outside your assigned State/LGA';
  end if;

  select * into v_case from public.partner_support_conversations c
  where c.context_type='apartment_reservation' and c.context_id=v_res.id
  order by c.updated_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,
    'name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id),
    'username',p.username,
    'is_creator_self',p.user_id=v_actor.user_id and public.user_has_active_workspace(p.user_id,'creator')
  ) order by coalesce(p.full_name,p.username,p.user_id)),'[]'::jsonb)
  into v_candidates
  from public.profiles p
  where not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and private.can_assign_handover_officer(p.user_id,v_listing.state,v_listing.city);

  return jsonb_build_object(
    'conversation_id',v_case.id,
    'assigned_field_officer_id',coalesce(v_res.handover_field_officer_id,v_case.assigned_field_officer_id),
    'assigned_field_officer_name',(
      select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id)
      from public.profiles p
      where p.user_id=coalesce(v_res.handover_field_officer_id,v_case.assigned_field_officer_id)
    ),
    'candidates',v_candidates
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_reservation_field_officer(p_reservation_id text, p_field_officer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_officer public.profiles;
  v_case public.partner_support_conversations;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;

  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Reservation is outside your assigned State/LGA';
  end if;

  select * into v_officer
  from public.profiles p
  where p.user_id=p_field_officer_id
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and private.can_assign_handover_officer(p.user_id,v_listing.state,v_listing.city)
  limit 1;
  if v_officer.user_id is null then raise exception 'Choose an active Field Operations member whose coverage includes this property'; end if;

  select * into v_case from public.partner_support_conversations c
  where c.context_type='apartment_reservation' and c.context_id=v_res.id
  order by c.updated_at desc limit 1 for update;
  if v_case.id is null then
    raise exception 'The Property Operations conversation is missing for this reservation';
  end if;

  update public.partner_support_conversations
  set assigned_field_officer_id=v_officer.user_id,
      assigned_staff_id=coalesce(assigned_staff_id,v_actor.user_id),
      status=case when status='open' then 'assigned' else status end,
      channel_kind='property_operations',updated_at=now()
  where id=v_case.id;

  update public.reservations
  set handover_field_officer_id=v_officer.user_id,
      handover_conversation_id=v_case.id,updated_at=now()
  where id=v_res.id;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at,is_read,visibility
  ) values (
    v_case.id,v_actor.user_id,'system',
    coalesce(nullif(btrim(v_officer.full_name),''),nullif(btrim(v_officer.username),''),v_officer.user_id)||
      ' joined as Field Operations for the move-in handover. Property Operations remains responsible for this case.',
    'field_officer_assigned',jsonb_build_object('officer_id',v_officer.user_id,'reservation_id',v_res.id),now(),false,'customer'
  );

  insert into public.notifications(
    recipient_id,type,title,message,read,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values (
    v_officer.user_id,'reservation_handover_assigned','Move-in handover assigned',
    coalesce(v_listing.title,'Apartment')||' · '||coalesce(nullif(btrim(v_actor.full_name),''),'Property Operations')||' assigned you to the existing reservation conversation.',
    false,v_res.id,'apartment_reservation',v_res.id,'conversation',
    jsonb_build_object('conversation_id',v_case.id,'reservation_id',v_res.id,'listing_id',v_listing.id),
    'handover-assignment:'||v_res.id||':'||v_officer.user_id||':'||extract(epoch from now())::bigint,
    case when v_officer.user_id=v_actor.user_id and v_actor.role='creator' then 'creator' else 'staff' end
  );

  return jsonb_build_object(
    'conversation_id',v_case.id,
    'assigned_field_officer_id',v_officer.user_id,
    'assigned_field_officer_name',coalesce(nullif(btrim(v_officer.full_name),''),nullif(btrim(v_officer.username),''),v_officer.user_id)
  );
end;
$function$;
commit;
