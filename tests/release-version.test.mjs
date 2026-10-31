import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['scripts/lib/release-version.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {sourceReleaseVersion}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const head='1'.repeat(40),syntheticMerge='2'.repeat(40);
test('PR artifacts identify the actual checkout instead of the synthetic workflow merge',()=>{
 assert.equal(sourceReleaseVersion(head,{GITHUB_SHA:syntheticMerge}),head);
 assert.equal(sourceReleaseVersion(head,{WEHOUSE_BUILD_VERSION:'an-older-label',GITHUB_SHA:syntheticMerge}),head);
});
test('a mismatched Vercel source stamp fails before a misleading release can be built',()=>{
 assert.throws(()=>sourceReleaseVersion(head,{VERCEL_GIT_COMMIT_SHA:syntheticMerge}),/does not match/);
 assert.equal(sourceReleaseVersion(head,{VERCEL_GIT_COMMIT_SHA:head}),head);
});
test('source archives retain supplied provenance and unstamped local builds stay identifiable',()=>{
 assert.equal(sourceReleaseVersion(null,{VERCEL_GIT_COMMIT_SHA:head}),head);
 assert.equal(sourceReleaseVersion(null,{},1234),'local-1234');
 assert.throws(()=>sourceReleaseVersion('branch-name',{}),/invalid/);
});
