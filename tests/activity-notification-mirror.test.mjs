import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261010133000_restore_notification_activity_mirror.sql", import.meta.url),
  "utf8",
);

test("notification read/unread transitions replace canonical Activity read_at instead of preserving stale reads", () => {
  assert.match(migration, /read_at=case when new\.read then coalesce\(new\.read_at,now\(\)\)\s+else null end/);
  assert.match(migration, /read_at=excluded\.read_at/);
  assert.match(migration, /after insert or update of type,\s*read,\s*read_at,\s*title,\s*message,\s*destination_route,\s*destination_params/);
});

test("legacy notification deliveries are mirrored idempotently to recipient Activity audiences", () => {
  assert.match(migration, /'notification:'\|\|new\.id/);
  assert.match(migration, /on conflict\(event_key\) do update/);
  assert.match(migration, /on conflict\(activity_event_id,recipient_user_id,workspace\) do update/);
  assert.match(migration, /where n\.created_at >= now\(\) - interval '180 days'/);
});

const invitationWorkspaceMigration = readFileSync(
  new URL("../supabase/migrations/20261010150000_fix_resource_invitation_response_workspace_scope.sql", import.meta.url),
  "utf8",
);

test("hotel invitation responses are delivered to Hotel Activity, not Property Partner Activity", () => {
  assert.match(invitationWorkspaceMigration, /new\.type = 'hotel_team_invitation_response'/);
  assert.match(invitationWorkspaceMigration, /new\.workspace_scope := 'hotel'/);
  assert.match(invitationWorkspaceMigration, /new\.type = 'resource_invitation_response'/);
  assert.match(invitationWorkspaceMigration, /when 'hotel' then new\.workspace_scope := 'hotel'/);
  assert.match(invitationWorkspaceMigration, /when 'property' then new\.workspace_scope := 'property_partner'/);
  assert.match(invitationWorkspaceMigration, /before insert or update of type, destination_params, workspace_scope/);
  assert.match(invitationWorkspaceMigration, /after insert or update of type, read, read_at, title, message,[\\s\\S]*destination_route, destination_params, workspace_scope/);
  assert.match(invitationWorkspaceMigration, /update public\.notifications[\\s\\S]*where type in \('hotel_team_invitation_response','resource_invitation_response'\)/);
  assert.match(invitationWorkspaceMigration, /delete from public\.activity_event_audiences/);
});
