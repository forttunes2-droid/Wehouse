import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function adapters(result,throws=false){
 const exports={};const deadlines=[];
 vm.runInNewContext(compile('src/lib/private-calls.ts'),{exports,Error,require:name=>name.includes('withTimeout')?{withTimeout:async(task,ms)=>{deadlines.push(ms);return task;}}:{supabase:{rpc:async()=>{if(throws)throw Error('Offline');return result;}}}});
 return {api:exports,deadlines};
}
test('private call adapters deny malformed receipts and contain network errors',async()=>{
 for(const value of [null,{},false,{allow_audio_calls:true}]){
 const {api}=adapters({data:value,error:null});
 assert.ok((await api.getCallPreferences()).error);
 assert.ok((await api.getActiveCalls()).error);
 assert.ok((await api.getCallDetails('call')).error);
 }
 const {api,deadlines}=adapters(null,true);
 assert.equal((await api.startPrivateCall('roommate','conversation','audio')).error.message,'Offline');
 assert.deepEqual(deadlines,[12000]);
 const valid=adapters({data:{allow_audio_calls:true,allow_video_calls:false},error:null});
 assert.equal((await valid.api.getCallPreferences()).preferences.allow_video_calls,false);
 const foreign=adapters({data:{id:'other-call',caller_id:'caller',callee_id:'callee',call_type:'audio',status:'accepted'},error:null});
 assert.ok((await foreign.api.respondPrivateCall('requested-call',true)).error);
});
function mediaHarness(getUserMedia){
 const effects=[],channels=[];let closes=0;
 const exports={};const peer={getSenders:()=>[],close(){closes++;},addTrack(){},createOffer:async()=>({type:'offer'}),setLocalDescription:async()=>{},connectionState:'new'};
 const channel={on(){return this;},subscribe(){return this;}};
 vm.runInNewContext(compile('src/components/PrivateCallCenter.tsx')+'\nexports.RtcCall=RtcCall;',{
 exports,require:name=>name==='react/jsx-runtime'?jsx:name==='react'?{...React,useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn),useCallback:fn=>fn}:name==='sonner'?{toast:{error(){}}}:name.includes('private-calls')?{
 getPrivateCallIceServers:async()=>({iceServers:[],relayReady:true}),listCallSignals:async()=>({signals:[],error:null}),sendCallSignal:async()=>({error:null})}:{supabase:{channel:()=>channel,removeChannel:async value=>channels.push(value)}},
 navigator:{mediaDevices:{getUserMedia}},HTMLMediaElement:function(){},RTCPeerConnection:function(){return peer;},window:{setTimeout,clearTimeout},DOMException
 });
 const tree=exports.RtcCall({call:{id:'call',caller_id:'caller',callee_id:'callee',call_type:'audio',status:'ringing'},userId:'caller',onHangup(){}});
 const cleanups=effects.map(effect=>effect()).filter(Boolean);
 return{tree,cleanup:()=>cleanups.forEach(fn=>fn()),channels,closed:()=>closes};
}
test('closing call before microphone permission resolves stops every late track',async()=>{
 let resolve;let stops=0;
 const fixture=mediaHarness(()=>new Promise(done=>{resolve=done;}));
 fixture.cleanup();
 resolve({getTracks:()=>[{stop(){stops++;}},{stop(){stops++;}}]});
 await flush();
 assert.equal(stops,2);
});
test('call cleanup removes signal channel, stops media and closes peer',async()=>{
 let stops=0;
 const fixture=mediaHarness(async()=>({getTracks:()=>[{stop(){stops++;}}]}));
 await flush();fixture.cleanup();await flush();
 assert.equal(stops,1);assert.equal(fixture.channels.length,1);assert.equal(fixture.closed(),1);
});
