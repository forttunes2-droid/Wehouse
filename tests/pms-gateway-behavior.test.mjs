import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const source = (await readFile(new URL('../supabase/functions/hotel-pms-api/index.ts', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const limiter={};vm.runInNewContext(ts.transpileModule(await readFile(new URL('../supabase/functions/_shared/rateLimit.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:limiter});
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function gateway(options = {}) {
  let handler;
  const events = new Map();
  const writes = [], queries = [];
  const integration = { integration_id: 'fixture-integration', hotel_id: 7, status: 'active', scopes: ['catalog.write','reservations.read','reservations.ack','room_status.write'], authoritative_domains: ['rooms','rates','inventory','room_status'], ...options.integration };
  const bookings = options.bookings || [{ booking_id: 1, hotel_id: 7, room_id: 10, updated_at: '2026-09-19T10:00:00.123456+00:00', payment_status: 'paid', status: 'confirmed' }];
  const admin = {
    rpc: async (name,args={}) => {
      if(name==='consume_user_action_from_service')return{data:options.limiterError?null:{allowed:!options.rateLimited,retry_after_seconds:options.rateLimited?30:0},error:options.limiterError?new Error('Limiter unavailable'):null};
      if(name==='hotel_integration_runtime_active')return{data:options.runtimeActive??true,error:options.runtimeError||null};
      if(name==='apply_hotel_pms_catalog'){
        if(options.catalogError)return{data:null,error:new Error('Atomic catalog unavailable')};
        const details=Object.fromEntries(['rooms','rates','inventory'].map(domain=>[domain,args.p_catalog[domain]?.length||0]));
        const event=[...events.values()].find(row=>row.integration_event_id===args.p_event_id);
        Object.assign(event,{status:'acknowledged',details});writes.push({table:'catalog',operation:'atomic_apply',payload:args.p_catalog});
        return options.catalogLost?{data:null,error:new Error('Lost committed catalog response')}:{data:details,error:null};
      }
      if(name==='apply_hotel_pms_room_status'){
        const event=[...events.values()].find(row=>row.integration_event_id===args.p_event_id);
        const details=options.occupiedUnit?{review_required:true,reason:'Occupied WeHouse unit was not overridden'}:{review_required:false,unit_id:'31',status:args.p_status};
        Object.assign(event,{status:details.review_required?'review_required':'acknowledged',details});
        if(!details.review_required)writes.push({table:'hotel_room_units',operation:'atomic_status',payload:details});return{data:details,error:null};
      }
      assert.equal(name,'ack_hotel_pms_reservation');
      if(options.bookingWriteError||options.eventWriteError)return{data:null,error:new Error('Atomic acknowledgement unavailable')};
      const booking=bookings.find(row=>row.booking_id===args.p_booking_id);
      if(!booking||booking.updated_at!==args.p_expected_updated_at||booking.status!==args.p_expected_status)return{data:null,error:{code:'40001',message:'Reservation changed'}};
      const row=[...events.values()].find(event=>event.integration_event_id===args.p_event_id);
      const details={booking_id:booking.booking_id,accepted:args.p_accepted,external_reservation_id:args.p_external_id,review_required:!args.p_accepted,reservation_status:booking.status,reservation_updated_at:booking.updated_at};
      writes.push({table:'hotel_bookings',operation:'atomic_ack',payload:details});
      Object.assign(row,{status:args.p_accepted?'acknowledged':'review_required',details});return options.ackLost?{data:null,error:new Error('Lost committed acknowledgement response')}:{data:details,error:null};
    },
    from(table) {
      const q = { table, operation: 'read', filters: [], orders: [], payload: null, cap: 100 };
      queries.push(q);
      const builder = {
        select: () => builder,
        eq: (key, value) => { q.filters.push([key,value]); return builder; },
        in: (key, value) => { q.filters.push([key,value]); return builder; },
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
            if(!row||filter('status')&&row.status!==filter('status'))return{data:null,error:null};
            Object.assign(row, q.payload);
            return { data: row, error: null };
          }
          return { data: events.get(filter('idempotency_key')) || null, error: options.eventReadError ? new Error('event lookup unavailable') : null };
        }
        if (table === 'hotel_bookings') {
          if (q.operation === 'update') return { data: bookings[0], error: options.bookingWriteError ? new Error('booking write unavailable') : null };
          if (single) return { data: bookings.find(b => b.booking_id === filter('booking_id')) || null, error: null };
          let rows = bookings;
          for (const [key,value] of q.filters) rows = rows.filter(row => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
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
  vm.runInNewContext(compiled, { exports: {}, Response, URL, TextEncoder, TextDecoder, consumeUserAction:limiter.consumeUserAction, crypto: webcrypto, console: { error() {} }, Deno: { env: { get: () => 'fixture' } }, createClient: () => admin, serve: fn => { handler = fn; } });
  return { events, writes, queries, request: (route, body, key = 'request-1') => handler(new Request(`https://test.invalid/functions/v1/hotel-pms-api${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer whpms_live_${'x'.repeat(40)}`, 'idempotency-key': key, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })) };
}

test('revoked certification or launch approval blocks even a valid active PMS token', async () => {
  for (const options of [{ runtimeActive: false }, { runtimeError: new Error('gate unavailable') }]) {
    const api = gateway(options);
    assert.equal((await api.request('/v1/reservations')).status, 401);
    assert.equal(api.queries.filter(q => q.table === 'hotel_bookings').length, 0);
  }
});

test('PMS delivery includes cancellation and refund changes without inventing paid status',async()=>{
  const bookings=[
    {booking_id:1,hotel_id:7,room_id:10,status:'cancelled',payment_status:'paid',updated_at:'2026-10-22T10:00:00Z'},
    {booking_id:2,hotel_id:7,room_id:10,status:'refunded',payment_status:'refunded',updated_at:'2026-10-22T10:00:01Z'},
    {booking_id:3,hotel_id:7,room_id:10,status:'pending',payment_status:'unpaid',updated_at:'2026-10-22T10:00:02Z'},
  ];
  const api=gateway({bookings});
  const result=await(await api.request('/v1/reservations')).json();
  assert.deepEqual(result.reservations.map(x=>[x.status,x.money.payment_status]),[['cancelled','paid'],['refunded','refunded']]);
  const ack=gateway({bookings:[bookings[1]]});
  assert.equal((await ack.request('/v1/reservations/2/ack',{accepted:true,reservation_updated_at:bookings[1].updated_at,reservation_status:bookings[1].status})).status,200);
});

test('completed PMS retry returns its result, but changed payload, route or booking cannot reuse its key', async () => {
  const api = gateway();
  const body = { accepted: true, external_reservation_id: 'external-1', reservation_updated_at:'2026-09-19T10:00:00.123456+00:00',reservation_status:'confirmed' };
  assert.equal((await api.request('/v1/reservations/1/ack', body)).status, 200);
  const before = api.writes.length;
  const replay = await api.request('/v1/reservations/1/ack', { ...body, external_reservation_id: 'external-1', accepted: true });
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
  for (const state of ['pending','dead_letter']) {
    api.events.get('request-1').status = state;
    const response = await api.request('/v1/catalog', {});
    assert.equal(response.status, 409);
    assert.equal((await response.json()).success, false);
  }
});

test('database failures never return a successful acknowledgement', async () => {
  for (const options of [{ bookingWriteError: true }, { eventWriteError: true }, { eventReadError: true }]) {
    const api = gateway(options);
    const response = await api.request('/v1/reservations/1/ack', { accepted: true,reservation_updated_at:'2026-09-19T10:00:00.123456+00:00',reservation_status:'confirmed' });
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
  const bookings = [1,2,3].map(booking_id => ({ booking_id, hotel_id:7, room_id: 10, updated_at: '2026-09-19T10:00:00.123456+00:00', payment_status: 'paid', status: 'confirmed' }));
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

test('PMS acknowledgement requires an exact delivered version and refuses stale confirmation after cancellation',async()=>{
 const api=gateway({bookings:[{booking_id:1,hotel_id:7,room_id:10,status:'cancelled',payment_status:'paid',updated_at:'2026-10-23T01:00:00Z'}]});
 assert.equal((await api.request('/v1/reservations/1/ack',{accepted:true})).status,400);
 assert.equal(api.writes.length,0);
 const stale=await api.request('/v1/reservations/1/ack',{accepted:true,reservation_status:'confirmed',reservation_updated_at:'2026-10-22T10:00:00Z'},'stale-version');
 assert.equal(stale.status,409);assert.equal(api.writes.filter(row=>row.table==='hotel_bookings').length,0);
 const current=await api.request('/v1/reservations/1/ack',{accepted:true,reservation_status:'cancelled',reservation_updated_at:'2026-10-23T01:00:00Z'},'current-version');
 assert.equal(current.status,200);assert.equal((await current.json()).reservation_status,'cancelled');
});

test('PMS request budgets fail closed and return retry guidance without domain writes',async()=>{
 for(const options of [{rateLimited:true},{limiterError:true}]){
  const api=gateway(options);const response=await api.request('/v1/catalog',{});
  assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);assert.equal(api.writes.length,0);
 }
});
test('PMS JSON and catalog batches are bounded before event creation or domain writes',async()=>{
 for(const [body,status] of [[{rooms:Array.from({length:201},(_,i)=>({external_reference:'room-'+i}))},400],[{notes:'x'.repeat(262145)},413],[[],400],['not an object',400]]){
  const api=gateway();const response=await api.request('/v1/catalog',body);assert.equal(response.status,status);assert.equal(api.writes.length,0);
 }
});

test('atomic PMS catalog returns verified counts and replays a lost committed receipt without applying twice',async()=>{
 const api=gateway({catalogLost:true});const body={rooms:[],rates:[],inventory:[]};
 assert.equal((await api.request('/v1/catalog',body)).status,500);
 assert.equal(api.events.get('request-1').status,'acknowledged');
 const replay=await api.request('/v1/catalog',body);assert.equal(replay.status,200);assert.equal((await replay.json()).idempotent,true);
 assert.equal(api.writes.filter(row=>row.table==='catalog').length,1);
});
test('atomic PMS acknowledgement survives a lost committed response without being marked failed',async()=>{
 const api=gateway({ackLost:true});const body={accepted:true,reservation_status:'confirmed',reservation_updated_at:'2026-09-19T10:00:00.123456+00:00'};
 assert.equal((await api.request('/v1/reservations/1/ack',body)).status,500);assert.equal(api.events.get('request-1').status,'acknowledged');
 assert.equal((await api.request('/v1/reservations/1/ack',body)).status,200);assert.equal(api.writes.filter(row=>row.table==='hotel_bookings').length,1);
});
test('atomic PMS room status refuses an occupied unit, including cleaning, without a physical-unit write',async()=>{
 const api=gateway({occupiedUnit:true});const response=await api.request('/v1/room-status',{room_external_reference:'room-1',unit_label:'101',status:'cleaning'});
 assert.equal(response.status,200);assert.equal((await response.json()).review_required,true);assert.equal(api.writes.filter(row=>row.table==='hotel_room_units').length,0);
});
