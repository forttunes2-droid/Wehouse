-- Resolve a hotel team recipient before an invitation is sent.
-- The UI must not ask an owner to send a request to an opaque username without
-- showing the exact Personal account that the server will target.
create or replace function public.search_hotel_team_recipients(
  p_hotel_id integer,
  p_search text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_q text:=lower(btrim(coalesce(p_search,'')));
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  if not public.hotel_actor_has_capability(p_hotel_id,'hotel.team.manage') then
    raise exception 'Hotel team management access required';
  end if;
  if char_length(v_q)<2 then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.full_name,candidate.username),'[]'::jsonb)
    into v_result
  from (
    select p.user_id,p.full_name,p.username,p.avatar_url,p.city,p.state
    from public.profiles p
    where p.user_id<>v_actor
      and coalesce(p.account_kind,'consumer')='consumer'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        lower(coalesce(p.username,'')) like '%'||v_q||'%'
        or lower(coalesce(p.full_name,'')) like '%'||v_q||'%'
      )
    order by
      case when lower(coalesce(p.username,''))=v_q then 0
           when lower(coalesce(p.full_name,''))=v_q then 1 else 2 end,
      p.created_at desc
    limit 8
  ) candidate;
  return v_result;
end
$$;
revoke all on function public.search_hotel_team_recipients(integer,text) from public,anon;
grant execute on function public.search_hotel_team_recipients(integer,text) to authenticated;
