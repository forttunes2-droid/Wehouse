// Execute the actual policy in VM-based unit harnesses; never bypass its validator.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../src/lib/chatMediaPolicy.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports,Blob,File,Uint8Array,WeakSet});
export default exports;
