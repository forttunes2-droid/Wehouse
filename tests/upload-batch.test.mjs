import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/uploadBatch.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {uploadInParallel}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('image preparation stays at two concurrent files and preserves gallery order',async()=>{
 let active=0,peak=0;
 const result=await uploadInParallel([0,1,2,3,4],async value=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,value===0?15:1));active--;return value*2;});
 assert.equal(peak,2);assert.deepEqual(result,[0,2,4,6,8]);
});
test('failed batches stop new work and await already-started uploads before returning the error',async()=>{
 const started=[];let finish,finished=false,rejected=false;
 const gate=new Promise(resolve=>finish=resolve);
 const result=uploadInParallel([0,1,2,3],async value=>{started.push(value);if(value===0)throw Error('Upload failed');await gate;finished=true;return value;});
 result.catch(()=>{rejected=true;});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,[0,1]);assert.equal(rejected,false);
 finish();await assert.rejects(result,/Upload failed/);assert.equal(finished,true);assert.deepEqual(started,[0,1]);
});
