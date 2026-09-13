-- A Worker approved while onboarding is free stays approved when the fee is
-- enabled later. The current fee switch gates new submissions, not old work.

create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_payment public.booking_payments;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_paid boolean:=false;
  v_payment_required boolean:=true;
  v_payment_complete boolean:=false;
  v_days integer:=public.worker_identity_recheck_days();
  v_identity_current boolean:=false;
  v_due_at timestamptz;
  v_days_remaining integer;
begin
  select * into v_profile from public.profiles
  where auth_id=auth.uid()::text and role='worker' limit 1;
  if v_profile is null then raise exception 'Worker profile not found'; end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true)
  into v_payment_required from public.platform_settings
  where key='worker_verification_fee_enabled' and coalesce(is_active,true)
  limit 1;
  v_payment_required:=coalesce(v_payment_required,true);
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications
  where worker_id=v_profile.user_id order by created_at desc limit 1;
  select * into v_payment from public.booking_payments
  where user_id=v_profile.user_id and purpose='worker_verification'
  order by created_at desc limit 1;
  select * into v_identity from public.worker_identity_checks
  where worker_id=v_profile.user_id;
  v_paid:=coalesce(v_payment.status in ('paid','completed'),false);
  v_payment_complete:=v_paid or not v_payment_required or coalesce(
    v_profile.worker_status='verified' and v_profile.worker_verified,
    false
  );
  if v_identity.status='passed' and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=greatest(
      0,
      ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer
    );
  end if;
  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'live',coalesce(
      v_profile.worker_status='verified'
      and v_profile.worker_verified
      and v_identity_current,
      false
    ),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'payment_required',v_payment_required and not coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,
      false
    ),
    'payment_confirmed',v_payment_complete,
    'fee_waived',not v_paid and coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,
      false
    ),
    'gold_badge',coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,
      false
    ),
    'identity_required',true,
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
      select rejection_reason from public.worker_verification_reviews
      where worker_id=v_profile.user_id order by created_at desc limit 1
    )
  );
end;
$$;

drop function if exists public.get_public_workers(text,text,text);
create function public.get_public_workers(
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
  coverage jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  return query
  select
    profile.user_id,
    profile.full_name,
    profile.username,
    profile.avatar_url,
    profile.bio,
    profile.state,
    profile.city,
    profile.local_government,
    profile.area,
    profile.worker_occupation,
    profile.worker_skills,
    profile.worker_price,
    profile.worker_bio,
    profile.worker_experience,
    profile.rating,
    profile.review_count,
    profile.is_online,
    profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,
        'price',service.price,
        'price_type',service.price_type
      ))
      from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage_row.state,
        'lga',coverage_row.lga,
        'areas',coverage_row.areas
      ))
      from public.worker_service_coverage coverage_row
      where coverage_row.worker_id=profile.user_id
    ),'[]'::jsonb)
  from public.profiles profile
  where profile.role='worker'
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and profile.deleted=false
    and profile.suspended=false
    and profile.banned=false
    and public.worker_identity_is_current(profile.user_id)
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
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end;
$$;

revoke all on function public.get_my_worker_activation() from public,anon;
grant execute on function public.get_my_worker_activation()
  to authenticated,service_role;
revoke all on function public.get_public_workers(text,text,text)
  from public,anon;
grant execute on function public.get_public_workers(text,text,text)
  to authenticated,service_role;
