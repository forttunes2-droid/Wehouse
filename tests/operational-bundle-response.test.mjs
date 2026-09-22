import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function supportWith(result) {
  const code = ts.transpileModule(readFileSync('src/lib/supabase/support.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,require:name=>name==='./client'?{supabase:{rpc:async()=>result}}:name==='@/lib/propertyBookingLifecycle'?{}:require(name)});
  return exports;
}
test('Operational bundle rejects null, wrong-thread and malformed responses instead of claiming empty success', async()=>{
  for (const data of [null,{}, {conversation:{conversation_id:'other'},messages:[],internal_notes:[],events:[]}, {conversation:{conversation_id:'current'},messages:null,internal_notes:[],events:[]}]) {
    const result=await supportWith({data,error:null}).getOperationalConversationBundle('current');
    assert.ok(result.error);assert.equal(result.bundle.messages.length,0);
  }
});
test('Operational bundle preserves a valid empty thread and distinguishes a server error',async()=>{
  const data={conversation:{conversation_id:'current'},messages:[],internal_notes:[],events:[]};
  const valid=await supportWith({data,error:null}).getOperationalConversationBundle('current');
  assert.equal(valid.error,null);
  const failure=await supportWith({data:null,error:{message:'Not authorised'}}).getOperationalConversationBundle('current');
  assert.equal(failure.error.message,'Not authorised');
});
