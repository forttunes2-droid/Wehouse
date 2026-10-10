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

commit;
