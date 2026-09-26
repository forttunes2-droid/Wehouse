-- Delegated Hosting capability enforcement and read model.
-- Owners keep full authority. Operations co-hosts can operate assigned stays;
-- Full hosting co-hosts additionally control future price/availability.

create or replace function public.current_actor_property_host_access_level(p_listing_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select case
    when a.assignment_role='owner' then 'full_hosting'
    else a.access_level
  end
  from public.property_host_assignments a
  join public.profiles p on p.user_id=a.user_id
  where a.listing_id=p_listing_id
    and a.user_id=public.current_profile_user_id()
    and a.status='active'
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  order by case when a.assignment_role='owner' then 0 else 1 end
  limit 1
$$;

create or replace function public.current_actor_can_change_property_commercials(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(public.current_actor_property_host_access_level(p_listing_id)='full_hosting',false)
$$;

create or replace function public.get_my_property_host_controls(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_listing public.listings;
  v_min_nights integer:=1;
  v_max_nights integer:=90;
  v_access text;
begin
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
  end if;
  v_access:=public.current_actor_property_host_access_level(p_listing_id);

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  if v_listing.sub_type='short_let' then
    select coalesce(nullif(value,'')::integer,1) into v_min_nights
    from public.platform_settings where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
    select coalesce(nullif(value,'')::integer,90) into v_max_nights
    from public.platform_settings where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  end if;

  return jsonb_build_object(
    'listing_id',v_listing.id,
    'sub_type',v_listing.sub_type,
    'price',v_listing.price,
    'currency',coalesce(v_listing.currency,'NGN'),
    'status',v_listing.status,
    'availability_status',v_listing.availability_status,
    'host_booking_paused',v_listing.host_booking_paused,
    'access_level',v_access,
    'can_manage_commercials',v_access='full_hosting',
    'accepting_reservations',
      (not v_listing.host_booking_paused
       and v_listing.status='available'
       and v_listing.availability_status='available'),
    'min_nights',case when v_listing.sub_type='short_let' then greatest(coalesce(v_min_nights,1),1) else null end,
    'max_nights',case when v_listing.sub_type='short_let' then greatest(coalesce(v_max_nights,90),greatest(coalesce(v_min_nights,1),1)) else null end,
    'date_blocks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'block_id',b.block_id,
        'start_date',b.start_date,
        'reopen_date',b.reopen_date,
        'created_at',b.created_at
      ) order by b.start_date)
      from public.property_host_date_blocks b
      where b.listing_id=v_listing.id and b.reopened_at is null
    ),'[]'::jsonb)
  );
end
$$;

create or replace function public.set_my_property_future_price(
  p_listing_id uuid,p_price numeric
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_before numeric;
begin
  if not public.current_actor_can_change_property_commercials(p_listing_id) then
    raise exception 'Full hosting access is required to change future price';
  end if;
  if p_price is null or p_price<=0 or p_price>1000000000 then
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
$$;

create or replace function public.set_my_property_booking_availability(
  p_listing_id uuid,p_accepting boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
begin
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
$$;

create or replace function public.block_my_property_dates(
  p_listing_id uuid,p_start_date date,p_reopen_date date
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
begin
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
$$;

create or replace function public.unblock_my_property_dates(p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_block public.property_host_date_blocks;
begin
  select * into v_block
  from public.property_host_date_blocks
  where block_id=p_block_id and reopened_at is null
  for update;
  if v_block.block_id is null then raise exception 'Closed date range not found'; end if;
  if not public.current_actor_can_change_property_commercials(v_block.listing_id) then
    raise exception 'Full hosting access is required to reopen dates';
  end if;

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
$$;

create or replace function public.get_my_managed_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select coalesce(jsonb_agg(
    (to_jsonb(l)-'access_code'-'private_video_url'-'private_video_path')
      || jsonb_build_object(
        '_assignment_role',a.assignment_role,
        '_assignment_status',a.status,
        '_access_level',case when a.assignment_role='owner' then 'full_hosting' else a.access_level end,
        '_can_manage',a.status='active',
        '_is_owner',a.assignment_role='owner' and a.status='active'
      )
    order by l.created_at desc
  ),'[]'::jsonb)
  into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor
    and a.status='active'
    and l.deleted_at is null
    and l.approved_at is not null
    and l.status in ('available','unavailable','reserved','occupied','maintenance','closed');

  return v_result;
end
$$;

create or replace function public.get_my_hosting_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select coalesce(jsonb_agg(
    (to_jsonb(l)-'access_code'-'private_video_url'-'private_video_path')
      || jsonb_build_object(
        '_assignment_role','manager',
        '_assignment_status',a.status,
        '_access_level',a.access_level,
        '_can_manage',true,
        '_is_owner',false
      )
    order by l.created_at desc
  ),'[]'::jsonb)
  into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor
    and a.assignment_role='manager'
    and a.status='active'
    and l.deleted_at is null
    and l.approved_at is not null
    and l.management_mode='host'
    and l.status in ('available','unavailable','reserved','occupied','maintenance','closed');

  return v_result;
end
$;

create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select
      r.id reservation_id,
      coalesce(r.stay_type,'long_stay') stay_type,r.status,
      r.rent_payment_status payment_status,r.manual_payment_status,
      r.reservation_fee_status,r.reservation_fee_snapshot,r.reservation_fee_paid_at,
      r.rent_paid_at,r.stay_check_in check_in,r.stay_check_out check_out,r.stay_nights nights,
      coalesce(r.guest_count,1) guest_count,r.requested_move_in_at,r.move_in_requested_at,
      r.tenancy_start_date,r.tenancy_end_date,r.created_at,
      r.management_mode_snapshot,r.responsible_host_user_id,
      l.id::text listing_id,l.listing_id public_listing_code,l.title listing_title,
      a.assignment_role,
      case when a.assignment_role='owner' then 'full_hosting' else a.access_level end access_level
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id and a.user_id=v_actor and a.status='active'
    where (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and (
        (
          r.management_mode_snapshot='host'
          and (a.assignment_role='owner' or r.responsible_host_user_id=v_actor)
          and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed'))
        )
        or (
          r.management_mode_snapshot='wehouse'
          and a.assignment_role='owner'
          and (
            (coalesce(r.stay_type,'long_stay')='short_let'
              and ((r.rent_payment_status='paid' and r.rent_paid_at is not null) or r.status in('occupied','completed')))
            or
            (coalesce(r.stay_type,'long_stay')<>'short_let'
              and ((r.rent_payment_status in('paid','upfront_paid') and r.rent_paid_at is not null) or r.status in('occupied','completed')))
          )
        )
      )
    order by r.created_at desc
    limit 50
  ) stay;

  return v_result;
end
$$;

create or replace function public.get_my_property_management(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_listing public.listings; v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if not public.current_actor_can_manage_property(v_listing.id) then
    raise exception 'You do not manage this property';
  end if;

  return jsonb_build_object(
    'listing_id',v_listing.id,
    'management_mode',v_listing.management_mode,
    'wehouse_management_status',v_listing.wehouse_management_status,
    'management_host_user_id',v_listing.management_host_user_id,
    'management_updated_at',v_listing.management_updated_at,
    'assignments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id',a.assignment_id,
        'user_id',a.user_id,
        'name',coalesce(p.full_name,p.username),
        'username',p.username,
        'role',a.assignment_role,
        'status',a.status,
        'access_level',case when a.assignment_role='owner' then 'full_hosting' else a.access_level end
      ) order by a.assignment_role,a.created_at)
      from public.property_host_assignments a
      join public.profiles p on p.user_id=a.user_id
      where a.listing_id=v_listing.id and a.status<>'revoked'
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.current_actor_property_host_access_level(uuid) from public,anon;
revoke all on function public.current_actor_can_change_property_commercials(uuid) from public,anon;
revoke all on function public.get_my_property_host_controls(uuid) from public,anon;
revoke all on function public.set_my_property_future_price(uuid,numeric) from public,anon;
revoke all on function public.set_my_property_booking_availability(uuid,boolean) from public,anon;
revoke all on function public.block_my_property_dates(uuid,date,date) from public,anon;
revoke all on function public.unblock_my_property_dates(uuid) from public,anon;
revoke all on function public.get_my_managed_properties() from public,anon;
revoke all on function public.get_my_hosting_properties() from public,anon;
revoke all on function public.get_my_property_partner_stays(text) from public,anon;
revoke all on function public.get_my_property_management(uuid) from public,anon;

grant execute on function public.current_actor_property_host_access_level(uuid) to authenticated,service_role;
grant execute on function public.current_actor_can_change_property_commercials(uuid) to authenticated,service_role;
grant execute on function public.get_my_property_host_controls(uuid) to authenticated,service_role;
grant execute on function public.set_my_property_future_price(uuid,numeric) to authenticated,service_role;
grant execute on function public.set_my_property_booking_availability(uuid,boolean) to authenticated,service_role;
grant execute on function public.block_my_property_dates(uuid,date,date) to authenticated,service_role;
grant execute on function public.unblock_my_property_dates(uuid) to authenticated,service_role;
grant execute on function public.get_my_managed_properties() to authenticated,service_role;
grant execute on function public.get_my_hosting_properties() to authenticated,service_role;
grant execute on function public.get_my_property_partner_stays(text) to authenticated,service_role;
grant execute on function public.get_my_property_management(uuid) to authenticated,service_role;
