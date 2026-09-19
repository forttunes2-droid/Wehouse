import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Finance confirms Paystack NGN balance before claiming a withdrawal", async () => {
  const source = await read("supabase/functions/payout-withdrawal/index.ts");
  const approve = source.indexOf('if (action === "approve")');
  const balance = source.indexOf('paystack("/balance"', approve);
  const claim = source.indexOf('admin.rpc("claim_withdrawal_for_payout"', approve);
  const transfer = source.indexOf('paystack("/transfer"', approve);
  assert.ok(approve >= 0 && balance > approve && claim > balance && transfer > claim);
  assert.match(source.slice(approve, claim), /\.from\("withdrawals"\)/);
  assert.match(source.slice(approve, claim), /pending\.status === "processing"/);
  assert.match(source.slice(approve, claim), /pending\.status !== "awaiting_review"/);
});

test("insufficient Paystack balance leaves the request awaiting review", async () => {
  const source = await read("supabase/functions/payout-withdrawal/index.ts");
  assert.match(source, /availableKobo < requiredKobo/);
  assert.match(source, /provider_balance_pending: true/);
  assert.match(source, /status: "awaiting_review"/);
  assert.match(source, /has not settled enough NGN balance/);
});

test("processing withdrawals reconcile the same transfer reference instead of being resent", async () => {
  const source = await read("supabase/functions/payout-withdrawal/index.ts");
  assert.match(source, /already processing\. Use Check Paystack status; do not send it again/);
  assert.match(source, /`\/transfer\/verify\/\$\{encodeURIComponent\(snapshot\.reference\)\}`/);
  assert.match(source, /reference: claim\.reference/);
  assert.match(source, /transfer\.success|settle_withdrawal_transfer_event/);
});