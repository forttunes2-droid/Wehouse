import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/workspaceNavigation.ts',import.meta.url),'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('explicit workspace entry returns a root, never a remembered Account screen',()=>{
  assert.equal(exports.workspaceEntryPage('user'),'search');
  assert.equal(exports.workspaceEntryPage('creator'),'creator');
  assert.equal(exports.workspaceEntryPage('staff'),'staff_dashboard');
  assert.equal(exports.workspaceEntryPage('hotel_staff'),'hotel_operations');
});
test('Account without history returns to the current workspace root',()=>{
  for(const page of ['profile','account']){
    assert.equal(exports.accountBackPage(page,'search'),'search');
    assert.equal(exports.accountBackPage(page,'creator'),'creator');
  }
  assert.equal(exports.accountBackPage('security','search'),'profile');
  assert.equal(exports.accountBackPage('hotel_detail','search'),'hotels');
});
test('isolated test identities are never imported by production entrypoints',()=>{
  for(const path of ['src/App.tsx','src/main.tsx','vite.config.ts']){
    assert.doesNotMatch(readFileSync(new URL('../'+path,import.meta.url),'utf8'),/authFixture|qa-auth-ready|tests\/browser/);
  }
});
