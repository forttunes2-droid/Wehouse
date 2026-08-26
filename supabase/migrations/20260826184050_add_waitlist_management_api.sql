create or replace function public.get_waitlist_signups(
  p_search text default null,
  p_interest text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles;
  v_rows jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id = auth.uid()::text
    and role in ('creator','admin')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Creator or Admin access required'; end if;
  if v_actor.role='admin' and nullif(btrim(coalesce(v_actor.assigned_lga,'')),'') is null then
    raise exception 'Admin branch assignment required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at desc),'[]'::jsonb)
  into v_rows
  from public.waitlist_signups w
  where (v_actor.role='creator' or lower(btrim(coalesce(w.city,'')))=lower(btrim(v_actor.assigned_lga)))
    and (nullif(btrim(coalesce(p_interest,'')),'') is null or w.interest=p_interest)
    and (nullif(btrim(coalesce(p_status,'')),'') is null or w.status=p_status)
    and (nullif(btrim(coalesce(p_search,'')),'') is null or concat_ws(' ',w.full_name,w.email,w.phone,w.city,w.interest) ilike '%'||btrim(p_search)||'%');
  return v_rows;
end;
$$;

create or replace function public.update_waitlist_signup(
  p_id uuid,
  p_status text,
  p_notified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles;
  v_row public.waitlist_signups;
begin
  if p_status not in ('waiting','contacted','invited','joined','archived') then raise exception 'Invalid waitlist status'; end if;
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('creator','admin')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Creator or Admin access required'; end if;
  select * into v_row from public.waitlist_signups where id=p_id for update;
  if v_row is null then raise exception 'Waitlist signup not found'; end if;
  if v_actor.role='admin' and lower(btrim(coalesce(v_row.city,'')))<>lower(btrim(coalesce(v_actor.assigned_lga,''))) then
    raise exception 'This signup is outside your branch';
  end if;
  update public.waitlist_signups set status=p_status,notified=p_notified where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.get_waitlist_signups(text,text,text) from public, anon;
revoke all on function public.update_waitlist_signup(uuid,text,boolean) from public, anon;
grant execute on function public.get_waitlist_signups(text,text,text) to authenticated;
grant execute on function public.update_waitlist_signup(uuid,text,boolean) to authenticated;
