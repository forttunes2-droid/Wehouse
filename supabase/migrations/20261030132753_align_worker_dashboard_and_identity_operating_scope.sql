begin;
-- Use work coverage in existing Worker dashboard projections and pending identity reviews.
-- Private home coordinates/address are not needed by geographically scoped work reviewers.
create or replace view private.worker_operating_profiles with (security_invoker=true) as
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
 case when false then person.precise_latitude end as precise_latitude,
 case when false then person.precise_longitude end as precise_longitude,
 case when false then person.precise_address end as precise_address,
 case when false then person.precise_location_accuracy_m end as precise_location_accuracy_m,
 case when false then person.precise_location_updated_at end as precise_location_updated_at
from public.profiles person left join public.worker_service_coverage coverage on coverage.worker_id=person.user_id
left join public.platform_countries country on country.country_code=coverage.country_code;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_profiles(p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();

  if p_role is not null and p_role not in(
    'user','worker','property_partner','staff','admin'
  ) then
    raise exception 'Invalid role filter';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(p)-array[
        'auth_id','creator_auth_password','creator_auth_enabled',
        'worker_gov_id_url','maintenance_exempt','created_by','updated_by'
      ]::text[]
      order by p.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.profiles person
  cross join lateral (
   select person.* where not coalesce(p_role='worker' or p_role is null and public.user_has_active_workspace(person.user_id,'worker'),false)
   union all
   select operating.* from private.worker_operating_profiles operating where operating.user_id=person.user_id
    and (p_role='worker' or p_role is null and public.user_has_active_workspace(person.user_id,'worker'))
  ) p
  where p.deleted_at is null
    and not coalesce(p.deleted,false)
    and p.role<>'creator'
    and (
      v_actor.role='creator'
      or public.current_actor_in_scope(
        case
          when public.user_has_active_workspace(p.user_id,'staff')
            or public.user_has_active_workspace(p.user_id,'admin')
          then p.assigned_state
          else p.state
        end,
        case
          when public.user_has_active_workspace(p.user_id,'staff')
            or public.user_has_active_workspace(p.user_id,'admin')
          then p.assigned_lga
          else coalesce(nullif(p.local_government,''),p.city)
        end
      )
    )
    and (
      p_role is null
      or (p_role='worker' and public.user_has_active_workspace(p.user_id,'worker'))
      or (p_role='property_partner' and public.user_has_active_workspace(p.user_id,'property_partner'))
      or (p_role='staff' and public.user_has_active_workspace(p.user_id,'staff'))
      or (p_role='admin' and public.user_has_active_workspace(p.user_id,'admin'))
      or (
        p_role='user'
        and not public.user_has_active_workspace(p.user_id,'worker')
        and not public.user_has_active_workspace(p.user_id,'property_partner')
        and not public.user_has_active_workspace(p.user_id,'staff')
        and not public.user_has_active_workspace(p.user_id,'admin')
        and not public.user_has_active_workspace(p.user_id,'creator')
      )
    );

  return v_result;
end
$function$;
CREATE OR REPLACE FUNCTION public.admin_get_my_branch_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();

  return jsonb_build_object(
    'users',(
      select count(distinct p.user_id)
      from public.profiles p
      where p.deleted_at is null
        and not coalesce(p.deleted,false)
        and not public.user_has_active_workspace(p.user_id,'worker')
        and not public.user_has_active_workspace(p.user_id,'property_partner')
        and not public.user_has_active_workspace(p.user_id,'staff')
        and not public.user_has_active_workspace(p.user_id,'admin')
        and not public.user_has_active_workspace(p.user_id,'creator')
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    ),
    'workers',(
      select count(distinct p.user_id)
      from private.worker_operating_profiles p
      where public.user_has_active_workspace(p.user_id,'worker')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    ),
    'partners',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'property_partner')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    ),
    'staff',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'staff')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(p.assigned_state,p.assigned_lga)
        )
    ),
    'admins',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'admin')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(p.assigned_state,p.assigned_lga)
        )
    ),
    'listings',(
      select count(distinct l.id)
      from public.listings l
      where l.deleted_at is null
        and l.status='available'
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            l.state,l.city
          )
        )
    ),
    'pending_verifications',(
      select count(distinct p.user_id)
      from private.worker_operating_profiles p
      where public.user_has_active_workspace(p.user_id,'worker')
        and p.worker_status in('verification_paid','profile_under_review')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    )
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.current_actor_can_review_account_identity(p_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  actor public.profiles;
  target public.profiles;
  pending_role text;
begin
  select * into actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and p.deleted_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  select * into target
  from public.profiles p
  where p.user_id=p_user_id
    and p.deleted_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if actor.user_id is null
     or target.user_id is null
     or actor.user_id=target.user_id then
    return false;
  end if;

  select check_row.account_role
  into pending_role
  from public.worker_identity_checks check_row
  where check_row.worker_id=p_user_id
    and check_row.status='pending_review'
  limit 1;

  if pending_role not in ('worker','property_partner') then
    return false;
  end if;
  if pending_role='worker'
     and not public.user_has_active_workspace(target.user_id,'worker') then
    return false;
  end if;
  if pending_role='property_partner'
     and not public.user_has_active_workspace(target.user_id,'property_partner') then
    return false;
  end if;

  if pending_role='worker' then target:=private.worker_operating_profile(target.user_id);end if;

  if public.current_actor_has_workspace('creator',null) then
    return true;
  end if;

  return exists(
    select 1
    from public.workspace_role_assignments w
    where w.user_id=actor.user_id
      and w.status='active'
      and w.revoked_at is null
      and (
        (
          w.workspace_role='admin'
          and public.current_actor_has_workspace('admin',null)
        )
        or (
          public.current_actor_has_workspace('staff',null)
          and (
            (pending_role='worker' and w.workspace_role='worker_operations')
            or (
              pending_role='property_partner'
              and w.workspace_role='property_operations'
            )
          )
        )
      )
      and (
        w.scope_type='global'
        or (
          w.scope_type in ('state','branch')
          and nullif(public.wehouse_state_key(w.scope_state),'') is not null
          and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(target.state)
          and (
            w.scope_type='state'
            or (
              w.scope_type='branch'
              and nullif(lower(btrim(w.scope_lga)),'') is not null
              and lower(btrim(w.scope_lga))=
                lower(btrim(coalesce(nullif(target.local_government,''),target.city)))
            )
          )
        )
      )
  );
end;
$function$;
commit;
