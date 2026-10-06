import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const origin = new URL(process.env.WEHOUSE_TEST_SUPABASE_URL || "https://qoobnkedfyosnizrlttt.supabase.co");
const key = process.env.WEHOUSE_TEST_PUBLISHABLE_KEY;
assert.ok(key?.startsWith("sb_publishable_"), "WeHouse Test publishable key required");
assert.equal(origin.hostname, "qoobnkedfyosnizrlttt.supabase.co", "This harness is allowlisted to the dedicated Test project");

const USERS = Number(process.env.ROOMMATE_USERS || 1_000_000);
const CONCURRENCY = Number(process.env.ROOMMATE_CONCURRENCY || 10_000);
const REQUEST_TIMEOUT_MS = Number(process.env.ROOMMATE_TIMEOUT_MS || 10_000);
const RUN_REFRESH = process.env.ROOMMATE_RUN_REFRESH === "1";

assert.ok(Number.isSafeInteger(USERS) && USERS > 0 && USERS <= 1_000_000);
assert.ok(Number.isSafeInteger(CONCURRENCY) && CONCURRENCY > 0 && CONCURRENCY <= 50_000);

async function rpc(name, body, token = key) {
  const started = performance.now();
  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, origin), {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      ms: performance.now() - started,
      bytes: text.length,
    };
  } catch (error) {
    return {
      ok: false,
      status: `${error?.name || "Error"}:${error?.cause?.code || error?.message || "unknown"}`,
      ms: performance.now() - started,
      bytes: 0,
    };
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

async function runBurst(name, fn, total, concurrency) {
  const samples = [];
  let next = 0;
  let failures = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const result = await fn(i);
      samples.push(result);
      if (!result.ok) failures++;
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const elapsed = (performance.now() - started) / 1000;
  const latencies = samples.filter(x => x.ok).map(x => x.ms);

  return {
    name,
    offered: total,
    completed: samples.length,
    failures,
    achieved_rps: Math.round(samples.length / Math.max(elapsed, 0.001) * 10) / 10,
    p50_ms: percentile(latencies, 0.50),
    p95_ms: percentile(latencies, 0.95),
    p99_ms: percentile(latencies, 0.99),
    max_ms: latencies.length ? Math.max(...latencies) : null,
  };
}

/*
 * This first workload intentionally uses the existing persisted-match page.
 * It proves read-path capacity without silently turning the test into a
 * synthetic in-memory algorithm benchmark.
 *
 * A real authenticated million-user run requires disposable Auth identities
 * and session tokens. Those are provisioned by the capacity environment, not
 * manufactured in this client with a service key.
 */
const result = {
  project: origin.hostname,
  users_target: USERS,
  concurrent_requests_target: CONCURRENCY,
  refresh_enabled: RUN_REFRESH,
  warning: RUN_REFRESH
    ? "REFRESH MODE executes the real refresh_my_roommate_search RPC and is expected to expose its current candidate-scan cost. Do not point this at production."
    : "PAGE MODE measures the bounded persisted-match read path only.",
  stages: [],
};

if (RUN_REFRESH) {
  console.error("Refresh mode requires authenticated disposable actors; this script deliberately refuses to impersonate them with a publishable key.");
  console.error("Provision actors through the isolated capacity environment before setting ROOMMATE_RUN_REFRESH=1.");
  process.exitCode = 2;
} else {
  for (const [total, concurrency] of [
    [10_000, Math.min(CONCURRENCY, 1_000)],
    [100_000, Math.min(CONCURRENCY, 5_000)],
    [USERS, CONCURRENCY],
  ]) {
    result.stages.push(await runBurst(
      `roommate_matches_page_${total}`,
      i => rpc("get_my_roommate_matches_page_v2", {
        p_limit: 24,
        p_offset: (i % 5) * 24,
      }),
      total,
      concurrency,
    ));
  }
}

console.log(JSON.stringify(result, null, 2));
