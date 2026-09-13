-- D-006 / H-005: Short Let publication is not occupancy.
--
-- Long Let keeps the existing listing-wide reservation/occupancy model because
-- one tenancy consumes the whole listing. Short Let availability is derived from
-- reservation date overlap. A Short Let check-in must therefore never make the
-- published listing globally reserved/occupied or hide otherwise free dates.

update public.listings
set status='available',
    availability_status='available',
    reserved_by=null,
    reservation_expiry=null,
    occupied_by=null,
    occupied_at=null,
    tenancy_ends_at=null,
    current_reservation_id=null,
    updated_at=now()
where sub_type='short_let'
  and deleted_at is null
  and inspection_request_id is not null
  and approved_at is not null
  and status in ('reserved','occupied');

create or replace function public.sync_listing_lifecycle()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(new.sub_type,'')='short_let' then
    if tg_op='INSERT' then
      new.status:=coalesce(new.status,new.availability_status,'pending_approval');
      if new.status in ('reserved','occupied') then new.status:='available'; end if;
      new.availability_status:=new.status;
    elsif new.status is distinct from old.status then
      if new.status in ('reserved','occupied') then
        raise exception 'Short Let occupancy is date-based and cannot change the listing-wide status';
      end if;
      new.availability_status:=new.status;
    elsif new.availability_status is distinct from old.availability_status then
      if new.availability_status in ('reserved','occupied') then
        raise exception 'Short Let occupancy is date-based and cannot change the listing-wide availability status';
      end if;
      new.status:=new.availability_status;
    end if;
  else
    if tg_op='INSERT' then
      new.status:=coalesce(new.status,new.availability_status,'pending_approval');
      new.availability_status:=new.status;
    elsif new.status is distinct from old.status then
      new.availability_status:=new.status;
    elsif new.availability_status is distinct from old.availability_status then
      new.status:=new.availability_status;
    end if;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create or replace function public.get_discoverable_listings()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(
    (to_jsonb(l)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',null,
      'gps_latitude',case when l.gps_latitude is null then null else round(l.gps_latitude,2) end,
      'gps_longitude',case when l.gps_longitude is null then null else round(l.gps_longitude,2) end,
      'location_exact',false,
      'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
  where l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
    and l.status='available'
    and l.availability_status='available'
$$;

create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_listing public.listings; v_actor public.profiles; v_partner_name text;
  v_internal boolean:=false; v_paid boolean:=false;
begin
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id) and l.deleted_at is null limit 1;
  if v_listing.id is null then return null; end if;
  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),'')) into v_partner_name
  from public.profiles p where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is not null then
    v_internal:=v_listing.owner_id=v_actor.user_id or v_listing.partner_id=v_actor.user_id or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations') and public.current_actor_in_scope(v_listing.state,v_listing.city));
    v_paid:=exists(select 1 from public.reservations r where r.user_id=v_actor.user_id
      and r.listing_id in (v_listing.id::text,v_listing.listing_id)
      and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
      and r.status not in ('cancelled','expired'));
  end if;
  if not v_internal and not (v_listing.status='available' and v_listing.availability_status='available') then return null; end if;
  if v_internal then return to_jsonb(v_listing)||jsonb_build_object('location_exact',true,'partner_display_name',v_partner_name); end if;
  return (to_jsonb(v_listing)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',case when v_paid then v_listing.address else null end,
      'gps_latitude',case when v_listing.gps_latitude is null then null when v_paid then v_listing.gps_latitude else round(v_listing.gps_latitude,2) end,
      'gps_longitude',case when v_listing.gps_longitude is null then null when v_paid then v_listing.gps_longitude else round(v_listing.gps_longitude,2) end,
      'location_accuracy_m',case when v_paid then v_listing.location_accuracy_m else null end,
      'location_exact',v_paid,'partner_display_name',v_partner_name
    );
end;
$$;

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
  v_actor public.profiles; v_res public.reservations; v_listing public.listings;
  v_result public.reservations; v_payment_id uuid;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Operations permission required'; end if;
  select * into v_res from public.reservations where id=p_reservation_id and stay_type='short_let' for update;
  if v_res is null then raise exception 'Short Stay reservation not found'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id for update;
  if v_listing is null or v_listing.sub_type<>'short_let' then raise exception 'Short Stay listing not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then raise exception 'Listing is outside your assigned State/LGA'; end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available' then raise exception 'This Short Stay is not currently open for guest stays'; end if;
  if v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid' or v_res.rent_paid_at is null then raise exception 'Short Stay payment must be verified before check-in'; end if;
  if p_actual_check_in<v_res.stay_check_in or p_actual_check_in>=v_res.stay_check_out then raise exception 'Check-in must fall inside the reserved stay dates'; end if;

  if exists(
    select 1 from public.reservations r
    where r.listing_id=v_res.listing_id
      and r.id<>v_res.id
      and r.stay_type='short_let'
      and r.status='occupied'
      and daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then raise exception 'Those Short Stay dates are already occupied'; end if;

  update public.reservations
  set status='occupied',tenancy_start_date=p_actual_check_in,tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),updated_at=now()
  where id=v_res.id returning * into v_result;

  update public.listings
  set status='available',availability_status='available',reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,
      current_reservation_id=null,updated_at=now()
  where id=v_listing.id
    and status in ('reserved','occupied');

  select id into v_payment_id from public.booking_payments
  where paystack_reference=v_res.rent_payment_reference and purpose='apartment_rent' and status in ('paid','completed') limit 1;
  if v_payment_id is not null and exists(select 1 from public.property_partner_earning_releases where payment_id=v_payment_id and status='pending') then
    perform public.release_property_partner_earning(v_payment_id,'short_stay_check_in_confirmed');
  end if;
  return v_result;
end;
$$;

create or replace function public.complete_short_stay(
  p_reservation_id text,
  p_next_status text default 'available'
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_result public.reservations;
begin
  if p_next_status not in ('maintenance','available','closed') then raise exception 'Invalid next property status'; end if;
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Operations permission required'; end if;
  select * into v_res from public.reservations where id=p_reservation_id and stay_type='short_let' and status='occupied' for update;
  if v_res is null then raise exception 'Active Short Stay not found'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id for update;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then raise exception 'Listing is outside your assigned State/LGA'; end if;

  update public.reservations
  set status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),
      security_deposit_status=case when coalesce(security_deposit_snapshot,0)>0 then 'refund_due' else 'not_required' end,updated_at=now()
  where id=v_res.id returning * into v_result;

  if p_next_status in ('maintenance','closed') then
    update public.listings
    set status=p_next_status,availability_status=p_next_status,
        reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
    where id=v_listing.id;
  else
    update public.listings
    set status='available',availability_status='available',reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
    where id=v_listing.id and status in ('reserved','occupied');
  end if;
  return v_result;
end;
$$;

create or replace function public.cancel_my_apartment_reservation(p_reservation_id text)
returns public.reservations
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_user_id text; v_res public.reservations; v_result public.reservations;
begin
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_res from public.reservations where id=p_reservation_id and user_id=v_user_id for update;
  if v_res is null then raise exception 'Reservation not found'; end if;
  if v_res.status not in ('payment_pending','reserved','inspection_pending','ready_for_move_in') then raise exception 'Reservation can no longer be cancelled here'; end if;
  if v_res.manual_payment_status in ('paid','completed') or v_res.paid_at is not null then raise exception 'Paid reservations must be handled by support'; end if;
  update public.reservations set status='cancelled',processed_at=now(),updated_at=now() where id=v_res.id returning * into v_result;
  update public.booking_payments set status='cancelled',updated_at=now() where paystack_reference=v_res.payment_reference and status='pending';

  if coalesce(v_res.stay_type,'long_stay')<>'short_let' then
    update public.listings
    set status='available',availability_status='available',reserved_by=null,reservation_expiry=null,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=null,updated_at=now()
    where id::text=v_res.listing_id and current_reservation_id=v_res.id;
  else
    update public.listings
    set reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
    where id::text=v_res.listing_id and current_reservation_id=v_res.id;
  end if;
  return v_result;
end;
$$;

create or replace function public.process_reservation_refund(
  p_reservation_id text,
  p_reason_category text,
  p_reason_detail text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_calc record; v_actor public.profiles;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('admin','creator')
    and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
  if v_actor is null then raise exception 'Admin or Creator refund authority required'; end if;
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res is null then raise exception 'Reservation not found'; end if;
  if v_actor.role='admin' and not public.current_actor_can_access_listing_ref(v_res.listing_id) then raise exception 'Reservation is outside your assigned branch'; end if;
  if v_res.status='refunded' then return true; end if;
  select * into v_calc from public.calculate_reservation_refund(p_reservation_id,p_reason_category);
  insert into public.reservation_refunds(reservation_id,user_id,original_amount,refund_percent,refund_amount,wehouse_retained,reason_category,reason_detail,processed_by)
  values(v_res.id,v_res.user_id,v_res.amount,v_calc.refund_percent,v_calc.refund_amount,v_calc.wehouse_retained,p_reason_category,nullif(btrim(coalesce(p_reason_detail,'')),''),v_actor.user_id);
  update public.reservations set status='refunded',refund_amount=v_calc.refund_amount,refund_reason=p_reason_category,processed_by=v_actor.user_id,processed_at=now(),updated_at=now() where id=v_res.id;

  if coalesce(v_res.stay_type,'long_stay')<>'short_let' then
    update public.listings set availability_status='available',status='available',reserved_by=null,reservation_expiry=null,updated_at=now()
    where id::text=v_res.listing_id or listing_id=v_res.listing_id;
  else
    update public.listings set reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
    where (id::text=v_res.listing_id or listing_id=v_res.listing_id) and current_reservation_id=v_res.id;
  end if;
  return true;
end;
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
    where auth_id=auth.uid()::text and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
    if v_role<>'creator' then raise exception 'Creator or service execution required'; end if;
  end if;

  for v_row in
    select r.id,r.listing_id,r.status,r.payment_reference,coalesce(r.stay_type,'long_stay') as stay_type
    from public.reservations r
    where coalesce(r.rent_payment_status,'not_started') not in ('paid','upfront_paid')
      and ((r.status='payment_pending' and r.payment_expires_at<now())
        or (r.status in ('reserved','inspection_pending','ready_for_move_in') and r.hold_expires_at<now()))
    for update
  loop
    if v_row.status='payment_pending' and exists(
      select 1 from public.booking_payments bp
      where bp.paystack_reference=v_row.payment_reference and bp.status in ('paid','completed')
    ) then continue; end if;

    update public.reservations
    set status='expired',refund_amount=0,refund_reason='Reservation hold expired',processed_at=now(),updated_at=now()
    where id=v_row.id and coalesce(rent_payment_status,'not_started') not in ('paid','upfront_paid');
    if not found then continue; end if;

    update public.booking_payments set status='expired',updated_at=now()
    where paystack_reference=v_row.payment_reference and status='pending';

    if v_row.stay_type<>'short_let' then
      update public.listings
      set status='available',availability_status='available',reserved_by=null,
          reservation_expiry=null,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=null,updated_at=now()
      where id::text=v_row.listing_id and current_reservation_id=v_row.id;
    else
      update public.listings
      set reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
      where id::text=v_row.listing_id and current_reservation_id=v_row.id;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

comment on function public.get_short_stay_unavailable_listing_ids(date,date)
is 'Returns Short Let listings whose requested date range overlaps an active hold/stay. Publication and current occupancy do not alter future-date discovery.';
