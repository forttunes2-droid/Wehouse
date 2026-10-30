begin;
-- A read-only projection of the existing identity and authoritative work coverage.
-- No new account, profile table, evidence copy, market or permission is created.
create view private.worker_operating_profiles with (security_invoker=true) as
select person.id as id,
 person.auth_id as auth_id,
 person.email as email,
 person.username as username,
 person.role as role,
 person.user_id as user_id,
 person.profile_complete as profile_complete,
 person.created_at as created_at,
 person.updated_at as updated_at,
 person.avatar_url as avatar_url,
 person.bio as bio,
 person.phone as phone,
 person.occupation as occupation,
 person.is_student as is_student,
 person.school as school,
 person.gender as gender,
 person.budget_min as budget_min,
 person.budget_max as budget_max,
 person.preferred_location as preferred_location,
 person.email_verified as email_verified,
 person.phone_verified as phone_verified,
 person.id_verified as id_verified,
 person.is_online as is_online,
 person.last_seen as last_seen,
 person.worker_status as worker_status,
 person.full_name as full_name,
 case when coverage.worker_id is null then person.country else country.name end as country,
 coalesce(coverage.state,person.state) as state,
 coalesce(coverage.lga,person.city) as city,
 coalesce(array_to_string(coverage.areas,', '),person.area) as area,
 person.worker_occupation as worker_occupation,
 person.worker_bio as worker_bio,
 person.worker_verified as worker_verified,
 person.deleted as deleted,
 person.deleted_at as deleted_at,
 person.assigned_state as assigned_state,
 person.assigned_lga as assigned_lga,
 person.scope as scope,
 person.created_by as created_by,
 person.updated_by as updated_by,
 person.maintenance_exempt as maintenance_exempt,
 person.is_premium as is_premium,
 person.premium_expires_at as premium_expires_at,
 person.worker_price as worker_price,
 person.worker_skills as worker_skills,
 person.worker_experience as worker_experience,
 person.worker_gov_id_url as worker_gov_id_url,
 person.worker_cert_url as worker_cert_url,
 person.worker_video_url as worker_video_url,
 person.pref_email_notif as pref_email_notif,
 person.pref_push_notif as pref_push_notif,
 person.suspended as suspended,
 person.suspended_at as suspended_at,
 person.suspended_by as suspended_by,
 person.suspended_reason as suspended_reason,
 person.banned as banned,
 person.banned_at as banned_at,
 person.banned_by as banned_by,
 person.banned_reason as banned_reason,
 coalesce(coverage.lga,person.local_government) as local_government,
 person.privacy_profile_visible as privacy_profile_visible,
 person.privacy_search_visible as privacy_search_visible,
 person.privacy_activity_visible as privacy_activity_visible,
 person.privacy_email_visible as privacy_email_visible,
 person.privacy_phone_visible as privacy_phone_visible,
 person.rating as rating,
 person.review_count as review_count,
 person.available as available,
 person.operational_latitude as operational_latitude,
 person.operational_longitude as operational_longitude,
 person.operational_location_accuracy_m as operational_location_accuracy_m,
 person.operational_location_updated_at as operational_location_updated_at,
 person.terms_accepted_at as terms_accepted_at,
 person.privacy_accepted_at as privacy_accepted_at,
 person.legal_accepted_version as legal_accepted_version,
 person.account_kind as account_kind,
 person.precise_latitude as precise_latitude,
 person.precise_longitude as precise_longitude,
 person.precise_address as precise_address,
 person.precise_location_accuracy_m as precise_location_accuracy_m,
 person.precise_location_updated_at as precise_location_updated_at
from public.profiles person left join public.worker_service_coverage coverage on coverage.worker_id=person.user_id
left join public.platform_countries country on country.country_code=coverage.country_code;
revoke all on private.worker_operating_profiles from public,anon,authenticated;
create function private.worker_operating_profile(p_worker_id text) returns public.profiles
language sql stable security definer set search_path='' as $$
 select p.* from private.worker_operating_profiles p where p.user_id=p_worker_id;
$$;
revoke all on function private.worker_operating_profile(text) from public,anon,authenticated;

-- Preserve accepted legacy country spellings/state context when coverage is unchanged.
-- Real occupation, skill, category, country or regional coverage changes still invalidate.
create or replace function private.worker_credential_context(p_worker_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 with current_work as (
 select p.*,v.service_category_id,v.service_subcategory_id,v.credential_context,
  coalesce(c.country_code,case when coverage.worker_id is null then home_country.country_code end) operating_country,
  coalesce((select jsonb_agg(jsonb_build_object('state',scope.state,'lga',scope.lga) order by scope.state,scope.lga)
    from public.worker_service_coverage scope where scope.worker_id=p.user_id),'[]'::jsonb) coverage_context
 from private.worker_operating_profiles p
 left join public.worker_verifications v on v.worker_id=p.user_id
 left join public.worker_service_coverage coverage on coverage.worker_id=p.user_id
 left join public.platform_countries c on c.country_code=coverage.country_code
 left join public.platform_countries home_country on lower(btrim(p.country)) in(lower(home_country.country_code),lower(home_country.name)))
 select jsonb_build_object('occupation',p.worker_occupation,'skills',p.worker_skills,
  'country',case when p.credential_context ? 'country' and exists(select 1 from public.platform_countries old_country
    where old_country.country_code=p.operating_country and (lower(btrim(p.credential_context->>'country')) in(lower(old_country.country_code),lower(old_country.name))
     or old_country.country_code='NG' and nullif(btrim(p.credential_context->>'country'),'') is null))
    then p.credential_context->'country' else to_jsonb(p.country) end,
  'state',case when p.credential_context->'coverage'=p.coverage_context then p.credential_context->'state' else to_jsonb(p.state) end,
  'category_id',p.service_category_id,'subcategory_id',p.service_subcategory_id,'coverage',p.coverage_context)
 from current_work p;
$$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query
  select jsonb_populate_record(null::public.profiles,
    to_jsonb(p)-array['auth_id','creator_auth_password','creator_auth_enabled',
      'worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  from private.worker_operating_profiles p
  where public.user_has_active_workspace(p.user_id,'worker') and p.deleted_at is null
    and (v_actor.role='creator' or public.wehouse_state_key(p.state)
      =public.wehouse_state_key(v_actor.assigned_state))
  order by p.created_at desc;
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.admin_get_my_branch_worker_booking_summaries()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_code',wb.booking_code,'service_type',wb.service_type,
    'status',wb.status,'negotiated_amount',coalesce(wb.negotiated_amount,wb.agreed_amount,0),
    'scheduled_date',wb.scheduled_date,'created_at',wb.created_at,
    'updated_at',wb.updated_at,'worker_name',coalesce(w.full_name,w.username,'Worker'),
    'customer_name',coalesce(c.full_name,c.username,'Customer'),
    'needs_attention',(wb.status in('booking_requested','waiting_payment','completed_pending_approval','disputed')
      or exists(select 1 from public.booking_payments bp where bp.worker_booking_id=wb.id and bp.status='review_required')),
    'has_dispute',wb.status='disputed',
    'payment_review_required',exists(select 1 from public.booking_payments bp where bp.worker_booking_id=wb.id and bp.status='review_required')
  ) order by wb.updated_at desc),'[]'::jsonb) into v_result
  from public.worker_bookings wb
  join private.worker_operating_profiles w on w.user_id=wb.worker_id
  join public.profiles c on c.user_id=wb.user_id
  where v_actor.role='creator' or public.wehouse_state_key(w.state)
    =public.wehouse_state_key(v_actor.assigned_state);
  return v_result;
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.admin_get_my_branch_worker_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  select coalesce(jsonb_agg(to_jsonb(wb) order by wb.created_at desc),'[]'::jsonb)
  into v_result from public.worker_bookings wb
  join private.worker_operating_profiles w on w.user_id=wb.worker_id
  where v_actor.role='creator' or public.wehouse_state_key(w.state)
    =public.wehouse_state_key(v_actor.assigned_state);
  return v_result;
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_worker public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is null
     or not (
       public.current_actor_has_workspace('staff',null)
       or public.current_actor_has_workspace('admin',null)
       or public.current_actor_has_workspace('creator',null)
     ) then
    raise exception 'WeHouse Team access required';
  end if;

  if public.current_actor_has_workspace('staff',null)
     and not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations access required';
  end if;

  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker');
 v_worker:=private.worker_operating_profile(v_worker.user_id);

  if v_worker.user_id is null then
    raise exception 'Worker not found';
  end if;

  if not public.current_actor_has_workspace('creator',null)
     and not public.current_actor_in_scope(
       v_worker.state,coalesce(nullif(v_worker.local_government,''),v_worker.city)
     ) then
    raise exception 'Worker is outside your assigned scope';
  end if;

  return public._worker_review_trust_payload(p_worker_id);
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(p_worker_id text, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications;
begin
  v_actor:=public._admin_dashboard_actor();
  select * into v_worker from public.profiles
  where user_id=p_worker_id and public.user_has_active_workspace(user_id,'worker') and not coalesce(deleted,false)
  for update;
 v_worker:=private.worker_operating_profile(v_worker.user_id);
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;
  if v_actor.role='admin' and public.wehouse_state_key(v_worker.state)
     <>public.wehouse_state_key(v_actor.assigned_state) then
    raise exception 'Worker is outside your assigned State';
  end if;
  if v_worker.worker_status<>'profile_under_review' then
    raise exception 'Worker is not in the review queue';
  end if;
  select * into v_ver from public.worker_verifications where worker_id=p_worker_id limit 1;
  if p_decision='approve' then
    if not public.worker_identity_is_current(p_worker_id) then
      raise exception 'The current private face check has not passed'; end if;
    if v_ver.id is null or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
      raise exception 'Professional work evidence is incomplete'; end if;
    update public.profiles set worker_status='verified',worker_verified=true,
      available=true,updated_at=now(),updated_by=v_actor.user_id where user_id=p_worker_id;
    update public.worker_verifications set status='verified',reviewed_by=v_actor.user_id,
      reviewed_at=now(),updated_at=now() where id=v_ver.id;
  elsif p_decision='reject' then
    if nullif(btrim(coalesce(p_reason,'')),'') is null then
      raise exception 'Rejection reason is required'; end if;
    update public.profiles set worker_status='rejected',worker_verified=false,
      available=false,updated_at=now(),updated_by=v_actor.user_id where user_id=p_worker_id;
    update public.worker_verifications set status='rejected',reviewed_by=v_actor.user_id,
      review_notes=btrim(p_reason),reviewed_at=now(),updated_at=now() where id=v_ver.id;
  else raise exception 'Decision must be approve or reject'; end if;
  insert into public.worker_verification_reviews(
    worker_id,reviewer_id,reviewer_role,action,rejection_reason
  ) values(p_worker_id,v_actor.user_id,v_actor.role,
    case when p_decision='approve' then 'approved' else 'rejected' end,
    case when p_decision='reject' then btrim(p_reason) end);
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.current_actor_can_access_worker_booking(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_actor public.profiles; v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  SELECT w.* INTO v_worker FROM public.worker_bookings b
  JOIN private.worker_operating_profiles w ON w.user_id=b.worker_id WHERE b.id=p_booking_id LIMIT 1;
  IF v_worker IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_in_scope(v_worker.state,COALESCE(v_worker.local_government,v_worker.city));
END;
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.current_oversight_can_review_worker(p_worker_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.user_has_active_workspace(p_worker_id,'worker')
    and (public.current_actor_has_workspace('creator',null)
      or (public.current_actor_has_workspace('admin',null)
        and exists(select 1 from private.worker_operating_profiles p where p.user_id=p_worker_id
          and public.current_actor_in_scope(p.state,coalesce(nullif(p.local_government,''),p.city)))));
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.current_staff_can_review_worker(p_worker_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_actor_has_workspace('staff',null)
    and public.current_staff_has_permission('worker_operations')
    and public.user_has_active_workspace(p_worker_id,'worker')
    and exists(
      select 1 from private.worker_operating_profiles p
      where p.user_id=p_worker_id
        and public.current_actor_in_scope(
          p.state,coalesce(nullif(p.local_government,''),p.city)
        )
    )
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.emit_worker_review_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_profile public.profiles;
  v_event_id uuid;
  v_event_key text;
  v_lga text;
begin
  if tg_op<>'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_profile
  from public.profiles p
  where p.user_id=new.worker_id
  limit 1;
 v_profile:=private.worker_operating_profile(v_profile.user_id);
  if v_profile.user_id is null then return new; end if;
  v_lga:=coalesce(nullif(v_profile.local_government,''),nullif(v_profile.city,''));

  if new.status='profile_under_review' then
    v_event_key:='worker_review:'||new.id::text||':submitted:'||
      coalesce(new.submitted_at,new.updated_at,now())::text;
    v_event_id:=private.upsert_activity_event(
      v_event_key,
      'worker.review_submitted',
      'worker',
      new.worker_id,
      new.worker_id,
      'Worker profile needs review',
      coalesce(v_profile.full_name,v_profile.username,'A Worker')||
        ' submitted professional evidence for WeHouse review.',
      'operations_workers',
      jsonb_build_object(
        'worker_id',new.worker_id,
        'verification_id',new.id
      ),
      coalesce(new.submitted_at,new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'worker_operations',v_profile.state,v_lga,true
    );
  elsif old.status='profile_under_review'
        and new.status in ('verified','rejected') then
    perform private.resolve_subject_activity(
      'worker',new.worker_id,'worker.review_submitted','worker_operations'
    );
    v_event_id:=private.upsert_activity_event(
      'worker_review:'||new.id::text||':'||new.status||':'||
        coalesce(new.reviewed_at,new.updated_at,now())::text,
      case when new.status='verified'
        then 'worker.review_approved'
        else 'worker.review_rejected' end,
      'worker',
      new.worker_id,
      new.reviewed_by,
      case when new.status='verified'
        then 'Worker profile approved'
        else 'Worker profile needs changes' end,
      case when new.status='verified'
        then 'Your Service Worker profile passed WeHouse review.'
        else coalesce(nullif(btrim(new.review_notes),''),
          'Your Service Worker profile was not approved. Review the feedback and update your profile.') end,
      'worker_dashboard',
      jsonb_build_object(
        'worker_id',new.worker_id,
        'verification_id',new.id
      ),
      coalesce(new.reviewed_at,new.updated_at,now())
    );
    perform private.add_activity_audience(
      v_event_id,new.worker_id,'worker','worker_operations',
      v_profile.state,new.status='rejected'
    );
  end if;
  return new;
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.get_featured_workers(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 3)
 RETURNS TABLE(user_id text, full_name text, username text, avatar_url text, bio text, state text, city text, local_government text, area text, worker_occupation text, worker_skills jsonb, worker_price integer, worker_bio text, worker_experience text, rating numeric, review_count integer, is_online boolean, last_seen timestamp with time zone, services jsonb, coverage jsonb, pro_active boolean, featured_placement_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_enabled boolean:=false;
  v_marketplace_enabled boolean:=false;
  v_slots integer:=3;
  v_limit integer;
  v_context text;
begin
  if (select auth.uid()) is null or v_actor is null then
    raise exception 'Active signed-in account required';
  end if;
  select coalesce(lower(value) in('true','1','yes','on'),false)
    into v_enabled from public.platform_settings
  where key='worker_featured_sales_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false)
    into v_marketplace_enabled from public.platform_settings
  where key='worker_marketplace_launch_enabled' and is_active=true limit 1;
  select greatest(0,least(6,coalesce(nullif(value,'')::integer,3)))
    into v_slots from public.platform_settings
  where key='worker_featured_slot_count' and is_active=true limit 1;
  v_limit:=greatest(0,least(coalesce(p_limit,3),coalesce(v_slots,3),6));
  if not coalesce(v_enabled,false) or not coalesce(v_marketplace_enabled,false)
     or v_limit=0
     or not public._legal_launch_gate_is_approved('worker_featured_placement')
 then
    return;
  end if;
  v_context:=md5(lower(concat_ws('|',btrim(coalesce(p_state,'')),
    btrim(coalesce(p_city,'')),btrim(coalesce(p_query,'')))));

  return query
  with candidates as materialized (
    select profile.user_id
    from private.worker_operating_profiles profile
    where profile.user_id<>v_actor
      and public.user_has_active_workspace(profile.user_id,'worker')
      and profile.worker_status='verified' and profile.worker_verified=true
      and profile.available=true
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
      and public.worker_identity_is_current(profile.user_id)
      and public.worker_professional_profile_ready(profile.user_id)
      and public.worker_pro_is_active(profile.user_id)
      and (p_state is null or btrim(p_state)=''
        or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
      and (p_city is null or btrim(p_city)='' or profile.city ilike p_city
        or profile.local_government ilike p_city)
      and (
        p_query is null or btrim(p_query)=''
        or concat_ws(' ',profile.full_name,profile.username,
          profile.worker_occupation,profile.worker_bio,profile.state,
          profile.city,profile.local_government) ilike '%'||btrim(p_query)||'%'
        or exists(select 1 from public.worker_services service
          where service.worker_id=profile.user_id
            and service.service_name ilike '%'||btrim(p_query)||'%')
        or exists(select 1 from jsonb_array_elements_text(
          case when jsonb_typeof(profile.worker_skills)='array'
            then profile.worker_skills else '[]'::jsonb end
        ) skill(value) where skill.value ilike '%'||btrim(p_query)||'%')
      )
      and not exists(
        select 1 from public.worker_user_blocks blocked_pair where
          (blocked_pair.blocker_user_id=v_actor
            and blocked_pair.blocked_user_id=profile.user_id)
          or (blocked_pair.blocker_user_id=profile.user_id
            and blocked_pair.blocked_user_id=v_actor)
      )
    order by (
      select max(placement.presented_at)
      from public.worker_featured_placements placement
      where placement.worker_id=profile.user_id
    ) asc nulls first,md5(current_date::text||profile.user_id)
    limit v_limit
  ), placed as (
    insert into public.worker_featured_placements(
      viewer_id,worker_id,context_key,impression_day,presented_at,updated_at
    )
    select v_actor,candidate.user_id,v_context,current_date,now(),now()
    from candidates candidate
    on conflict(viewer_id,worker_id,impression_day) do update
    set context_key=excluded.context_key,presented_at=excluded.presented_at,
      updated_at=now()
    returning id,worker_id
  )
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((select jsonb_agg(jsonb_build_object(
      'name',service.service_name,'price',service.price,
      'price_type',service.price_type))
      from public.worker_services service
      where service.worker_id=profile.user_id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'state',coverage.state,'lga',coverage.lga,'areas',coverage.areas))
      from public.worker_service_coverage coverage
      where coverage.worker_id=profile.user_id),'[]'::jsonb),
    true,placed.id
  from placed join private.worker_operating_profiles profile on profile.user_id=placed.worker_id;
end;
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.get_my_staff_worker_review_queue(p_status text DEFAULT 'profile_under_review'::text)
 RETURNS TABLE(user_id text, username text, full_name text, worker_occupation text, worker_experience text, worker_cert_url text, worker_video_url text, state text, local_government text, city text, worker_status text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ DECLARE v_actor public.profiles; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role='staff' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification Staff access required'; END IF; IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN RAISE EXCEPTION 'Staff branch assignment required'; END IF; RETURN QUERY SELECT w.user_id,w.username,w.full_name,w.worker_occupation,w.worker_experience,w.worker_cert_url,w.worker_video_url,w.state,w.local_government,w.city,w.worker_status,w.avatar_url FROM private.worker_operating_profiles w WHERE w.role='worker' AND COALESCE(w.deleted,false)=false AND COALESCE(w.suspended,false)=false AND COALESCE(w.banned,false)=false AND (p_status IS NULL OR p_status='all' OR w.worker_status=p_status) AND lower(COALESCE(w.state,''))=lower(v_actor.assigned_state) AND lower(COALESCE(w.local_government,w.city,''))=lower(v_actor.assigned_lga) ORDER BY w.created_at DESC; END; $function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.get_my_staff_worker_reviews(p_status text DEFAULT 'pending'::text)
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles;
begin
  v_actor:=public._current_team_actor();

  if v_actor.user_id is null
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active WeHouse Team account required';
  end if;

  if v_actor.role='staff'
     and not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations access required';
  end if;

  if v_actor.role not in('staff','admin','creator') then
    raise exception 'WeHouse Team access required';
  end if;

  return query
  select worker.*
  from private.worker_operating_profiles worker
  where public.user_has_active_workspace(worker.user_id,'worker')
    and not coalesce(worker.deleted,false)
    and not coalesce(worker.suspended,false)
    and not coalesce(worker.banned,false)
    and (p_status is null or p_status='all' or worker.worker_status=p_status)
    and (
      v_actor.role='creator'
      or public.current_actor_in_scope(
        worker.state,coalesce(nullif(worker.local_government,''),worker.city)
      )
    )
  order by worker.created_at desc;
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
begin
  v_actor:=public._current_team_actor();

  if v_actor.user_id is null
     or v_actor.role<>'staff'
     or not public.current_actor_has_workspace('staff',null)
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active WeHouse Team account required';
  end if;

  if not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations access required';
  end if;
  if p_status not in ('verified','rejected') then
    raise exception 'Invalid review outcome';
  end if;
  if p_status='rejected'
     and nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Rejection reason is required';
  end if;

  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
  for update;
 v_worker:=private.worker_operating_profile(v_worker.user_id);
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;

  if not public.current_actor_in_scope(
    v_worker.state,coalesce(nullif(v_worker.local_government,''),v_worker.city)
  ) then
    raise exception 'Worker is outside your assigned branch';
  end if;

  select * into v_ver
  from public.worker_verifications
  where worker_id=p_worker_id
  order by created_at desc
  limit 1;

  if p_status='verified' then
    if v_worker.worker_status<>'profile_under_review' then
      raise exception 'Worker is not in the review queue';
    end if;
    if not public.worker_identity_is_current(p_worker_id) then
      raise exception 'The required private identity check has not passed';
    end if;
    if v_ver.id is null
       or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
      raise exception 'Professional work evidence is incomplete';
    end if;
  end if;

  update public.profiles
  set worker_status=p_status,
      worker_verified=(p_status='verified'),
      available=(p_status='verified'),
      updated_at=now(),updated_by=v_actor.user_id
  where user_id=p_worker_id;

  update public.worker_verifications
  set status=p_status,reviewed_by=v_actor.user_id,
      review_notes=coalesce(nullif(btrim(p_notes),''),nullif(btrim(p_reason),'')),
      reviewed_at=now(),updated_at=now()
  where id=v_ver.id;

  insert into public.worker_verification_reviews(
    worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at
  ) values(
    p_worker_id,v_actor.user_id,'staff',p_status,
    case when p_status='rejected' then btrim(p_reason) else null end,
    nullif(btrim(coalesce(p_notes,'')),''),now()
  );
  return true;
end
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION private.worker_credential_document_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.profiles;e uuid;event_type text:='worker.credentials.'||new.requirement_code||'.submitted';
begin
 if new.status is not distinct from old.status then return new;end if;
 if not exists(select 1 from public.worker_verifications v where v.worker_id=new.worker_id and v.credential_revision=new.requirements_revision) then return new;end if;
 select * into p from public.profiles where user_id=new.worker_id;
 p:=private.worker_operating_profile(p.user_id);
 if new.status='submitted' then
  e:=private.upsert_activity_event('worker_credential_review:'||new.worker_id||':'||new.requirement_code,event_type,'worker_credentials',new.worker_id,new.worker_id,
   'Service credential needs review','Review the current privately submitted credential.','staff_dashboard',jsonb_build_object('worker_id',new.worker_id,'document_id',new.id),now());
  perform private.fanout_team_activity(e,'worker_operations',p.state,coalesce(nullif(p.local_government,''),p.city),true);
 elsif new.status in('approved','correction_required','rejected','abandoned') then
  perform private.resolve_subject_activity('worker_credentials',new.worker_id,event_type,'worker_operations');
  if new.status<>'abandoned' then
   e:=private.upsert_activity_event('worker_credential_decision:'||new.id::text||':'||new.status,'worker.credentials.'||new.status,'worker_credentials',new.worker_id,new.reviewed_by,
    case new.status when 'approved' then 'Service credential approved' when 'correction_required' then 'Service credential needs correction' else 'Service credential rejected' end,
    'Open Service Worker onboarding for the persistent review note.','worker_verification',jsonb_build_object('worker_id',new.worker_id,'document_id',new.id),now());
   perform private.add_activity_audience(e,new.worker_id,'worker','services',p.state,new.status<>'approved');
  end if;
 end if;
 if private.worker_credentials_current(new.worker_id) then perform private.resolve_subject_activity('worker_credentials',new.worker_id,'worker.credentials.required','services');end if;
 return new;
end $function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION private.worker_credential_required_activity(p_worker_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.profiles;v public.worker_verifications;e uuid;
begin
 select * into p from public.profiles where user_id=p_worker_id;
 p:=private.worker_operating_profile(p.user_id);
 select * into v from public.worker_verifications where worker_id=p_worker_id;
 if v.credential_requirements is null then return;end if;
 perform private.resolve_subject_activity('worker_credentials',p_worker_id,'worker.credentials.required','services');
 if private.worker_credentials_current(p_worker_id) then return;end if;
 e:=private.upsert_activity_event('worker_credentials_required:'||p_worker_id||':'||v.credential_revision::text||':'||md5(private.worker_credential_context(p_worker_id)::text),
 'worker.credentials.required','worker_credentials',p_worker_id,null,'Service credentials need attention',
 'Review the current requirements or correction notes in Service Worker onboarding.','worker_verification',jsonb_build_object('worker_id',p_worker_id),now());
 perform private.add_activity_audience(e,p_worker_id,'worker','services',p.state,true);
end $function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.creator_get_worker_market_capacity()
 RETURNS TABLE(capacity_id uuid, state_name text, lga_name text, occupation_name text, target_count integer, hard_limit integer, approvals_paused boolean, note text, live_count bigint, remaining bigint, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    rule.capacity_id,
    rule.state_name,
    rule.lga_name,
    rule.occupation_name,
    rule.target_count,
    rule.hard_limit,
    rule.approvals_paused,
    rule.note,
    (
      select count(*)
      from private.worker_operating_profiles worker
      where public.user_has_active_workspace(worker.user_id,'worker')
        and worker.worker_status='verified'
        and worker.worker_verified=true
        and not coalesce(worker.deleted,false)
        and not coalesce(worker.suspended,false)
        and not coalesce(worker.banned,false)
        and public.wehouse_state_key(worker.state)=rule.state_key
        and public.worker_market_text_key(coalesce(nullif(worker.local_government,''),worker.city))=rule.lga_key
        and public.worker_market_text_key(worker.worker_occupation)=rule.occupation_key
    ) as live_count,
    case when rule.hard_limit is null then null
      else greatest(
        rule.hard_limit-(
          select count(*)
          from private.worker_operating_profiles worker
          where public.user_has_active_workspace(worker.user_id,'worker')
            and worker.worker_status='verified'
            and worker.worker_verified=true
            and not coalesce(worker.deleted,false)
            and not coalesce(worker.suspended,false)
            and not coalesce(worker.banned,false)
            and public.wehouse_state_key(worker.state)=rule.state_key
            and public.worker_market_text_key(coalesce(nullif(worker.local_government,''),worker.city))=rule.lga_key
            and public.worker_market_text_key(worker.worker_occupation)=rule.occupation_key
        ),0
      )::bigint
    end as remaining,
    rule.updated_at
  from public.worker_market_capacity rule
  where public.current_actor_has_workspace('creator',null)
  order by rule.state_name,rule.lga_name,rule.occupation_name
$function$;

-- Existing authorization and write locking remain; only Worker geography changes.
CREATE OR REPLACE FUNCTION public.worker_market_capacity_status(p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_worker public.profiles; v_rule public.worker_market_capacity; v_live bigint:=0;
  v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or (p_worker_id<>v_actor and not public.current_actor_has_workspace('creator',null)) then
    raise exception 'Worker capacity status is available only to that Worker or Creator';
  end if;
  select * into v_worker from public.profiles
    where user_id=p_worker_id and public.user_has_active_workspace(user_id,'worker') and not coalesce(deleted,false);
 v_worker:=private.worker_operating_profile(v_worker.user_id);
  if v_worker.user_id is null then return jsonb_build_object('configured',false,'eligible',false,'reason','Worker not found'); end if;
  select * into v_rule from public.worker_market_capacity rule
    where rule.state_key=public.wehouse_state_key(v_worker.state)
      and rule.lga_key=public.worker_market_text_key(coalesce(nullif(v_worker.local_government,''),v_worker.city))
      and rule.occupation_key=public.worker_market_text_key(v_worker.worker_occupation) limit 1;
  if v_rule.capacity_id is null then return jsonb_build_object('configured',false,'eligible',true,
      'state',v_worker.state,'lga',coalesce(nullif(v_worker.local_government,''),v_worker.city),
      'occupation',v_worker.worker_occupation); end if;
  select count(*) into v_live from private.worker_operating_profiles other
    where other.user_id<>v_worker.user_id and other.worker_status='verified' and other.worker_verified=true
      and not coalesce(other.deleted,false) and not coalesce(other.suspended,false) and not coalesce(other.banned,false)
      and public.user_has_active_workspace(other.user_id,'worker')
      and public.wehouse_state_key(other.state)=v_rule.state_key
      and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=v_rule.lga_key
      and public.worker_market_text_key(other.worker_occupation)=v_rule.occupation_key;
  return jsonb_build_object('configured',true,
    'eligible',not v_rule.approvals_paused and (v_rule.hard_limit is null or v_live<v_rule.hard_limit),
    'state',v_rule.state_name,'lga',v_rule.lga_name,'occupation',v_rule.occupation_name,
    'target_count',v_rule.target_count,'hard_limit',v_rule.hard_limit,
    'approvals_paused',v_rule.approvals_paused,'live_count',v_live,
    'remaining',case when v_rule.hard_limit is null then null else greatest(v_rule.hard_limit-v_live,0) end);
end
$function$;

-- One capacity assertion, reused by the profile, workspace and coverage guards.
create function private.assert_worker_market_capacity(p_worker public.profiles) returns void
language plpgsql security definer set search_path='' as $$
declare rule public.worker_market_capacity;live_count bigint;v_state_key text;v_lga_key text;v_occupation_key text;
begin
 if p_worker.user_id is null or p_worker.worker_status is distinct from 'verified' or p_worker.worker_verified is distinct from true
  or coalesce(p_worker.deleted,false) or coalesce(p_worker.suspended,false) or coalesce(p_worker.banned,false) then return;end if;
 v_state_key:=public.wehouse_state_key(p_worker.state);
 v_lga_key:=public.worker_market_text_key(coalesce(nullif(p_worker.local_government,''),p_worker.city));
 v_occupation_key:=public.worker_market_text_key(p_worker.worker_occupation);
 perform pg_advisory_xact_lock(hashtext(v_state_key),hashtext(v_lga_key||':'||v_occupation_key));
 select * into rule from public.worker_market_capacity r
  where r.state_key=v_state_key and r.lga_key=v_lga_key and r.occupation_key=v_occupation_key for update;
 if rule.capacity_id is null then return;end if;
 if rule.approvals_paused then raise exception 'New % approvals are paused in %, %',rule.occupation_name,rule.lga_name,rule.state_name;end if;
 if rule.hard_limit is null then return;end if;
 select count(*) into live_count from private.worker_operating_profiles other
 where other.user_id<>p_worker.user_id and other.worker_status='verified' and other.worker_verified=true
  and not coalesce(other.deleted,false) and not coalesce(other.suspended,false) and not coalesce(other.banned,false)
  and public.user_has_active_workspace(other.user_id,'worker')
  and public.wehouse_state_key(other.state)=rule.state_key
  and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=rule.lga_key
  and public.worker_market_text_key(other.worker_occupation)=rule.occupation_key;
 if live_count>=rule.hard_limit then raise exception '% capacity is full in %, % (% of % verified)',
  rule.occupation_name,rule.lga_name,rule.state_name,live_count,rule.hard_limit;end if;
end $$;
revoke all on function private.assert_worker_market_capacity(public.profiles) from public,anon,authenticated;
create or replace function public.enforce_worker_market_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
declare worker public.profiles;
begin
 if not public.user_has_active_workspace(new.user_id,'worker') then return new;end if;
 if old.worker_status='verified' and old.worker_verified=true and not coalesce(old.deleted,false)
  and not coalesce(old.suspended,false) and not coalesce(old.banned,false)
  and public.worker_market_text_key(old.worker_occupation)=public.worker_market_text_key(new.worker_occupation) then return new;end if;
 worker:=new;
 select p.country,p.state,p.city,p.local_government,p.area into worker.country,worker.state,worker.city,worker.local_government,worker.area
 from private.worker_operating_profiles p where p.user_id=new.user_id;
 perform private.assert_worker_market_capacity(worker);
 return new;
end $$;
create or replace function public.enforce_worker_workspace_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.workspace_role='worker' and new.status='active' then
  perform private.assert_worker_market_capacity(private.worker_operating_profile(new.user_id));
 end if;
 return new;
end $$;
create function private.enforce_worker_coverage_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or (old.country_code,old.state,old.lga) is distinct from (new.country_code,new.state,new.lga))
  and public.user_has_active_workspace(new.worker_id,'worker') then
  perform private.assert_worker_market_capacity(private.worker_operating_profile(new.worker_id));
 end if;
 return new;
end $$;
revoke all on function private.enforce_worker_coverage_capacity() from public,anon,authenticated;
create constraint trigger worker_coverage_market_capacity_guard after insert or update on public.worker_service_coverage
deferrable initially deferred for each row execute function private.enforce_worker_coverage_capacity();
commit;
