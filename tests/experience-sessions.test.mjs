import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness() {
 let receipt; const exports={}, calls=[];
 const deps={'./supabase/client':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:receipt,error:null};}}},'./withTimeout':{withTimeout:task=>task}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/experienceSessions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]});
 const activity={id:'10000000-0000-4000-8000-000000000001',revision:2,details:{timezone:'Africa/Lagos',duration_minutes:60}};
 const row={id:'10000000-0000-4000-8000-000000000002',activity_id:activity.id,revision:1,activity_revision:2,starts_at:'2040-01-01T10:00:00Z',ends_at:'2040-01-01T11:00:00Z',timezone:'Africa/Lagos',capacity:8,price_minor:250000,currency:'NGN',status:'draft'};
 return {api:exports,activity,row,calls,set:value=>{receipt=value;}};
}
test('session prices preserve minor units and currency precision',()=>{
 const {api}=harness();
 assert.equal(api.sessionPriceMinor('2500.25','NGN'),250025);
 assert.equal(api.sessionPriceMinor('123','JPY'),123);
 assert.equal(api.sessionPriceMinor('1.125','KWD'),1125);
 for(const text of ['0','-1','1e3','NaN','1.234','9007199254740992'])assert.throws(()=>api.sessionPriceMinor(text,'NGN'));
 assert.throws(()=>api.sessionPriceMinor('1.5','JPY'));
});
test('session receipts reject another activity, malformed money and dates',()=>{
 const h=harness();assert.equal(h.api.sessionReceipt(h.row,h.activity.id).capacity,8);
 for(const patch of [{activity_id:'other'},{price_minor:NaN},{price_minor:0},{capacity:101},{revision:0},{ends_at:h.row.starts_at},{timezone:'Invalid/Zone'},{status:'published'},{booking_open:'false'},{availability_revision:-1},{edit_locked:'yes'}])assert.throws(()=>h.api.sessionReceipt({...h.row,...patch},h.activity.id));
});
test('session save confirms exact inputs and response-loss retry',async()=>{
 const h=harness();const save=()=>h.api.saveExperienceSession(h.activity,h.row.id,0,h.row.starts_at,8,250000,'NGN');
 h.set(h.row);assert.equal((await save()).id,h.row.id);assert.equal((await save()).revision,1);
 for(const patch of [{price_minor:1},{capacity:7},{activity_revision:1},{revision:3},{ends_at:'2040-01-01T12:00:00Z'}]){h.set({...h.row,...patch});await assert.rejects(save(),/not confirmed/);}
});
test('session archive must preserve saved date, price and capacity',async()=>{
 const h=harness();h.set({...h.row,status:'archived',revision:2});assert.equal((await h.api.archiveExperienceSession(h.row)).status,'archived');
 for(const patch of [{capacity:3},{price_minor:1},{revision:1}]){h.set({...h.row,status:'archived',revision:2,...patch});await assert.rejects(h.api.archiveExperienceSession(h.row),/not confirmed/);}
});

test('approved-date save retains the reviewed content version',async()=>{
 const h=harness(),activity={...h.activity,status:'approved',revision:3,approved_from_revision:2};
 h.set({...h.row,activity_revision:1});
 assert.equal((await h.api.saveExperienceSession(activity,h.row.id,0,h.row.starts_at,8,250000,'NGN')).activity_revision,1);
 h.set({...h.row,activity_revision:3});
 await assert.rejects(h.api.saveExperienceSession(activity,h.row.id,0,h.row.starts_at,8,250000,'NGN'),/not confirmed/);
});

test('date availability has its own revision and cannot rewrite accepted date or price',async()=>{
 const h=harness(),row={...h.row,revision:4,booking_open:true,availability_revision:2,edit_locked:true};
 const result={...row,booking_open:false,availability_revision:3};h.set(result);
 const saved=await h.api.setExperienceSessionAvailability(row,false);assert.equal(saved.revision,4);
 assert.equal(h.calls[0].name,'set_my_experience_session_availability');assert.equal(h.calls[0].args.p_expected_revision,2);
 for(const patch of [{revision:5},{starts_at:'2040-01-01T11:00:00Z',ends_at:'2040-01-01T12:00:00Z'},{price_minor:1},{capacity:7},{availability_revision:4},{booking_open:true}]){
  h.set({...result,...patch});await assert.rejects(h.api.setExperienceSessionAvailability(row,false),/not be confirmed/);
 }
});

test('review sessions use revision-bound reviewer authority and validate receipts',async()=>{
 const h=harness();h.set([h.row]);
 await h.api.listExperienceSessions(h.activity.id,undefined,3);
 assert.equal(h.calls[0].name,'get_experience_review_sessions');
 assert.equal(h.calls[0].args.p_expected_revision,3);
 await h.api.listExperienceSessions(h.activity.id);
 assert.equal(h.calls[1].name,'get_my_experience_sessions');
 for(const revision of [0,-1,NaN,1.5])await assert.rejects(h.api.listExperienceSessions(h.activity.id,undefined,revision));
 assert.equal(h.calls.length,2);
 for(const data of [[h.row,h.row],[{...h.row,status:'archived'}],[{...h.row,activity_id:'other'}],null]){
  h.set(data);await assert.rejects(h.api.listExperienceSessions(h.activity.id,undefined,3));
 }
});
