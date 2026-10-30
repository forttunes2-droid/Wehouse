begin;
-- One private identity location; one separately owned professional coverage row.
-- Opening a workspace or changing personal details never submits a work profile.
alter table public.worker_service_coverage add column country_code text references public.platform_countries(country_code);
create index worker_service_coverage_country_idx on public.worker_service_coverage(country_code);
update public.worker_service_coverage coverage set country_code=country.country_code
from public.profiles person,public.platform_countries country
where person.user_id=coverage.worker_id and (lower(btrim(person.country)) in(lower(country.country_code),lower(country.name))
 or country.country_code='NG' and nullif(btrim(person.country),'') is null);
CREATE OR REPLACE FUNCTION public.update_my_profile(p_updates jsonb)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE v_professional_update boolean; v_coverage public.worker_service_coverage; v_service_country text; v_profile public.profiles; v_username text; v_state text; v_lga text; v_country text; v_unknown text[]; v_complete boolean; v_area text;
BEGIN
  IF auth.uid() IS NULL OR NOT public._property_document_session_active() THEN RAISE EXCEPTION 'Trusted account session required' USING ERRCODE='42501'; END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates)<>'object' THEN RAISE EXCEPTION 'Profile updates must be an object'; END IF;
  v_professional_update:=p_updates ?| ARRAY['worker_occupation','worker_skills','worker_price','worker_bio','worker_experience'];
  SELECT array_agg(k) INTO v_unknown FROM jsonb_object_keys(p_updates) AS k WHERE k NOT IN ('username','full_name','avatar_url','bio','phone','occupation','gender','is_student','school','country','state','local_government','city','area','profile_complete','worker_occupation','worker_skills','worker_price','worker_bio','worker_experience');
  IF v_unknown IS NOT NULL THEN RAISE EXCEPTION 'Unsupported profile fields: %',array_to_string(v_unknown,', '); END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND deleted=false AND suspended=false AND banned=false;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active profile not found'; END IF;
  IF not public.user_has_active_workspace(v_profile.user_id,'worker') AND (p_updates ? 'worker_occupation' OR p_updates ? 'worker_skills' OR p_updates ? 'worker_price' OR p_updates ? 'worker_bio' OR p_updates ? 'worker_experience') THEN RAISE EXCEPTION 'Worker professional fields require a Worker account'; END IF;
  v_username:=lower(trim(CASE WHEN p_updates ? 'username' THEN p_updates->>'username' ELSE v_profile.username END));
  IF v_username IS NULL OR length(v_username)<3 OR length(v_username)>20 THEN RAISE EXCEPTION 'Username must contain 3 to 20 characters'; END IF;
  IF v_username !~ '^[a-z0-9_]+$' THEN RAISE EXCEPTION 'Username may contain only letters, numbers and underscores'; END IF;
  IF v_username IN ('admin','creator','support','system','api','wehouse','mod','moderator','owner','staff','help','info','null','undefined') THEN RAISE EXCEPTION 'This username is reserved'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE lower(p.username)=v_username AND p.user_id<>v_profile.user_id) THEN RAISE EXCEPTION 'Username is already taken'; END IF;
  v_country:=CASE WHEN p_updates ? 'country' THEN nullif(trim(p_updates->>'country'),'') ELSE v_profile.country END;
  v_state:=CASE WHEN p_updates ? 'state' THEN nullif(trim(p_updates->>'state'),'') ELSE v_profile.state END;
  v_lga:=CASE WHEN p_updates ? 'local_government' THEN nullif(trim(p_updates->>'local_government'),'') WHEN p_updates ? 'city' THEN nullif(trim(p_updates->>'city'),'') ELSE COALESCE(v_profile.local_government,v_profile.city) END;
  v_area:=CASE WHEN p_updates ? 'area' THEN nullif(trim(p_updates->>'area'),'') ELSE v_profile.area END;
  v_complete:=v_profile.profile_complete OR COALESCE((p_updates->>'profile_complete')::boolean,false);
  IF v_professional_update THEN
    SELECT * INTO v_coverage FROM public.worker_service_coverage WHERE worker_id=v_profile.user_id;
    IF NOT (p_updates ? 'country') THEN
      SELECT name INTO v_country FROM public.platform_countries WHERE country_code=v_coverage.country_code;
    END IF;
    IF NOT (p_updates ? 'state') THEN v_state:=v_coverage.state; END IF;
    IF NOT (p_updates ? 'local_government' OR p_updates ? 'city') THEN v_lga:=v_coverage.lga; END IF;
    IF NOT (p_updates ? 'area') THEN v_area:=nullif(array_to_string(v_coverage.areas,', '),''); END IF;
    SELECT country_code INTO v_service_country FROM public.platform_countries
      WHERE enabled AND lower(btrim(v_country)) IN(lower(country_code),lower(name)) LIMIT 1;
    IF v_service_country IS NULL THEN RAISE EXCEPTION 'Choose an available service country'; END IF;
  END IF;
  IF v_professional_update AND v_complete AND (v_state IS NULL OR v_lga IS NULL) THEN RAISE EXCEPTION 'State and Local Government are required'; END IF;
  UPDATE public.profiles SET username=v_username,full_name=CASE WHEN p_updates ? 'full_name' THEN nullif(trim(p_updates->>'full_name'),'') ELSE full_name END,avatar_url=CASE WHEN p_updates ? 'avatar_url' THEN nullif(trim(p_updates->>'avatar_url'),'') ELSE avatar_url END,bio=CASE WHEN p_updates ? 'bio' THEN nullif(trim(p_updates->>'bio'),'') ELSE bio END,phone=CASE WHEN p_updates ? 'phone' THEN nullif(trim(p_updates->>'phone'),'') ELSE phone END,occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') WHEN p_updates ? 'occupation' THEN nullif(trim(p_updates->>'occupation'),'') ELSE occupation END,gender=CASE WHEN p_updates ? 'gender' THEN nullif(trim(p_updates->>'gender'),'') ELSE gender END,is_student=CASE WHEN p_updates ? 'is_student' THEN (p_updates->>'is_student')::boolean ELSE is_student END,school=CASE WHEN p_updates ? 'school' THEN nullif(trim(p_updates->>'school'),'') ELSE school END,country=CASE WHEN v_professional_update THEN country ELSE v_country END,state=CASE WHEN v_professional_update THEN state ELSE v_state END,local_government=CASE WHEN v_professional_update THEN local_government ELSE v_lga END,city=CASE WHEN v_professional_update THEN city ELSE v_lga END,area=CASE WHEN v_professional_update THEN area ELSE v_area END,worker_occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') ELSE worker_occupation END,worker_skills=CASE WHEN p_updates ? 'worker_skills' THEN p_updates->'worker_skills' ELSE worker_skills END,worker_price=CASE WHEN p_updates ? 'worker_price' THEN NULLIF(p_updates->>'worker_price','')::integer ELSE worker_price END,worker_bio=CASE WHEN p_updates ? 'worker_bio' THEN nullif(trim(p_updates->>'worker_bio'),'') ELSE worker_bio END,worker_experience=CASE WHEN p_updates ? 'worker_experience' THEN nullif(trim(p_updates->>'worker_experience'),'') ELSE worker_experience END,profile_complete=v_complete,updated_at=now() WHERE user_id=v_profile.user_id RETURNING * INTO v_profile;
  IF v_professional_update AND public.user_has_active_workspace(v_profile.user_id,'worker') AND v_complete THEN
    IF NULLIF(BTRIM(COALESCE(v_profile.worker_occupation,'')),'') IS NULL THEN RAISE EXCEPTION 'Worker service category is required'; END IF;
    IF jsonb_typeof(COALESCE(v_profile.worker_skills,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(v_profile.worker_skills,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'At least one Worker specialty is required'; END IF;
    INSERT INTO public.worker_service_coverage(worker_id,country_code,state,lga,areas,updated_at) VALUES(v_profile.user_id,v_service_country,v_state,v_lga,CASE WHEN v_area IS NULL THEN '{}'::text[] ELSE ARRAY[v_area] END,now()) ON CONFLICT(worker_id) DO UPDATE SET country_code=EXCLUDED.country_code,state=EXCLUDED.state,lga=EXCLUDED.lga,areas=EXCLUDED.areas,updated_at=now();
  END IF;
  RETURN v_profile;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_precise_location(p_latitude numeric, p_longitude numeric, p_address text DEFAULT NULL::text, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_profile public.profiles;
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
begin
  if auth.uid() is null or not public._property_document_session_active() then raise exception 'Trusted account session required' using errcode='42501';end if;
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Latitude and longitude must be saved together';
  end if;
  if p_latitude is not null
     and (p_latitude not between -90 and 90
          or p_longitude not between -180 and 180) then
    raise exception 'Invalid coordinates';
  end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'Invalid location accuracy';
  end if;
  if length(coalesce(p_address, '')) > 500 then
    raise exception 'Address is too long';
  end if;

  update public.profiles
  set precise_latitude = p_latitude,
      precise_longitude = p_longitude,
      precise_address = v_address,
      precise_location_accuracy_m = case
        when p_latitude is null then null
        else p_accuracy_m
      end,
      precise_location_updated_at = case
        when p_latitude is null and v_address is null then null
        else now()
      end,
      updated_at = now()
  where auth_id = auth.uid()::text
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  returning * into v_profile;

  if v_profile is null then raise exception 'Active profile not found'; end if;
  return v_profile;
end;
$function$;

create function public.update_my_profile_with_location(p_updates jsonb,p_latitude numeric,p_longitude numeric,p_address text default null,p_accuracy_m numeric default null)
returns public.profiles language plpgsql security invoker set search_path='' as $$
begin
 perform public.update_my_profile(p_updates);
 return public.update_my_precise_location(p_latitude,p_longitude,p_address,p_accuracy_m);
end $$;
revoke all on function public.update_my_profile_with_location(jsonb,numeric,numeric,text,numeric) from public,anon;
grant execute on function public.update_my_profile_with_location(jsonb,numeric,numeric,text,numeric) to authenticated;

create function public.save_my_worker_profile(p_services jsonb,p_updates jsonb)
returns public.profiles language plpgsql security invoker set search_path='' as $$
begin
 if p_updates is null or jsonb_typeof(p_updates)<>'object' or not(p_updates ? 'worker_occupation') then
  raise exception 'Professional profile details are required';end if;
 perform public.set_my_worker_services(p_services);
 return public.update_my_profile(p_updates);
end $$;
revoke all on function public.save_my_worker_profile(jsonb,jsonb) from public,anon;
grant execute on function public.save_my_worker_profile(jsonb,jsonb) to authenticated;

create function public.get_my_worker_service_coverage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();result jsonb;
begin
 if actor is null or not public._property_document_session_active() or not public.user_has_active_workspace(actor,'worker') then
  raise exception 'An active Service Worker workspace and trusted session are required' using errcode='42501';end if;
 select jsonb_build_object('country_code',coverage.country_code,'country',coalesce(country.name,person.country),
  'state',coverage.state,'city',coverage.lga,'area',coalesce(array_to_string(coverage.areas,', '),''))
 into result from public.worker_service_coverage coverage join public.profiles person on person.user_id=coverage.worker_id
 left join public.platform_countries country on country.country_code=coverage.country_code where coverage.worker_id=actor;
 return result;
end $$;
revoke all on function public.get_my_worker_service_coverage() from public,anon;
grant execute on function public.get_my_worker_service_coverage() to authenticated;
CREATE OR REPLACE FUNCTION private.service_provider_rows(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_specialty text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_after_rating numeric DEFAULT NULL::numeric, p_after_reviews integer DEFAULT NULL::integer, p_after_id text DEFAULT NULL::text, p_take integer DEFAULT NULL::integer, p_ids text[] DEFAULT NULL::text[])
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
    profile.bio,coalesce(service_location.state,profile.state),coalesce(service_location.lga,profile.city),coalesce(service_location.lga,profile.local_government),
    coalesce(array_to_string(service_location.areas,', '),profile.area),profile.worker_occupation,profile.worker_skills,
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
  left join public.worker_service_coverage service_location on service_location.worker_id=profile.user_id
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
          and (nullif(btrim(p_state),'') is null or private.service_discovery_region_key(coverage_match.state)=private.service_discovery_region_key(p_state))
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

    and (p_ids is null or profile.user_id=any(p_ids))
    and (p_country is null or exists(select 1 from public.platform_countries country where country.country_code=p_country and country.enabled
      and (lower(btrim(coalesce(service_location.country_code,profile.country))) in(lower(country.country_code),lower(country.name))
        -- These records predate countries outside the original Nigeria market.
        or p_country='NG' and nullif(btrim(coalesce(service_location.country_code,profile.country)),'') is null)))
    and (p_after_id is null or (profile.rating,profile.review_count,profile.user_id)<(p_after_rating,p_after_reviews,p_after_id))
    and (p_category is null or lower(btrim(profile.worker_occupation))=lower(p_category)
      or exists(select 1 from public.service_subcategories sub join public.service_categories category on category.id=sub.category_id
       where category.is_active and sub.is_active and category.name=p_category and (
        exists(select 1 from public.worker_services service where service.worker_id=profile.user_id and lower(btrim(service.service_name))=lower(btrim(sub.name)))
        or not exists(select 1 from public.worker_services service where service.worker_id=profile.user_id)
          and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(profile.worker_skills)='array' then profile.worker_skills else '[]'::jsonb end) skill where lower(btrim(skill))=lower(btrim(sub.name))))))
    and (p_specialty is null or exists(select 1 from public.worker_services service where service.worker_id=profile.user_id and lower(btrim(service.service_name))=lower(p_specialty))
      or not exists(select 1 from public.worker_services service where service.worker_id=profile.user_id)
        and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(profile.worker_skills)='array' then profile.worker_skills else '[]'::jsonb end) skill where lower(btrim(skill))=lower(p_specialty)))
    and (p_query is null or private.discovery_text_matches(concat_ws(' ',profile.full_name,profile.username,profile.worker_occupation,
      profile.worker_bio,coalesce(service_location.state,profile.state),coalesce(service_location.lga,profile.city),coalesce(service_location.lga,profile.local_government),
      (select string_agg(service.service_name,' ') from public.worker_services service where service.worker_id=profile.user_id),
      (select string_agg(skill,' ') from jsonb_array_elements_text(case when jsonb_typeof(profile.worker_skills)='array' then profile.worker_skills else '[]'::jsonb end) skill),
      (select string_agg(concat_ws(' ',coverage.state,coverage.lga,array_to_string(coverage.areas,' ')),' ') from public.worker_service_coverage coverage where coverage.worker_id=profile.user_id)),p_query))
  order by profile.rating desc,profile.review_count desc,profile.user_id desc limit p_take;

end
$function$;

-- Readiness uses professional coverage, never a private home address.
create or replace function public.worker_professional_profile_ready(p_worker_id text) returns boolean
language sql stable security definer set search_path='pg_catalog','public' as $$
 select exists(select 1 from public.profiles profile where profile.user_id=p_worker_id
 and public.user_has_active_workspace(profile.user_id,'worker') and coalesce(profile.profile_complete,false)
 and nullif(btrim(profile.full_name),'') is not null and nullif(btrim(profile.worker_occupation),'') is not null
 and jsonb_typeof(coalesce(profile.worker_skills,'[]'::jsonb))='array' and jsonb_array_length(coalesce(profile.worker_skills,'[]'::jsonb))>0
 and not coalesce(profile.deleted,false) and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
 and exists(select 1 from public.worker_service_coverage coverage where coverage.worker_id=profile.user_id
  and nullif(btrim(coverage.state),'') is not null and nullif(btrim(coverage.lga),'') is not null
  and exists(select 1 from public.platform_countries country where country.enabled and
   (country.country_code=coverage.country_code or coverage.country_code is null and
    (lower(btrim(profile.country)) in(lower(country.country_code),lower(country.name))
     or country.country_code='NG' and nullif(btrim(profile.country),'') is null)))));
$$;
commit;
