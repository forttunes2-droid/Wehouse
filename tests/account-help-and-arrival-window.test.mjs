import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Help remains nested inside the shared Account surface across workspaces", async () => {
  const [account, worker, partner, help] = await Promise.all([
    read("src/pages/AccountCenter.tsx"),
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("src/pages/PropertyOwnerDashboard.tsx"),
    read("src/components/AccountHelpCenter.tsx"),
  ]);
  assert.match(account, /AccountHelpCenter/);
  assert.match(account, /title="Help"/);
  assert.match(account, /setPanel\("help"\)/);
  assert.match(worker, /<AccountCenter/);
  assert.match(partner, /onAccount=\{\(\) => onNavigate\("profile"\)\}/);
  assert.match(help, /get_my_account_help_targets/);
  assert.match(help, /Using WeHouse or my account/);
  assert.match(help, /Property or stay/);
  assert.match(help, /Service job/);
  assert.match(help, /Payment or payout/);
  assert.match(help, /Safety or account security/);
});

test("Help routing is structured by reason and linked record, not inferred from message text", async () => {
  const [help, support, chat, migration] = await Promise.all([
    read("src/components/AccountHelpCenter.tsx"),
    read("src/lib/supabase/support.ts"),
    read("src/components/SupportChat.tsx"),
    read("supabase/migrations/20260916173000_account_help_and_arrival_minutes.sql"),
  ]);
  assert.match(help, /reason_code/);
  assert.match(help, /subject_type/);
  assert.match(help, /contextType: "contextual_help"/);
  assert.match(help, /contextType: "worker_booking"/);
  assert.match(help, /contextType: target\.context_type/);
  assert.match(support, /sendFirstContextualHelpMessage/);
  assert.match(chat, /contextType === "contextual_help"/);
  assert.match(migration, /open_contextual_case_conversation/);
  assert.match(migration, /get_my_account_help_targets/);
});

test("new Short Let and Hotel bookings use a 30-60 minute arrival-issue policy without rewriting old snapshots", async () => {
  const migration = await read("supabase/migrations/20260916173000_account_help_and_arrival_minutes.sql");
  assert.match(migration, /'default_minutes',60,'minimum_minutes',30,'maximum_minutes',60/);
  assert.match(migration, /arrival_issue_window_minutes=arrival_issue_window_hours\*60/);
  assert.match(migration, /make_interval\(mins=>v_minutes\)/);
  assert.match(migration, /A booked arrival policy snapshot is immutable/);
  assert.match(migration, /Short Let arrival-issue window must be between % and % minutes/);
  assert.match(migration, /Hotel arrival-issue window must be between % and % minutes/);
});

test("Worker job-specific Message WeHouse keeps the 72-hour post-release shortcut", async () => {
  const migration = await read("supabase/migrations/20260916144500_worker_help_window_72_hours.sql");
  assert.match(migration, /interval '72 hours'/);
  assert.match(migration, /protection_state='released'/);
});
