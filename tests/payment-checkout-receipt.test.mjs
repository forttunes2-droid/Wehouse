import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const guard={};vm.runInNewContext(compile('supabase/functions/_shared/payment-checkout.ts'),{exports:guard,URL,Error});
const reference='WH-TEST-REFERENCE',purpose='shared_housing_share';
const valid={success:true,reference,purpose,authorization_url:'https://checkout.paystack.com/test'};
test('all checkout consumers share exact reference/purpose and real boolean confirmation',()=>{
 for(const reason of ['apartment_reservation','apartment_rent','rent_plan_contribution','hotel_booking','worker_booking','shared_housing_share','experience_booking'])assert.equal(guard.paymentCheckoutReceipt({...valid,purpose:reason},reference,reason).purpose,reason);
 for(const change of [{reference:'another'},{purpose:'hotel_booking'},{success:'true'},{already_paid:'false'},{already_paid:1},{existing:'true'},null])assert.throws(()=>guard.paymentCheckoutReceipt(change===null?null:{...valid,...change},reference,purpose));
 const paid=guard.paymentCheckoutReceipt({...valid,already_paid:true,authorization_url:'javascript:invalid'},reference,purpose);assert.equal(paid.already_paid,true);assert.equal(paid.authorization_url,undefined);
});
test('browser and server reject credentialed, disguised and nonstandard checkout hosts',()=>{
 for(const address of ['http://checkout.paystack.com/pay','https://checkout.paystack.com.evil.invalid/pay','https://checkout.paystack.com@evil.invalid/pay','https://name:password@checkout.paystack.com/pay','https://checkout.paystack.com:444/pay','https://evil.invalid/pay','javascript:alert(1)','//checkout.paystack.com/pay','https://checkout.paystack.com/'])assert.equal(guard.paystackCheckoutDestination(address),null,address);
 assert.equal(guard.paystackCheckoutDestination('https://checkout.paystack.com/pay?ref=1'),'https://checkout.paystack.com/pay?ref=1');
});
function adapter(transport){const exports={},calls=[];vm.runInNewContext(compile('src/lib/supabase/housing-payments.ts'),{exports,Error,require:name=>name==='./client'?{supabase:{functions:{invoke:async(name,args)=>{calls.push({name,args});return transport();}}}}:name.includes('payment-checkout')?guard:{withTimeout:task=>task}});return{...exports,calls};}
test('malformed and failed transports stay failures and never expose an unverified redirect',async()=>{
 const bad=adapter(async()=>({data:{...valid,authorization_url:'https://other.invalid/'},error:null}));const denied=await bad.initializePaymentReference(reference,purpose);assert.equal(denied.result,null);assert.match(denied.error.message,/destination/);
 const mismatch=adapter(async()=>({data:{...valid,reference:'wrong'},error:null}));assert.equal((await mismatch.initializePaymentReference(reference,purpose)).result,null);
 const network=adapter(async()=>{throw Error('Synthetic connection failure');});assert.match((await network.initializePaymentReference(reference,purpose)).error.message,/Synthetic connection failure/);
 const missing=adapter(async()=>({data:null,error:null}));assert.equal((await missing.initializePaymentReference(reference,purpose)).result,null);
 await missing.initializePaymentReference('bad ref',purpose);assert.equal(missing.calls.length,1,'Invalid references should never reach the initializer');
 const provider=adapter(async()=>({data:null,error:{message:'Non-2xx response',context:{clone:()=>({json:async()=>({error:'Synthetic policy changed; refresh booking'})})}}}));assert.match((await provider.initializePaymentReference(reference,purpose)).error.message,/Synthetic policy changed/);
});
