import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

// A bounded behaviour check, never a hosted load test or a target-account attack.
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.114.0','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const origin=new URL(status.API_URL||status.api_url);
assert.ok(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname),'Disposable loopback Auth only');
const key=status.PUBLISHABLE_KEY||status.ANON_KEY||status.publishable_key||status.anon_key;
const serviceKey=status.SERVICE_ROLE_KEY||status.service_role_key;
assert.ok(key&&serviceKey);
const admin=createClient(origin.href,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`rate-limit-${randomBytes(8).toString('hex')}@example.invalid`;
const password=randomBytes(24).toString('base64url');
const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
async function attempt(value){
 const response=await fetch(new URL('/auth/v1/token?grant_type=password',origin),{
  method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({email,password:value}),signal:AbortSignal.timeout(15000),
 });
 const body=await response.json();
 return{status:response.status,body};
}
try{
 let blocked=false;
 for(let index=0;index<40;index++){
  const result=await attempt('incorrect-'+password);
  assert.ok(!result.body.access_token,'Incorrect password created a session');
  if(result.status===429){blocked=true;break;}
  assert.equal(result.status,400);assert.equal(result.body.error_code,'invalid_credentials');
 }
 assert.equal(blocked,true,'Direct password endpoint did not enforce a temporary rate limit within the bounded burst');
 // Provider token-bucket recovery, not a permanent account ban. A five-second
 // pause refills at least one slot at the declared 150/5-minute local limit.
 await new Promise(resolve=>setTimeout(resolve,5000));
 const recovered=await attempt(password);
 assert.equal(recovered.status,200,'Correct password remained locked after provider bucket recovery');
 assert.ok(recovered.body.access_token);
 console.log('Direct local Auth rejected a bounded password-guess burst with 429, then accepted the owner after cooldown. No hosted traffic.');
}finally{
 const removed=await admin.auth.admin.deleteUser(created.data.user.id);assert.ifError(removed.error);
}
