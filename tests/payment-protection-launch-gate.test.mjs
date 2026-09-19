import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(relative)=>fs.readFileSync(path.join(root,relative),'utf8');

test('live marketplace payments fail closed until PSP and legal approval exists',()=>{
  const paymentInit=read('supabase/functions/payment-init/index.ts');
  assert.match(paymentInit,/LIVE_MARKETPLACE_PAYMENT_GATE='payments_protection_payouts'/);
  assert.match(paymentInit,/function isLivePaystackKey\(secret:string\)/);
  assert.match(paymentInit,/db\.rpc\('_legal_launch_gate_is_approved',\{p_gate_key:LIVE_MARKETPLACE_PAYMENT_GATE\}\)/);
  assert.match(paymentInit,/if\(approved!==true\)/);
  assert.match(paymentInit,/Live marketplace payments are awaiting Payment Protection and payout approval/);
});

test('test-mode Paystack remains available for QA while live mode is gated',()=>{
  const paymentInit=read('supabase/functions/payment-init/index.ts');
  assert.match(paymentInit,/if\(isLivePaystackKey\(paystackSecret\)\)\{/);
  assert.doesNotMatch(paymentInit,/sk_test_.*_legal_launch_gate_is_approved/);
});
