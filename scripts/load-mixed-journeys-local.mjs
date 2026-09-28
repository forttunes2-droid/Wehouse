import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';

// Never accept a hosted URL or a caller-supplied target. This is disposable CI only.
const status = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.114.0', 'status', '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
const origin = new URL(status.API_URL || status.api_url);
assert.equal(origin.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Refusing hosted load target');
const publicKey = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
const serviceKey = status.SERVICE_ROLE_KEY || status.service_role_key;
assert.ok(publicKey && serviceKey, 'Local Supabase keys are required');
const admin = createClient(origin.href, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const makeClient = () => createClient(origin.href, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
const today = new Date();
const future = offset => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10);
const percentile = (values, fraction) => values.length ? Math.round(values[Math.ceil(values.length * fraction) - 1] * 10) / 10 : null;
const actors = [];
const suffix = randomBytes(6).toString('hex');

async function booking(actor, sequence, stayOffset = 30 + Math.floor(sequence / 100) % 10) {
  const hotel = 1 + sequence % 50;
  const room = 1 + Math.floor(sequence / 50) % 2;
  const hotelId = -1000000 - hotel;
  const roomId = -2000000 - hotel * 10 - room;
  const planId = -3000000 - hotel * 10 - room;
  const checkIn = future(stayOffset);
  const checkOut = future(stayOffset + 1);
  const quote = await actor.client.rpc('quote_hotel_room_rate', {
    p_hotel_id: hotelId, p_room_id: roomId, p_rate_plan_id: planId,
    p_check_in: checkIn, p_check_out: checkOut,
  });
  if (quote.error || quote.data?.available !== true) throw new Error(`quote: ${quote.error?.message || 'not available'}`);
  const result = await actor.client.rpc('create_my_hotel_booking_with_rate', {
    p_hotel_id: hotelId, p_room_id: roomId, p_rate_plan_id: planId,
    p_check_in: checkIn, p_check_out: checkOut, p_guest_count: 1,
    p_guest_name: 'Synthetic Guest', p_guest_phone: '08000000000', p_special_requests: null,
  });
  if (result.error || result.data?.user_id !== actor.userId || !result.data?.booking_id)
    throw new Error(`booking: ${result.error?.message || 'wrong owner or missing booking'}`);
  return result.data.booking_id;
}

for (let i = 0; i < 10; i++) {
  const email = `capacity-${suffix}-${i}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Synthetic Auth creation failed: ${created.error?.message}`);
  const client = makeClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || signed.data.user?.id !== created.data.user.id) throw new Error(`Synthetic login failed: ${signed.error?.message}`);
  const profile = await client.rpc('create_my_profile', { p_email: email, p_role: 'user' });
  if (profile.error || !profile.data?.user_id) throw new Error(`Synthetic profile failed: ${profile.error?.message}`);
  const actor = { client, email, password, authId: created.data.user.id, userId: profile.data.user_id };
  actor.bookingId = await booking(actor, 20000 + i);
  const conversation = await client.rpc('create_support_conversation', {
    p_subject: 'Synthetic capacity conversation', p_category: 'general',
    p_context_type: 'general', p_context_id: null, p_context_snapshot: {}, p_priority: 'normal',
  });
  if (conversation.error || !conversation.data) throw new Error(`Synthetic conversation failed: ${conversation.error?.message}`);
  actor.conversationId = conversation.data;
  actors.push(actor);
}

const journeys = [
  { name: 'browse', weight: 50, run: async (actor, i) => {
    const hotel = i % 2 === 0;
    const result = await actor.client.rpc(hotel ? 'search_discoverable_hotels' : 'search_discoverable_homes', { p_limit: 24 });
    if (result.error || !result.data?.items?.length) throw new Error(result.error?.message || 'empty discovery');
  } },
  { name: 'login', weight: 10, run: async actor => {
    const fresh = makeClient();
    const result = await fresh.auth.signInWithPassword({ email: actor.email, password: actor.password });
    if (result.error || result.data.user?.id !== actor.authId) throw new Error(result.error?.message || 'wrong login identity');
  } },
  { name: 'session', weight: 5, run: async actor => {
    const result = await actor.client.auth.getUser();
    if (result.error || result.data.user?.id !== actor.authId) throw new Error(result.error?.message || 'wrong session');
  } },
  { name: 'booking', weight: 15, run: async (actor, i) => { await booking(actor, i); } },
  { name: 'message', weight: 10, run: async (actor, i) => {
    const result = await actor.client.rpc('send_support_message', {
      p_conversation_id: actor.conversationId, p_content: `Synthetic message ${i}`,
      p_attachments: [], p_attachment_types: [], p_action_type: null, p_action_metadata: {}, p_visibility: 'customer',
    });
    if (result.error || !result.data) throw new Error(result.error?.message || 'message not stored');
  } },
  { name: 'payment_bootstrap', weight: 5, run: async actor => {
    const result = await actor.client.rpc('create_hotel_booking_payment', { p_booking_id: actor.bookingId });
    if (result.error || !result.data?.success || !result.data?.reference) throw new Error(result.error?.message || 'missing payment reference');
  } },
  { name: 'booking_read', weight: 5, run: async actor => {
    const result = await actor.client.rpc('get_my_hotel_bookings');
    if (result.error || !Array.isArray(result.data) || !result.data.some(row => row.booking_id === actor.bookingId))
      throw new Error(result.error?.message || 'own booking missing');
    if (result.data.some(row => row.user_id && row.user_id !== actor.userId)) throw new Error('cross-account booking visible');
  } },
];
assert.equal(journeys.reduce((sum, journey) => sum + journey.weight, 0), 100);
function select(index) {
  let point = (index * 37) % 100;
  for (const journey of journeys) { point -= journey.weight; if (point < 0) return journey; }
  throw new Error('Invalid mix');
}

async function stage(rate, seconds, offset) {
  const samples = [];
  const running = new Set();
  let dropped = 0;
  const started = performance.now();
  for (let i = 0; i < rate * seconds; i++) {
    const delay = started + i * 1000 / rate - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    if (running.size >= 40) { dropped++; continue; }
    const index = offset + i;
    const journey = select(index);
    const actor = actors[index % actors.length];
    const task = (async () => {
      const began = performance.now();
      try { await journey.run(actor, index); samples.push({ name: journey.name, ms: performance.now() - began, ok: true }); }
      catch (error) { samples.push({ name: journey.name, ms: performance.now() - began, ok: false, error: String(error.message || error).slice(0, 180) }); }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
  }
  await Promise.all(running);
  const duration = (performance.now() - started) / 1000;
  return { target_rps: rate, seconds, offered: rate * seconds, completed: samples.length, dropped,
    achieved_rps: Math.round(samples.length / duration * 10) / 10,
    failures: samples.filter(sample => !sample.ok).length,
    by_journey: Object.fromEntries(journeys.map(journey => {
      const entries = samples.filter(sample => sample.name === journey.name);
      const latencies = entries.filter(sample => sample.ok).map(sample => sample.ms).sort((a, b) => a - b);
      return [journey.name, { attempts: entries.length, failures: entries.length - latencies.length,
        p50_ms: percentile(latencies, .5), p95_ms: percentile(latencies, .95), p99_ms: percentile(latencies, .99),
        error_examples: [...new Set(entries.filter(sample => !sample.ok).map(sample => sample.error))].slice(0, 3) }];
    })) };
}

const report = { scope: 'Disposable local Supabase; 10 synthetic Auth users; HTTP RPCs; no Vercel, media, Realtime sockets or Paystack callback',
  warning: 'Payment bootstrap creates a pending reference. No provider sandbox charge or verified webhook is exercised.',
  mix: Object.fromEntries(journeys.map(journey => [journey.name, journey.weight])), stages: [] };
for (const [rate, seconds] of [[5, 30], [10, 30]]) {
  const result = await stage(rate, seconds, report.stages.reduce((sum, item) => sum + item.offered, 0));
  report.stages.push(result);
  console.log(`mixed local target=${rate}/s completed=${result.completed}/${result.offered} dropped=${result.dropped} failures=${result.failures}`);
}
// Twenty buyers contend for the same ten physical units on one future night.
// A denied inventory request is expected here; any other error fails the check.
const contention = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => booking(actors[i % actors.length], 0, 400)));
const denials = contention.filter(row => row.status === 'rejected').map(row => String(row.reason?.message || row.reason));
report.contention = { attempts: 20, capacity: 10,
  accepted: contention.length - denials.length, inventory_denied: denials.filter(reason => /unavailable|not available/i.test(reason)).length,
  unexpected_errors: denials.filter(reason => !/unavailable|not available/i.test(reason)).slice(0, 3) };
const [{ data: bookings, error: bookingError }, { data: payments, error: paymentError }] = await Promise.all([
  admin.from('hotel_bookings').select('booking_id,room_id,check_in,check_out,status').lt('room_id', -2000000).gt('booking_id', 0),
  admin.from('booking_payments').select('paystack_reference,hotel_booking_id').eq('purpose', 'hotel_booking'),
]);
if (bookingError || paymentError) throw new Error(`Invariant read failed: ${bookingError?.message || paymentError?.message}`);
const occupied = new Map();
for (const row of bookings || []) {
  if (!['pending', 'confirmed', 'checked_in'].includes(row.status)) continue;
  const key = `${row.room_id}:${row.check_in}`;
  occupied.set(key, (occupied.get(key) || 0) + 1);
}
report.invariants = {
  unique_booking_ids: new Set((bookings || []).map(row => row.booking_id)).size === (bookings || []).length,
  within_room_capacity: [...occupied.values()].every(count => count <= 10),
  unique_payment_references: new Set((payments || []).map(row => row.paystack_reference)).size === (payments || []).length,
};
report.provisional_gate = report.stages.every(stage =>
  stage.dropped === 0 && stage.failures === 0 && stage.completed === stage.offered &&
  stage.achieved_rps >= stage.target_rps * .95 &&
  Object.entries(stage.by_journey).every(([name, row]) => row.attempts === 0 ||
    row.p95_ms < (name === 'browse' ? 2000 : 3000))) &&
  Object.values(report.invariants).every(Boolean) &&
  report.contention.accepted === 10 && report.contention.inventory_denied === 10 && report.contention.unexpected_errors.length === 0;
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/mixed-journeys-local.json', JSON.stringify(report, null, 2) + '\n');
if (!report.provisional_gate) process.exitCode = 1;
