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

test("one canonical profile photo follows the identity across workspaces", async () => {
  const [app, frame, account, switcher, worker, partner, hotel, creator, admin, staff] =
    await Promise.all([
      read("src/App.tsx"),
      read("src/components/WorkspaceFrameV2.tsx"),
      read("src/components/AccountShell.tsx"),
      read("src/components/WorkspaceSwitchSheet.tsx"),
      read("src/pages/WorkerWorkspaceModern.tsx"),
      read("src/pages/PropertyOwnerDashboard.tsx"),
      read("src/pages/HotelTeamDashboard.tsx"),
      read("src/pages/CreatorDashboard.tsx"),
      read("src/pages/AdminDashboard.tsx"),
      read("src/pages/StaffWorkspaceRepair.tsx"),
    ]);

  assert.match(app, /\.\.\.baseProfile/);
  assert.match(app, /userAvatar=\{profile\?\.avatar_url/);
  assert.match(frame, /identityAvatar/);
  assert.match(frame, /identityName/);
  assert.match(account, /profile\.avatar_url/);
  assert.match(switcher, /identityAvatar/);
  for (const source of [worker, partner, creator, admin, staff]) {
    assert.match(source, /identityAvatar=\{profile\.avatar_url\}/);
    assert.match(source, /identityName=\{profile\.full_name \|\| profile\.username\}/);
  }
  assert.match(hotel, /<AccountShell/);
  assert.match(hotel, /profile=\{profile\}/);
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
  assert.match(migration, /'property\.'\|\|v_stage\|\|'\.action_required'/);
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


test("frontend chart theming has no raw HTML injection sink", async () => {
  const chart = await read("src/components/ui/chart.tsx");
  assert.doesNotMatch(chart, /dangerouslySetInnerHTML/);
  assert.match(chart, /safeChartCssValue/);
  assert.match(chart, /return <style>\{css\}<\/style>/);
});


test("Creator exposes Personal through the canonical workspace switcher", async () => {
  const [app, creator, account] = await Promise.all([
    read("src/App.tsx"),
    read("src/pages/CreatorDashboard.tsx"),
    read("src/pages/AccountCenter.tsx"),
  ]);
  const creatorCall = app.slice(
    app.indexOf("<CreatorDashboard"),
    app.indexOf("/>", app.indexOf("<CreatorDashboard")) + 2,
  );
  assert.match(creatorCall, /workspaceAccess={workspaceAccess}/);
  assert.match(creatorCall, /activeWorkspace={activeWorkspace}/);
  assert.match(creatorCall, /onSwitchWorkspace={switchWorkspace}/);
  assert.match(creator, /WorkspaceSwitchSheet/);
  assert.match(creator, /onWorkspaceSwitch={workspaceAccess && onSwitchWorkspace/);
  assert.match(account, /onWorkspaceSwitch={ownAccess && onSwitchWorkspace/);
});

test("operations conversation opens from messages, not audit history and read receipt latency", async () => {
  const communications = await read("src/components/CommunicationsWorkspace.tsx");
  const refreshStart = communications.indexOf("async function refreshMessages");
  const refreshEnd = communications.indexOf("\n  useEffect", refreshStart);
  const refresh = communications.slice(refreshStart, refreshEnd);
  assert.match(refresh, /const historyRequest = getSupportCaseEvents\(id\)/);
  assert.match(refresh, /await getSupportMessages\(id\)/);
  assert.ok(
    refresh.indexOf("setLoadingThread(false)") < refresh.indexOf("await historyRequest"),
    "message thread should become usable before case history finishes",
  );
  assert.match(refresh, /void markSupportMessagesRead\(id\)/);
  assert.match(communications, /mine \? "justify-end" : "justify-start"/);
  assert.doesNotMatch(communications, /function ContextCard/);
});

test("login and first app paint use responsive WeHouse presentation", async () => {
  const [login, css, app, indexCss] = await Promise.all([
    read("src/pages/Login.tsx"),
    read("src/pages/login.css"),
    read("src/App.tsx"),
    read("src/index.css"),
  ]);
  assert.doesNotMatch(login, /One WeHouse account/);
  assert.match(login, /Sign in, or continue securely with Google/);
  assert.match(css, /grid-template-columns:\s*minmax\(220px, \.78fr\) minmax\(360px, 1fr\)/);
  assert.match(css, /max-width:\s*900px/);
  assert.match(app, /wh-launch-screen/);
  assert.match(app, /wh-launch-progress/);
  assert.match(indexCss, /@keyframes whLaunchMark/);
  assert.match(indexCss, /@keyframes whLaunchProgress/);
});
