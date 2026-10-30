import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const destinations={};vm.runInNewContext(compile('supabase/functions/_shared/payment-checkout.ts'),{exports:destinations,URL,Error});
function harness(transport=async()=>({data:null,error:null})){const exports={},calls=[];vm.runInNewContext(compile('src/lib/paidPlanBilling.ts'),{exports,URL,Date,Error,require:name=>name.endsWith('/client')?{supabase:{rpc:async(name)=>{calls.push(name);return transport();},functions:{invoke:async(name)=>{calls.push(name);return transport();}}}}:name.includes('payment-checkout')?destinations:{withTimeout:task=>task}});return{...exports,calls};}
const work={kind:'worker',name:'WeHouse Work tools',status:'active',provider:'paystack',period_end:'2026-12-01T10:00:00Z',billing_period:'monthly',price:4200,currency:'NGN',auto_renews:true,cancel_at_period_end:false,last_verified_at:'2026-10-29T10:00:00Z',can_manage:true,workspace_access:false};
test('owner billing receipts retain restricted workspace state and reject unconfirmed or mixed identities',()=>{
 const h=harness(),r={user_id:'me',plans:[work]};assert.equal(h.paidPlanBilling(r,'me')[0].workspace_access,false);
 for(const value of [{...r,user_id:'other'},{...r,plans:[work,work]},{...r,plans:[{...work,auto_renews:'true'}]},{...r,plans:[{...work,status:'suspended'}]},{...r,plans:[{...work,period_end:'invalid'}]},{...r,plans:[{...work,price:NaN}]},{...r,plans:[{...work,kind:'property_partner',provider:'prepaid'}]}])assert.throws(()=>h.paidPlanBilling(value,'me'));
});
test('subscription management validates Paystack links and fixed store routes without keeping provider tokens',async()=>{
 const url='https://paystack.com/manage/subscriptions/fixture?subscription_token=synthetic';
 const h=harness(async()=>({data:{success:true,url},error:null}));assert.equal(await h.openWorkSubscriptionManagement('paystack'),url);
 assert.equal(await h.openWorkSubscriptionManagement('apple'),'https://apps.apple.com/account/subscriptions');assert.equal(await h.openWorkSubscriptionManagement('google'),'https://play.google.com/store/account/subscriptions');assert.deepEqual(h.calls,['worker-pro-manage']);
 for(const link of ['https://user:secret@paystack.com/manage/subscriptions/x','https://paystack.com:444/manage/subscriptions/x','https://paystack.com.evil.invalid/manage/subscriptions/x','http://paystack.com/manage/subscriptions/x','https://paystack.com/another'])assert.equal(destinations.paystackSubscriptionDestination(link),null);
 await assert.rejects(()=>harness(async()=>({data:{success:true,url:'https://untrusted.invalid'},error:null})).openWorkSubscriptionManagement('paystack'));
});
