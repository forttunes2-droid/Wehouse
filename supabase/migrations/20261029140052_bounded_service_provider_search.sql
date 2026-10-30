-- One public Provider projection and eligibility authority. Add filtering before
-- the result bound, not a browser filter over a truncated national response.
create function private.service_discovery_region_key(p_value text) returns text
language sql immutable set search_path='' as $$
 select case when public.wehouse_state_key(p_value) in('abuja','abujafct','fct','federalcapitalterritory') then 'fct' else public.wehouse_state_key(p_value) end;
$$;
revoke all on function private.service_discovery_region_key(text) from public,anon,authenticated,service_role;
do $projection$
declare definition text;header text;needle text;
begin
 definition:=pg_get_functiondef('public.get_public_workers(text,text,text)'::regprocedure);
 header:='public.get_public_workers(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text)';
 if strpos(definition,header)=0 or strpos(definition,' LANGUAGE plpgsql')=0 then raise exception 'Inspect the current public Provider projection';end if;
 definition:=replace(definition,header,'private.service_provider_rows(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_specialty text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_after_rating numeric DEFAULT NULL::numeric, p_after_reviews integer DEFAULT NULL::integer, p_after_id text DEFAULT NULL::text, p_take integer DEFAULT NULL::integer, p_ids text[] DEFAULT NULL::text[])');
 needle:='public.wehouse_state_key(coverage_match.state)=public.wehouse_state_key(p_state)';
 if strpos(definition,needle)=0 then raise exception 'Inspect the declared service region comparison';end if;
 definition:=replace(definition,needle,'private.service_discovery_region_key(coverage_match.state)=private.service_discovery_region_key(p_state)');
 needle:='  order by profile.rating desc nulls last,profile.review_count desc nulls last;';
 if strpos(definition,needle)=0 then raise exception 'Inspect the current Provider ordering';end if;
 definition:=replace(definition,needle,$filters$
    and (p_ids is null or profile.user_id=any(p_ids))
    and (p_country is null or exists(select 1 from public.platform_countries country where country.country_code=p_country and country.enabled
      and (lower(btrim(profile.country)) in(lower(country.country_code),lower(country.name))
        -- These records predate countries outside the original Nigeria market.
        or p_country='NG' and nullif(btrim(profile.country),'') is null)))
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
      profile.worker_bio,profile.state,profile.city,profile.local_government,
      (select string_agg(service.service_name,' ') from public.worker_services service where service.worker_id=profile.user_id),
      (select string_agg(skill,' ') from jsonb_array_elements_text(case when jsonb_typeof(profile.worker_skills)='array' then profile.worker_skills else '[]'::jsonb end) skill),
      (select string_agg(concat_ws(' ',coverage.state,coverage.lga,array_to_string(coverage.areas,' ')),' ') from public.worker_service_coverage coverage where coverage.worker_id=profile.user_id)),p_query))
  order by profile.rating desc,profile.review_count desc,profile.user_id desc limit p_take;
$filters$);
 execute definition;
 definition:=pg_get_functiondef('public.get_public_workers(text,text,text)'::regprocedure);
 execute split_part(definition,' LANGUAGE plpgsql',1)||$wrapper$
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $body$
 select * from private.service_provider_rows(p_state,p_city,p_occupation);
 $body$;
$wrapper$;
end $projection$;
revoke all on function private.service_provider_rows(text,text,text,text,text,text,text,numeric,integer,text,integer,text[]) from public,anon,authenticated,service_role;

-- The previous sort index is scoped to the historical role='worker'. The
-- canonical identity now uses workspaces, so it cannot support this query.
create index profiles_available_service_order on public.profiles(rating desc,review_count desc,user_id desc)
 where worker_status='verified' and worker_verified=true and available=true
 and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);

create function public.search_service_providers(
 p_country text,p_query text default null,p_category text default null,p_specialty text default null,
 p_state text default null,p_city text default null,p_after_rating numeric default null,p_after_reviews integer default null,p_after_id text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_country is null or not exists(select 1 from public.platform_countries where country_code=p_country and enabled) then raise exception 'Choose an available country';end if;
 p_query:=nullif(btrim(p_query),'');p_category:=nullif(btrim(p_category),'');p_specialty:=nullif(btrim(p_specialty),'');p_state:=nullif(btrim(p_state),'');p_city:=nullif(btrim(p_city),'');
 if coalesce(length(p_query),0)>80 or coalesce(length(p_state),0)>100 or coalesce(length(p_city),0)>100 then raise exception 'Search text is too long';end if;
 if p_city is not null and p_state is null then raise exception 'Choose a region before a local area';end if;
 if p_category is not null and not exists(select 1 from public.service_categories where name=p_category and is_active) then raise exception 'Choose a current service category';end if;
 if p_specialty is not null and not exists(select 1 from public.service_subcategories sub join public.service_categories category on category.id=sub.category_id where sub.name=p_specialty and sub.is_active and category.is_active and category.name=p_category) then raise exception 'Choose a service within the selected category';end if;
 if (p_after_id is null and (p_after_rating is not null or p_after_reviews is not null)) or p_after_id is not null and
   (length(p_after_id)>120 or length(p_after_id)=0 or p_after_rating is null or p_after_reviews is null or p_after_rating not between 0 and 5 or p_after_reviews<0) then raise exception 'Refresh the search before loading more';end if;
 with rows as materialized(select * from private.service_provider_rows(p_state,p_city,null,p_query,p_category,p_specialty,p_country,p_after_rating,p_after_reviews,p_after_id,25)),
 numbered as(select to_jsonb(rows) as item,row_number() over(order by rating desc,review_count desc,user_id desc) as position from rows)
 select jsonb_build_object('items',coalesce(jsonb_agg(item order by position) filter(where position<=24),'[]'::jsonb),
   'has_more',count(*)>24,'next_cursor',(jsonb_agg(jsonb_build_object('rating',item->'rating','reviews',item->'review_count','id',item->'user_id')) filter(where position=24))->0)
 into result from numbered;
 return result;
end $$;
revoke all on function public.search_service_providers(text,text,text,text,text,text,numeric,integer,text) from public,anon;
grant execute on function public.search_service_providers(text,text,text,text,text,text,numeric,integer,text) to authenticated;

-- Shared links and matching paid placements must not depend on the loaded page.
create function public.get_discoverable_service_providers(p_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_ids is null or cardinality(p_ids) not between 1 and 12 or exists(select 1 from unnest(p_ids) id where id is null or length(id) not between 1 and 120) then raise exception 'Choose up to twelve Provider references';end if;
 return coalesce((select jsonb_agg(to_jsonb(provider) order by provider.user_id) from private.service_provider_rows(p_ids=>p_ids,p_take=>12) provider),'[]'::jsonb);
end $$;
revoke all on function public.get_discoverable_service_providers(text[]) from public,anon;
grant execute on function public.get_discoverable_service_providers(text[]) to authenticated;
