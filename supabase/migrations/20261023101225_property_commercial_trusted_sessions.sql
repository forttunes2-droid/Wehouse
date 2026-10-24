-- Trusted-session enforcement and recovery for the existing commercial commands.
CREATE OR REPLACE FUNCTION public.block_my_property_dates(p_listing_id uuid, p_start_date date, p_reopen_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if not public.current_actor_can_change_property_commercials(p_listing_id) then
    raise exception 'Full hosting access is required to change closed dates';
  end if;
  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_listing.management_mode<>'host' then raise exception 'Switch this property to Host manages first'; end if;
  if v_listing.sub_type<>'short_let' then raise exception 'Closed dates are only for Short Lets'; end if;
  if p_start_date is null or p_reopen_date is null
     or p_start_date<timezone('Africa/Lagos',now())::date
     or p_reopen_date<=p_start_date
     or p_reopen_date>timezone('Africa/Lagos',now())::date+730 then
    raise exception 'Choose a valid date range';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));

  if exists(select 1 from public.property_host_date_blocks b where b.listing_id=v_listing.id and b.reopened_at is null and b.start_date=p_start_date and b.reopen_date=p_reopen_date) then
    return public.get_my_property_host_controls(p_listing_id);
  end if;
  if exists(
    select 1 from public.property_host_date_blocks b
    where b.listing_id=v_listing.id
      and b.reopened_at is null
      and daterange(b.start_date,b.reopen_date,'[)')
        && daterange(p_start_date,p_reopen_date,'[)')
  ) then raise exception 'Those dates are already closed'; end if;

  if exists(
    select 1 from public.reservations r
    where r.listing_id=v_listing.id::text
      and r.stay_type='short_let'
      and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
      and (
        r.status<>'payment_pending'
        or r.payment_expires_at is null
        or r.payment_expires_at>now()
      )
      and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(p_start_date,p_reopen_date,'[)')
  ) then raise exception 'An active reservation already uses those dates'; end if;

  insert into public.property_host_date_blocks(
    listing_id,start_date,reopen_date,created_by
  ) values(p_listing_id,p_start_date,p_reopen_date,v_actor);

  insert into public.property_commercial_change_log(
    listing_id,actor_user_id,event_type,before_state,after_state
  ) values(
    p_listing_id,v_actor,'dates_closed','{}'::jsonb,
    jsonb_build_object('start_date',p_start_date,'reopen_date',p_reopen_date)
  );

  return public.get_my_property_host_controls(p_listing_id);
end
$function$
;
CREATE OR REPLACE FUNCTION public.set_my_property_booking_availability(p_listing_id uuid, p_accepting boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if p_accepting is null then raise exception 'Choose whether to accept reservations'; end if;
  if not public.current_actor_can_change_property_commercials(p_listing_id) then
    raise exception 'Full hosting access is required to change booking availability';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_listing.management_mode<>'host' then
    raise exception 'Switch this property to Host manages first';
  end if;
  if v_listing.inspection_request_id is null or v_listing.approved_at is null then
    raise exception 'Only a published property can change booking availability';
  end if;

  if p_accepting then
    if not v_listing.host_booking_paused then
      return public.get_my_property_host_controls(p_listing_id);
    end if;
    if v_listing.status<>'unavailable' or v_listing.availability_status<>'unavailable' then
      raise exception 'This property cannot be reopened from its current state';
    end if;
    update public.listings
    set host_booking_paused=false,status='available',availability_status='available',updated_at=now()
    where id=p_listing_id;
    insert into public.property_commercial_change_log(
      listing_id,actor_user_id,event_type,before_state,after_state
    ) values(
      p_listing_id,v_actor,'booking_opened',
      jsonb_build_object('host_booking_paused',true,'status',v_listing.status),
      jsonb_build_object('host_booking_paused',false,'status','available')
    );
  else
    if v_listing.host_booking_paused then
      return public.get_my_property_host_controls(p_listing_id);
    end if;
    if v_listing.status<>'available' or v_listing.availability_status<>'available' then
      raise exception 'Only an available property can pause new reservations';
    end if;
    if v_listing.sub_type<>'short_let' and exists(
      select 1 from public.reservations r
      where r.listing_id=v_listing.id::text
        and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
        and (
          r.status<>'payment_pending'
          or r.payment_expires_at is null
          or r.payment_expires_at>now()
        )
    ) then
      raise exception 'This Long Let already has an active reservation';
    end if;
    update public.listings
    set host_booking_paused=true,status='unavailable',availability_status='unavailable',updated_at=now()
    where id=p_listing_id;
    insert into public.property_commercial_change_log(
      listing_id,actor_user_id,event_type,before_state,after_state
    ) values(
      p_listing_id,v_actor,'booking_paused',
      jsonb_build_object('host_booking_paused',false,'status',v_listing.status),
      jsonb_build_object('host_booking_paused',true,'status','unavailable')
    );
  end if;

  return public.get_my_property_host_controls(p_listing_id);
end
$function$
;
CREATE OR REPLACE FUNCTION public.set_my_property_future_price(p_listing_id uuid, p_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_before numeric;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if not public.current_actor_can_change_property_commercials(p_listing_id) then
    raise exception 'Full hosting access is required to change future price';
  end if;
  if p_price is null or p_price::text in ('NaN','Infinity','-Infinity') or p_price<=0 or p_price>1000000000 then
    raise exception 'Enter a valid future price';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id
    and deleted_at is null
    and inspection_request_id is not null
    and approved_at is not null
  for update;
  if v_listing.id is null then raise exception 'Published property not found'; end if;

  v_before:=v_listing.price;
  if round(v_before,2)=round(p_price,2) then
    return public.get_my_property_host_controls(p_listing_id);
  end if;

  update public.listings
  set price=round(p_price,2),updated_at=now()
  where id=p_listing_id;

  insert into public.property_commercial_change_log(
    listing_id,actor_user_id,event_type,before_state,after_state
  ) values(
    p_listing_id,v_actor,'price_changed',
    jsonb_build_object('price',v_before,'currency',coalesce(v_listing.currency,'NGN')),
    jsonb_build_object('price',round(p_price,2),'currency',coalesce(v_listing.currency,'NGN'))
  );

  return public.get_my_property_host_controls(p_listing_id);
end
$function$
;
CREATE OR REPLACE FUNCTION public.unblock_my_property_dates(p_block_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_block public.property_host_date_blocks;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_block
  from public.property_host_date_blocks
  where block_id=p_block_id
  for update;
  if v_block.block_id is null then raise exception 'Closed date range not found'; end if;
  if not public.current_actor_can_change_property_commercials(v_block.listing_id) then
    raise exception 'Full hosting access is required to reopen dates';
  end if;

  if v_block.reopened_at is not null then return public.get_my_property_host_controls(v_block.listing_id); end if;

  update public.property_host_date_blocks
  set reopened_at=now(),reopened_by=v_actor
  where block_id=p_block_id;

  insert into public.property_commercial_change_log(
    listing_id,actor_user_id,event_type,before_state,after_state
  ) values(
    v_block.listing_id,v_actor,'dates_opened',
    jsonb_build_object('start_date',v_block.start_date,'reopen_date',v_block.reopen_date),
    '{}'::jsonb
  );

  return public.get_my_property_host_controls(v_block.listing_id);
end
$function$
;
