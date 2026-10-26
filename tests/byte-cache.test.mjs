import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/byteCache.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {ByteCache}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('media memory uses a byte budget, evicts least recently used and returns isolated buffers',()=>{
 const c=new ByteCache(10,100);c.set('a',new ArrayBuffer(4),0);c.set('b',new ArrayBuffer(4),0);
 new Uint8Array(c.get('a',1))[0]=9;assert.equal(new Uint8Array(c.get('a',1))[0],0);
 c.set('c',new ArrayBuffer(4),2);assert.equal(c.get('b',2),null);assert.equal(c.byteLength,8);
 c.set('oversize',new ArrayBuffer(11),2);assert.equal(c.byteLength,8);
 c.set('a',new ArrayBuffer(6),3);assert.equal(c.byteLength,10);
 c.clear();assert.equal(c.byteLength,0);assert.equal(c.get('a',3),null);
});
test('expired ciphertext is removed before reads or writes and does not retain memory budget',()=>{
 const c=new ByteCache(10,5);c.set('a',new ArrayBuffer(8),0);
 assert.equal(c.get('a',5),null);assert.equal(c.byteLength,0);
 c.set('b',new ArrayBuffer(8),6);c.set('c',new ArrayBuffer(7),11);
 assert.equal(c.byteLength,7);assert.equal(c.get('b',11),null);
});
