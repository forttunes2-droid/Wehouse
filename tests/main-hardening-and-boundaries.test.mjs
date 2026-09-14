import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub exposes stable required check names and a dependent consolidation gate", async () => {
  const [build, consolidation] = await Promise.all([
    read(".github/workflows/profile-phase-check.yml"),
    read(".github/workflows/consolidation-validation.yml"),
  ]);
  assert.match(build, /name: WeHouse Build Check[\s\S]*jobs:[\s\S]*name: WeHouse Build Check/);
  assert.match(build, /pull_request:[\s\S]*merge_group:/);
  assert.match(consolidation, /name: Consolidation Validation[\s\S]*needs: \[tests-and-build, migration-replay\]/);
  assert.match(consolidation, /BUILD_RESULT[\s\S]*MIGRATION_RESULT/);
});

test("Activity owns one deterministic mobile back treatment", async () => {
  const layout = await read("src/components/DesktopLayout.tsx");
  assert.match(layout, /OWN_MOBILE_BACK[\s\S]*'activity'/);
  assert.match(layout, /activePage !== 'activity'/);
});

test("accommodation UI and database fail closed without Payment Protection", async () => {
  const [lifecycle, migration] = await Promise.all([
    read("src/lib/propertyBookingLifecycle.ts"),
    read("supabase/migrations/20260914070812_enforce_protected_accommodation_handover.sql"),
  ]);
  assert.match(lifecycle, /year_one_rent_protection_id/);
  assert.match(lifecycle, /stay_payment_protection_id/);
  assert.match(lifecycle, /Payment needs WeHouse review/);
  assert.match(migration, /Current Payment Protection is required before accommodation arrival or handover/);
  assert.match(migration, /create or replace function public\.get_public_hotel_detail/);
  assert.match(migration, /Internal WeHouse accounts cannot activate marketplace workspaces/);
  assert.match(migration, /workspace_one_marketplace_role_guard/);
});

test("Short Let naming and public location copy match the product boundary", async () => {
  const [title, detail] = await Promise.all([
    read("src/lib/listingPresentation.ts"),
    read("src/pages/ListingDetailCore.tsx"),
  ]);
  assert.doesNotMatch(title, /Short Stay/);
  assert.match(title, /Short Let/);
  assert.match(detail, /exact address,[\s\S]*full[\s\S]*accommodation payment is confirmed and protected/i);
});

test("paid Worker tools are not presented as a public trust badge", async () => {
  const [panel, profile, discovery] = await Promise.all([
    read("src/components/WorkerProPanel.tsx"),
    read("src/components/WorkerPublicProfile.tsx"),
    read("src/pages/WorkerDiscovery.tsx"),
  ]);
  assert.match(panel, /subscription pays for the business tools listed below/i);
  assert.doesNotMatch(panel, /gold PRO mark|<WorkerProBadge/);
  assert.doesNotMatch(profile, /WorkerProBadge/);
  assert.doesNotMatch(discovery, /WorkerProBadge/);
});
