import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function moduleAt(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => dependencies[name] ?? require(name), setTimeout, clearTimeout, URLSearchParams, console, ...globals });
  return exports;
}
const dates = moduleAt('src/lib/displayDate.ts');
const lifecycle = moduleAt('src/lib/propertyBookingLifecycle.ts', {'./displayDate':dates});
test('Short Let starts with the stay payment and never asks for a reservation fee', () => {
  const row = { stay_type:'short_let', status:'payment_pending', rent_payment_status:'not_started', security_deposit_snapshot:50000 };
  const journey=lifecycle.getPropertyBookingJourney(row);
  assert.equal(journey.action,'rent_payment');
  assert.equal(journey.steps[0].label,'Stay payment');
  assert.doesNotMatch(JSON.stringify(journey.steps),/reservation fee/i);
  const long=lifecycle.getPropertyBookingJourney({...row,stay_type:'long_stay'});
  assert.equal(long.action,'reservation_payment');
});
test('Booking dates name the month and do not expose invalid dates', () => {
  assert.equal(dates.displayDate('2026-09-24'),'24 Sept 2026');
  assert.equal(dates.displayDate('not-a-date'),'—');
  assert.equal(dates.displayDate(null),'—');
});
test('A hotel receipt renders the verified merchant, stay, amount and reference with a Test label', () => {
  const {ReceiptDocument}=moduleAt('src/components/PaymentReceipt.tsx', {
    '@/lib/displayDate':dates, '@/lib/supabase/receipts':{}, '@/components/ui/dialog':{}, '@/components/BackButton':moduleAt('src/components/BackButton.tsx'),
  });
  const html=renderToStaticMarkup(React.createElement(ReceiptDocument,{receipt:{id:'test',reference:'TEST-REFERENCE',purpose:'hotel_booking',amount:180000,currency:'NGN',paid_at:'2026-09-20T03:00:00Z',status:'paid',environment:'test',payer_name:'Test Guest',merchant_name:'Example Hotel',description:'Deluxe',package_name:'Room only',check_in:'2026-09-24',check_out:'2026-09-30',nights:6,guests:2}}));
  for (const text of ['Example Hotel','Test Guest','Deluxe','Room only','TEST-REFERENCE','180,000.00','24 Sept 2026','No real money was charged']) assert.ok(html.includes(text),text);
});
test('Short Let checkout bootstraps the server reference and reuses it for payment-init', async () => {
  const calls=[];
  const {initializeShortStayPayment}=moduleAt('src/lib/supabase/housing-payments.ts',{'./client':{supabase:{rpc:async(name,args)=>{calls.push([name,args]);return {data:{success:true,reference:'WHSTAY-SERVER'},error:null};},functions:{invoke:async(name,args)=>{calls.push([name,args]);return {data:{success:true,authorization_url:'https://checkout.paystack.com/test'},error:null};}}}}});
  const result=await initializeShortStayPayment('reservation-one');
  assert.equal(result.result.success,true);
  assert.equal(calls[0][0],'create_short_stay_payment');
  assert.equal(calls[0][1].p_reservation_id,'reservation-one');
  assert.equal(calls[1][1].body.reference,'WHSTAY-SERVER');
});
function authHarness({getSession, getProfile, initialize=async()=>({error:null})}) {
  const slots=[];let cursor=0;const effects=[];let listener;
  const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(value){const i=cursor++;return slots[i]??={current:value};},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
  };
  const storage={getItem:()=>null,setItem(){},removeItem(){},clear(){},length:0};
  const setting={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})};
  const supabase={auth:{initialize,getSession,onAuthStateChange:fn=>{listener=fn;return{data:{listener,subscription:{unsubscribe(){}}}};}},from:()=>setting};
  const hook=moduleAt('src/hooks/useAuth.ts', {react,'@/lib/supabase':{supabase,getProfileByAuthId:getProfile},'@/lib/googleVerification':{readGoogleVerification:()=>null},'@/lib/withTimeout':moduleAt('src/lib/withTimeout.ts')},{localStorage:storage,sessionStorage:storage,window:{location:{search:'',hash:''},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){},visibilityState:'visible'},navigator:{onLine:true}}).useAuth;
  return {render(){cursor=0;return hook();},effects(){effects.splice(0).forEach(fn=>fn());},event(...args){listener(...args);},close(){for(const slot of slots)slot?.cleanup?.();}};
}
test('A failed SIGNED_IN profile refresh without a snapshot leaves loading and offers sign-in recovery', async () => {
  const user={id:'auth-one',email:'test@example.invalid',email_confirmed_at:'2026-01-01'};
  let resolveSession;
  const h=authHarness({getSession:()=>new Promise(resolve=>{resolveSession=resolve;}),getProfile:async()=>({profile:null,error:{message:'offline'}})});
  h.render();h.effects();h.event('SIGNED_IN',{user});
  await new Promise(resolve=>setTimeout(resolve,5));
  resolveSession({data:{session:{user}},error:null});
  await new Promise(setImmediate);
  const state=h.render();
  assert.equal(state.isLoading,false);assert.equal(state.page,'login');assert.equal(state.profile,null);assert.match(state.error,/could not load/i);
  h.close();
});
test('A stalled request times out and late completion cannot resolve the abandoned request', async () => {
  const {withTimeout}=moduleAt('src/lib/withTimeout.ts');let resolve;
  const late=new Promise(r=>{resolve=r;});
  await assert.rejects(withTimeout(late,5,'Request timed out'),/timed out/);
  resolve('late result');
  assert.equal(await withTimeout(Promise.resolve('fresh result'),50,'timeout'),'fresh result');
});

const inboxCategories = moduleAt('src/lib/inboxCategories.ts');
const workspacePresentation = moduleAt('src/lib/workspacePresentation.ts');
test('Marketplace work, Hotel Team and WeHouse Team stay separate', () => {
  for (const role of ['worker','property_partner']) assert.equal(workspacePresentation.workspaceGroup(role),'Your professional profiles');
  for (const role of ['staff','admin','creator']) assert.equal(workspacePresentation.workspaceGroup(role),'WeHouse Team');
  assert.equal(workspacePresentation.workspaceGroup('hotel'),'Hotel Team');
  assert.equal(workspacePresentation.workspaceGroup('personal'),'Personal');
});
test('People, Bookings and WeHouse filters keep hotel and service chats out of personal conversations', () => {
  for (const kind of ['roommate','worker','hotel','support']) {
    assert.equal(inboxCategories.matchesInboxCategory(kind,'all'),true);
    assert.equal(inboxCategories.matchesInboxCategory(kind,'people'),kind==='roommate');
    assert.equal(inboxCategories.matchesInboxCategory(kind,'bookings'),kind==='hotel'||kind==='worker');
    assert.equal(inboxCategories.matchesInboxCategory(kind,'wehouse'),kind==='support');
  }
});
test('Move-in dates stay in Nigeria time even before midnight UTC', () => {
  const instant = new Date('2026-09-23T23:30:00Z');
  assert.equal(dates.nigeriaDate(instant),'2026-09-24');
  assert.equal(dates.nigeriaDateTimeInput(instant),'2026-09-24T00:30');
  assert.equal(dates.nigeriaInputToISO('2026-09-24T00:30'),instant.toISOString());
});

test('Google callback exchange errors end loading and explain how to restart verification', async () => {
  let sessionReads=0;
  const h=authHarness({initialize:async()=>({error:new Error('PKCE code verifier not found')}),getSession:async()=>{sessionReads++;throw Error('Should not ignore exchange failure');},getProfile:async()=>({profile:null,error:null})});
  h.render();h.effects();await new Promise(setImmediate);
  const state=h.render();
  assert.equal(state.isLoading,false);assert.equal(state.page,'login');
  assert.match(state.error,/Google confirmation expired/);assert.equal(sessionReads,0);h.close();
});
test('Google callback initialization completes before the session is read', async () => {
  let complete; let sessionReads=0;
  const h=authHarness({initialize:()=>new Promise(resolve=>{complete=resolve;}),getSession:async()=>{sessionReads++;return{data:{session:null},error:null};},getProfile:async()=>({profile:null,error:null})});
  h.render();h.effects();await new Promise(setImmediate);
  assert.equal(sessionReads,0);assert.equal(h.render().isLoading,true);
  complete({error:null});await new Promise(setImmediate);
  assert.equal(sessionReads,1);assert.equal(h.render().isLoading,false);h.close();
});
test('Sent updates load without an invented sender foreign-key relationship', async () => {
  const selected=[];const filters=[];
  const query={select(fields){selected.push(fields);return this;},eq(...args){filters.push(args);return this;},async order(){return{data:[{id:1,title:'A published update'}],error:null};}};
  const api=moduleAt('src/lib/supabase/announcements.ts',{'./client':{supabase:{from:()=>query}}});
  assert.equal((await api.getAllAnnouncements()).messages[0].title,'A published update');
  assert.equal((await api.getAnnouncementsSentBy('sender')).messages.length,1);
  assert.deepEqual(filters,[['sender_id','sender']]);
  for(const fields of selected){assert.ok(fields.includes('sender_id'));assert.doesNotMatch(fields,/[():]/);}
});


test('Inbox rows stay message-first instead of showing lifecycle status on every conversation', () => {
  const source=readFileSync(new URL('../src/pages/Chat.tsx', import.meta.url),'utf8');
  assert.doesNotMatch(source,/view\.status/);
  assert.doesNotMatch(source,/function statusLabel\(/);
  assert.match(source,/Search messages/);
});
test('Booking list keeps status in filters and details instead of a loud row label', () => {
  const source=readFileSync(new URL('../src/pages/MyReservations.tsx', import.meta.url),'utf8');
  assert.match(source,/All booking stages/);
  assert.doesNotMatch(source,/status=\{visibleStatus\}/);
  assert.doesNotMatch(source,/status=\{status\?\.label/);
});
test('Creator team uses Worker Operations and counts assigned operations separately from setup gaps', () => {
  const source=readFileSync(new URL('../src/pages/StaffListTab.tsx', import.meta.url),'utf8');
  assert.match(source,/worker_operations:'Worker Operations'/);
  assert.doesNotMatch(source,/Service Provider Operations/);
  assert.match(source,/Metric label="Assigned Staff" value=\{assignedOperations\}/);
  assert.match(source,/Metric label="Needs assignment" value=\{needsSetup\}/);
  assert.match(source,/disabled=\{saving\|\|!draftModule/);
});
test('Worker discovery stays publicly gated while Creator and Admin can verify eligible Workers', () => {
  const source=readFileSync(new URL('../supabase/migrations/20260920203000_repair_team_summary_and_worker_internal_preview.sql', import.meta.url),'utf8');
  assert.match(source,/v_internal_preview/);
  assert.match(source,/current_actor_has_workspace\('creator',null\)/);
  assert.match(source,/current_actor_has_workspace\('admin',null\)/);
  assert.match(source,/if not coalesce\(v_marketplace_enabled,false\)[\s\S]*not coalesce\(v_internal_preview,false\) then/);
  assert.doesNotMatch(source,/worker_marketplace_launch_enabled[^\n]*true/i);
});
