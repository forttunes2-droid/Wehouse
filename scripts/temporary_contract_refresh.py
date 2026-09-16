from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected contract text not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


main = "tests/main-hardening-and-boundaries.test.mjs"
replace_once(
    main,
    'test("GitHub exposes stable required checks on Node 24 with production dependency audit", async () => {',
    'test("GitHub exposes stable required checks on Node 24 with full dependency audit", async () => {',
)
replace_once(
    main,
    'assert.match(build, /npm audit --omit=dev --audit-level=high/);',
    'assert.match(build, /npm audit --audit-level=high/);',
)
replace_once(
    main,
    '''test("Personal navigation is exactly Explore, Bookings, Inbox and Account", async () => {
  const app = await read("src/App.tsx");
  const start = app.indexOf("const tabs = useMemo");
  const end = app.indexOf("const navHistoryRef", start);
  const tabs = app.slice(start, end);
  assert.match(tabs, /label: "Explore"/);
  assert.match(tabs, /label: "Bookings"/);
  assert.match(tabs, /label: "Inbox"/);
  assert.match(tabs, /label: "Account"/);
  assert.doesNotMatch(tabs, /label: "Conversation"/);
});

test("Inbox keeps Activity and Messages in one product surface with separate counts", async () => {
  const [personal, provider, activity] = await Promise.all([
    read("src/pages/Chat.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
    read("src/components/InboxActivityEntry.tsx"),
  ]);
  assert.match(personal, /InboxActivityEntry/);
  assert.match(personal, /activityUnreadCount/);
  assert.match(personal, /Messages/);
  assert.match(provider, /InboxActivityEntry/);
  assert.match(provider, /displayedActivityUnread/);
  assert.match(provider, /displayedChatUnread/);
  assert.match(activity, /Activity/);
});''',
    '''test("Personal navigation is exactly Explore, Bookings, Conversation, Inbox and Account", async () => {
  const app = await read("src/App.tsx");
  const start = app.indexOf("const tabs = useMemo");
  const end = app.indexOf("const navHistoryRef", start);
  const tabs = app.slice(start, end);
  assert.match(tabs, /label: "Explore"/);
  assert.match(tabs, /label: "Bookings"/);
  assert.match(tabs, /label: "Conversation"/);
  assert.match(tabs, /label: "Inbox"/);
  assert.match(tabs, /label: "Account"/);
  assert.match(tabs, /id: "conversation"/);
  assert.match(tabs, /id: "notifications"/);
});

test("Conversation and Inbox are separate Personal surfaces with separate unread counts", async () => {
  const [app, conversation, inbox] = await Promise.all([
    read("src/App.tsx"),
    read("src/pages/Chat.tsx"),
    read("src/pages/Notifications.tsx"),
  ]);
  assert.match(app, /case "conversation"[\\s\\S]*conversationOnly/);
  assert.match(app, /case "notifications"[\\s\\S]*<Notifications/);
  assert.match(app, /tab\.id === "conversation"[\\s\\S]*unreadCount \+ supportUnreadCount/);
  assert.match(app, /tab\.id === "notifications"[\\s\\S]*notificationCount/);
  assert.match(conversation, /conversationOnly \? "Conversation" : "Inbox"/);
  assert.match(conversation, /!conversationOnly \? \(/);
  assert.match(inbox, /<h1 className="text-xl font-bold">Inbox<\\/h1>/);
});''',
)
replace_once(
    main,
    '''  assert.match(edge, /TURN_URLS/);
  assert.match(edge, /TURN_SHARED_SECRET/);
  assert.match(edge, /\\+ 60 \\* 60/);
  assert.match(edge, /crypto\\.subtle\\.sign/);
  assert.doesNotMatch(edge, /return json\\(\\{[^}]*TURN_SHARED_SECRET/);''',
    '''  assert.match(edge, /CLOUDFLARE_TURN_KEY_ID/);
  assert.match(edge, /CLOUDFLARE_TURN_API_TOKEN/);
  assert.match(edge, /rtc\\.live\\.cloudflare\\.com\\/v1\\/turn\\/keys/);
  assert.match(edge, /generate-ice-servers/);
  assert.match(edge, /ttlSeconds = 60 \\* 60/);
  assert.match(edge, /customIdentifier/);
  assert.doesNotMatch(edge, /return json\\(\\{[^}]*turnApiToken/);''',
)

turn = "tests/turn-security.test.mjs"
replace_once(
    turn,
    '''  assert.match(edge, /TURN_URLS/);
  assert.match(edge, /TURN_SHARED_SECRET/);
  assert.match(edge, /profile\\.user_id.*callId/);''',
    '''  assert.match(edge, /CLOUDFLARE_TURN_KEY_ID/);
  assert.match(edge, /CLOUDFLARE_TURN_API_TOKEN/);
  assert.match(edge, /rtc\\.live\\.cloudflare\\.com\\/v1\\/turn\\/keys/);
  assert.match(edge, /generate-ice-servers/);
  assert.match(edge, /ttlSeconds = 60 \\* 60/);
  assert.match(edge, /customIdentifier/);
  assert.doesNotMatch(edge, /TURN_SHARED_SECRET/);''',
)
