import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('delegated Hosting is projected from accepted co-host access, not Property Partner ownership', async () => {
  const [invite, scope, app, workspace, ownerWorkspace] = await Promise.all([
    read('supabase/migrations/20260926111500_resource_invitations_and_hosting_workspace.sql'),
    read('supabase/migrations/20260926111600_hosting_scope_permissions.sql'),
    read('src/App.tsx'),
    read('src/pages/HostingDashboard.tsx'),
    read('src/pages/PropertyOwnerDashboard.tsx'),
  ]);
  assert.match(invite, /'role','hosting'/);
  assert.match(invite, /assignment_role='manager'/);
  assert.doesNotMatch(invite, /That user must activate a Property Partner workspace first/);
  assert.match(scope, /get_my_hosting_properties/);
  assert.match(app, /isHostingRole/);
  assert.match(app, /HostingDashboard/);
  assert.match(workspace, /delegatedOnly/);
  assert.match(ownerWorkspace, /WEHOUSE · HOSTING/);
  assert.match(ownerWorkspace, /get_my_hosting_properties/);
  assert.match(ownerWorkspace, /!delegatedOnly && tab === "finance"/);
});

test('co-host permission presets are enforced by database commercial controls', async () => {
  const [invite, scope, panel, controls] = await Promise.all([
    read('supabase/migrations/20260926111500_resource_invitations_and_hosting_workspace.sql'),
    read('supabase/migrations/20260926111600_hosting_scope_permissions.sql'),
    read('src/components/PropertyManagementPanel.tsx'),
    read('src/components/PropertyHostControls.tsx'),
  ]);
  assert.match(invite, /access_level in \('operations','full_hosting'\)/);
  assert.match(scope, /current_actor_can_change_property_commercials/);
  assert.match(scope, /Full hosting access is required to change future price/);
  assert.match(scope, /Full hosting access is required to change booking availability/);
  assert.match(scope, /Full hosting access is required to change closed dates/);
  assert.match(panel, /create_property_cohost_invitation/);
  assert.match(panel, /Operations/);
  assert.match(panel, /Full hosting/);
  assert.match(controls, /can_manage_commercials/);
});

test('resource invitations use hashed expiring link tokens and canonical Activity', async () => {
  const [migration, activity, action] = await Promise.all([
    read('supabase/migrations/20260926111500_resource_invitations_and_hosting_workspace.sql'),
    read('src/pages/Notifications.tsx'),
    read('src/components/ResourceInvitationAction.tsx'),
  ]);
  assert.match(migration, /resource_invitations/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /delivery in \('direct','link'\)/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /Invitation link is invalid/);
  assert.match(migration, /status<>'pending'/);
  assert.match(migration, /source_type,source_id/);
  assert.match(migration, /'resource_invitation'/);
  assert.match(activity, /ResourceInvitationAction/);
  assert.match(action, /respond_to_resource_invitation/);
  assert.match(action, /wehouse:workspace-access-changed/);
});

test('public property sharing remains view-only and separate from invitation authority', async () => {
  const share = await read('src/lib/propertyShare.ts');
  assert.match(share, /A shared property is a public reference, not a reservation or payment invite/);
  assert.match(share, /propertyShareUrl/);
  assert.doesNotMatch(share, /resource_invitations|property_host_assignments|hotel_team_members/);
});

test('Worker capacity is enforced at verified-public transition', async () => {
  const [migration, ui] = await Promise.all([
    read('supabase/migrations/20260926112000_worker_market_capacity.sql'),
    read('src/components/WorkerCapacityManager.tsx'),
  ]);
  assert.match(migration, /worker_market_capacity/);
  assert.match(migration, /profiles_worker_market_capacity_guard/);
  assert.match(migration, /worker_status='verified'/);
  assert.match(migration, /worker_verified=true/);
  assert.match(migration, /approvals_paused/);
  assert.match(migration, /hard_limit/);
  assert.match(ui, /creator_set_worker_market_capacity/);
  assert.match(ui, /staff_authority/);
});

test('Sponsored is one generic paid-visibility foundation, separate from Worker Pro and organic ranking', async () => {
  const [migration, ui, discovery] = await Promise.all([
    read('supabase/migrations/20260926112500_sponsored_campaign_foundation.sql'),
    read('src/components/SponsoredMarketRules.tsx'),
    read('src/pages/WorkerDiscovery.tsx'),
  ]);
  assert.match(migration, /resource_type in \('worker','property','hotel'\)/);
  assert.match(migration, /sponsored_campaigns/);
  assert.match(migration, /status in \('draft','pending_payment','active','paused','expired','cancelled'\)/);
  assert.match(migration, /worker_featured_sales_enabled/);
  assert.match(migration, /set value='false'/);
  assert.match(ui, /Workers, Homes and Hotels|Workers, Homes and Hotels\./);
  assert.match(ui, /verified payment activation/);
  assert.match(discovery, /SPONSORED/);
});

test('new marketplace control UIs use semantic theme tokens', async () => {
  const files = await Promise.all([
    read('src/components/WorkerCapacityManager.tsx'),
    read('src/components/SponsoredMarketRules.tsx'),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}/);
    assert.match(source, /bg-card|bg-background/);
    assert.match(source, /text-foreground/);
    assert.match(source, /border-border/);
  }
});
