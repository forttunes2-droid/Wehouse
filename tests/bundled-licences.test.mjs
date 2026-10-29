import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('scripts/lib/bundled-licences.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:createRequire(import.meta.url),process});
test('the bundle inventory includes only supplied libraries and preserves embedded publisher notices',()=>{
 const react=path.resolve('node_modules/react/index.js'),vendor=path.resolve('node_modules/victory-vendor/es/d3-shape.js');
 const report=exports.bundledLicences([react,react+'?used',vendor,path.resolve('src/App.tsx')]);
 assert.equal(report.packages.length,2);assert.equal(report.packages[0].name,'react');
 assert.match(report.packages[0].notices,/Copyright.*Facebook|Copyright.*Meta/s);
 assert.match(report.packages[1].notices,/lib-vendor\/d3-array\/LICENSE/);assert.match(report.packages[1].notices,/Nearform/);
 assert.match(report.packages[1].source,/victory-vendor-.*\.tgz$/);
});
test('a package with omitted root notices uses only its pinned version-specific publisher evidence',()=>{
 const report=exports.bundledLicences([path.resolve('node_modules/@radix-ui/number/dist/index.mjs')]);
 assert.equal(report.packages.length,1);assert.match(report.packages[0].notices,/Copyright.*WorkOS/);assert.match(report.packages[0].evidence,/exact package version/);
});
