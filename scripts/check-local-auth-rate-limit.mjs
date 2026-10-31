import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

// A bounded behaviour check, never a hosted load test or a target-account attack.
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.114.0','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const origin=new URL(status.API_URL||status.api_url);
assert.ok(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname),'Disposable loopback Auth only');
assert.ok(process.env.GITHUB_ACTIONS==='true'&&process.platform==='linux','This container fixture is isolated Linux CI only');
const key=status.PUBLISHABLE_KEY||status.ANON_KEY||status.publishable_key||status.anon_key;
const serviceKey=status.SERVICE_ROLE_KEY||status.service_role_key;
assert.ok(key&&serviceKey);
const admin=createClient(origin.href,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`rate-limit-${randomBytes(8).toString('hex')}@example.invalid`;
const password=randomBytes(24).toString('base64url');
const name='wehouse-auth-rate-'+randomUUID();
let created,probeOrigin,started=false;
function docker(args){
 try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();}
 catch{throw new Error(`Disposable Auth fixture docker ${args[0]} failed; credential-bearing output was suppressed.`);}
}
async function attempt(value){
 const response=await fetch(new URL('/token?grant_type=password',probeOrigin),{
  method:'POST',headers:{apikey:key,'content-type':'application/json','x-wehouse-fixture-network':'192.0.2.10'},body:JSON.stringify({email,password:value}),signal:AbortSignal.timeout(15000),
 });
 const body=await response.json();
 return{status:response.status,body};
}
try{
 // CLI Auth leaves GOTRUE_RATE_LIMIT_HEADER unset. Its numeric limits alone
 // therefore do not exercise this middleware. Reuse its exact image/config in
 // one bounded CI-only instance, simulating the trusted gateway IP header.
 // Never dump inspect output/env: even disposable credentials stay out of logs.
 const installed=JSON.parse(docker(['inspect','supabase_auth_wehouse']))[0];
 const networks=Object.keys(installed.NetworkSettings.Networks);
 assert.deepEqual(networks,['supabase_network_wehouse']);
 assert.match(installed.Image,/^sha256:[a-f0-9]{64}$/);
 const env=Object.fromEntries(installed.Config.Env.map(entry=>{const split=entry.indexOf('=');return[entry.slice(0,split),entry.slice(split+1)];}));
 assert.ok(String(env.GOTRUE_DB_DATABASE_URL).includes('@supabase_db_wehouse:'),'Auth fixture must use only the disposable database');
 env.GOTRUE_RATE_LIMIT_HEADER='x-wehouse-fixture-network';
 env.GOTRUE_RATE_LIMIT_TOKEN_REFRESH='150';
 // Preserve multiline values without serialising credentials into a file.
 // The generated arguments are confined to this synthetic CI service and never
 // included in output or rethrown child-process errors.
 const environment=Object.entries(env).flatMap(([key,value])=>['--env',`${key}=${value}`]);
 docker(['run','--detach','--name',name,'--network',networks[0],
  '--publish','127.0.0.1::9999','--memory','256m','--cpus','1','--pids-limit','128',
  '--read-only','--tmpfs','/tmp:rw,nosuid,noexec,size=16m',
  ...environment,installed.Image]);
 started=true;
 const probe=JSON.parse(docker(['inspect',name]))[0];
 const port=probe.NetworkSettings.Ports['9999/tcp'][0];
 assert.equal(port.HostIp,'127.0.0.1');assert.match(port.HostPort,/^\d+$/);
 probeOrigin=new URL(`http://127.0.0.1:${port.HostPort}`);
 let ready=false;
 for(let index=0;index<25;index++){
  try{ready=(await fetch(new URL('/health',probeOrigin),{signal:AbortSignal.timeout(1000)})).ok;}catch{/* Bounded local startup. */}
  if(ready)break;await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(ready,true,'Disposable Auth fixture did not become healthy');
 created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
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
 try{if(started)docker(['rm','--force',name]);}
 finally{if(created?.data?.user){const removed=await admin.auth.admin.deleteUser(created.data.user.id);assert.ifError(removed.error);}}
}
