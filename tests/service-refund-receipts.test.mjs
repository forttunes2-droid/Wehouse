import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {build} from 'esbuild';
const source=ts.createSourceFile('worker.ts',fs.readFileSync('src/lib/supabase/worker-bookings.ts','utf8'),ts.ScriptTarget.Latest,true);
const code=source.statements.filter(node=>node.name&&['cancelPaidBookingBeforeStart','requestWorkerRefundReview'].includes(node.name.getText(source))).map(node=>node.getFullText(source)).join('\n');
const {outputFiles}=await build({stdin:{contents:'const supabase=globalThis.__refundClient;\n'+code,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
async function setup(data,error=null){globalThis.__refundClient={rpc:async()=>({data,error})};return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//'+Math.random()).toString('base64'));}
test('refund review requires a real review ID instead of a truthy response',async()=>{
 for(const receipt of [null,{},true,'pending']){const api=await setup(receipt);assert.ok((await api.requestWorkerRefundReview('booking','worker_no_show','Did not arrive')).error);}
 const id='99100000-0000-4000-8000-000000000001',api=await setup(id);assert.equal((await api.requestWorkerRefundReview('booking','worker_no_show','Did not arrive')).reviewId,id);
});
test('cancellation confirms its result and bounded amount while allowing an idempotent already-cancelled receipt',async()=>{
 for(const receipt of [null,{}, {cancelled:'yes'},{cancelled:true,refund_amount:-1},{cancelled:true,refund_amount:Infinity}]){const api=await setup(receipt);assert.ok((await api.cancelPaidBookingBeforeStart('booking','Plans changed')).error);}
 for(const receipt of [{cancelled:true,refund_amount:12000},{cancelled:true,already:true}]){const api=await setup(receipt);assert.equal((await api.cancelPaidBookingBeforeStart('booking','Plans changed')).error,null);}
});
