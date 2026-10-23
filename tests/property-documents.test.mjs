import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { File } from 'node:buffer';
function moduleAt(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports, require(name){if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name]}, TextDecoder, Uint8Array, Blob, Date, crypto:webcrypto});
  return exports;
}
const policy=moduleAt('src/lib/propertyDocuments.ts');
test('private property documents accept actual supported signatures, rejecting disguised and oversized files',async()=>{
  for(const [type,bytes] of [['application/pdf','%PDF-1.7\n'],['image/jpeg',new Uint8Array([255,216,255,224])],['image/png',new Uint8Array([137,80,78,71,13,10,26,10])],['image/webp','RIFF0000WEBP']])await policy.validatePropertyDocument(new Blob([bytes],{type}));
  for(const blob of [new Blob(['<html>not a PDF</html>'],{type:'application/pdf'}),new Blob(['%PDF-'],{type:'image/png'}),new Blob(['<svg/>'],{type:'image/svg+xml'}),new Blob([],{type:'application/pdf'}),new Blob([new Uint8Array(10485761)],{type:'application/pdf'})])await assert.rejects(()=>policy.validatePropertyDocument(blob));
});
test('document status distinguishes expired approval and an unfinished upload',()=>{
  assert.equal(policy.propertyDocumentStatus(), 'Not submitted');
  assert.equal(policy.propertyDocumentStatus({status:'approved',expires_at:'2020-01-01T00:00:00Z'}),'Expired');
  assert.equal(policy.propertyDocumentStatus({status:'uploading',expires_at:null}),'Upload unfinished');
  assert.equal(policy.propertyDocumentStatus({status:'correction_required',expires_at:null}),'Correction required');
});
test('malformed document data never becomes an empty queue or an approval',()=>{
  for(const value of [null,{}, {configured:true,revision:1,ready:true,can_review:true,can_submit:false,requirements:[],documents:[{status:'verified'}]}])assert.throws(()=>policy.parsePropertyDocumentReview(value));
  const value={configured:false,revision:0,ready:false,can_review:false,can_submit:false,requirements:[],documents:[]};
  assert.equal(policy.parsePropertyDocumentReview(value).ready,false);
});
function setup(){
  const calls=[];let status='uploading';let uncertain=false;let released=0;let receiptPatch={};
  const doc=()=>({id:'document-1',request_id:'request-1',requirement_code:'authority',object_path:'request-1/document-1.pdf',original_name:'authority.pdf',mime_type:'application/pdf',byte_size:9,requirements_revision:1,version:1,status,submitted_at:status==='uploading'?null:'2026-10-19T12:00:00Z'});
  const client={rpc:async(name,args)=>{calls.push([name,args]);if(name==='begin_property_document_upload')return{data:doc(),error:null};status='submitted';if(uncertain)throw Error('Lost submission response');return{data:{...doc(),...receiptPatch},error:null}},storage:{from:()=>({upload:async(path,_file,options)=>{calls.push(['upload',{path,options}]);return{error:{statusCode:'409',message:'The resource already exists'}}}})}};
  const api=moduleAt('src/lib/supabase/reviewed-documents.ts',{'./client':{supabase:client},'@/lib/withTimeout':{withTimeout:async promise=>await promise},'@/lib/safeAction':{runSafeAction:async(_key,action)=>await action(),requestKeyFor:()=> 'stable-request-key',releaseRequestKey:()=>{released++}},'@/lib/propertyDocuments':policy});
  return{api,calls,setStatus(value){status=value},setReceiptPatch(value){receiptPatch=value},setUncertain(){uncertain=true},released:()=>released};
}
const file=()=>new File(['%PDF-1.7\n'], 'authority.pdf',{type:'application/pdf'});

test('submission cannot confirm another document, requirement or immutable upload',async()=>{
 for(const patch of [{id:'other'},{request_id:'other'},{requirement_code:'other'},{object_path:'other/file.pdf'},{byte_size:10},{mime_type:'image/png'},{requirements_revision:2},{version:2}]){
  const state=setup();state.setReceiptPatch(patch);
  await assert.rejects(state.api.submitReviewedDocument('request-1','authority',file()),/not been confirmed/);
  assert.equal(state.released(),0);
 }
});

test('finish and discard require the exact requested document and outcome',async()=>{
 const wrong=setup();wrong.setReceiptPatch({id:'other'});await assert.rejects(wrong.api.finishReviewedDocument('document-1'));
 const notDiscarded=setup();await assert.rejects(notDiscarded.api.finishReviewedDocument('document-1',true));
 const discarded=setup();discarded.setReceiptPatch({status:'abandoned'});assert.equal((await discarded.api.finishReviewedDocument('document-1',true)).status,'abandoned');
});
test('document retry uses its existing immutable object and requires the server submission receipt',async()=>{
  const state=setup();const result=await state.api.submitReviewedDocument('request-1','authority',file());
  assert.equal(result.status,'submitted');assert.equal(state.released(),1);
  assert.equal(state.calls[0][1].p_request_key,'stable-request-key');assert.equal(state.calls[1][1].options.upsert,false);
  assert.equal(state.calls[2][0],'finish_property_document_upload');
});
test('lost confirmation preserves its request key and a replay does not upload another version',async()=>{
  const state=setup();state.setUncertain();
  await assert.rejects(()=>state.api.submitReviewedDocument('request-1','authority',file()),/Lost submission response/);
  assert.equal(state.released(),0);
  const second=await state.api.submitReviewedDocument('request-1','authority',file());assert.equal(second.status,'submitted');
  assert.equal(state.calls.filter(([name])=>name==='upload').length,1);
});
test('invalid document bytes never reserve storage or submit a request',async()=>{
  const state=setup();await assert.rejects(()=>state.api.submitReviewedDocument('request-1','authority',new File(['<html/>'],'authority.pdf',{type:'application/pdf'})));
  assert.equal(state.calls.length,0);
});
