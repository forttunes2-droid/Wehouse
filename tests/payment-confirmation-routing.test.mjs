import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto, createHmac } from 'node:crypto';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const markets={};vm.runInNewContext(compile(fs.readFileSync('supabase/functions/_shared/payment-market.ts','utf8')),{exports:markets});
const smallJson={};vm.runInNewContext(compile(fs.readFileSync('supabase/functions/_shared/smallJsonRequest.ts','utf8')),{exports:smallJson,TextDecoder,Uint8Array});
async function harness(name,{purpose='other',receipt={success:false,error:'Unsupported payment purpose'},status='pending',provider={},rpcFailure,authenticated=true,configured=true,rateAllowed=true}={}){
 let handler;const calls=[],budgets=[];let providerFetches=0;
 const secret='sk_test_fixture';
 const row={id:'payment',user_id:'customer',payer_user_id:'customer',purpose,status,currency:'NGN',amount_total:42};
 const admin={auth:{getUser:async()=>({data:{user:{id:'auth-customer'}},error:null})},
  from:table=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='profiles'?{user_id:'customer'}:row,error:null})};return query;},
  rpc:async(name,args)=>{calls.push({name,args});return{data:name==='record_verified_payment_mode'?true:receipt,error:rpcFailure===name?{message:'Fixture unavailable'}:null};}};
 const data={id:123,reference:'reference',amount:4200,currency:'NGN',status:'success',domain:'test',paid_at:'2026-10-23T12:00:00Z',...provider};
 vm.runInNewContext(compile(fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8').replace(/^import .*;\r?\n/gm,'')),{
  exports:{},Request,Response,URL,TextEncoder,AbortSignal,crypto:webcrypto,console,
  Deno:{env:{get:key=>({SUPABASE_URL:'https://qoobnkedfyosnizrlttt.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',PAYSTACK_SECRET_KEY:configured?secret:undefined})[key]},serve:fn=>{handler=fn;}},
  serve:fn=>{handler=fn;},createClient:()=>admin,hasLiveSession:async()=>true,...markets,...smallJson,
  consumeUserAction:async(...args)=>{budgets.push(args.slice(1));return {allowed:rateAllowed,retryAfterSeconds:rateAllowed?0:30};},
  fetch:async()=>{providerFetches++;return Response.json({status:true,data});},
 });
 const body=JSON.stringify(name==='paystack-webhook'?{event:'charge.success',data}:{reference:'reference'});
 const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{...(authenticated?{authorization:'Bearer fixture'}:{}),'x-paystack-signature':createHmac('sha512',secret).update(body).digest('hex')},body}));
 return{response,calls,budgets,providerFetches,body:await response.text()};
}

test('payment verification denies missing authentication and exhausted budgets without provider traffic',async()=>{
 const anonymous=await harness('paystack-verify',{authenticated:false,configured:false});
 assert.equal(anonymous.response.status,401);assert.equal(anonymous.providerFetches,0);assert.equal(anonymous.calls.length,0);
 const limited=await harness('paystack-verify',{rateAllowed:false});
 assert.equal(limited.response.status,429);assert.equal(limited.response.headers.get('retry-after'),'30');assert.equal(limited.providerFetches,0);assert.equal(limited.calls.length,0);
 assert.equal(limited.budgets[0][1],'payment_verify');assert.equal(limited.budgets[0][2],20);assert.equal(limited.budgets[0][3],300);
});

for(const name of ['paystack-verify','paystack-webhook']){
 test(`${name}: unsupported and previously paid purposes cannot bypass the provider-event gateway`,async()=>{
  for(const status of ['pending','paid']){
   const h=await harness(name,{status});
   assert.equal(h.calls[0].name,'process_verified_paystack_charge');
   assert.ok(!h.calls.some(c=>c.name==='confirm_booking_payment'));
   assert.ok(!h.calls.some(c=>c.name==='record_verified_payment_mode'));
   if(name==='paystack-verify'){const result=JSON.parse(h.body);assert.equal(result.success,false);assert.equal(result.requires_review,true);assert.equal(result.charged,true);}
   else assert.equal(h.response.status,500);
  }
 });
 test(`${name}: false, malformed and ignored confirmations never produce a successful booking receipt`,async()=>{
  for(const receipt of [null,{success:false},{success:'true'},{success:true,ignored:true}]){
   const h=await harness(name,{purpose:'hotel_booking',receipt});
   assert.equal(h.calls.length,1);
   if(name==='paystack-verify')assert.equal(JSON.parse(h.body).success,false);else assert.equal(h.response.status,500);
  }
 });
 test(`${name}: canonical confirmation records the verified mode after protection succeeds`,async()=>{
  const h=await harness(name,{purpose:'hotel_booking',receipt:{success:true,provider_event_id:'event'}});
  assert.equal(h.calls[0].name,'process_verified_paystack_charge');
  assert.equal(h.calls[1].name,'record_verified_payment_mode');
  assert.equal(h.calls[0].args.p_amount_minor,4200);
  assert.equal(h.response.status,200);
 });
}
test('paid-plan verification uses subscription authority and rejects incomplete, conflicting or rejected receipts',async()=>{
 for(const receipt of [null,{success:false,conflict:true},{success:'true'}]){
  const h=await harness('paystack-verify',{purpose:'worker_pro_subscription',receipt});
  assert.equal(h.calls[0].name,'confirm_worker_pro_paystack_charge');assert.equal(h.calls.length,1);
  assert.equal(JSON.parse(h.body).success,false);assert.equal(JSON.parse(h.body).requires_review,true);
 }
 for(const provider of [{paid_at:null},{domain:'live'},{id:null}]){
  const h=await harness('paystack-verify',{purpose:'worker_pro_subscription',provider});
  assert.equal(h.calls.length,0);assert.equal(JSON.parse(h.body).success,false);
 }
});
test('paid-plan verification confirms the exact provider amount, environment and payment before success',async()=>{
 const h=await harness('paystack-verify',{purpose:'worker_pro_subscription',receipt:{success:true}});
 assert.equal(h.calls[0].name,'confirm_worker_pro_paystack_charge');
 assert.equal(h.calls[0].args.p_verified_amount,42);assert.equal(h.calls[0].args.p_environment,'sandbox');
 assert.equal(h.calls[0].args.p_event_time,'2026-10-23T12:00:00.000Z');
 assert.equal(h.calls[1].name,'record_verified_payment_mode');assert.equal(JSON.parse(h.body).success,true);
});
test('known charges retain their charged/review state when persistence or receipt recording fails',async()=>{
 for(const [purpose,rpcFailure] of [['hotel_booking','process_verified_paystack_charge'],['hotel_booking','record_verified_payment_mode'],['sponsored_campaign','confirm_sponsored_paystack_charge'],['partner_pro_access','confirm_partner_pro_paystack_charge']]){
  const h=await harness('paystack-verify',{purpose,rpcFailure,receipt:{success:true}});
  const result=JSON.parse(h.body);assert.equal(h.response.status,200);assert.equal(result.success,false);
  assert.equal(result.verified,true);assert.equal(result.charged,true);assert.equal(result.requires_review,true);
 }
});
test('client verification rejects truthy success, wrong purposes and incomplete or contradictory confirmations',()=>{
 const exports={};vm.runInNewContext(compile(fs.readFileSync('src/lib/supabase/payment-verify.ts','utf8')),{exports,require:()=>({supabase:{}})});
 const parse=exports.paymentVerificationReceipt;
 for(const value of [null,[],{}, {success:'true'}, {success:true}, {success:true,verified:true},
  {success:true,verified:true,recorded:true,requires_review:true,purpose:'hotel_booking'},
  {success:true,verified:true,recorded:true,purpose:'worker_booking'},
  {success:true,verified:true,recorded:true,purpose:'hotel_booking',amount:'42'}])assert.equal(parse(value,'hotel_booking').success,false);
 assert.equal(parse({success:true,verified:true,recorded:true,purpose:'hotel_booking',amount:42},'hotel_booking').success,true);
 const review=parse({success:false,verified:true,charged:true,requires_review:true,error:'Review required'});
 assert.equal(review.requires_review,true);assert.equal(review.charged,true);
});
test('Sponsored and Partner Pro confirmations require literal success from their own billing authorities',async()=>{
 for(const name of ['paystack-verify','paystack-webhook'])for(const purpose of ['sponsored_campaign','partner_pro_access']){
  const h=await harness(name,{purpose,receipt:{success:'true'}});
  assert.equal(h.calls[0].name,purpose==='sponsored_campaign'?'confirm_sponsored_paystack_charge':'confirm_partner_pro_paystack_charge');
  if(name==='paystack-verify'){assert.equal(JSON.parse(h.body).success,false);assert.equal(JSON.parse(h.body).requires_review,true);assert.equal(JSON.parse(h.body).recorded,false);}else assert.equal(h.response.status,409);
 }
});
test('client retry preserves a known charge or final failure instead of replacing it with a generic error',async()=>{
 for(const receipt of [{success:false,verified:true,charged:true,error:'Confirmed charge needs status review'}, {success:false,error:'Provider unavailable'}]){
  let calls=0;const exports={};const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},functions:{invoke:async()=>{calls++;return{data:receipt,error:null};}}};
  vm.runInNewContext(compile(fs.readFileSync('src/lib/supabase/payment-verify.ts','utf8')),{exports,require:()=>({supabase}),setTimeout:fn=>{fn();}});
  const result=await exports.verifyPaymentWithRetry('reference',undefined,2);
  assert.equal(result.error,receipt.error);assert.equal(result.charged,receipt.charged);assert.equal(calls,receipt.charged?1:2);
 }
});
