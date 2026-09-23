import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/propertyNavigation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Intl });
const { hotelRoomAvailability: calculate } = exports;
const date = '2026-09-23';
const now = Date.parse('2026-09-23T10:00:00Z');
const room = { room_id: 8, total_rooms: 3 };
const units = [1, 2, 3].map(unit_id => ({ unit_id, room_id: 8, status: 'ready' }));
const booking = changes => ({ room_id: 8, status: 'confirmed', check_in: date, check_out: '2026-09-24', ...changes });

test('configured room count never invents sellable physical units', () => {
  assert.equal(calculate(room, [], [], units, date, now).available, 3);
  const absent = calculate(room, [], [], [], date, now);
  assert.equal(absent.available, 0);
  assert.equal(absent.setupIncomplete, true);
  assert.equal(absent.maintenance, 0);
  const partial = calculate(room, [], [], units.slice(0, 1), date, now);
  assert.equal(partial.available, 1);
  assert.equal(partial.setupIncomplete, true);
});

test('maintenance and out-of-service reduce the same count used by the total', () => {
  const states = units.map((unit, index) => ({ ...unit, status: ['ready', 'maintenance', 'out_of_service'][index] }));
  const result = calculate(room, [], [], states, date, now);
  assert.equal(result.available, 1);
  assert.equal(result.operational, 1);
  assert.equal(result.maintenance, 2);
  assert.equal(result.setupIncomplete, false);
});

test('only active dated holds and confirmed stays consume availability', () => {
  const rows = [
    booking({ status: 'pending', payment_expires_at: '2026-09-23T10:01:00Z' }),
    booking({ status: 'pending', payment_expires_at: '2026-09-23T10:00:00Z' }),
    booking({ status: 'pending', payment_expires_at: 'invalid' }),
    booking({ status: 'cancelled' }),
    booking({ status: 'checked_out' }),
    booking({ room_id: 9 }),
    booking({ check_out: date }),
    booking({ check_in: '2026-09-24', check_out: '2026-09-25' }),
    booking({}),
  ];
  const result = calculate(room, rows, [], units, date, now);
  assert.equal(result.holds, 1);
  assert.equal(result.occupied, 1);
  assert.equal(result.available, 1);
});

test('dated restrictions, closed sales and overbooking cannot create stock', () => {
  const override = { room_id: 8, inventory_date: date, available_quantity: 2, closed: false };
  assert.equal(calculate(room, [booking({})], [override], units, date, now).available, 1);
  assert.equal(calculate(room, [], [{ ...override, closed: true }], units, date, now).available, 0);
  assert.equal(calculate(room, [], [{ ...override, available_quantity: 100 }], units, date, now).available, 3);
  assert.equal(calculate(room, [], [{ ...override, inventory_date: '2026-09-24', closed: true }], units, date, now).available, 3);
  assert.equal(calculate(room, Array.from({ length: 5 }, () => booking({})), [], units, date, now).available, 0);
});

test('duplicate and unrelated units cannot inflate capacity', () => {
  const rows = [units[0], units[0], { unit_id: 4, room_id: 99, status: 'ready' }];
  assert.equal(calculate(room, [], [], rows, date, now).available, 1);
  assert.equal(calculate(room, [], [], [{ ...units[0], status: 'unknown' }], date, now).available, 0);
});

test('hotel total and per-room rows consume one computed projection', () => {
  const source = fs.readFileSync('src/components/PartnerHotelOperations.tsx', 'utf8');
  assert.match(source, /hotelRoomAvailability\(room, bookings, inventory, roomUnits, date, inventoryAsOf\)/);
  assert.match(source, /const available = dailyRooms\.reduce\(\(sum, row\) => sum \+ row\.available, 0\)/);
  assert.match(source, /<TodayRooms rows=\{dailyRooms\} \/>/);
  const roomRows = source.slice(source.indexOf('function TodayRooms('), source.indexOf('function RoomRow('));
  assert.doesNotMatch(roomRows, /Date\.now\(|bookings\.filter|inventory\.find/);
  assert.match(roomRows, /Room setup incomplete/);
});
