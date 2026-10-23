import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/propertyStayPage.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,Error,Date});
const row=id=>({reservation_id:String(id),created_at:'2026-10-23T10:00:00Z',page_created_at:'2026-10-23T10:00:00Z'});
test('Partner stay pages use a bounded lookahead and the last displayed row as cursor',()=>{
 const page=api.propertyStayPage(Array.from({length:51},(_,i)=>row(51-i)));
 assert.equal(page.rows.length,50);assert.equal(page.hasMore,true);assert.equal(page.cursor.id,'2');assert.equal(page.cursor.createdAt,'2026-10-23T10:00:00Z');
 assert.equal(api.propertyStayPage([]).cursor,null);assert.equal(api.propertyStayPage([row(1)]).hasMore,false);
});
test('Partner history rejects malformed, duplicate and oversized read results',()=>{
 for(const data of [null,{},[row(1),row(1)],[{...row(1),page_created_at:'bad'}],[{...row(1),reservation_id:''}],Array.from({length:52},(_,i)=>row(i))])assert.throws(()=>api.propertyStayPage(data));
});
test('undated history keeps its missing creation date while exposing an internal cursor',()=>{
 const legacy={...row(1),created_at:null,page_created_at:'1970-01-01T00:00:00Z'};const page=api.propertyStayPage([legacy]);
 assert.equal(page.rows[0].created_at,null);assert.equal(page.cursor.createdAt,'1970-01-01T00:00:00Z');
});
test('exact Partner booking targets cannot substitute another reservation or count',()=>{
 assert.equal(api.propertyStayTarget([row('old')],'old').reservation_id,'old');assert.equal(api.propertyStayTarget([],'missing'),null);
 assert.throws(()=>api.propertyStayTarget([row('other')],'old'));assert.throws(()=>api.propertyStayTarget([row(1),row(2)],'1'));
});
