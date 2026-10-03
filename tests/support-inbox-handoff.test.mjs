import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path, 'utf8');
test('Help opens the existing scoped Inbox through the single global support renderer', () => {
 const app = read('src/App.tsx'), support = read('src/components/SupportChat.tsx');
 assert.equal((app.match(/<SupportChat\b/g) || []).length, 1);
 assert.match(app, /onOpenInbox=\{\(\) => \{[\s\S]*?goTo\(isUserRole \? "conversation" : roleRootFor\(userRole\)\)/);
 assert.match(support, /onOpenInbox\?\.\(\)/);
 assert.match(support, /useRecordScreenBack\(closeConversation, open\)/);
 assert.match(support, /useDialogInteraction\(dismiss, open\)/);
 assert.match(support, /drafts.current.set\(sendingKey/);
 assert.match(support, /drafts.current.delete\(sendingKey\)/);
 assert.match(support, /dispatchEvent\(new Event\("wehouse:unread-changed"\)\)/);
});
test('all customer workspaces retain Inbox handoff and hotel uses the authorised workspace alias', () => {
 const worker = read('src/pages/WorkerWorkspaceModern.tsx');
 const partner = read('src/pages/PropertyOwnerDashboard.tsx');
 const hotel = read('src/pages/HotelTeamDashboard.tsx');
 assert.match(worker, /inboxOpenRequest/); assert.match(worker, /setTab\("inbox"\)/);
 assert.match(worker, /!live && safeTab === "inbox"[\s\S]*?<SupportEntryCard profile=\{profile\} compact/);
 assert.match(partner, /inboxOpenRequest/); assert.match(partner, /setTab\("communication"\)/);
 assert.match(hotel, /inboxOpenRequest/); assert.match(hotel, /<SupportEntryCard profile=\{profile\}/);
 assert.match(read('src/lib/supabase/support.ts'), /workspace === "hotel_staff" \? "hotel"/);
 const list=read('src/components/SupportEntryCard.tsx');
 assert.match(list, /withTimeout\(getMySupportConversations/);
 assert.match(list, /profile.user_id, profile.role/);
 assert.match(list, /request !== generation.current/);
});
test('roommate public profile preserves the approved surface while keeping full-profile content separate', () => {
 const content = read('src/components/RoommatePublicProfile.tsx');
 assert.match(content, /<PublicProfileSurface/);
 assert.match(content, /suspended=\{fullProfile\}/);
 assert.match(content, /setFullProfile\(true\)/);
 assert.match(content, /var\(--wh-text-secondary\)/);
 assert.match(content, /var\(--wh-border-subtle\)/);
});