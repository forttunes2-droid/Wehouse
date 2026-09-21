import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("identity submission is workspace-aware and Partner gates respect the policy switch", async () => {
  const [migration, gate, check, partner, worker, verification] = await Promise.all([
    read("supabase/migrations/20260921092015_align_identity_routing_partner_gate_and_worker_services.sql"),
    read("src/components/IdentityAccessGate.tsx"),
    read("src/components/WorkerIdentityCheck.tsx"),
    read("src/pages/PropertyPartnerDashboard.tsx"),
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("src/pages/WorkerVerificationPhase9.tsx"),
  ]);

  assert.match(migration, /p_challenge_result->>'workspace'/);
  assert.match(migration, /pending_role='worker'.*workspace_role='worker_operations'/s);
  assert.match(migration, /pending_role='property_partner'.*workspace_role='property_operations'/s);
  assert.match(migration, /account_identity_checks_enabled\(\)[\s\S]*account_identity_is_current/);
  assert.match(gate, /workspace: 'worker' \| 'property_partner'/);
  assert.match(check, /workspace: 'worker' \| 'property_partner'/);
  assert.match(check, /workspace,/);
  assert.match(check, /notice_version: IDENTITY_NOTICE_VERSION/);
  assert.match(partner, /workspace="property_partner"/);
  assert.match(worker, /workspace="worker"/);
  assert.match(verification, /workspace="worker"/);
  assert.doesNotMatch(
    verification,
    /<WorkerIdentityCheck\s+profile=\{profile\}\s+status=/,
  );
  assert.match(verification, /identity_gate_satisfied/);
  assert.match(verification, /identity_recurring_required/);
  assert.match(verification, /identityRequired=\{a\.identity_required\}/);
  assert.doesNotMatch(verification, /repeat the check every/);
});

test("Worker setup manages several canonical services and booking prefers that list", async () => {
  const [migration, setup, booking, taxonomy] = await Promise.all([
    read("supabase/migrations/20260921093518_validate_worker_services_against_catalog.sql"),
    read("src/pages/WorkerSetupProfessional.tsx"),
    read("src/components/WorkerBookingRequestSheetV2.tsx"),
    read("src/lib/workerTaxonomy.ts"),
  ]);

  assert.match(migration, /create or replace function public\.set_my_worker_services/);
  assert.match(migration, /jsonb_array_length\(p_services\)>10/);
  assert.match(migration, /service_categories/);
  assert.match(migration, /service_subcategories/);
  assert.match(migration, /Choose an active WeHouse service from the approved catalog/);
  assert.match(setup, /Services you offer/);
  assert.match(setup, /set_my_worker_services/);
  assert.match(setup, /Add service/);
  assert.match(setup, /services\.length >= 10/);
  assert.match(booking, /canonical\.length[\s\S]*canonical[\s\S]*skills/);
  assert.match(taxonomy, /Array\.isArray\(worker\.services\)/);
});

test("apartment Help is contextual and switching away is deliberate", async () => {
  const [listing, core, support] = await Promise.all([
    read("src/pages/ListingDetail.tsx"),
    read("src/pages/ListingDetailCore.tsx"),
    read("src/components/SupportChat.tsx"),
  ]);

  assert.doesNotMatch(listing, /MutationObserver/);
  assert.doesNotMatch(listing, /pruneRoutineSupport/);
  assert.match(core, /Questions about this apartment\?/);
  assert.match(core, /Message WeHouse/);
  assert.match(support, /General Help/);
  assert.doesNotMatch(support, /aria-label="Remove linked topic"/);
});
