-- A garden offered for visits stays within Outdoor Experiences. The listing
-- explains guided/self-guided access, inclusions and its dated capacity.
update public.experience_categories
 set description='Garden visits and outdoor activities with clear access, routes, accessibility and safety requirements. State whether the visit is guided or self-guided.',
 examples=array['Garden visits','Guided nature walks','Introductory outdoor skills','Supervised local outdoor activities'],updated_at=now()
 where code='outdoor';

-- Discovery and provider intake share non-private category metadata. Reading
-- labels must not require a provider workspace; all creation commands still do.
create or replace function public.get_experience_categories(p_country_code text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare country text:=upper(btrim(p_country_code));rows jsonb;
begin
 if country is null then select country_code into country from public.platform_countries where enabled and is_default limit 1;end if;
 if not exists(select 1 from public.platform_countries where country_code=country and enabled) then raise exception 'Experiences are not available in this country yet';end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'description',c.description,'examples',c.examples) order by c.sort_order,c.name),'[]'::jsonb)
 into rows from (select * from public.experience_categories where enabled_for_applications and country=any(application_country_codes) order by sort_order,name limit 100) c;
 return rows;
end $$;
revoke all on function public.get_experience_categories(text) from public;
grant execute on function public.get_experience_categories(text) to anon,authenticated;
