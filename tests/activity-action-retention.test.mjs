import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = process.env.ACTIVITY_SOURCE || 'src/lib/activityFeed.ts';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Intl, Date });
const { currentActivityRows, resolveActivityDestination } = exports;
const now = Date.parse('2026-09-23T12:00:00Z');
const at = minutesAgo => new Date(now - minutesAgo * 60000).toISOString();
const base = {
  source_type: 'hotel_booking', source_id: 'booking-1',
  destination_route: 'hotel_booking',
  destination_params: { booking_id: 'booking-1', hotel_id: 'hotel-1' },
};
const event = (id, minutesAgo, extra = {}) => ({
  ...base, id, type: 'hotel.stay_updated', created_at: at(minutesAgo), read: false, ...extra,
});
const ids = rows => Array.from(currentActivityRows(rows, now), row => row.id);

test('newer informational update does not hide an unresolved hotel action', () => {
  const older = event('arrival-action', 15, { type: 'hotel.arrival_review_required', action_required: true });
  assert.deepEqual(ids([older, event('stay-update', 2)]), ['stay-update', 'arrival-action']);
});

test('reading an unresolved action does not make a later update hide it', () => {
  const action = event('read-action', 10, { type: 'hotel.arrival_review_required', action_required: true, read: true });
  assert.deepEqual(ids([action, event('new-info', 1)]), ['new-info', 'read-action']);
});

test('distinct unresolved actions on one booking remain visible', () => {
  assert.deepEqual(ids([
    event('action-a', 5, { action_required: true }),
    event('action-b', 4, { action_required: true }),
    event('update', 1),
  ]), ['update', 'action-b', 'action-a']);
});

test('duplicate delivery of the same action ID is still collapsed', () => {
  const action = event('same-action', 3, { action_required: true });
  assert.deepEqual(ids([action, { ...action }]), ['same-action']);
});

test('legacy action without an ID has a stable fallback for duplicate delivery', () => {
  const action = event(undefined, 3, { action_required: true });
  assert.equal(currentActivityRows([action, { ...action }], now).length, 1);
});

test('distinct ID-less action events are not collapsed by their shared booking', () => {
  assert.equal(currentActivityRows([
    event(undefined, 3, { action_required: true }),
    event(undefined, 5, { action_required: true }),
  ], now).length, 2);
});

test('ordinary lifecycle updates continue to collapse to their newest row', () => {
  assert.deepEqual(ids([event('older', 20), event('latest', 2)]), ['latest']);
});

test('a resolved action is not retained as an outstanding action', () => {
  const resolved = event('resolved', 10, { action_required: true, resolved_at: at(8) });
  assert.deepEqual(ids([resolved, event('latest', 2)]), ['latest']);
});

test('separate records keep their own informational updates', () => {
  assert.deepEqual(ids([
    event('booking-a', 5), event('booking-b', 2, { source_id: 'booking-2' }),
  ]), ['booking-b', 'booking-a']);
});

test('legacy inferred Long Let move-in action survives a newer housing update', () => {
  const context = { source_type: 'reservation', source_id: 'long-let-1', destination_route: 'reservation' };
  const action = event('move-in', 10, { ...context, type: 'property_move_in_requested' });
  const update = event('housing-info', 2, { ...context, type: 'property_reservation_updated' });
  assert.deepEqual(ids([action, update]), ['housing-info', 'move-in']);
});

test('refund action survives a newer payment update for the same booking', () => {
  const action = event('refund-action', 10, { type: 'hotel_refund_due', action_required: true });
  const update = event('payment-info', 2, { type: 'hotel_payment_updated' });
  assert.deepEqual(ids([action, update]), ['payment-info', 'refund-action']);
});

test('transient events and ordinary message notifications remain excluded', () => {
  assert.deepEqual(ids([
    event('typing', 1, { type: 'typing' }),
    event('chat', 2, { type: 'message_received', source_type: 'conversation', destination_route: 'conversation' }),
    event('normal', 3),
  ]), ['normal']);
});

test('existing retention and invalid-date filtering are unchanged', () => {
  assert.deepEqual(ids([
    event('invalid', 1, { created_at: 'not-a-date', action_required: true }),
    event('expired', 181 * 24 * 60, { action_required: true }),
    event('valid', 1),
  ]), ['valid']);
});

test('retaining an action does not change the caller array or its typed destination', () => {
  const action = event('action', 10, { action_required: true });
  const update = event('update', 1);
  const rows = Object.freeze([Object.freeze(action), Object.freeze(update)]);
  const result = currentActivityRows(rows, now);
  assert.equal(rows[0], action);
  assert.equal(rows[1], update);
  assert.equal(result[1], action);
  const plain = JSON.parse(JSON.stringify(resolveActivityDestination(action)));
  assert.deepEqual(plain, { route: 'hotel_booking', id: 'booking-1', hotelId: 'hotel-1' });
});
