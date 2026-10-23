import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function compile(path,context={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,crypto:globalThis.crypto,TextEncoder,Uint8Array,Uint32Array,Date,...context});return exports;
}
const security=compile('supabase/functions/_shared/emailSecurity.ts');
test('security codes use eight digits and their digest binds account, purpose and challenge',async()=>{
  for(let i=0;i<100;i++)assert.match(security.createEmailSecurityCode(),/^\d{8}$/);
  const hash=await security.emailSecurityHash('a'.repeat(32),'challenge','account','device_confirmation','12345678');
  for(const args of [['other','account','device_confirmation'],['challenge','other','device_confirmation'],['challenge','account','password_recovery']])
    assert.notEqual(hash,await security.emailSecurityHash('a'.repeat(32),...args,'12345678'));
  assert.equal(security.sameEmailSecurityHash(hash,hash),true);
  assert.equal(security.sameEmailSecurityHash(hash,'b'.repeat(64)),false);
  assert.equal(security.securityPurpose('signup'),null);
});
test('pending devices use a separate tab-scoped record with expiry and no future timestamps',()=>{
  const values=new Map();const sessionStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const pending=compile('src/lib/pendingDevice.ts',{sessionStorage});
  const device={sessionId:'pending-session',trustStatus:'pending',device:'Desktop',os:'Windows',browser:'Edge',location:'Unknown'};
  pending.savePendingDevice(device);assert.equal(pending.readPendingDevice().sessionId,'pending-session');
  for(const at of [Date.now()+60000,Date.now()-31*60*1000]){
    values.set('wh_pending_device',JSON.stringify({device,at}));assert.equal(pending.readPendingDevice(),null);
  }
  assert.equal(values.has('wh_google_verification'),false);
});
test('device approval and password recovery do not use browser-supplied Auth OTP tokens as purpose proof',()=>{
  const edge=fs.readFileSync('supabase/functions/email-account-security/index.ts','utf8');
  assert.match(edge,/sameEmailSecurityHash\(hash,challenge\.code_hash\)/);
  assert.ok(edge.indexOf('sameEmailSecurityHash(hash,challenge.code_hash)')<edge.indexOf('admin.auth.admin.generateLink'));
  assert.doesNotMatch(edge,/token:code|signInWithOtp|resetPasswordForEmail|console\.log/);
  assert.match(edge,/finish_email_password_recovery/);
  assert.match(edge,/signOut\(recoveryToken,'global'\)/);
  const auth=fs.readFileSync('src/hooks/useAuth.ts','utf8');
  assert.doesNotMatch(auth,/confirmCurrentDeviceWithGoogle|saveGoogleVerification\(\{context:'new_device'/);
  assert.equal((auth.match(/if\(registration\.trustStatus==='pending'\)/g)||[]).length,2);
  assert.equal((auth.match(/registration\.trustStatus!=='trusted'\|\|!registration\.sessionId/g)||[]).length,2);
});
test('new-login notices require a matching receipt and use theme-aware surfaces',()=>{
  const source=fs.readFileSync('src/components/NewLoginAlert.tsx','utf8');
  assert.match(source,/data\?\.session_id !== alert\.sessionId/);
  assert.match(source,/actionLock\.current = true/);
  assert.doesNotMatch(source,/bg-\[#11141C\]|text-\[#A4A7B0\]/);
});

test('email transport requires a delivery receipt and uses the correct purpose wording',async()=>{
  let request;
  const transport=compile('supabase/functions/_shared/emailSecurity.ts',{AbortSignal,
    fetch:async(url,init)=>{request={url,body:JSON.parse(init.body)};return new Response(JSON.stringify({id:'delivery-receipt'}));}});
  assert.equal(await transport.sendEmailSecurityCode({apiKey:'test-only',from:'security@example.invalid'},'person@example.invalid','12345678','device_confirmation'),true);
  assert.match(request.body.subject,/device/);assert.doesNotMatch(request.body.subject,/password/);
  const unavailable=compile('supabase/functions/_shared/emailSecurity.ts',{AbortSignal,fetch:async()=>new Response('{}')});
  assert.equal(await unavailable.sendEmailSecurityCode({apiKey:'test-only',from:'security@example.invalid'},'person@example.invalid','12345678','password_recovery'),false);
});

test('public recovery fails closed without mail configuration and device confirmation requires a bearer',async()=>{
  let handler;
  const source=ts.transpileModule(fs.readFileSync('supabase/functions/email-account-security/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:{},Response,Request,AbortSignal,crypto,TextEncoder,TextDecoder,Uint8Array,atob,
    Deno:{serve:fn=>{handler=fn;},env:{get:()=>undefined}},
    require:name=>name.includes('emailSecurity')?security:{createClient:()=>{throw Error('Client must not be created before configuration');}}});
  const request=body=>new Request('https://example.invalid/',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await handler(request({action:'start',purpose:'device_confirmation'}))).status,401);
  const result=await handler(request({action:'start',purpose:'password_recovery',identifier:'person@example.invalid'}));
  assert.equal(result.status,503);assert.equal((await result.json()).success,undefined);
  assert.equal((await handler(request({action:'start',purpose:'signup'}))).status,400);
  assert.equal((await handler(request({action:'start',purpose:'password_recovery',padding:'x'.repeat(5000)}))).status,413);
});


test('email recovery throttles fail closed at every budget',()=>{
 const source=fs.readFileSync('supabase/functions/email-account-security/index.ts','utf8');
 assert.match(source,/'email_security_network',30,600,true/);
 assert.match(source,/email_.*_send.*,1,60,true/);
 assert.match(source,/'email_security_daily',20,86400,true/);
});

test('email change rejects malformed pending records and mismatched receipts',async()=>{
 let pending,receipt,calls=0;
 const api=compile('src/lib/supabase/auth.ts',{sessionStorage:{getItem:()=>JSON.stringify(pending),removeItem:()=>{}},
 require:name=>name==='./client'?{supabase:{rpc:async()=>{calls++;return{data:receipt,error:null};},auth:{refreshSession:async()=>({})}}}:name==='@/lib/withTimeout'?{withTimeout:task=>task}:{}});
 for(const value of [{email:'new@example.invalid',at:Date.now()+60000},{email:'invalid',at:Date.now()},{email:'new@example.invalid'}]){
 pending=value;assert.ok((await api.finishEmailChangeWithGoogle()).error);
 }
 assert.equal(calls,0);
 pending={email:'new@example.invalid',at:Date.now()};
 for(const value of [null,{},'someone@example.invalid']){receipt=value;assert.ok((await api.finishEmailChangeWithGoogle()).error);}
 receipt=pending.email;assert.equal((await api.finishEmailChangeWithGoogle()).email,pending.email);
});
