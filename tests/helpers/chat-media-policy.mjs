// Execute the actual policy in VM-based unit harnesses; never bypass its validator.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
const videoMedia = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../src/lib/mediaVideo.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports: videoMedia});
const imageMedia = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../src/lib/supabase/utils.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports: imageMedia});
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../src/lib/chatMediaPolicy.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
  exports, Blob, File, Uint8Array, WeakSet,
  require: name => name === '@/lib/mediaVideo' ? videoMedia : name === '@/lib/supabase/utils' ? imageMedia : (() => { throw new Error(`Unexpected dependency ${name}`); })(),
});
export { videoMedia, imageMedia };
export default exports;
