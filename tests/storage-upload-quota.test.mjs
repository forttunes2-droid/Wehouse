import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/storageUploadQuota.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createStorageUploadQuota}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const auth={authorization:'Bearer fixture-user',apikey:'fixture-public'};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('SDK upload reserves first, sends its body once and acknowledges the same ticket without consuming the Storage response',async()=>{
 const calls=[],body=new Blob(['sample']);
 const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async(url,init)=>{
  calls.push({url,init});
  if(url.endsWith('reserve_my_media_upload'))return response({id:'ticket'});
  if(url.endsWith('complete_my_media_upload'))return response(true);
  return response({Key:'chat-files/path'});
 });
 const result=await quota.fetch('https://test.supabase.co/storage/v1/object/chat-files/e2ee%2Fsample.bin',{method:'POST',headers:auth,body});
 assert.deepEqual(calls.map(c=>c.url.split('/').at(-1)),['reserve_my_media_upload','e2ee%2Fsample.bin','complete_my_media_upload']);
 assert.deepEqual(JSON.parse(calls[0].init.body),{p_bucket:'chat-files',p_name:'e2ee/sample.bin'});
 assert.equal(calls[1].init.body,body);assert.deepEqual(await result.json(),{Key:'chat-files/path'});
 assert.deepEqual(JSON.parse(calls[2].init.body),{p_reservation_id:'ticket'});
});
test('refused or malformed allocations prevent media transfer; acknowledgement failure preserves an uploaded asset',async()=>{
 for(const receipt of [response({message:'Capacity full'},400),response({id:null})]){
  let calls=0;const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async()=>{calls++;return receipt;});
  await assert.rejects(quota.fetch('https://test.supabase.co/storage/v1/object/avatars/photo.jpg',{method:'POST',headers:auth,body:new Blob(['x'])}),/Capacity full|could not be confirmed/);assert.equal(calls,1);
 }
 const calls=[];const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async(url)=>{
  calls.push(url);return url.endsWith('reserve_my_media_upload')?response({id:'saved'}):url.endsWith('complete_my_media_upload')?response({message:'Lost acknowledgement'},503):response({Key:'saved'});
 });
 assert.equal((await quota.fetch('https://test.storage.supabase.co/storage/v1/object/avatars/photo.jpg',{method:'PUT',headers:auth,body:new Blob(['x'])})).status,200);
 assert.equal(calls.length,3);assert.ok(!calls.some(url=>url.includes('delete')));
});
test('reads, signed viewing URLs and non-Storage API calls do not allocate upload space',async()=>{
 const calls=[];const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async(url)=>{calls.push(url);return response({});});
 for(const [url,method] of [['https://test.supabase.co/rest/v1/rpc/read','POST'],['https://test.supabase.co/storage/v1/object/sign/chat-files/a','POST'],['https://test.supabase.co/storage/v1/object/list/chat-files','POST'],['https://test.supabase.co/storage/v1/object/authenticated/chat-files/a','GET']])await quota.fetch(url,{method});
 assert.equal(calls.length,4);assert.ok(calls.every(url=>!url.includes('reserve_my_media_upload')));
});
test('publishing a private property candidate reserves the public copy destination',async()=>{
 const calls=[];const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async(url,init)=>{calls.push({url,body:init?.body});return response(url.endsWith('reserve_my_media_upload')?{id:'copy-ticket'}:true);});
 await quota.fetch('https://test.supabase.co/storage/v1/object/copy',{method:'POST',headers:auth,body:JSON.stringify({bucketId:'listing-candidates',sourceKey:'private/photo.jpg',destinationKey:'listings/home/photo.jpg',destinationBucket:'listing-images'})});
 assert.deepEqual(JSON.parse(calls[0].body),{p_bucket:'listing-images',p_name:'listings/home/photo.jpg'});assert.equal(calls.length,3);
});
test('SDK file transfer has two shared slots rather than unbounded Promise.all uploads',async()=>{
 let release,active=0,peak=0,mediaCalls=0;const gate=new Promise(resolve=>release=resolve);
 const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async(url)=>{
  if(url.endsWith('reserve_my_media_upload'))return response({id:'ticket'});
  if(url.endsWith('complete_my_media_upload'))return response(true);
  active++;mediaCalls++;peak=Math.max(peak,active);await gate;active--;return response({});
 });
 const pending=Array.from({length:6},(_,i)=>quota.fetch(`https://test.supabase.co/storage/v1/object/avatars/${i}.jpg`,{method:'POST',headers:auth,body:new Blob(['x'])}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(mediaCalls,2);release();await Promise.all(pending);assert.equal(peak,2);assert.equal(mediaCalls,6);
});
test('account changes cancel queued uploads before another reservation or media transfer starts',async()=>{
 const quota=createStorageUploadQuota('https://test.supabase.co','https://test.storage.supabase.co',async()=>{throw Error('Unexpected network');});
 let release;const gate=new Promise(resolve=>release=resolve);let queuedStarted=false;
 const first=quota.run(()=>gate),second=quota.run(()=>gate),queued=quota.run(async()=>{queuedStarted=true;});
 quota.reset();release();await Promise.all([first,second]);await assert.rejects(queued,/account changed/);assert.equal(queuedStarted,false);
 assert.equal(await quota.run(async()=>42),42);
});
