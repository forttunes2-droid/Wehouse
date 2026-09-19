import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const source = (await readFile(new URL('../supabase/functions/hotel-pms-api/index.ts', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function gateway(options = {}) {
  let handler;
  const events = new Map();
  const writes = [], queries = [];
  const integration = { integration_id: 'fixture-integration', hotel_id: 7, status: 'active', scopes: ['catalog.write','reservations.read','reservations.ack','room_status.write'], authoritative_domains: ['rooms','rates','inventory','room_status'], ...options.integration };
  const bookings = options.bookings || [{ booking_id: 1, hotel_id: 7, room_id: 10, updated_at: '2026-09-19T10:00:00.123456+00:00', payment_status: 'paid', status: 'confirmed' }];
  const admin = {
    rpc: async () => ({ data: options.runtimeActive ?? true, error: options.runtimeError || null }),
    from(table) {
      const q = { table, operation: 'read', filters: [], orders: [], payload: null, cap: 100 };
      queries.push(q);
      const builder = {
        select: () => builder,
        eq: (key, value) => { q.filters.push([key,value]); return builder; },
        in: () => builder,
        order: (key) => { q.orders.push(key); return builder; },
        limit: (n) => { q.cap = n; return builder; },
        or: (value) => { q.after = value; return builder; },
        insert: (payload) => { q.operation = 'insert'; q.payload = payload; return builder; },
        update: (payload) => { q.operation = 'update'; q.payload = payload; return builder; },
        upsert: (payload) => { q.operation = 'upsert'; q.payload = payload; return builder; },
        maybeSingle: () => execute(true), single: () => execute(true), then: (done) => execute(false).then(done),
      };
      async function execute(single) {
        const filter = (key) => q.filters.find(([k]) => k === key)?.[1];
        if (q.operation !== 'read') writes.push(q);
        if (table === 'hotel_integrations') return { data: integration, error: null };
        if (table === 'hotel_integration_events') {
          if (q.operation === 'insert') {
            if (events.has(q.payload.idempotency_key)) return { error: { code: '23505' } };
            const row = { ...q.payload, integration_event_id: `event-${events.size + 1}` };
            events.set(q.payload.idempotency_key, row);
            return { data: row, error: null };
          }
          if (q.operation === 'update') {
            if (options.eventWriteError) return { error: new Error('event storage unavailable') };
            const row = [...events.values()].find(e => e.integration_event_id === filter('integration_event_id'));
            Object.assign(row, q.payload);
            return { data: row, error: null };
          }
          return { data: events.get(filter('idempotency_key')) || null, error: options.eventReadError ? new Error('event lookup unavailable') : null };
        }
        if (table === 'hotel_bookings') {
          if (q.operation === 'update') return { data: bookings[0], error: options.bookingWriteError ? new Error('booking write unavailable') : null };
          if (single) return { data: bookings.find(b => b.booking_id === filter('booking_id')) || null, error: null };
          let rows = bookings;
          if (q.after) {
            const match = q.after.match(/^updated_at.gt.([^,]+),and\(updated_at.eq.[^,]+,booking_id.gt.(\d+)\)$/);
            assert.ok(match, 'cursor filter must be a safe, complete keyset comparison');
            rows = rows.filter(b => b.updated_at > match[1] || (b.updated_at === match[1] && b.booking_id > Number(match[2])));
          }
          return { data: rows.slice(0,q.cap), error: null };
        }
        if (table === 'hotel_rooms') return { data: single ? null : [], error: null };
        return { data: null, error: null };
      }
      return builder;
    },
  };
  vm.runInNewContext(compiled, { exports: {}, Response, URL, TextEncoder, crypto: webcrypto, console: { error() {} }, Deno: { env: { get: () => 'fixture' } }, createClient: () => admin, serve: fn => { handler = fn; } });
  return { events, writes, queries, request: (route, body, key = 'request-1') => handler(new Request(`https://test.invalid/functions/v1/hotel-pms-api${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer whpms_live_${'x'.repeat(40)}`, 'idempotency-key': key, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })) };
}

test('revoked certification or launch approval blocks even a valid active PMS token', async () => {
  for (const options of [{ runtimeActive: false }, { runtimeError: new Error('gate unavailable') }]) {
    const api = gateway(options);
    assert.equal((await api.request('/v1/reservations')).status, 401);
    assert.equal(api.queries.filter(q => q.table === 'hotel_bookings').length, 0);
  }
});

test('completed PMS retry returns its result, but changed payload, route or booking cannot reuse its key', async () => {
  const api = gateway();
  const body = { accepted: true, external_reservation_id: 'external-1' };
  assert.equal((await api.request('/v1/reservations/1/ack', body)).status, 200);
  const before = api.writes.length;
  const replay = await api.request('/v1/reservations/1/ack', { external_reservation_id: 'external-1', accepted: true });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent, true);
  assert.equal(api.writes.length, before);
  for (const [route, payload] of [['/v1/reservations/1/ack', { ...body, accepted: false }], ['/v1/reservations/2/ack', body], ['/v1/catalog', body]]) {
    assert.equal((await api.request(route, payload)).status, 409);
  }
  assert.equal(api.writes.length, before);
});

test('pending and failed retries never report successful processing', async () => {
  const api = gateway();
  await api.request('/v1/catalog', {});
  for (const state of ['pending','failed']) {
    api.events.get('request-1').status = state;
    const response = await api.request('/v1/catalog', {});
    assert.equal(response.status, 409);
    assert.equal((await response.json()).success, false);
  }
});

test('database failures never return a successful acknowledgement', async () => {
  for (const options of [{ bookingWriteError: true }, { eventWriteError: true }, { eventReadError: true }]) {
    const api = gateway(options);
    const response = await api.request('/v1/reservations/1/ack', { accepted: true });
    assert.ok(response.status >= 500);
    assert.equal((await response.json()).success, false);
  }
});

test('all catalog authority is checked before any partial write and room status requires delegation', async () => {
  const api = gateway({ integration: { authoritative_domains: ['rooms'] } });
  assert.equal((await api.request('/v1/catalog', { rooms: [{ external_reference: 'room-1' }], rates: [] })).status, 409);
  assert.equal((await api.request('/v1/room-status', { status: 'ready' })).status, 409);
  assert.equal(api.writes.length, 0);
});

test('equal-timestamp reservations paginate without skipping rows or mutating the read rows', async () => {
  const bookings = [1,2,3].map(booking_id => ({ booking_id, room_id: 10, updated_at: '2026-09-19T10:00:00.123456+00:00', payment_status: 'paid', status: 'confirmed' }));
  const api = gateway({ bookings });
  const first = await (await api.request('/v1/reservations?limit=2')).json();
  assert.deepEqual(first.reservations.map(b => b.wehouse_reservation_id), [1,2]);
  const next = await (await api.request(`/v1/reservations?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`)).json();
  assert.deepEqual(next.reservations.map(b => b.wehouse_reservation_id), [3]);
  assert.equal(api.writes.filter(q => q.table === 'hotel_bookings').length, 0);
  assert.deepEqual(api.queries.find(q => q.table === 'hotel_bookings').orders, ['updated_at','booking_id']);
  for (const cursor of ['bad', 'v1:%zz', 'v1:' + encodeURIComponent(JSON.stringify(['2026-09-19),hotel_id.gt.0',1]))]) {
    assert.equal((await api.request(`/v1/reservations?cursor=${encodeURIComponent(cursor)}`)).status, 400);
  }
});
