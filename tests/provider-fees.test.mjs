import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture(){let response;const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/providerFees.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,require:name=>name.endsWith('/client')?{supabase:{rpc:async()=>response}}:{withTimeout:p=>p}});return{api,set:value=>{response=value}};}
const receipt=()=>({available:true,product:'short_let',management_mode:'wehouse',base_policy_version_id:'92000000-0000-4000-8000-000000000001',policy_version_id:'92000000-0000-4000-8000-000000000002',base_percent:10,management_percent:3,total_percent:13,deducted_from:'provider_earnings',basis:'accommodation_value',digest:'a'.repeat(64)});
test('managed fee disclosure preserves base, additional and combined rates as one deduction',()=>{
 const {api}=fixture();const r=api.providerFeeReceipt(receipt(),'short_let','wehouse');assert.equal(r.total_percent,13);assert.equal(r.management_percent,3);
 for(const patch of [{total_percent:23},{management_percent:-1},{base_percent:'10'},{total_percent:Infinity},{digest:'missing'},{deducted_from:'customer_total'},{policy_version_id:'missing'}])assert.throws(()=>api.providerFeeReceipt({...receipt(),...patch},'short_let','wehouse'));
});
test('missing configuration stays unavailable and unrelated product/mode receipts are rejected',()=>{
 const {api}=fixture();assert.equal(api.providerFeeReceipt({available:false,product:'experience',management_mode:'host'},'experience','host'),null);
 assert.throws(()=>api.providerFeeReceipt(receipt(),'long_stay','wehouse'));assert.throws(()=>api.providerFeeReceipt(receipt(),'short_let','host'));
 assert.throws(()=>api.providerFeeReceipt({...receipt(),management_mode:'host'},'short_let','host'));
});
test('explicit zero management fee is preserved and load errors cannot become accepted rates',async()=>{
 const f=fixture();assert.equal(f.api.providerFeeReceipt({...receipt(),management_percent:0,total_percent:10},'short_let','wehouse').management_percent,0);
 f.set({data:null,error:{message:'Denied'}});await assert.rejects(f.api.getProviderFees('short_let','wehouse'));
 f.set({data:{},error:null});await assert.rejects(f.api.getProviderFees('short_let','wehouse'));
});
