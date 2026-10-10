import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Explicit allowlist: this cannot be pointed at the live WeHouse project.
const origin = new URL('https://qoobnkedfyosnizrlttt.supabase.co');
const key = process.env.WEHOUSE_TEST_PUBLISHABLE_KEY;
assert.ok(key?.startsWith('sb_publishable_'), 'Test project publishable key required');
assert.equal(origin.hostname, 'qoobnkedfyosnizrlttt.supabase.co');
const paths = [
  { name: 'home_feed', rpc: 'search_discoverable_homes', body: { p_limit: 24 }, validate: d => d?.items?.length === 24 },
  { name: 'hotel_feed', rpc: 'search_discoverable_hotels', body: { p_limit: 24 }, validate: d => d?.items?.length === 24 },
  { name: 'home_city', rpc: 'search_discoverable_homes', body: { p_city: 'Lafia', p_limit: 24 }, validate: d => d?.items?.length === 24 && d.items.every(x => x.city === 'Lafia') },
  { name: 'hotel_city', rpc: 'search_discoverable_hotels', body: { p_city: 'Lafia', p_limit: 24 }, validate: d => d?.items?.length === 24 && d.items.every(x => x.city === 'Lafia') },
  { name: 'hotel_price', rpc: 'search_discoverable_hotels', body: { p_min_price: 22000, p_max_price: 24000, p_limit: 24 }, validate: d => d?.items?.length === 24 && d.items.every(h => h.hotel_rooms?.some(r => Number(r.price_per_night) >= 22000 && Number(r.price_per_night) <= 24000)) },
  { name: 'home_detail', rpc: 'get_public_listing_detail', body: { p_listing_id: 'capacity-stage-home-1' }, validate: d => d?.listing_id === 'capacity-stage-home-1' },
  { name: 'hotel_detail', rpc: 'get_public_hotel_detail', body: { p_hotel_id: -2000001 }, validate: d => d?.hotel_id === -2000001 },
];
const pct = (values, part) => values.length ? Math.round(values[Math.ceil(values.length * part) - 1]) : null;
async function read(path) {
  const started = performance.now();
  let retries = 0;
  let retry_status = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(`/rest/v1/rpc/${path.rpc}`, origin), {
        method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(path.body), signal: AbortSignal.timeout(15000),
      });
      const body = await response.text();
      const data = response.ok ? JSON.parse(body) : null;
      if (response.ok && path.validate(data)) {
        return { name: path.name, ms: performance.now() - started, ok: true, status: response.status, retries, retry_status };
      }
      if ([502, 503, 504].includes(response.status) && attempt < 2) {
        retries++; retry_status = response.status;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      return { name: path.name, ms: performance.now() - started, ok: false, status: response.status, retries, retry_status };
    } catch (error) {
      const code = error.cause?.code;
      const retryable = ['AbortError', 'TimeoutError'].includes(error.name) || ['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code);
      if (retryable && attempt < 2) {
        retries++; retry_status = String(error.name) + ':' + String(code || error.message);
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      return { name: path.name, ms: performance.now() - started, ok: false, status: String(error.name) + ':' + String(code || error.message), retries, retry_status };
    }
  }
  return { name: path.name, ms: performance.now() - started, ok: false, status: 'retry-exhausted', retries, retry_status };
}
const result = { project: 'WeHouse Test (qoobnkedfyosnizrlttt)', fixture: '1000 synthetic homes + 1000 synthetic hotels/rooms',
  scope: 'Anonymous public discovery reads only on the dedicated Test project. No auth, booking, payment, messaging, Realtime, media, or Vercel CDN. Staged offered rates: 1, 5, 10, 25, 50, 100 and 200 requests/second; max 3000 in flight (200 RPS × the 15-second request timeout).',
  stages: [] };
let serial = 0;
for (const [rps, seconds] of [[1, 30], [5, 30], [10, 30], [25, 30], [50, 30], [100, 30], [200, 30]]) {
  const samples = [];
  const running = new Set();
  let max_inflight = 0;
  let dropped = 0;
  const started = performance.now();
  for (let i = 0; i < rps * seconds; i++) {
    const delay = started + i * 1000 / rps - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    // Size the ceiling to the offered rate and request timeout, rather than
    // dropping valid arrivals at 500 in-flight and confusing generator saturation
    // with service saturation. The run still fails on actual errors, drops, or >1% retries.
    if (running.size >= 3000) { dropped++; continue; }
    const task = read(paths[serial++ % paths.length]).then(sample => samples.push(sample));
    running.add(task); max_inflight = Math.max(max_inflight, running.size); void task.finally(() => running.delete(task));
  }
  await Promise.all(running);
  const elapsed = (performance.now() - started) / 1000;
  const good = samples.filter(s => s.ok).map(s => s.ms).sort((a, b) => a - b);
  const errors = samples.filter(s => !s.ok);
  const retriedRequests = samples.filter(s => s.retries > 0).length;
  const retryAttempts = samples.reduce((sum, s) => sum + s.retries, 0);
  const retried = samples.filter(s => s.retries > 0);
  const stage = { target_rps: rps, seconds, max_inflight, offered: rps * seconds, completed: samples.length, errors: errors.length, dropped,
    retried_requests: retriedRequests, retry_attempts: retryAttempts,
    retry_rate_pct: samples.length ? Math.round(retriedRequests / samples.length * 100000) / 1000 : 0,
    retry_statuses: Object.fromEntries([...new Set(retried.map(s => String(s.retry_status)))].map(code => [code, retried.filter(s => String(s.retry_status) === code).length])),
    p50_ms: pct(good, .5), p95_ms: pct(good, .95), p99_ms: pct(good, .99), achieved_rps: Math.round(samples.length / elapsed * 10) / 10,
    errors_by_status: Object.fromEntries([...new Set(errors.map(s => String(s.status)))].map(code => [code, errors.filter(s => String(s.status) === code).length])),
    by_path: Object.fromEntries(paths.map(path => { const sample = samples.filter(s => s.name === path.name);
      const goodPath = sample.filter(s => s.ok).map(s => s.ms).sort((a, b) => a - b);
      return [path.name, { requests: sample.length, errors: sample.length - goodPath.length, p95_ms: pct(goodPath, .95) }]; })) };
  result.stages.push(stage);
  console.log(`hosted Test target=${rps}rps in_flight=${stage.max_inflight} completed=${stage.completed}/${stage.offered} errors=${stage.errors} retries=${stage.retry_attempts} dropped=${dropped} p95=${stage.p95_ms}ms`);
}
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/hosted-test-catalog.json', JSON.stringify(result, null, 2) + '\n');
if (result.stages.some(s => s.errors || s.dropped || s.completed !== s.offered || s.retry_rate_pct > 1)) process.exitCode = 1;
