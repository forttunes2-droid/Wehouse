import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function hook(visibility='visible',read=async()=>({presence:{visible:true,online:true,last_seen:null},error:null})){
 let effect,interval,cleanup,state;const events=new Map(),calls=[],exports={};
 const document={visibilityState:visibility,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 vm.runInNewContext(compile('src/hooks/useChatPresence.ts'),{exports,document,window:{setInterval:fn=>{interval=fn;return 1;},clearInterval:()=>{interval=null;}},require:name=>name==='react'?{useEffect:fn=>{effect=fn;},useState:value=>[value,next=>{state=next;}]}:{touchMyPresence:async online=>{calls.push(online);return{at:null,error:null};},getChatPeerPresence:async peer=>{calls.push(peer);return read();}}});
 return{start(peer='peer'){exports.default(peer);cleanup=effect();},stop(){cleanup?.();},tick(){interval?.();},visible(value){document.visibilityState=value;events.get('visibilitychange')?.();},get calls(){return calls;},get state(){return state;}};
}
test('background chat timers neither mark a person online nor poll peer activity',async()=>{
 const h=hook('hidden');h.start();h.tick();await flush();assert.deepEqual(h.calls,[]);
 h.visible('visible');await flush();assert.deepEqual(h.calls,[true,'peer']);assert.equal(h.state.online,true);
 h.visible('hidden');h.tick();h.tick();await flush();assert.deepEqual(h.calls,[true,'peer',false]);assert.equal(h.state,null);h.stop();
});
test('slow activity reads share one refresh and cannot update an unmounted chat',async()=>{
 let finish;const waiting=new Promise(resolve=>{finish=resolve;});const h=hook('visible',()=>waiting);h.start();await flush();h.tick();h.tick();assert.deepEqual(h.calls,[true,'peer']);h.stop();finish({presence:{visible:true,online:true},error:null});await flush();assert.equal(h.state,null);
});
test('a rejected presence read remains absent and does not become an unhandled chat failure',async()=>{
 const h=hook('visible',async()=>{throw Error('Synthetic presence outage');});h.start();await flush();assert.equal(h.state,null);h.stop();
});
test('missing peers perform no activity reads',async()=>{const h=hook();h.start(null);await flush();assert.deepEqual(h.calls,[]);assert.equal(h.state,null);});
test('hidden or malformed presence receipts never retain a timestamp or invent recent activity',async()=>{
 let value;const exports={};vm.runInNewContext(compile('src/lib/supabase/presence.ts'),{exports,Date,Number,require:name=>name==='./client'?{supabase:{rpc:async()=>({data:value,error:null})}}:{withTimeout:async task=>task}});
 value={visible:false,online:true,last_seen:'2026-10-29T10:00:00Z'};const hidden=(await exports.getChatPeerPresence('peer')).presence;assert.equal(hidden.online,false);assert.equal(hidden.last_seen,null);assert.equal(exports.chatPresenceLabel(hidden),null);
 value={visible:true,online:false,last_seen:'invalid'};assert.equal(exports.chatPresenceLabel((await exports.getChatPeerPresence('peer')).presence),null);
 value={visible:true,online:true,last_seen:'2026-10-29T10:00:00Z'};assert.equal(exports.chatPresenceLabel((await exports.getChatPeerPresence('peer')).presence),'Online');
});
