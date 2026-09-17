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

test("startup HTML does not preload retired map UI dependencies", async () => {
  const html = await readFile("index.html", "utf8");
  assert.doesNotMatch(html, /tile\.openstreetmap\.org/i);
  assert.doesNotMatch(html, /leaflet-container|wehouse-map-pin/i);
});
