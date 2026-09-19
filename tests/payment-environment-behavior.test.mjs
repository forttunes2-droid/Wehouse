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

async function checkoutHarness(name, overrides = {}) {
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
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: "fixture-auth", email: "fixture@example.invalid" } }, error: null }) },
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
      headers: { authorization: "Bearer fixture", "content-type": "application/json", origin: "https://untrusted.example.invalid" },
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

  test(`${name}: checkout uses server-owned amount and test return URL despite caller overrides`, async () => {
    const checkout = await checkoutHarness(name);
    assert.equal((await checkout.request()).status, 200);
    assert.equal(checkout.initialized.length, 1);
    assert.equal(checkout.initialized[0].amount, "4200");
    assert.equal(checkout.initialized[0].callback_url, `${testApp}/#${name === "payment-init" ? "payment-return" : "worker_dashboard"}`);
  });
}
