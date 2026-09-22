import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Creator exposes the canonical workspace switcher instead of trapping identity in Account", () => {
  const creator = read("src/pages/CreatorDashboard.tsx");
  const app = read("src/App.tsx");
  const frame = read("src/components/WorkspaceFrameV2.tsx");
  assert.match(creator, /WorkspaceSwitchSheet/);
  assert.match(creator, /onWorkspaceSwitch=/);
  assert.match(creator, /workspaceAccess/);
  assert.match(app, /<CreatorDashboard[\s\S]*workspaceAccess=\{workspaceAccess\}[\s\S]*onSwitchWorkspace=\{switchWorkspace\}/);
  assert.match(frame, /onClick=\{onWorkspaceSwitch \|\| onAccount\}/);
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
  assert.match(migration, /m\.visibility='internal'/);
  assert.match(migration, /coalesce\(m\.action_type,''\)<>'status_change'/);
  assert.match(migration, /current_actor_can_access_operational_conversation/);
});

test("Login widens into a balanced desktop composition and workspaces enter in stages", () => {
  const login = read("src/pages/login.css");
  const css = read("src/index.css");
  const app = read("src/App.tsx");
  assert.match(login, /@media \(min-width: 760px\)[\s\S]*grid-template-columns/);
  assert.match(login, /max-width: 920px/);
  assert.match(css, /whWorkspaceHeaderIn/);
  assert.match(css, /whWorkspaceContentIn/);
  assert.match(app, /wh-workspace-enter/);
  assert.match(css, /prefers-reduced-motion/);
});
