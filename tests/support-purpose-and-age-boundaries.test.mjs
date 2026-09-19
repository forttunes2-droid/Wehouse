import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Worker job Message WeHouse belongs to Worker Operations while direct job chat stays separate", async () => {
  const [support, jobChat, atomic] = await Promise.all([
    read("src/lib/supabase/support.ts"),
    read("src/components/BookingNegotiationChat.tsx"),
    read("supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql"),
  ]);
  const workerStart = support.indexOf('if (contextType === "worker_booking")');
  const workerEnd = support.indexOf('return {\n    kind: "support",', workerStart);
  const workerBlock = support.slice(workerStart, workerEnd);
  assert.match(workerBlock, /operator: "WeHouse Worker Operations"/);
  assert.match(workerBlock, /operational: true/);
  assert.match(jobChat, /contextType: "worker_booking"/);
  assert.match(jobChat, /category: "service_booking_help"/);
  assert.match(support, /p_reason_code: "worker_job_issue"/);
  assert.match(support, /p_subject_type: "worker_job"/);
  assert.match(atomic, /v_context='worker_booking'[\s\S]*open_contextual_case_conversation\([\s\S]*'worker_job_issue','worker_job'/);
});

test("Property Message WeHouse is owned by Property Operations", async () => {
  const support = await read("src/lib/supabase/support.ts");
  const reservationStart = support.indexOf("if (reservation)");
  const propertyStart = support.indexOf('if (\n    [\n      "property_listing"');
  const workerStart = support.indexOf('if (contextType === "worker_booking")');
  assert.ok(reservationStart >= 0 && propertyStart > reservationStart && workerStart > propertyStart);
  assert.match(support.slice(reservationStart, propertyStart), /operator: "WeHouse Property Operations"/);
  assert.match(support.slice(propertyStart, workerStart), /operator: "WeHouse Property Operations"/);
  assert.match(support.slice(workerStart), /operator: "WeHouse Support"/);
});

test("Hotel guest chat stays separate while Message WeHouse preserves the canonical booking thread", async () => {
  const [reservations, support, hotelDetail] = await Promise.all([
    read("src/pages/MyReservations.tsx"),
    read("src/lib/supabase/support.ts"),
    read("src/pages/HotelDetailExperience.tsx"),
  ]);
  const hotelHelpStart = reservations.indexOf("function hotelSupport(row: any)");
  const hotelHelpEnd = reservations.indexOf("if (activeService)", hotelHelpStart);
  const hotelHelp = reservations.slice(hotelHelpStart, hotelHelpEnd);
  assert.match(hotelHelp, /category: "hotel_booking"/);
  assert.match(hotelHelp, /contextType: "hotel_booking"/);
  assert.match(hotelHelp, /source_type: "hotel_booking"/);
  assert.doesNotMatch(hotelHelp, /hotel_booking_help/);
  assert.match(reservations, /<HotelBookingChat/);
  assert.match(hotelDetail, /contextType: "hotel_property"/);
  assert.match(hotelDetail, /Message WeHouse/);
  assert.match(support, /\["apartment_reservation", "hotel_booking"\][\s\S]*open_my_reservation_conversation/);
  assert.doesNotMatch(support, /contextType === "hotel_booking_help"/);
});

test("Adult eligibility mutation requires authentication and the completion guard is trigger-only", async () => {
  const [migration, setup] = await Promise.all([
    read("supabase/migrations/20260916143500_lock_age_rpc_execution.sql"),
    read("src/pages/Setup.tsx"),
  ]);
  assert.match(migration, /revoke execute on function public\.require_adult_before_profile_completion\(\) from public/);
  assert.match(migration, /revoke execute on function public\.require_adult_before_profile_completion\(\) from anon/);
  assert.match(migration, /revoke execute on function public\.require_adult_before_profile_completion\(\) from authenticated/);
  assert.match(migration, /revoke execute on function public\.set_my_date_of_birth\(date\) from anon/);
  assert.match(migration, /grant execute on function public\.set_my_date_of_birth\(date\) to authenticated/);
  assert.match(setup, /supabase\.rpc\('set_my_date_of_birth'/);
});

test("Worker Jobs and Partner Properties remain the existing operational homes", async () => {
  const [worker, partner] = await Promise.all([
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("src/pages/PropertyOwnerDashboard.tsx"),
  ]);
  assert.match(worker, /\{ id: "jobs", label: "Jobs" \}/);
  assert.doesNotMatch(worker, /label: "Overview"/);
  assert.match(worker, /<WorkerAvailabilityControl profile=\{profile\}/);
  assert.match(worker, /<WorkerJobsPanelV2/);
  assert.match(partner, /key: "properties"[\s\S]*label: "Properties"/);
  assert.doesNotMatch(partner, /label: "Overview"/);
  assert.match(partner, /<WeHouseSelect[\s\S]*label: "Apartments"[\s\S]*label: "Hotels"/);
});