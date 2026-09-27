import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const read = path => fs.readFileSync(path, 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(read('src/lib/messageAttachment.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, URL });
const { messageAttachmentKind: kind, usableAttachmentUrl: safe, attachmentFileLabel: label, attachmentSize: size } = exports;
test('attachment MIME outranks filename and signed paths, especially audio/webm', () => {
 assert.equal(kind('audio/webm;codecs=opus', 'blob:opaque'), 'audio');
 assert.equal(kind('audio/webm', 'https://example.test/voice.webm?token=test'), 'audio');
 assert.equal(kind('video/mp4', 'blob:opaque'), 'video');
 assert.equal(kind('image/webp', 'https://example.test/private/token'), 'image');
 assert.equal(kind('application/pdf', 'https://example.test/photo.png'), 'file');
 assert.equal(kind('', 'https://example.test/photo.jpg?token=test'), 'image');
 assert.equal(kind('', 'https://example.test/voice.mp3?token=test'), 'file');
 assert.equal(kind('', 'https://example.test/clip.webm?token=test'), 'video');
 assert.equal(kind('', 'blob:opaque'), 'file');
});
test('attachments cannot become script, external protocol or HTML data links', () => {
 for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script/>', '//external.test/a', 'https://user:password@example.test/file', 'https://good.test/\nfile']) assert.equal(safe(url), false, url);
 for (const url of ['https://test.supabase.co/storage/v1/object/sign/file?token=test', 'blob:http://127.0.0.1/test', '/public/photo.webp', 'data:image/png;base64,AA==']) assert.equal(safe(url), true, url);
});
test('file labels never expose signed queries or raw upload paths', () => {
 assert.equal(label({url:'https://example.test/private/secret?token=secret'}),'Document');
 assert.equal(label({url:'https://example.test/private/key.pdf?token=secret'}),'PDF document');
 assert.equal(label({url:'blob:opaque',name:'folder/lease.pdf'}),'lease.pdf');
 assert.equal(size(1024),'1 KB'); assert.equal(size(1572864),'1.5 MB'); assert.equal(size(-1),'');
});
test('private, hotel, worker and support media share presentation, not permission transports', () => {
 for (const path of ['src/components/RoommateMessageBubble.tsx','src/components/HotelBookingChat.tsx','src/components/BookingNegotiationChat.tsx','src/components/SecureSupportAttachment.tsx']) assert.match(read(path), /MessageMedia/);
 const media = read('src/components/MessageMedia.tsx');
 assert.doesNotMatch(media, /supabase|fetch\(|dangerouslySetInnerHTML|<audio/);
 assert.match(media, /<VoiceNotePlayer/); assert.match(media, /<MediaViewer items=\{visual\}/);
 const support=read('src/components/SecureSupportAttachment.tsx');
 assert.match(support,/getSupportAttachmentUrl\(path\)/);assert.match(support,/withTimeout/);
});
test('compact property drafts cannot navigate, auto-send, or trigger a payment', () => {
 const source = read('src/components/SharedPropertyCard.tsx');
 const draft=source.slice(source.indexOf('export function PropertyDraftAttachment'));
 assert.match(draft, /<SharedPropertyCard property=\{property\} compact/);
 assert.doesNotMatch(draft, /onOpen=|sendMessage|createReservation|initialize.*Payment/);
 assert.match(source,/publicPropertyImages/);assert.match(source,/propertyReference/);
 const picker=read('src/components/PropertyShareDialog.tsx');
 assert.match(picker,/selectRoommateRecipients/);assert.match(picker,/queuePropertyShare/);
 assert.doesNotMatch(picker,/autoFocus|sendMessage\(|initialize.*Payment/);
});
test('request remains a collapsible booking note, never an acceptance or automatic chat message', () => {
 const request=read('src/components/HotelSpecialRequest.tsx');assert.match(request,/<details/);assert.match(request,/A request, not a confirmation/);
 assert.doesNotMatch(request, /sendHotelMessage|openHotelBookingConversation/);
 const chat=read('src/components/HotelBookingChat.tsx');assert.match(chat,/<HotelSpecialRequest request=\{specialRequest\} hotelView=\{hotelView\} inConversation/);
});
