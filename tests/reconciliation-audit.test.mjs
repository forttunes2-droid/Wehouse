import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function load(path, context = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, ...context },
  );
  return exports;
}

test("offline page works under the production CSP and follows the saved theme", () => {
  const html = readFileSync("public/offline.html", "utf8");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const csp = JSON.stringify(vercel);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "inline handlers are blocked by the CSP");
  assert.match(html, /src="\/offline\.js"/);
  assert.match(html, /\[data-wh-theme=light\]/);
  const script = readFileSync("public/offline.js", "utf8");
  assert.match(script, /wehouse:appearance/);
  assert.match(script, /addEventListener\('online'/);
});

test("service worker caches everything the offline page needs", () => {
  const config = readFileSync("vite.config.ts", "utf8");
  assert.match(config, /OFFLINE_ASSETS = \[OFFLINE_URL, '\/offline\.js', '\/app-icon\.svg'\]/);
  assert.match(config, /cache\.addAll\(OFFLINE_ASSETS\)/);
  for (const asset of ["public/offline.html", "public/offline.js", "public/app-icon.svg"]) {
    assert.ok(readFileSync(asset, "utf8").length > 0, asset);
  }
});

test("sign-out wipes property draft media stored in IndexedDB", () => {
  const source = readFileSync("src/hooks/useAuth.ts", "utf8");
  assert.match(source, /indexedDB\.deleteDatabase\("wehouse-property-drafts"\)/);
  assert.match(readFileSync("src/lib/propertyDraftFiles.ts", "utf8"), /const DATABASE = 'wehouse-property-drafts'/);
});

test("followed search intent is consumed once and only by the matching search kind", () => {
  const store = new Map();
  const sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => store.delete(key),
  };
  const { takeFollowedSearchIntent } = load("src/lib/followedSearchIntent.ts", { sessionStorage });
  const key = "wehouse:open-followed-search";
  store.set(key, JSON.stringify({ kind: "hotels", criteria: { city: "Lagos" } }));
  assert.equal(takeFollowedSearchIntent("homes"), null);
  assert.ok(store.has(key), "a hotel intent must survive a homes lookup");
  assert.deepEqual(JSON.parse(JSON.stringify(takeFollowedSearchIntent("hotels"))), { city: "Lagos" });
  assert.equal(takeFollowedSearchIntent("hotels"), null);
  store.set(key, "{not json");
  assert.equal(takeFollowedSearchIntent("homes"), null);
  store.set(key, JSON.stringify({ kind: "homes", criteria: ["x"] }));
  assert.equal(takeFollowedSearchIntent("homes"), null);
});

test("worker occupation fallback does not misclassify technology work as handyman work", () => {
  const { occupationForService } = load("src/lib/workerTaxonomy.ts", {
    require: () => ({ WORKER_OCCUPATION_LABELS: { electrician: "Electrician" } }),
  });
  assert.equal(occupationForService("Technology", "Phone repair"), "IT Technician");
  assert.equal(occupationForService("Technology", "CCTV installation"), "IT Technician");
  assert.equal(occupationForService("Home services", "Appliance repair"), "Handyperson");
  assert.equal(occupationForService("Home services", "Solar technician"), "Solar technician");
  assert.equal(occupationForService("electrician", ""), "Electrician");
});

test("workers can hold several services, enforced by the client and the database", () => {
  const setup = readFileSync("src/pages/WorkerSetupProfessional.tsx", "utf8");
  const rpc = readFileSync("supabase/migrations/20260921093518_validate_worker_services_against_catalog.sql", "utf8");
  assert.match(setup, /services\.length >= 10/);
  assert.match(rpc, /A Worker can list up to 10 services/);
  assert.match(rpc, /Each service can only be added once/);
  assert.match(rpc, /approved catalog/);
});
