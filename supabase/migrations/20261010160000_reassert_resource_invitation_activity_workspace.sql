begin;

-- Reassert the invitation workspace correction on already-provisioned preview
-- databases. Editing an applied migration does not replay it remotely.
create or replace function public.set_resource_invitation_response_workspace()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.type = 'hotel_team_invitation_response' then
    new.workspace_scope := 'hotel';
  elsif new.type = 'resource_invitation_response' then
    case lower(coalesce(new.destination_params->>'resource_type', ''))
      when 'hotel' then new.workspace_scope := 'hotel';
      when 'property' then new.workspace_scope := 'property_partner';
      else null;
    end case;
  end if;
  return new;
end
$$;

revoke all on function public.set_resource_invitation_response_workspace()
  from public, anon, authenticated;

drop trigger if exists resource_invitation_response_workspace
  on public.notifications;
create trigger resource_invitation_response_workspace
before insert or update of type, destination_params, workspace_scope
on public.notifications
for each row
execute function public.set_resource_invitation_response_workspace();

-- Mirror workspace-only repairs into canonical Activity as well as normal
-- notification updates, so workspace counts and inbox rows stay in agreement.
drop trigger if exists notification_canonical_activity_mirror
  on public.notifications;
create trigger notification_canonical_activity_mirror
after insert or update of type, read, read_at, title, message,
  destination_route, destination_params, workspace_scope
on public.notifications
for each row
execute function public.mirror_notification_to_activity();

-- Correct previously delivered outcomes. The BEFORE trigger enforces the
-- canonical workspace; the AFTER trigger upserts its matching Activity audience.
update public.notifications
set workspace_scope = case
  when type = 'hotel_team_invitation_response' then 'hotel'
  when type = 'resource_invitation_response'
    and lower(coalesce(destination_params->>'resource_type','')) = 'hotel' then 'hotel'
  when type = 'resource_invitation_response'
    and lower(coalesce(destination_params->>'resource_type','')) = 'property' then 'property_partner'
  else workspace_scope
end
where type in ('hotel_team_invitation_response','resource_invitation_response')
  and workspace_scope is distinct from case
    when type = 'hotel_team_invitation_response' then 'hotel'
    when type = 'resource_invitation_response'
      and lower(coalesce(destination_params->>'resource_type','')) = 'hotel' then 'hotel'
    when type = 'resource_invitation_response'
      and lower(coalesce(destination_params->>'resource_type','')) = 'property' then 'property_partner'
    else workspace_scope
  end;

-- Remove only obsolete audiences for the repaired invitation notifications.
-- This avoids double-counting one event in both the old and correct workspace.
delete from public.activity_event_audiences a
using public.activity_events e, public.notifications n
where e.activity_event_id = a.activity_event_id
  and e.event_key = 'notification:' || n.id
  and a.recipient_user_id = n.recipient_id
  and a.workspace is distinct from n.workspace_scope
  and n.type in ('hotel_team_invitation_response','resource_invitation_response');

commit;
