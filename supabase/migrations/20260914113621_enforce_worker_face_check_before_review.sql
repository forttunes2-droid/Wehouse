begin;

-- A Worker face check is an identity prerequisite for WeHouse review.  The
-- launch setting may control rollout, but it must never turn the prerequisite
-- into an automatic pass.
create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_identity_current boolean:=false;
  v_identity_checks_enabled boolean:=false;
  v_marketplace_enabled boolean:=false;
  v_days integer:=public.worker_identity_recheck_days();
  v_due_at timestamptz;
  v_days_remaining integer;
  v_pro_active boolean:=false;
begin
  select * into v_profile
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Worker profile not found'; end if;

  select coalesce(lower(setting.value) in ('true','1','yes','on'),false)
  into v_identity_checks_enabled
  from public.platform_settings setting
  where setting.key='worker_identity_checks_enabled'
    and setting.is_active=true
  limit 1;
  select coalesce(lower(setting.value) in ('true','1','yes','on'),false)
  into v_marketplace_enabled
  from public.platform_settings setting
  where setting.key='worker_marketplace_launch_enabled'
    and setting.is_active=true
  limit 1;

  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications verification
  where verification.worker_id=v_profile.user_id
  order by verification.created_at desc limit 1;
  select * into v_identity from public.worker_identity_checks identity_check
  where identity_check.worker_id=v_profile.user_id;

  if v_identity.status='passed' and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=greatest(
      0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer
    );
  end if;
  v_pro_active:=public.worker_pro_is_active(v_profile.user_id);

  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'reviewed',coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,false
    ),
    'live',coalesce(
      v_profile.worker_status='verified'
      and v_profile.worker_verified
      and v_identity_current
      and v_marketplace_enabled,
      false
    ),
    'marketplace_enabled',coalesce(v_marketplace_enabled,false),
    'profile_complete',v_profile_ready,
    'payment_status','not_required',
    'payment_required',false,
    'payment_confirmed',true,
    'fee_waived',true,
    'pro_active',v_pro_active,
    'identity_required',true,
    'identity_checks_enabled',coalesce(v_identity_checks_enabled,false),
    'identity_status',case
      when v_identity.status='passed' and not v_identity_current then 'expired'
      else coalesce(v_identity.status,'not_started')
    end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
    'identity_days_remaining',v_days_remaining,
    'test_passed',true,
    'test_percent',100,
    'test_attempts_24h',0,
    'evidence_saved',coalesce(
      nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,
      false
    ),
    'submitted',coalesce(
      v_profile.worker_status='profile_under_review'
      and v_ver.submitted_at is not null,
      false
    ),
    'review_status',v_ver.status,
    'rejection_reason',(
      select review.rejection_reason
      from public.worker_verification_reviews review
      where review.worker_id=v_profile.user_id
      order by review.created_at desc limit 1
    )
  );
end;
$$;

create or replace function public.save_my_worker_professional_evidence(
  p_certificate_path text,
  p_video_path text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Active Worker account required'; end if;
  if v_profile.worker_status='verified' then
    raise exception 'Live Worker evidence changes require a new review process';
  end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then
    raise exception 'Complete your Worker profile and service coverage first';
  end if;
  if not public.worker_identity_is_current(v_profile.user_id) then
    raise exception 'Complete the private live-face check before adding work evidence';
  end if;
  if nullif(btrim(coalesce(p_video_path,'')),'') is null then
    raise exception 'Skill demonstration video is required';
  end if;
  if split_part(p_video_path,'/',1)<>v_profile.user_id then
    raise exception 'Invalid Worker video path';
  end if;
  if nullif(btrim(coalesce(p_certificate_path,'')),'') is not null
     and split_part(p_certificate_path,'/',1)<>v_profile.user_id then
    raise exception 'Invalid Worker certificate path';
  end if;

  insert into public.worker_verifications(
    worker_id,certificate_path,verification_video_url,status,
    submitted_at,created_at,updated_at
  ) values(
    v_profile.user_id,
    nullif(btrim(coalesce(p_certificate_path,'')),''),
    btrim(p_video_path),'evidence_ready',null,now(),now()
  )
  on conflict(worker_id) do update set
    certificate_path=excluded.certificate_path,
    verification_video_url=excluded.verification_video_url,
    status='evidence_ready',
    submitted_at=null,
    reviewed_by=null,
    review_notes=null,
    reviewed_at=null,
    updated_at=now()
  returning id into v_id;

  update public.profiles
  set worker_status='pending',worker_verified=false,available=false,
      worker_cert_url=nullif(btrim(coalesce(p_certificate_path,'')),''),
      worker_video_url=btrim(p_video_path),updated_at=now()
  where user_id=v_profile.user_id;
  return v_id;
end;
$$;

create or replace function public.submit_my_worker_verification()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
begin
  select * into v_profile
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Active Worker account required'; end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then
    raise exception 'Complete your Worker profile and service coverage first';
  end if;
  if not public.worker_identity_is_current(v_profile.user_id) then
    raise exception 'Complete the private live-face check before submission';
  end if;
  select * into v_ver
  from public.worker_verifications verification
  where verification.worker_id=v_profile.user_id
  limit 1;
  if v_ver.id is null
     or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
    raise exception 'A work demonstration video is required before review';
  end if;

  update public.worker_verifications
  set status='profile_under_review',submitted_at=now(),updated_at=now()
  where id=v_ver.id;
  update public.profiles
  set worker_status='profile_under_review',worker_verified=false,
      available=false,updated_at=now()
  where user_id=v_profile.user_id;
end;
$$;

-- Remove the old rollout-flag bypass from the ordinary discovery projection.
-- Featured discovery already requires a current identity check.
create or replace function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,full_name text,username text,avatar_url text,bio text,
  state text,city text,local_government text,area text,
  worker_occupation text,worker_skills jsonb,worker_price integer,
  worker_bio text,worker_experience text,rating numeric,review_count integer,
  is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb,
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
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select coalesce(lower(setting.value) in('true','1','yes','on'),false)
  into v_marketplace_enabled
  from public.platform_settings setting
  where setting.key='worker_marketplace_launch_enabled'
    and setting.is_active=true
  limit 1;
  if not coalesce(v_marketplace_enabled,false) then return; end if;

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
end;
$$;

-- The final release makes biometric processing optional and policy-gated.
-- Preserve existing professional review submissions and their audit history;
-- a schema upgrade must not silently cancel an Operations review. New review
-- actions use the server-side policy gate installed later in this release.

-- Repair the old client-helper semantics: payment, queue entry and rejection
-- never mean that WeHouse approved the Worker.
update public.profiles profile
set worker_verified=false,available=false,updated_at=now()
where public.user_has_active_workspace(profile.user_id,'worker')
  and coalesce(profile.worker_status,'pending')<>'verified'
  and (coalesce(profile.worker_verified,false) or coalesce(profile.available,false));

drop policy if exists worker_services_verified_public_select
on public.worker_services;
create policy worker_services_verified_public_select
on public.worker_services
for select
to authenticated
using(
  public.user_has_active_workspace(worker_id,'worker')
  and public.worker_identity_is_current(worker_id)
  and exists(
    select 1 from public.profiles worker
    where worker.user_id=worker_services.worker_id
      and worker.worker_status='verified'
      and coalesce(worker.worker_verified,false)
      and coalesce(worker.available,false)
      and not coalesce(worker.deleted,false)
      and not coalesce(worker.suspended,false)
      and not coalesce(worker.banned,false)
  )
);

drop policy if exists worker_coverage_public_read
on public.worker_service_coverage;
create policy worker_coverage_public_read
on public.worker_service_coverage
for select
to authenticated
using(
  public.user_has_active_workspace(worker_id,'worker')
  and public.worker_identity_is_current(worker_id)
  and exists(
    select 1 from public.profiles worker
    where worker.user_id=worker_service_coverage.worker_id
      and worker.worker_status='verified'
      and coalesce(worker.worker_verified,false)
      and coalesce(worker.available,false)
      and not coalesce(worker.deleted,false)
      and not coalesce(worker.suspended,false)
      and not coalesce(worker.banned,false)
  )
);

drop policy if exists worker_showcase_select
on public.worker_showcase_posts;
create policy worker_showcase_select
on public.worker_showcase_posts
for select
to authenticated
using(
  deleted_at is null
  and (
    worker_id=public.current_profile_user_id()
    or (
      hidden_at is null
      and kind='work_post'
      and public.user_has_active_workspace(worker_id,'worker')
      and public.worker_identity_is_current(worker_id)
      and exists(
        select 1 from public.profiles worker
        where worker.user_id=worker_showcase_posts.worker_id
          and worker.worker_status='verified'
          and coalesce(worker.worker_verified,false)
          and not coalesce(worker.deleted,false)
          and not coalesce(worker.suspended,false)
          and not coalesce(worker.banned,false)
      )
    )
  )
);

revoke all on function public.get_my_worker_activation() from public,anon;
grant execute on function public.get_my_worker_activation()
to authenticated,service_role;
revoke all on function public.save_my_worker_professional_evidence(text,text)
from public,anon;
grant execute on function public.save_my_worker_professional_evidence(text,text)
to authenticated,service_role;
revoke all on function public.submit_my_worker_verification()
from public,anon;
grant execute on function public.submit_my_worker_verification()
to authenticated,service_role;
revoke all on function public.get_public_workers(text,text,text)
from public,anon;
grant execute on function public.get_public_workers(text,text,text)
to authenticated,service_role;

comment on function public.submit_my_worker_verification() is
  'Submits complete Worker evidence to WeHouse only after a current private live-face check.';

commit;
