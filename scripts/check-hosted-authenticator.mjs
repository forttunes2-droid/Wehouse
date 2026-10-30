import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

// Test only. SQL stages are applied through the authorized project connector.
// No email, charge or real account is involved. Never print credentials.
const project='qoobnkedfyosnizrlttt',origin=`https://${project}.supabase.co`;
const file='test-results/hosted-authenticator-private.json';
const mode=process.argv[2];
mkdirSync('test-results',{recursive:true});
if(mode==='prepare'){
 assert.ok(!existsSync(file),'Finish and remove the existing fixture first');
 const id=randomUUID(),password=randomBytes(32).toString('hex'),email=`hosted-mfa-${id}@example.invalid`;
 writeFileSync(file,JSON.stringify({project,id,email,password}));
 writeFileSync('test-results/hosted-authenticator-create.sql',`begin;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data)
 values('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),now(),now(),'','','','','{"provider":"email","providers":["email"]}','{"synthetic_check":"hosted-mfa"}');
 insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
 values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}'),now(),now());
 commit;`);
 writeFileSync('test-results/hosted-authenticator-internal.sql',`begin;
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
 select p.user_id,r.role,'global','active' from public.profiles p join auth.users u on u.id::text=p.auth_id
 cross join(values('admin'),('staff'))r(role)
 where u.id='${id}' and u.email='${email}' and u.raw_user_meta_data->>'synthetic_check'='hosted-mfa';
 commit;`);
 writeFileSync('test-results/hosted-authenticator-cleanup.sql',`begin;
 delete from public.workspace_role_assignments where user_id in(select user_id from public.profiles where auth_id='${id}');
 delete from public.profiles where auth_id='${id}' and email='${email}';
 delete from auth.users where id='${id}' and email='${email}' and raw_user_meta_data->>'synthetic_check'='hosted-mfa';
 commit;
 select count(*) as remaining_fixture from auth.users where id='${id}';`);
 console.log('Prepared one disposable Test identity and exact cleanup. No request sent.');
}else if(mode==='purge-local'){
 for(const path of [file,'test-results/hosted-authenticator-create.sql','test-results/hosted-authenticator-internal.sql','test-results/hosted-authenticator-cleanup.sql'])rmSync(path,{force:true});
 console.log('Removed local disposable credentials.');
}else{
 assert.ok(['personal','internal'].includes(mode),'Use prepare, personal, internal or purge-local');
 const fixture=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(fixture.project,project);assert.match(fixture.email,/^hosted-mfa-[a-f0-9-]+@example\.invalid$/);
 const key=readFileSync('.github/workflows/capacity-hosted-test.yml','utf8').match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];assert.ok(key);
 const client=createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
 const login=async()=>{const r=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});assert.ifError(r.error);};
 const requirement=async stage=>{const r=await client.rpc('get_my_authentication_requirements');assert.ifError(r.error);assert.equal(r.data.auth_id,fixture.id);assert.equal(r.data.stage,stage);return r.data;};
 const native=async status=>{const token=(await client.auth.getSession()).data.session?.access_token;const r=await fetch(origin+'/functions/v1/native-push',{method:'POST',headers:{apikey:key,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action:'status'}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,status,'Deployed Edge session boundary');};
 const denied=async()=>{const r=await client.rpc('get_my_workspace_access');assert.equal(r.error?.code,'PT403');const table=await client.from('profiles').select('user_id').eq('auth_id',fixture.id);assert.equal(table.error?.code,'PT403');await native(401);};
 const totp=()=>{let bits='';for(const char of fixture.secret.replace(/=+$/,''))bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest();return String((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).padStart(6,'0');};
 try{
  await login();
  if(mode==='personal'){
   assert.equal((await requirement('ready')).required,false);
   const profile=await client.rpc('create_my_profile',{p_email:fixture.email,p_role:'user'});assert.ifError(profile.error);
   const enrollment=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Disposable hosted verification'});assert.ifError(enrollment.error);
   fixture.factor=enrollment.data.id;fixture.secret=enrollment.data.totp.secret;writeFileSync(file,JSON.stringify(fixture));
   assert.ifError((await client.auth.mfa.challengeAndVerify({factorId:fixture.factor,code:totp()})).error);
   await requirement('ready');await native(200);
   await client.auth.signOut();await login();await requirement('challenge');await denied();
   assert.ok((await client.auth.mfa.unenroll({factorId:fixture.factor})).error,'A password cannot remove a verified factor');
  }else{
   const r=await requirement('challenge');assert.equal(r.required,true);await denied();
   assert.ifError((await client.auth.mfa.challengeAndVerify({factorId:fixture.factor,code:totp()})).error);
   assert.equal((await requirement('ready')).required,true);await native(200);
   assert.equal((await client.auth.mfa.listFactors()).data.totp.filter(f=>f.status==='verified').length,1);
   assert.ifError((await client.rpc('get_my_workspace_access')).error);
   assert.ifError((await client.auth.mfa.unenroll({factorId:fixture.factor})).error);
   await requirement('setup');await denied();
  }
  const report={project,measured_at:new Date().toISOString(),stage:mode,passed:true,scope:'Real hosted Auth, Data API and native-push status; synthetic identity only. No provider charge or email delivery.'};
  writeFileSync(`test-results/hosted-authenticator-${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await client.auth.signOut();}
}
