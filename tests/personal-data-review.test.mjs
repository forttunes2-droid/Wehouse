import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/personalDataReview.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const receipt={conversation_id:'a',case_id:'99700000-2000-4000-8000-000000000001',case_number:123,reason_code:'personal_data_deletion',status:'investigating',revision:'2026-10-29T10:00:00Z',can_respond:true,response:null};
test('personal-data requests prepare distinct existing account Help drafts and perform no mutations',()=>{
 for(const kind of ['access','correction','deletion']){
  const r=exports.personalDataRequest(kind,'me');assert.equal(r.contextType,'contextual_help');assert.equal(r.contextSnapshot.reason_code,'personal_data_'+kind);assert.equal(r.contextSnapshot.subject_type,'account');assert.equal(r.contextSnapshot.source_id,'me');assert.equal(r.conversationId,undefined);
 }
});
test('review receipts reject unrelated records, impossible status and untrusted response shapes',()=>{
 assert.equal(exports.personalDataReview(receipt,'a'),receipt);
 for(const change of [{conversation_id:'another'},{case_id:'wrong'},{case_number:NaN},{status:'erased'},{can_respond:'true'},{reason_code:'account_access'},{revision:'invalid'},{response:{}},{response:{request_id:receipt.case_id,outcome:'automatic_erasure',completed:'',retained:'',responded_at:receipt.revision}}])assert.throws(()=>exports.personalDataReview({...receipt,...change},'a'));
 const result={...receipt,status:'resolved',can_respond:false,response:{request_id:receipt.case_id,outcome:'partly_completed',completed:'Reviewed actions actually completed.',retained:'Booking evidence retained for unresolved claim.',responded_at:receipt.revision}};
 assert.equal(exports.personalDataReview(result,'a').response.retained,result.response.retained);
});
test('export approval receipts bind an access request and reject forged or malformed grants',()=>{
 const access={decision_id:receipt.case_id,approval_id:receipt.case_id,can_download:true,sections:['account'],prepared_sections:[],scope_note:'Account records; supplementary data remains under review.'};
 const value={...receipt,reason_code:'personal_data_access',export:access};assert.equal(exports.personalDataReview(value,'a').export,access);
 for(const patch of [{approval_id:null},{decision_id:'wrong'},{sections:['account','account']},{prepared_sections:['private_internal_notes']},{can_download:'true'},{scope_note:null}])assert.throws(()=>exports.personalDataReview({...value,export:{...access,...patch}},'a'));
 assert.throws(()=>exports.personalDataReview({...receipt,export:access},'a'));
});
