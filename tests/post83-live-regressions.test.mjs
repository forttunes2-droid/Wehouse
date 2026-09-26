import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Creator preserves Account workspace access without duplicating its shortcut in the shared header", () => {
  const creator = read("src/pages/CreatorDashboard.tsx");
  const app = read("src/App.tsx");
  const frame = read("src/components/WorkspaceFrameV2.tsx");
  assert.match(creator, /WorkspaceSwitchSheet/);
  assert.match(creator, /onWorkspaceSwitch=/);
  assert.match(creator, /workspaceAccess/);
  assert.match(app, /<CreatorDashboard[\s\S]*workspaceAccess=\{workspaceAccess\}[\s\S]*onSwitchWorkspace=\{switchWorkspace\}/);
  assert.doesNotMatch(frame, /onClick=\{onWorkspaceSwitch \|\| onAccount\}/);
  assert.match(frame, /onClick=\{goAccount\}/);
  assert.match(creator, /onAccount=/);
});

test("Operations chat is projected by one server bundle with internal notes separated", () => {
  const support = read("src/lib/supabase/support.ts");
  const communications = read("src/components/CommunicationsWorkspace.tsx");
  const migration = read("supabase/migrations/20260922014500_operational_conversation_bundle.sql");
  assert.match(support, /get_operational_conversation_bundle/);
  assert.match(communications, /getOperationalConversationBundle/);
  assert.doesNotMatch(communications, /getSupportMessages\(id\).*getSupportCaseEvents/s);
  assert.match(communications, /InternalNotes/);
  assert.match(communications, /ThreadSkeleton/);
  assert.match(communications, /ConversationListSkeleton/);
  assert.match(communications, /listLoadedRef/);
  assert.doesNotMatch(communications, /h-7 w-7 animate-spin rounded-full border-2 border-violet-500/);
  assert.doesNotMatch(communications, /Internal work note · \{msg\.sender_name/);
  assert.doesNotMatch(communications, /mine=\{msg\.sender_id/);
  assert.match(migration, /m\.visibility='internal'/);
  assert.match(migration, /coalesce\(m\.action_type,''\)<>'status_change'/);
  assert.match(migration, /current_actor_can_access_operational_conversation/);
});

test("Login keeps a bounded, aligned composition and one restrained workspace entrance", () => {
  const login = read("src/pages/login.css");
  const css = read("src/index.css");
  const app = read("src/App.tsx");
  assert.match(login, /@media \(min-width: 760px\)/);
  assert.doesNotMatch(login, /grid-template-columns/);
  assert.match(login, /max-width: 480px/);
  assert.doesNotMatch(login, /backdrop-filter:\s*blur/);
  assert.match(css, /whWorkspaceHeaderIn/);
  assert.match(css, /whWorkspaceContentIn/);
  assert.match(app, /wh-workspace-enter/);
  assert.match(app, /wh-auth-to-app-shell/);
  assert.match(css, /\.wh-auth-to-app-shell\s*\{\s*animation: none;/);
  assert.match(css, /\.page-transition\.wh-workspace-enter\s*\{\s*animation: none;/);
  assert.match(css, /whAuthToAppPiece/);
  assert.match(css, /prefers-reduced-motion/);
});


test("coordinated release starts after the verified PR83 production boundary", () => {
  const release = read("scripts/coordinated-database-release.py");
  assert.match(release, /20260921235500/);
  assert.match(release, /Partial post-baseline rollout detected/);
});
