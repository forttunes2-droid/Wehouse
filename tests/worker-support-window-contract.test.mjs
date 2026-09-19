import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Worker Message WeHouse stays open through 72 hours after final release", async () => {
  const migration = await read(
    "supabase/migrations/20260914084537_worker_support_window_and_auth_grants.sql",
  );
  assert.match(migration, /72 hours from released_at/i);
  assert.match(migration, /released_at\+interval '72 hours'/);
  assert.match(migration, /v_payment_released_at\+interval '72 hours'/);
  assert.doesNotMatch(migration, /interval '24 hours'/);
  assert.match(
    migration,
    /review_required[\s\S]*disputed[\s\S]*risk_held[\s\S]*frozen[\s\S]*then true/,
  );
  assert.match(
    migration,
    /lower\(coalesce\(v_protection_status,''\)\)='released'[\s\S]*now\(\)<v_job_support_until/,
  );
});