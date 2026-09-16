from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path: str) -> str:
    return (ROOT / path).read_text()

def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

# Personal: one top-level Inbox. Messages are the default view; Activity stays nested.
app_path = "src/App.tsx"
app = read(app_path)
app = replace_once(
    app,
    'const Notifications = lazy(() => import("@/pages/Notifications"));\n',
    '',
    'remove App Notifications route import',
)
app = replace_once(
    app,
    '  if (page === "messages" || page === "chat") page = "conversation";\n',
    '  if (["messages", "chat", "notifications", "activity"].includes(page))\n    page = "conversation";\n',
    'normalize legacy Inbox aliases',
)
old_tabs = '''            {\n              id: "conversation" as NavPage,\n              label: "Conversation",\n              icon: MessagesSvg,\n            },\n            {\n              id: "notifications" as NavPage,\n              label: "Inbox",\n              icon: InboxSvg,\n            },\n'''
new_tabs = '''            {\n              id: "conversation" as NavPage,\n              label: "Inbox",\n              icon: InboxSvg,\n            },\n'''
app = replace_once(app, old_tabs, new_tabs, 'Personal bottom navigation')
app = replace_once(
    app,
    '    const openNotifications = () => handleSetNavPage("notifications");\n',
    '    const openNotifications = () => handleSetNavPage("conversation");\n',
    'official updates open canonical Inbox',
)
old_activity_route = '''      case "activity": // legacy alias: Activity now lives inside Inbox\n      case "notifications":\n        return isUserRole ? (\n          <Notifications\n            profile={profile}\n            scope="personal"\n            onNavigate={openUserDestination}\n            onUnreadChange={setNotificationCount}\n          />\n        ) : (\n          renderRoleRoot()\n        );\n'''
app = replace_once(app, old_activity_route, '', 'remove competing Personal Activity page')
old_chat_route = '''      case "chat":\n      case "conversation":\n      case "messages":\n        return isUserRole ? (\n          <Chat\n            profile={profile}\n            onNavigate={openUserDestination}\n            conversationId={chatConvId}\n            peerUserId={chatPeerId}\n            onConversationClose={() => {\n              setChatConvId(null);\n              setChatPeerId(null);\n            }}\n            chatUnreadCount={unreadCount + supportUnreadCount}\n            conversationOnly\n          />\n        ) : (\n          renderRoleRoot()\n        );\n'''
new_chat_route = '''      case "activity":\n      case "notifications":\n      case "chat":\n      case "conversation":\n      case "messages":\n        return isUserRole ? (\n          <Chat\n            profile={profile}\n            onNavigate={openUserDestination}\n            conversationId={chatConvId}\n            peerUserId={chatPeerId}\n            onConversationClose={() => {\n              setChatConvId(null);\n              setChatPeerId(null);\n            }}\n            chatUnreadCount={unreadCount + supportUnreadCount}\n            activityUnreadCount={notificationCount}\n            onActivityUnreadChange={setNotificationCount}\n          />\n        ) : (\n          renderRoleRoot()\n        );\n'''
app = replace_once(app, old_chat_route, new_chat_route, 'canonical Personal Inbox route')
old_badge = '''                  const badgeCount =\n                    tab.id === "conversation"\n                      ? unreadCount + supportUnreadCount\n                      : tab.id === "notifications"\n                        ? notificationCount\n                        : 0;\n'''
new_badge = '''                  const badgeCount =\n                    tab.id === "conversation"\n                      ? unreadCount + supportUnreadCount + notificationCount\n                      : 0;\n'''
app = replace_once(app, old_badge, new_badge, 'combined Personal Inbox badge')
app = app.replace('Open Conversation to read it.', 'Open Inbox to read it.')
# MessagesSvg became redundant once Conversation stopped being a separate destination.
app, n = re.subn(
    r'function MessagesSvg\(\{ size, active \}: \{ size: number; active: boolean \}\) \{.*?\n\}\n(?=function InboxSvg)',
    '',
    app,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f'remove MessagesSvg: expected one function, found {n}')
write(app_path, app)

# Desktop navigation must express the same four Personal destinations.
nav_path = "src/lib/nav2.tsx"
nav = read(nav_path)
nav = replace_once(nav, "const CONVERSATION = icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');\n", '', 'remove separate Conversation icon')
old_user_nav = '''export function getUserNav(conversationUnread = 0, inboxUnread = 0): DesktopNavItem[] {\n  return [\n    { id: 'search', label: 'Explore', icon: SEARCH },\n    { id: 'my_reservations', label: 'Bookings', icon: RESERVATIONS },\n    { id: 'conversation', label: 'Conversation', icon: CONVERSATION, badge: conversationUnread > 0 ? conversationUnread : undefined },\n    { id: 'notifications', label: 'Inbox', icon: INBOX, badge: inboxUnread > 0 ? inboxUnread : undefined },\n    account(),\n  ];\n}\n'''
new_user_nav = '''export function getUserNav(conversationUnread = 0, inboxUnread = 0): DesktopNavItem[] {\n  const unread = conversationUnread + inboxUnread;\n  return [\n    { id: 'search', label: 'Explore', icon: SEARCH },\n    { id: 'my_reservations', label: 'Bookings', icon: RESERVATIONS },\n    { id: 'conversation', label: 'Inbox', icon: INBOX, badge: unread > 0 ? unread : undefined },\n    account(),\n  ];\n}\n'''
nav = replace_once(nav, old_user_nav, new_user_nav, 'desktop Personal Inbox navigation')
write(nav_path, nav)

# Staff: opening an Inbox record is read-only until an explicit take/claim action.
comm_path = "src/components/CommunicationsWorkspace.tsx"
comm = read(comm_path)
old_open = '''  async function open(row: any) {\n    if (profile.role === "staff" && queue !== "field_operations") {\n      const claimed = await claimCommunicationCase(row.conversation_id);\n      if (claimed.error)\n        return toast.error(\n          claimed.error.message || "This case could not be assigned",\n        );\n    }\n    setSelected(\n      profile.role === "staff"\n        ? {\n            ...row,\n            assigned_staff_id: profile.user_id,\n            assigned_staff_name:\n              profile.full_name || profile.username || "Current team member",\n            status: row.status === "open" ? "assigned" : row.status,\n          }\n        : row,\n    );\n'''
new_open = '''  async function open(row: any) {\n    setSelected(row);\n'''
comm = replace_once(comm, old_open, new_open, 'viewing must not auto-claim')
marker = '''  async function updateCase(action: CaseAction) {\n'''
take_fn = '''  async function takeConversation() {\n    if (!selected || updatingCase || profile.role !== "staff") return;\n    setUpdatingCase(true);\n    const claimed = await claimCommunicationCase(selected.conversation_id);\n    if (claimed.error) {\n      setUpdatingCase(false);\n      toast.error(claimed.error.message || "This work could not be assigned");\n      return;\n    }\n    toast.success(\n      conversationPresentation(selected, presentationAudience).operational\n        ? "Assignment taken"\n        : "Request assigned to you",\n    );\n    await load(true);\n    setUpdatingCase(false);\n  }\n\n'''
comm = replace_once(comm, marker, take_fn + marker, 'explicit Staff take action')
old_handler = '''    const handlerLabel =\n      selected.assigned_staff_name ||\n      profile.full_name ||\n      profile.username ||\n      "Current team member";\n'''
new_handler = '''    const handlerLabel =\n      selected.assigned_staff_name ||\n      (profile.role === "staff"\n        ? "Awaiting assignment"\n        : profile.full_name || profile.username || "Current team member");\n    const staffOwnsConversation =\n      profile.role !== "staff" || selected.assigned_staff_id === profile.user_id;\n    const staffCanTakeConversation =\n      profile.role === "staff" && !selected.assigned_staff_id;\n'''
comm = replace_once(comm, old_handler, new_handler, 'Staff assignment ownership')
old_lock = '''    const conversationLocked = Boolean(\n      !selectedPresentation.operational &&\n        (selected.status === "resolved" || selected.status === "closed"),\n    );\n'''
new_lock = '''    const conversationLocked = Boolean(\n      !staffOwnsConversation ||\n        (!selectedPresentation.operational &&\n          (selected.status === "resolved" || selected.status === "closed")),\n    );\n'''
comm = replace_once(comm, old_lock, new_lock, 'unclaimed conversations stay read-only')
claim_ui_marker = '''        {!selectedPresentation.operational && (\n        <section className="border-b border-white/[.06] bg-[#0B0F15] px-4 py-2.5">\n'''
claim_ui = '''        {profile.role === "staff" && !staffOwnsConversation ? (\n          <section className="flex items-center justify-between gap-3 border-b border-white/[.06] bg-amber-500/[.04] px-4 py-3">\n            <div className="min-w-0">\n              <p className="text-[10px] font-semibold text-amber-100">\n                {staffCanTakeConversation\n                  ? "This work is not assigned yet"\n                  : `Assigned to ${selected.assigned_staff_name || "another team member"}`}\n              </p>\n              <p className="mt-1 text-[8px] text-[#777E8E]">\n                Opening a record never assigns it. Take it explicitly before replying or changing its state.\n              </p>\n            </div>\n            {staffCanTakeConversation ? (\n              <button\n                type="button"\n                disabled={updatingCase}\n                onClick={() => void takeConversation()}\n                className="min-h-10 shrink-0 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-50"\n              >\n                {updatingCase\n                  ? "Assigning…"\n                  : selectedPresentation.operational\n                    ? "Take assignment"\n                    : "Take request"}\n              </button>\n            ) : null}\n          </section>\n        ) : null}\n'''
comm = replace_once(comm, claim_ui_marker, claim_ui + claim_ui_marker, 'explicit claim UI')
old_panel_props = '''          busy={updatingCase}\n          onSelectAction={(action) => {\n'''
new_panel_props = '''          busy={updatingCase}\n          canManage={staffOwnsConversation}\n          onSelectAction={(action) => {\n'''
comm = replace_once(comm, old_panel_props, new_panel_props, 'case actions require ownership')
old_panel_sig = '''  busy,\n  onSelectAction,\n'''
new_panel_sig = '''  busy,\n  canManage,\n  onSelectAction,\n'''
comm = replace_once(comm, old_panel_sig, new_panel_sig, 'CaseManagementPanel canManage signature')
old_panel_type = '''  busy: boolean;\n  onSelectAction: (action: CaseAction) => void;\n'''
new_panel_type = '''  busy: boolean;\n  canManage: boolean;\n  onSelectAction: (action: CaseAction) => void;\n'''
comm = replace_once(comm, old_panel_type, new_panel_type, 'CaseManagementPanel canManage type')
comm = replace_once(
    comm,
    '  const actions = availableCaseActions(row.status);\n',
    '  const actions = canManage ? availableCaseActions(row.status) : [];\n',
    'case actions hidden until explicit assignment',
)
write(comm_path, comm)

# Regression tests protect the canonical structure rather than the accidental split.
test_path = "tests/main-hardening-and-boundaries.test.mjs"
tests = read(test_path)
start = tests.index('test("Personal navigation is exactly Explore, Bookings, Conversation, Inbox and Account"')
end = tests.index('test("private messaging unlock is profile-session scoped', start)
replacement = '''test("Personal navigation is exactly Explore, Bookings, Inbox and Account", async () => {\n  const [app, nav] = await Promise.all([\n    read("src/App.tsx"),\n    read("src/lib/nav2.tsx"),\n  ]);\n  const start = app.indexOf("const tabs = useMemo");\n  const end = app.indexOf("const navHistoryRef", start);\n  const tabs = app.slice(start, end);\n  assert.match(tabs, /label: "Explore"/);\n  assert.match(tabs, /label: "Bookings"/);\n  assert.match(tabs, /label: "Inbox"/);\n  assert.match(tabs, /label: "Account"/);\n  assert.match(tabs, /id: "conversation"/);\n  assert.doesNotMatch(tabs, /label: "Conversation"/);\n  assert.doesNotMatch(tabs, /id: "notifications"/);\n  const userBlock = nav.slice(nav.indexOf("export function getUserNav"), nav.indexOf("export function getNavForRole"));\n  assert.doesNotMatch(userBlock, /label: ['"]Conversation['"]/);\n  assert.doesNotMatch(userBlock, /id: ['"]notifications['"]/);\n});\n\ntest("Personal Inbox owns Messages and nested Activity with one combined badge", async () => {\n  const [app, inbox] = await Promise.all([\n    read("src/App.tsx"),\n    read("src/pages/Chat.tsx"),\n  ]);\n  assert.match(app, /case "activity":[\\s\\S]*case "notifications":[\\s\\S]*case "conversation":[\\s\\S]*<Chat/);\n  assert.doesNotMatch(app, /conversationOnly/);\n  assert.match(app, /unreadCount \+ supportUnreadCount \+ notificationCount/);\n  assert.match(inbox, /<InboxActivityEntry/);\n  assert.match(inbox, /setView\("activity"\)/);\n  assert.match(inbox, /<h2 className="text-\\[15px\\] font-bold">Messages<\\/h2>/);\n});\n\ntest("Staff Inbox viewing never silently claims work", async () => {\n  const communications = await read("src/components/CommunicationsWorkspace.tsx");\n  const openStart = communications.indexOf("async function open(row: any)");\n  const openEnd = communications.indexOf("function addFiles", openStart);\n  const openBody = communications.slice(openStart, openEnd);\n  assert.doesNotMatch(openBody, /claimCommunicationCase/);\n  assert.match(communications, /async function takeConversation\(\)/);\n  assert.match(communications, /claimCommunicationCase\(selected\.conversation_id\)/);\n  assert.match(communications, />Take request</);\n  assert.match(communications, />Take assignment</);\n  assert.match(communications, /Opening a record never assigns it/);\n});\n\n'''
tests = tests[:start] + replacement + tests[end:]
write(test_path, tests)

# Remove this one-use patcher and workflow from the resulting code commit.
for transient in [
    ROOT / "scripts/temporary_canonical_inbox_repair.py",
    ROOT / ".github/workflows/temporary-canonical-inbox-repair.yml",
]:
    if transient.exists():
        transient.unlink()

print("Canonical Inbox repair applied")
