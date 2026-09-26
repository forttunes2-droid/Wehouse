-- Host-managed home commercial controls.
-- Commercial choices may change for future reservations without rewriting verified
-- property facts or any existing reservation snapshot.

alter table public.listings
  add column if not exists host_booking_paused boolean not null default false;

create table if not exists public.property_host_date_blocks(
  block_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  start_date date not null,
  reopen_date date not null,
  created_by text not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  reopened_by text references public.profiles(user_id),
  reopened_at timestamptz,
  constraint property_host_date_blocks_valid_range check(reopen_date>start_date)
);
create index if not exists property_host_date_blocks_active_idx
  on public.property_host_date_blocks(listing_id,start_date,reopen_date)
  where reopened_at is null;

create table if not exists public.property_commercial_change_log(
  change_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  actor_user_id text not null references public.profiles(user_id),
  event_type text not null
    check(event_type in ('price_changed','booking_paused','booking_opened','dates_closed','dates_opened')),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists property_commercial_change_log_listing_idx
  on public.property_commercial_change_log(listing_id,created_at desc);

alter table public.property_host_date_blocks enable row level security;
alter table public.property_commercial_change_log enable row level security;
revoke all on public.property_host_date_blocks from public,anon,authenticated;
revoke all on public.property_commercial_change_log from public,anon,authenticated;

create or replace function public.guard_host_booking_pause_flag()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if auth.uid() is not null
     and current_user not in ('postgres','service_role')
     and old.host_booking_paused is distinct from new.host_booking_paused then
    raise exception 'Change booking availability through the authorised host controls';
  end if;
  return new;
end
$$;
drop trigger if exists listings_host_booking_pause_guard on public.listings;
create trigger listings_host_booking_pause_guard
before update of host_booking_paused on public.listings
for each row execute function public.guard_host_booking_pause_flag();

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
begin
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
  end if;
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
revoke all on function public.get_my_property_host_controls(uuid) from public,anon;
grant execute on function public.get_my_property_host_controls(uuid) to authenticated,service_role;

create or replace function public.set_my_property_future_price(
  p_listing_id uuid,
  p_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_before numeric;
begin
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
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
revoke all on function public.set_my_property_future_price(uuid,numeric) from public,anon;
grant execute on function public.set_my_property_future_price(uuid,numeric) to authenticated,service_role;

create or replace function public.set_my_property_booking_availability(
  p_listing_id uuid,
  p_accepting boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
begin
  if p_accepting is null then raise exception 'Choose whether to accept reservations'; end if;
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
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
revoke all on function public.set_my_property_booking_availability(uuid,boolean) from public,anon;
grant execute on function public.set_my_property_booking_availability(uuid,boolean) to authenticated,service_role;

create or replace function public.block_my_property_dates(
  p_listing_id uuid,
  p_start_date date,
  p_reopen_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
begin
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
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
revoke all on function public.block_my_property_dates(uuid,date,date) from public,anon;
grant execute on function public.block_my_property_dates(uuid,date,date) to authenticated,service_role;

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
  if not public.current_actor_can_manage_property(v_block.listing_id) then
    raise exception 'You do not manage this property';
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
revoke all on function public.unblock_my_property_dates(uuid) from public,anon;
grant execute on function public.unblock_my_property_dates(uuid) to authenticated,service_role;

create or replace function public.enforce_short_let_host_date_blocks()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.stay_type='short_let'
     and new.stay_check_in is not null
     and new.stay_check_out is not null
     and new.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
     and exists(
       select 1 from public.property_host_date_blocks b
       where b.listing_id::text=new.listing_id
         and b.reopened_at is null
         and daterange(b.start_date,b.reopen_date,'[)')
           && daterange(new.stay_check_in,new.stay_check_out,'[)')
     ) then
    raise exception 'Those Short Let dates are not available';
  end if;
  return new;
end
$$;
drop trigger if exists reservations_host_date_block_guard on public.reservations;
create trigger reservations_host_date_block_guard
before insert or update of listing_id,stay_type,stay_check_in,stay_check_out,status
on public.reservations
for each row execute function public.enforce_short_let_host_date_blocks();

revoke all on function public.enforce_short_let_host_date_blocks() from public,anon,authenticated;

create or replace function public.get_short_let_date_availability(
  p_listing_id text,
  p_check_in date,
  p_check_out date
)
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
  v_advance_days integer:=365;
  v_nights integer;
  v_available boolean:=false;
  v_reason text;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.sub_type='short_let'
    and l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
  limit 1;

  if v_listing.id is null then
    return jsonb_build_object('available',false,'reason','not_found');
  end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available'
     or v_listing.host_booking_paused then
    return jsonb_build_object('available',false,'reason','not_published');
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_min_nights
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true)
  limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_max_nights
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true)
  limit 1;
  select coalesce(nullif(value,'')::integer,365) into v_advance_days
  from public.platform_settings
  where key='short_stay_booking_advance_days' and coalesce(is_active,true)
  limit 1;

  v_min_nights:=greatest(coalesce(v_min_nights,1),1);
  v_max_nights:=greatest(coalesce(v_max_nights,90),v_min_nights);
  v_advance_days:=greatest(coalesce(v_advance_days,365),v_max_nights);

  if p_check_in is null or p_check_out is null
     or p_check_in<timezone('Africa/Lagos',now())::date
     or p_check_out<=p_check_in then
    v_reason:='invalid_dates';
  elsif p_check_in>timezone('Africa/Lagos',now())::date+v_advance_days
     or p_check_out>timezone('Africa/Lagos',now())::date+v_advance_days then
    v_reason:='outside_booking_window';
  else
    v_nights:=p_check_out-p_check_in;
    if v_nights<v_min_nights or v_nights>v_max_nights then
      v_reason:='invalid_length';
    elsif exists(
      select 1
      from public.property_host_date_blocks b
      where b.listing_id=v_listing.id
        and b.reopened_at is null
        and daterange(b.start_date,b.reopen_date,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    elsif exists(
      select 1
      from public.reservations r
      where r.listing_id=v_listing.id::text
        and r.stay_type='short_let'
        and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(r.stay_check_in,r.stay_check_out,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    else
      v_available:=true;
      v_reason:='available';
    end if;
  end if;

  return jsonb_build_object(
    'available',v_available,
    'reason',v_reason,
    'nights',case when p_check_in is not null and p_check_out is not null
      then p_check_out-p_check_in else null end,
    'min_nights',v_min_nights,
    'max_nights',v_max_nights
  );
end
$$;

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
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then
    raise exception 'Valid dates required';
  end if;

  return query
  select distinct unavailable.listing_id
  from (
    select r.listing_id
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    where l.sub_type='short_let'
      and r.stay_type='short_let'
      and r.status=any(array['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
      and (
        r.status<>'payment_pending'
        or r.payment_expires_at is null
        or r.payment_expires_at>now()
        or exists(
          select 1 from public.booking_payments bp
          where bp.paystack_reference=r.payment_reference
            and bp.status in ('paid','completed')
        )
      )
      and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(p_check_in,p_check_out,'[)')
    union all
    select b.listing_id::text
    from public.property_host_date_blocks b
    join public.listings l on l.id=b.listing_id
    where l.sub_type='short_let'
      and b.reopened_at is null
      and daterange(b.start_date,b.reopen_date,'[)')
        && daterange(p_check_in,p_check_out,'[)')
  ) unavailable;
end
$$;

comment on table public.property_host_date_blocks
is 'Host-controlled future Short Let closures. Existing reservations are immutable and block conflicting closures.';
comment on function public.set_my_property_future_price(uuid,numeric)
is 'Narrow audited Partner command for future pricing. Existing reservations keep their snapshotted price.';
comment on function public.set_my_property_booking_availability(uuid,boolean)
is 'Host-managed global open/pause control. It never rewrites existing reservation state.';


-- A host-paused property must remain visible inside the Partner workspace even
-- though it is deliberately removed from public discovery.
create or replace function public.get_my_managed_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;

  select coalesce(jsonb_agg(
    (to_jsonb(l)-'access_code'-'private_video_url'-'private_video_path')
      || jsonb_build_object(
        '_assignment_role',a.assignment_role,
        '_assignment_status',a.status,
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
revoke all on function public.get_my_managed_properties() from public,anon;
grant execute on function public.get_my_managed_properties() to authenticated;


-- Switching who operates the property changes owner-level responsibility.
-- An accepted manager may operate an assigned Host-managed property, but cannot
-- silently move the property into or out of WeHouse management.
create or replace function public.set_my_property_management_mode(
  p_listing_id uuid,p_mode text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode not in ('host','wehouse') then raise exception 'Choose Host manages or WeHouse manages'; end if;
  if not exists(
    select 1
    from public.property_host_assignments a
    where a.listing_id=p_listing_id
      and a.user_id=v_actor
      and a.assignment_role='owner'
      and a.status='active'
  ) then
    raise exception 'Only the property owner can change who manages this home';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=p_mode,
      management_host_user_id=case when p_mode='host' then v_actor else null end,
      wehouse_management_status=case
        when p_mode='host' then 'not_required'
        when management_mode='wehouse' and wehouse_management_status='approved' then 'approved'
        else 'requested'
      end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'property_management_mode_changed','listing',p_listing_id::text,
    jsonb_build_object(
      'management_mode',v_listing.management_mode,
      'wehouse_management_status',v_listing.wehouse_management_status,
      'management_host_user_id',v_listing.management_host_user_id
    )::text,now());

  return public.get_my_property_management(p_listing_id);
end
$$;
revoke all on function public.set_my_property_management_mode(uuid,text) from public,anon;
grant execute on function public.set_my_property_management_mode(uuid,text) to authenticated,service_role;
