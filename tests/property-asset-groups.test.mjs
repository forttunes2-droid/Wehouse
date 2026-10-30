import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/propertyAssetGroups.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports});
const {propertyAssetGroups}=exports;
const site='10100000-0000-4000-8000-000000000001';
test('same compound groups mixed home terms without merging bookable listings',()=>{
 const rows=[{id:'a',site_id:site,site_label:'Lafia compound',sub_type:'long_stay',bedrooms:0},
 {id:'separate',site_label:'Lafia compound'},
 {id:'b',site_id:site.toUpperCase(),sub_type:'short_let',bedrooms:5}];
 const groups=propertyAssetGroups(rows);
 assert.equal(groups.length,2);assert.equal(groups[0].label,'Lafia compound');
 assert.deepEqual(Array.from(groups[0].items,row=>row.id),['a','b']);
 assert.equal(groups[0].items[0],rows[0]);assert.equal(groups[0].items[1],rows[2]);
});
test('matching labels, invalid identities and Hotels never merge into a compound',()=>{
 const rows=[{id:'a',site_label:'Same'},{id:'b',site_label:'Same'},
 {id:'c',site_id:'invalid',site_label:'Same'},
 {id:'hotel:1',site_id:site,_assetKind:'hotel'},
 {id:'d',site_id:site,site_label:'Same'}];
 assert.equal(propertyAssetGroups(rows).length,5);
 assert.equal(propertyAssetGroups([]).length,0);
});
