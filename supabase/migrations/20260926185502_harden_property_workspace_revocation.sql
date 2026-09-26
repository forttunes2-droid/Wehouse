-- A property ownership row records the asset relationship; it is not a
-- substitute for an active Property Partner workspace. Delegated Hosting has
-- its own, property-scoped authority and must continue to work independently.
begin;

create or replace function public.current_actor_can_manage_property(p_listing_id uuid)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.property_host_assignments a
    join public.profiles p on p.user_id=a.user_id
    join public.listings l on l.id=a.listing_id
    where a.listing_id=p_listing_id and a.user_id=public.current_profile_user_id()
      and a.status='active'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        (a.assignment_role='owner'
          and public.user_has_active_workspace(a.user_id,'property_partner'))
        or (a.assignment_role='manager' and (
          l.management_mode='host'
          or exists(select 1 from public.reservations r
            where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
              and r.management_mode_snapshot='host'
              and r.responsible_host_user_id=a.user_id
              and r.status not in ('completed','cancelled','refunded','expired'))
        ))
      )
  )
$$;

create or replace function public.current_actor_property_host_access_level(p_listing_id uuid)
returns text language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select case when a.assignment_role='owner' then 'full_hosting' else a.access_level end
  from public.property_host_assignments a
  join public.profiles p on p.user_id=a.user_id
  join public.listings l on l.id=a.listing_id
  where a.listing_id=p_listing_id and a.user_id=public.current_profile_user_id()
    and a.status='active'
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and (
      (a.assignment_role='owner'
        and public.user_has_active_workspace(a.user_id,'property_partner'))
      or (a.assignment_role='manager' and (
        l.management_mode='host'
        or exists(select 1 from public.reservations r
          where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
            and r.management_mode_snapshot='host'
            and r.responsible_host_user_id=a.user_id
            and r.status not in ('completed','cancelled','refunded','expired'))
      ))
    )
  limit 1
$$;

-- The assignments read policy calls this function. Keep it in the private
-- schema so a revoked owner cannot inspect another member's assignment.
create or replace function private.current_actor_owns_host_property(p_listing_id uuid)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select public.user_has_active_workspace(public.current_profile_user_id(),'property_partner')
    and exists(select 1 from public.property_host_assignments a
      where a.listing_id=p_listing_id and a.user_id=public.current_profile_user_id()
        and a.assignment_role='owner' and a.status='active')
$$;

-- Deny previously prepared invitations when their owner's professional
-- authority has subsequently been revoked. This guard also covers any other
-- path that tries to activate the same co-host assignment directly.
create or replace function public.guard_invited_team_assignment()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if tg_table_name='property_host_assignments' then
    if tg_op='UPDATE' and old.assignment_role='owner'
       and new.assignment_role is distinct from old.assignment_role then
      raise exception 'A property owner assignment cannot be replaced by a co-host invitation';
    end if;
    if tg_op='UPDATE' and old.status='active' and new.status='invited' then
      raise exception 'An active co-host must be revoked before a new invitation is sent';
    end if;
    if new.assignment_role='manager' and new.status in ('invited','active')
       and (tg_op='INSERT' or new.status is distinct from old.status
         or new.invited_by is distinct from old.invited_by)
       and not public.user_has_active_workspace(new.invited_by,'property_partner') then
      raise exception 'The property inviter no longer has Property Partner access';
    end if;
  elsif tg_table_name='hotel_team_members' then
    if tg_op='UPDATE' and old.status='active' and new.status='invited' then
      raise exception 'An active hotel team member must be revoked before a new invitation is sent';
    end if;
    if exists(select 1 from public.hotels h
      where h.hotel_id=new.hotel_id and h.owner_id=new.member_user_id) then
      raise exception 'A hotel owner cannot be added as a team member';
    end if;
  end if;
  return new;
end
$$;

-- The partner workspace returns only data used to operate the listed homes.
-- A new listings column is not silently exposed by this privileged RPC.
create or replace function public.get_my_managed_properties()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'listing_id',l.listing_id,'title',l.title,
    'address',l.address,'city',l.city,'state',l.state,
    'images',l.images,'videos',l.videos,'price',l.price,
    'availability_status',l.availability_status,'status',l.status,
    'property_type',l.property_type,'sub_type',l.sub_type,
    'bedrooms',l.bedrooms,'bathrooms',l.bathrooms,
    'management_mode',l.management_mode,
    'management_updated_at',l.management_updated_at,
    '_assignment_role','owner','_assignment_status',a.status,
    '_access_level','full_hosting','_can_manage',true,
    '_can_control_commercials',l.management_mode='host','_is_owner',true
  ) order by l.created_at desc),'[]'::jsonb) into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor and a.assignment_role='owner' and a.status='active'
    and l.deleted_at is null and l.approved_at is not null
    and l.status in ('available','unavailable','reserved','occupied','maintenance','closed');
  return v_result;
end
$$;

create or replace function public.get_my_hosting_properties()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('hosting',null) then
    raise exception 'Hosting workspace required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'listing_id',l.listing_id,'title',l.title,
    'address',l.address,'city',l.city,'state',l.state,
    'images',l.images,'videos',l.videos,'price',l.price,
    'availability_status',l.availability_status,'status',l.status,
    'property_type',l.property_type,'sub_type',l.sub_type,
    'bedrooms',l.bedrooms,'bathrooms',l.bathrooms,
    'management_mode',l.management_mode,
    'management_updated_at',l.management_updated_at,
    '_assignment_role','manager','_assignment_status',a.status,
    '_access_level',a.access_level,'_can_manage',true,
    '_can_control_commercials',a.access_level='full_hosting' and l.management_mode='host',
    '_is_owner',false
  ) order by l.created_at desc),'[]'::jsonb) into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor and a.assignment_role='manager' and a.status='active'
    and l.deleted_at is null and l.approved_at is not null
    and l.status in ('available','unavailable','reserved','occupied','maintenance','closed')
    and (l.management_mode='host' or exists(
      select 1 from public.reservations r
      where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
        and r.management_mode_snapshot='host'
        and r.responsible_host_user_id=v_actor
        and r.status not in ('completed','cancelled','refunded','expired')));
  return v_result;
end
$$;

create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result from (
    select r.id reservation_id,coalesce(r.stay_type,'long_stay') stay_type,r.status,
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
      and public.current_actor_can_manage_property(l.id)
      and (
        (r.management_mode_snapshot='host'
          and (a.assignment_role='owner' or r.responsible_host_user_id=v_actor)
          and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed')))
        or (r.management_mode_snapshot='wehouse' and a.assignment_role='owner'
          and ((coalesce(r.stay_type,'long_stay')='short_let'
            and ((r.rent_payment_status='paid' and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))
          or (coalesce(r.stay_type,'long_stay')<>'short_let'
            and ((r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))))
      )
    order by r.created_at desc limit 50
  ) stay;
  return v_result;
end
$$;

drop policy if exists listings_property_host_read_assigned on public.listings;
create policy listings_property_host_read_assigned
on public.listings for select to authenticated
using (public.current_actor_can_manage_property(id));

-- Older owners/partners and internal roles must also pass their current grant.
drop policy if exists listings_read_canonical on public.listings;
create policy listings_read_canonical
on public.listings for select to authenticated
using (deleted_at is null and (
  ((owner_id=public.current_profile_user_id() or partner_id=public.current_profile_user_id())
    and public.current_actor_has_workspace('property_partner',null))
  or public.current_actor_has_workspace('creator',null)
  or ((public.current_actor_has_workspace('admin',state)
        or (public.current_actor_has_workspace('staff',state)
          and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(state,city))
  or exists(select 1 from public.reservations r
    where r.user_id=public.current_profile_user_id()
      and r.listing_id=any(array[id::text,listing_id])
      and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
      and r.status not in ('cancelled','expired'))
));

revoke all on function public.current_actor_can_manage_property(uuid),
  public.current_actor_property_host_access_level(uuid),
  public.get_my_managed_properties(),public.get_my_hosting_properties(),
  public.get_my_property_partner_stays(text),public.guard_invited_team_assignment()
  from public,anon;
grant execute on function public.current_actor_can_manage_property(uuid),
  public.current_actor_property_host_access_level(uuid),
  public.get_my_managed_properties(),public.get_my_hosting_properties(),
  public.get_my_property_partner_stays(text) to authenticated,service_role;
revoke all on function public.guard_invited_team_assignment() from authenticated;

commit;
