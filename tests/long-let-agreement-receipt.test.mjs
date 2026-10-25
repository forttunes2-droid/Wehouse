import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/longLetRentTerms.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:api,require:()=>({})});
function agreement(years=2){
 const annual=1200000,first=1080000;
 return {schema_version:1,reservation_id:'rental',listing_id:'home',offer_revision:1,currency:'NGN',quote_digest:'a'.repeat(32),
  rent_schedule:{term_months:years*12,payment_choice:'monthly',annual_rent:annual,first_year_rent:first,
   contract_total:first+annual*(years-1),due_before_handover:first,future_balance:annual*(years-1),payments:[
    {sequence:1,target_year:1,month_offset:0,due_before_handover:true,due_on:null,amount:first},
    ...Array.from({length:8*(years-1)},(_,i)=>({sequence:i+2,target_year:2+Math.floor(i/8),month_offset:4+i%8+12*Math.floor(i/8),due_before_handover:false,due_on:null,amount:annual/8})),
   ]}};
}
test('multi-year monthly receipts require full discounted Year 1 and eight advance payments per later year',()=>{
 for(const years of [2,3,4,5])assert.equal(api.longLetAgreementReceipt(agreement(years),'rental').rent_schedule.payments.length,1+8*(years-1));
});
test('one-year monthly and reduced upfront amounts fail closed even when totals still balance',()=>{
 const oneYear=agreement(1);assert.throws(()=>api.longLetAgreementReceipt(oneYear,'rental'));
 const reduced=agreement();reduced.rent_schedule.due_before_handover-=100;
 reduced.rent_schedule.payments[0].amount-=100;reduced.rent_schedule.payments[1].amount+=100;reduced.rent_schedule.future_balance+=100;
 assert.throws(()=>api.longLetAgreementReceipt(reduced,'rental'),/Year 1 must be paid in full/);
});
test('later-year receipts reject early, reassigned or missing obligations',()=>{
 for(const mutate of [q=>q.payments[1].month_offset=1,q=>q.payments[1].target_year=1,q=>{q.payments[1].amount+=q.payments.pop().amount;}]){
  const row=agreement();mutate(row.rent_schedule);assert.throws(()=>api.longLetAgreementReceipt(row,'rental'));
 }
});
