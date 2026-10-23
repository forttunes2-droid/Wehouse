begin;
-- Reuse the established provider/ledger/shared-payment authority for access.
create or replace function public.get_my_stay_arrival_instructions(p_kind text,p_booking_id text)
returns text language plpgsql stable security definer set search_path='pg_catalog','public' as $function$
declare actor text:=public.current_profile_user_id(); asset text; r public.reservations; decision jsonb;
begin
 if actor is null or not public._property_document_session_active() then return null; end if;
 if p_kind='home' then
  select * into r from public.reservations where id=p_booking_id and user_id=actor;
  if r.id is null or r.status not in ('ready_for_move_in','occupied','completed') then return null; end if;
  decision:=public.accommodation_access_authorization(
    r.id,r.listing_id,r.user_id,r.stay_type,r.status,r.manual_payment_status,r.paid_at,
    r.rent_payment_status,r.rent_paid_at,r.rent_payment_reference,r.stay_payment_protection_id,
    r.year_one_rent_protection_id,r.shared_payment_group_id,
    case when r.stay_type='short_let' then r.stay_rent_total else coalesce(r.upfront_rent_required,r.annual_rent_snapshot) end,'location');
  if not coalesce((decision->>'authorized')::boolean,false) then return null; end if;
  select id::text into asset from public.listings where id::text=r.listing_id or listing_id=r.listing_id limit 1;
 elsif p_kind='hotel' then
  select b.hotel_id::text into asset from public.hotel_bookings b where b.booking_id::text=p_booking_id
    and b.user_id=actor and b.payment_status='paid' and b.status not in ('cancelled','expired','refunded','payment_conflict');
 else return null;
 end if;
 return (select instructions from public.property_arrival_instructions where asset_kind=p_kind and asset_id=asset);
end $function$;
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

  -- Scoped Team Activity is already produced by the reservation trigger.
  -- The authorised host receives the task in Hosting, not a Staff workspace.
  if v_res.management_mode_snapshot='host' then
    insert into public.notifications(recipient_id,type,title,message,read,source_type,source_id,destination_route,destination_params,workspace_scope)
    select p.user_id,'property_move_in_requested','Move-in time requested',
      'The guest chose a move-in time for '||coalesce(v_listing.title,'your property')||'.',false,
      'apartment_reservation',v_res.id,'hosting',jsonb_build_object('reservation_id',v_res.id),'hosting'
    from public.profiles p join public.property_host_assignments a on a.user_id=p.user_id
      and a.listing_id=v_listing.id and a.status='active'
    where p.user_id=v_res.responsible_host_user_id and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false);
  end if;
  return v_result;
end
$function$;
commit;
