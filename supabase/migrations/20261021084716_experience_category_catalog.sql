-- One application-category catalog used by both intake validation and the UI.
-- This enables private applications, not publication or public sales.
create table public.experience_categories (
 code text primary key check(code ~ '^[a-z][a-z0-9_]{1,59}$'),
 name text not null check(length(btrim(name)) between 3 and 100),
 description text not null check(length(btrim(description)) between 20 and 1000),
 examples text[] not null check(cardinality(examples) between 1 and 12),
 application_country_codes text[] not null check(cardinality(application_country_codes) between 1 and 100),
 enabled_for_applications boolean not null default false,
 sort_order integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.experience_categories enable row level security;
revoke all on public.experience_categories from public,anon,authenticated;
grant all on public.experience_categories to service_role;
insert into public.experience_categories(code,name,description,examples,application_country_codes,enabled_for_applications,sort_order) values
 ('culture_tours','Culture and local tours','Guided activities that help participants understand a place, its culture or its history.',array['Local history walks','Campus or city orientation tours','Arts and cultural visits'],array['NG'],true,10),
 ('food','Food and cooking','Led food activities with clear ingredients, food-safety arrangements and participation requirements.',array['Cooking classes','Baking workshops','Guided food tastings'],array['NG'],true,20),
 ('creative_learning','Creative and practical workshops','Scheduled group learning led by someone with relevant skills and a clear activity plan.',array['Photography workshops','Craft and art classes','Practical skills workshops'],array['NG'],true,30),
 ('outdoor','Outdoor activities','Led outdoor activities with clear routes, equipment, accessibility and safety requirements.',array['Guided nature walks','Introductory outdoor skills','Supervised local outdoor activities'],array['NG'],true,40);

create function public.get_experience_categories(p_country_code text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); country text:=p_country_code; rows jsonb;
begin
 if country is null then select country_code into country from public.platform_countries where enabled and is_default limit 1;end if;
 if not exists(select 1 from public.platform_countries where country_code=country and enabled) then raise exception 'Activity applications are not available in this country yet';end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'description',c.description,'examples',c.examples) order by c.sort_order,c.name),'[]'::jsonb)
 into rows from public.experience_categories c where c.enabled_for_applications and country=any(c.application_country_codes);
 return rows;
end $$;
revoke all on function public.get_experience_categories(text) from public,anon;
grant execute on function public.get_experience_categories(text) to authenticated;

create or replace function private.experience_activity_issues(body jsonb) returns text[]
language plpgsql stable set search_path='' as $$
declare issues text[]:='{}'; field text; items jsonb;
begin
 if jsonb_typeof(body) is distinct from 'object' then return array['Activity details are required'];end if;
 for field in select unnest(array['title','category','what_to_expect','host_expertise','country_code','state','local_area','city','meeting_area','timezone','participation_requirements','accessibility_information']) loop
  if jsonb_typeof(body->field) is distinct from 'string' or length(btrim(body->>field))=0 then issues:=array_append(issues,field||' is required');end if;
 end loop;
 if length(coalesce(body->>'title','')) not between 5 and 120 then issues:=array_append(issues,'Use an activity title between 5 and 120 characters');end if;
 if length(coalesce(body->>'what_to_expect','')) not between 80 and 6000 then issues:=array_append(issues,'Describe what participants will do in 80 to 6000 characters');end if;
 if length(coalesce(body->>'host_expertise','')) not between 40 and 4000 then issues:=array_append(issues,'Explain the relevant expertise in 40 to 4000 characters');end if;
 if not exists(select 1 from public.experience_categories c join public.platform_countries p on p.country_code=body->>'country_code' and p.enabled where c.code=body->>'category' and c.enabled_for_applications and p.country_code=any(c.application_country_codes)) then issues:=array_append(issues,'Choose an activity category available in this country');end if;
 if coalesce(body->>'country_code','') !~ '^[A-Z]{2}$' then issues:=array_append(issues,'Choose a valid country');end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=body->>'timezone') then issues:=array_append(issues,'Choose a valid activity timezone');end if;
 if jsonb_typeof(body->'duration_minutes') is distinct from 'number' or coalesce(body->>'duration_minutes','') !~ '^[0-9]{1,4}$' then issues:=array_append(issues,'Duration must be a whole number of minutes');
 elsif (body->>'duration_minutes')::integer not between 15 and 1440 then issues:=array_append(issues,'Duration must be between 15 minutes and one day');end if;
 if jsonb_typeof(body->'max_group_size') is distinct from 'number' or coalesce(body->>'max_group_size','') !~ '^[0-9]{1,3}$' then issues:=array_append(issues,'Group size must be a whole number');
 elsif (body->>'max_group_size')::integer not between 1 and 100 then issues:=array_append(issues,'Group size must be between 1 and 100 for review');end if;
 for field in select unnest(array['inclusions','exclusions']) loop
  items:=body->field;
  if jsonb_typeof(items) is distinct from 'array' then issues:=array_append(issues,field||' must be a list');
  elsif jsonb_array_length(items)>20 or exists(select 1 from jsonb_array_elements(items) item where jsonb_typeof(item) is distinct from 'string' or length(btrim(item#>>'{}')) not between 1 and 500) then issues:=array_append(issues,field||' must contain at most 20 short descriptions');end if;
 end loop;
 return issues;
end $$;
