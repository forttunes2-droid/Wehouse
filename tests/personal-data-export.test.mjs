import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/personalDataExport.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Set,Object,Error,Date});
const request={conversationId:'99700000-1000-4000-8000-000000000001',approvalId:'99700000-2000-4000-8000-000000000001',section:'services',cursor:null};
function page(r,records=[],next=null){return {conversation_id:r.conversationId,approval_id:r.approvalId,section:r.section,cursor:r.cursor,next_cursor:next,records,prepared_at:'2026-10-30T12:00:00Z'};}
test('export preserves page order, exact request identity and resumable part metadata',async()=>{
 const seen=[];const result=await exports.preparePersonalDataExport(async r=>{seen.push({...r});return r.cursor===null?page(r,[{id:1,description:'a\nb'},{id:2}], 'two'):page(r,[{id:3}]);},request);
 assert.deepEqual(seen.map(p=>p.cursor),[null,'two']);assert.ok(seen.every(p=>p.conversationId===request.conversationId&&p.approvalId===request.approvalId));
 const lines=result.text.trim().split('\n').map(JSON.parse);assert.deepEqual(lines.slice(1,-1).map(p=>p.record.id),[1,2,3]);assert.equal(lines[1].record.description,'a\nb');assert.equal(lines.at(-1).next_cursor,null);assert.equal(result.count,3);
});
test('wrong account, approval, section, cursor or malformed records never produce a file',async()=>{
 for(const change of [{conversation_id:'other'},{approval_id:'other'},{section:'wallets'},{cursor:'wrong'},{records:[null]},{records:new Array(26).fill({id:1})},{next_cursor:''},{prepared_at:'bad'}])await assert.rejects(exports.preparePersonalDataExport(async r=>({...page(r),...change}),request));
 await assert.rejects(exports.preparePersonalDataExport(async r=>page(r),{...request,section:'__proto__'}));
});
test('a lost page result, repeated cursor or account switch leaves no successful export',async()=>{
 await assert.rejects(exports.preparePersonalDataExport(async()=>{throw Error('lost transport');},request),/lost transport/);
 await assert.rejects(exports.preparePersonalDataExport(async r=>page(r,[],r.cursor===null?'next':'next'),request),/page could not be confirmed/);
 let active=true;await assert.rejects(exports.preparePersonalDataExport(async r=>{active=false;return page(r,[{private:'data'}]);},request,()=>active),/cancelled/);
});
test('large histories stop at a bounded part and continue at exactly the returned cursor',async()=>{
 let calls=0;const result=await exports.preparePersonalDataExport(async r=>{calls++;return page(r,[{id:calls}],String(calls));},request);
 assert.equal(calls,40);assert.equal(result.nextCursor,'40');assert.equal(result.count,40);
 let first;const next=await exports.preparePersonalDataExport(async r=>{first=r.cursor;return page(r,[{id:41}]);},{...request,cursor:result.nextCursor});assert.equal(first,'40');assert.equal(next.count,1);
});
test('oversized pages fail instead of building an unbounded sensitive-data blob',async()=>{
 await assert.rejects(exports.preparePersonalDataExport(async r=>page(r,[{body:'x'.repeat(1024*1024)}]),request),/too large/);
});
