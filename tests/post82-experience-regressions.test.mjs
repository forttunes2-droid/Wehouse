import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("receipt UI uses one lazy booking entry and one branded compact PDF", async () => {
  const [pdf, receipt, bookings, serviceChat, css] = await Promise.all([
    read("src/lib/receiptPdf.ts"),
    read("src/components/PaymentReceipt.tsx"),
    read("src/pages/MyReservations.tsx"),
    read("src/components/BookingNegotiationChat.tsx"),
    read("src/index.css"),
  ]);
  assert.doesNotMatch(pdf, /format:\s*["']a4["']/i);
  assert.match(receipt, /onClick=\{\(\) => void loadReceipts\(\)\}/);
  assert.doesNotMatch(receipt, /setAttempt/);
  assert.doesNotMatch(bookings, /<ReceiptAccess\s*\/>/);
  assert.doesNotMatch(serviceChat, /ReceiptAccess/);
  assert.match(pdf, /doc\.addImage\(receiptMark/);
  assert.doesNotMatch(receipt, /window\.print\(\)|>Print<\/button>/);
  assert.match(css, /input\[type="date"\], input\[type="datetime-local"\] \{ color-scheme: inherit/);
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
  const propertiesBlock = admin.slice(admin.indexOf('active === "properties"'), admin.indexOf('active === "workers"'));
  assert.match(propertiesBlock, /PropertyPipelineWorkspace/);
  assert.doesNotMatch(propertiesBlock, /AccountIdentityReviewQueue/);
  const peopleStart = admin.indexOf("function People(");
  const peopleEnd = admin.indexOf("function Workers(", peopleStart);
  const peopleBlock = admin.slice(peopleStart, peopleEnd);
  assert.match(peopleBlock, /AccountIdentityReviewQueue accountRole="property_partner"/);
  assert.match(housing, /useState<Filter>\("needs_action"\)/);
  assert.doesNotMatch(housing, /available in this branch|found in this branch/);
});

test("Account owns the canonical photo; professional headers do not duplicate it", async () => {
  const [app, frame, account, switcher, worker, partner, hotel, creator, admin, staff] = await Promise.all([
    read("src/App.tsx"),
    read("src/components/WorkspaceFrameV2.tsx"),
    // The identity card owns the photo. AccountShell is navigation only.
    read("src/pages/AccountCenter.tsx"),
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
  assert.doesNotMatch(frame, /<img/);
  assert.doesNotMatch(frame, /aria-label=\{onWorkspaceSwitch/);
  assert.match(partner, /onAccount=/);
  assert.match(hotel, /<WorkspaceFrameV2/);
  assert.match(hotel, /onAccount=/);
  for (const source of [creator, admin, staff]) assert.match(source, /onAccount=/);
  assert.match(worker, /label: "Account"/);

});

test("visible Activity surfaces use the canonical event model", async () => {
  const [page, creator, worker, partner, operations, app, migration] = await Promise.all([
    read("src/pages/Notifications.tsx"), read("src/hooks/useCreatorInboxSummary.ts"),
    read("src/hooks/useWorkerInboxSummary.ts"), read("src/hooks/usePartnerInboxSummary.ts"),
    read("src/hooks/useOperationsInboxSummary.ts"), read("src/App.tsx"),
    read("supabase/migrations/20260921223000_canonical_activity_domain_routing.sql"),
  ]);
  for (const source of [page, creator, worker, partner, operations]) {
    assert.match(source, /getCanonicalActivity|getCanonicalActivitySummary/);
    assert.doesNotMatch(source, /\.from\(["']notifications["']\)/);
  }
  assert.match(app, /getCanonicalActivity\("personal", 100\)/);
  assert.match(app, /currentActivityRows\(activityResult\.rows\)/);
  assert.doesNotMatch(app, /getCanonicalActivitySummary\("personal"\)/);
  assert.match(app, /activity_event_audiences/);
  const personalCount = app.slice(app.indexOf("async function loadCounts"), app.indexOf("const toggle =", app.indexOf("async function loadCounts")));
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
    read("src/pages/login.css"), read("src/pages/Login.tsx"),
    read("src/components/CreatorLegalDocuments.tsx"), read("src/components/AccountHelpCenter.tsx"),
  ]);
  assert.doesNotMatch(loginCss, /wh-auth-mode-choose \.wh-auth-form \{ margin-block: auto/);
  assert.match(login, />Welcome<\/h1>/);
  assert.match(login, /Sign in or create your WeHouse account\./);
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


test("mobile experience keeps operational hierarchy compact and partner tools consolidated", async () => {
  const [partner, tools, housing, inbox, share, reservations, pro, security, video, roommate, roommateProfile, account, creatorModal, migration] = await Promise.all([
    read("src/pages/PropertyOwnerDashboard.tsx"),
    read("src/components/PartnerToolsWorkspace.tsx"),
    read("src/components/HousingOperationsWorkspace.tsx"),
    read("src/components/CommunicationInbox.tsx"),
    read("src/components/PropertyShareDialog.tsx"),
    read("src/pages/MyReservations.tsx"),
    read("src/components/PropertyPartnerProWorkspace.tsx"),
    read("src/pages/SecuritySettings.tsx"),
    read("src/components/VideoPlayer.tsx"),
    read("src/pages/Roommate.tsx"),
    read("src/components/RoommatePublicProfile.tsx"),
    read("src/pages/AccountCenter.tsx"),
    read("src/components/CreatorAuthModal.tsx"),
    read("supabase/migrations/20261003123000_roommate_request_match_details.sql"),
  ]);
  assert.match(partner, /key: "tools"/);
  assert.doesNotMatch(partner, /key: "pro"/);
  assert.doesNotMatch(partner, /key: "sponsored"/);
  assert.match(tools, /Partner Pro/);
  assert.match(tools, /Sponsored placement/);
  assert.doesNotMatch(housing, /Bookings and handovers/);
  assert.match(housing, /Verify booking/);
  assert.match(inbox, /Promise\.all\(requests\.map/);
  assert.match(inbox, /aria-label="Loading conversations"/);
  assert.match(inbox, /wh-skeleton/);
  assert.doesNotMatch(share, /To split a Short Let stay/);
  assert.doesNotMatch(share, /To split a Long Let reservation/);
  assert.match(reservations, /Short Let/);
  assert.match(reservations, /Long Let/);
  assert.match(reservations, /\{ value: "hotels", label: "Hotel" \}/);
  assert.match(reservations, /status=\{propertyBookingStatusLabel\(row\)\}/);
  assert.match(reservations, /status=\{HOTEL_STATUS\[String\(row\.status \|\| ""\)\] \|\| "Active"\}/);
  assert.match(reservations, /overflow-x-auto/);
  assert.match(pro, /Partner tools could not load/);
  assert.match(security, /Additional protection/);
  assert.match(video, /Video unavailable here/);
  assert.match(roommate, /receivedUserIds/);
  assert.match(roommate, /acceptedIncomingIds/);
  assert.match(roommate, /uniqueMatches/);
  assert.match(roommate, /row\.status === "accepted"/);
  assert.match(roommateProfile, /!fullProfile && <PublicProfileSurface/);
  assert.match(account, /Choose how WeHouse looks on this device/);\n  assert.match(account, /role="radiogroup"/);
  assert.doesNotMatch(account, /Automatic/);
  assert.doesNotMatch(account, /h-28/);
  assert.match(creatorModal, /var\(--wh-surface\)/);
  assert.match(migration, /get_my_received_roommate_interests/);
  assert.match(migration, /match_highlights text\[\]/);
});


test("shared reservation state stays participant-specific and payment-gated", async () => {
  const [details, share, rpc] = await Promise.all([
    read("src/components/SharedHousingDetails.tsx"),
    read("src/components/ShortLetSplitCosts.tsx"),
    read("src/lib/supabase/shared-housing.ts"),
  ]);
  assert.match(details, /member\.user_id === userId/);
  assert.match(details, /allAccepted/);
  assert.match(details, /payment_status/);
  assert.match(details, /reservation is no longer accepting new participants/);
  assert.doesNotMatch(share, /split cost/i);
  assert.match(share, /same reservation/);
  assert.match(share, /reservation_fee_status/);
  assert.match(rpc, /createSharedShortLet/);
  assert.match(rpc, /respondToSharedHousingInvite/);
});

test("media viewer keeps one coherent full-screen shell with safe navigation actions", async () => {
  const [viewer, photo, video] = await Promise.all([
    read("src/components/MediaViewer.tsx"),
    read("src/components/ZoomablePhoto.tsx"),
    read("src/components/VideoPlayer.tsx"),
  ]);
  assert.match(viewer, /Back from media preview/);
  assert.match(viewer, /navigator\.share/);\n  assert.match(viewer, /ExternalLink/);
  assert.match(photo, /touchAction: 'none'/);
  assert.match(photo, /onPrevious/);
  assert.match(video, /playsInline/);
  assert.match(video, /View video full screen/);
});
