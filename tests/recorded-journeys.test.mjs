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
const regional = moduleAt('src/lib/regional.ts');
const dates = moduleAt('src/lib/displayDate.ts', {'./regional':regional});
const lifecycle = moduleAt('src/lib/propertyBookingLifecycle.ts', {'./displayDate':dates});

test('Finance summary includes recovery actions and never invents zero after a missing response',()=>{
 const {financeQueueSummary}=moduleAt('src/lib/financeQueueSummary.ts');
 const report={actor_role:'staff',payments:[{}],withdrawals:[{}],refunds:[{}],financial_actions:[{},{}],commissions:[],payment_protection:[{}],audit:[{}]};
 assert.deepEqual(JSON.parse(JSON.stringify(financeQueueSummary(report))),{payments:1,payouts:4,ledger:2});
 for(const change of [null,{}, {...report,financial_actions:null},{...report,actor_role:'user'}])assert.throws(()=>financeQueueSummary(change));
});
test('both wallets reject malformed snapshots while retaining genuine signed balances',()=>{
 const {validWalletSnapshot}=moduleAt('src/lib/walletSnapshot.ts');
 const snapshot={id:'wallet',wallet_id:'wallet',is_frozen:false,available_balance:-100.5,pending_balance:0,frozen_balance:2,total_withdrawn:10};
 assert.equal(validWalletSnapshot(snapshot,'id'),true);assert.equal(validWalletSnapshot(snapshot,'wallet_id'),true);
 for(const change of [{available_balance:undefined},{available_balance:'0'},{pending_balance:NaN},{frozen_balance:0.001},{is_frozen:undefined},{total_withdrawn:Infinity}])assert.equal(validWalletSnapshot({...snapshot,...change},'id'),false);
});

test('Sponsored quotes bind the displayed price to one resource and duration',()=>{
  const {sponsoredPriceKobo,matchesSponsoredQuote}=moduleAt('src/lib/sponsoredQuote.ts');
  assert.equal(sponsoredPriceKobo('1250.50'),125050);
  for(const value of [null,'',NaN,Infinity,-1,0,1.005])assert.equal(sponsoredPriceKobo(value),null);
  const quote={resource_type:'property',resource_id:'home-1',duration_days:7,amount_ngn:8753.50};
  assert.equal(matchesSponsoredQuote(quote,'property','home-1',7,875350),true);
  for(const change of [{resource_id:'home-2'},{resource_type:'hotel'},{duration_days:14},{amount_ngn:9000}])
    assert.equal(matchesSponsoredQuote({...quote,...change},'property','home-1',7,875350),false);
});
test('Short Let progress follows the server Reserve date then stay-payment stages', () => {
  const row = { stay_type:'short_let', status:'payment_pending', rent_payment_status:'not_started', security_deposit_snapshot:50000 };
  const journey=lifecycle.getPropertyBookingJourney(row);
  assert.equal(journey.action,'reservation_payment');
  assert.equal(journey.steps[0].label,'Reserve date payment');
  const reserved=lifecycle.getPropertyBookingJourney({...row,status:'reserved',reservation_fee_status:'paid',reservation_fee_paid_at:'2026-10-22T08:00:00Z'});
  assert.equal(reserved.action,'rent_payment');
  assert.equal(reserved.steps[1].label,'Stay payment');
  const long=lifecycle.getPropertyBookingJourney({...row,stay_type:'long_stay'});
  assert.equal(long.action,'reservation_payment');
});

test('paid stays name the actual arrival manager and preserve the saved caution requirement',()=>{
 const base={status:'ready_for_move_in',rent_payment_status:'paid',rent_paid_at:'2026-10-22T08:00:00Z',paid_at:'2026-10-22T08:00:00Z',manual_payment_status:'paid',management_mode_snapshot:'host'};
 const short=lifecycle.getPropertyBookingJourney({...base,stay_type:'short_let',stay_payment_protection_id:'protected-stay',security_deposit_snapshot:50000});
 assert.match(short.detail,/authorised property host/);
 assert.match(short.steps[1].detail,/separately refundable caution/);
 assert.doesNotMatch(JSON.stringify(short),/Property Operations/);
 const long=lifecycle.getPropertyBookingJourney({...base,stay_type:'long_stay',year_one_rent_protection_id:'protected-rent',requested_move_in_at:'2026-10-23T10:00:00Z'});
 assert.match(long.detail,/authorised property host/);
 const managed=lifecycle.getPropertyBookingJourney({...base,stay_type:'short_let',stay_payment_protection_id:'protected-stay',management_mode_snapshot:'wehouse'});
 assert.match(managed.detail,/Property Operations/);
});

test('Short Let discloses both payment stages and the full saved cost before the first payment',()=>{
 const Summary=moduleAt('src/components/ShortLetPaymentSummary.tsx',{'@/lib/regional':regional,'@/lib/propertyBookingLifecycle':lifecycle,'@/lib/shortLetPayment':moduleAt('src/lib/shortLetPayment.ts')}).default;
 const row={stay_type:'short_let',reservation_fee_snapshot:3500};
 const bill={rent:150000,deposit:20000,total:170000};
 const html=renderToStaticMarkup(React.createElement(Summary,{row,bill}));
 for(const text of ['Reserve date fee','Stay charge','Refundable caution','Total booking cost','173,500','170,000','Reserve date payment now'])assert.ok(html.includes(text),text);
 const missing=renderToStaticMarkup(React.createElement(Summary,{row:{stay_type:'short_let'},bill}));
 assert.ok(missing.includes('could not be confirmed'));
 assert.ok(!missing.includes('Reserve date payment now'));
});

test('booking actions suppress double clicks and release controls after failed confirmation',async()=>{
 const {createBookingActionRunner}=moduleAt('src/lib/bookingActionRunner.ts');
 const run=createBookingActionRunner();const busy=[];let release,calls=0,recoveries=0;
 const first=run('booking',()=>new Promise(resolve=>{release=resolve;calls++;}),id=>busy.push(id),async()=>{recoveries++;});
 await run('booking',async()=>{calls++;},id=>busy.push(id),async()=>{});
 assert.equal(calls,1);release();await first;
 await run('booking',async()=>{throw Error('Lost confirmation');},id=>busy.push(id),async()=>{recoveries++;});
 assert.equal(recoveries,1);assert.deepEqual(busy,['booking',null,'booking',null]);
});

test('an unknown Service Worker job state cannot become a new request or a confirmed job',()=>{
 const worker=moduleAt('src/lib/workerBookingContract.ts');
 for(const money of [false,true]){
  const status=worker.normalizeWorkerJobStatus('unexpected_server_state',money);
  assert.equal(status,'unavailable');
  assert.equal(worker.workerNextAction(status,'protected','worker'),null);
 }
 assert.equal(worker.normalizeWorkerJobStatus('payment_protected'),'confirmed');
 assert.ok(!worker.WORKER_JOB_STATUSES.includes('unavailable'));
});

test('booking adapters reject missing cancellation, inspection and move-in receipts',async()=>{
 let data=null;
 const api=moduleAt('src/lib/supabase/reservations.ts',{'./client':{supabase:{rpc:async()=>({data,error:null})}},'@/lib/locationPresentation':{}});
 assert.ok((await api.cancelReservation('booking')).error);
 assert.ok((await api.cancelPaidShortLetStay('booking')).error);
 assert.ok((await api.createInspectionRequest('booking')).error);
 assert.ok((await api.requestApartmentMoveIn('booking','2026-10-23T10:00:00Z')).error);
 data={id:'another',status:'cancelled'};assert.ok((await api.cancelReservation('booking')).error);
 data={id:'booking',status:'cancelled'};assert.equal((await api.cancelReservation('booking')).error,null);
 data={refund_amount:1500};assert.equal((await api.cancelPaidShortLetStay('booking')).refundAmount,1500);
});

test('Short Let cancellation disclosure honours the saved policy version and rejects conflicting deadlines',()=>{
 const {shortLetRefundHours}=moduleAt('src/lib/shortLetCancellationPolicy.ts');
 assert.equal(shortLetRefundHours({}),24);
 assert.equal(shortLetRefundHours({full_refund_hours_before_check_in:48}),48);
 assert.equal(shortLetRefundHours({standard_full_refund_hours_before_check_in:36}),36);
 assert.equal(shortLetRefundHours({standard_full_refund_hours_before_check_in:24,full_refund_hours_before_check_in:48}),null);
 for(const value of [-1,169,2.5,'',true,'bad',Infinity])assert.equal(shortLetRefundHours({full_refund_hours_before_check_in:value}),null);
});

test('service quotes preserve decimals and reject malformed prices instead of changing the amount',()=>{
 const {parseWorkerQuotePrice}=moduleAt('src/lib/workerBookingContract.ts');
 assert.equal(parseWorkerQuotePrice('100.50'),100.5);
 assert.equal(parseWorkerQuotePrice('1,250.25'),1250.25);
 for(const text of ['1,2','100.505','-2','0','1e6','100.50.5',''])assert.equal(parseWorkerQuotePrice(text),null);
});

test('service commands require true receipts and retain server errors',async()=>{
 let data=null,error=null;
 const api=moduleAt('src/lib/supabase/worker-bookings.ts',{'./client':{supabase:{rpc:async()=>({data,error})}},'@/lib/withTimeout':moduleAt('src/lib/withTimeout.ts'),'@/lib/chatMediaPolicy':{},'./utils':{},'@/lib/e2ee':{},'@/lib/workerBookingContract':{}});
 for(const command of ['workerStartJob','workerMarkComplete','customerConfirmCompletion']){
  data={success:true};assert.equal((await api[command]('job')).success,false);
  data=true;assert.equal((await api[command]('job')).success,true);
  error={message:'Session revoked'};assert.equal((await api[command]('job')).error.message,'Session revoked');error=null;
 }
});
test('Booking dates name the month and do not expose invalid dates', () => {
  assert.equal(dates.displayDate('2026-09-24'),'24 Sept 2026');
  assert.equal(dates.displayDate('not-a-date'),'—');
  assert.equal(dates.displayDate(null),'—');
});
test('A hotel receipt renders the verified merchant, stay, amount and reference with a Test label', () => {
  const {ReceiptDocument}=moduleAt('src/components/PaymentReceipt.tsx', {
    '@/lib/paymentReceiptContract':moduleAt('src/lib/paymentReceiptContract.ts'),
    '@/lib/displayDate':dates, '@/lib/regional':regional, '@/lib/supabase/receipts':{}, '@/components/ui/dialog':{}, '@/components/BackButton':moduleAt('src/components/BackButton.tsx'),
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
  const hook=moduleAt('src/hooks/useAuth.ts', {react,'@/lib/accountAuthentication':{getAuthenticationRequirement:async auth_id=>({auth_id,required:false,enrolled:false,stage:'ready'})},'@/lib/supabase':{supabase,getProfileByAuthId:getProfile},'@/lib/googleVerification':{readGoogleVerification:()=>null},'@/lib/pendingDevice':moduleAt('src/lib/pendingDevice.ts',{}, {sessionStorage:storage}),'@/lib/withTimeout':moduleAt('src/lib/withTimeout.ts'),'@/lib/navigationRoute':moduleAt('src/lib/navigationRoute.ts')},{localStorage:storage,sessionStorage:storage,window:{location:{search:'',hash:''},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){},visibilityState:'visible'},navigator:{onLine:true}}).useAuth;
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
test('Move-in dates stay in the property time zone even before midnight UTC', () => {
  const instant = new Date('2026-09-23T23:30:00Z');
  assert.equal(dates.propertyDate(instant),'2026-09-24');
  assert.equal(dates.propertyDateTimeInput(instant),'2026-09-24T00:30');
  assert.equal(dates.propertyInputToISO('2026-09-24T00:30'),instant.toISOString());
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
  const query={select(fields){selected.push(fields);return this;},eq(...args){filters.push(args);return this;},order(){return this;},async range(){return{data:[{id:1,title:'A published update'}],error:null};}};
  const delivered=[{id:8,announcement_id:3,read_status:false,delivered_at:'2026-10-15T09:00:00.000Z',announcement:{id:3,title:'Team update',content:'A scoped update'}}];
  const rpcCalls=[];
  const api=moduleAt('src/lib/supabase/announcements.ts',{'./client':{supabase:{from:()=>query,rpc:async(name,args)=>{rpcCalls.push([name,args]);return{data:name==='creator_count_announcement_recipients'?2:delivered,error:null};}}}});
  assert.equal((await api.getAllAnnouncements()).messages[0].title,'A published update');
  assert.equal((await api.getAnnouncementsSentBy('sender')).messages.length,1);
  const inbox=await api.getAnnouncementsForUser('recipient','worker');
  assert.equal(inbox.messages[0].message.title,'Team update');
  const preview=await api.getFilteredRecipientCount(true,true,false,false,'Lagos','Ikeja','creator');
  assert.equal(preview.count,2);
  assert.deepEqual(rpcCalls.map(([name])=>name),['get_my_announcement_inbox','creator_count_announcement_recipients']);
  assert.equal(rpcCalls[1][1].p_scope_state,'Lagos');
  assert.equal(rpcCalls[1][1].p_scope_lga,'Ikeja');
  assert.equal(rpcCalls[1][1].p_target_roles.join(','),'user,worker');
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
  assert.match(source,/All status/);
  assert.doesNotMatch(source,/status=\{visibleStatus\}/);
  assert.doesNotMatch(source,/status=\{status\?\.label/);
});
test('Creator Team uses canonical Operations, explicit coverage and capacity', () => {
  const source=readFileSync(new URL('../src/pages/StaffListTab.tsx', import.meta.url),'utf8');
  assert.match(source,/id:'worker_operations',label:'Worker Operations'/);
  assert.doesNotMatch(source,/Service Provider Operations/);
  assert.match(source,/Metric label="Operations" value=\{staff\.length\}/);
  assert.match(source,/Metric label="Needs review" value=\{needsSetup\}/);
  assert.match(source,/Whole State/);
  assert.match(source,/One LGA/);
  assert.match(source,/Operation limits/);
  assert.match(source,/creator_set_admin_authority/);
});
test('Worker discovery stays publicly gated while Creator and Admin can verify eligible Workers', () => {
  const source=readFileSync(new URL('../supabase/migrations/20260920203000_repair_team_summary_and_worker_internal_preview.sql', import.meta.url),'utf8');
  assert.match(source,/v_internal_preview/);
  assert.match(source,/current_actor_has_workspace\('creator',null\)/);
  assert.match(source,/current_actor_has_workspace\('admin',null\)/);
  assert.match(source,/if not coalesce\(v_marketplace_enabled,false\)[\s\S]*not coalesce\(v_internal_preview,false\) then/);
  assert.doesNotMatch(source,/worker_marketplace_launch_enabled[^\n]*true/i);
});

test('Roommate workspace does not render booking/shared-payment cards', () => {
  const source = readFileSync(new URL('../src/pages/Roommate.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /SharedHomeLifecyclePanel/);
  assert.doesNotMatch(source, /onOpenListing/);
});

test('Legacy roommate preferences do not surface stale discovery results before practical preferences are confirmed', () => {
  const source = readFileSync(new URL('../src/pages/Roommate.tsx', import.meta.url), 'utf8');
  assert.match(source, /practical_preferences_version === 2/);
  assert.match(source, /nextForm\.preferred_state \|\|= profile\.state/);
  assert.match(source, /nextForm\.preferred_lga \|\|= profile\.local_government/);
});


test('Long Let viewing is optional before rent and completed visits advance to rent',()=>{
 const row={id:'booking',status:'reserved',stay_type:'long_stay',reservation_fee_status:'paid',reservation_fee_paid_at:'2026-10-23T10:00:00Z',rent_payment_status:'not_started'};
 assert.equal(lifecycle.getPropertyBookingJourney(row).action,'choose_inspection_or_rent');
 assert.equal(lifecycle.getPropertyBookingJourney(row,{status:'pending'}).action,'inspection');
 assert.equal(lifecycle.getPropertyBookingJourney(row,{status:'completed'}).action,'rent_payment');
 assert.equal(lifecycle.getPropertyBookingJourney({...row,status:'cancelled'}).action,'stopped');
 const source=readFileSync(new URL('../src/pages/ListingDetailCore.tsx',import.meta.url),'utf8');
 const panel=source.slice(source.indexOf('function ReservationPanel('),source.indexOf('function ShortStayReservationPanel('));
 assert.match(panel,/getPropertyBookingJourney\(reservation, inspection\)/);
 assert.match(panel,/Request a viewing/);
 assert.doesNotMatch(panel,/Inspection passed|Request property inspection/);
});


test('paid status without either receipt timestamp or protection cannot invite another rent payment',()=>{
 for(const extra of [{},{rent_paid_at:'2026-10-23T10:00:00Z'},{year_one_rent_protection_id:'protection'}]){
 const row={status:'reserved',stay_type:'long_stay',reservation_fee_status:'paid',reservation_fee_paid_at:'2026-10-23T09:00:00Z',rent_payment_status:'paid',...extra};
 assert.equal(lifecycle.getPropertyBookingJourney(row).action,'stopped');
 assert.equal(lifecycle.propertyBookingStatusLabel(row),'Payment needs review');
 }
});
