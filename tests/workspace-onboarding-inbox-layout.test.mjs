import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("professional onboarding stays inside its workspace and never traps switching", async () => {
  const [worker, partner, owner, gate, frame, app] = await Promise.all([
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("src/pages/PropertyPartnerDashboard.tsx"),
    read("src/pages/PropertyOwnerDashboard.tsx"),
    read("src/components/IdentityAccessGate.tsx"),
    read("src/components/WorkspaceFrameV2.tsx"),
    read("src/App.tsx"),
  ]);

  assert.match(worker, /ACTIVATION_NAV = \[\{ id: "home", label: "Setup" \}\]/);
  assert.doesNotMatch(worker, /ACTIVATION_NAV[\s\S]{0,160}label: "Account"/);
  assert.match(worker, /WorkspaceSwitchSheet/);
  assert.match(worker, /onWorkspaceSwitch=/);
  assert.match(gate, /onWorkspaceSwitch\?: \(\) => void/);
  assert.match(gate, /onWorkspaceSwitch=\{onWorkspaceSwitch\}/);
  assert.match(partner, /WorkspaceSwitchSheet/);
  assert.match(partner, /workspace="property_partner"/);
  assert.match(owner, /onAccount=\{\(\) => onNavigate\("profile"\)\}/);
  assert.doesNotMatch(owner, /onWorkspaceSwitch=\{onWorkspaceSwitch\}/);
  assert.match(app, /workspaceAccess=\{workspaceAccess\}[\s\S]*activeWorkspace=\{activeWorkspace\}[\s\S]*onSwitchWorkspace=\{switchWorkspace\}/);
  assert.doesNotMatch(frame, />\s*Workspaces\s*</);
  assert.match(frame, /onClick=\{goAccount\}/);
});

test("Admin and Creator expose one canonical Worker surface", async () => {
  const [admin, creator, migration] = await Promise.all([
    read("src/pages/AdminDashboard.tsx"),
    read("src/pages/CreatorDashboard.tsx"),
    read("supabase/migrations/20260921102000_dedupe_admin_workspace_people_and_counts.sql"),
  ]);

  const adminWorkers = admin.slice(admin.indexOf("function Workers("), admin.indexOf("function UserList("));
  assert.doesNotMatch(adminWorkers, /AccountIdentityReviewQueue accountRole="worker"/);
  assert.match(adminWorkers, /WorkerReviewIdentityStatus/);
  assert.doesNotMatch(creator, /AccountIdentityReviewQueue accountRole="worker"/);
  assert.match(migration, /p_role='worker' and public\.user_has_active_workspace\(p\.user_id,'worker'\)/);
  assert.match(migration, /count\(distinct p\.user_id\)/);
  assert.match(migration, /p_role='user'[\s\S]*not public\.user_has_active_workspace\(p\.user_id,'worker'\)/);
});

test("growing home results become compact on phones without a tiny grid", async () => {
  const [search, card] = await Promise.all([
    read("src/pages/Search.tsx"),
    read("src/components/ListingCard.tsx"),
  ]);

  assert.match(search, /compactMobile=\{filtered\.length >= 3\}/);
  assert.match(card, /if \(!compactMobile\) return richCard/);
  assert.match(card, /sm:hidden/);
  assert.match(card, /hidden sm:block/);
  assert.match(card, /h-28 w-32 shrink-0/);
  assert.doesNotMatch(search, /grid-cols-2[^"\n]*max-sm/);
});

test("Inbox favors cache and realtime reconciliation over fixed polling", async () => {
  const [chat, admin, staff] = await Promise.all([
    read("src/pages/Chat.tsx"),
    read("src/pages/AdminDashboard.tsx"),
    read("src/pages/StaffWorkspaceRepair.tsx"),
  ]);

  assert.match(chat, /const inboxListCache = new Map/);
  assert.match(chat, /createRefreshScheduler/);
  assert.match(chat, /window\.addEventListener\("focus", reconcile\)/);
  assert.doesNotMatch(chat, /setInterval\([^)]*load/);
  assert.match(admin, /InboxActivityEntry/);
  assert.match(admin, /Back to Inbox messages/);
  assert.match(staff, /InboxActivityEntry/);
  assert.match(staff, /Assigned conversations in this Operation/);
});
