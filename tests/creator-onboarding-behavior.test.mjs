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
  const source = readFileSync(new URL('../'+path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, JSON, Promise, Error, setTimeout, clearTimeout, require: name => dependencies[name] ?? require(name) });
  return exports;
}
const { identityReviewGateSatisfied: gate } = moduleAt('src/lib/identityReviewPolicy.ts');
test('identity policy allows free review without claiming a face check passed', () => {
  assert.equal(gate({ identity_required: false, identity_current: false }), true);
  for (const value of [null, {}, { identity_required: true }, { identity_required: true, identity_current: false }]) assert.equal(gate(value), false);
  assert.equal(gate({ identity_required: true, identity_current: true }), true);
});
function overview(state) {
  return moduleAt('src/components/CreatorOverview.tsx', { '@/hooks/useRpcRead': { useRpcRead: () => state } }).default;
}
test('Creator overview keeps Workers and internal team separate and opens the correct people filter', () => {
  const data = { accounts: 38, partners: 5, workers: 8, team: 5, apartments: 3, hotels: 1, hotel_team: 2, pending_reviews: 1, inspections: 2, payouts: 0 };
  const View = overview({ data, loading: false, error: '', refresh() {} });
  const opened = [];
  const element = View({ userId:'owner', onOpen:(...args) => opened.push(args) });
  const html = renderToStaticMarkup(element);
  assert.match(html,/Personal accounts/); assert.match(html,/Workers/); assert.match(html,/WeHouse team/); assert.match(html,/2 hotel team members/);
  assert.doesNotMatch(html,/Workers &amp; internal team/);
  element.props.children.find(child => child.key === 'Property partners').props.onClick();
  element.props.children.find(child => child.key === 'WeHouse team').props.onClick();
  assert.deepEqual(opened,[['people','property_partner'],['team',undefined]]);
});
test('Creator read failures show retry and never invented zero counts', () => {
  const View = overview({ data:null, loading:false, error:'Permission denied', refresh() {} });
  const html = renderToStaticMarkup(React.createElement(View,{userId:'owner',onOpen(){}}));
  assert.match(html,/role="alert"/); assert.match(html,/Try again/); assert.doesNotMatch(html,/>0</);
});
test('an empty identity queue adds no face-check card, while a failed queue stays visible', () => {
  for (const error of ['', 'offline']) {
    const Queue = moduleAt('src/components/AccountIdentityReviewQueue.tsx', {
      '@/lib/withTimeout':moduleAt('src/lib/withTimeout.ts'),
      '@/lib/supabase': { supabase:{} }, '@/components/MediaViewer': { default:()=>null, __esModule:true },
      '@/hooks/useRpcRead': { useRpcRead:()=>({data:[],loading:false,error,refresh(){}}) },
    }).default;
    const html=renderToStaticMarkup(React.createElement(Queue,{accountRole:'worker'}));
    if(error) { assert.match(html,/role="alert"/); assert.match(html,/Try again/); }
    else assert.equal(html,'');
  }
});
function readHarness(rpc) {
  const slots=[]; let cursor=0; const effects=[];
  const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return [slots[i].value,value=>{slots[i].value=value;}];},
    useRef(value){const i=cursor++;return slots[i]??={current:value};},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
  };
  const {useRpcRead}=moduleAt('src/hooks/useRpcRead.ts',{react,'@/lib/supabase':{supabase:{rpc}},'@/lib/withTimeout':moduleAt('src/lib/withTimeout.ts')});
  return {render(id){cursor=0;return useRpcRead('get_status',id);},effects(){effects.splice(0).forEach(fn=>fn());}};
}
test('onboarding read failures finish loading and can be retried', async () => {
  let failed=true;
  const h=readHarness(async()=>{if(failed)throw Error('offline');return {data:{identity_required:false},error:null};});
  h.render('a');h.effects();await new Promise(setImmediate);
  let state=h.render('a');assert.equal(state.loading,false);assert.equal(state.data,null);assert.match(state.error,/offline/);
  failed=false;await state.refresh();state=h.render('a');assert.equal(state.data.identity_required,false);
});
test('late onboarding reads cannot show another account’s face requirement', async () => {
  const requests=[];const h=readHarness(()=>new Promise(resolve=>requests.push(resolve)));
  h.render('a');h.effects();let state=h.render('b');assert.equal(state.data,null);h.effects();
  requests[1]({data:{identity_required:false},error:null});await new Promise(setImmediate);
  requests[0]({data:{identity_required:true},error:null});await new Promise(setImmediate);
  state=h.render('b');assert.equal(state.data.identity_required,false);
});
