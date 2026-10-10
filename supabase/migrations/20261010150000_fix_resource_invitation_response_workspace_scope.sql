begin;

-- Team/resource invitation responses must be delivered into the inviter's matching
-- workspace. Legacy RPCs label hotel responses as property_partner, which makes
-- them disappear when the inviter opens Activity in the Hotel workspace.
create or replace function public.set_resource_invitation_response_workspace()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.type = 'hotel_team_invitation_response' then
    -- Legacy hotel-team acceptance writes property_partner, but the inviter
    -- must see it in the Hotel workspace that owns the team.
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

drop trigger if exists resource_invitation_response_workspace on public.notifications;
create trigger resource_invitation_response_workspace
before insert or update of type, destination_params, workspace_scope
on public.notifications
for each row
execute function public.set_resource_invitation_response_workspace();

-- The canonical mirror must observe workspace-only corrections as well.
drop trigger if exists notification_canonical_activity_mirror on public.notifications;
create trigger notification_canonical_activity_mirror
after insert or update of type, read, read_at, title, message,
  destination_route, destination_params, workspace_scope
on public.notifications
for each row execute function public.mirror_notification_to_activity();

-- Repair already-delivered invitation responses, not only future responses.
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

-- The mirror upsert creates the corrected audience; remove the obsolete
-- workspace audience so the same invitation cannot inflate counts in both.
delete from public.activity_event_audiences a
using public.activity_events e, public.notifications n
where e.activity_event_id = a.activity_event_id
  and e.event_key = 'notification:' || n.id
  and a.recipient_user_id = n.recipient_id
  and a.workspace is distinct from n.workspace_scope
  and n.type in ('hotel_team_invitation_response','resource_invitation_response');

commit;
