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
  assert.match(help, /get_my_workspace_help_targets/);
  assert.match(help, /Using WeHouse or my account/);
  assert.match(help, /Property or stay/);
  assert.match(help, /Service job/);
  assert.match(help, /Payment or payout/);
  assert.match(help, /Safety or account security/);
  assert.match(help, /worker_profile/);
  assert.match(help, /property_requests/);
  assert.match(help, /partner_reservations/);
  assert.match(help, /partner_hotel_bookings/);
});

test("Help routing is structured by reason and linked record, not inferred from message text", async () => {
  const [help, support, chat, migration] = await Promise.all([
    read("src/components/AccountHelpCenter.tsx"),
    read("src/lib/supabase/support.ts"),
    read("src/components/SupportChat.tsx"),
    read("supabase/migrations/20260916173000_account_help_routing.sql"),
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

test("optional Short Let caution gets a 30-60 minute check-in evidence window without changing Hotels", async () => {
  const [migration, form] = await Promise.all([
    read("supabase/migrations/20260916173100_optional_short_let_caution_window.sql"),
    read("src/components/PropertyInspectionRequestPanel.tsx"),
  ]);
  assert.match(migration, /short_let_caution_check_in_window/);
  assert.match(migration, /'default_minutes',60,'minimum_minutes',30,'maximum_minutes',60/);
  assert.match(migration, /This Short Let has no refundable caution amount/);
  assert.match(migration, /Legacy already-checked-in stays retain the old four-hour evidence window/);
  assert.doesNotMatch(migration, /alter table public\.hotel_bookings/);
  assert.doesNotMatch(migration, /set_hotel_arrival_deadline/);
  assert.match(form, /cautionEnabled/);
  assert.match(form, /No caution/);
  assert.match(form, /Use caution/);
  assert.match(form, /30–60 minute check-in window/);
});

test("Worker job-specific Message WeHouse keeps the 72-hour post-release shortcut", async () => {
  const migration = await read("supabase/migrations/20260914084537_worker_support_window_and_auth_grants.sql");
  assert.match(migration, /interval '72 hours'/);
  assert.match(migration, /protection_state='released'/);
});