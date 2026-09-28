import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// This benchmark is deliberately confined to a disposable local Supabase stack.
// It simulates public catalog navigation; it does not create users or bookings.
const status = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.114.0', 'status', '-o', 'json'], { encoding: 'utf8' }));
const origin = new URL(status.API_URL || status.api_url);
assert.equal(origin.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Refuse hosted or production targets');
const key = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
assert.ok(key);
const counts = execFileSync('docker', ['exec', 'supabase_db_wehouse', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
  "select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.hotels where hotel_id between -5000000 and -1000001)"], { encoding: 'utf8' }).trim();
assert.equal(counts, '50000|100000', 'Require the exact medium catalog fixture');

const journeys = [
  { name: 'home_feed', weight: 25, rpc: 'search_discoverable_homes', body: () => ({ p_limit: 24 }), valid: d => d?.items?.length === 24 },
  { name: 'hotel_feed', weight: 20, rpc: 'search_discoverable_hotels', body: () => ({ p_limit: 24 }), valid: d => d?.items?.length === 24 },
  { name: 'home_city', weight: 10, rpc: 'search_discoverable_homes', body: () => ({ p_city: 'Lafia', p_limit: 24 }), valid: d => d?.items?.length === 24 && d.items.every(x => x.city === 'Lafia') },
  { name: 'hotel_city', weight: 10, rpc: 'search_discoverable_hotels', body: () => ({ p_city: 'Lafia', p_limit: 24 }), valid: d => d?.items?.length === 24 && d.items.every(x => x.city === 'Lafia') },
  { name: 'hotel_price', weight: 5, rpc: 'search_discoverable_hotels', body: () => ({ p_min_price: 22000, p_max_price: 24000, p_limit: 24 }), valid: d => d?.items?.length === 24 },
  { name: 'home_detail', weight: 15, rpc: 'get_public_listing_detail', body: i => ({ p_listing_id: `load-home-scale-${1 + i % 50000}` }), valid: d => typeof d?.listing_id === 'string' },
  { name: 'hotel_detail', weight: 15, rpc: 'get_public_hotel_detail', body: i => ({ p_hotel_id: -1000001 - i % 100000 }), valid: d => Number.isInteger(d?.hotel_id) },
];
assert.equal(journeys.reduce((n, j) => n + j.weight, 0), 100);

const pick = n => {
  let point = (n * 37) % 100; // deterministic spread, including repeated popular feeds
  for (const j of journeys) { point -= j.weight; if (point < 0) return j; }
  throw new Error('Invalid journey mix');
};
const percentile = (values, fraction) => values.length ? Math.round(values[Math.ceil(values.length * fraction) - 1] * 10) / 10 : null;
async function request(journey, i) {
  const started = performance.now();
  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${journey.rpc}`, origin), {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(journey.body(i)), signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    const data = response.ok ? JSON.parse(body) : null;
    return { name: journey.name, ms: performance.now() - started, ok: response.ok && journey.valid(data), status: response.status };
  } catch (error) {
    return { name: journey.name, ms: performance.now() - started, ok: false, status: `${error.name}:${error.cause?.code || error.message}` };
  }
}
async function stage(rate, seconds, offset) {
  const total = rate * seconds;
  const results = new Array(total);
  const inFlight = new Set();
  let dropped = 0;
  const start = performance.now();
  for (let i = 0; i < total; i++) {
    const scheduled = start + i * 1000 / rate;
    const delay = scheduled - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    if (inFlight.size >= 100) { dropped++; continue; }
    const journey = pick(offset + i);
    const task = request(journey, offset + i).then(result => { results[i] = result; });
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  }
  await Promise.all(inFlight);
  const finished = performance.now();
  const completed = results.filter(Boolean);
  const successes = completed.filter(r => r.ok);
  const failures = completed.filter(r => !r.ok);
  const byJourney = Object.fromEntries(journeys.map(j => {
    const sample = completed.filter(r => r.name === j.name);
    const good = sample.filter(r => r.ok).map(r => r.ms).sort((a, b) => a - b);
    return [j.name, { requests: sample.length, errors: sample.length - good.length,
      p50_ms: percentile(good, .5), p95_ms: percentile(good, .95), p99_ms: percentile(good, .99) }];
  }));
  return { target_rps: rate, hold_seconds: seconds, offered: total, completed: completed.length,
    successes: successes.length, errors: failures.length, dropped, elapsed_seconds: Math.round((finished - start) / 10) / 100,
    achieved_rps: Math.round(completed.length * 1000 / (finished - start) * 10) / 10,
    error_counts: Object.fromEntries([...new Set(failures.map(r => String(r.status)))].map(code => [code, failures.filter(r => String(r.status) === code).length])),
    by_journey: byJourney };
}

const report = { environment: 'disposable local Supabase', catalog: { homes: 50000, hotels: 100000 },
  workload: 'Open-loop deterministic mix of seven anonymous catalog reads. No authentication, booking, payment, messages, media/CDN, or hosted Supabase.',
  stages: [] };
let offset = 0;
for (const [rate, seconds] of [[2, 30], [5, 60], [10, 120]]) {
  const result = await stage(rate, seconds, offset);
  offset += rate * seconds;
  report.stages.push(result);
  console.log(`mixed offered=${result.offered} target=${rate}rps done=${result.completed} errors=${result.errors} dropped=${result.dropped} achieved=${result.achieved_rps}rps`);
}
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/catalog-mixed.json', JSON.stringify(report, null, 2) + '\n');
if (report.stages.some(s => s.errors || s.dropped || s.completed !== s.offered)) process.exitCode = 1;
