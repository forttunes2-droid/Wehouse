-- Keep Creator team totals aligned with actual active assignments.
-- Allow Creator/Admin accounts to test eligible Worker discovery while the
-- public Worker marketplace launch gate remains disabled. This does not enable
-- the marketplace for ordinary users.

create or replace function public.creator_get_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Active Creator workspace required';
  end if;
  return jsonb_build_object(
    'accounts',(select count(*) from public.profiles p where p.deleted_at is null and not coalesce(p.deleted,false)),
    'partners',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'property_partner')),
    'workers',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'worker')),
    'team',(
      select count(*)
      from (
        select p.user_id
        from public.profiles p
        where public.user_has_active_workspace(p.user_id,'admin')
        union
        select p.user_id
        from public.profiles p
        where public.user_has_active_workspace(p.user_id,'staff')
          and exists(
            select 1
            from public.staff_permissions sp
            where sp.staff_id=p.user_id
              and sp.is_active=true
              and sp.revoked_at is null
              and public.canonical_staff_domain(sp.permission) is not null
          )
      ) active_team
    ),
    'apartments',(select count(*) from public.listings l where l.deleted_at is null and l.status='available'),
    'hotels',(select count(*) from public.hotels h where h.status='active'),
    'hotel_team',(select count(distinct m.member_user_id) from public.hotel_team_members m join public.profiles p on p.user_id=m.member_user_id
      where m.status='active' and m.revoked_at is null and p.deleted_at is null
        and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)),
    'pending_reviews',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'worker') and p.worker_status='profile_under_review'),
    'inspections',(select count(*) from public.inspection_requests r where r.status in('pending','scheduled','in_progress')),
    'payouts',(select count(*) from public.withdrawals w where w.status in('awaiting_review','processing'))
  );
end
$$;

create or replace function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  state text,
  city text,
  local_government text,
  area text,
  worker_occupation text,
  worker_skills jsonb,
  worker_price integer,
  worker_bio text,
  worker_experience text,
  rating numeric,
  review_count integer,
  is_online boolean,
  last_seen timestamptz,
  services jsonb,
  coverage jsonb,
  pro_active boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_marketplace_enabled boolean:=false;
  v_internal_preview boolean:=false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_internal_preview :=
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null);

  select coalesce(lower(setting.value) in('true','1','yes','on'),false)
  into v_marketplace_enabled
  from public.platform_settings setting
  where setting.key='worker_marketplace_launch_enabled'
    and setting.is_active=true
  limit 1;

  if not coalesce(v_marketplace_enabled,false)
     and not coalesce(v_internal_preview,false) then
    return;
  end if;

  return query
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,'price',service.price,
        'price_type',service.price_type
      ))
      from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage_row.state,'lga',coverage_row.lga,
        'areas',coverage_row.areas
      ))
      from public.worker_service_coverage coverage_row
      where coverage_row.worker_id=profile.user_id
    ),'[]'::jsonb),
    public.worker_pro_is_active(profile.user_id)
  from public.profiles profile
  where public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and public.worker_identity_is_current(profile.user_id)
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
    and (
      p_state is null
      or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state)
    )
    and (
      p_city is null
      or profile.city ilike p_city
      or profile.local_government ilike p_city
    )
    and (
      p_occupation is null
      or profile.worker_occupation ilike p_occupation
    )
    and not exists(
      select 1
      from public.worker_user_blocks blocked_pair
      where v_actor is not null
        and (
          (blocked_pair.blocker_user_id=v_actor
            and blocked_pair.blocked_user_id=profile.user_id)
          or
          (blocked_pair.blocker_user_id=profile.user_id
            and blocked_pair.blocked_user_id=v_actor)
        )
    )
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end
$$;
