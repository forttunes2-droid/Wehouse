import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function moduleAt(file,require=()=>{throw Error('Unexpected dependency');}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});
 return exports;
}
const nigeria=moduleAt('src/data/nigeria-locations.ts');
const {locationCountryCode,regionDataset}=moduleAt('src/data/locations.ts',name=>{assert.equal(name,'./nigeria-locations');return nigeria;});
const NG={countryCode:'NG',countryName:'Nigeria'},GH={countryCode:'GH',countryName:'Ghana'};
test('saved country and ISO code select their own regions despite another platform default',()=>{
 assert.equal(locationCountryCode('Nigeria',GH),'NG');
 assert.equal(locationCountryCode(' ng ',GH),'NG');
 assert.equal(locationCountryCode('Ghana',GH),'GH');
 assert.equal(regionDataset('NG').find(row=>row.state==='Nasarawa').cities.includes('Lafia'),true);
});
test('an unregistered saved country never acquires the default Nigeria State/LGA list',()=>{
 assert.equal(locationCountryCode('Ghana',NG),null);
 assert.equal(regionDataset(locationCountryCode('Ghana',NG)),null);
 assert.equal(regionDataset(locationCountryCode('GB',NG)),null);
 assert.equal(locationCountryCode(null,NG),'NG');
});
