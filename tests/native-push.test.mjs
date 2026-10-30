import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
function moduleAt(path,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name],TextEncoder,Uint8Array,ArrayBuffer,Date,URLSearchParams,AbortSignal,crypto:webcrypto,fetch,atob,btoa,setTimeout,clearTimeout});return exports;}
const delivery=moduleAt('supabase/functions/_shared/pushDelivery.ts');
const job={job_id:'f8510000-3000-4000-8000-000000000001',lease_id:'lease',platform:'android',token:'test-token',user_id:'person',activity_event_id:'f8510000-3000-4000-8000-000000000002',workspace:'personal',attempts:1};
test('push activation is explicit and invalid provider configuration remains unavailable',()=>{
 assert.equal(Object.keys(delivery.pushConfiguration(()=>undefined)).length,0);
 const env={NATIVE_PUSH_ENABLED:'true',FCM_SERVICE_ACCOUNT_JSON:'{"project_id":"../unsafe","client_email":"x","private_key":"x"}',APNS_TEAM_ID:'team',APNS_KEY_ID:'key',APNS_PRIVATE_KEY:'key',APNS_TOPIC:'wrong',APNS_ENVIRONMENT:'production'};
 assert.equal(Object.keys(delivery.pushConfiguration(name=>env[name])).length,0);
});
test('lock-screen payload contains no domain content or external URL',()=>{
 const payload=delivery.pushPayload({...job,message:'secret',address:'private',title:'private',route:'https://evil.example'});
 assert.equal(payload.title,'WeHouse');assert.equal(payload.data.destination,'inbox');assert.doesNotMatch(JSON.stringify(payload),/secret|private|evil/);
});
test('provider failures distinguish invalid registration from retryable overload',()=>{
 assert.equal(delivery.pushFailure(404,'UNREGISTERED').outcome,'invalid');assert.equal(delivery.pushFailure(410,'Unregistered').outcome,'invalid');
 assert.equal(delivery.pushFailure(429,'').outcome,'retry');assert.equal(delivery.pushFailure(503,'').outcome,'retry');assert.equal(delivery.pushFailure(403,'').outcome,'failed');
});
function privatePem(bytes){return '-----BEGIN PRIVATE KEY-----\n'+Buffer.from(bytes).toString('base64')+'\n-----END PRIVATE KEY-----';}
test('FCM signs scoped OAuth assertions and requires an actual send receipt',async()=>{
 const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const key=privatePem(await webcrypto.subtle.exportKey('pkcs8',pair.privateKey));let missing=false,authCalls=0;
 const send=delivery.createPushSender({fcm:{project_id:'wehouse-test',client_email:'push@example.invalid',private_key:key}},async(url,options)=>{
  if(url.includes('oauth2')){authCalls++;const assertion=new URLSearchParams(options.body).get('assertion');const parts=assertion.split('.');const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
   assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');assert.equal(claims.exp-claims.iat,3600);
   assert.equal(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(parts[2],'base64url'),Buffer.from(parts.slice(0,2).join('.'))),true);
   return Response.json({access_token:'test-access',expires_in:3600});}
  const body=JSON.parse(options.body);assert.equal(body.message.android.notification.channel_id,'wehouse_updates');assert.equal(body.message.data.recipient,job.user_id);
  return Response.json(missing?{}:{name:'projects/wehouse-test/messages/receipt'});
 });
 assert.equal((await send(job)).outcome,'sent');missing=true;assert.equal((await send(job)).error,'fcm_receipt_missing');assert.equal(authCalls,1);
});
test('Apple delivery signs ES256 and uses the configured environment and topic',async()=>{
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const key=privatePem(await webcrypto.subtle.exportKey('pkcs8',pair.privateKey));
 const send=delivery.createPushSender({apple:{teamId:'team',keyId:'key',privateKey:key,topic:'com.wehouse.app',sandbox:true}},async(url,options)=>{
  assert.ok(url.startsWith('https://api.sandbox.push.apple.com/3/device/'));assert.equal(options.headers['apns-topic'],'com.wehouse.app');
  const parts=options.headers.authorization.slice(7).split('.');assert.equal(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(parts[2],'base64url'),Buffer.from(parts.slice(0,2).join('.'))),true);
  assert.equal(JSON.parse(options.body).destination,'inbox');return new Response(null,{status:200,headers:{'apns-id':job.job_id}});
 });assert.equal((await send({...job,platform:'ios'})).outcome,'sent');
});
test('unconfigured delivery never reports sent',async()=>{assert.equal((await delivery.createPushSender({})(job)).outcome,'retry');});

function clientHarness(options={}){
 const calls=[],listeners={};let enabled=options.enabled||false,fail=false,permission='granted';
 const bridge={addListener:async(name,callback)=>{listeners[name]=callback;return{remove:async()=>{delete listeners[name];}};},createChannel:async()=>{},checkPermissions:async()=>({receive:permission}),requestPermissions:async()=>({receive:permission}),removeAllDeliveredNotifications:async()=>{},register:async()=>{if(!options.defer)queueMicrotask(()=>listeners.registration({value:'a'.repeat(80)}));}};
 const supabase={rpc:async(name,args)=>{calls.push({name,args});if(fail)return{data:null,error:null};if(args.p_action!=='status')enabled=args.p_action==='enable';return{data:{user_id:'person',device_id:'test-device-identifier',platform:'android',enabled},error:null};},functions:{invoke:async()=>({data:{android:true,ios:false},error:null})}};
 const api=moduleAt('src/lib/nativePush.ts',{'@capacitor/core':{Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'}},'@capacitor/push-notifications':{PushNotifications:bridge},'@/lib/supabase/client':{supabase},'@/lib/supabase/session':{getDeviceId:()=> 'test-device-identifier'},'@/lib/withTimeout':{withTimeout:async task=>await task}});
 return{api,calls,listeners,get enabled(){return enabled;},setFail(){fail=true;},deny(){permission='denied';}};
}
test('native consent requires persisted receipt and uses the expected identity',async()=>{
 const h=clientHarness();const stop=h.api.startNativePush('person',()=>{});await new Promise(resolve=>setTimeout(resolve,10));
 await h.api.setPhonePush('person',true);assert.equal(h.enabled,true);assert.equal(h.calls.at(-1).args.p_expected_user_id,'person');
 h.setFail();await assert.rejects(()=>h.api.setPhonePush('person',false));stop();
});
test('denied phone permission never registers a delivery token',async()=>{
 const h=clientHarness();h.deny();const stop=h.api.startNativePush('person',()=>{});await new Promise(resolve=>setTimeout(resolve,10));await assert.rejects(()=>h.api.setPhonePush('person',true));assert.equal(h.calls.some(row=>row.args.p_action==='enable'),false);stop();
});
test('push taps reject foreign accounts and arbitrary destinations',()=>{
 const h=clientHarness();const payload={recipient:'person',destination:'inbox',eventId:job.activity_event_id};assert.equal(h.api.validPushTap(payload,'person'),true);assert.equal(h.api.validPushTap(payload,'other'),false);assert.equal(h.api.validPushTap({...payload,destination:'https://evil.example'},'person'),false);
});
test('a delayed startup registration cannot undo a confirmed off switch',async()=>{
 const h=clientHarness({enabled:true,defer:true}),stop=h.api.startNativePush('person',()=>{});await new Promise(resolve=>setTimeout(resolve,10));
 await h.api.setPhonePush('person',false);h.listeners.registration({value:'b'.repeat(80)});await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.enabled,false);assert.equal(h.calls.some(row=>row.args.p_action==='enable'),false);stop();
});
