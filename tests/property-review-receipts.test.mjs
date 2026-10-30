import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness(){let receipt;const exports={};const deps={'./supabase/client':{supabase:{rpc:async()=>({data:receipt,error:null})}},'./withTimeout':{withTimeout:task=>task}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/propertyReviews.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]});return{api:exports,set:value=>{receipt=value;}};}
const review={review_id:'saved-review',reservation_id:'my-booking',rating:4,comment:'A useful review',created_at:'2026-10-23T10:00:00Z'};
test('property review success requires the booking and exact submitted content',async()=>{
 const h=harness();h.set(review);assert.equal((await h.api.submitBookingReview('my-booking',4,' A useful review ')).review_id,review.review_id);
 for(const patch of [{reservation_id:'other-booking'},{rating:5},{comment:'Different review'},{created_at:'invalid'},{review_id:''}]){h.set({...review,...patch});await assert.rejects(h.api.submitBookingReview('my-booking',4,'A useful review'));}
});
test('tenant and Short Let eligibility must come from a matching server receipt',async()=>{
 const h=harness();for(const stay_type of ['long_stay','short_let']){h.set({reservation_id:'my-booking',stay_type,eligible:true,review:null});assert.equal((await h.api.getBookingReview('my-booking')).stay_type,stay_type);}
 for(const data of [null,{}, {reservation_id:'other',stay_type:'long_stay',eligible:true,review:null},{reservation_id:'my-booking',stay_type:'long_stay',eligible:'yes',review:null}]){h.set(data);await assert.rejects(h.api.getBookingReview('my-booking'));}
});
test('property review entry is present in booking details and tenant wording is no longer guest-only',()=>{
 assert.match(fs.readFileSync('src/pages/MyReservations.tsx','utf8'),/PropertyBookingReview key=/);
 const detail=fs.readFileSync('src/pages/ListingDetailCore.tsx','utf8');assert.match(detail,/Property reviews/);assert.match(detail,/future tenants/);assert.doesNotMatch(detail,/Guest reviews/);
});
