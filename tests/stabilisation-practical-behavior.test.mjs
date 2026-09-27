import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {exports, atob, Date});
  return exports;
}
const prefs = load('src/lib/roommatePreferences.ts');
const split = load('src/lib/sharedHousingPresentation.ts');
const session = load('supabase/functions/_shared/liveSession.ts');
const cleanup = load('supabase/functions/_shared/recoveryCleanup.ts');
const plain = v => JSON.parse(JSON.stringify(v));
const valid = () => ({...prefs.roommatePreferenceForm(), gender_preference:'no_preference', preferred_state:'Nasarawa', preferred_lga:'Lafia', budget_min:300000, budget_max:500000, move_in_mode:'flexible', room_arrangement:'either', smoking_habit:'never', smoking_preference:'no'});

test('new moving preferences do not use current location or manufacture lifestyle answers', () => {
  const p = prefs.roommatePreferenceForm({state:'Abuja',city:'Garki',area:'Office road'});
  for (const key of ['preferred_state','preferred_lga','preferred_area','cleanliness','noise_level','visitors','sleep_routine','overnight_visitors']) assert.equal(p[key], '');
  assert.equal(p.budget_min,0); assert.equal(p.budget_max,0);
});
test('explicit saved choices and school are reused without treating skipping as agreement', () => {
  const p=prefs.roommatePreferenceForm({cleanliness:'balanced',visitors:'sometimes',area_preference:'Tudun Kauri',budget_min:400000,budget_max:450000},'IMAP');
  assert.equal(p.cleanliness,'balanced');assert.equal(p.visitors,'sometimes');assert.equal(p.preferred_area,'Tudun Kauri');assert.equal(p.school_name,'IMAP');assert.equal(p.school_match,false);
  assert.equal(p.sleep_routine,'');assert.equal(prefs.roommateScoreLabel(null,0),'Compare your plans');
});
test('annual individual rent requires a real positive bounded range', () => {
  assert.equal(prefs.roommatePreferenceError(valid(),'2026-09-23'),null);
  for(const values of [{budget_min:0},{budget_max:10},{budget_max:Infinity},{budget_min:2.5},{budget_max:2000000001}]) assert.match(prefs.roommatePreferenceError({...valid(),...values},'2026-09-23'),/annual rent range/);
});
test('timing is independent from duration and invalid or reversed dates are rejected', () => {
  for(const values of [{move_in_mode:'date',move_in_from:'2026-09-22'},{move_in_mode:'date',move_in_from:'2027-02-30'},{move_in_mode:'range',move_in_from:'2026-10-01',move_in_to:'2026-09-30'}]) assert.ok(prefs.roommatePreferenceError({...valid(),...values},'2026-09-23'));
  assert.equal(prefs.roommatePreferenceError({...valid(),move_in_mode:'range',move_in_from:'2026-10-01',move_in_to:'2026-10-20'},'2026-09-23'),null);
});
test('non-negotiable room and both smoking answers are explicit; school only required when restricted',()=>{
  assert.match(prefs.roommatePreferenceError({...valid(),room_arrangement:''},'2026-09-23'),/bedroom/);
  assert.match(prefs.roommatePreferenceError({...valid(),smoking_habit:''},'2026-09-23'),/two smoking/);
  assert.match(prefs.roommatePreferenceError({...valid(),smoking_preference:''},'2026-09-23'),/two smoking/);
  assert.match(prefs.roommatePreferenceError({...valid(),school_match:true,school_name:' '},'2026-09-23'),/school/);
});
for(const members of [2,3,4,5,6,7,8,9,10,11,12]) test(`equal split for ${members} people reconciles every kobo and both components`,()=>{
  for(const [rent,deposit] of [[800000,0],[1000.01,500.02],[120000,50000],[0.01,0.01]]) {
    const amounts=plain(split.sharedAmounts(rent,deposit,members));
    assert.equal(amounts.length,members);
    assert.equal(amounts.reduce((sum,a)=>sum+Math.round(a.rent*100),0),Math.round(rent*100));
    assert.equal(amounts.reduce((sum,a)=>sum+Math.round(a.deposit*100),0),Math.round(deposit*100));
    assert.equal(amounts.reduce((sum,a)=>sum+Math.round(a.total*100),0),Math.round((rent+deposit)*100));
    for(const a of amounts) {assert.equal(Math.round(a.total*100),Math.round(a.rent*100)+Math.round(a.deposit*100));assert.ok(a.deposit>=0);}
    assert.ok(Math.max(...amounts.map(a=>Math.round(a.total*100)))-Math.min(...amounts.map(a=>Math.round(a.total*100)))<=1);
  }
});
test('split estimates reject invalid prices and number of payers',()=>{
  for(const args of [[0,0,2],[-1,0,2],[1,-1,2],[Infinity,1,2],[1,1,1],[1,1,2.5],[1,1,13],[Number.MAX_SAFE_INTEGER,1,2]]) assert.equal(split.sharedAmounts(...args),null);
});
test('expired invitation is history rather than an actionable request to pay',()=>{
  const g={status:'ready',expires_at:'2026-09-23T09:00:00Z',members:[{user_id:'a',invitation_status:'invited'}]};
  assert.equal(split.sharedHousingLane(g,'a',Date.parse('2026-09-23T10:00:00Z')),'history');
  assert.equal(split.sharedHousingLane({...g,status:'paid'},'a',Date.parse('2026-09-23T10:00:00Z')),'action');
  assert.equal(split.sharedHousingLane({...g,status:'paid',booking_status:'completed'},'a'),'history');
});
const auth='90000000-0000-4000-8000-000000000001',sid='90000000-0000-4000-8000-000000000002';
const token=(sub=auth,id=sid)=>`header.${Buffer.from(JSON.stringify({sub,session_id:id})).toString('base64url')}.signature-already-verified-by-getUser`;
test('live session checker rejects stale, mismatched, absent and malformed session proof',async()=>{
  let called=0;const db={rpc:async()=>{called++;return {data:true,error:null}}};
  for(const bearer of ['bad',token('other'),token(auth,'invalid'),token(auth,null)])assert.equal(await session.hasLiveSession(db,auth,bearer),false);
  assert.equal(called,0);
  for(const result of [{data:false,error:null},{data:true,error:{message:'failure'}},{data:'true',error:null}])assert.equal(await session.hasLiveSession({rpc:async()=>result},auth,token()),false);
  assert.equal(await session.hasLiveSession({rpc:async()=>{throw Error('network')}},auth,token()),false);
});
test('live session checks exact verified Auth user and exact session on privileged server RPC',async()=>{
  const calls=[];
  assert.equal(await session.hasLiveSession({rpc:async(name,params)=>{calls.push({name,params:plain(params)});return{data:true,error:null}}},auth,token()),true);
  assert.deepEqual(calls,[{name:'auth_session_is_active',params:{p_auth_id:auth,p_session_id:sid}}]);
});
test('cleanup never reports success merely because signout returned without throwing',async()=>{
  let signs=0,finishes=0;const delays=[];
  assert.equal(await cleanup.finishRecoveryCleanup(async()=>{signs++;return{error:null}},async()=>{finishes++;return{data:false,error:null}},async ms=>delays.push(ms)),false);
  assert.equal(signs,3);assert.equal(finishes,3);assert.deepEqual(delays,[150,300]);
});
test('cleanup can confirm actual session removal after the signout response was lost',async()=>{
  let calls=0;
  assert.equal(await cleanup.finishRecoveryCleanup(async()=>{throw Error('response lost')},async()=>{calls++;return{data:true,error:null}},async()=>{}),true);
  assert.equal(calls,1);
});
test('cleanup retries transient failures but requires true verified completion and no error',async()=>{
  let finish=0;
  assert.equal(await cleanup.finishRecoveryCleanup(async()=>({}),async()=>++finish===3?{data:true,error:null}:{data:true,error:{message:'audit unavailable'}},async()=>{}),true);
  assert.equal(finish,3);
});

// A professional retains a Personal identity; the active grant is authoritative.
test('sensitive professional actions use active grants and fail closed on denied or failed lookup',async()=>{
  const calls=[];
  assert.equal(await session.hasActiveWorkspace({rpc:async(name,args)=>{calls.push({name,args:plain(args)});return{data:true,error:null};}},'personal-with-worker-access','worker'),true);
  assert.deepEqual(calls,[{name:'user_has_active_workspace',args:{p_user_id:'personal-with-worker-access',p_workspace_role:'worker'}}]);
  for(const result of [{data:false,error:null},{data:'true',error:null},{data:true,error:{message:'denied'}}])assert.equal(await session.hasActiveWorkspace({rpc:async()=>result},'a','worker'),false);
  assert.equal(await session.hasActiveWorkspace({rpc:async()=>{throw Error('unavailable');}},'a','creator'),false);
});
