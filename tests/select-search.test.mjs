import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/selectSearch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
test('searchable choices match every typed word regardless of case, spacing or order',()=>{
 const options=[{label:'First Bank Test',value:'011'},{label:'Zenith Test Bank',value:'057'},{label:'Current Test Bank',value:'058'}];
 for(const query of ['first',' FIRST   BANK ','bank first','011'])assert.equal(exports.filterSearchOptions(options,query)[0]?.value,'011');
 assert.equal(exports.filterSearchOptions(options,'not-a-bank').length,0);assert.equal(exports.filterSearchOptions(options,'  ').length,3);
});
test('searchable choices include accents, configured aliases and metadata',()=>{
 const options=[{label:'Crédit Example',value:'bank-1',keywords:'CE',meta:'Local bank'}];for(const query of ['credit','CE','local credit'])assert.equal(exports.filterSearchOptions(options,query).length,1);
});
