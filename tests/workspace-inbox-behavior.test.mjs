import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function moduleAt(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => dependencies[name] ?? require(name), setTimeout, clearTimeout, ...globals });
  return exports;
}
const session = moduleAt('src/lib/workspaceSession.ts');
const access = roles => ({ identity: { user_id: 'person-a' }, personal_workspace: true, privileged_workspaces: roles.map(role => ({role})) });
test('Refresh restores the selected permitted workspace; revoked grants fall back to Personal', () => {
  assert.equal(session.resolveWorkspace(access(['worker','creator']), 'person-a', 'worker'), 'worker');
  assert.equal(session.resolveWorkspace(access(['creator']), 'person-a', 'worker'), 'personal');
  assert.equal(session.resolveWorkspace(access(['creator']), 'person-a', null), 'personal');
  assert.equal(session.resolveWorkspace(access(['creator']), 'person-b', 'creator'), null);
  assert.equal(session.resolveWorkspace({...access(['creator']),personal_workspace:false}, 'person-a', 'creator'), null);
});
test('Navigation memory is separate for each identity and workspace', () => {
  const keys = ['person-a','person-b'].flatMap(id => ['personal','worker','creator'].map(role => session.workspaceNavigationKey(id,role)));
  assert.equal(new Set(keys).size,6);
});
function workspaceHarness() {
  const slots=[];let cursor=0;const effects=[];const requests=[];
  const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(value){const i=cursor++;return slots[i]??={current:value};},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
  };
  const hook = moduleAt('src/hooks/useWorkspaceAccess.ts', {
    react, '@/lib/workspaceSession':session, '@/lib/withTimeout':moduleAt('src/lib/withTimeout.ts'),
    '@/lib/supabase':{supabase:{rpc:()=>new Promise(resolve=>requests.push(resolve))}},
  }, {localStorage:{getItem:()=> 'worker'},window:{addEventListener(){},removeEventListener(){}}}).useWorkspaceAccess;
  return {requests,render(id='person-a'){cursor=0;return hook(id);},effects(){effects.splice(0).forEach(fn=>fn());},close(){for(const slot of slots)slot?.cleanup?.();}};
}
test('An older workspace response cannot replace a newer access decision', async () => {
  const h=workspaceHarness();let state=h.render();h.effects();assert.equal(state.access,null);
  const retry=state.reload();h.requests[1]({data:access(['creator']),error:null});await retry;
  assert.equal(h.render().active,'personal');
  h.requests[0]({data:access(['worker']),error:null});await new Promise(setImmediate);
  assert.equal(h.render().active,'personal');h.close();
});
test('An account change rejects the old account response and clears its access', async () => {
  const h=workspaceHarness();h.render();h.effects();h.render('person-b');h.effects();
  h.requests[0]({data:access(['worker']),error:null});await new Promise(setImmediate);
  assert.equal(h.render('person-b').access,null);
  h.requests[1]({data:{identity:{user_id:'person-b'},personal_workspace:true,privileged_workspaces:[]},error:null});await new Promise(setImmediate);
  assert.equal(h.render('person-b').active,'personal');h.close();
});
test('Workspace lookup failure offers recovery instead of assuming a role', async () => {
  const h=workspaceHarness();h.render();h.effects();h.requests[0]({data:null,error:{message:'network'}});await new Promise(setImmediate);
  const result=h.render();assert.equal(result.access,null);assert.match(result.error,/try again/i);h.close();
});
test('Customer purchases and provider jobs request different server projections', async () => {
  const calls=[];
  const api=moduleAt('src/lib/supabase/worker-bookings.ts',{'./client':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:[],error:null};}}},'./utils':{},'@/lib/e2ee':{},'@/lib/workerBookingContract':{normalizeWorkerBookingRow:row=>row}});
  await api.getMyBookingConversations('person-a');await api.getCommunicationBookingConversations('person-a','worker');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    {name:'get_my_workspace_inbox',args:{p_workspace:'personal',p_kind:'service'}},
    {name:'get_my_workspace_inbox',args:{p_workspace:'worker',p_kind:'service'}},
  ]);
});
test('New WeHouse help retains its workspace without changing the subject booking', () => {
  const {supportContextForWorkspace}=moduleAt('src/lib/supabase/support.ts',{'./client':{},'@/lib/propertyBookingLifecycle':{}});
  const personal=supportContextForWorkspace({},'user');const work=supportContextForWorkspace({},'worker');
  assert.equal(personal.contextId,'workspace:personal');assert.equal(work.contextId,'workspace:worker');
  const stay=supportContextForWorkspace({contextType:'hotel_booking',contextId:'booking-7',contextSnapshot:{hotel_name:'Test Hotel'}},'user');
  assert.equal(stay.contextId,'booking-7');assert.equal(stay.contextSnapshot.hotel_name,'Test Hotel');assert.equal(stay.contextSnapshot.requester_workspace,'personal');
});
