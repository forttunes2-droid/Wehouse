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
function authHarness({getSession, getProfile}) {
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
  const supabase={auth:{getSession,onAuthStateChange:fn=>{listener=fn;return{data:{listener,subscription:{unsubscribe(){}}}};}},from:()=>setting};
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
