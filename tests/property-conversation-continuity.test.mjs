import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("Apartment and Hotel Message WeHouse preserve one property-to-booking conversation",async()=>{
  const [support,migration,hotel,reservations,apartment]=await Promise.all([
    read("src/lib/supabase/support.ts"),
    read("supabase/migrations/20260920114526_repair_support_topic_workspace_routing.sql"),
    read("src/pages/HotelDetailExperience.tsx"),
    read("src/pages/MyReservations.tsx"),
    read("src/pages/ListingDetailCore.tsx"),
  ]);
  assert.match(apartment,/Message WeHouse here\. Your conversation stays connected to[\s\S]*this apartment/);
  assert.match(hotel,/contextType: "hotel_property"/);
  assert.match(hotel,/Message WeHouse/);
  assert.match(reservations,/contextType: "hotel_booking"/);
  assert.doesNotMatch(reservations,/hotel_booking_help/);
  assert.match(support,/open_property_operations_conversation/);
  assert.match(support,/p_subject_type: "listing"/);
  assert.match(support,/p_subject_type: "hotel_property"/);
  assert.match(migration,/v_context='property_listing'[\s\S]*open_property_operations_conversation\([\s\S]*'listing'/);
  assert.match(migration,/v_context in\('hotel_property','hotel_operations'\)[\s\S]*open_property_operations_conversation\([\s\S]*'hotel_property'/);
  assert.match(migration,/v_context in\('apartment_reservation','hotel_booking'\)[\s\S]*open_my_reservation_conversation/);
});

test("Inspection help with a reservation stays on that reservation conversation",async()=>{
  const [support,migration]=await Promise.all([
    read("src/lib/supabase/support.ts"),
    read("supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql"),
  ]);
  assert.match(support,/canonicalContextType === "property_inspection"[\s\S]*snapshot\.reservation_id[\s\S]*open_my_reservation_conversation/);
  assert.match(migration,/v_context='property_inspection'[\s\S]*v_snapshot->>'reservation_id'[\s\S]*open_my_reservation_conversation/);
});

test("Property Partner owns apartments and hotels in one Properties workspace",async()=>{
  const [partner,hotelTeam]=await Promise.all([
    read("src/pages/PropertyOwnerDashboard.tsx"),
    read("src/pages/HotelTeamDashboard.tsx"),
  ]);
  assert.match(partner,/type PartnerTab = "properties" \| "finance" \| "communication"/);
  assert.match(partner,/value: "apartment", label: "Apartments"/);
  assert.match(partner,/value: "hotel", label: "Hotels"/);
  assert.match(partner,/assetKind === "apartment"[\s\S]*\.from\("listings"\)[\s\S]*:\s*await supabase[\s\S]*\.from\("hotels"\)/);
  assert.match(partner,/accessRole="owner"/);
  assert.doesNotMatch(partner,/PartnerTab = [^\n]*"hotels"/);
  assert.match(hotelTeam,/access_role: "manager" \| "front_desk"/);
  assert.doesNotMatch(hotelTeam,/accessRole="owner"/);
});
