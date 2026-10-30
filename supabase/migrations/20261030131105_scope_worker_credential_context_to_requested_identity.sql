begin;
-- Bind the context to the requested identity, including scoped operational callers.
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
 left join public.platform_countries home_country on lower(btrim(p.country)) in(lower(home_country.country_code),lower(home_country.name))
 where p.user_id=p_worker_id)
 select jsonb_build_object('occupation',p.worker_occupation,'skills',p.worker_skills,
  'country',case when p.credential_context ? 'country' and exists(select 1 from public.platform_countries old_country
    where old_country.country_code=p.operating_country and (lower(btrim(p.credential_context->>'country')) in(lower(old_country.country_code),lower(old_country.name))
     or old_country.country_code='NG' and nullif(btrim(p.credential_context->>'country'),'') is null))
    then p.credential_context->'country' else to_jsonb(p.country) end,
  'state',case when p.credential_context->'coverage'=p.coverage_context then p.credential_context->'state' else to_jsonb(p.state) end,
  'category_id',p.service_category_id,'subcategory_id',p.service_subcategory_id,'coverage',p.coverage_context)
 from current_work p;
$$;
commit;
