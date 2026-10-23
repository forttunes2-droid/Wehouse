import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function moduleAt(path,supabase) {
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Date,require:()=>({supabase})});return exports;
}
function query(response) {
  const calls=[];const chain={calls};
  for(const name of ['update','delete','eq','select','order'])chain[name]=(...args)=>{calls.push([name,...args]);return chain;};
  chain.maybeSingle=async()=>response;chain.then=(resolve,reject)=>Promise.resolve(response).then(resolve,reject);return chain;
}
test('notification preference requires the owned persisted value before success',async()=>{
  for(const data of [null,{user_id:'other',pref_push_notif:false},{user_id:'person',pref_push_notif:true}]) {
    const q=query({data,error:null});const api=moduleAt('src/lib/supabase/notification-preferences.ts',{from:()=>q});
    assert.ok((await api.saveNotificationPreference('person','auth-person','pref_push_notif',false)).error);
    assert.ok(q.calls.some(row=>row[0]==='eq'&&row[1]==='auth_id'&&row[2]==='auth-person'));
  }
  const api=moduleAt('src/lib/supabase/notification-preferences.ts',{from:()=>query({data:{user_id:'person',pref_push_notif:false},error:null})});
  assert.equal((await api.saveNotificationPreference('person','auth-person','pref_push_notif',false)).error,null);
});
test('followed-search mutations reject missing, wrong and contradictory receipts',async()=>{
  for(const data of [null,{id:'other',notifications_enabled:false},{id:'search',notifications_enabled:true}]) {
    const api=moduleAt('src/lib/supabase/saved-searches.ts',{from:()=>query({data,error:null})});
    assert.ok((await api.setSavedSearchAlerts('search',false)).error);
  }
  const missing=moduleAt('src/lib/supabase/saved-searches.ts',{from:()=>query({data:null,error:null})});
  assert.ok((await missing.removeSavedSearch('search')).error);
  const good=moduleAt('src/lib/supabase/saved-searches.ts',{from:()=>query({data:{id:'search',notifications_enabled:false},error:null})});
  assert.equal((await good.setSavedSearchAlerts('search',false)).error,null);
  assert.equal((await good.removeSavedSearch('search')).error,null);
});
test('malformed followed-search data is a read error, not a fake empty list',async()=>{
  for(const data of [{},[{id:'search',name:{invalid:true}}]]) {
    const api=moduleAt('src/lib/supabase/saved-searches.ts',{from:()=>query({data,error:null})});assert.ok((await api.getMySavedSearches()).error);
  }
});
test('Activity needs a boolean read receipt and numeric bulk-read count',async()=>{
  for(const data of [null,false,'true',{}]) {
    const api=moduleAt('src/lib/supabase/activity.ts',{rpc:async()=>({data,error:null})});
    assert.ok((await api.markCanonicalActivityRead('event','personal')).error);
    assert.ok((await api.markAllCanonicalActivityRead('personal')).error);
  }
  const good=moduleAt('src/lib/supabase/activity.ts',{rpc:async(name)=>({data:name==='mark_my_canonical_activity_read'?true:0,error:null})});
  assert.equal((await good.markCanonicalActivityRead('event','personal')).error,null);
  assert.equal((await good.markAllCanonicalActivityRead('personal')).count,0);
});

test('Activity never accepts missing or malformed feed and count responses as empty success',async()=>{
 const row={id:'event',type:'payment_required',title:'Payment required',message:null,read:false,created_at:'2026-10-23T10:00:00Z',source_type:'reservation',source_id:'booking',destination_route:'reservation',destination_params:{reservation_id:'booking'},workspace:'personal',action_required:true,resolved_at:null};
 for(const data of [null,{},[{}],[{...row,read:'false'}],[{...row,destination_params:[]}],[row,row]]){
  const api=moduleAt('src/lib/supabase/activity.ts',{rpc:async()=>({data,error:null})});assert.ok((await api.getCanonicalActivity('personal')).error);
 }
 for(const data of [null,{}, {unread:-1,needs_action:0,latest_at:null},{unread:0,needs_action:'0',latest_at:null}]){
  const api=moduleAt('src/lib/supabase/activity.ts',{rpc:async()=>({data,error:null})});assert.ok((await api.getCanonicalActivitySummary('personal')).error);
 }
 for(const data of [[],[row]]){const api=moduleAt('src/lib/supabase/activity.ts',{rpc:async()=>({data,error:null})});assert.equal((await api.getCanonicalActivity('personal')).error,null);}
 const api=moduleAt('src/lib/supabase/activity.ts',{rpc:async()=>({data:{unread:0,needs_action:0,latest_at:null},error:null})});assert.equal((await api.getCanonicalActivitySummary('personal')).error,null);
});
test('both Personal and operational workspace alerts react to the persisted preference',()=>{
  const app=fs.readFileSync('src/App.tsx','utf8');
  assert.equal((app.match(/addEventListener\(["']wehouse:in-app-alerts["']/g)||[]).length,2);
  const account=fs.readFileSync('src/pages/AccountCenter.tsx','utf8');
  assert.ok(account.indexOf('persistNotificationPreference(profile.user_id')<account.indexOf("new CustomEvent('wehouse:in-app-alerts'"));
  assert.match(account,/Delivery is not active yet/);
});
test('Android targets the documented Capacitor 8 toolchain',()=>{
  const vars=fs.readFileSync('android/variables.gradle','utf8');
  assert.match(vars,/minSdkVersion = 24/);assert.match(vars,/targetSdkVersion = 36/);assert.match(vars,/compileSdkVersion = 36/);
  assert.match(fs.readFileSync('android/build.gradle','utf8'),/gradle:8\.13\.0/);
  assert.match(fs.readFileSync('android/gradle/wrapper/gradle-wrapper.properties','utf8'),/gradle-8\.14\.3-all\.zip/);
});
