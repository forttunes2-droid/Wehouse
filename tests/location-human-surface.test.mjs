import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function sourceFiles(dir) {
  const result = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) result.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx)$/.test(name)) result.push(path);
  }
  return result;
}

test("human location surfaces never expose pin or accuracy controls", async () => {
  const files = await sourceFiles("src");
  const forbidden = [
    /GPS accuracy/i,
    /Pin adjusted/i,
    /Edit pin/i,
    /Adjust(?: the)?(?: entrance)? on map/i,
    /Tap the real entrance/i,
    /Choose the exact entrance/i,
    /exact pin/i,
    /latitude\s*[:=]\s*["'`]?[{<]/i,
    /longitude\s*[:=]\s*["'`]?[{<]/i,
  ];

  const humanFacingExceptions = new Set([
    "src/components/PropertyPipelineWorkspace.tsx",
  ]);
  const failures = [];
  for (const path of files) {
    const text = await readFile(path, "utf8");
    for (const pattern of forbidden) {
      if (humanFacingExceptions.has(path) && /latitude|longitude/.test(String(pattern))) continue;
      if (pattern.test(text)) failures.push(`${path}: ${pattern}`);
    }
  }
  assert.deepEqual(failures, []);

  const compatibility = await readFile("src/components/LocationMap.tsx", "utf8");
  assert.doesNotMatch(compatibility, /leaflet|circleMarker|tileLayer|onPositionChange\?\./i);
  assert.match(compatibility, /written street address/i);
  assert.match(compatibility, /not rendered/i);
  assert.match(compatibility, /editable here/i);
});

test("Use my location keeps accuracy internal and resolves human-readable address text", async () => {
  const [picker, discovery] = await Promise.all([
    readFile("src/components/PreciseLocationPicker.tsx", "utf8"),
    readFile("src/hooks/useDiscoveryLocation.ts", "utf8"),
  ]);

  assert.match(picker, /enableHighAccuracy:\s*true/);
  assert.match(picker, /position\.coords\.accuracy/);
  assert.match(picker, /"Use my location"/);
  assert.match(picker, /reverse-geocode/);
  assert.match(picker, /address:\s*typedAddress\s*\|\|\s*suggestedAddress/);
  assert.doesNotMatch(picker, /Math\.round\(accuracy\)/);

  assert.match(discovery, /enableHighAccuracy:\s*true/);
  assert.match(discovery, /reverse-geocode/);
  assert.match(discovery, /address:\s*String\(result\.data\.address\)/);
  assert.match(discovery, /get_my_discovery_distances/);
});
