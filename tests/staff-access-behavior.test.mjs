import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import timeoutApi from './helpers/with-timeout.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function moduleAt(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => dependencies[name] ?? require(name) });
  return exports;
}

test('Inspection evidence retry reuses confirmed paths and retries only failed uploads', async () => {
  const {createInspectionEvidenceBatch}=moduleAt('src/lib/inspectionEvidence.ts');
  const batch=createInspectionEvidenceBatch();
  const photo={type:'image/jpeg'},video={type:'video/mp4'};
  let photos=0,videos=0;
  const upload=async file=>{
    if(file===photo){photos++;return 'field/photo.jpg';}
    videos++;if(videos===1)throw Error('offline');return 'field/video.mp4';
  };
  await assert.rejects(batch([photo,video],upload),/offline/);
  let result=await batch([photo,video],upload);
  assert.deepEqual([...result.photoUrls],['field/photo.jpg']);
  assert.deepEqual([...result.videoUrls],['field/video.mp4']);
  // Repeating registration after an uncertain response keeps the same object paths.
  result=await batch([photo,video],upload);
  assert.equal(photos,1);assert.equal(videos,2);
  assert.equal(result.photoUrls[0],'field/photo.jpg');
});

test('Staff dashboard follows active canonical grants and requires the base Staff grant', async () => {
  const calls=[];let rows=[{workspace_role:'staff'},{workspace_role:'finance_operations'}];
  const query={select(value){calls.push(['select',value]);return this;},eq(...args){calls.push(['eq',...args]);return this;},is(...args){calls.push(['is',...args]);return this;},in(...args){calls.push(['in',...args]);return Promise.resolve({data:rows,error:null});}};
  const api=moduleAt('src/lib/supabase/permissions.ts',{'./client':{supabase:{from(table){calls.push(['from',table]);return query;}}},'@/lib/withTimeout':timeoutApi});
  let receipt=await api.getStaffPermissions('staff-a');
  assert.deepEqual([...receipt.permissions],['finance']);
  assert.equal(receipt.error,null);
  assert.ok(calls.some(row=>row[0]==='from'&&row[1]==='workspace_role_assignments'));
  assert.ok(calls.some(row=>row[0]==='eq'&&row[1]==='user_id'&&row[2]==='staff-a'));
  assert.ok(calls.some(row=>row[0]==='is'&&row[1]==='revoked_at'&&row[2]===null));
  rows=[{workspace_role:'finance_operations'}];
  receipt=await api.getStaffPermissions('staff-a');
  assert.equal(receipt.permissions.length,0,'an orphaned operation cannot restore revoked Staff access');
  rows=null;
  receipt=await api.getStaffPermissions('staff-a');
  assert.equal(receipt.permissions.length,0);
  assert.ok(receipt.error,'a malformed receipt is not an empty work-area result');
});

test('Field Operations load failure has recovery instead of pretending no inspections exist', async () => {
  let cursor=0,failed=true;const slots=[],effects=[];
  const same=(a,b)=>a?.length===b?.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(value){const i=cursor++;return slots[i]??={current:value};},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},
    useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={value:fn(),deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
  };
  const Component=moduleAt('src/components/StaffInspectionWorkspaceV2.tsx',{
    react,sonner:{toast:{error(){},success(){}}},'@/lib/withTimeout':timeoutApi,
    '@/lib/inspectionEvidence':moduleAt('src/lib/inspectionEvidence.ts'),
    '@/lib/supabase':{supabase:{rpc:async()=>failed?{data:null,error:{message:'Inspection service unavailable'}}:{data:[],error:null}}},
    '@/lib/supabase/listings':{},'./ListingCandidateMedia':{},'@/components/WeHouseSelect':'Select',
    '@/components/MediaViewer':'MediaViewer','@/components/VideoPlayer':'VideoPlayer',
    '@/components/PropertySpaceSummary':moduleAt('src/components/PropertySpaceSummary.tsx'),
    '@/lib/homeStyles':moduleAt('src/lib/homeStyles.ts'),
  }).default;
  const render=()=>{cursor=0;const tree=Component({profile:{user_id:'field-staff'}});effects.splice(0).forEach(fn=>fn());return tree;};
  const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
  render();await new Promise(setImmediate);
  let tree=render();
  assert.ok(nodes(tree).some(node=>node.props?.role==='alert'));
  assert.ok(!nodes(tree).some(node=>node.props?.text==='No inspections match this filter.'));
  failed=false;
  const retry=nodes(tree).find(node=>node.type==='button'&&node.props.children==='Retry inspections');
  assert.ok(retry);retry.props.onClick();await new Promise(setImmediate);
  tree=render();
  assert.ok(!nodes(tree).some(node=>node.props?.role==='alert'));
  assert.ok(nodes(tree).some(node=>node.props?.text==='No inspections match this filter.'));
  slots.forEach(slot=>slot?.cleanup?.());
});
// Minimal hook scheduler: executes the actual hook, including effect cleanup,
// without network, credentials or a fabricated signed-in browser session.
function permissionHarness(fetch) {
  const slots = []; let cursor = 0; const effects = [];
  const same = (a,b) => a?.length === b?.length && a.every((v,i) => Object.is(v,b[i]));
  const react = {
    useState(initial) { const i=cursor++; if (!slots[i]) slots[i]={value:initial}; return [slots[i].value, value => { slots[i].value=value; }]; },
    useRef(value) { const i=cursor++; return slots[i] ??= { current:value }; },
    useCallback(fn,deps) { const i=cursor++; if (!same(slots[i]?.deps,deps)) slots[i]={deps,fn}; return slots[i].fn; },
    useEffect(fn,deps) { const i=cursor++; if (!same(slots[i]?.deps,deps)) { slots[i]?.cleanup?.(); slots[i]={deps}; effects.push(() => {slots[i].cleanup=fn();}); } },
  };
  const {useStaffPermissions} = moduleAt('src/hooks/useStaffPermissions.ts', {react, '@/lib/supabase': {getStaffPermissions:fetch}});
  return { render(id) {cursor=0; return useStaffPermissions(id);}, effects() {effects.splice(0).forEach(fn=>fn());} };
}
test('Staff permission failures stop loading, clear authority and allow retry', async () => {
  let reject = true;
  const h=permissionHarness(async () => {if(reject)throw Error('offline');return {permissions:['finance'],error:null};});
  let view=h.render('staff-a'); h.effects(); await new Promise(setImmediate);
  view=h.render('staff-a');
  assert.equal(view.loading,false); assert.equal(view.permissions.length,0); assert.match(view.error.message,/offline/);
  reject=false; await view.refresh(); view=h.render('staff-a');
  assert.equal(view.loading,false); assert.equal(view.error,null); assert.equal(view.permissions[0],'finance');
});
test('late permission reads cannot install another Staff identity or overwrite a newer refresh', async () => {
  const requests=[];
  const h=permissionHarness(id=>new Promise(resolve=>requests.push({id,resolve})));
  h.render('staff-a'); h.effects();
  let view=h.render('staff-b'); assert.equal(view.permissions.length,0); h.effects();
  requests[1].resolve({permissions:['support'],error:null}); await Promise.resolve(); await Promise.resolve();
  requests[0].resolve({permissions:['finance'],error:null}); await Promise.resolve(); await Promise.resolve();
  view=h.render('staff-b'); assert.equal(view.permissions[0],'support');
  const first=view.refresh(); const second=view.refresh();
  requests[3].resolve({permissions:['security'],error:null}); await second;
  requests[2].resolve({permissions:['operations'],error:null}); await first;
  view=h.render('staff-b'); assert.equal(view.permissions[0],'security');
});
test('Staff unavailable screens have one title, an integrated Back control, recovery and exit', () => {
  const Back=moduleAt('src/components/BackButton.tsx').default;
  const State=moduleAt('src/components/StaffWorkspaceState.tsx', {'@/components/BackButton': {default:Back,__esModule:true}}).default;
  const html=renderToStaticMarkup(React.createElement(State,{title:'Could not check your work area',text:'Try again to check your assignment.',onAccount(){},onLogout(){},onRetry(){}}));
  assert.equal((html.match(/<h1/g)||[]).length,1);
  assert.match(html,/<header[\s\S]*aria-label="Back to Account"[\s\S]*<h1/);
  assert.match(html,/role="alert"/);
  assert.match(html,/>Try again</); assert.match(html,/>Account</); assert.match(html,/>Sign out</);
});
