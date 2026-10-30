import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const {outputFiles}=await build({stdin:{contents:fs.readFileSync('src/lib/e2ee.ts','utf8')+'\nexport {readPersistentEncryptedAttachment,writePersistentEncryptedAttachment};',resolveDir:path.resolve('src/lib'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'isolated-cache',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'client',namespace:'fixture'}));
 api.onResolve({filter:/^@\/lib\/chatMediaPolicy$/},()=>({path:'media',namespace:'fixture'}));
 api.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='client'?'export const supabase={};export const isWebPasskeyEnabled=false;':'export const validateMessageMedia=()=>{}; export const normaliseChatMediaType=x=>x;',loader:'js'}));
 api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{kind:args.kind,resolveDir:process.cwd()}));
}}]});
const cacheModule=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const key=path=>new Request(`https://wehouse.invalid/e2ee-media/friend/thread/${encodeURIComponent(path)}`);
function setup(){
 const rows=new Map();let reads=0,locks=0;
 const cache={async match(request){reads++;return rows.get(request.url)?.clone();},async delete(request){return rows.delete(request.url);},async keys(){return [...rows.keys()].map(url=>new Request(url));},async put(request,response){rows.set(request.url,response.clone());}};
 globalThis.window={caches:{open:async()=>cache},navigator:{locks:{request:async(name,work)=>{assert.equal(name,'wehouse-e2ee-media-cache');locks++;return work();}}}};
 return {rows,counts:()=>({reads,locks})};
}
const receipt=(size,expires=Date.now()+100000)=>new Response(new Uint8Array([1]),{headers:{'content-length':String(size),'x-wehouse-expires':String(expires)}});
test('persistent ciphertext cache evicts oldest entries before exceeding its byte budget and keeps a reusable receipt',async()=>{
 const {rows,counts}=setup();
 for(let i=0;i<3;i++)rows.set(key('old'+i).url,receipt(20*1024*1024));
 await cacheModule.writePersistentEncryptedAttachment('friend','thread','new',new ArrayBuffer(8*1024*1024));
 assert.equal(rows.has(key('old0').url),false);assert.equal(rows.size,3);assert.equal(counts().locks,1);
 const bytes=await cacheModule.readPersistentEncryptedAttachment('friend','thread','new');assert.equal(bytes.byteLength,8*1024*1024);
 const total=[...rows.values()].reduce((n,r)=>n+Number(r.headers.get('content-length')),0);assert.ok(total<=64*1024*1024);
});
test('expired or legacy unbudgeted cache entries are removed; unsupported browser locking skips persistent writes',async()=>{
 const {rows}=setup();rows.set(key('expired').url,receipt(1,Date.now()-1));rows.set(key('old').url,new Response('old'));
 assert.equal(await cacheModule.readPersistentEncryptedAttachment('friend','thread','expired'),null);assert.equal(rows.size,1);
 await cacheModule.writePersistentEncryptedAttachment('friend','thread','new',new ArrayBuffer(2));assert.equal(rows.has(key('old').url),false);
 window.navigator.locks=undefined;await cacheModule.writePersistentEncryptedAttachment('friend','thread','skip',new ArrayBuffer(2));assert.equal(rows.has(key('skip').url),false);
});
