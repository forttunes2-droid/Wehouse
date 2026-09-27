-- Property-specific Host-managed / WeHouse-managed authority.
-- Identity verification is deliberately NOT an authority source.

alter table public.listings
  add column if not exists management_mode text not null default 'wehouse',
  add column if not exists wehouse_management_status text not null default 'requested',
  add column if not exists management_host_user_id text,
  add column if not exists management_updated_at timestamptz;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='listings_management_mode_check' and conrelid='public.listings'::regclass) then
    alter table public.listings add constraint listings_management_mode_check
      check(management_mode in ('host','wehouse'));
  end if;
  if not exists(select 1 from pg_constraint where conname='listings_wehouse_management_status_check' and conrelid='public.listings'::regclass) then
    alter table public.listings add constraint listings_wehouse_management_status_check
      check(wehouse_management_status in ('not_required','requested','approved','declined'));
  end if;
end
$$;

-- Existing live homes preserve today's WeHouse-managed operation.
update public.listings
set management_mode='wehouse',
    wehouse_management_status='approved',
    management_host_user_id=null,
    management_updated_at=coalesce(management_updated_at,now())
where management_updated_at is null;

create table if not exists public.property_host_assignments(
  assignment_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  assignment_role text not null default 'manager'
    check(assignment_role in ('owner','manager')),
  status text not null default 'invited'
    check(status in ('invited','active','revoked','declined')),
  invited_by text references public.profiles(user_id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(listing_id,user_id)
);
create index if not exists property_host_assignments_user_status_idx
  on public.property_host_assignments(user_id,status,listing_id);

alter table public.property_host_assignments enable row level security;
drop policy if exists property_host_assignments_read_own on public.property_host_assignments;
create policy property_host_assignments_read_own
on public.property_host_assignments for select to authenticated
using(user_id=public.current_profile_user_id()
  or exists(
    select 1 from public.property_host_assignments owner_assignment
    where owner_assignment.listing_id=property_host_assignments.listing_id
      and owner_assignment.user_id=public.current_profile_user_id()
      and owner_assignment.assignment_role='owner'
      and owner_assignment.status='active'
  ));
revoke insert,update,delete on public.property_host_assignments from anon,authenticated;
grant select on public.property_host_assignments to authenticated;

-- Existing listed owner/partner becomes the explicit property owner authority.
insert into public.property_host_assignments(
  listing_id,user_id,assignment_role,status,invited_by,accepted_at,created_at,updated_at
)
select l.id,p.user_id,'owner','active',p.user_id,now(),now(),now()
from public.listings l
join public.profiles p on p.user_id=coalesce(nullif(l.partner_id,''),nullif(l.owner_id,''))
where l.deleted_at is null
on conflict(listing_id,user_id) do update set
  assignment_role='owner',
  status='active',
  accepted_at=coalesce(public.property_host_assignments.accepted_at,now()),
  revoked_at=null,
  updated_at=now();

create or replace function public.current_actor_can_manage_property(p_listing_id uuid)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.property_host_assignments a
    join public.profiles p on p.user_id=a.user_id
    where a.listing_id=p_listing_id
      and a.user_id=public.current_profile_user_id()
      and a.status='active'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and public.user_has_active_workspace(a.user_id,'property_partner')
  )
$$;
revoke all on function public.current_actor_can_manage_property(uuid) from public,anon;
grant execute on function public.current_actor_can_manage_property(uuid) to authenticated,service_role;

create or replace function public.enforce_listing_management_rpc()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if auth.uid() is not null
     and (
       old.management_mode is distinct from new.management_mode
       or old.wehouse_management_status is distinct from new.wehouse_management_status
       or old.management_host_user_id is distinct from new.management_host_user_id
     )
     and coalesce(current_setting('wehouse.management_rpc',true),'')<>'allowed'
  then
    raise exception 'Change property management through the authorised management controls';
  end if;
  return new;
end
$$;
drop trigger if exists listings_management_rpc_guard on public.listings;
create trigger listings_management_rpc_guard
before update of management_mode,wehouse_management_status,management_host_user_id
on public.listings for each row execute function public.enforce_listing_management_rpc();

create or replace function public.get_my_property_management(p_listing_id uuid)
returns jsonb language plpgsql stable security definer
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
        'status',a.status
      ) order by a.assignment_role,a.created_at)
      from public.property_host_assignments a
      join public.profiles p on p.user_id=a.user_id
      where a.listing_id=v_listing.id and a.status<>'revoked'
    ),'[]'::jsonb)
  );
end
$$;
revoke all on function public.get_my_property_management(uuid) from public,anon;
grant execute on function public.get_my_property_management(uuid) to authenticated;

create or replace function public.set_my_property_management_mode(
  p_listing_id uuid,p_mode text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode not in ('host','wehouse') then raise exception 'Choose Host-managed or WeHouse-managed'; end if;
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
  end if;
  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null for update;
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
grant execute on function public.set_my_property_management_mode(uuid,text) to authenticated;

create or replace function public.invite_property_host_manager(
  p_listing_id uuid,p_username text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_target public.profiles;
  v_owner boolean;
  v_assignment public.property_host_assignments;
begin
  select exists(
    select 1 from public.property_host_assignments
    where listing_id=p_listing_id and user_id=v_actor
      and assignment_role='owner' and status='active'
  ) into v_owner;
  if not v_owner then raise exception 'Only the property owner can invite a manager'; end if;

  select * into v_target from public.profiles
  where lower(username)=lower(btrim(p_username))
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_target.user_id is null or v_target.user_id=v_actor then
    raise exception 'Choose another existing WeHouse user';
  end if;
  if not public.user_has_active_workspace(v_target.user_id,'property_partner') then
    raise exception 'That user must activate a Property Partner workspace first';
  end if;

  insert into public.property_host_assignments(
    listing_id,user_id,assignment_role,status,invited_by,invited_at,accepted_at,revoked_at,updated_at
  ) values(
    p_listing_id,v_target.user_id,'manager','invited',v_actor,now(),null,null,now()
  ) on conflict(listing_id,user_id) do update set
    assignment_role='manager',status='invited',invited_by=v_actor,
    invited_at=now(),accepted_at=null,revoked_at=null,updated_at=now()
  returning * into v_assignment;

  return jsonb_build_object(
    'success',true,'assignment_id',v_assignment.assignment_id,
    'user_id',v_target.user_id,'username',v_target.username,'status',v_assignment.status
  );
end
$$;
revoke all on function public.invite_property_host_manager(uuid,text) from public,anon;
grant execute on function public.invite_property_host_manager(uuid,text) to authenticated;

create or replace function public.respond_to_property_host_invite(
  p_assignment_id uuid,p_accept boolean
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_assignment public.property_host_assignments;
begin
  update public.property_host_assignments
  set status=case when p_accept then 'active' else 'declined' end,
      accepted_at=case when p_accept then now() else null end,
      revoked_at=case when p_accept then null else now() end,
      updated_at=now()
  where assignment_id=p_assignment_id and user_id=v_actor and status='invited'
  returning * into v_assignment;
  if v_assignment.assignment_id is null then raise exception 'Active invitation not found'; end if;
  return jsonb_build_object('success',true,'status',v_assignment.status,'listing_id',v_assignment.listing_id);
end
$$;
revoke all on function public.respond_to_property_host_invite(uuid,boolean) from public,anon;
grant execute on function public.respond_to_property_host_invite(uuid,boolean) to authenticated;

create or replace function public.revoke_property_host_manager(p_assignment_id uuid)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing uuid;
begin
  select listing_id into v_listing from public.property_host_assignments
  where assignment_id=p_assignment_id;
  if v_listing is null or not exists(
    select 1 from public.property_host_assignments
    where listing_id=v_listing and user_id=v_actor
      and assignment_role='owner' and status='active'
  ) then raise exception 'Only the property owner can remove a manager'; end if;
  update public.property_host_assignments
  set status='revoked',revoked_at=now(),updated_at=now()
  where assignment_id=p_assignment_id and assignment_role='manager';
  return found;
end
$$;
revoke all on function public.revoke_property_host_manager(uuid) from public,anon;
grant execute on function public.revoke_property_host_manager(uuid) to authenticated;

create or replace function public.review_wehouse_property_management(
  p_listing_id uuid,p_approve boolean,p_reason text default null
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if not (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('operations'))
  ) then raise exception 'Property Operations authority required'; end if;

  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.management_mode<>'wehouse' then
    raise exception 'WeHouse management was not requested for this property';
  end if;
  if not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Property is outside your authority';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set wehouse_management_status=case when p_approve then 'approved' else 'declined' end,
      management_updated_at=now(),updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'wehouse_property_management_review','listing',p_listing_id::text,
    jsonb_build_object('approved',p_approve,'reason',nullif(btrim(coalesce(p_reason,'')),''))::text,now());

  return jsonb_build_object(
    'success',true,'management_mode',v_listing.management_mode,
    'wehouse_management_status',v_listing.wehouse_management_status
  );
end
$$;
revoke all on function public.review_wehouse_property_management(uuid,boolean,text) from public,anon;
grant execute on function public.review_wehouse_property_management(uuid,boolean,text) to authenticated;

alter table public.reservations
  add column if not exists management_mode_snapshot text not null default 'wehouse',
  add column if not exists responsible_host_user_id text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='reservations_management_mode_snapshot_check' and conrelid='public.reservations'::regclass) then
    alter table public.reservations add constraint reservations_management_mode_snapshot_check
      check(management_mode_snapshot in ('host','wehouse'));
  end if;
end
$$;

-- Preserve all bookings that existed before the feature as WeHouse-managed.
update public.reservations
set management_mode_snapshot='wehouse',responsible_host_user_id=null
where management_mode_snapshot is distinct from 'wehouse'
   or responsible_host_user_id is not null;

create or replace function public.snapshot_property_management_on_reservation()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_listing public.listings;
begin
  select * into v_listing from public.listings
  where id::text=new.listing_id or listing_id=new.listing_id
  limit 1;
  if v_listing.id is null then return new; end if;

  if v_listing.management_mode='host' then
    if v_listing.management_host_user_id is null
       or not exists(
         select 1 from public.property_host_assignments a
         where a.listing_id=v_listing.id
           and a.user_id=v_listing.management_host_user_id
           and a.status='active'
       ) then
      raise exception 'This Host-managed property has no active responsible host';
    end if;
    new.management_mode_snapshot:='host';
    new.responsible_host_user_id:=v_listing.management_host_user_id;
  else
    if v_listing.wehouse_management_status<>'approved' then
      raise exception 'WeHouse management is not yet approved for this property';
    end if;
    new.management_mode_snapshot:='wehouse';
    new.responsible_host_user_id:=null;
  end if;
  return new;
end
$$;
drop trigger if exists reservations_management_snapshot on public.reservations;
create trigger reservations_management_snapshot
before insert on public.reservations
for each row execute function public.snapshot_property_management_on_reservation();

create or replace function public.current_actor_can_host_reservation(p_reservation_id text)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.reservations r
    join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id and a.user_id=r.responsible_host_user_id and a.status='active'
    where r.id=p_reservation_id
      and r.management_mode_snapshot='host'
      and r.responsible_host_user_id=public.current_profile_user_id()
      and public.user_has_active_workspace(r.responsible_host_user_id,'property_partner')
  )
$$;
revoke all on function public.current_actor_can_host_reservation(text) from public,anon;
grant execute on function public.current_actor_can_host_reservation(text) to authenticated,service_role;

create or replace function public.activate_short_stay(
  p_reservation_id text,
  p_actual_check_in date default timezone('Africa/Lagos',now())::date
) returns public.reservations
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
  v_protection public.payment_protection_transactions;
  v_host boolean:=false;
begin
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let' for update;
  if v_res.id is null then raise exception 'Short Stay reservation not found'; end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id for update;
  if v_listing.id is null or v_listing.sub_type<>'short_let' then raise exception 'Short Stay listing not found'; end if;

  v_host:=public.current_actor_can_host_reservation(v_res.id);
  if not v_host then
    select * into v_actor from public.profiles
    where auth_id=(select auth.uid())::text and role in ('staff','admin','creator')
      and not coalesce(deleted,false) and not coalesce(suspended,false)
      and not coalesce(banned,false) limit 1;
    if v_actor.user_id is null or not public.user_has_active_workspace(v_actor.user_id,v_actor.role) then
      raise exception 'Housing Operations access required';
    end if;
    if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
      raise exception 'Operations permission required';
    end if;
    if not public.current_actor_in_scope(v_listing.state,v_listing.city) then
      raise exception 'Listing is outside your assigned State/LGA';
    end if;
  end if;

  if v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid'
     or v_res.rent_paid_at is null then
    raise exception 'Short Stay payment must be verified before check-in';
  end if;
  if not public.property_arrival_allowed('short_let',v_res.stay_check_in,v_res.stay_check_out,null,p_actual_check_in) then
    raise exception 'Check-in must be recorded today within the reserved stay dates (Nigeria time)';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_res.stay_payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state<>'protected' then
    raise exception 'Current Short Stay Payment Protection is required before check-in';
  end if;
  if exists(
    select 1 from public.reservations reservation
    where reservation.listing_id=v_res.listing_id and reservation.id<>v_res.id
      and reservation.stay_type='short_let' and reservation.status='occupied'
      and daterange(reservation.stay_check_in,reservation.stay_check_out,'[)')
        && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then raise exception 'Those Short Stay dates are already occupied'; end if;

  update public.reservations
  set status='occupied',tenancy_start_date=p_actual_check_in,
      tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),checked_in_at=now(),updated_at=now()
  where id=v_res.id returning * into v_result;

  insert into public.obligation_policy_snapshots(
    subject_type,subject_id,policy_version_id,calculated_value
  ) values(
    'short_let',v_res.id,v_result.arrival_issue_policy_version_id,
    jsonb_build_object(
      'arrival_issue_window_hours',v_result.arrival_issue_window_hours,
      'arrival_issue_deadline_at',v_result.arrival_issue_deadline_at,
      'authorized_check_in_at',v_result.checked_in_at,
      'management_mode',v_result.management_mode_snapshot,
      'responsible_host_user_id',v_result.responsible_host_user_id
    )
  ) on conflict(subject_type,subject_id,policy_version_id) do nothing;

  return v_result;
end
$$;

-- Existing complex tenancy activation remains one implementation; only the authority gate is widened
-- to the responsible Host for a Host-managed booking.
create or replace function public.assert_current_actor_can_handover_reservation(
  p_reservation_id text,p_state text,p_lga text
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  if public.current_actor_can_host_reservation(p_reservation_id) then return true; end if;
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.user_has_active_workspace(v_actor.user_id,v_actor.role) then return false; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then return false; end if;
  return public.current_actor_in_scope(p_state,p_lga);
end
$$;
revoke all on function public.assert_current_actor_can_handover_reservation(text,text,text) from public,anon;
grant execute on function public.assert_current_actor_can_handover_reservation(text,text,text) to authenticated,service_role;

-- Host-safe wrappers use the same booking code but never expose Operations-wide lookup.
create or replace function public.host_confirm_short_stay_check_in(
  p_booking_code text,p_check_in_date date default timezone('Africa/Lagos',now())::date
) returns public.reservations
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_result public.reservations;
begin
  select * into v_res from public.reservations
  where booking_code=upper(btrim(p_booking_code)) and stay_type='short_let'
  for update;
  if v_res.id is null or not public.current_actor_can_host_reservation(v_res.id) then
    raise exception 'This Short Let booking is not assigned to you';
  end if;
  select * into v_result from public.activate_short_stay(v_res.id,p_check_in_date);
  return v_result;
end
$$;
revoke all on function public.host_confirm_short_stay_check_in(text,date) from public,anon;
grant execute on function public.host_confirm_short_stay_check_in(text,date) to authenticated;

create or replace function public.host_confirm_long_let_handover(
  p_booking_code text,p_start_date date default timezone('Africa/Lagos',now())::date
) returns public.reservations
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_result public.reservations;
begin
  select * into v_res from public.reservations
  where booking_code=upper(btrim(p_booking_code)) and coalesce(stay_type,'long_stay')='long_stay'
  for update;
  if v_res.id is null or not public.current_actor_can_host_reservation(v_res.id) then
    raise exception 'This Long Let booking is not assigned to you';
  end if;
  if p_start_date is distinct from timezone('Africa/Lagos',v_res.requested_move_in_at)::date then
    raise exception 'The tenancy start date must match the customer move-in request';
  end if;
  -- activate_apartment_tenancy is replaced by the next migration/function body update
  -- and uses current_actor_can_host_reservation as its authority gate.
  select * into v_result from public.activate_apartment_tenancy(v_res.id,p_start_date);
  return v_result;
end
$$;
revoke all on function public.host_confirm_long_let_handover(text,date) from public,anon;
grant execute on function public.host_confirm_long_let_handover(text,date) to authenticated;
