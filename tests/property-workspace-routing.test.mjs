import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const read = path => fs.readFileSync(path, 'utf8');
const load = path => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Intl, Date });
  return exports;
};
const plain = value => JSON.parse(JSON.stringify(value));
const nav = load('src/lib/propertyNavigation.ts');
const activity = load('src/lib/activityFeed.ts');

test('property record keys preserve hotel/listing/inspection identity without numeric collisions', () => {
  const row = { id: 'inspection-a', lifecycle_stage: 'live', draft_hotel_id: 7, draft_listing_id: 'listing-b', hotel: { hotel_id: 7 } };
  assert.equal(nav.propertyRecordKey('hotel', 7), 'hotel:7');
  assert.equal(nav.matchesPropertyRecord(row, 'hotel:7'), true);
  assert.equal(nav.matchesPropertyRecord(row, 'inspection:7'), false);
  assert.equal(nav.matchesPropertyRecord(row, 'listing:7'), false);
  assert.equal(nav.matchesPropertyRecord(row, 'listing:listing-b'), true);
  assert.equal(nav.matchesPropertyRecord(row, 'inspection:inspection-a'), true);
  assert.equal(nav.matchesPropertyRecord(row, 'hotel:8'), false);
  assert.equal(nav.matchesPropertyRecord(row, 'inspection-a'), true);
});

test('hotel inventory distinguishes missing projection from real empty and real populated stock', () => {
  assert.equal(nav.hotelInventorySummary({}), 'Room inventory unavailable');
  assert.equal(nav.hotelInventorySummary({ room_type_count: null, total_room_count: 3 }), 'Room inventory unavailable');
  assert.equal(nav.hotelInventorySummary({ room_type_count: 0, total_room_count: 0 }), '0 room types · 0 rooms');
  assert.equal(nav.hotelInventorySummary({ room_type_count: 2, total_room_count: 3, starting_rate: 20000 }), '2 room types · 3 rooms · from ₦20,000');
});

test('cancelled unpaid stays do not request payment or conceal genuine refunds and failures', () => {
  assert.equal(nav.hotelPaymentLabel('cancelled', 'unpaid'), 'No active payment');
  assert.equal(nav.hotelPaymentLabel('expired', 'unpaid'), 'No active payment');
  assert.equal(nav.hotelPaymentLabel('cancelled', 'paid'), 'Payment verified');
  assert.equal(nav.hotelPaymentLabel('cancelled', 'failed'), 'Payment failed');
  assert.equal(nav.hotelPaymentLabel('cancelled', 'refunded'), 'Refunded');
  assert.equal(nav.hotelPaymentLabel('confirmed', 'paid'), 'Payment verified');
  assert.equal(nav.hotelPaymentLabel('pending', 'unpaid'), 'Awaiting payment');
});

test('hotel lifecycle Activity keeps the exact booking and parent regardless of legacy destination', () => {
  for (const route of ['my_reservations', 'hotel_detail', 'operations_properties', 'conversation']) {
    assert.deepEqual(plain(activity.resolveActivityDestination({ type: 'hotel.stay_confirmed', source_type: 'hotel_booking', source_id: '42', destination_route: route, destination_params: { hotelId: 7, bookingId: 42, conversation_id: 'thread-99' } })), { route: 'hotel_booking', id: '42', hotelId: '7' });
  }
  assert.deepEqual(plain(activity.resolveActivityDestination({ type: 'hotel.message', source_type: 'hotel_booking', source_id: '42', destination_route: 'conversation', destination_params: { hotelId: 7, bookingId: 42, conversation_id: 'thread-99' } })), { route: 'conversation', id: 'thread-99' });
});

test('hotel parent routing does not overwrite an exact inspection or apartment reservation', () => {
  assert.deepEqual(plain(activity.resolveActivityDestination({ type: 'property.inspection', source_type: 'inspection', source_id: 'inspection-a', destination_route: 'operations_properties', destination_params: { inspection_id: 'inspection-a', hotelId: 7 } })), { route: 'operations_properties', id: 'inspection-a' });
  assert.deepEqual(plain(activity.resolveActivityDestination({ type: 'reservation.move_in_requested', source_type: 'reservation', source_id: 'reservation-a', destination_route: 'operations_properties', destination_params: { reservation_id: 'reservation-a', listing_id: 'listing-b' } })), { route: 'reservation', id: 'reservation-a' });
});

test('All and Live use one published manager; Activity preserves its mounted origin', () => {
  const owner = read('src/pages/PropertyOwnerDashboard.tsx');
  const requests = read('src/components/PartnerSubmittedRequests.tsx');
  assert.match(owner, /filter === "public" \|\| publishedTarget/);
  assert.match(requests, /request.lifecycle_stage === "live" && onOpenPublished/);
  assert.match(owner, /inert=\{Boolean\(propertyTargetId\)\}/);
  assert.match(owner, /getMyHotelBookingTarget\(id\)/);
  assert.doesNotMatch(owner, /for \(const hotel of hotels.data/);
  assert.match(owner, /initialBookingId=\{initialReservationId\}/);
  assert.match(read('src/pages/Notifications.tsx'), /onNavigate\(destination.route, destination.id, destination\)/);
});

test('Creator profile preserves its caller while opening the authorized internal hotel, not public discovery', () => {
  const profile = read('src/components/UserProfileModal.tsx');
  const pipeline = read('src/components/PropertyPipelineWorkspace.tsx');
  const record = pipeline.slice(pipeline.indexOf('function CreatorHotelRecord('), pipeline.indexOf('function SubmissionSummary('));
  assert.match(profile, /propertyRecordKey\(kind === "hotel" \? "hotel" : "listing", id\)/);
  assert.match(profile, /onExitRecord=\{closeOperation\}/);
  assert.match(record, /get_my_property_hotel_record/);
  assert.doesNotMatch(record, /getHotelRooms\(hotelId\)|\.from\("hotels"\)/);
});

test('hotel sections separate daily work from setup and team, retaining capability gates', () => {
  const source = read('src/components/PartnerHotelOperations.tsx');
  for (const label of ['Today', 'Reservations', 'Rooms and packages', 'Availability', 'Property details', 'Team']) assert.ok(source.includes(`label: "${label}"`));
  assert.match(source, /visibleSection === "team" && canManageTeam/);
  assert.match(source, /matchesHotelReservationFilter\(row, reservationFilter, date\)/);
  assert.doesNotMatch(source, /visibleSection === "overview" \|\| visibleSection === "availability"/);
  assert.doesNotMatch(source, /overflow-x-auto/);
  assert.match(source, /visibleSection === "reservations" && canReadStays/);
  assert.match(source, /setLiveCapabilities\(\[\]\)/);
  assert.match(source, /generation !== loadGeneration.current/);
  assert.match(source, /row.inventory_date === date/);
  assert.doesNotMatch(source, /External payment timing can be mapped/);
});


test('property names stay consistent across submission, publication and internal views', () => {
  const hotel = { name: 'Test Lodge' };
  assert.equal(nav.propertyRecordTitle(hotel), 'Test Lodge');
  assert.equal(nav.propertyRecordTitle({ hotel, property_address: 'Test road' }), 'Test Lodge');
  assert.equal(nav.propertyRecordTitle({ property_display_name: 'Test Lodge', property_address: 'Test road' }), 'Test Lodge');
  assert.equal(nav.propertyRecordTitle({ hotel_program: hotel, property_address: 'Test road' }), 'Test Lodge');
  assert.equal(nav.propertyRecordTitle({ hotel, property_display_name: 'Old name' }), 'Test Lodge');
  assert.equal(nav.propertyRecordTitle({ listing: { title: 'Oak apartment' }, property_address: 'Test road' }), 'Oak apartment');
  assert.equal(nav.propertyRecordTitle({ property_display_name: '  ', name: 123, property_address: ' Test road ' }), 'Test road');
  assert.equal(nav.propertyRecordTitle({ request_code: 'WHIR-TEST-ONLY' }), 'Property');
  assert.equal(nav.propertyRecordTitle({}, 'Submitted property'), 'Submitted property');
  for (const path of ['src/components/PartnerSubmittedRequests.tsx', 'src/components/PropertyPipelineWorkspace.tsx']) assert.match(read(path), /propertyRecordTitle\(/);
});
