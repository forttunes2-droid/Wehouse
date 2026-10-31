import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness(){
 let receipt;const exports={};
 const dependencies={'./supabase/client':{supabase:{rpc:async()=>({data:receipt,error:null})}},'./withTimeout':{withTimeout:task=>task}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/experienceActivities.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>dependencies[name]});
 const row={id:'10000000-0000-4000-8000-000000000001',host_user_id:'host',revision:2,status:'draft',details:exports.emptyExperienceDraft(),created_at:'2026-10-23T10:00:00Z',updated_at:'2026-10-23T10:00:00Z'};
 return{api:exports,row,set:value=>{receipt=value;}};
}
test('Experience saves confirm exact details and expected revision, including an unchanged retry',async()=>{
 const h=harness();
 for(const revision of [2,3]){h.set({activity:{...h.row,revision},issues:[]});assert.equal((await h.api.saveExperienceActivity(h.row.id,2,h.row.details)).activity.revision,revision);}
 for(const patch of [{revision:1},{revision:4},{status:'submitted'},{details:{...h.row.details,title:'Different activity'}}]){
  h.set({activity:{...h.row,...patch},issues:[]});await assert.rejects(h.api.saveExperienceActivity(h.row.id,2,h.row.details),/not confirmed/);
 }
});
test('Experience submit, withdrawal and archive reject stale or unrelated receipts',async()=>{
 const h=harness();
 for(const [action,status] of [['submit','submitted'],['withdraw','withdrawn'],['archive','archived']]){
  const valid={...h.row,status,revision:3};h.set(valid);assert.equal((await h.api.transitionExperienceActivity(h.row,action)).status,status);
  for(const patch of [{revision:2},{host_user_id:'another-host'},{details:{...h.row.details,city:'Different city'}}]){h.set({...valid,...patch});await assert.rejects(h.api.transitionExperienceActivity(h.row,action),/not confirmed/);}
 }
});
test('Experience review cannot acknowledge another revision or host',async()=>{
 const h=harness();h.row.status='submitted';
 for(const decision of ['changes_required','declined']){
  const valid={...h.row,status:decision,revision:3};h.set(valid);assert.equal((await h.api.reviewExperienceActivity(h.row,decision,'Please revise the activity details.')).revision,3);
  for(const patch of [{revision:2},{host_user_id:'another-host'},{details:{...h.row.details,title:'Different application'}}]){h.set({...valid,...patch});await assert.rejects(h.api.reviewExperienceActivity(h.row,decision,'Please revise the activity details.'),/not confirmed/);}
 }
});

test('activity approval requires a complete revision-bound server checklist',async()=>{
 const h=harness();h.row.status='submitted';const checks=Object.fromEntries(Object.keys(h.api.EXPERIENCE_APPROVAL_CHECKS).map(key=>[key,true]));
 const valid={activity_id:h.row.id,revision:2,checks,can_approve:true};h.set(valid);assert.equal((await h.api.getExperienceApprovalReadiness(h.row)).can_approve,true);
 for(const patch of [{activity_id:'other'},{revision:1},{checks:{...checks,identity:false}},{checks:{}},{checks:{...checks,extra:true}},{can_approve:'yes'}]){h.set({...valid,...patch});await assert.rejects(h.api.getExperienceApprovalReadiness(h.row));}
});

test('activity approval confirms the reviewed content, identity of the activity and approval basis',async()=>{
 const h=harness();h.row.status='submitted';const note='Reviewed the actual activity evidence and sessions.';
 const saved={...h.row,status:'approved',revision:3,approved_from_revision:2,approved_by:'reviewer',approved_at:'2026-10-23T12:00:00Z',approval_note:note};
 h.set(saved);assert.equal((await h.api.approveExperienceActivity(h.row,note)).status,'approved');
 for(const patch of [{approved_from_revision:1},{approved_by:'host'},{approved_at:'invalid'},{approval_note:'Different recorded approval basis.'},{revision:4},{details:{...h.row.details,title:'Another activity'}}]){
  h.set({...saved,...patch});await assert.rejects(h.api.approveExperienceActivity(h.row,note));
 }
});

test('Activity commission distinguishes unconfigured from an explicit zero and rejects malformed receipts',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/CreatorExperienceCommission.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:()=>({})});
 const parse=exports.experienceCommissionReceipt;
 assert.equal(parse({configured:false,policy:null}).configured,false);
 for(const percent of [0,9.25,50])assert.equal(parse({configured:true,policy:{policy_key:'commission_experience',version:1,value:{percent}}}).policy.value.percent,percent);
 for(const value of [null,{}, {configured:false,policy:{}},{configured:true,policy:null},...[NaN,-1,51,'10'].map(percent=>({configured:true,policy:{policy_key:'commission_experience',version:1,value:{percent}}}))])assert.throws(()=>parse(value));
});
