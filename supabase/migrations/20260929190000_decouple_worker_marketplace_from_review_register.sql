-- The prior generic launch-review row was an internal gate, not proof of an
-- external licence requirement. Creator opening remains deliberate and audited.
-- Worker approval, current identity, coverage, availability and blocks remain.
begin;
CREATE OR REPLACE FUNCTION public._guard_regulated_platform_launch_setting() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_enabled boolean:=lower(btrim(coalesce(new.value,''))) in('true','1','yes','on');
  v_gate_key text;
begin
  v_gate_key:=case new.key
    when 'worker_identity_checks_enabled' then 'worker_identity_checks'
    when 'worker_pro_sales_enabled' then 'worker_pro_web_sales'
    when 'worker_pro_ios_sales_enabled' then 'worker_pro_ios_sales'
    when 'worker_pro_android_sales_enabled' then 'worker_pro_android_sales'
    when 'worker_featured_sales_enabled' then 'worker_featured_placement'
    else null
  end;
  if v_gate_key is not null and v_enabled
     and not public._legal_launch_gate_is_approved(v_gate_key) then
    raise exception 'Regulated launch gate % has no current recorded approval',v_gate_key;
  end if;
  return new;
end;
$$;

create or replace function public._worker_publication_state(p_worker_id text)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare p public.profiles; reasons text[]:='{}'; enabled boolean:=false;
 paused boolean:=false; ready boolean:=false; identity_ok boolean:=false;
begin
 select * into p from public.profiles where user_id=p_worker_id;
 select coalesce(is_active,true) and lower(btrim(value)) in('true','1','yes','on') into enabled
  from public.platform_settings where key='worker_marketplace_launch_enabled';
 enabled:=coalesce(enabled,false);
 select coalesce(c.paused,false) into paused from public.worker_publication_controls c where c.worker_id=p_worker_id;
 paused:=coalesce(paused,false);
 if p.user_id is null then return jsonb_build_object('eligible',false,'publicly_visible',false,'reasons',jsonb_build_array('Worker record unavailable')); end if;
 ready:=public.worker_professional_profile_ready(p_worker_id);
 identity_ok:=public.worker_identity_is_current(p_worker_id);
 if not public.user_has_active_workspace(p_worker_id,'worker') then reasons:=array_append(reasons,'Worker workspace is not active'); end if;
 if coalesce(p.deleted,false) or coalesce(p.suspended,false) or coalesce(p.banned,false) then reasons:=array_append(reasons,'Account access is restricted'); end if;
 if not ready then reasons:=array_append(reasons,'Professional profile or service coverage is incomplete'); end if;
 if p.worker_status is distinct from 'verified' or p.worker_verified is distinct from true then reasons:=array_append(reasons,'Professional review has not been approved'); end if;
 if not coalesce(identity_ok,false) then reasons:=array_append(reasons,'Required identity review is not current'); end if;
 if not coalesce(p.available,false) then reasons:=array_append(reasons,'Worker has paused their availability'); end if;
 if paused then reasons:=array_append(reasons,'Creator has paused marketplace publication'); end if;
 return jsonb_build_object('eligible',cardinality(reasons)=0,'publicly_visible',cardinality(reasons)=0 and enabled,
  'marketplace_enabled',enabled,'publication_paused',paused,
  'profile_ready',ready,'identity_required',public.account_identity_checks_enabled(),
  'identity_current',public.account_identity_is_current(p_worker_id),'identity_gate_satisfied',identity_ok,
  'reasons',to_jsonb(reasons||case when not enabled then array['Worker marketplace is paused'] else '{}'::text[] end
));
end $$;

create or replace function public.creator_get_worker_publication(p_worker_id text default null)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare enabled boolean;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator access required'; end if;
 select coalesce(is_active,true) and lower(btrim(value)) in('true','1','yes','on') into enabled
  from public.platform_settings where key='worker_marketplace_launch_enabled';
 return jsonb_build_object('enabled',coalesce(enabled,false),'worker',case when p_worker_id is null then null else public._worker_publication_state(p_worker_id) end);
end $$;

create or replace function public.creator_set_worker_marketplace(p_enabled boolean,p_reason text,p_creator_elevation_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare old_value text;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator access required'; end if;
 perform public.reauthenticate_creator_action(p_creator_elevation_id,'all_sensitive');
 if p_enabled is null or length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>1000 then raise exception 'Enter a reason for changing marketplace availability'; end if;
 select value into old_value from public.platform_settings where key='worker_marketplace_launch_enabled' for update;
 update public.platform_settings set value=p_enabled::text,is_active=true,updated_at=now() where key='worker_marketplace_launch_enabled';
 if not found then raise exception 'Marketplace setting is unavailable'; end if;
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'creator_worker_marketplace','platform_settings','worker_marketplace_launch_enabled',
 jsonb_build_object('before',old_value,'enabled',p_enabled,'reason',btrim(p_reason),'elevation_id',p_creator_elevation_id)::text,now());
 return public.creator_get_worker_publication(null);
end $$;

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
    and coalesce((public._worker_publication_state(profile.user_id)->>'eligible')::boolean,false)
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

CREATE OR REPLACE FUNCTION public.get_featured_workers(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 3) RETURNS TABLE(user_id text, full_name text, username text, avatar_url text, bio text, state text, city text, local_government text, area text, worker_occupation text, worker_skills jsonb, worker_price integer, worker_bio text, worker_experience text, rating numeric, review_count integer, is_online boolean, last_seen timestamp with time zone, services jsonb, coverage jsonb, pro_active boolean, featured_placement_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
    from public.profiles profile
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
  from placed join public.profiles profile on profile.user_id=placed.worker_id;
end;
$$;

drop function if exists public.creator_record_worker_launch_review(text,text,text,timestamptz,timestamptz,uuid);
commit;
