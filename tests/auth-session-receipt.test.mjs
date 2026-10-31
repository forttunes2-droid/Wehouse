import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/authSessionReceipt.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {isEndedSessionReceipt}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('only the authoritative ended-session code and purpose terminate a local login',()=>{
 assert.equal(isEndedSessionReceipt({code:'PT401',hint:'session_ended',message:'Translated text'}),true);
 for(const error of [null,Error('session ended'),{code:'PT401'},{code:'PT403',hint:'mfa_required'},{code:'PT401',hint:'configuration_missing'},{message:'Network unavailable'}])assert.equal(isEndedSessionReceipt(error),false);
});
