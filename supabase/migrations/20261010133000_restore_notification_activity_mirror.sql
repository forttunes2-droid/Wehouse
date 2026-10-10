begin;

-- Notifications remain a compatibility/delivery table for existing lifecycle
-- writers. Mirror every new delivery into the canonical Activity feed so
-- invitation outcomes and other legacy-generated updates are visible after a
-- clean migration replay as well as on upgraded databases.
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
  into v_state
  from public.profiles p
  where p.user_id=new.recipient_id;

  insert into public.activity_events(
    event_key,event_type,subject_type,subject_id,actor_user_id,title,summary,
    route,route_params,occurred_at,created_at
  ) values(
    'notification:'||new.id,
    new.type,
    coalesce(nullif(btrim(new.source_type),''),'notification'),
    coalesce(nullif(btrim(new.source_id),''),nullif(btrim(new.related_id),''),new.id::text),
    null,
    new.title,
    new.message,
    coalesce(nullif(btrim(new.destination_route),''),'activity'),
    coalesce(new.destination_params,'{}'::jsonb),
    new.created_at,
    new.created_at
  )
  on conflict(event_key) do update set
    event_type=excluded.event_type,
    subject_type=excluded.subject_type,
    subject_id=excluded.subject_id,
    title=excluded.title,
    summary=excluded.summary,
    route=excluded.route,
    route_params=excluded.route_params
  returning activity_event_id into v_event_id;

  insert into public.activity_event_audiences(
    activity_event_id,recipient_user_id,workspace,domain,state_scope,read_at
  ) values(
    v_event_id,
    new.recipient_id,
    v_workspace,
    case when v_workspace in(
      'property_operations','field_operations','worker_operations',
      'finance_operations','security_operations','support'
    ) then v_workspace else null end,
    v_state,
    case when new.read then coalesce(new.read_at,now()) else null end
  )
  on conflict(activity_event_id,recipient_user_id,workspace) do update set
    domain=excluded.domain,
    state_scope=excluded.state_scope,
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

revoke all on function public.mirror_notification_to_activity() from public,anon,authenticated;
grant execute on function public.mirror_notification_to_activity() to service_role;

commit;
