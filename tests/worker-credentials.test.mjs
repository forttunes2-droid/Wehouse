import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {File} from 'node:buffer';
function load(path,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name],crypto:webcrypto,Uint8Array,TextDecoder,Date});return exports;}
const policy=load('src/lib/propertyDocuments.ts');
test('worker credential uploads share document validation and use their own scoped RPC and private bucket',async()=>{
 const calls=[];const document={id:'credential',request_id:'worker',requirement_code:'licence',object_path:'worker/credential.pdf',original_name:'licence.pdf',mime_type:'application/pdf',byte_size:9,requirements_revision:1,version:1,status:'uploading'};
 const api=load('src/lib/supabase/reviewed-documents.ts',{'./client':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return{data:name.startsWith('begin')?document:{...document,status:'submitted',submitted_at:'2026-10-20T12:00:00Z'},error:null};},storage:{from:bucket=>({upload:async()=>{calls.push({bucket});return{error:null};}})}}},'@/lib/withTimeout':{withTimeout:async value=>await value},'@/lib/safeAction':{runSafeAction:async(_key,action)=>await action(),requestKeyFor:()=> 'request-key',releaseRequestKey(){}},'@/lib/propertyDocuments':policy});
 const result=await api.submitReviewedDocument('worker','licence',new File(['%PDF-1.7\n'],'licence.pdf',{type:'application/pdf'}),'worker');assert.equal(result.status,'submitted');assert.equal(calls[0].name,'begin_worker_credential_upload');assert.equal(calls[0].args.p_worker_id,'worker');assert.equal(calls[0].args.p_request_id,undefined);assert.equal(calls[1].bucket,'worker-credentials');assert.equal(calls[2].name,'finish_worker_credential_upload');
});
test('a contradictory or malformed credential review cannot become a ready screen',()=>{
 const base={configured:true,revision:1,ready:false,can_review:false,can_submit:false,requirements:[],documents:[],context_current:false};
 for(const changes of [{ready:true},{can_submit:true},{context_current:'true'},{service_context:{coverage:'invalid'}},{service_context:{coverage:[{state:42,lga:'Ikeja'}]}}])assert.throws(()=>policy.parsePropertyDocumentReview({...base,...changes}));
 assert.equal(policy.propertyDocumentStatus({status:'approved',expires_at:'not-a-date'}),'Expiry unavailable');
});
test('active onboarding separates supporting work documents from required credentials',()=>{
 for(const path of ['src/pages/ServiceProviderVerification.tsx','src/pages/WorkerVerificationPhase9.tsx']){const source=fs.readFileSync(path,'utf8');assert.match(source,/WorkerCredentials/);assert.doesNotMatch(source,/Certificate · optional|A certificate is optional/);}
 for(const path of ['src/components/StaffWorkerReviewModern.tsx','src/components/CreatorWorkerOversight.tsx','src/pages/AdminDashboard.tsx'])assert.match(fs.readFileSync(path,'utf8'),/WorkerCredentials/);
});
test('unused raw government-ID and parallel review client writers are retired',()=>{
 const source=fs.readFileSync('src/lib/supabase/workers.ts','utf8');assert.doesNotMatch(source,/submitWorkerVerification|reviewWorkerVerification|gov_id_number|getWorkerDashboardData|getWorkerSystemStats/);
});

test('unused bio status and legacy subscription client contracts are retired',()=>{
 const workers=fs.readFileSync('src/lib/supabase/workers.ts','utf8');
 const types=fs.readFileSync('src/types/index.ts','utf8');
 assert.doesNotMatch(workers,/parseWorkerStatus|getPendingWorkers|getAllWorkers/);
 assert.doesNotMatch(types,/LegacyWorkerSubscription|GovIdType|gov_id_number|WORKER_VERIFICATION_STATUS_/);
 assert.equal(fs.existsSync('src/components/WorkerProfilePanelV2.tsx'),false);
});
