import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/lib/supabase/workers-public.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const filters={country:'NG',query:'Keffi cleaner',category:'Home care',specialty:'Cleaning',state:'Nasarawa',city:'Keffi'};
const photoApi={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/serviceOfferPhotos.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:photoApi,require:name=>name==='./supabase/client'?{supabase:{}}:name==='./supabase/utils'?{}:name==='./withTimeout'?{withTimeout:async task=>task}:(()=>{throw Error('Unexpected photo dependency '+name);})(),Error,Set,Map,Promise,Number,Array});
const row=id=>({user_id:id,rating:4.5,review_count:3,full_name:'Public provider'});
function harness(result){const api={},calls=[];vm.runInNewContext(code,{exports:api,require:name=>name==='./client'?{supabase:{rpc:async(name,args)=>{calls.push({name,args});return result;}}}:name==='@/lib/serviceOfferPhotos'?photoApi:name==='@/lib/withTimeout'?{withTimeout:async task=>task}:(()=>{throw Error('Unexpected import '+name);})(),Error,Set,Map,Promise,Number,Array});return{api,calls};}
test('service pages keep the complete filter/cursor contract and bound typed text',async()=>{
 const items=Array.from({length:24},(_,i)=>row('provider-'+(24-i))),next_cursor={id:'provider-1',rating:4.5,reviews:3};
 const h=harness({data:{items,has_more:true,next_cursor},error:null});const result=await h.api.searchServiceProviders({...filters,query:'a'.repeat(90)},next_cursor);
 assert.equal(result.workers.length,24);assert.equal(result.hasMore,true);assert.equal(result.nextCursor.id,'provider-1');
 assert.equal(h.calls[0].name,'search_service_providers');assert.equal(h.calls[0].args.p_query.length,80);assert.equal(h.calls[0].args.p_category,'Home care');assert.equal(h.calls[0].args.p_specialty,'Cleaning');assert.equal(h.calls[0].args.p_state,'Nasarawa');assert.equal(h.calls[0].args.p_city,'Keffi');assert.equal(h.calls[0].args.p_country,'NG');assert.equal(h.calls[0].args.p_after_id,'provider-1');
});
test('malformed or repeated service receipts cannot masquerade as an empty or complete search',async()=>{
 for(const data of [{items:[],has_more:'false'},{items:Array.from({length:25},(_,i)=>row('id-'+i)),has_more:false},{items:[row('a'),row('a')],has_more:false},{items:[{...row('a'),rating:null}],has_more:false},{items:[{...row('a'),review_count:-1}],has_more:false},{items:[row('a')],has_more:true,next_cursor:{id:'a',rating:4.5,reviews:3}}]){
  await assert.rejects(harness({data,error:null}).api.searchServiceProviders(filters));
 }
 const items=Array.from({length:24},(_,i)=>row('id-'+i));
 await assert.rejects(harness({data:{items,has_more:true,next_cursor:{id:'wrong-person',rating:4.5,reviews:3}},error:null}).api.searchServiceProviders(filters));
});
test('shared Provider lookups are bounded, deduplicated and reject another returned identity',async()=>{
 const h=harness({data:[row('known')],error:null});assert.equal((await h.api.getServiceProvidersByIds(['known','known'])).length,1);assert.equal(h.calls[0].args.p_ids.length,1);
 await assert.rejects(h.api.getServiceProvidersByIds(Array.from({length:13},(_,i)=>'id-'+i)));assert.equal(h.calls.length,1);
 await assert.rejects(harness({data:[row('another-person')],error:null}).api.getServiceProvidersByIds(['known']));
 assert.equal((await harness({data:[],error:null}).api.getServiceProvidersByIds(['unavailable'])).length,0);
});
test('failed search and link reads stay failures rather than showing fabricated results',async()=>{
 const h=harness({data:null,error:{message:'Synthetic unavailable'}});
 await assert.rejects(h.api.searchServiceProviders(filters),/Synthetic unavailable/);await assert.rejects(h.api.getServiceProvidersByIds(['known']),/Synthetic unavailable/);
});
test('service search covers must belong to the returned Provider and exact offering',async()=>{
 const id='9755d000-1000-4000-8000-000000000001',photoId='9755d000-2000-4000-8000-000000000001';
 const prefix=`known/${id}/${photoId}/`,cover={id:photoId,image:prefix+'full.jpg',preview:prefix+'preview.jpg',caption:'This service'};
 const offer={id,name:'Cleaning',price:1000,price_type:'starting_from',cover};
 const receipt=value=>harness({data:{items:[{...row('known'),service_offer:value}],has_more:false},error:null}).api.searchServiceProviders(filters);
 assert.equal((await receipt(offer)).workers[0].service_offer.cover.preview,cover.preview);
 for(const bad of [{...offer,id:'another-service'},{...offer,price:-1},{...offer,cover:{...cover,preview:'someone-else/preview.jpg'}},{...offer,cover:{...cover,caption:''}}])await assert.rejects(receipt(bad));
});
