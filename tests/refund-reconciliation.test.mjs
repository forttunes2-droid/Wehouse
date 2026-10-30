import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const market={};vm.runInNewContext(compile('supabase/functions/_shared/payment-market.ts'),{exports:market});
const module={};const deadlines=[];
vm.runInNewContext(compile('supabase/functions/_shared/refund-reconciliation.ts'),{exports:module,require:()=>market,crypto:webcrypto,TextEncoder,fetch,AbortSignal:{timeout(ms){deadlines.push(ms);return {};}}});
const snapshot={financial_action_id:'action',amount:100.5,status:'manual_review',provider_action_id:null,paystack_reference:'original-ref'};
async function run(options={}){
 const calls=[];const proof=await module.verifyRefundLookup({...snapshot,...options.snapshot},'42','sk_test_fixture',async(url,init)=>{
  calls.push({url,method:init.method||'GET'});if(options.timeout)throw Error('Timeout');
  const data=url.includes('/transaction/')?{id:91,reference:'original-ref',currency:'NGN',domain:'test',status:'success',amount:20000,...options.transaction}:{id:42,transaction:91,currency:'NGN',domain:'test',amount:10050,status:'processed',...options.refund};
  return new Response(JSON.stringify({status:true,data}));
 });return {calls,proof};
}
test('refund lookup binds both provider records and never submits another refund',async()=>{
 const result=await run();assert.equal(result.proof.providerId,'42');assert.equal(result.proof.status,'processed');
 assert.equal(result.proof.amountMinor,10050);assert.match(result.proof.checksum,/^[a-f0-9]{64}$/);
 assert.ok(result.calls.every(call=>call.method==='GET'));assert.deepEqual(deadlines.slice(-2),[8000,8000]);
});
test('mismatched transaction, amount, environment, ID or currency cannot settle a refund',async()=>{
 for(const transaction of [{reference:'other'},{currency:'USD'},{domain:'live'},{id:0},{status:'failed'},{amount:10049},{amount:20000.1}])await assert.rejects(run({transaction}));
 for(const refund of [{id:43},{transaction:92},{currency:'USD'},{domain:'live'},{amount:10049},{amount:10050.1},{status:'unknown'}])await assert.rejects(run({refund}));
 await assert.rejects(run({snapshot:{provider_action_id:'different'}}));await assert.rejects(run({timeout:true}));
});

async function endpoint(options={}){
 let handler;const writes=[],provider=[];const id='91111111-1111-4111-8111-111111111111';
 const caller={auth:{getUser:async()=>({data:{user:{id:'auth-fixture'}},error:null})},rpc:async()=>({data:options.denied?null:{...snapshot,financial_action_id:id},error:options.denied?{message:'Denied'}:null})};
 const admin={rpc:async(name,args)=>{writes.push({name,args});return {data:options.missingReceipt?null:{success:true,financial_action_id:id,status:'completed'},error:null};}};
 vm.runInNewContext(compile('supabase/functions/financial-action-reconcile/index.ts'),{exports:{},Response,
  require:name=>name.includes('supabase-js')?{createClient:(_url,key)=>key==='anon'?caller:admin}:name.includes('rateLimit')?{consumeUserAction:async()=>({allowed:!options.limited})}:{verifyRefundLookup:async()=>{provider.push('GET');return{providerId:'42',status:'processed',checksum:'a'.repeat(64),amountMinor:10050,currency:'NGN'};}},
  Deno:{serve(fn){handler=fn;},env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',PAYSTACK_SECRET_KEY:'sk_test_fixture'})[key]}},
 });
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:options.noToken?{}:{authorization:'Bearer fixture'},body:JSON.stringify({financial_action_id:id,provider_refund_id:'42'})}));
 return{status:response.status,body:await response.json(),writes,provider};
}
test('Finance reconciliation requires scoped authority before provider lookup or privileged writes',async()=>{
 for(const options of [{noToken:true},{denied:true},{limited:true}]){const r=await endpoint(options);assert.ok(r.status>=400);assert.equal(r.provider.length,0);assert.equal(r.writes.length,0);}
 const r=await endpoint();assert.equal(r.body.success,true);assert.equal(r.writes[0].name,'process_verified_paystack_refund_lookup');
 const unknown=await endpoint({missingReceipt:true});assert.equal(unknown.status,409);assert.equal(unknown.body.success,false);
});

test('strict provider-lookup throttling denies unavailable and malformed limiter receipts',async()=>{
 const exports={};vm.runInNewContext(compile('supabase/functions/_shared/rateLimit.ts'),{exports});
 for(const result of [{data:null,error:{message:'Unavailable'}},{data:{},error:null}]){
  const receipt=await exports.consumeUserAction({rpc:async()=>result},'person','refund_reconcile',10,600,true);
  assert.equal(receipt.allowed,false);assert.equal(receipt.retryAfterSeconds,30);
 }
 const receipt=await exports.consumeUserAction({rpc:async()=>{throw Error('Timeout');}},'person','refund_reconcile',10,600,true);
 assert.equal(receipt.allowed,false);
});

test('money throttles deny limiter failure by default and return bounded retry information',async()=>{
 const exports={};vm.runInNewContext(compile('supabase/functions/_shared/rateLimit.ts'),{exports});
 for(const data of [null,{}, {allowed:'true'},{allowed:1}]){
  const result=await exports.consumeUserAction({rpc:async()=>({data,error:null})},'person','payout_withdrawal',10,600);
  assert.equal(result.allowed,false);assert.equal(result.retryAfterSeconds,30);
 }
 for(const retry of [-1,'invalid',Infinity,null]){
  const result=await exports.consumeUserAction({rpc:async()=>({data:{allowed:false,retry_after_seconds:retry},error:null})},'person','payout_withdrawal',10,600);
  assert.equal(result.allowed,false);assert.equal(result.retryAfterSeconds,30);
 }
 const capped=await exports.consumeUserAction({rpc:async()=>({data:{allowed:false,retry_after_seconds:999999},error:null})},'person','payout_account',10,600);
 assert.equal(capped.retryAfterSeconds,600);
 const valid=await exports.consumeUserAction({rpc:async()=>({data:{allowed:true,retry_after_seconds:999},error:null})},'person','payout_account',10,600);
 assert.equal(valid.allowed,true);assert.equal(valid.retryAfterSeconds,0);
 const broken=await exports.consumeUserAction({rpc:async()=>{throw Error('Limiter unavailable');}},'person','payout_withdrawal',10,600);
 assert.equal(broken.allowed,false);
 let called=false;const invalid=await exports.consumeUserAction({rpc:async()=>{called=true;}},'person','payout_withdrawal',0,600);
 assert.equal(invalid.allowed,false);assert.equal(called,false);
});
