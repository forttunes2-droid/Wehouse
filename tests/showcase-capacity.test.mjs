import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/showcaseCapacity.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {parseShowcaseCapacity,showcaseCapacityError}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const limits={posts:11,videos:3,post_limit:12,video_limit:3,photo_bytes:2000000,video_bytes:13000000};
test('showcase keeps separate photo/video capacity and does not reset limits for legacy profiles',()=>{
 assert.equal(showcaseCapacityError(parseShowcaseCapacity(limits),false),null);
 assert.match(showcaseCapacityError(limits,true),/already has 3 videos/);
 assert.match(showcaseCapacityError({...limits,posts:12},false),/12 work samples/);
 assert.match(showcaseCapacityError({...limits,posts:28},false),/Remove an old sample/);
});
test('missing, fractional or contradictory allowance receipts cannot enable uploads',()=>{
 for(const value of [null,[],{}, {...limits,posts:-1},{...limits,post_limit:0},{...limits,video_limit:13},{...limits,photo_bytes:Infinity},{...limits,posts:1.5}])assert.throws(()=>parseShowcaseCapacity(value),/could not be confirmed/);
});
