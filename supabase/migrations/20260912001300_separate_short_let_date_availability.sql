-- Short Let publication is a listing concern; Short Let availability and occupancy
-- are date-interval concerns. A reservation for one date range must not hide a
-- published property from other sellable dates. Long Let keeps its existing
-- listing-wide reservation/occupancy behaviour.

-- ---------------------------------------------------------------------------
-- Public discovery/detail: approved Short Lets remain published unless an
-- explicit administrative state makes the property unavailable globally.
-- ---------------------------------------------------------------------------
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
    and (
      (l.sub_type='short_let' and coalesce(l.status,'available') not in ('maintenance','closed','rejected','pending_approval'))
      or
      (coalesce(l.sub_type,'long_stay')<>'short_let' and l.status='available')
    )
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
  v_internal boolean:=false; v_paid boolean:=false; v_public boolean:=false;
begin
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
  into v_partner_name
  from public.profiles p
  where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=v_listing.owner_id=v_actor.user_id
      or v_listing.partner_id=v_actor.user_id
      or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations') and public.current_actor_in_scope(v_listing.state,v_listing.city));
    v_paid:=exists(
      select 1
      from public.reservations r
      where r.user_id=v_actor.user_id
        and r.listing_id in (v_listing.id::text,v_listing.listing_id)
        and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
        and r.status not in ('cancelled','expired')
    );
  end if;

  v_public:=v_listing.inspection_request_id is not null
    and v_listing.approved_at is not null
    and (
      (v_listing.sub_type='short_let' and coalesce(v_listing.status,'available') not in ('maintenance','closed','rejected','pending_approval'))
      or
      (coalesce(v_listing.sub_type,'long_stay')<>'short_let' and v_listing.status='available')
    );

  if not v_internal and not v_public then return null; end if;
  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object('location_exact',true,'partner_display_name',v_partner_name);
  end if;

  return (to_jsonb(v_listing)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',case when v_paid then v_listing.address else null end,
      'gps_latitude',case when v_listing.gps_latitude is null then null when v_paid then v_listing.gps_latitude else round(v_listing.gps_latitude,2) end,
      'gps_longitude',case when v_listing.gps_longitude is null then null when v_paid then v_listing.gps_longitude else round(v_listing.gps_longitude,2) end,
      'location_accuracy_m',case when v_paid then v_listing.location_accuracy_m else null end,
      'location_exact',v_paid,
      'partner_display_name',v_partner_name
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Date availability. Expired unpaid checkout attempts no longer block dates.
-- ---------------------------------------------------------------------------
create or replace function public.get_short_stay_unavailable_listing_ids(
  p_check_in date,
  p_check_out date
)
returns table(listing_id text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then
    raise exception 'Valid dates required';
  end if;

  return query
  select distinct r.listing_id
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id
  where l.sub_type='short_let'
    and r.stay_type='short_let'
    and (
      r.status in ('reserved','inspection_pending','ready_for_move_in','occupied')
      or (
        r.status='payment_pending'
        and coalesce(r.payment_expires_at,r.hold_expires_at,r.created_at+interval '30 minutes')>now()
      )
    )
    and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(p_check_in,p_check_out,'[)');
end;
$$;

-- ---------------------------------------------------------------------------
-- Reservation creation: overlap is authoritative by date, while administrative
-- listing states can still close every date.
-- ---------------------------------------------------------------------------
create or replace function public.create_short_stay_reservation(
  p_listing_id text,
  p_check_in date,
  p_check_out date
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
  v_fee numeric;
  v_checkout_minutes integer;
  v_checkout_expires timestamptz;
  v_reference text;
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_rate numeric;
  v_rent numeric;
  v_deposit numeric;
begin
  select * into v_profile
  from public.profiles
  where auth_id=auth.uid()::text
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;
  if v_profile is null then raise exception 'Authentication required'; end if;
  if v_profile.role not in ('user','worker','property_partner') then
    raise exception 'This account cannot create customer reservations';
  end if;

  select * into v_listing
  from public.listings
  where (id::text=p_listing_id or listing_id=p_listing_id)
    and deleted_at is null
    and sub_type='short_let'
  limit 1 for share;
  if v_listing is null then raise exception 'Short Stay listing not found'; end if;
  if v_listing.inspection_request_id is null or v_listing.approved_at is null
     or coalesce(v_listing.status,'available') in ('maintenance','closed','rejected','pending_approval') then
    raise exception 'This Short Stay is not bookable';
  end if;
  if p_check_in is null or p_check_out is null or p_check_in<current_date or p_check_out<=p_check_in then
    raise exception 'Choose valid future check-in and check-out dates';
  end if;

  select coalesce(nullif(value,'')::integer,1)
  into v_min_nights
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true)=true
  limit 1;
  select coalesce(nullif(value,'')::integer,90)
  into v_max_nights
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true)=true
  limit 1;
  v_min_nights:=greatest(coalesce(v_min_nights,1),1);
  v_max_nights:=greatest(coalesce(v_max_nights,90),v_min_nights);
  v_nights:=p_check_out-p_check_in;
  if v_nights<v_min_nights or v_nights>v_max_nights then
    raise exception 'Short Stay must be between % and % nights',v_min_nights,v_max_nights;
  end if;

  if exists(
    select 1
    from public.reservations r
    where r.listing_id=v_listing.id::text
      and (
        r.status in ('reserved','inspection_pending','ready_for_move_in','occupied')
        or (
          r.status='payment_pending'
          and coalesce(r.payment_expires_at,r.hold_expires_at,r.created_at+interval '30 minutes')>now()
        )
      )
      and (
        coalesce(r.stay_type,'long_stay')<>'short_let'
        or daterange(r.stay_check_in,r.stay_check_out,'[)')
           && daterange(p_check_in,p_check_out,'[)')
      )
  ) then
    raise exception 'Those Short Stay dates are no longer available';
  end if;

  v_rate:=round(coalesce(v_listing.price,0),2);
  v_deposit:=round(coalesce(v_listing.security_deposit_amount,0),2);
  if v_rate<=0 then raise exception 'Nightly rate is not configured'; end if;
  if v_deposit<=0 then raise exception 'Refundable security deposit is not configured'; end if;
  v_rent:=round(v_rate*v_nights,2);

  select nullif(value,'')::numeric into v_fee
  from public.platform_settings
  where key='reservation_fee' and coalesce(is_active,true)=true
  limit 1;
  if v_fee is null or v_fee<=0 then raise exception 'Reservation fee is not configured'; end if;

  select nullif(value,'')::integer into v_checkout_minutes
  from public.platform_settings
  where key='apartment_payment_hold_minutes' and coalesce(is_active,true)=true
  limit 1;
  if v_checkout_minutes is null or v_checkout_minutes<5 or v_checkout_minutes>120 then
    v_checkout_minutes:=30;
  end if;
  v_checkout_expires:=now()+make_interval(mins=>v_checkout_minutes);
  v_reference:='WHAPT-'||upper(replace(gen_random_uuid()::text,'-',''));

  insert into public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,listing_location,
    status,manual_payment_status,payment_reference,amount,currency,reservation_type,stay_type,
    stay_check_in,stay_check_out,stay_nights,nightly_rate_snapshot,stay_rent_total,
    security_deposit_snapshot,security_deposit_status,payment_expires_at,hold_expires_at,
    created_at,updated_at
  ) values(
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,v_listing.title,v_listing.price,
    concat_ws(', ',v_listing.city,v_listing.state),'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment','short_let',
    p_check_in,p_check_out,v_nights,v_rate,v_rent,v_deposit,'pending',v_checkout_expires,null,now(),now()
  ) returning * into v_created;

  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,
    currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) values(
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',v_listing.id::text,
    v_fee,v_fee,'NGN','pending','apartment_reservation','paystack',v_reference,
    jsonb_build_object(
      'reservation_id',v_created.id,
      'listing_id',v_listing.id::text,
      'stay_type','short_let',
      'check_in',p_check_in,
      'check_out',p_check_out,
      'source','create_short_stay_reservation'
    ),now(),now()
  );

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment verification: an expired unpaid competing hold cannot create a false
-- payment conflict. Long Let remains listing-wide and unchanged.
-- ---------------------------------------------------------------------------
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
begin
  if new.purpose<>'apartment_reservation' or new.status not in ('paid','completed') then return new; end if;
  if tg_op='UPDATE' and old.status in ('paid','completed') then return new; end if;

  select * into v_res
  from public.reservations
  where payment_reference=new.paystack_reference
  limit 1 for update;
  if v_res is null then raise exception 'Apartment reservation payment has no reservation'; end if;
  if v_res.user_id is distinct from coalesce(new.payer_user_id,new.user_id) then
    raise exception 'Apartment reservation payment owner mismatch';
  end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id
  limit 1 for update;
  if v_listing is null then raise exception 'Apartment reservation listing not found'; end if;
  v_is_short:=coalesce(v_res.stay_type,v_listing.sub_type,'long_stay')='short_let';

  if v_is_short then
    if v_listing.inspection_request_id is null or v_listing.approved_at is null
       or coalesce(v_listing.status,'available') in ('maintenance','closed','rejected','pending_approval') then
      update public.reservations
      set status='payment_conflict',manual_payment_status='paid',paid_at=coalesce(paid_at,now()),
          refund_reason='Payment completed after the property became unavailable',processed_at=now(),updated_at=now()
      where id=v_res.id;
      return new;
    end if;

    if exists(
      select 1
      from public.reservations r
      where r.listing_id=v_res.listing_id
        and r.id<>v_res.id
        and (
          r.status in ('reserved','inspection_pending','ready_for_move_in','occupied')
          or (
            r.status='payment_pending'
            and coalesce(r.payment_expires_at,r.hold_expires_at,r.created_at+interval '30 minutes')>now()
          )
        )
        and (
          coalesce(r.stay_type,'long_stay')<>'short_let'
          or daterange(r.stay_check_in,r.stay_check_out,'[)')
             && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
        )
    ) then
      update public.reservations
      set status='payment_conflict',manual_payment_status='paid',paid_at=coalesce(paid_at,now()),
          refund_reason='Payment completed after the selected dates became unavailable',processed_at=now(),updated_at=now()
      where id=v_res.id;
      return new;
    end if;
  else
    if v_listing.current_reservation_id is distinct from v_res.id and v_listing.status<>'available' then
      update public.reservations
      set status='payment_conflict',manual_payment_status='paid',paid_at=coalesce(paid_at,now()),
          refund_reason='Payment completed after the property was assigned elsewhere',processed_at=now(),updated_at=now()
      where id=v_res.id;
      return new;
    end if;
  end if;

  select nullif(value,'')::integer into v_hold_days
  from public.platform_settings
  where key='apartment_reservation_hold_days' and coalesce(is_active,true)=true
  limit 1;
  if v_hold_days is null or v_hold_days<1 or v_hold_days>30 then v_hold_days:=3; end if;
  v_hold_expires:=now()+make_interval(days=>v_hold_days);

  update public.reservations
  set status=case when status='payment_pending' then 'reserved' else status end,
      manual_payment_status='paid',paid_at=coalesce(paid_at,now()),payment_expires_at=null,
      hold_expires_at=case when v_is_short then null else v_hold_expires end,updated_at=now()
  where id=v_res.id;

  if not v_is_short then
    update public.listings
    set status='reserved',availability_status='reserved',reserved_by=v_res.user_id,
        reservation_expiry=v_hold_expires,reservation_fee_paid=true,chat_unlocked=true,
        current_reservation_id=v_res.id,updated_at=now()
    where id=v_listing.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in records the current physical occupant but does not change publication
-- or date availability globally. Another active interval is still rejected.
-- ---------------------------------------------------------------------------
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
  v_payment_id uuid;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id and stay_type='short_let'
  for update;
  if v_res is null then raise exception 'Short Stay reservation not found'; end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id
  for update;
  if v_listing is null or v_listing.sub_type<>'short_let' then
    raise exception 'Short Stay listing not found';
  end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;
  if v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid' or v_res.rent_paid_at is null then
    raise exception 'Short Stay payment must be verified before check-in';
  end if;
  if p_actual_check_in<v_res.stay_check_in or p_actual_check_in>=v_res.stay_check_out then
    raise exception 'Check-in must fall inside the reserved stay dates';
  end if;
  if coalesce(v_listing.status,'available') in ('maintenance','closed','rejected','pending_approval') then
    raise exception 'This Short Stay is not available for check-in';
  end if;
  if exists(
    select 1
    from public.reservations other
    where other.listing_id=v_res.listing_id
      and other.id<>v_res.id
      and other.status='occupied'
      and daterange(other.stay_check_in,other.stay_check_out,'[)')
          && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then
    raise exception 'Property is already occupied for these stay dates';
  end if;

  update public.reservations
  set status='occupied',tenancy_start_date=p_actual_check_in,
      tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),updated_at=now()
  where id=v_res.id
  returning * into v_result;

  update public.listings
  set occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_res.stay_check_out,
      reserved_by=null,reservation_expiry=null,current_reservation_id=v_res.id,updated_at=now()
  where id=v_listing.id;

  select id into v_payment_id
  from public.booking_payments
  where paystack_reference=v_res.rent_payment_reference
    and purpose='apartment_rent'
    and status in ('paid','completed')
  limit 1;
  if v_payment_id is not null
     and exists(
       select 1
       from public.property_partner_earning_releases
       where payment_id=v_payment_id and status='pending'
     ) then
    perform public.release_property_partner_earning(v_payment_id,'short_stay_check_in_confirmed');
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout clears only the interval's occupancy pointer. Normal completion does
-- not unpublish the Short Let. Maintenance/closed are explicit global blocks.
-- ---------------------------------------------------------------------------
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
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
begin
  if p_next_status not in ('maintenance','available','closed') then
    raise exception 'Invalid next property status';
  end if;

  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id and stay_type='short_let' and status='occupied'
  for update;
  if v_res is null then raise exception 'Active Short Stay not found'; end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id
  for update;
  if v_listing is null then raise exception 'Short Stay listing not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;

  update public.reservations
  set status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),
      security_deposit_status=case
        when coalesce(security_deposit_snapshot,0)>0 then 'refund_due'
        else 'not_required'
      end,
      updated_at=now()
  where id=v_res.id
  returning * into v_result;

  if p_next_status in ('maintenance','closed') then
    update public.listings
    set status=p_next_status,availability_status=p_next_status,
        occupied_by=case when current_reservation_id=v_res.id then null else occupied_by end,
        occupied_at=case when current_reservation_id=v_res.id then null else occupied_at end,
        tenancy_ends_at=case when current_reservation_id=v_res.id then null else tenancy_ends_at end,
        current_reservation_id=case when current_reservation_id=v_res.id then null else current_reservation_id end,
        updated_at=now()
    where id=v_listing.id;
  else
    update public.listings
    set status=case when status in ('reserved','occupied') then 'available' else status end,
        availability_status=case when availability_status in ('reserved','occupied') then 'available' else availability_status end,
        occupied_by=case when current_reservation_id=v_res.id then null else occupied_by end,
        occupied_at=case when current_reservation_id=v_res.id then null else occupied_at end,
        tenancy_ends_at=case when current_reservation_id=v_res.id then null else tenancy_ends_at end,
        current_reservation_id=case when current_reservation_id=v_res.id then null else current_reservation_id end,
        updated_at=now()
    where id=v_listing.id;
  end if;

  return v_result;
end;
$$;

-- Public read RPCs remain public; mutation/date-detail RPCs require an account.
revoke all on function public.get_discoverable_listings() from public;
revoke all on function public.get_public_listing_detail(text) from public;
revoke all on function public.get_short_stay_unavailable_listing_ids(date,date) from public,anon;
revoke all on function public.create_short_stay_reservation(text,date,date) from public,anon;
revoke all on function public.activate_short_stay(text,date) from public,anon;
revoke all on function public.complete_short_stay(text,text) from public,anon;

grant execute on function public.get_discoverable_listings() to anon,authenticated,service_role;
grant execute on function public.get_public_listing_detail(text) to anon,authenticated,service_role;
grant execute on function public.get_short_stay_unavailable_listing_ids(date,date) to authenticated,service_role;
grant execute on function public.create_short_stay_reservation(text,date,date) to authenticated,service_role;
grant execute on function public.activate_short_stay(text,date) to authenticated,service_role;
grant execute on function public.complete_short_stay(text,text) to authenticated,service_role;
