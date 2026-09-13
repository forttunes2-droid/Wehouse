-- Preview repair and compatibility aliases for additive Worker/Partner workspaces.
create or replace function public.get_my_canonical_activity(
  p_workspace text default 'personal',p_limit integer default 100
)
returns table(
  id uuid,type text,title text,message text,read boolean,created_at timestamptz,
  source_type text,source_id text,destination_route text,
  destination_params jsonb,workspace text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hotel',
    'staff','admin','creator','property_operations','field_operations',
    'worker_operations','finance_operations','security_operations','support'
  ) then raise exception 'Invalid Activity workspace'; end if;
  return query
  select e.activity_event_id,e.event_type,e.title,e.summary,
    a.read_at is not null,e.occurred_at,e.subject_type,e.subject_id,
    e.route,e.route_params,a.workspace
  from public.activity_event_audiences a
  join public.activity_events e on e.activity_event_id=a.activity_event_id
  where a.recipient_user_id=v_user
    and (
      (p_workspace='personal' and a.workspace in('personal','account'))
      or (p_workspace='partner' and a.workspace in('partner','property_partner','hotel'))
      or (p_workspace not in('personal','partner') and a.workspace=p_workspace)
    )
  order by e.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
end
$$;
revoke all on function public.get_my_canonical_activity(text,integer)
from public,anon;
grant execute on function public.get_my_canonical_activity(text,integer)
to authenticated,service_role;
