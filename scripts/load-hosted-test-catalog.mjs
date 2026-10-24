import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { assessCatalogStage, catalogWarmupComplete, CATALOG_CAPACITY_LIMITS } from './lib/catalog-capacity-gates.mjs';
import { createCatalogTransport } from './lib/catalog-transport.mjs';

// Explicit allowlist: this cannot be pointed at the live WeHouse project.
const origin = new URL('https://qoobnkedfyosnizrlttt.supabase.co');
const key = process.env.WEHOUSE_TEST_PUBLISHABLE_KEY;
assert.ok(key?.startsWith('sb_publishable_'), 'Test project publishable key required');
assert.equal(origin.hostname, 'qoobnkedfyosnizrlttt.supabase.co');
const transport = createCatalogTransport(origin);
process.once('exit', () => transport.close());
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
      const response = await transport.post(`/rest/v1/rpc/${path.rpc}`,
        { apikey: key, authorization: `Bearer ${key}` }, path.body);
      const body = response.body;
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
      const code = error.cause?.code || error.code;
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
  scope: 'Anonymous public discovery reads only on the dedicated Test project. No auth, booking, payment, messaging, Realtime, media, or Vercel CDN. Thirty-second stages are a catalog smoke benchmark, not sustained whole-product capacity. Staged offered rates: 1, 5, 10, 25, 50, 100 and 200 requests/second; fixed ceiling of 3000 logical requests in flight, each allowing up to three 15-second attempts.',
  measured_at: new Date().toISOString(),
  transport: { protocol: 'https', keep_alive: true, max_sockets: transport.maxSockets, attempt_deadline_ms: 15000, queued_time_in_deadline: true },
  status: 'running',
  passed: false,
  reviewed_sha: process.env.GITHUB_SHA || null,
  gates: CATALOG_CAPACITY_LIMITS,
  warmup: { max_seconds: 180, attempts: 0, failures: [], successful_paths: [] },
  stages: [] };
function saveReport() {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/hosted-test-catalog.json', JSON.stringify(result, null, 2) + '\n');
}
saveReport();

// Hosted Test projects can resume from idle. Do not mix cold-start/resume
// failures into the measured 1 RPS baseline. First require every read contract
// to return valid data, retaining the warm-up evidence and bounding startup wait.
const warmupDeadline = performance.now() + 180_000;
for (const path of paths) {
  let lastFailure = { path: path.name, status: 'warmup-deadline-before-validation', retries: 0 };
  while (performance.now() < warmupDeadline) {
    result.warmup.attempts++;
    const sample = await read(path);
    if (sample.ok) {
      result.warmup.successful_paths.push(path.name);
      lastFailure = null;
      break;
    }
    lastFailure = { path: path.name, status: sample.status, retries: sample.retries };
    result.warmup.failures.push(lastFailure);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (lastFailure) {
    result.warmup.elapsed_ms = Math.round(180_000 - Math.max(0, warmupDeadline - performance.now()));
    result.status = 'warmup_failed';
    result.passed = false;
    saveReport();
    console.error('Hosted Test project did not become ready during bounded warm-up', lastFailure);
    process.exit(1);
  }
}
result.warmup.elapsed_ms = Math.round(180_000 - Math.max(0, warmupDeadline - performance.now()));
assert.ok(catalogWarmupComplete(result.warmup.successful_paths, paths.map(path => path.name)), 'Every catalog contract must pass warm-up');
console.log(`Hosted Test warm-up ready: ${result.warmup.successful_paths.length}/${paths.length} read contracts validated in ${result.warmup.elapsed_ms}ms (${result.warmup.attempts} attempts)`);
await new Promise(resolve => setTimeout(resolve, 5000));
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
    // with service saturation. Errors, latency, retries and dispatch timing are gated below.
    if (running.size >= 3000) { dropped++; continue; }
    const task = read(paths[serial++ % paths.length]).then(sample => samples.push(sample));
    running.add(task); max_inflight = Math.max(max_inflight, running.size); void task.finally(() => running.delete(task));
  }
  const dispatchSeconds = (performance.now() - started) / 1000 + 1 / rps;
  await Promise.all(running);
  const elapsed = (performance.now() - started) / 1000;
  const good = samples.filter(s => s.ok).map(s => s.ms).sort((a, b) => a - b);
  const errors = samples.filter(s => !s.ok);
  const retriedRequests = samples.filter(s => s.retries > 0).length;
  const retryAttempts = samples.reduce((sum, s) => sum + s.retries, 0);
  const retried = samples.filter(s => s.retries > 0);
  const stage = { target_rps: rps, seconds, dispatch_seconds: dispatchSeconds, max_inflight, offered: rps * seconds, completed: samples.length, errors: errors.length, dropped,
    retried_requests: retriedRequests, retry_attempts: retryAttempts,
    retry_rate_pct: samples.length ? Math.round(retriedRequests / samples.length * 100000) / 1000 : 0,
    retry_statuses: Object.fromEntries([...new Set(retried.map(s => String(s.retry_status)))].map(code => [code, retried.filter(s => String(s.retry_status) === code).length])),
    p50_ms: pct(good, .5), p95_ms: pct(good, .95), p99_ms: pct(good, .99), achieved_rps: Math.round(samples.length / elapsed * 10) / 10,
    errors_by_status: Object.fromEntries([...new Set(errors.map(s => String(s.status)))].map(code => [code, errors.filter(s => String(s.status) === code).length])),
    by_path: Object.fromEntries(paths.map(path => { const sample = samples.filter(s => s.name === path.name);
      const goodPath = sample.filter(s => s.ok).map(s => s.ms).sort((a, b) => a - b);
      return [path.name, { requests: sample.length, errors: sample.length - goodPath.length, p95_ms: pct(goodPath, .95) }]; })) };
  stage.assessment = assessCatalogStage(stage, paths.map(path => path.name));
  result.stages.push(stage);
  saveReport();
  console.log(`hosted Test target=${rps}rps in_flight=${stage.max_inflight} completed=${stage.completed}/${stage.offered} errors=${stage.errors} retries=${stage.retry_attempts} dropped=${dropped} p95=${stage.p95_ms}ms`);
  if (!stage.assessment.passed) {
    console.error('Stopping the ramp after a failed stage:', stage.assessment.failures);
    break;
  }
}
result.passed = result.stages.length === 7 && result.stages.every(stage => stage.assessment.passed);
result.status = result.passed ? 'passed' : 'failed';
result.finished_at = new Date().toISOString();
saveReport();
if (!result.passed) process.exitCode = 1;
