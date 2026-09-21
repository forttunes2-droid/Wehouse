create or replace function public.set_my_worker_services(p_services jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_item jsonb;
  v_name text;
  v_category text;
  v_price integer;
  v_price_type text;
  v_description text;
  v_count integer:=0;
  v_names text[]:='{}'::text[];
  v_search text[]:='{}'::text[];
begin
  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Worker account required'; end if;
  if p_services is null or jsonb_typeof(p_services)<>'array' then
    raise exception 'Services must be a list';
  end if;
  if jsonb_array_length(p_services)<1 then
    raise exception 'Add at least one service';
  end if;
  if jsonb_array_length(p_services)>10 then
    raise exception 'A Worker can list up to 10 services';
  end if;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=nullif(btrim(coalesce(v_item->>'name','')),'');
    v_category:=nullif(btrim(coalesce(v_item->>'category','')),'');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');

    if v_name is null or v_category is null then
      raise exception 'Every service needs an approved category and service name';
    end if;
    if length(v_name)>120 then
      raise exception 'Service names must be 120 characters or less';
    end if;
    if v_price_type not in ('starting_from','fixed','hourly','daily','negotiable') then
      raise exception 'Unsupported service price type';
    end if;
    if not exists(
      select 1
      from public.service_categories category
      join public.service_subcategories service
        on service.category_id=category.id
      where lower(btrim(category.name))=lower(v_category)
        and lower(btrim(service.name))=lower(v_name)
        and coalesce(category.is_active,true)
        and coalesce(service.is_active,true)
    ) then
      raise exception 'Choose an active WeHouse service from the approved catalog';
    end if;
    if exists(
      select 1
      from unnest(v_names) existing
      where lower(existing)=lower(v_name)
    ) then
      raise exception 'Each service can only be added once';
    end if;

    v_names:=array_append(v_names,v_name);
    v_search:=array_append(v_search,v_category);
    v_search:=array_append(v_search,v_name);
  end loop;

  delete from public.worker_services where worker_id=v_actor.user_id;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=btrim(v_item->>'name');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');
    insert into public.worker_services(
      worker_id,service_name,price,price_type,description,created_at,updated_at
    ) values(
      v_actor.user_id,v_name,v_price,v_price_type,v_description,now(),now()
    );
    v_count:=v_count+1;
  end loop;

  update public.profiles
  set worker_skills=(
        select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
        from (
          select min(ord) ord, value
          from unnest(v_search) with ordinality item(value,ord)
          where nullif(btrim(value),'') is not null
          group by lower(btrim(value)),value
        ) deduped
      ),
      updated_at=now()
  where user_id=v_actor.user_id;

  return jsonb_build_object(
    'success',true,
    'count',v_count,
    'services',to_jsonb(v_names)
  );
end;
$$;

revoke all on function public.set_my_worker_services(jsonb) from public,anon;
grant execute on function public.set_my_worker_services(jsonb)
  to authenticated,service_role;
