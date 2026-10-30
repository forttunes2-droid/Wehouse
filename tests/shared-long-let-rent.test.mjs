import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fixture=JSON.parse(fs.readFileSync('tests/browser/shared-rent-fixtures.json','utf8'));
function module(path,imports={}){const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:name=>imports[name]||{},URL,AbortSignal,Number,Date,Promise});return api;}
const terms=module('src/lib/longLetRentTerms.ts');
const shared=module('src/lib/sharedLongLetRent.ts',{'./longLetRentTerms':terms});
const api=module('src/lib/supabase/shared-housing.ts',{'../sharedLongLetRent':shared});
const copy=()=>structuredClone(fixture.quote);

test('actual rollback-only server quote preserves each annual, initial and later-year rent share',()=>{
 const quote=shared.sharedRentQuoteReceipt(fixture.quote,fixture.fee_paid.id,fixture.offer.reservation_id);
 assert.equal(quote.agreement.rent_schedule.due_before_handover,1200000);
 for(const payer of quote.payer_agreements){
  assert.equal(payer.rent_schedule.annual_rent,600000);
  assert.equal(payer.rent_schedule.due_before_handover,600000);
  assert.equal(payer.rent_schedule.payments.length,9);
  assert.equal(payer.rent_schedule.payments[1].amount,75000);
  assert.equal(payer.rent_schedule.payments[1].wehouse_amount,7500);
  assert.equal(payer.rent_schedule.payments[1].partner_net_amount,67500);
 }
});

test('shared quotes reject lost minor units, duplicate payers, wrong parent terms and conflicting fee/net allocations',()=>{
 const changes=[
  q=>q.payer_agreements[0].rent_schedule.payments[1].amount+=0.01,
  q=>q.payer_agreements[0].rent_schedule.payments[1].wehouse_amount+=1,
  q=>q.payer_agreements[0].rent_schedule.payments[1].partner_net_amount-=1,
  q=>q.payer_agreements[0].parent_agreement_digest='0'.repeat(32),
  q=>q.payer_agreements[1].payer_user_id=q.payer_agreements[0].payer_user_id,
  q=>q.payer_agreements.pop(),
  q=>q.payer_agreements[1].rent_schedule.term_months=36,
 ];
 for(const change of changes){const quote=copy();change(quote);assert.throws(()=>shared.sharedRentQuoteReceipt(quote,fixture.fee_paid.id,fixture.offer.reservation_id));}
});

test('acceptance is attached to the individual reviewed payer, never a different friend',()=>{
 assert.equal(shared.sharedRentAgreementReceipt(fixture.peer_accepted.rent_agreement,fixture.offer.reservation_id,'rent-outsider').accepted_by,'rent-outsider');
 assert.throws(()=>shared.sharedRentAgreementReceipt(fixture.peer_accepted.rent_agreement,fixture.offer.reservation_id,'rent-customer'));
 const wrong=structuredClone(fixture.peer_accepted.rent_agreement);wrong.accepted_by='rent-customer';
 assert.throws(()=>shared.sharedRentAgreementReceipt(wrong,fixture.offer.reservation_id));
});

test('starting shared rent sends the reviewed term and digest and requires the committed individual acceptance',async()=>{
 const calls=[];let response=fixture.started;
 const client=module('src/lib/sharedLongLetRent.ts',{'./longLetRentTerms':terms,'./withTimeout':{withTimeout:p=>p},'./supabase/client':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return{data:response,error:null};}}}});
 await client.startSharedRent(fixture.quote,'rent-customer');
 assert.equal(calls[0].name,'start_my_shared_contract_split');
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)),{p_group_id:fixture.quote.group_id,p_term_months:24,p_payment_choice:'monthly',p_quote_digest:fixture.quote.agreement.quote_digest});
 response={...fixture.started,checkout_attempt:fixture.started.checkout_attempt+1};
 await assert.rejects(()=>client.startSharedRent(fixture.quote,'rent-customer'));
 response={...fixture.started,rent_agreement:fixture.peer_accepted.rent_agreement};
 await assert.rejects(()=>client.startSharedRent(fixture.quote,'rent-customer'));
});

test('shared arrival receipts bind the exact reservation and fail closed on malformed dates or status',()=>{
 const arrival=fixture.occupied.arrival;
 assert.equal(api.sharedHomeArrivalReceipt(arrival,fixture.offer.reservation_id).booking_code,arrival.booking_code);
 assert.equal(api.sharedHomeArrivalReceipt(null,fixture.offer.reservation_id),null);
 for(const patch of [{reservation_id:'another-booking'},{status:'payment_pending'},{booking_code:''},{address:{}},{requested_move_in_at:'not-a-date'},{tenancy_start_date:undefined}])assert.throws(()=>api.sharedHomeArrivalReceipt({...arrival,...patch},fixture.offer.reservation_id));
});
