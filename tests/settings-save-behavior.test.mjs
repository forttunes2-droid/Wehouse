import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(path,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:name=>name==='react/jsx-runtime'?jsx:deps[name]});return exports.default;}
test('shared switch exposes checked state, a touch target and reduced-motion styling',()=>{
 const Switch=load('src/components/SettingSwitch.tsx',{});const html=renderToStaticMarkup(React.createElement(Switch,{label:'Phone notifications',checked:false,onChange(){}}));assert.match(html,/role="switch"/);assert.match(html,/aria-checked="false"/);assert.match(html,/min-h-11/);assert.match(html,/motion-reduce:transition-none/);assert.match(html,/wh-switch-off/);
});
function privacyHarness(save){const successes=[],errors=[],updates=[];const Component=load('src/pages/PrivacySettings.tsx',{
 '@/hooks/useWorkspaceAccess':{useWorkspaceAccess:()=>({access:{personal_workspace:true,privileged_workspaces:[]},error:'',reload:async()=>{}})},
 react:{...React,useState:initial=>[initial,()=>{}],useEffect:effect=>effect(),useRef:value=>({current:value})},'@/lib/withTimeout':{withTimeout:async task=>await task},'@/components/PrivateCallSettings':()=>null,'@/components/SettingSwitch':()=>null,'@/components/AccountShell':()=>null,
 '@/lib/supabase':{updatePrivacySettings:save},sonner:{toast:{success:message=>successes.push(message),error:message=>errors.push(message)}}});
 const profile={user_id:'person',role:'user',privacy_profile_visible:true,privacy_search_visible:true};const outer=Component({profile,onUpdate:value=>updates.push(value),embedded:true});const rendered=outer.type(outer.props);const section=React.Children.toArray(rendered.props.children).find(child=>child.type==='section');const rows=section.props.children;return{rows,successes,errors,updates};}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('incoming call controls keep saves exclusive and reject contradictory receipts',async()=>{
 let resolve,calls=0;const changes=[];
 const preferences={allow_audio_calls:true,allow_video_calls:true};
 const Component=load('src/components/PrivateCallSettings.tsx',{
  react:{...React,useState:initial=>[initial===null?preferences:initial,value=>changes.push(value)],useEffect(){},useRef:value=>({current:value})},
  '@/components/SettingSwitch':()=>null,
  '@/lib/withTimeout':{withTimeout:async task=>await task},
  '@/lib/private-calls':{getCallPreferences:async()=>({preferences,error:null}),setCallPreferences:()=>{calls++;return new Promise(done=>{resolve=done;});}},
 });
 const tree=Component();const controls=React.Children.toArray(tree.props.children)[2];const rows=controls.props.children[0];
 rows[0].props.children[1].props.onChange(false);
 rows[1].props.children[1].props.onChange(false);
 assert.equal(calls,1);
 resolve({preferences,error:null});await flush();
 assert.ok(changes.includes(null),'Unconfirmed preferences must require reload');
 assert.ok(changes.includes('The saved call settings could not be confirmed.'));
 assert.equal(changes.at(-1),false,'Busy controls must be released after failure');
});
test('privacy retains existing state when a save throws and permits retry',async()=>{
 let count=0;const h=privacyHarness(async()=>{if(++count===1)throw Error('Offline');return{profile:{user_id:'person',privacy_profile_visible:false},error:null};});h.rows[0].props.onChange(false);await flush();assert.equal(h.successes.length,0);assert.equal(h.errors[0],'Offline');h.rows[0].props.onChange(false);await flush();assert.equal(h.updates.length,1);
});
test('privacy rejects a foreign or contradictory save receipt',async()=>{
 for(const profile of [null,{user_id:'other',privacy_profile_visible:false},{user_id:'person',privacy_profile_visible:true}]){const h=privacyHarness(async()=>({profile,error:null}));h.rows[0].props.onChange(false);await flush();assert.equal(h.successes.length,0);assert.equal(h.updates.length,0);assert.equal(h.errors.length,1);}
});
test('privacy blocks overlapping toggles while a request is pending',async()=>{
 let resolve,calls=0;const h=privacyHarness(()=>{calls++;return new Promise(done=>{resolve=done;});});h.rows[0].props.onChange(false);h.rows[1].props.onChange(false);assert.equal(calls,1);resolve({profile:{user_id:'person',privacy_profile_visible:false},error:null});await flush();assert.equal(h.successes.length,1);
});
