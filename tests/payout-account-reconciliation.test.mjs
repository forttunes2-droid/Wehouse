import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function payoutModule(fetch) {
  const exports = {};
  const deadlines = [];
  const source = fs.readFileSync('supabase/functions/payout-account/index.ts', 'utf8') + '\nexport { paystack, findMatchingRecipient, reconcileChange, listPayoutBanks };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => name.includes('server.ts') ? { serve() {} } : {}, Date,
    console: { error() {} }, fetch,
    AbortSignal: { timeout(ms) { const signal = { timeout: ms }; deadlines.push(signal); return signal; } },
  });
  return { api: exports, deadlines };
}

test('payout banks follow provider cursors beyond the first hundred and share one deadline',async()=>{
 const calls=[];const first=Array.from({length:100},(_,index)=>({code:String(1000+index),name:'Bank '+index,type:'nuban',active:true}));
 const state=payoutModule(async(url,options)=>{calls.push({url,signal:options.signal});return{ok:true,json:async()=>({status:true,data:calls.length===1?first:[{code:'057',name:'Zenith Test Bank',type:'nuban',active:true}],meta:{next:calls.length===1?'page-two':null}})};});
 const banks=await state.api.listPayoutBanks('synthetic-secret');assert.equal(banks.length,101);assert.ok(banks.some(bank=>bank.code==='057'));
 assert.match(calls[1].url,/next=page-two/);assert.equal(calls[0].signal,calls[1].signal);
 await state.api.listPayoutBanks('synthetic-secret');assert.equal(calls.length,2);
});
test('an incomplete or looping bank catalog is an error rather than a partial success',async()=>{
 const rows=Array.from({length:100},(_,index)=>({code:String(1000+index),name:'Bank '+index}));
 for(const meta of [undefined,{next:'same-cursor'}]){
  const state=payoutModule(async()=>({ok:true,json:async()=>({status:true,data:rows,meta})}));await assert.rejects(()=>state.api.listPayoutBanks('synthetic-secret'),/Incomplete bank list/);
 }
});
test('inactive and deleted payout banks are excluded from both search and resolution',async()=>{
 const state=payoutModule(async()=>({ok:true,json:async()=>({status:true,data:[{code:'058',name:'Current Bank',active:true},{code:'057',name:'Retired Bank',active:false},{code:'011',name:'Deleted Bank',is_deleted:true}],meta:{next:null}})}));
 const rows=await state.api.listPayoutBanks('synthetic-secret');assert.equal(rows.length,1);assert.equal(rows[0].code,'058');
});

test('payout recipient mutation has a deadline and a timeout never retries the POST', async () => {
  const calls = [];
  const state = payoutModule(async (_url, options) => { calls.push(options); throw new Error('TimeoutError'); });
  await assert.rejects(state.api.paystack('/transferrecipient', 'synthetic-secret', { method: 'POST' }), /TimeoutError/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.timeout, 12000);
});

test('all recipient lookup pages share one deadline', async () => {
  const signals = [];
  const state = payoutModule(async (_url, options) => {
    signals.push(options.signal);
    const data = Array.from({ length: 100 }, () => ({ details: { bank_code: '000', account_number: '0000000000' } }));
    if (signals.length === 2) data[99] = { recipient_code: 'RCP_existing', details: { bank_code: '058', account_number: '0123456789' } };
    return { ok: true, status: 200, async json() { return { status: true, data }; } };
  });
  assert.equal(await state.api.findMatchingRecipient('synthetic-secret', '058', '0123456789'), 'RCP_existing');
  assert.equal(signals.length, 2);
  assert.equal(state.deadlines.length, 1);
  assert.equal(signals[0], signals[1]);
});

test('recipient reconciliation timeout remains pending without creating or promoting a destination', async () => {
  const calls = [];
  const state = payoutModule(async (url, options) => { calls.push({ url, options }); throw new Error('TimeoutError'); });
  const admin = {
    from() { const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: null, error: null }; } }; return query; },
    rpc() { throw new Error('Uncertain lookup cannot save or promote an account'); },
  };
  const result = await state.api.reconcileChange(admin, 'synthetic-secret', {
    request_id: 'original-change', user_id: 'test-owner', status: 'uncertain',
    created_at: new Date(Date.now() - 120000).toISOString(), bank_code: '058', account_number: '0123456789',
  });
  assert.equal(result.pending, true);
  assert.equal(result.status, 'uncertain');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
});

test('reconciliation reuses the canonical bank recipient without creating another', async () => {
  const exports = {};
  const source = fs.readFileSync('supabase/functions/payout-account/index.ts', 'utf8') + '\nexport { reconcileChange };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: name => name.includes('server.ts') ? { serve() {} } : {},
    Date, console, fetch() { throw new Error('Existing recipient must never call Paystack'); },
  });
  const columns = new Set(['id', 'bank_name', 'bank_code', 'account_number', 'account_name', 'verified_at', 'is_default', 'is_active', 'paystack_recipient_code']);
  const account = { id: 'existing-account', paystack_recipient_code: 'RCP_existing', is_default: true };
  const calls = [];
  const admin = {
    from(table) {
      const query = {
        select(projection) {
          if (table === 'bank_accounts') for (const column of projection.split(',')) assert.ok(columns.has(column), `Unknown bank column: ${column}`);
          return query;
        },
        eq() { return query; }, update(patch) { calls.push({ table, patch }); return query; },
        async maybeSingle() { return { data: table === 'bank_accounts' ? account : { request_id: 'original-change' }, error: null }; },
      };
      return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { data: account, error: null }; },
  };
  const result = await exports.reconcileChange(admin, 'synthetic-secret', {
    request_id: 'original-change', user_id: 'test-owner', status: 'uncertain', bank_code: '058', account_number: '0123456789',
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.account.id, account.id);
  assert.equal(calls.filter(call => call.name === 'set_default_payout_account_for_user').length, 1);
  assert.equal(calls.find(call => call.patch)?.patch.status, 'succeeded');
});
