import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("receipt UI uses one lazy booking entry and compact PDF/print output", async () => {
  const [pdf, receipt, bookings, serviceChat, css] = await Promise.all([
    read("src/lib/receiptPdf.ts"),
    read("src/components/PaymentReceipt.tsx"),
    read("src/pages/MyReservations.tsx"),
    read("src/components/BookingNegotiationChat.tsx"),
    read("src/index.css"),
  ]);
  assert.doesNotMatch(pdf, /format:\s*["']a4["']/i);
  assert.match(pdf, /format:\s*\[PAGE_WIDTH, PAGE_HEIGHT\]/);
  assert.match(pdf, /PAGE_WIDTH\s*=\s*105/);
  assert.match(pdf, /PAGE_HEIGHT\s*=\s*148/);
  assert.match(receipt, /onClick=\{\(\) => void loadReceipts\(\)\}/);
  assert.doesNotMatch(receipt, /setAttempt/);
  assert.doesNotMatch(bookings, /<ReceiptAccess\s*\/>/);
  assert.doesNotMatch(serviceChat, /ReceiptAccess/);
  assert.match(css, /body\.printing-wehouse-receipt \* \{ visibility: hidden/);
  assert.match(css, /@page \{ size: 105mm 148mm/);
});

test("internal profile projection uses the real Staff timestamp and canonical scope helper", async () => {
  const migration = await read("supabase/migrations/20260921211500_repair_internal_profile_and_worker_summary.sql");
  assert.doesNotMatch(migration, /sp\.assigned_at/);
  assert.match(migration, /sp\.granted_at desc nulls last/);
  assert.match(migration, /perform public\._assert_admin_lga_scope\(p_target_user_id\)/);
  assert.match(migration, /workers_reviewed/);
  assert.match(migration, /workers_under_review/);
});

test("Inbox paints sources progressively instead of one five-source blocking request", async () => {
  const chat = await read("src/pages/Chat.tsx");
  assert.match(chat, /Promise\.allSettled\(tasks\)/);
  assert.match(chat, /finished === 1/);
  assert.match(chat, /Showing what is available/);
  assert.doesNotMatch(chat, /withTimeout\(Promise\.all\(\[/);
});

test("workspace history and sign-in restore keep internal workspaces intentional", async () => {
  const [app, session] = await Promise.all([
    read("src/App.tsx"),
    read("src/lib/workspaceSession.ts"),
  ]);
  assert.match(app, /pushState\(\{ page: safe, workspace: activeWorkspace \}/);
  assert.match(app, /replaceState\(\{ page: destination, workspace \}/);
  assert.match(app, /Browser Back must never silently change persona/);
  assert.match(session, /\["creator", "admin", "staff"\]|\['creator', 'admin', 'staff'\]/);
});

test("Admin work areas have one owner and action-first defaults", async () => {
  const [admin, housing] = await Promise.all([
    read("src/pages/AdminDashboard.tsx"),
    read("src/components/HousingOperationsWorkspace.tsx"),
  ]);
  assert.match(admin, /"people", "People"/);
  assert.match(admin, /"properties", "Property Operations"/);
  assert.match(admin, /"workers",\s*"Worker Operations"/);
  assert.match(admin, /"security",\s*"Security Operations"/);
  assert.match(admin, /Needs attention/);
  assert.doesNotMatch(admin, /branchReady|BranchMissing/);

  const propertiesBlock = admin.slice(
    admin.indexOf('active === "properties"'),
    admin.indexOf('active === "workers"'),
  );
  assert.match(propertiesBlock, /PropertyPipelineWorkspace/);
  assert.doesNotMatch(propertiesBlock, /AccountIdentityReviewQueue/);

  const peopleStart = admin.indexOf("function People(");
  const peopleEnd = admin.indexOf("function Workers(", peopleStart);
  const peopleBlock = admin.slice(peopleStart, peopleEnd);
  assert.match(peopleBlock, /AccountIdentityReviewQueue accountRole="property_partner"/);

  assert.match(housing, /useState<Filter>\("needs_action"\)/);
  assert.doesNotMatch(housing, /available in this branch|found in this branch/);
});

test("visible Activity surfaces use the canonical event model", async () => {
  const [page, creator, worker, partner, operations, app, migration] = await Promise.all([
    read("src/pages/Notifications.tsx"),
    read("src/hooks/useCreatorInboxSummary.ts"),
    read("src/hooks/useWorkerInboxSummary.ts"),
    read("src/hooks/usePartnerInboxSummary.ts"),
    read("src/hooks/useOperationsInboxSummary.ts"),
    read("src/App.tsx"),
    read("supabase/migrations/20260921223000_canonical_activity_domain_routing.sql"),
  ]);

  for (const source of [page, creator, worker, partner, operations]) {
    assert.match(source, /getCanonicalActivity|getCanonicalActivitySummary/);
    assert.doesNotMatch(source, /\.from\(["']notifications["']\)/);
  }
  assert.match(app, /getCanonicalActivitySummary\("personal"\)/);
  assert.match(app, /activity_event_audiences/);
  const personalCount = app.slice(
    app.indexOf("async function loadCounts"),
    app.indexOf("const toggle =", app.indexOf("async function loadCounts")),
  );
  assert.doesNotMatch(personalCount, /\.from\(["']notifications["']\)/);

  assert.match(migration, /private\.fanout_team_activity/);
  assert.match(migration, /worker\.review_submitted/);
  assert.match(migration, /finance\.withdrawal_review_required/);
  assert.match(migration, /property\.access_review\.action_required/);
  assert.match(migration, /hotel\.stay_confirmed/);
  assert.match(migration, /case\.action_required/);
  assert.match(migration, /revoke all on table public\.activity_events from anon,authenticated/);
  assert.match(migration, /revoke all on table public\.notifications from anon,authenticated/);
});

test("auth and Creator legal UI hide implementation detail by default", async () => {
  const [loginCss, login, legal, help] = await Promise.all([
    read("src/pages/login.css"),
    read("src/pages/Login.tsx"),
    read("src/components/CreatorLegalDocuments.tsx"),
    read("src/components/AccountHelpCenter.tsx"),
  ]);
  assert.doesNotMatch(loginCss, /wh-auth-mode-choose \.wh-auth-form \{ margin-block: auto/);
  assert.match(login, /Welcome to WeHouse/);
  assert.match(legal, /Before public launch/);
  assert.match(legal, /Private editor/);
  assert.match(legal, /showChecklist/);
  assert.doesNotMatch(help, /eyebrow="Finance Operations"/);
  assert.doesNotMatch(help, /eyebrow="Security Operations"/);
});
