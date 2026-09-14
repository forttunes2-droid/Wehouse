import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub exposes stable required check names and a dependent consolidation gate", async () => {
  const [build, consolidation] = await Promise.all([
    read(".github/workflows/profile-phase-check.yml"),
    read(".github/workflows/consolidation-validation.yml"),
  ]);
  assert.match(build, /name: WeHouse Build Check[\s\S]*jobs:[\s\S]*name: WeHouse Build Check/);
  assert.match(build, /pull_request:[\s\S]*merge_group:/);
  assert.match(consolidation, /name: Consolidation Validation[\s\S]*needs: \[tests-and-build, migration-replay\]/);
  assert.match(consolidation, /BUILD_RESULT[\s\S]*MIGRATION_RESULT/);
});

test("Activity owns one deterministic mobile back treatment", async () => {
  const layout = await read("src/components/DesktopLayout.tsx");
  assert.match(layout, /OWN_MOBILE_BACK[\s\S]*'activity'/);
  assert.match(layout, /activePage !== 'activity'/);
});

test("accommodation UI and database fail closed without Payment Protection", async () => {
  const [lifecycle, migration] = await Promise.all([
    read("src/lib/propertyBookingLifecycle.ts"),
    read("supabase/migrations/20260914070812_enforce_protected_accommodation_handover.sql"),
  ]);
  assert.match(lifecycle, /year_one_rent_protection_id/);
  assert.match(lifecycle, /stay_payment_protection_id/);
  assert.match(lifecycle, /Payment needs WeHouse review/);
  assert.match(migration, /Current Payment Protection is required before accommodation arrival or handover/);
  assert.match(migration, /create or replace function public\.get_public_hotel_detail/);
  assert.match(migration, /Internal WeHouse accounts cannot activate marketplace workspaces/);
  assert.match(migration, /workspace_one_marketplace_role_guard/);
});

test("Short Let naming and public location copy match the product boundary", async () => {
  const [title, detail] = await Promise.all([
    read("src/lib/listingPresentation.ts"),
    read("src/pages/ListingDetailCore.tsx"),
  ]);
  assert.doesNotMatch(title, /Short Stay/);
  assert.match(title, /Short Let/);
  assert.match(detail, /exact address,[\s\S]*full[\s\S]*accommodation payment is confirmed and protected/i);
});

test("paid Worker tools are not presented as a public trust badge", async () => {
  const [panel, profile, discovery] = await Promise.all([
    read("src/components/WorkerProPanel.tsx"),
    read("src/components/WorkerPublicProfile.tsx"),
    read("src/pages/WorkerDiscovery.tsx"),
  ]);
  assert.match(panel, /subscription pays for the business tools listed below/i);
  assert.doesNotMatch(panel, /gold PRO mark|<WorkerProBadge/);
  assert.doesNotMatch(profile, /WorkerProBadge/);
  assert.doesNotMatch(discovery, /WorkerProBadge/);
});

test("private Inbox unlock is independent from whether a job is still open", async () => {
  const [personalInbox, workerInbox, bookingChat] = await Promise.all([
    read("src/pages/ChatCore.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
    read("src/components/BookingNegotiationChat.tsx"),
  ]);
  assert.match(personalInbox, /useSecureInboxAccess/);
  assert.match(workerInbox, /useSecureInboxAccess/);
  assert.match(bookingChat, /!openConversation[\s\S]*secureChat\.state === "unlock_required"[\s\S]*<SecureChatOnboarding/);
  assert.match(bookingChat, /This job conversation is closed/);
});

test("Worker paid tools live under Account and load only when opened", async () => {
  const [workspace, account] = await Promise.all([
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("src/pages/AccountCenter.tsx"),
  ]);
  const nav = workspace.slice(workspace.indexOf("const LIVE_NAV"), workspace.indexOf("const ACTIVATION_NAV"));
  assert.doesNotMatch(nav, /Works|paid_tools|\bpro\b/);
  assert.match(workspace, /accountView === "paid_tools"/);
  assert.match(workspace, /function WorkerPaidToolsAccount[\s\S]*useWorkerPro/);
  assert.match(account, /Paid Worker tools/);
});

test("Worker chat does not repeat the full request card in the message timeline", async () => {
  const chat = await read("src/components/BookingNegotiationChat.tsx");
  const timeline = chat.slice(chat.indexOf("<main className="), chat.indexOf("</main>"));
  assert.doesNotMatch(timeline, /<JobRequestDetails/);
  assert.match(chat, /<JobRequestDetailsSheet/);
  assert.match(chat, /Requested date/);
  assert.doesNotMatch(chat, /\["Payment state"|\["Job state"/);
});

test("showcase comments stay a mobile sheet and video uses one playback stream", async () => {
  const viewer = await read("src/components/WorkerShowcasePostViewer.tsx");
  assert.match(viewer, /max-h-\[72dvh\]/);
  assert.match(viewer, /containerClassName="h-full w-full bg-transparent"/);
  assert.doesNotMatch(viewer, /<video src=\{src\} muted autoPlay loop/);
});
