import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/lib/sponsoredVisibility.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(){
 const exports={},element={},timers=new Map();let observe,visibility,views=0,next=0;
 const document={visibilityState:'visible',addEventListener:(_,fn)=>{visibility=fn;},removeEventListener:()=>{visibility=null;}};
 vm.runInNewContext(code,{exports,document,IntersectionObserver:class{constructor(fn){observe=fn;}observe(){}disconnect(){}},setTimeout:(fn,ms)=>{assert.equal(ms,1000);timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
 const cleanup=exports.observeSponsoredVisibility(element,()=>views++);
 return {cleanup,views:()=>views,intersect:ratio=>observe([{target:element,isIntersecting:ratio>0,intersectionRatio:ratio}]),hidden:value=>{document.visibilityState=value?'hidden':'visible';visibility?.();},tick:()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());}};
}
test('loading and briefly visible Sponsored cards are not impressions',()=>{
 const h=setup();h.tick();assert.equal(h.views(),0);h.intersect(0.49);h.tick();assert.equal(h.views(),0);h.intersect(0.75);h.intersect(0);h.tick();assert.equal(h.views(),0);
});
test('a qualifying visible card records once per mounted placement',()=>{
 const h=setup();h.intersect(0.5);h.tick();h.intersect(1);h.tick();assert.equal(h.views(),1);
});
test('background tabs and removed cards cannot finish an impression timer',()=>{
 const h=setup();h.intersect(1);h.hidden(true);h.tick();assert.equal(h.views(),0);h.hidden(false);h.cleanup();h.tick();assert.equal(h.views(),0);
});
