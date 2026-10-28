import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const id='bb290000-0000-4000-8000-000000000001',booking='bb290000-0000-4000-8000-000000000002';
const stamp='2026-10-28T08:00:00.000Z';
const saved={id,booking_id:null,experience_booking_id:booking,rating:5,comment:'Helpful activity',created_at:stamp,updated_at:stamp,hidden_at:null,moderation_reason:null};
function api(response){const calls=[];const exports={};const code=ts.transpileModule(readFileSync('src/lib/providerReviews.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:name=>name.includes('withTimeout')?{withTimeout:async promise=>promise}:{supabase:{rpc:async(name,args)=>{calls.push({name,args});return typeof response==='function'?response(name,args):response}}}});return{...exports,calls};}
test('review submission validates the exact booking, stars and saved comment',async()=>{
 const client=api({data:saved,error:null});assert.equal((await client.submitExperienceReview(booking,5,' Helpful activity ',null)).id,id);assert.equal(client.calls[0].args.p_comment,'Helpful activity');
 for(const data of [{...saved,experience_booking_id:id},{...saved,rating:4},{...saved,comment:'Unrelated content'},{...saved,booking_id:id}])await assert.rejects(api({data,error:null}).submitExperienceReview(booking,5,'Helpful activity',null));
});
test('saved review requires a valid retained record rather than any truthy response',async()=>{
 for(const data of [null,true,{}, {...saved,updated_at:'invalid'}, {...saved,hidden_at:'invalid'}, {...saved,experience_booking_id:null}])await assert.rejects(api({data,error:null}).submitExperienceReview(booking,5,'Helpful activity',null));
});
test('eligibility must identify the exact customer booking and contain a real boolean',async()=>{
 assert.equal((await api({data:{booking_id:booking,eligible:false,review:null}}).getExperienceReview(booking)).eligible,false);
 for(const data of [null,{booking_id:id,eligible:true,review:null},{booking_id:booking,eligible:'true',review:null},{booking_id:booking,eligible:true,review:{...saved,experience_booking_id:id}}])await assert.rejects(api({data}).getExperienceReview(booking));
});
test('review failures never become an empty public page',async()=>{
 await assert.rejects(api({data:null,error:{message:'Unavailable'}}).getExperienceReviews(id));
 await assert.rejects(api({data:{items:[],summary:{count:1,rating:0}}}).getExperienceReviews(id));
 const empty={items:[],summary:{count:0,rating:null}};assert.equal((await api({data:empty}).getExperienceReviews(id)).summary.count,0);
});
test('public review cursor is bound to both the timestamp and unique ID',async()=>{
 const client=api({data:{items:[],summary:{count:0,rating:null}}});await client.getExperienceReviews(id,{id,created_at:stamp});assert.equal(client.calls[0].args.p_before,stamp);assert.equal(client.calls[0].args.p_before_id,id);
});
test('moderation preserves reported evidence and validates the exact outcome',async()=>{
 const row={report_id:id,status:'actioned',snapshot:{rating:5,comment:'Reported evidence',updated_at:stamp,title:'Activity'},review:{...saved,hidden_at:stamp,moderation_reason:'A clear moderation reason'},context:{title:'Activity',state:null,area:null},can_moderate:true};
 const client=api({data:row});assert.equal((await client.moderateReview(id,true,'A clear moderation reason',stamp,id)).snapshot.comment,'Reported evidence');assert.equal(client.calls[0].args.p_expected_updated_at,stamp);
 for(const data of [{...row,report_id:booking},{...row,review:saved},{...row,snapshot:{}},{...row,can_moderate:'true'}])await assert.rejects(api({data}).moderateReview(id,true,'A clear moderation reason',stamp,id));
});


test('review decisions open the exact retained booking even without a loaded chat',()=>{
 const exports={};const code=ts.transpileModule(readFileSync('src/lib/activityFeed.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:()=>({activityWorkspaceMatches:()=>true})});
 const resolve=exports.resolveActivityDestination;
 assert.deepEqual(JSON.parse(JSON.stringify(resolve({type:'provider_review_moderation',source_type:'worker_booking',source_id:booking,destination_route:'my_bookings',destination_params:{booking_id:booking,review_reference:id}}))),{route:'service_booking',id:booking});
 assert.equal(resolve({type:'provider_review_moderation',source_type:'experience_booking',source_id:booking,destination_route:'experience_booking',destination_params:{booking_id:booking}}).route,'experience_booking');
 assert.equal(resolve({type:'provider_review_moderation',source_type:'worker_booking',source_id:booking,destination_route:'conversation',destination_params:{booking_id:booking,conversation_id:id}}).id,id);
});

test('appeal receipts bind the author review and validate real status and resolution',async()=>{
 const row={review_id:id,moderation_request_id:booking,eligible:true,appeal:null};
 const client=api({data:row});assert.equal((await client.getReviewAppeal(id)).eligible,true);
 for(const data of [{...row,review_id:booking},{...row,eligible:'true'},{...row,moderation_request_id:null},{...row,appeal:{}},{...row,appeal:undefined}])await assert.rejects(api({data}).getReviewAppeal(id));
 const receipt={...row,eligible:false,appeal:{id:booking,status:'open',explanation:'Please review the decision.',created_at:stamp,resolved_at:null,decision:null,outcome:null}};
 const submitted=api({data:receipt});assert.equal((await submitted.submitReviewAppeal(id,booking,' Please review the decision. ',id)).appeal.id,booking);assert.equal(submitted.calls[0].args.p_explanation,'Please review the decision.');assert.equal(submitted.calls[0].args.p_moderation_request_id,booking);
 for(const change of [{status:'success'},{outcome:'automatically restored'},{resolved_at:'invalid'},{explanation:42},{decision:{private:'note'}}])await assert.rejects(api({data:{...receipt,appeal:{...receipt.appeal,...change}}}).getReviewAppeal(id));
 await assert.rejects(api({data:row}).submitReviewAppeal(id,booking,'Please review the decision.',id));
 await assert.rejects(api({error:{message:'Unavailable'}}).getReviewAppeal(id));
});
