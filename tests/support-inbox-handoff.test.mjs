import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
test('the approved roommate public profile remains byte-for-byte unchanged', () => {
 const content = fs.readFileSync('src/components/RoommatePublicProfile.tsx');
 const hash = crypto.createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
 assert.equal(hash, '7796aa246f4249effbe9ded0db3154f4624e6e15');
});
