import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/identitySubmission.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {confirmIdentityReviewSubmission:confirm}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('identity receipt is for independent review in the requested workspace, never browser approval',async()=>{
 const data={success:true,current:false,status:'pending_review',workspace:'worker'};
 assert.equal(await confirm(Promise.resolve({data,error:null}),'worker'),data);
 for(const invalid of [null,{},true,{...data,current:true},{...data,status:'passed'},{...data,workspace:'property_partner'}]){
  await assert.rejects(confirm(Promise.resolve({data:invalid,error:null}),'worker'),/could not be confirmed/);
 }
});
test('identity response loss and server rejection never produce a successful review receipt',async()=>{
 await assert.rejects(confirm(Promise.reject(new Error('Lost response')),'worker'),/Lost response/);
 await assert.rejects(confirm(Promise.resolve({data:{success:true},error:{message:'Review not saved'}}),'worker'),/could not be confirmed/);
});
