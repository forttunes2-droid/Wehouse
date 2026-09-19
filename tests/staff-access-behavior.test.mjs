import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
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
