import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function run(action,options={}){
 let handler;const calls=[],rpcs=[],deadlines=[];
 const reference='whp-11111111111141118111111111111111';
 const transfer={reference,amount:10000,currency:'NGN',status:'success',transfer_code:'TRF_fixture',...options.transfer};
 const admin={
  auth:{getUser:async()=>({data:{user:{id:'auth-finance'}},error:null})},
  from(table){const query={select(){return query;},eq(){return query;},is(){return query;},in(){return Promise.resolve({data:[{workspace_role:'staff'},{workspace_role:'finance_operations'}],error:null});},maybeSingle(){return Promise.resolve({data:table==='profiles'?{user_id:'finance'}:{id:'withdrawal',amount:100,status:'awaiting_review'},error:null});}};return query;},
  async rpc(name,args){rpcs.push({name,args});
   if(name==='claim_withdrawal_for_payout')return {data:{success:true,already_claimed:!!options.claimed,amount:100,recipient_code:'RCP_fixture',reference,owner_type:'worker'},error:null};
   if(name==='get_withdrawal_payout_snapshot')return {data:{success:true,status:'processing',amount:100,reference},error:null};
   if(name==='record_withdrawal_transfer_response')return {data:null,error:options.recordError?{message:'storage unavailable'}:null};
   if(name==='settle_withdrawal_transfer_event')return {data:{status:'paid'},error:null};
   throw Error('Unexpected money mutation '+name);
  },
 };
 const source=readFileSync('supabase/functions/payout-withdrawal/index.ts','utf8');
 vm.runInNewContext(compile(source),{exports:{},require:name=>{
  if(name.includes('server.ts'))return{serve(fn){handler=fn;}};
  if(name.includes('supabase-js'))return{createClient:()=>admin};
  if(name.includes('liveSession'))return{hasLiveSession:async()=>true};
  if(name.includes('rateLimit'))return{consumeUserAction:async()=>({allowed:true})};
  throw Error(name);
 },Deno:{env:{get:key=>({SUPABASE_URL:'https://test.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',PAYSTACK_SECRET_KEY:'sk_test_synthetic'})[key]}},Response,Date,atob,console:{error(){}},
 AbortSignal:{timeout(ms){deadlines.push(ms);return{deadline:ms};}},
 fetch:async(url,init)=>{calls.push({url,init});if(url.endsWith('/balance'))return new Response(JSON.stringify({status:true,data:options.balance??[{currency:'NGN',balance:100000}]}));
  if(options.timeout)throw Error('TimeoutError');
  if(options.httpError)return new Response(JSON.stringify({status:false,message:'Duplicate reference'}),{status:400});
  return new Response(JSON.stringify({status:true,data:transfer}));
 }});
 const response=await handler(new Request('https://test.example.invalid/payout',{method:'POST',headers:{authorization:'Bearer verified-fixture','content-type':'application/json'},body:JSON.stringify({action,withdrawal_id:'withdrawal'})}));
 return{status:response.status,body:await response.json(),calls,rpcs,deadlines};
}
test('provider 4xx and timeout never return held funds or resend an uncertain transfer',async()=>{
 for(const options of [{httpError:true},{timeout:true}]){
  const result=await run('approve',options);
  assert.equal(result.status,502);assert.equal(result.body.success,false);
  assert.equal(result.calls.filter(call=>call.init.method==='POST').length,1);
  assert.ok(result.deadlines.every(ms=>ms===12000));
  assert.ok(!result.rpcs.some(call=>['fail_withdrawal_before_transfer','settle_withdrawal_transfer_event'].includes(call.name)));
 }
});
test('a concurrent approval that finds an existing claim does not post another transfer',async()=>{
 const result=await run('approve',{claimed:true});
 assert.equal(result.body.reconciliation_required,true);
 assert.equal(result.calls.filter(call=>call.init.method==='POST').length,0);
});
test('an unconfirmed NGN balance cannot claim a wallet withdrawal',async()=>{
 for(const balance of [[{currency:'NGN',balance:'unknown'}],[{currency:'USD',balance:100000}],[]]){
  const result=await run('approve',{balance});
  assert.equal(result.status,502);assert.equal(result.rpcs.length,0);
 }
});
test('mismatched transfer receipts cannot record or settle wallet money',async()=>{
 for(const action of ['approve','reconcile'])for(const transfer of [{reference:'another-transfer'},{amount:1},{currency:'USD'}]){
  const result=await run(action,{transfer});assert.equal(result.status,502);
  assert.ok(!result.rpcs.some(call=>['record_withdrawal_transfer_response','settle_withdrawal_transfer_event'].includes(call.name)));
 }
});
test('reconciliation requires its database receipt before settlement',async()=>{
 const result=await run('reconcile',{recordError:true});assert.equal(result.status,500);
 assert.ok(!result.rpcs.some(call=>call.name==='settle_withdrawal_transfer_event'));
 const confirmed=await run('reconcile');assert.equal(confirmed.body.status,'paid');
 assert.equal(confirmed.rpcs.filter(call=>call.name==='settle_withdrawal_transfer_event').length,1);
});
test('operator payout success needs an action-specific confirmed status',()=>{
 const exports={};vm.runInNewContext(compile(readFileSync('src/lib/payoutActionReceipt.ts','utf8')),{exports});
 const confirmed=exports.payoutActionConfirmed;
 for(const receipt of [null,{}, {success:true},{success:'true',status:'processing'},{success:true,status:'paid'}])assert.equal(confirmed('approve',receipt),false);
 assert.equal(confirmed('approve',{success:true,status:'processing'}),true);
 assert.equal(confirmed('reject',{success:true,status:'rejected'}),true);
 assert.equal(confirmed('reject',{success:true,status:'processing'}),false);
 assert.equal(confirmed('reconcile',{success:true,status:'paid'}),true);
});
