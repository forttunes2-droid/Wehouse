import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
 for(const char of secret.toUpperCase().replace(/=+$/,'')){const n=alphabet.indexOf(char);assert.ok(n>=0);bits+=n.toString(2).padStart(5,'0');}
 const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const hash=createHmac('sha1',key).update(counter).digest();const offset=hash[19]&15;
 return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export async function checkAuthenticatorBoundary(admin,makeClient){
 const email=`mfa-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);const id=created.data.user.id;
 const client=makeClient();const login=async()=>{const r=await client.auth.signInWithPassword({email,password});assert.ifError(r.error);};
 const requirement=async stage=>{const r=await client.rpc('get_my_authentication_requirements');assert.ifError(r.error);assert.equal(r.data.auth_id,id);assert.equal(r.data.stage,stage);return r.data;};
 const denied=async()=>{
  const rpc=await client.rpc('get_my_workspace_access');assert.equal(rpc.error?.code,'PT403');
  const table=await client.from('profiles').select('user_id').eq('auth_id',id);assert.equal(table.error?.code,'PT403');
 };
 try{
  await login();await requirement('ready');
  const profile=await client.rpc('create_my_profile',{p_email:email,p_role:'user'});assert.ifError(profile.error);assert.ok(profile.data.user_id);
  const enrollment=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Disposable CI authenticator'});assert.ifError(enrollment.error);
  const factor=enrollment.data.id,secret=enrollment.data.totp.secret;
  assert.ifError((await client.auth.mfa.challengeAndVerify({factorId:factor,code:totp(secret)})).error);
  await requirement('ready');assert.ifError((await client.rpc('get_my_workspace_access')).error);
  await client.auth.signOut();await login();await requirement('challenge');await denied();
  // A primary password cannot replace an existing second factor.
  const replacement=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Must not replace verified factor'});assert.ok(replacement.error,'AAL1 enrolled a replacement factor');
  assert.ok((await client.auth.mfa.unenroll({factorId:factor})).error,'AAL1 removed a verified factor');
  const challenge=await client.auth.mfa.challenge({factorId:factor});assert.ifError(challenge.error);
  const incorrect=(Number(totp(secret))+1)%1000000;
  assert.ok((await client.auth.mfa.verify({factorId:factor,challengeId:challenge.data.id,code:String(incorrect).padStart(6,'0')})).error);
  await denied();
  assert.ifError((await client.auth.mfa.challengeAndVerify({factorId:factor,code:totp(secret)})).error);
  await requirement('ready');assert.ifError((await client.rpc('get_my_workspace_access')).error);
  // The grant is seeded only in this disposable local database. UUID is generated
  // here, not supplied by a browser or accepted as a role claim.
  execFileSync('docker',['exec','-i','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) select p.user_id,r.role,'global','active' from public.profiles p cross join (values('admin'),('staff')) r(role) where p.auth_id='${id}';`],{stdio:['ignore','pipe','pipe']});
  const internal=await requirement('ready');assert.equal(internal.required,true);assert.equal(internal.enrolled,true);
  assert.equal((await client.auth.mfa.listFactors()).data.totp.filter(f=>f.status==='verified').length,1);
  assert.ifError((await client.auth.mfa.unenroll({factorId:factor})).error);
  await requirement('setup');await denied();
  // Keep the already-issued bearer to prove the entry hook checks the actual
  // session, independently of this identity's missing-factor denial above.
  execFileSync('docker',['exec','-i','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`delete from auth.sessions where user_id='${id}';`],{stdio:['ignore','pipe','pipe']});
  const endedRpc=await client.rpc('get_my_workspace_access');assert.equal(endedRpc.error?.code,'PT401');
  const endedTable=await client.from('profiles').select('user_id').eq('auth_id',id);assert.equal(endedTable.error?.code,'PT401');
  return {optional_enrollment:true,primary_session_denied:true,incorrect_code_denied:true,verified_session_allowed:true,personal_factor_reused_for_admin_and_staff:true,missing_internal_factor_requires_setup:true,ended_session_rpc_and_table_denied:true};
 }finally{await client.auth.signOut();const removed=await admin.auth.admin.deleteUser(id);assert.ifError(removed.error);}
}
