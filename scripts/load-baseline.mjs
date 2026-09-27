import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Read-only HTTP exercise of the real PostgREST RPCs on disposable local CI.
// No hosted URL, payment endpoint or mutation is accepted by this runner.
const status = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.114.0', 'status', '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
const origin = new URL(status.API_URL || status.api_url);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Local Supabase only');
assert.equal(origin.protocol, 'http:', 'Local Supabase only');
const key = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
assert.ok(key, 'Local public API key required');

const scenarios = [
  { name: 'homes_discovery', rpc: 'get_discoverable_listings', body: () => ({}), verify: (data) => Array.isArray(data) && data.length === 500 },
  { name: 'bounded_homes_discovery', rpc: 'search_discoverable_homes', body: () => ({ p_limit: 24 }), verify: (data) => data?.items?.length === 24 && data.has_more === true && Boolean(data.next_cursor_id) },
  { name: 'bounded_filtered_homes', rpc: 'search_discoverable_homes', body: () => ({ p_city: 'Lafia', p_stay_type: 'short_let', p_limit: 24 }), verify: (data) => data?.items?.length === 24 && data.items.every((item) => item.city === 'Lafia' && item.sub_type === 'short_let') },
  { name: 'hotels_discovery', rpc: 'get_discoverable_hotels', body: () => ({}), verify: (data) => Array.isArray(data) && data.length === 50 },
  { name: 'bounded_hotels_discovery', rpc: 'search_discoverable_hotels', body: () => ({ p_limit: 24 }), verify: (data) => data?.items?.length === 24 && data.has_more === true && Number.isInteger(data.next_cursor_id) },
  { name: 'bounded_filtered_hotels', rpc: 'search_discoverable_hotels', body: () => ({ p_city: 'Lafia', p_limit: 24 }), verify: (data) => data?.items?.length === 24 && data.items.every((item) => item.city === 'Lafia') },
  { name: 'one_home_detail', rpc: 'get_public_listing_detail', body: () => ({ p_listing_id: 'load-home-000001' }), verify: (data) => data?.listing_id === 'load-home-000001' },
  { name: 'spread_home_detail', rpc: 'get_public_listing_detail', body: (i) => ({ p_listing_id: `load-home-${String(1 + i % 500).padStart(6, '0')}` }), verify: (data) => typeof data?.listing_id === 'string' },
  { name: 'one_hotel_detail', rpc: 'get_public_hotel_detail', body: () => ({ p_hotel_id: -1000001 }), verify: (data) => data?.hotel_id === -1000001 },
  { name: 'spread_hotel_detail', rpc: 'get_public_hotel_detail', body: (i) => ({ p_hotel_id: -1000001 - i % 50 }), verify: (data) => Number.isInteger(data?.hotel_id) },
];

async function request(scenario, i) {
  const start = performance.now();
  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${scenario.rpc}`, origin), {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(scenario.body(i)),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    const data = response.ok ? JSON.parse(body) : null;
    return {
      ms: performance.now() - start, bytes: Buffer.byteLength(body),
      status: response.status, ok: response.ok && scenario.verify(data),
      error: response.ok ? (scenario.verify(data) ? null : 'unexpected response') : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { ms: performance.now() - start, bytes: 0, status: null, ok: false, error: error.name };
  }
}

const percentile = (sorted, p) => Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 10) / 10;

async function stage(scenario, concurrency, count) {
  let next = 0;
  const samples = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) {
      const i = next++;
      samples[i] = await request(scenario, i);
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  const sorted = samples.map((x) => x.ms).sort((a, b) => a - b);
  const errors = samples.filter((x) => !x.ok);
  return {
    scenario: scenario.name, concurrency, requests: count,
    successful: count - errors.length, errors: errors.length,
    error_examples: [...new Set(errors.map((x) => x.error))].slice(0, 3),
    p50_ms: percentile(sorted, 0.5), p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
    requests_per_second: Math.round(count / seconds * 10) / 10,
    response_megabytes: Math.round(samples.reduce((a, x) => a + x.bytes, 0) / 1048576 * 100) / 100,
  };
}

const output = {
  source: 'disposable local Supabase HTTP API, not hosted Test or Production',
  shape: 'closed-loop clients, 500 synthetic homes, 50 synthetic hotels with 2 rooms each; empty media',
  measured_at: new Date().toISOString(),
  stages: [],
};
let failed = false;
for (const { concurrency, count } of [
  { concurrency: 1, count: 20 }, { concurrency: 5, count: 50 }, { concurrency: 20, count: 100 },
]) {
  for (const scenario of scenarios) {
    const result = await stage(scenario, concurrency, count);
    output.stages.push(result);
    console.log(`${result.scenario} c=${concurrency} ok=${result.successful}/${count} p95=${result.p95_ms}ms p99=${result.p99_ms}ms rps=${result.requests_per_second}`);
    if (result.errors) failed = true;
  }
}
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/load-baseline.json', JSON.stringify(output, null, 2) + '\n');
if (failed) process.exitCode = 1;
