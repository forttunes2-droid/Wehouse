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
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Promise, Set, Date, require: name => dependencies[name] ?? require(name) });
  return exports;
}
const { createPlatformSettingsStore } = moduleAt('src/lib/platformSettingsStore.ts');
test('settings readers share a request and retry a failed first read', async () => {
  let calls = 0;
  const store = createPlatformSettingsStore(async () => { if (++calls === 1) throw Error('offline'); return { company_name: 'WeHouse' }; });
  await Promise.all([store.load(), store.load()]);
  assert.equal(calls, 1);
  await store.load();
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().settings.company_name, 'WeHouse');
  await store.load(); assert.equal(calls, 2);
});
test('saving settings updates mounted readers and a late old response cannot undo it', async () => {
  const pending = [];
  const store = createPlatformSettingsStore(() => new Promise(resolve => pending.push(resolve)));
  let notified = 0; const unsubscribe = store.subscribe(() => notified++);
  const old = store.load(); await Promise.resolve();
  const fresh = store.refresh(); await Promise.resolve();
  pending[1]({ company_name: 'Current name' }); await fresh;
  pending[0]({ company_name: 'Old name' }); await old;
  assert.equal(store.getSnapshot().settings.company_name, 'Current name');
  assert.ok(notified >= 2);
  unsubscribe();
});
function settingHarness({ rejectWrite = false, verifyValue = '1500', syncFailure = false } = {}) {
  const calls = [];
  const client = {
    rpc: async (...args) => { calls.push(['rpc',...args]); return { error: rejectWrite ? Error('Denied') : null }; },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { key: 'worker_pro_monthly_price_ngn', value: verifyValue, is_active: true }, error: null }) }) }) }),
    functions: { invoke: async (...args) => { calls.push(['provider',...args]); if (syncFailure) throw Error('offline'); return { data: { success: true }, error: null }; } },
  };
  return { calls, save: moduleAt('src/lib/saveCreatorSetting.ts', { '@/lib/supabase': { supabase: client } }).saveCreatorSetting };
}
const price = { key: 'worker_pro_monthly_price_ngn', label: 'Monthly price', kind: 'number', category: 'worker_pro', min: 0, max: 10000000, step: 1 };
test('a denied or unverified setting never starts provider synchronization', async () => {
  for (const options of [{ rejectWrite: true }, { verifyValue: '100' }]) {
    const h = settingHarness(options);
    await assert.rejects(h.save(price, '1500'));
    assert.equal(h.calls.filter(call => call[0] === 'provider').length, 0);
  }
});
test('price validation happens before writes and failed provider sync reports partial completion', async () => {
  const h = settingHarness({ syncFailure: true });
  await assert.rejects(h.save(price, '-100'));
  assert.equal(h.calls.length, 0);
  const result = await h.save(price, '1,500');
  assert.equal(result.row.value, '1500');
  assert.match(result.warning, /keep new sales closed/);
  assert.equal(h.calls[0][1], 'creator_set_worker_pro_setting');
});
const headingContext = moduleAt('src/lib/workspaceHeading.ts');
const Heading = moduleAt('src/components/WorkspaceSectionHeading.tsx', { '@/lib/workspaceHeading': headingContext }).default;
const Back = moduleAt('src/components/BackButton.tsx').default;
const Frame = moduleAt('src/components/WorkspaceFrameV2.tsx', { '@/components/BackButton': { default: Back, __esModule: true }, '@/lib/workspaceHeading': headingContext }).default;
test('workspace title appears once, distinct section headings remain, and Back belongs to the header', () => {
  const html = renderToStaticMarkup(React.createElement(Frame, { label: 'WEHOUSE · CREATOR', title: 'People', items: [], active: 'operations', setActive() {}, onLogout() {}, onBack() {}, backLabel: 'Back to work areas' },
    React.createElement(Heading, { title: 'People', description: 'Repeated introduction' }),
    React.createElement(Heading, { title: 'Pending reviews' })));
  assert.equal((html.match(/>People</g) || []).length, 1);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /<h2[^>]*>Pending reviews/);
  assert.doesNotMatch(html, /Repeated introduction/);
  assert.match(html, /<header[\s\S]*aria-label="Back to work areas"[\s\S]*<h1/);
});
