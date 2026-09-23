import chatMediaPolicy from './helpers/chat-media-policy.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function supportModule() {
  const calls = [];
  const exports = {};
  const code = ts.transpileModule(await read("src/lib/supabase/support.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if(name === '@/lib/chatMediaPolicy') return chatMediaPolicy;
    if (name === "./client") return { supabase: { async rpc(name, args) {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return { data: { conversation_id: "test-conversation" }, error: null };
    } } };
    if (name === "@/lib/propertyBookingLifecycle") return { propertyBookingStatusLabel: () => "Status unavailable" };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return { ...exports, calls };
}

test("Worker job keeps Worker Operations routing without naming an internal department as the customer contact", async () => {
  const [support, jobChat, atomic] = await Promise.all([
    supportModule(),
    read("src/components/BookingNegotiationChat.tsx"),
    read("supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql"),
  ]);
  const context = { contextType: "worker_booking", contextId: "job-1", subject: "Service question" };
  const customer = support.conversationPresentation(context);
  const operations = support.conversationPresentation(context, "operations");
  assert.equal(customer.operator, "WeHouse");
  assert.equal(customer.operational, true);
  assert.equal(operations.operator, "WeHouse Worker Operations");
  await support.createSupportConversation(context);
  assert.equal(support.calls[0].name, "open_contextual_case_conversation");
  assert.equal(support.calls[0].args.p_reason_code, "worker_job_issue");
  assert.equal(support.calls[0].args.p_subject_type, "worker_job");
  assert.equal(support.calls[0].args.p_subject_id, "job-1");
  assert.match(jobChat, /contextType: "worker_booking"/);
  assert.match(jobChat, /category: "service_booking_help"/);
  assert.match(atomic, /v_context='worker_booking'[\s\S]*open_contextual_case_conversation\([\s\S]*'worker_job_issue','worker_job'/);
});

test("Property Message WeHouse retains Property Operations authority and canonical property/booking routes", async () => {
  const support = await supportModule();
  for (const contextType of ["apartment_reservation", "hotel_booking", "property_listing", "property_inspection", "hotel_property", "hotel_operations"]) {
    const context = { contextType, contextId: "1", contextSnapshot: { linked_label: "Test property" } };
    assert.equal(support.conversationPresentation(context).operator, "WeHouse");
    assert.equal(support.conversationPresentation(context).title, "Test property");
    assert.equal(support.conversationPresentation(context, "operations").operator, "WeHouse Property Operations");
    assert.equal(support.conversationPresentation(context, "operations").operational, true);
  }
  assert.equal(support.conversationPresentation({}).operator, "WeHouse");
  assert.equal(support.conversationPresentation({}, "operations").operator, "WeHouse Support");
  for (const contextType of ["apartment_reservation", "hotel_booking", "property_listing", "hotel_property"])
    await support.createSupportConversation({ contextType, contextId: "1" });
  assert.deepEqual(support.calls.map(call => call.name), [
    "open_my_reservation_conversation", "open_my_reservation_conversation",
    "open_property_operations_conversation", "open_property_operations_conversation",
  ]);
  assert.equal(support.calls[0].args.p_context_type, "apartment_reservation");
  assert.equal(support.calls[1].args.p_context_type, "hotel_booking");
  assert.equal(support.calls[2].args.p_subject_type, "listing");
  assert.equal(support.calls[3].args.p_subject_type, "hotel_property");
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
