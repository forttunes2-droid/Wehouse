import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
vm.runInNewContext(compile(await read("supabase/functions/_shared/payment-return.ts")), { exports, URL });
const resolveReturn = exports.resolvePaymentReturnUrl;
const sessionExports = {};
const marketExports = {};
const quoteExports = {};
const checkoutExports = {};
vm.runInNewContext(compile(await read('supabase/functions/_shared/payment-checkout.ts')), {exports:checkoutExports,URL});
vm.runInNewContext(compile(await read('supabase/functions/_shared/service-quote.ts')), {exports:quoteExports,Intl,Date});
vm.runInNewContext(compile(await read('supabase/functions/_shared/payment-market.ts')), { exports: marketExports });
vm.runInNewContext(compile(await read("supabase/functions/_shared/liveSession.ts")), { exports: sessionExports, atob });
const authId = "90000000-0000-4000-8000-000000000001";
const sessionId = "90000000-0000-4000-8000-000000000002";
const verifiedToken = `header.${Buffer.from(JSON.stringify({sub:authId,session_id:sessionId})).toString('base64url')}.verified-signature`;

const testBackend = "https://qoobnkedfyosnizrlttt.supabase.co";
const liveBackend = "https://rkrhnkhppeihvmuwvsvn.supabase.co";
const testApp = "https://preview.example.invalid";

test("checkout requires an explicit HTTPS origin and rejects embedded redirects or credentials", () => {
  for (const app of [undefined, "", "not a URL", "http://preview.example.invalid", `${testApp}/other`, `${testApp}/?next=evil`, `${testApp}/#evil`, "https://user:password@preview.example.invalid", "https://preview.example.invalid:8443"]) {
    assert.equal(resolveReturn(testBackend, app, "sk_test_fixture", "payment-return"), null);
  }
  assert.equal(resolveReturn(testBackend, `${testApp}/`, "sk_test_fixture", "payment-return"), `${testApp}/#payment-return`);
});

test("test projects cannot initiate live checkout or return users to the production app", () => {
  assert.equal(resolveReturn(testBackend, testApp, "sk_live_fixture", "payment-return"), null);
  for (const app of ["https://wehouse.com.ng", "https://www.wehouse.com.ng"]) {
    assert.equal(resolveReturn(testBackend, app, "sk_test_fixture", "payment-return"), null);
  }
  assert.equal(resolveReturn(testBackend, testApp, "not-a-payment-key", "payment-return"), null);
});

test("production checkout requires the production backend and an official app origin", () => {
  assert.equal(resolveReturn(liveBackend, testApp, "sk_live_fixture", "payment-return"), null);
  assert.equal(resolveReturn(liveBackend, undefined, "sk_live_fixture", "payment-return"), null);
  assert.equal(resolveReturn(liveBackend, "https://www.wehouse.com.ng", "sk_live_fixture", "payment-return"), "https://www.wehouse.com.ng/#payment-return");
});

async function checkoutHarness(name, overrides = {}, sessionExists = true, extraRows = {}, workspaceActive = true) {
  const env = {
    SUPABASE_URL: testBackend,
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    SUPABASE_ANON_KEY:'fixture-anon-key',
    PAYSTACK_SECRET_KEY: "sk_test_fixture",
    APP_URL: testApp,
    ...overrides,
  };
  let handler;
  let clients = 0;
  const initialized = [];
  const planWrites=[];
  const reference = `${name==='partner-pro-payment-init'?'WHPP':'WHP'}-00000000-0000-0000-0000-000000000001`;
  const rows = {
    profiles: { user_id: "fixture-worker", role: "worker", worker_status: "verified", worker_verified: true },
    booking_payments: { id: "fixture-payment", user_id: "fixture-worker", payer_user_id:'fixture-worker',status: "pending", amount_total: 42, currency: "NGN", purpose: name==='sponsored-payment-init'?'sponsored_campaign':'worker_booking', worker_booking_id: "fixture-job", metadata: { plan_code: "PLN_fixture", billing_period: "monthly" } },
    worker_bookings: { id: "fixture-job", user_id: "fixture-worker", status: "waiting_payment", agreed_amount: 42 },
  };
  Object.assign(rows, extraRows);
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: authId, email: "fixture@example.invalid" } }, error: null }) },
    rpc: async (name, params) => {
      if(name==='creator_set_worker_pro_setting')return{data:extraRows.savedPlanReceipt??true,error:null};
      if(name==='begin_my_sponsored_checkout')return {data:{reference},error:null};
      if (name === 'user_has_active_workspace') {
        assert.equal(params.p_user_id, 'fixture-worker');
        assert.ok(['worker','property_partner','creator'].includes(params.p_workspace_role));
        return { data: workspaceActive, error: null };
      }
      assert.equal(name, 'auth_session_security_satisfied');
      assert.equal(params.p_aal, 'aal1');
      assert.equal(params.p_auth_id, authId);
      assert.equal(params.p_session_id, sessionId);
      return { data: sessionExists, error: null };
    },
    from(table) {
      let updating=false;
      const query = {
        select: () => query, eq: () => query, update: () => {updating=true;return query;},in:()=>query,
        maybeSingle: async () => ({ data: updating&&extraRows.noPersistenceReceipt?null:rows[table], error: null }),
        single: async () => ({ data: rows[table], error: null }),
        then: (done) => Promise.resolve({data:rows[table], error: null }).then(done),
      };
      return query;
    },
  };
  // Run the actual handlers; replace only external database/provider I/O.
  const source = (await read(`supabase/functions/${name}/index.ts`)).replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(compile(source), {
    exports: {}, URL, Response, console,AbortSignal,
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    serve: (fn) => { handler = fn; },
    resolvePaymentReturnUrl: resolveReturn,
    paymentMinorUnits: marketExports.paymentMinorUnits,
    resolvePaymentMarket: marketExports.resolvePaymentMarket,
    serviceCheckoutContractMatches:quoteExports.serviceCheckoutContractMatches,
    paystackCheckoutDestination:checkoutExports.paystackCheckoutDestination,
    hasLiveSession: sessionExports.hasLiveSession,
    consumeUserAction: async (...args) => {if(name==='payment-init')assert.equal(args[5],true);return { allowed: !extraRows.rateDenied, retryAfterSeconds: 30 };},
    hasActiveWorkspace: sessionExports.hasActiveWorkspace,
    createClient: () => { clients++; return admin; },
    fetch: async (url, options) => {
      if(url==='https://api.paystack.co/plan'){planWrites.push(JSON.parse(options.body));return Response.json({status:true,data:{plan_code:'PLN_fixture'}});}
      if (url.startsWith("https://api.paystack.co/plan/")) return Response.json({ status: true, data: { interval: "monthly", amount: 4200, currency: "NGN",...extraRows.providerPlan } });
      assert.equal(url, "https://api.paystack.co/transaction/initialize");
      initialized.push(JSON.parse(options.body));
      return Response.json({ status: true, data: { reference, authorization_url: "https://checkout.paystack.com/fixture", access_code: "fixture-code",...extraRows.providerInitialization } });
    },
  });
  return {
    initialized,
    planWrites,
    clients: () => clients,
    request: () => handler(new Request("https://test.invalid/checkout", {
      method: "POST",
      headers: { authorization: `Bearer ${verifiedToken}`, "content-type": "application/json", origin: "https://untrusted.example.invalid" },
      body: JSON.stringify({ reference,campaign_id:'00000000-0000-4000-8000-000000000001',expected_amount_ngn:42,callback_url: "https://untrusted.example.invalid", amount: 1 }),
    })),
  };
}

test('checkout rejects missing or unsupported currency and sub-minor-unit prices before provider access',async()=>{
  for(const change of [{currency:null},{currency:'USD'},{amount_total:'42.001'},{amount_total:'9007199254740992'}]){
    const checkout=await checkoutHarness('payment-init',{},true,{booking_payments:{id:'fixture-payment',user_id:'fixture-worker',status:'pending',amount_total:42,currency:'NGN',purpose:'worker_booking',worker_booking_id:'fixture-job',...change}});
    assert.equal((await checkout.request()).status,409);
    assert.equal(checkout.initialized.length,0);
  }
});

for (const name of ["payment-init", "worker-pro-payment-init"]) {
  test(`${name}: invalid environment is rejected before privileged database or provider access`, async () => {
    for (const settings of [{ APP_URL: undefined }, { PAYSTACK_SECRET_KEY: "sk_live_fixture" }, { APP_URL: "https://www.wehouse.com.ng" }]) {
      const checkout = await checkoutHarness(name, settings);
      assert.equal((await checkout.request()).status, 503);
      assert.equal(checkout.clients(), 0);
      assert.equal(checkout.initialized.length, 0);
    }
  });

  test(`${name}: a revoked verified bearer cannot initialize a payment`, async () => {
    const checkout = await checkoutHarness(name, {}, false);
    assert.equal((await checkout.request()).status, 401);
    assert.equal(checkout.initialized.length, 0);
  });

  test(`${name}: checkout uses server-owned amount and test return URL despite caller overrides`, async () => {
    const checkout = await checkoutHarness(name,{},true,name==='payment-init'?hotelRows():{});
    assert.equal((await checkout.request()).status, 200);
    assert.equal(checkout.initialized.length, 1);
    assert.equal(checkout.initialized[0].amount, "4200");
    assert.equal(checkout.initialized[0].callback_url, `${testApp}/#${name === "payment-init" ? "payment-return" : "worker_dashboard"}`);
  });
}

function hotelRows(overrides = {}) {
  const reference='WHP-00000000-0000-0000-0000-000000000001';
  return {
    booking_payments:{id:'hotel-payment',user_id:'fixture-worker',status:'pending',amount_total:42,currency:'NGN',purpose:'hotel_booking',hotel_booking_id:1,metadata:{}},
    hotel_bookings:{booking_id:1,user_id:'fixture-worker',status:'pending',payment_status:'payment_pending',payment_reference:reference,total_price:42,payment_expires_at:new Date(Date.now()+3600000).toISOString(),...overrides},
  };
}
test('paused Service checkout cannot bypass the app through a direct API request or cached provider URL',async()=>{
 for(const metadata of [{},{paystack_authorization_url:'https://checkout.paystack.com/old',paystack_access_code:'old'}]){
  const checkout=await checkoutHarness('payment-init',{},true,{booking_payments:{id:'service-payment',user_id:'fixture-worker',status:'pending',amount_total:42,currency:'NGN',purpose:'worker_booking',worker_booking_id:'fixture-job',metadata}});
  const response=await checkout.request();assert.equal(response.status,409);
  assert.equal((await response.json()).code,'SERVICE_CHECKOUT_CONTRACT_REQUIRED');assert.equal(checkout.initialized.length,0);
 }
});
test('paid Service receipts remain readable while new Service checkout is paused',async()=>{
 const checkout=await checkoutHarness('payment-init',{},true,{booking_payments:{id:'service-payment',user_id:'fixture-worker',status:'paid',amount_total:42,currency:'NGN',purpose:'worker_booking',worker_booking_id:'fixture-job'}});
 const response=await checkout.request();assert.equal(response.status,200);assert.equal((await response.json()).already_paid,true);assert.equal(checkout.initialized.length,0);
});
function acceptedServiceRows(){
 const quote={revision:1,booking_id:'fixture-job',customer_id:'fixture-worker',provider_id:'fixture-provider',amount:42,currency:'NGN',customer_service_charge:0,scope:'Clean the agreed rooms',address:'Agreed service location',starts_at:'2027-06-02T09:00:00Z',timezone:'Africa/Lagos',cancellation:{version:'service-standard-24h-v1',full_refund_until:'2027-06-01T09:00:00Z',late_cancellation:'wehouse_review',provider_cancellation:'full_refund'}};
 const accepted='2026-10-26T12:00:00Z';
 return {booking_payments:{id:'service-payment',user_id:'fixture-worker',status:'pending',amount_total:42,currency:'NGN',purpose:'worker_booking',worker_booking_id:'fixture-job',metadata:{service_quote:quote,service_quote_accepted_at:accepted}},worker_bookings:{id:'fixture-job',user_id:'fixture-worker',worker_id:'fixture-provider',status:'waiting_payment',agreed_amount:42,service_quote:quote,service_quote_revision:1,service_quote_accepted_revision:1,service_quote_accepted_at:accepted}};
}
test('accepted exact Service contract initializes the recorded total; stale or replaced acceptance cannot',async()=>{
 const rows=acceptedServiceRows(),valid=await checkoutHarness('payment-init',{},true,rows);
 assert.equal((await valid.request()).status,200);assert.equal(valid.initialized[0].amount,'4200');
 for(const change of [{service_quote_accepted_revision:null},{service_quote_revision:2},{service_quote_accepted_at:null},{worker_id:'different-provider'}]){
  const checkout=await checkoutHarness('payment-init',{},true,{...rows,worker_bookings:{...rows.worker_bookings,...change}});
  assert.equal((await checkout.request()).status,409);assert.equal(checkout.initialized.length,0);
 }
});
function stayRows(overrides = {}) {
  const reference = "WHP-00000000-0000-0000-0000-000000000001";
  return {
    booking_payments: {id:'stay-payment',user_id:'fixture-worker',status:'pending',amount_total:170000,currency:'NGN',purpose:'apartment_rent',metadata:{reservation_id:'stay-a',payment_component:'short_stay_balance'}},
    reservations: {id:'stay-a',user_id:'fixture-worker',listing_id:'listing-a',status:'reserved',stay_type:'short_let',stay_check_in:'2027-01-01',stay_check_out:'2027-01-02',stay_rent_total:120000,security_deposit_snapshot:50000,rent_payment_status:'payment_pending',rent_payment_reference:reference,reservation_fee_status:'paid',manual_payment_status:'paid',reservation_fee_paid_at:new Date().toISOString(),short_stay_balance_due_at:new Date(Date.now()+3600000).toISOString(),...overrides},
    listings: {id:'listing-a',status:'available',sub_type:'short_let'},
  };
}
test('Short Let stay balance opens only after Reserve date fee is confirmed', async () => {
  const checkout=await checkoutHarness('payment-init',{},true,stayRows());
  assert.equal((await checkout.request()).status,200);
  assert.equal(checkout.initialized[0].amount,'17000000');
});
for (const [name,changes] of Object.entries({expired:{short_stay_balance_due_at:new Date(Date.now()-60000).toISOString()},shared:{shared_payment_group_id:'shared-a'},snapshot:{stay_rent_total:120001},reference:{rent_payment_reference:'different'}})) {
  test(`Short Let rejects ${name} checkout without starting provider payment`,async()=>{
    const checkout=await checkoutHarness('payment-init',{},true,stayRows(changes));
    assert.equal((await checkout.request()).status,409);assert.equal(checkout.initialized.length,0);
  });
}

test('paid worker plan respects current workspace access even when personal is the legacy role', async () => {
  const checkout = await checkoutHarness('worker-pro-payment-init', {}, true, { profiles: {user_id:'fixture-worker',role:'user',worker_status:'verified',worker_verified:true} });
  assert.equal((await checkout.request()).status, 200);
  assert.equal(checkout.initialized.length, 1);
});
test('removed worker workspace denies paid plan checkout despite an old worker role', async () => {
  const checkout = await checkoutHarness('worker-pro-payment-init', {}, true, {}, false);
  assert.equal((await checkout.request()).status, 403);
  assert.equal(checkout.initialized.length, 0);
});

for(const name of ['worker-pro-payment-init','partner-pro-payment-init','sponsored-payment-init']){
 test(`${name}: exact supported amount contract rejects unsafe or missing payment values`,async()=>{
  for(const change of [{currency:null},{currency:'USD'},{amount_total:'42.001'},{amount_total:'9007199254740992'}, {amount_total:null}]){
   const payment={id:'payment',user_id:'fixture-worker',payer_user_id:'fixture-worker',status:'pending',amount_total:42,currency:'NGN',purpose:name==='sponsored-payment-init'?'sponsored_campaign':'worker_pro_subscription',metadata:{plan_code:'PLN_fixture',billing_period:'monthly'},...change};
   const checkout=await checkoutHarness(name,{},true,{booking_payments:payment});
   assert.equal((await checkout.request()).status,409);
   assert.equal(checkout.initialized.length,0);
  }
 });
}
test('paid Service plan cannot infer a missing provider currency or round its minor amount',async()=>{
 for(const providerPlan of [{currency:null},{currency:undefined},{amount:4200.1},{amount:'4200'}]){
  const checkout=await checkoutHarness('worker-pro-payment-init',{},true,{providerPlan});
  assert.equal((await checkout.request()).status,409);assert.equal(checkout.initialized.length,0);
 }
});
test('plan synchronization validates exact prices, environment and its saved receipt',async()=>{
 const platform_settings=[{key:'worker_pro_monthly_price_ngn',value:'42'},{key:'worker_pro_product_name',value:'WeHouse Pro'}];
 const valid=await checkoutHarness('worker-pro-plan-sync',{},true,{platform_settings});
 assert.equal((await valid.request()).status,200);assert.equal(valid.planWrites[0].amount,4200);
 for(const value of ['42.001','9007199254740992','',null]){
  const bad=await checkoutHarness('worker-pro-plan-sync',{},true,{platform_settings:[{key:'worker_pro_monthly_price_ngn',value}]});
  assert.equal((await bad.request()).status,409);assert.equal(bad.planWrites.length,0);
 }
 const noReceipt=await checkoutHarness('worker-pro-plan-sync',{},true,{platform_settings,savedPlanReceipt:false});
 assert.equal((await noReceipt.request()).status,500);
 const wrongEnvironment=await checkoutHarness('worker-pro-plan-sync',{PAYSTACK_SECRET_KEY:'sk_live_fixture'},true,{platform_settings});
 assert.equal((await wrongEnvironment.request()).status,503);assert.equal(wrongEnvironment.planWrites.length,0);
});


test('checkout requires throttling and a persisted pending session before success',async()=>{
 const limited=await checkoutHarness('payment-init',{},true,{rateDenied:true});assert.equal((await limited.request()).status,429);assert.equal(limited.initialized.length,0);
 const lost=await checkoutHarness('payment-init',{},true,{...hotelRows(),noPersistenceReceipt:true});const response=await lost.request();assert.equal(response.status,409);assert.equal((await response.json()).success,false);assert.equal(lost.initialized.length,1);
});
test('checkout rejects provider initialization belonging to another reference',async()=>{
 const checkout=await checkoutHarness('payment-init',{},true,{...hotelRows(),providerInitialization:{reference:'another-payment'}});assert.equal((await checkout.request()).status,400);assert.equal(checkout.initialized.length,1);
});
test('checkout refuses an invalid saved destination without creating another provider session',async()=>{
 const fixture=hotelRows();
 fixture.booking_payments.metadata={...fixture.booking_payments.metadata,paystack_authorization_url:'https://untrusted.invalid/pay',paystack_access_code:'fixture-code'};
 const checkout=await checkoutHarness('payment-init',{},true,fixture);assert.equal((await checkout.request()).status,409);assert.equal(checkout.initialized.length,0);
});
test('checkout does not publish a provider response with a credentialed or alternate-origin destination',async()=>{
 for(const authorization_url of ['https://untrusted.invalid/pay','https://user:secret@checkout.paystack.com/pay','https://checkout.paystack.com:444/pay']){
  const checkout=await checkoutHarness('payment-init',{},true,{...hotelRows(),providerInitialization:{authorization_url}});const response=await checkout.request();assert.equal(response.status,502);assert.equal((await response.json()).success,false);assert.equal(checkout.initialized.length,1);
 }
});
