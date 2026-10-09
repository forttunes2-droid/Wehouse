import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Agent, request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";

const status = JSON.parse(execFileSync("npx", ["--yes", "supabase@2.114.0", "status", "-o", "json"], { encoding: "utf8" }));
const origin = new URL(status.API_URL || status.api_url);
assert.equal(origin.protocol, "http:");
assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname), "Large capacity test is disposable-local only");
const anon = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
const jwtSecret = status.JWT_SECRET || status.jwt_secret;
assert.ok(anon && jwtSecret, "Local Supabase JWT secret is required");
assert.equal(process.env.WEHOUSE_CAPACITY_PRESET, "large", "Run only with WEHOUSE_CAPACITY_PRESET=large");

const PROFILE_COUNT = 6_000_000;
const LISTING_COUNT = 7_000_000;
const BOOKING_ATTEMPTS = Number(process.env.WEHOUSE_BOOKING_ATTEMPTS || 700_000);
const ROOMMATE_ACTORS = Number(process.env.WEHOUSE_ROOMMATE_ACTORS || 1_000_000);
const CONCURRENCY = Number(process.env.WEHOUSE_LARGE_CONCURRENCY || 10_000);
assert.ok(Number.isSafeInteger(CONCURRENCY) && CONCURRENCY >= 1 && CONCURRENCY <= 25_000,
  "WEHOUSE_LARGE_CONCURRENCY must be an integer between 1 and 25,000");
const agent = new Agent({ keepAlive: true, maxSockets: CONCURRENCY, maxFreeSockets: Math.min(500, CONCURRENCY) });

function actorUuid(i) {
  return "00000000-0000-4000-8000-" + i.toString(16).padStart(12, "0");
}
function jwtFor(i) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: actorUuid(i), role: "authenticated", aud: "authenticated",
    iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const input = header + "." + payload;
  return input + "." + createHmac("sha256", jwtSecret).update(input).digest("base64url");
}
function rpc(token, name, body, timeout = 30_000) {
  const payload = JSON.stringify(body);
  const began = performance.now();
  return new Promise((resolve) => {
    let socketAt = null;
    const req = httpRequest(new URL("/rest/v1/rpc/" + name, origin), {
      method: "POST", agent,
      headers: { apikey: anon, authorization: "Bearer " + token, "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let data = null;
        try { data = JSON.parse(text); } catch {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          ms: performance.now() - began,
          queue_ms: socketAt == null ? 0 : socketAt - began,
          data,
          error: data?.message || data?.error || text.slice(0, 160),
        });
      });
    });
    req.on("socket", () => { socketAt ??= performance.now(); });
    req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
    req.on("error", error => resolve({ ok: false, status: "transport", ms: performance.now() - began, queue_ms: 0, data: null, error: error.message }));
    req.end(payload);
  });
}
function future(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 10) / 10;
}
async function burst(total, worker, label) {
  let cursor = 0;
  const samples = [];
  const errors = new Map();
  const began = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      const result = await worker(i);
      samples.push(result);
      if (!result.ok) errors.set(String(result.error), (errors.get(String(result.error)) || 0) + 1);
    }
  }));
  const elapsed = (performance.now() - began) / 1000;
  const ok = samples.filter(x => x.ok);
  return {
    label, attempts: total, successes: ok.length, errors: samples.length - ok.length,
    error_examples: [...errors.entries()].sort((a,b) => b[1]-a[1]).slice(0, 12),
    p50_ms: percentile(ok.map(x=>x.ms), .5), p95_ms: percentile(ok.map(x=>x.ms), .95),
    p99_ms: percentile(ok.map(x=>x.ms), .99), requests_per_second: Math.round(total / elapsed * 10) / 10,
    elapsed_seconds: Math.round(elapsed * 100) / 100,
  };
}
function db(query) {
  return execFileSync("docker", ["exec", "supabase_db_wehouse", "psql", "-U", "postgres", "-d", "postgres", "-Atc", query], { encoding: "utf8" }).trim();
}
const report = {
  source: "disposable local Supabase; signed synthetic JWTs; no hosted/prod traffic",
  target: { profiles: PROFILE_COUNT, listings: LISTING_COUNT, booking_attempts: BOOKING_ATTEMPTS, roommate_search_actors: ROOMMATE_ACTORS },
  concurrency: CONCURRENCY, started_at: new Date().toISOString(), stages: [],
};
mkdirSync("test-results", { recursive: true });
const save = () => writeFileSync("test-results/large-capacity.json", JSON.stringify(report, null, 2) + "\n");

try {
  const counts = db("select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.profiles where user_id like 'load-user-%'),(select count(*) from public.roommate_preferences where user_id like 'load-user-%')");
  assert.equal(counts, PROFILE_COUNT === 6_000_000 ? "7000000|6000000|1000000" : counts, "Millions-scale fixture cardinality is incomplete");
  report.fixture = counts;

  report.stages.push(await burst(BOOKING_ATTEMPTS, async (i) => {
    const actor = jwtFor((i % 700_000) + 1);
    const hotel = 1 + (i % 50);
    const day = 2 + Math.floor(i / 50) % 10;
    const checkIn = future(day), checkOut = future(day + 1);
    const quote = await rpc(actor, "quote_hotel_room_rate", {
      p_hotel_id: -1_000_000 - hotel, p_room_id: -10_000_000 - hotel,
      p_rate_plan_id: -3_000_000 - hotel, p_check_in: checkIn, p_check_out: checkOut,
    });
    if (!quote.ok) return quote;
    if (quote.data?.available !== true) {
      return { ...quote, ok: true, classification: "inventory-unavailable" };
    }
    const booked = await rpc(actor, "create_my_hotel_booking_with_rate", {
      p_hotel_id: -1_000_000 - hotel, p_room_id: -10_000_000 - hotel,
      p_rate_plan_id: -3_000_000 - hotel, p_check_in: checkIn, p_check_out: checkOut,
      p_guest_count: 1, p_guest_name: "Synthetic Guest", p_guest_phone: "08000000000", p_special_requests: null,
    });
    if (booked.ok && (!booked.data?.booking_id || booked.data?.user_id !== "load-user-" + ((i % 700_000) + 1))) {
      return { ...booked, ok: false, error: "booking-owner-or-id-invariant-failed" };
    }
    return booked;
  }, "700k booking burst"));
  save();

  report.stages.push(await burst(ROOMMATE_ACTORS, async (i) => {
    const result = await rpc(jwtFor(i + 1), "refresh_my_roommate_search", {});
    return result;
  }, "1m roommate-search burst"));
  save();

  const invariant = db(`select
    (select count(*) from public.hotel_bookings where hotel_id between -1000050 and -1000001),
    (select count(distinct booking_id) from public.hotel_bookings where hotel_id between -1000050 and -1000001),
    (select coalesce(max(c),0) from (
      select count(*) c from public.hotel_room_units u
      join public.hotel_bookings b on b.hotel_id=u.hotel_id and b.room_id=u.room_id
      where b.hotel_id between -1000050 and -1000001 and b.status in ('pending','confirmed','checked_in')
      group by b.hotel_id,b.room_id,b.check_in,b.check_out
    ) x),
    (select count(*) from public.roommate_preferences where user_id like 'load-user-%' and active and search_status='active')`);
  report.invariants = invariant.split("|").map(Number);
  report.finished_at = new Date().toISOString();
  report.passed = report.stages.every(s => s.errors === 0) && report.invariants[0] === report.invariants[1] && report.invariants[2] <= 10 && report.invariants[3] >= ROOMMATE_ACTORS;
  save();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.fatal_error = String(error?.message || error);
  report.passed = false;
  report.finished_at = new Date().toISOString();
  save();
  console.error(report.fatal_error);
  process.exitCode = 1;
} finally {
  agent.destroy();
}
