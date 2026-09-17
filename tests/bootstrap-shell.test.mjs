import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("WeHouse renders a branded shell before React mounts", async () => {
  const html = await readFile("index.html", "utf8");
  assert.match(html, /id="root"[\s\S]*id="wh-bootstrap"/);
  assert.match(html, /aria-label="Opening WeHouse"/);
  assert.match(html, /app-icon\.svg/);
  assert.match(html, /find · connect · live better/);
  assert.match(html, /wh-bootstrap-loader/);
});

test("startup failures replace the splash instead of hanging forever", async () => {
  const [preflight, main] = await Promise.all([
    readFile("src/preflight.ts", "utf8"),
    readFile("src/main.tsx", "utf8"),
  ]);

  assert.match(preflight, /renderStartupFailure/);
  assert.match(preflight, /Preview backend is not connected/);
  assert.match(preflight, /non-production WeHouse host cannot connect to the production Supabase project/);
  assert.match(preflight, /setTimeout\([\s\S]*8000/);
  assert.match(main, /dataset\.whReactMounted\s*=\s*['"]true['"]/);
});

test("startup HTML does not preload retired map UI dependencies", async () => {
  const html = await readFile("index.html", "utf8");
  assert.doesNotMatch(html, /tile\.openstreetmap\.org/i);
  assert.doesNotMatch(html, /leaflet-container|wehouse-map-pin/i);
});
