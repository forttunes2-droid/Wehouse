-- Structural internal profile projection for Creator/Admin profile inspection.
-- Keeps workspace grants private from ordinary users while giving authorized
-- internal actors one safe, branch-scoped record to power profile navigation.

create or replace function public.get_internal_profile_record(p_target_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_is_creator boolean := false;
  v_is_admin boolean := false;
  v_admin_state text;
  v_admin_lga text;
  v_target_state text;
  v_target_lga text;
  v_workspaces jsonb := '[]'::jsonb;
  v_apartments jsonb := '[]'::jsonb;
  v_hotels jsonb := '[]'::jsonb;
  v_hotel_team jsonb := '[]'::jsonb;
  v_provider jsonb := null;
  v_team jsonb := '[]'::jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is null then
    raise exception 'Active WeHouse account required';
  end if;

  v_is_creator := exists(
    select 1 from public.workspace_role_assignments w
    where w.user_id=v_actor.user_id
      and w.workspace_role='creator'
      and w.status='active'
      and w.revoked_at is null
  ) or v_actor.role='creator';

  v_is_admin := exists(
    select 1 from public.workspace_role_assignments w
    where w.user_id=v_actor.user_id
      and w.workspace_role='admin'
      and w.status='active'
      and w.revoked_at is null
  ) or v_actor.role='admin';

  if not v_is_creator and not v_is_admin then
    raise exception 'Creator or Admin workspace required';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
  limit 1;

  if v_target.user_id is null then
    raise exception 'Account not found';
  end if;

  if v_is_admin and not v_is_creator then
    select
      coalesce(nullif(w.scope_state,''),nullif(v_actor.assigned_state,''),nullif(v_actor.state,'')),
      coalesce(nullif(w.scope_lga,''),nullif(v_actor.assigned_lga,''),nullif(v_actor.local_government,''),nullif(v_actor.city,''))
    into v_admin_state,v_admin_lga
    from public.workspace_role_assignments w
    where w.user_id=v_actor.user_id
      and w.workspace_role='admin'
      and w.status='active'
      and w.revoked_at is null
    order by w.granted_at desc nulls last
    limit 1;

    v_admin_state := coalesce(v_admin_state,nullif(v_actor.assigned_state,''),nullif(v_actor.state,''));
    v_admin_lga := coalesce(v_admin_lga,nullif(v_actor.assigned_lga,''),nullif(v_actor.local_government,''),nullif(v_actor.city,''));
    v_target_state := coalesce(nullif(v_target.assigned_state,''),nullif(v_target.state,''));
    v_target_lga := coalesce(nullif(v_target.assigned_lga,''),nullif(v_target.local_government,''),nullif(v_target.city,''));

    if v_admin_state is null or v_admin_lga is null
       or v_target_state is null or v_target_lga is null
       or lower(v_target_state)<>lower(v_admin_state)
       or lower(v_target_lga)<>lower(v_admin_lga) then
      raise exception 'Account is outside your Admin branch';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'role',w.workspace_role,
    'scope_type',w.scope_type,
    'scope_state',w.scope_state,
    'scope_lga',w.scope_lga,
    'status',w.status,
    'granted_at',w.granted_at
  ) order by w.workspace_role,w.granted_at),'[]'::jsonb)
  into v_workspaces
  from public.workspace_role_assignments w
  where w.user_id=p_target_user_id
    and w.status='active'
    and w.revoked_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,
    'title',l.title,
    'sub_type',l.sub_type,
    'status',l.status,
    'price',l.price,
    'city',l.city,
    'state',l.state,
    'address',l.address,
    'images',to_jsonb(coalesce(l.images,'{}'::text[])),
    'created_at',l.created_at
  ) order by l.created_at desc),'[]'::jsonb)
  into v_apartments
  from public.listings l
  where (l.partner_id=p_target_user_id or l.owner_id=p_target_user_id)
    and l.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'hotel_id',h.hotel_id,
    'name',h.name,
    'status',h.status,
    'city',h.city,
    'state',h.state,
    'area',h.area,
    'address',h.address,
    'images',to_jsonb(coalesce(h.images,'{}'::text[])),
    'created_at',h.created_at
  ) order by h.created_at desc),'[]'::jsonb)
  into v_hotels
  from public.hotels h
  where h.owner_id=p_target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'membership_id',tm.id,
    'hotel_id',tm.hotel_id,
    'hotel_name',h.name,
    'hotel_role',tm.hotel_role,
    'status',tm.status,
    'capabilities',to_jsonb(coalesce(tm.capabilities,'{}'::text[])),
    'city',h.city,
    'state',h.state,
    'created_at',tm.created_at
  ) order by tm.created_at desc),'[]'::jsonb)
  into v_hotel_team
  from public.hotel_team_members tm
  join public.hotels h on h.hotel_id=tm.hotel_id
  where tm.member_user_id=p_target_user_id
    and tm.status in('active','accepted');

  if exists(
    select 1 from public.workspace_role_assignments w
    where w.user_id=p_target_user_id and w.workspace_role='worker'
      and w.status='active' and w.revoked_at is null
  ) or v_target.role='worker' then
    select jsonb_build_object(
      'reviewed',coalesce(v_target.worker_verified,false),
      'occupation',v_target.worker_occupation,
      'experience',v_target.worker_experience,
      'price',v_target.worker_price,
      'bio',v_target.worker_bio,
      'skills',coalesce(v_target.worker_skills,'[]'::jsonb),
      'jobs',coalesce((select count(*) from public.worker_bookings b where b.worker_id=p_target_user_id),0),
      'completed_jobs',coalesce((select count(*) from public.worker_bookings b where b.worker_id=p_target_user_id and b.status='approved_released'),0),
      'completed_job_earnings',coalesce((select sum(coalesce(b.worker_receives,0)) from public.worker_bookings b where b.worker_id=p_target_user_id and b.status='approved_released'),0),
      'review_count',coalesce((select count(*) from public.reviews r where r.worker_id=p_target_user_id),0),
      'average_rating',coalesce((select round(avg(r.rating)::numeric,2) from public.reviews r where r.worker_id=p_target_user_id),0)
    ) into v_provider;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'role',w.workspace_role,
    'scope_type',w.scope_type,
    'scope_state',w.scope_state,
    'scope_lga',w.scope_lga,
    'status',w.status,
    'granted_at',w.granted_at,
    'permission',case when w.workspace_role='staff' then (
      select sp.permission from public.staff_permissions sp
      where sp.staff_id=w.user_id and sp.is_active=true
      order by sp.assigned_at desc limit 1
    ) else null end
  ) order by w.workspace_role),'[]'::jsonb)
  into v_team
  from public.workspace_role_assignments w
  where w.user_id=p_target_user_id
    and w.workspace_role in('staff','admin','creator')
    and w.status='active'
    and w.revoked_at is null;

  return jsonb_build_object(
    'account',jsonb_build_object(
      'user_id',v_target.user_id,
      'full_name',v_target.full_name,
      'username',v_target.username,
      'email',v_target.email,
      'phone',v_target.phone,
      'avatar_url',v_target.avatar_url,
      'state',v_target.state,
      'local_government',v_target.local_government,
      'city',v_target.city,
      'created_at',v_target.created_at,
      'deleted',coalesce(v_target.deleted,false),
      'suspended',coalesce(v_target.suspended,false),
      'banned',coalesce(v_target.banned,false)
    ),
    'workspaces',v_workspaces,
    'service_provider',v_provider,
    'apartments',v_apartments,
    'hotels_owned',v_hotels,
    'hotel_team',v_hotel_team,
    'wehouse_team',v_team
  );
end;
$function$;

revoke all on function public.get_internal_profile_record(text) from public, anon;
grant execute on function public.get_internal_profile_record(text) to authenticated;
