-- A followed search is identified by its filters, not its display name.

alter table public.saved_searches
  add column if not exists criteria_key text;

update public.saved_searches
set criteria_key=md5(coalesce(criteria,'{}'::jsonb)::text)
where criteria_key is null;

delete from public.saved_searches older
using public.saved_searches newer
where older.user_id=newer.user_id
  and older.search_kind=newer.search_kind
  and older.criteria_key=newer.criteria_key
  and (older.updated_at,older.id)<(newer.updated_at,newer.id);

alter table public.saved_searches
  alter column criteria_key set not null;

alter table public.saved_searches
  drop constraint if exists saved_searches_user_id_name_search_kind_key;

create unique index if not exists saved_searches_user_kind_criteria_key
  on public.saved_searches(user_id,search_kind,criteria_key);

create or replace function public.set_saved_search_criteria_key()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  new.criteria:=coalesce(new.criteria,'{}'::jsonb);
  new.criteria_key:=md5(new.criteria::text);
  return new;
end;
$$;

drop trigger if exists set_saved_search_criteria_key_before_write on public.saved_searches;
create trigger set_saved_search_criteria_key_before_write
before insert or update of criteria on public.saved_searches
for each row execute function public.set_saved_search_criteria_key();

create or replace function public.save_my_property_search(
  p_name text,
  p_search_kind text,
  p_criteria jsonb
)
returns uuid
language plpgsql
set search_path=pg_catalog,public
as $$
declare
  actor text:=public.current_profile_user_id();
  result uuid;
  clean_criteria jsonb:=coalesce(p_criteria,'{}'::jsonb);
  clean_key text;
begin
  if actor is null then raise exception 'Authenticated profile required'; end if;
  if p_search_kind not in ('homes','hotels') then raise exception 'Unsupported saved search'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Saved search name is required'; end if;
  clean_key:=md5(clean_criteria::text);

  insert into public.saved_searches(
    user_id,name,search_kind,criteria,criteria_key,notifications_enabled
  ) values (
    actor,btrim(p_name),p_search_kind,clean_criteria,clean_key,true
  )
  on conflict(user_id,search_kind,criteria_key) do update
    set name=excluded.name,
        criteria=excluded.criteria,
        notifications_enabled=true,
        updated_at=now()
  returning id into result;
  return result;
end;
$$;

revoke all on function public.save_my_property_search(text,text,jsonb) from public,anon;
grant execute on function public.save_my_property_search(text,text,jsonb) to authenticated,service_role;

comment on column public.saved_searches.criteria_key is
  'Stable identity for an exact set of followed-search filters.';
