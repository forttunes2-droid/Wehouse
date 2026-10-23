import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {File} from 'node:buffer';

function harness(){
 const id='10000000-0000-4000-8000-000000000001',asset='10000000-0000-4000-8000-000000000002';
 const row={id:asset,activity_id:id,revision:1,object_path:`${id}/${asset}.jpg`,byte_size:9,caption:'Orientation route',context_current:true,status:'uploading'};
 const state={row:{...row},data:undefined,uploads:0,released:0,lost:false,previews:null,calls:[]};
 const client={rpc:async(name,args)=>{
  state.calls.push({name,args});if(state.data!==undefined)return{data:state.data,error:null};
  if(name==='begin_experience_activity_photo')return{data:state.row,error:null};
  if(name==='finish_experience_activity_photo'){state.row={...state.row,revision:2,status:'submitted'};if(state.lost)throw Error('Failed to fetch');return{data:state.row,error:null};}
  return{data:[state.row],error:null};
 },storage:{from:()=>({upload:async()=>{state.uploads++;return{error:null};},createSignedUrls:async()=>({data:state.previews,error:null})})}};
 const exports={};const deps={
  './supabase/client':{supabase:client},'./supabase/utils':{compressImageFile:async()=>new Blob(['123456789'],{type:'image/jpeg'})},
  './safeAction':{requestKeyFor:()=>asset,releaseRequestKey:()=>state.released++,runSafeAction:(_key,work)=>work(),isNetworkFailure:err=>/failed to fetch/i.test(err.message)},
  './withTimeout':{withTimeout:task=>task},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/experiencePhotos.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name],crypto:webcrypto,Uint8Array,Blob});
 return{api:exports,state,row,activity:{id,revision:1},file:new File(['image'],'route.png',{type:'image/png'})};
}

test('photo receipts reject another activity, object, invalid state or unbounded data',()=>{
 const h=harness();assert.equal(h.api.photoReceipt(h.row,h.activity.id).id,h.row.id);
 for(const patch of [{activity_id:'other'},{object_path:'other/photo.jpg'},{byte_size:2000001},{revision:0},{context_current:null},{status:'published'},{caption:'x'}])assert.throws(()=>h.api.photoReceipt({...h.row,...patch},h.activity.id));
});
test('photo lists cannot hide duplicate, oversized or archived receipts',async()=>{
 const h=harness();for(const data of [[h.row,h.row],Array(21).fill(h.row),[{...h.row,status:'archived'}],null]){h.state.data=data;await assert.rejects(h.api.listExperiencePhotos(h.activity.id));}
});
test('lost photo submission response retains recovery key and never reuploads a completed asset',async()=>{
 const h=harness();h.state.lost=true;
 await assert.rejects(h.api.uploadExperiencePhoto(h.activity,h.file,h.row.caption),/result is unknown/);
 assert.equal(h.state.uploads,1);assert.equal(h.state.released,0);
 h.state.lost=false;const saved=await h.api.uploadExperiencePhoto(h.activity,h.file,h.row.caption);
 assert.equal(saved.status,'submitted');assert.equal(h.state.uploads,1);assert.equal(h.state.released,1);
});
test('photo reservation must match the prepared file and exact caption before storage access',async()=>{
 for(const patch of [{byte_size:8},{caption:'Another photo'},{context_current:false},{status:'archived'}]){
  const h=harness();h.state.row={...h.row,...patch};await assert.rejects(h.api.uploadExperiencePhoto(h.activity,h.file,h.row.caption));assert.equal(h.state.uploads,0);
 }
});
test('photo preview batch must acknowledge every requested object exactly once',async()=>{
 const h=harness();const row={...h.row,status:'submitted'},second={...row,id:'10000000-0000-4000-8000-000000000003',object_path:h.activity.id+'/10000000-0000-4000-8000-000000000003.jpg'};
 for(const data of [null,[],[{path:'wrong',signedUrl:'https://example.invalid/photo'}],[{path:row.object_path,signedUrl:'https://example.invalid/photo'},{path:row.object_path,signedUrl:'https://example.invalid/photo'}]]){
  h.state.previews=data;await assert.rejects(h.api.experiencePhotoPreviews([row,second]));
 }
 h.state.previews=[{path:row.object_path,signedUrl:'https://example.invalid/photo'}];assert.equal((await h.api.experiencePhotoPreviews([row]))[row.object_path],'https://example.invalid/photo');
});
