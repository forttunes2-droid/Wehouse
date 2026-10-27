import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

async function run(options={}) {
  let handler; const rpcs=[],posts=[],deadlines=[];
  const action={financial_action_id:'fixture',action_type:'refund_worker',amount:100.50,paystack_reference:'original',idempotency_key:'stable',...options.action};
  const db={async rpc(name,args){
    rpcs.push({name,args});
    if(name==='claim_financial_actions')return {data:options.noNewActions?[]:[action],error:null};
    if(name==='claim_due_refund_reconciliations')return {data:options.lookupActions||[],error:null};
    if(name==='process_verified_paystack_refund_lookup')return {data:{success:true,financial_action_id:'known-refund',status:'completed'},error:null};
    if(name==='complete_internal_release_action')return {data:options.releaseReceipt??null,error:null};
    if(name==='record_refund_provider_submission')return {data:options.missingReceipt?null:{financial_action_id:'fixture',provider_action_id:'42',status:options.completed?'completed':'provider_pending'},error:null};
    return {data:true,error:null};
  }};
  const code=ts.transpileModule(readFileSync('supabase/functions/financial-action-processor/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const signal={timeout(ms){deadlines.push(ms);return {};}};
  const provider=async(url,init)=>{
    if(!init.method)return Response.json({status:true,data:{id:91,reference:'original',currency:'NGN',domain:'test',status:'success',amount:20000,...options.transaction}});
    posts.push({url,body:JSON.parse(init.body)});if(options.timeout)throw Error('Timeout');return new Response(JSON.stringify({status:true,data:{id:options.missingId?null:42,status:'pending'}}));
  };
  const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const market={},refund={};vm.runInNewContext(compile('supabase/functions/_shared/payment-market.ts'),{exports:market});
  vm.runInNewContext(compile('supabase/functions/_shared/refund-reconciliation.ts'),{exports:refund,require:()=>market,fetch:provider,AbortSignal:signal});
  vm.runInNewContext(code,{exports:{},require:name=>name.includes('supabase-js')?({createClient:()=>db}):name.includes('payment-return')?{resolvePaymentReturnUrl:()=>options.rentEnabled?'https://fixture.invalid':null}:name.includes('later-rent-debit')?{runLaterRentDebit:async()=>{if(options.rentFailure)throw Error('Rent provider unavailable');}}:name.includes('later-rent-settlement')?{reconcileLaterRentSettlements:async()=>{}}:{verifyRefundPayment:refund.verifyRefundPayment,verifyRefundLookup:async()=>{if(options.lookupFailure)throw Error('Unknown lookup');return{providerId:'42',status:'processed',checksum:'a'.repeat(64),amountMinor:10050,currency:'NGN'};}},crypto:webcrypto,TextEncoder,Response,
    AbortSignal:signal,
    Deno:{serve(fn){handler=fn;},env:{get:key=>key==='PAYSTACK_SECRET_KEY'?'sk_test_fixture':'synthetic-fixture'}},
    fetch:provider,
  });
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'x-wehouse-cron-secret':'synthetic-fixture'}}));
  return {rpcs,posts,deadlines,body:await response.json()};
}

test('refund processor uses a bounded batch and provider deadline with exact kobo',async()=>{
  const result=await run();
  assert.equal(result.rpcs.find(x=>x.name==='claim_financial_actions').args.p_limit,3);
  assert.ok(result.rpcs.findIndex(x=>x.name==='recover_stale_financial_actions') < result.rpcs.findIndex(x=>x.name==='claim_financial_actions'));
  assert.deepEqual(result.deadlines,[8000,12000]);
  assert.equal(result.posts[0].body.amount,10050);
  assert.ok(result.rpcs.some(x=>x.name==='record_refund_provider_submission'&&x.args.p_provider_action_id==='42'));
});

test('automatic rent provider failure cannot block the existing refund processor',async()=>{
 const result=await run({rentEnabled:true,rentFailure:true});
 assert.equal(result.posts.length,1);
 assert.ok(result.rpcs.some(x=>x.name==='record_refund_provider_submission'));
});
test('uncertain refunds and missing provider receipts require review without resubmission',async()=>{
  for(const options of [{timeout:true},{missingId:true}]){
    const result=await run(options);
    assert.equal(result.posts.length,1);
    assert.ok(result.rpcs.some(x=>x.name==='mark_financial_action_manual_review'));
    assert.ok(!result.rpcs.some(x=>x.name==='record_refund_provider_submission'));
  }
  for(const amount of [0,-1,'bad',100.505]){
    const result=await run({action:{amount}});assert.equal(result.posts.length,0);
    assert.ok(result.rpcs.some(x=>x.name==='mark_financial_action_manual_review'));
  }
  for(const transaction of [{currency:'USD'},{domain:'live'},{status:'failed'},{amount:10000},{reference:'other'}]){
    const result=await run({transaction});assert.equal(result.posts.length,0);
    assert.ok(result.rpcs.some(x=>x.name==='mark_financial_action_manual_review'));
  }
});
test('a missing release completion receipt is routed to review',async()=>{
  const result=await run({action:{action_type:'release_worker'}});
  assert.equal(result.posts.length,0);
  assert.ok(result.rpcs.some(x=>x.name==='mark_financial_action_manual_review'));
  assert.equal(result.body.outcomes[0].success,false);
  assert.equal(result.body.success,false,'An unresolved release cannot be reported as a successful batch');
});

test('submission acknowledgement requires its matching database receipt and preserves completed webhooks',async()=>{
 const unknown=await run({missingReceipt:true});
 assert.equal(unknown.body.success,false);
 assert.equal(unknown.posts.length,1);
 assert.ok(unknown.rpcs.some(x=>x.name==='mark_financial_action_manual_review'));
 const completed=await run({completed:true});
 assert.equal(completed.body.success,true);
 assert.equal(completed.body.outcomes[0].provider_pending,false);
});

test('scheduled reconciliation checks known refunds without submitting them again',async()=>{
 for(const lookupFailure of [false,true]){
  const result=await run({noNewActions:true,lookupActions:[{financial_action_id:'known-refund',provider_action_id:'42',paystack_reference:'original',amount:100.5}],lookupFailure});
  assert.equal(result.posts.length,0);
  assert.equal(result.body.success,!lookupFailure);
  assert.equal(result.rpcs.some(x=>x.name==='record_refund_reconciliation_failure'),lookupFailure);
 }
});
