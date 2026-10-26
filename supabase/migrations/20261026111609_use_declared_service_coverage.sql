begin;
CREATE OR REPLACE FUNCTION public.get_public_workers(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text)
 RETURNS TABLE(user_id text, full_name text, username text, avatar_url text, bio text, state text, city text, local_government text, area text, worker_occupation text, worker_skills jsonb, worker_price integer, worker_bio text, worker_experience text, rating numeric, review_count integer, is_online boolean, last_seen timestamp with time zone, services jsonb, coverage jsonb, pro_active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    and coalesce((public._worker_publication_state(profile.user_id)->>'eligible')::boolean,false)
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and public.worker_identity_is_current(profile.user_id)
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
    and (
      (nullif(btrim(p_state),'') is null and nullif(btrim(p_city),'') is null)
      or exists(
        select 1 from public.worker_service_coverage coverage_match
        where coverage_match.worker_id=profile.user_id
          and (nullif(btrim(p_state),'') is null or public.wehouse_state_key(coverage_match.state)=public.wehouse_state_key(p_state))
          and (nullif(btrim(p_city),'') is null or lower(btrim(coverage_match.lga))=lower(btrim(p_city)))
      )
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
$function$
;
commit;
