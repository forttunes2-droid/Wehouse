-- Canonical Activity read model. Existing lifecycle writers may continue to
-- create delivery notifications during migration; every delivery is mirrored
-- into durable Activity and the application reads Activity, not notifications.

create or replace function public.mirror_notification_to_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_event_id uuid;
  v_workspace text:=coalesce(nullif(btrim(new.workspace_scope),''),'personal');
  v_state text;
begin
  select coalesce(nullif(btrim(p.assigned_state),''),nullif(btrim(p.state),''))
  into v_state from public.profiles p where p.user_id=new.recipient_id;
  insert into public.activity_events(
    event_key,event_type,subject_type,subject_id,actor_user_id,title,summary,
    route,route_params,occurred_at,created_at
  ) values(
    'notification:'||new.id,new.type,
    coalesce(nullif(btrim(new.source_type),''),'notification'),
    coalesce(nullif(btrim(new.source_id),''),nullif(btrim(new.related_id),''),new.id::text),
    null,new.title,new.message,
    coalesce(nullif(btrim(new.destination_route),''),'activity'),
    coalesce(new.destination_params,'{}'::jsonb),new.created_at,new.created_at
  ) on conflict(event_key) do update set
    title=excluded.title,summary=excluded.summary,route=excluded.route,
    route_params=excluded.route_params
  returning activity_event_id into v_event_id;

  insert into public.activity_event_audiences(
    activity_event_id,recipient_user_id,workspace,domain,state_scope,read_at
  ) values(
    v_event_id,new.recipient_id,v_workspace,
    case when v_workspace in(
      'property_operations','field_operations','worker_operations',
      'finance_operations','security_operations','support'
    ) then v_workspace else null end,
    v_state,case when new.read then coalesce(new.read_at,now()) else null end
  ) on conflict(activity_event_id,recipient_user_id,workspace) do update set
    read_at=case when new.read then coalesce(new.read_at,now())
      else activity_event_audiences.read_at end;
  return new;
end
$$;

drop trigger if exists notification_canonical_activity_mirror
  on public.notifications;
create trigger notification_canonical_activity_mirror
after insert or update of read,read_at,title,message,destination_route,destination_params
on public.notifications
for each row execute function public.mirror_notification_to_activity();

with source as (
  select n.*,coalesce(nullif(btrim(p.assigned_state),''),nullif(btrim(p.state),'')) state_scope
  from public.notifications n
  join public.profiles p on p.user_id=n.recipient_id
  where n.created_at>=now()-interval '180 days'
), inserted as (
  insert into public.activity_events(
    event_key,event_type,subject_type,subject_id,actor_user_id,title,summary,
    route,route_params,occurred_at,created_at
  )
  select 'notification:'||s.id,s.type,
    coalesce(nullif(btrim(s.source_type),''),'notification'),
    coalesce(nullif(btrim(s.source_id),''),nullif(btrim(s.related_id),''),s.id::text),
    null,s.title,s.message,
    coalesce(nullif(btrim(s.destination_route),''),'activity'),
    coalesce(s.destination_params,'{}'::jsonb),s.created_at,s.created_at
  from source s
  on conflict(event_key) do update set title=excluded.title
  returning activity_event_id,event_key
)
insert into public.activity_event_audiences(
  activity_event_id,recipient_user_id,workspace,domain,state_scope,read_at
)
select e.activity_event_id,s.recipient_id,
  coalesce(nullif(btrim(s.workspace_scope),''),'personal'),
  case when s.workspace_scope in(
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ) then s.workspace_scope else null end,
  s.state_scope,case when s.read then coalesce(s.read_at,s.created_at) else null end
from source s
join public.activity_events e on e.event_key='notification:'||s.id
on conflict(activity_event_id,recipient_user_id,workspace) do update set
  read_at=coalesce(excluded.read_at,activity_event_audiences.read_at);

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
    'personal','account','staff','admin','creator',
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
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
      or (p_workspace<>'personal' and a.workspace=p_workspace)
    )
  order by e.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
end
$$;

create or replace function public.mark_my_canonical_activity_read(
  p_activity_event_id uuid,p_workspace text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  update public.activity_event_audiences set read_at=coalesce(read_at,now())
  where activity_event_id=p_activity_event_id
    and recipient_user_id=v_user and workspace=p_workspace;
  return found;
end
$$;

create or replace function public.mark_all_my_canonical_activity_read(
  p_workspace text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id(); v_count integer;
begin
  update public.activity_event_audiences set read_at=coalesce(read_at,now())
  where recipient_user_id=v_user and read_at is null
    and ((p_workspace='personal' and workspace in('personal','account'))
      or (p_workspace<>'personal' and workspace=p_workspace));
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

revoke all on function public.mirror_notification_to_activity()
from public,anon,authenticated;
revoke all on function public.get_my_canonical_activity(text,integer)
from public,anon;
revoke all on function public.mark_my_canonical_activity_read(uuid,text)
from public,anon;
revoke all on function public.mark_all_my_canonical_activity_read(text)
from public,anon;
grant execute on function public.mirror_notification_to_activity() to service_role;
grant execute on function public.get_my_canonical_activity(text,integer)
to authenticated,service_role;
grant execute on function public.mark_my_canonical_activity_read(uuid,text)
to authenticated,service_role;
grant execute on function public.mark_all_my_canonical_activity_read(text)
to authenticated,service_role;
