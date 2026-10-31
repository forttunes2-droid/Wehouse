import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('supabase/functions/_shared/smallJsonRequest.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {readSmallJsonRequest,JsonRequestError}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const input=(body,headers={})=>new Request('https://fixture.invalid',{method:'POST',body,headers});
test('small JSON accepts object input and split UTF-8 without a Content-Length',async()=>{
 const bytes=new TextEncoder().encode('{"text":"🏡"}');
 const body=new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,11));controller.enqueue(bytes.slice(11));controller.close();}});
 assert.deepEqual(await readSmallJsonRequest(new Request('https://fixture.invalid',{method:'POST',body,duplex:'half'}),100),{text:'🏡'});
});
test('small JSON rejects a chunked oversized body even with a forged small length',async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(17));controller.enqueue(new Uint8Array(17));},cancel(){cancelled=true;}});
 await assert.rejects(readSmallJsonRequest(new Request('https://fixture.invalid',{method:'POST',body,duplex:'half',headers:{'content-length':'1'}}),32),error=>error instanceof JsonRequestError&&error.status===413);
 assert.equal(cancelled,true);
});
test('small JSON rejects declared overflow before reading and refuses non-object data',async()=>{
 await assert.rejects(readSmallJsonRequest(input('{}',{'content-length':'999'}),32),error=>error.status===413);
 for(const value of ['[]','null','"text"','{bad'])await assert.rejects(readSmallJsonRequest(input(value),32),error=>error.status===400);
 await assert.rejects(readSmallJsonRequest(input(new Uint8Array([255,255])),32),error=>error.status===400);
 assert.deepEqual(await readSmallJsonRequest(input('{"latitude":8.5,"longitude":7.2}'),64),{latitude:8.5,longitude:7.2});
});
