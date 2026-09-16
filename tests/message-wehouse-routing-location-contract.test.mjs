import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("customer Help is Account-only for Personal, Service Provider and Property Partner", async () => {
  const [account, app] = await Promise.all([
    read("src/pages/AccountCenter.tsx"),
    read("src/App.tsx"),
  ]);
  assert.match(account, /canOpenCustomerHelp = \["user", "worker", "property_partner"\]\.includes\(role\)/);
  assert.match(account, /panel === "help" && canOpenCustomerHelp/);
  assert.match(account, /canOpenCustomerHelp \? \(/);
  assert.match(app, /\["user", "worker", "property_partner"\]\.includes/);
});

test("Property Partner submission help enters Property Operations through structured reason data", async () => {
  const [partner, migration] = await Promise.all([
    read("src/components/PartnerSubmittedRequests.tsx"),
    read("supabase/migrations/20260916180000_property_routing_and_public_address.sql"),
  ]);
  assert.match(partner, /category: "property_submission_help"/);
  assert.match(partner, /contextType: "contextual_help"/);
  assert.match(partner, /reason_code: "property_submission_help"/);
  assert.match(partner, /subject_type: "inspection"/);
  assert.match(migration, /'property_submission_help','Property submission help','property_operations'/);
  assert.match(migration, /array\['inspection'\]::text\[\]/);
});

test("fallback Help keeps payment and safety with the linked property or job owner", async () => {
  const help = await read("src/components/AccountHelpCenter.tsx");
  assert.match(help, /function openLinkedJourney/);
  assert.match(help, /\["apartment_reservation", "hotel_booking", "worker_booking"\]/);
  assert.match(help, /openLinkedJourney\(target, "payment_issue", "Payment issue"\)/);
  assert.match(help, /openLinkedJourney\(target, "safety_threat", "Safety concern"\)/);
  assert.match(help, /Finance is the direct/);
  assert.match(help, /moneyReason === "payout_issue" \? "payout"/);
  assert.match(help, /contextType: "contextual_help"/);
});

test("public accommodation shows written address without returning supplier coordinates", async () => {
  const [projection, legacy] = await Promise.all([
    read("supabase/migrations/20260916180000_property_routing_and_public_address.sql"),
    read("supabase/migrations/20260916180500_remove_customer_coordinate_leaks.sql"),
  ]);
  assert.match(projection, /'address',l\.address/);
  assert.match(projection, /'gps_latitude',null/);
  assert.match(projection, /'gps_longitude',null/);
  assert.match(projection, /'address',h\.address/);
  assert.match(projection, /get_my_discovery_distances/);
  assert.match(legacy, /create or replace function public\.get_discoverable_homes\(\)/);
  assert.match(legacy, /create or replace function public\.get_my_hotel_bookings\(\)/);
  assert.match(legacy, /'address',hotel\.address/);
  assert.match(legacy, /'gps_latitude',null/);
  assert.match(legacy, /'gps_longitude',null/);
});

test("discovery distance is server-computed and directions use the written address", async () => {
  const [hook, homes, hotels, listing, hotel] = await Promise.all([
    read("src/hooks/useDiscoveryLocation.ts"),
    read("src/pages/Search.tsx"),
    read("src/pages/HotelsHome.tsx"),
    read("src/pages/ListingDetailCore.tsx"),
    read("src/pages/HotelDetailExperience.tsx"),
  ]);
  assert.match(hook, /supabase\.rpc\("get_my_discovery_distances"/);
  assert.match(hook, /export function directionsUrl\(address: string\)/);
  assert.match(homes, /getDiscoveryDistanceMap/);
  assert.doesNotMatch(homes, /Number\(listing\.gps_latitude\)/);
  assert.match(hotels, /getDiscoveryDistanceMap/);
  assert.doesNotMatch(hotels, /Number\(hotel\.gps_latitude\)/);
  assert.match(listing, /directionsUrl\(visibleAddress\)/);
  assert.doesNotMatch(listing, /directionsUrl\(destination\.lat/);
  assert.match(hotel, /directionsUrl\(locationLabel\(hotel\.address/);
  assert.doesNotMatch(hotel, /directionsUrl\(exactDestination\.lat/);
});

test("a manually corrected property address remains authoritative over reverse geocoding", async () => {
  const [picker, submission] = await Promise.all([
    read("src/components/PreciseLocationPicker.tsx"),
    read("src/components/PropertyInspectionRequestPanel.tsx"),
  ]);
  assert.match(picker, /const typedAddress = value\?\.address\?\.trim\(\) \|\| ""/);
  assert.match(picker, /address: typedAddress \|\| suggestedAddress/);
  assert.match(submission, /current\.propertyAddress \|\| current\.location\.address/);
  assert.doesNotMatch(picker, /GPS accuracy/);
  assert.doesNotMatch(picker, /Pin adjusted manually/);
  assert.doesNotMatch(picker, /Edit pin/i);
});
