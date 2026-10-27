import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const aid='91000000-0000-4000-8000-000000000001',sid='91000000-0000-4000-8000-000000000002',bid='91000000-0000-4000-8000-000000000003',pid='91000000-0000-4000-8000-000000000004';
const details=()=>({title:'Campus guided walk',timezone:'Africa/Lagos',country_code:'NG',duration_minutes:60,what_to_expect:'Guided walk through the campus area.',meeting_area:'Public library entrance',participation_requirements:'Comfortable walking shoes.',accessibility_information:'Ask about assistance.',inclusions:['Guided route'],exclusions:['Transport']});
const contract=()=>({activity_id:aid,activity_revision:3,session_id:sid,session_revision:1,host_user_id:'host',title:'Campus guided walk',activity_details:details(),starts_at:'2027-01-04T10:00:00Z',ends_at:'2027-01-04T11:00:00Z',timezone:'Africa/Lagos',participants:2,price_per_participant_minor:250000,total_minor:500000,currency:'NGN',commission_policy_version_id:pid,commission_percent:10,commission_minor:50000,host_receives_minor:450000,cancellation_policy:'experience_standard_24h_v1',cancellation_deadline:'2027-01-03T10:00:00Z',customer_cancellation_before_deadline:'full_refund',customer_late_cancellation:'review_required',host_cancellation:'full_refund'});
const booking=()=>({id:bid,activity_id:aid,session_id:sid,customer_user_id:'customer',host_user_id:'host',participants:2,status:'pending_payment',expires_at:'2027-01-01T10:15:00Z',created_at:'2027-01-01T10:00:00Z',contract:contract(),payment_id:null,payment_protection_id:null});
function harness(){let value,init;const calls=[],api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/experienceCommerce.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,URL,Intl,Date,Error,require:name=>name.endsWith('/client')?{supabase:{rpc:async(name,args)=>{calls.push({name,args});return{data:value,error:null};}}}:name.endsWith('/housing-payments')?{initializePaymentReference:async()=>({result:init,error:null})}:{withTimeout:p=>p}});return{api,calls,set:v=>{value=v},setInit:v=>{init=v}};}
test('Experience quote binds exact participant arithmetic, currency, saved commission and 24-hour policy',()=>{
 const {api}=harness();assert.equal(api.experienceContract(contract()).total_minor,500000);
 for(const change of [{participants:3},{activity_details:{...details(),inclusions:null}},{activity_details:{...details(),participation_requirements:''}},{currency:'USD'},{commission_percent:10.001},{commission_minor:49999},{host_receives_minor:500000},{cancellation_deadline:'2027-01-03T09:00:00Z'},{customer_late_cancellation:'automatic_refund'},{timezone:'Unknown/Place'},{activity_details:{...details(),duration_minutes:90}}])assert.throws(()=>api.experienceContract({...contract(),...change}));
 const minor=999999999999,percent=9.99,fee=Number((BigInt(minor)*999n+5000n)/10000n);assert.equal(api.experienceContract({...contract(),participants:1,price_per_participant_minor:minor,total_minor:minor,commission_percent:percent,commission_minor:fee,host_receives_minor:minor-fee}).commission_minor,fee);
});
test('a capacity hold cannot manufacture a paid booking or change its customer, session or participants',()=>{
 const {api}=harness();assert.equal(api.experienceBooking(booking()).status,'pending_payment');
 for(const patch of [{host_user_id:'customer'},{session_id:aid},{participants:3},{status:'confirmed'},{status:'completed',payment_id:pid}])assert.throws(()=>api.experienceBooking({...booking(),...patch}));
});
test('hold response must match accepted terms, independent of JSON object key order',async()=>{
 const h=harness(),q={contract:contract(),contract_hash:'a'.repeat(64),remaining:8};const reordered={...booking(),contract:Object.fromEntries(Object.entries(contract()).reverse())};reordered.contract.activity_details=Object.fromEntries(Object.entries(details()).reverse());h.set(reordered);assert.equal((await h.api.holdExperience(bid,q)).id,bid);
 h.set({...booking(),contract:{...contract(),title:'Another activity',activity_details:{...details(),title:'Another activity'}}});await assert.rejects(h.api.holdExperience(bid,q),/accepted terms/);
 assert.equal(h.calls[0].args.p_contract_hash,q.contract_hash);
});
test('quote and booking reads reject unrelated receipts and duplicate history entries',async()=>{
 const h=harness();h.set({contract:contract(),contract_hash:'a'.repeat(64),remaining:8});await assert.rejects(h.api.getExperienceQuote(aid,2));await assert.rejects(h.api.getExperienceQuote(sid,1));
 h.set({...booking(),id:pid});await assert.rejects(h.api.getExperienceBooking(bid));h.set([booking(),booking()]);await assert.rejects(h.api.getExperienceBookings());
});
test('checkout accepts only its canonical reference and an HTTPS Paystack destination',async()=>{
 const h=harness(),ref='WHEX_'+bid.replaceAll('-','');h.set({booking_id:bid,payment_id:pid,reference:ref,already_paid:false});h.setInit({success:true,reference:ref,authorization_url:'https://checkout.paystack.com/synthetic'});assert.equal((await h.api.initializeExperiencePayment(bid)).url,'https://checkout.paystack.com/synthetic');
 for(const init of [{success:true,reference:'other',authorization_url:'https://checkout.paystack.com/synthetic'},{success:true,reference:ref,authorization_url:'https://checkout.paystack.com.attacker.invalid/synthetic'},{success:true,reference:ref,authorization_url:'http://checkout.paystack.com/synthetic'},{success:false,error:'Hold expired'}]){h.setInit(init);await assert.rejects(h.api.initializeExperiencePayment(bid));}
 h.set({...booking(),booking_id:aid,payment_id:pid,reference:ref,already_paid:true});await assert.rejects(h.api.initializeExperiencePayment(bid));
});
