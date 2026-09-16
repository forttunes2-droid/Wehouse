import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Personal exposes one Inbox destination with Messages and nested Activity", async () => {
  const [app, inbox, desktop] = await Promise.all([
    read("src/App.tsx"),
    read("src/pages/Chat.tsx"),
    read("src/lib/nav2.tsx"),
  ]);
  const start = app.indexOf("const tabs = useMemo");
  const end = app.indexOf("const navHistoryRef", start);
  const tabs = app.slice(start, end);
  assert.match(tabs, /label: "Explore"/);
  assert.match(tabs, /label: "Bookings"/);
  assert.match(tabs, /label: "Inbox"/);
  assert.match(tabs, /label: "Account"/);
  assert.doesNotMatch(tabs, /label: "Conversation"/);
  assert.doesNotMatch(tabs, /id: "notifications"/);
  assert.match(app, /case "activity":[\s\S]*case "notifications":[\s\S]*case "conversation":[\s\S]*<Chat/);
  assert.match(app, /unreadCount \+ supportUnreadCount \+ notificationCount/);
  assert.match(inbox, /<InboxActivityEntry/);
  assert.match(inbox, /setView\("activity"\)/);
  assert.match(inbox, />Messages</);
  const userNav = desktop.slice(desktop.indexOf("export function getUserNav"), desktop.indexOf("export function getNavForRole"));
  assert.match(userNav, /label: 'Inbox'/);
  assert.doesNotMatch(userNav, /label: 'Conversation'/);
});

test("Worker Inbox keeps Activity and job/WeHouse messages inside one destination", async () => {
  const source = await read("src/components/WorkerJobsPanelV2.tsx");
  assert.match(source, /function WorkerInboxPanel|export function WorkerInboxPanel/);
  assert.match(source, /<InboxActivityEntry/);
  assert.match(source, />Messages</);
  assert.match(source, /WorkerBookingConversation/);
});

test("Property Partner Inbox keeps Activity and messages together", async () => {
  const source = await read("src/components/CommunicationInbox.tsx");
  assert.match(source, /<InboxActivityEntry/);
  assert.match(source, />Messages</);
  assert.match(source, /getMyHotelConversations/);
  assert.match(source, /getMySupportConversations/);
});

test("Creator and Admin each expose one Inbox work area containing Activity and communications", async () => {
  const [creator, admin] = await Promise.all([
    read("src/pages/CreatorDashboard.tsx"),
    read("src/pages/AdminDashboard.tsx"),
  ]);
  for (const source of [creator, admin]) {
    assert.match(source, /label: "Inbox"/);
    assert.match(source, /<Notifications/);
    assert.match(source, /<CommunicationsWorkspace/);
  }
});

test("Staff Inbox does not claim work merely by viewing it", async () => {
  const [staff, communications] = await Promise.all([
    read("src/pages/StaffWorkspaceRepair.tsx"),
    read("src/components/CommunicationsWorkspace.tsx"),
  ]);
  assert.match(staff, /label: "Inbox"/);
  const openStart = communications.indexOf("async function open(row: any)");
  const openEnd = communications.indexOf("function addFiles", openStart);
  assert.ok(openStart >= 0 && openEnd > openStart);
  assert.doesNotMatch(communications.slice(openStart, openEnd), /claimCommunicationCase/);
  assert.match(communications, /async function takeConversation\(\)/);
  assert.match(communications, />Take request</);
  assert.match(communications, />Take assignment</);
});

test("Hotel Team has one Inbox surface with guest conversations and nested Activity", async () => {
  const source = await read("src/pages/HotelTeamDashboard.tsx");
  assert.match(source, /\[\['hotels', 'Hotels'\], \['inbox', 'Inbox'\]\]/);
  assert.match(source, /getMyHotelConversations/);
  assert.match(source, /<InboxActivityEntry/);
  assert.match(source, /<Notifications/);
  assert.doesNotMatch(source, /label: "Conversation"/);
});
