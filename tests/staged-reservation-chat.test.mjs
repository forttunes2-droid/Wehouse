import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = name => fs.readFileSync(name, 'utf8');
function load(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Intl, Map, Set });
  return exports;
}
const dates = load('src/lib/shortLetQuote.ts');
const messages = load('src/lib/chatMessageReconciliation.ts');
const selection = { checkIn:'2026-09-24', checkOut:'2026-09-26', today:'2026-09-23', lastDate:'2027-09-23', guests:2, maxGuests:2, minNights:1, maxNights:90 };
const plain = value => JSON.parse(JSON.stringify(value));
test('Reserve date validates selection without reading or calculating money', () => {
  const input = { ...selection, get nightlyRate() { throw Error('Money requested before reservation'); }, get refundableDeposit() { throw Error('Deposit requested before reservation'); } };
  const result = dates.validateShortLetDates(input);
  assert.deepEqual(plain(result), { valid:true, nights:2, error:'' });
  for (const key of ['total','rent','deposit','nightlyRate']) assert.equal(key in result, false);
});
test('date reservation rejects invalid dates, capacity and stay rules without a price dependency', () => {
  for (const change of [{checkIn:''},{checkOut:'2026-09-24'},{checkIn:'2026-02-30'},{guests:3},{guests:1.5},{guests:0},{maxGuests:0},{minNights:3},{maxNights:1},{checkOut:'2028-01-01'}]) assert.equal(dates.validateShortLetDates({...selection,...change}).valid,false);
});
test('the public date step has neither quote calculation nor combined price or payment initializer', () => {
  const source=read('src/pages/ListingDetailCore.tsx');
  const start=source.indexOf('Reserve your dates');
  const end=source.indexOf('No payment is taken at this step.', start);
  assert.ok(start>0 && end>start);
  const step=source.slice(start,end);
  assert.doesNotMatch(step,/quote\.(total|rent|deposit)|Estimated total|Stay rent|initialize.*Payment/);
  assert.doesNotMatch(source,/shortLetQuote\(/);
  assert.match(step,/Reserve date/);
});
test('a history refresh preserves pending and failed local messages without resurrecting removed server messages', () => {
  const sent={id:'old',created_at:'2026-09-23T00:00:00Z'};
  const waiting={id:'local',created_at:'2026-09-23T00:00:02Z',delivery_state:'sending'};
  const failed={id:'failed',created_at:'2026-09-23T00:00:01Z',delivery_state:'failed'};
  assert.deepEqual(plain(messages.reconcileChatMessages([sent,waiting,failed],[])),[failed,waiting]);
});
test('write acknowledgement replaces the pending ID and unlocks the bubble without a history reload', () => {
  const pending={id:'local',created_at:'2026-09-23T00:00:00Z',delivery_state:'sending',content:'Hello',sender_id:'alice'};
  const result=messages.acknowledgeChatMessage([pending],'local','server');
  assert.equal(result.length,1); assert.equal(result[0].id,'server'); assert.equal(result[0].delivery_state,undefined);
  assert.equal(result[0].content,'Hello'); assert.equal(result[0].sender_id,'alice');
  assert.equal(pending.id,'local');
});
test('realtime echo and acknowledgement never create duplicate messages', () => {
  const pending={id:'local',created_at:'2026-09-23T00:00:00Z',delivery_state:'sending'};
  const server={id:'server',created_at:pending.created_at};
  assert.deepEqual(plain(messages.acknowledgeChatMessage([pending,server],'local','server')),[server]);
  assert.deepEqual(plain(messages.reconcileChatMessages([pending],[{...pending,delivery_state:undefined}])).map(row=>row.id),['local']);
});
test('message acknowledgement does not await call history, receipts or an inbox reload', () => {
  const source=read('src/pages/ChatCore.tsx');
  const send=source.slice(source.indexOf('async function submit()'),source.indexOf('async function deleteFromMessages()'));
  assert.match(send,/acknowledgeChatMessage/); assert.doesNotMatch(send,/await loadRoommateMessages/);
  const load=source.slice(source.indexOf('const loadRoommateMessages'),source.indexOf('if (inboxSecurityStatus?.state',source.indexOf('const loadRoommateMessages')));
  assert.match(load,/void withTimeout\(supabase\.from\("private_calls"\)/);
  assert.match(load,/void Promise\.all/);
  assert.doesNotMatch(load,/\[result, callResult\]/);
});
test('property content paints before protected booking actions become available', () => {
  const source=read('src/pages/ListingDetailCore.tsx');
  const load=source.slice(source.indexOf('async function load()'),source.indexOf('function support('));
  assert.ok(load.indexOf('setLoading(false)')<load.indexOf('getReservationForListing'));
  assert.match(source,/Checking your booking status/); assert.match(source,/Refresh booking status/);
});
test('hotel chat is a real portal and unstable close callbacks do not retrigger history loading', () => {
  const source=read('src/components/HotelBookingChat.tsx');
  assert.match(source,/return createPortal\(/); assert.match(source,/<BackButton onClick=\{dismiss\}/);
  assert.doesNotMatch(source,/\[bookingId, initialConversationId, profile.user_id, load, onClose\]/);
  assert.match(source,/onCloseRef\.current\(\)/);
});
test('navigation dialogs use opaque page backgrounds rather than translucent previous pages', () => {
  for (const path of ['src/components/UserProfileModal.tsx','src/components/PropertyShareDialog.tsx','src/components/SharedPropertyWorkspacePrompt.tsx']) {
    const source=read(path); assert.doesNotMatch(source,/bg-black\/(70|75)/); assert.match(source,/bg-\[#090B10\]/);
  }
  assert.match(read('src/components/OperationalThreadSurface.tsx'),/fixed inset-0.*bg-\[#0E1219\]/);
});

 test('guest entry uses redacted public reads and keeps all personal actions behind sign-in', () => {
 const guest = read('src/components/GuestBrowseEntry.tsx');
 assert.match(guest, /getAllListings/); assert.match(guest, /getHotelById/);
 assert.doesNotMatch(guest, /supabase\.from|signInAnonymously|createReservation|createHotelBooking|initialize.*Payment/);
 assert.match(guest, /savePropertyLinkIntent\(target, sessionStorage\)/);
 assert.match(guest, /className="wh-public-entry"/);
 assert.doesNotMatch(guest, /createPortal|Explore places first|role="tab"/);
 });
