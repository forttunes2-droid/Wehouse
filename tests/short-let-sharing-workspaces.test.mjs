import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const cache = new Map();
function load(name, mocks = {}, extra = {}) {
  const filename = path.resolve(name);
  if (!Object.keys(mocks).length && !Object.keys(extra).length && cache.has(filename)) return cache.get(filename);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, require: requested => {
    if (requested in mocks) return mocks[requested];
    if (!requested.startsWith('.')) throw Error(`Unexpected dependency ${requested}`);
    return load(path.resolve(path.dirname(filename), `${requested}.ts`));
  }, URL, Date, Intl, Map, Set, Number, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, crypto: webcrypto, btoa, atob, setTimeout, clearTimeout, ...extra });
  if (!Object.keys(mocks).length && !Object.keys(extra).length) cache.set(filename, exports);
  return exports;
}
const plain = data => JSON.parse(JSON.stringify(data));
const quote = load('src/lib/shortLetQuote.ts');
const sharing = load('src/lib/propertyShare.ts');
const defaultStay = { checkIn: '2026-09-24', checkOut: '2026-09-26', today: '2026-09-23', lastDate: '2027-09-23', guests: 2, maxGuests: 2, minNights: 1, maxNights: 90, nightlyRate: 120000, refundableDeposit: 50000 };

test('Short Let has no deposit-only or fabricated total before complete valid dates', () => {
  for (const change of [{ checkIn: '' }, { checkOut: '' }, { checkOut: '2026-09-24' }, { checkIn: '2026-09-22' }, { checkOut: '2026-02-30' }, { checkOut: '2028-01-01' }]) {
    const result = quote.shortLetQuote({ ...defaultStay, ...change });
    assert.equal(result.valid, false); assert.equal(result.total, null);
  }
  assert.deepEqual(plain(quote.shortLetQuote(defaultStay)), { valid: true, total: 290000, nights: 2, rent: 240000, deposit: 50000, error: '' });
});
test('Short Let capacity, stay rules and non-finite commercial values fail closed', () => {
  for (const change of [{ guests: 3 }, { guests: 0 }, { guests: 1.5 }, { maxGuests: 0 }, { minNights: 3 }, { maxNights: 1 }, { nightlyRate: NaN }, { nightlyRate: 0 }, { refundableDeposit: -1 }, { refundableDeposit: Infinity }]) assert.equal(quote.shortLetQuote({ ...defaultStay, ...change }).valid, false);
  assert.equal(quote.nigeriaCalendarDate(new Date('2026-09-23T23:30:00Z')), '2026-09-24');
  assert.equal(quote.calendarDay('2026-02-30'), null);
  assert.equal(quote.addCalendarDays('2026-09-30', 1), '2026-10-01');
});
test('Short Let Reserve date creates its existing booking but does not initiate a payment', () => {
  const text = fs.readFileSync('src/pages/ListingDetailCore.tsx', 'utf8');
  const action = text.slice(text.indexOf('async function reserveShortLet'), text.indexOf('async function openCheckout'));
  assert.match(action, /createShortStayReservation\(listingId, shortCheckIn, shortCheckOut, shortGuests\)/);
  assert.match(action, /onOpenBooking/); assert.match(action, /!quote.valid/);
  assert.doesNotMatch(action, /initialize.*Payment|window.location/);
  assert.match(text, /Reserve date/); assert.doesNotMatch(text, /Pay for stay ·/);
});
test('Saved preserves public type, exact identifiers and rental units', () => {
  const routes = load('src/lib/publicPropertyDestination.ts');
  assert.equal(routes.publicPropertyDestination('hotel_detail', '7').kind, 'hotel');
  assert.equal(routes.publicPropertyDestination('detail', '7').kind, 'listing');
  assert.equal(routes.publicPropertyDestination('hotel_detail', 'javascript:7'), null);
  const labels = load('src/lib/savedPlacePresentation.ts');
  assert.equal(labels.savedHomePrice(120000, true), '₦120,000 / night');
  assert.equal(labels.savedHomePrice(120000, false), '₦120,000 / year');
  assert.equal(labels.savedHomePrice(undefined, true), 'View price and details');
});
test('property messages carry only canonical public references, never a financial command', () => {
  const ref = { kind: 'hotel', id: '7' };
  const text = sharing.propertyShareMessage(ref, 'Let us look at this one');
  assert.deepEqual(plain(sharing.parsePropertyShareMessage(text)), { property: ref, text: 'Let us look at this one' });
  for (const url of ['javascript:alert(1)', 'https://evil.invalid/#place/hotel/7', 'https://wehouse.com.ng.evil.invalid/#place/hotel/7', 'https://wehouse.com.ng/#place/hotel/0', 'https://wehouse.com.ng/#place/hotel/7?payment=paid', 'https://wehouse.com.ng/?token=secret#place/hotel/7', 'https://wehouse.com.ng/#place/listing/../private', 'https://x@wehouse.com.ng/#place/hotel/7']) assert.equal(sharing.parsePropertyShareUrl(url), null, url);
  assert.equal(sharing.propertyMessagePreview(sharing.propertyShareMessage(ref)), 'Shared a property');
});
test('queued property sends are account- and conversation-bound, expire, and can be cancelled', () => {
  sharing.queuePropertyShare('alice', 'accepted-1', { kind: 'listing', id: 'home-1' }, 0);
  assert.equal(sharing.pendingPropertyShare('bob', 'accepted-1', 1), null);
  assert.equal(sharing.pendingPropertyShare('alice', 'other', 1), null);
  assert.equal(sharing.pendingPropertyShare('alice', 'accepted-1', 1).id, 'home-1');
  assert.equal(sharing.pendingPropertyShare('alice', 'accepted-1', 900001), null);
  sharing.queuePropertyShare('alice', 'accepted-1', { kind: 'hotel', id: '7' }, 0);
  sharing.clearPropertyShare('alice', 'accepted-1');
  assert.equal(sharing.pendingPropertyShare('alice', 'accepted-1', 1), null);
});
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
test('public link intent survives login without storing private context or changing workspace', () => {
  const intent = load('src/lib/propertyLinkIntent.ts'), store = storage(), ref = { kind: 'listing', id: 'home-1' };
  intent.savePropertyLinkIntent(ref, store, 0);
  assert.deepEqual(plain(intent.readPropertyLinkIntent('https://wehouse.com.ng/#login', store, 1)), ref);
  assert.equal(intent.readPropertyLinkIntent('https://wehouse.com.ng/#login', store, 1800001), null);
  assert.deepEqual(plain(intent.readPropertyLinkIntent('https://wehouse.com.ng/#place/hotel/7', store, 2)), { kind: 'hotel', id: '7' });
  intent.savePropertyLinkIntent(null, store, 3); assert.equal(intent.readPropertyLinkIntent('https://wehouse.com.ng/#login', store, 4), null);
});
test('recipient chooser joins authoritative peer identities and excludes pending, blocked and unrelated chats', () => {
  const recipients = load('src/lib/roommateRecipients.ts');
  const people = { bob: { user_id: 'bob', name: 'Bob Example', username: 'bob', avatar: null, isBlocked: false }, blocked: { user_id: 'blocked', name: 'Blocked person', avatar: null, isBlocked: true } };
  const base = { participant_a: 'alice', participant_b: 'bob', conversation_type: 'roommate', status: 'active' };
  const rows = [{ ...base, id: 'accepted' }, { ...base, id: 'pending', status: 'pending' }, { ...base, id: 'unrelated', participant_a: 'other' }, { ...base, id: 'blocked', participant_b: 'blocked' }, { ...base, id: 'missing', participant_b: 'missing' }];
  const result = recipients.selectRoommateRecipients('alice', rows, people);
  assert.equal(result.recipients.length, 1); assert.equal(result.recipients[0].name, 'Bob Example'); assert.equal(result.recipients[0].conversationId, 'accepted'); assert.equal(result.missingIdentityCount, 1);
});
test('Activity never infers the audience from a highest role and preserves intentional aliases', () => {
  const { activityWorkspaceMatches: matches } = load('src/lib/activityWorkspace.ts');
  for (const scope of ['creator','admin','worker','property_partner','hotel','staff']) assert.equal(matches(scope, 'personal'), false, scope);
  assert.equal(matches('personal','creator'), false); assert.equal(matches('personal','account'), true);
  assert.equal(matches('hotel','hotel_staff'), true); assert.equal(matches('partner','property_partner'), true);
  assert.equal(matches('staff','field_operations'), true); assert.equal(matches('staff','admin'), false);
  assert.equal(matches('worker_operations','staff'), true); assert.equal(matches('worker_operations','field_operations'), false);
  assert.equal(matches('creator',undefined), false);
});
test('Creator/Admin destinations preserve hotel, home and inspection identities without a public fallback', () => {
  const { internalActivityDestination: destination } = load('src/lib/internalActivityDestination.ts');
  for (const [route, kind] of [['hotel_detail','hotel'],['detail','listing'],['inspection','inspection']]) assert.deepEqual(plain(destination(route,'7')), { operation:'properties', id:`${kind}:7` });
  assert.deepEqual(plain(destination('hotel_booking','42')), {operation:'bookings',id:'42'});
  assert.deepEqual(plain(destination('security_operations','case-1')), {operation:'security',id:'case-1'});
  assert.equal(destination('invented_other_dashboard','7'), null);
});
test('hotel daily totals and their destination filters agree and exclude cancelled arrivals', () => {
  const daily = load('src/lib/hotelDailyWork.ts'), date='2026-09-24';
  const stays=[{status:'confirmed',check_in:date,check_out:'2026-09-25'},{status:'cancelled',check_in:date,check_out:'2026-09-25'},{status:'checked_in',check_in:'2026-09-23',check_out:date},{status:'payment_conflict',check_in:'2026-09-30',check_out:'2026-10-01'}];
  assert.deepEqual(plain(daily.hotelTodayMetrics(stays,date)), {arrivals:1,staying:1,departures:1,attention:2});
  for (const [label,filter] of [['arrivals','arrivals_today'],['staying','staying'],['departures','departures_today'],['attention','attention']]) assert.equal(daily.hotelTodayMetrics(stays,date)[label],stays.filter(row=>daily.matchesHotelReservationFilter(row,filter,date)).length);
});
test('Saved retrieval is concurrency-bounded and preserves input order', async () => {
  const { mapConcurrent } = load('src/lib/mapConcurrent.ts'); let active=0,peak=0;
  const result=await mapConcurrent([1,2,3,4,5],2,async value=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return value*2;});
  assert.deepEqual(plain(result),[2,4,6,8,10]);assert.equal(peak,2);
});
test('a property share uses real encryption and only the intended second identity can decrypt it', async () => {
  const identities=new Map(), envelopes=new Map(), stored=[];
  function client(user) {
    return {
      from(table) {
        const filters={}; const query={select(){return query;},eq(k,v){filters[k]=v;return query;},order(){return query;},limit(){return query;},async maybeSingle(){
          if(table==='user_encryption_identities')return {data:identities.get(user)||null,error:null};
          if(table==='conversation_key_envelopes')return {data:envelopes.get(`${filters.conversation_kind}:${filters.conversation_id}:${user}`)||null,error:null};
          throw Error(`Unexpected table ${table}`);
        },async insert(row){assert.equal(table,'user_encryption_identities');assert.equal(row.user_id,user);identities.set(user,{...row,key_version:1});return {error:null};}};return query;
      },
      async rpc(name,args={}) {
        if(name==='current_profile_user_id')return {data:user,error:null};
        if(name==='get_private_chat_peer_public_key') {
          if(args.p_conversation_id!=='accepted-1'||!['alice','bob'].includes(user)||!['alice','bob'].includes(args.p_peer_user_id)||args.p_peer_user_id===user) return {data:null,error:new Error('Conversation access denied')};
          return {data:[identities.get(args.p_peer_user_id)],error:null};
        }
        if(name==='establish_private_conversation_key'){for(const row of args.p_envelopes)envelopes.set(`${args.p_conversation_kind}:${args.p_conversation_id}:${row.recipient_user_id}`,row);return {data:true,error:null};}
        if(name==='send_private_encrypted_message'){stored.push(args);return {data:'message-1',error:null};}
        throw Error(`Unexpected RPC ${name}`);
      }
    };
  }
  const aliceClient=client('alice'),bobClient=client('bob');
  const alice=load('src/lib/e2ee.ts',{'@/lib/supabase':{supabase:aliceClient}},{sessionStorage:storage()});
  const bob=load('src/lib/e2ee.ts',{'@/lib/supabase':{supabase:bobClient}},{sessionStorage:storage()});
  await alice.createEncryptionIdentity('123456');await bob.createEncryptionIdentity('654321');
  const chat=load('src/lib/supabase/chat.ts',{'./client':{supabase:aliceClient},'./utils':{},'@/lib/e2ee':alice});
  const clear=sharing.propertyShareMessage({kind:'listing',id:'home-1'},'Please check this place');
  const result=await chat.sendMessage('accepted-1','bob',clear);
  assert.equal(result.error,null); assert.equal(stored.length,1);assert.equal(stored[0].p_conversation_kind,'roommate');
  assert.ok(!JSON.stringify(stored[0]).includes('home-1'));assert.ok(!JSON.stringify(stored[0]).includes('Please check'));
  const decoded=await bob.decryptPrivateMessage('roommate','accepted-1','alice',stored[0].p_ciphertext,stored[0].p_encryption_iv);
  assert.equal(decoded,clear);assert.equal(sharing.parsePropertyShareMessage(decoded).property.id,'home-1');
  await bob.lockEncryptionIdentity();await assert.rejects(()=>bob.unlockEncryptionIdentity('000000'),/Incorrect/);
  await bob.unlockEncryptionIdentity('654321');assert.equal(await bob.decryptPrivateMessage('roommate','accepted-1','alice',stored[0].p_ciphertext,stored[0].p_encryption_iv),clear);
  const outsider=load('src/lib/e2ee.ts',{'@/lib/supabase':{supabase:client('outsider')}},{sessionStorage:storage()});
  await outsider.createEncryptionIdentity('777777');await assert.rejects(()=>outsider.decryptPrivateMessage('roommate','accepted-1','alice',stored[0].p_ciphertext,stored[0].p_encryption_iv),/access denied/);
});
