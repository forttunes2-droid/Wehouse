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
    PAYSTACK_SECRET_KEY: "sk_test_fixture",
    APP_URL: testApp,
    ...overrides,
  };
  let handler;
  let clients = 0;
  const initialized = [];
  const reference = "WHP-00000000-0000-0000-0000-000000000001";
  const rows = {
    profiles: { user_id: "fixture-worker", role: "worker", worker_status: "verified", worker_verified: true },
    booking_payments: { id: "fixture-payment", user_id: "fixture-worker", status: "pending", amount_total: 42, currency: "NGN", purpose: "worker_booking", worker_booking_id: "fixture-job", metadata: { plan_code: "PLN_fixture", billing_period: "monthly" } },
    worker_bookings: { id: "fixture-job", user_id: "fixture-worker", status: "waiting_payment", agreed_amount: 42 },
  };
  Object.assign(rows, extraRows);
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: authId, email: "fixture@example.invalid" } }, error: null }) },
    rpc: async (name, params) => {
      if (name === 'user_has_active_workspace') {
        assert.equal(params.p_user_id, 'fixture-worker');
        assert.equal(params.p_workspace_role, 'worker');
        return { data: workspaceActive, error: null };
      }
      assert.equal(name, 'auth_session_is_active');
      assert.equal(params.p_auth_id, authId);
      assert.equal(params.p_session_id, sessionId);
      return { data: sessionExists, error: null };
    },
    from(table) {
      const query = {
        select: () => query, eq: () => query, update: () => query,
        maybeSingle: async () => ({ data: rows[table], error: null }),
        then: (done) => Promise.resolve({ error: null }).then(done),
      };
      return query;
    },
  };
  // Run the actual handlers; replace only external database/provider I/O.
  const source = (await read(`supabase/functions/${name}/index.ts`)).replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(compile(source), {
    exports: {}, URL, Response, console,
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    serve: (fn) => { handler = fn; },
    resolvePaymentReturnUrl: resolveReturn,
    hasLiveSession: sessionExports.hasLiveSession,
    hasActiveWorkspace: sessionExports.hasActiveWorkspace,
    createClient: () => { clients++; return admin; },
    fetch: async (url, options) => {
      if (url.startsWith("https://api.paystack.co/plan/")) return Response.json({ status: true, data: { interval: "monthly", amount: 4200, currency: "NGN" } });
      assert.equal(url, "https://api.paystack.co/transaction/initialize");
      initialized.push(JSON.parse(options.body));
      return Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/fixture", access_code: "fixture-code" } });
    },
  });
  return {
    initialized,
    clients: () => clients,
    request: () => handler(new Request("https://test.invalid/checkout", {
      method: "POST",
      headers: { authorization: `Bearer ${verifiedToken}`, "content-type": "application/json", origin: "https://untrusted.example.invalid" },
      body: JSON.stringify({ reference, callback_url: "https://untrusted.example.invalid", amount: 1 }),
    })),
  };
}

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
    const checkout = await checkoutHarness(name);
    assert.equal((await checkout.request()).status, 200);
    assert.equal(checkout.initialized.length, 1);
    assert.equal(checkout.initialized[0].amount, "4200");
    assert.equal(checkout.initialized[0].callback_url, `${testApp}/#${name === "payment-init" ? "payment-return" : "worker_dashboard"}`);
  });
}

function stayRows(overrides = {}) {
  const reference = "WHP-00000000-0000-0000-0000-000000000001";
  return {
    booking_payments: {id:'stay-payment',user_id:'fixture-worker',status:'pending',amount_total:170000,currency:'NGN',purpose:'apartment_rent',metadata:{reservation_id:'stay-a',payment_component:'short_stay_rent'}},
    reservations: {id:'stay-a',user_id:'fixture-worker',listing_id:'listing-a',status:'payment_pending',stay_type:'short_let',stay_check_in:'2027-01-01',stay_check_out:'2027-01-02',stay_rent_total:120000,security_deposit_snapshot:50000,rent_payment_status:'payment_pending',rent_payment_reference:reference,payment_expires_at:new Date(Date.now()+60000).toISOString(),...overrides},
    listings: {id:'listing-a',status:'available',sub_type:'short_let'},
  };
}
test('date-first Short Let can pay its stored bill before it is incorrectly marked reserved', async () => {
  const checkout=await checkoutHarness('payment-init',{},true,stayRows());
  assert.equal((await checkout.request()).status,200);
  assert.equal(checkout.initialized[0].amount,'17000000');
});
for (const [name,changes] of Object.entries({expired:{payment_expires_at:new Date(Date.now()-60000).toISOString()},shared:{shared_payment_group_id:'shared-a'},snapshot:{stay_rent_total:120001},reference:{rent_payment_reference:'different'}})) {
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
