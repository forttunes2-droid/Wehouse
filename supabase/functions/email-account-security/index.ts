import {hasLiveSession} from '../_shared/liveSession.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import { consumeUserAction } from '../_shared/rateLimit.ts';
import { finishRecoveryCleanup } from '../_shared/recoveryCleanup.ts';
import { securityPurpose,createEmailSecurityCode,emailSecurityHash,sameEmailSecurityHash,sendEmailSecurityCode } from '../_shared/emailSecurity.ts';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sessionId(token: string): string | null {
  try { const value=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;
    return typeof value==='string'&&uuid.test(value)?value:null; } catch { return null; }
}
async function fingerprint(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function readSecurityBody(request:Request) {
  const reader=request.body?.getReader();
  if(!reader)throw new SyntaxError('Missing body');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>4096){await reader.cancel();throw new RangeError('Request too large');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}

Deno.serve(async request => {
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  try {
    if(Number(request.headers.get('content-length')||0)>4096)return json({error:'Request too large'},413);
    const body=await readSecurityBody(request);
    const purpose=securityPurpose(body?.purpose);
    if(!purpose||!['start','complete'].includes(body?.action))
      return json({error:'Invalid security request'},400);
    const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
    if(purpose==='device_confirmation'&&!token)return json({error:'Sign in again to confirm this device'},401);
    const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),anon=Deno.env.get('SUPABASE_ANON_KEY');
    const hashKey=Deno.env.get('EMAIL_SECURITY_HMAC_KEY'),mailKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('EMAIL_SECURITY_FROM');
    // Activate only after a verified sender and delivery have been exercised.
    if(!url||!key||!anon||!hashKey||hashKey.length<32||!mailKey||!from||Deno.env.get('EMAIL_SECURITY_CODES_ENABLED')!=='true')
      return json({error:'Email confirmation is not available yet. Please try again later.'},503);
    const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}};
    const admin=createClient(url,key,options),auth=createClient(url,anon,options);
    const network=request.headers.get('cf-connecting-ip')||request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unavailable';
    const networkLimit=await consumeUserAction(admin,await fingerprint(`email-security:${network}`),'email_security_network',30,600,true);
    if(!networkLimit.allowed)return json({error:'Too many attempts. Wait before trying again.'},429);
    let currentAuthId:string|null=null;
    let currentSessionId:string|null=null;
    if(purpose==='device_confirmation') {
      const {data,error}=await admin.auth.getUser(token);
      currentAuthId=data.user?.id||null;currentSessionId=sessionId(token);
      if(error||!currentAuthId||!currentSessionId||!await hasLiveSession(admin,currentAuthId,token))return json({error:'Sign in again to confirm this device'},401);
      const {data:active,error:activeError}=await admin.rpc('auth_session_is_active',{p_auth_id:currentAuthId,p_session_id:currentSessionId});
      if(activeError||active!==true)return json({error:'Sign in again to confirm this device'},401);
    }
    if(body.action==='start') {
      let authId=currentAuthId;
      let pendingId:string|null=null;
      let deviceId:string|null=null;
      if(purpose==='device_confirmation') {
        pendingId=String(body.session_id||'');deviceId=String(body.device_id||'');
        if(!uuid.test(pendingId)||deviceId.length<16||deviceId.length>128)return json({error:'Invalid device confirmation'},400);
        const {data:pending,error}=await admin.from('user_sessions').select('id').eq('id',pendingId)
          .eq('auth_id',authId!).eq('auth_session_id',currentSessionId!).eq('device_id',deviceId)
          .eq('is_active',true).eq('trust_status','pending').maybeSingle();
        if(error||!pending)return json({error:'This device login is no longer pending'},403);
      } else {
        const identifier=String(body.identifier||'').trim().toLowerCase();
        if(identifier.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)||/^[a-z0-9_]{3,20}$/.test(identifier)))
          return json({error:'Enter your WeHouse username or email address'},400);
        const {data:profile}=await admin.from('profiles').select('auth_id').eq(identifier.includes('@')?'email':'username',identifier)
          .eq('account_kind','consumer').or('deleted.is.null,deleted.eq.false').or('suspended.is.null,suspended.eq.false').or('banned.is.null,banned.eq.false').maybeSingle();
        authId=profile?.auth_id||null;
      }
      // Same public receipt shape for absent/ineligible accounts; no address is disclosed.
      const challengeId=crypto.randomUUID();
      if(!authId)return json({success:true,challenge_id:challengeId,expires_in:600});
      const {data:account,error:accountError}=await admin.auth.admin.getUserById(authId);
      if(accountError||!account.user?.email||!account.user.email_confirmed_at)return json({success:true,challenge_id:challengeId,expires_in:600});
      const limit=await consumeUserAction(admin,authId,`email_${purpose}_send`,1,60,true);
      const daily=await consumeUserAction(admin,authId,'email_security_daily',20,86400,true);
      if(!limit.allowed||!daily.allowed)return purpose==='device_confirmation'
        ?json({error:'Wait a minute before requesting another code. A daily send limit also applies.'},429)
        :json({success:true,challenge_id:challengeId,expires_in:600});
      const code=createEmailSecurityCode();
      const hash=await emailSecurityHash(hashKey,challengeId,authId,purpose,code);
      const {error:insertError}=await admin.from('email_account_challenges').insert({id:challengeId,auth_id:authId,purpose,
        device_session_id:pendingId,device_id:deviceId,auth_session_id:purpose==='device_confirmation'?currentSessionId:null,code_hash:hash});
      if(insertError)return json({error:'Confirmation could not start. Try again.'},503);
      const sent=await sendEmailSecurityCode({apiKey:mailKey,from},account.user.email,code,purpose);
      const {error:deliveryReceiptError}=await admin.from('email_account_challenges').update({status:sent?'pending':'consumed'}).eq('id',challengeId).eq('status','sending');
      if(purpose==='device_confirmation'&&(!sent||deliveryReceiptError))return json({error:'The code request could not be confirmed. Wait a minute and try again.'},503);
      return json({success:true,challenge_id:challengeId,expires_in:600});
    }
    const id=String(body.challenge_id||''),code=String(body.code||'').trim(),password=String(body.new_password||'');
    if(!uuid.test(id)||!/^\d{8}$/.test(code)||(purpose==='password_recovery'&&(password.length<8||password.length>128)))
      return json({error:'Check the code and password requirements'},400);
    // Authenticate the original device bearer before claiming an attempt. No
    // client may use another device's challenge or change its purpose.
    if(purpose==='device_confirmation') {
      const {data:c}=await admin.from('email_account_challenges').select('device_session_id,device_id,auth_id,auth_session_id').eq('id',id).eq('purpose',purpose).maybeSingle();
      if(!c||c.auth_id!==currentAuthId||c.auth_session_id!==currentSessionId||c.device_id!==String(body.device_id||''))return json({error:'Confirmation expired. Request a new code.'},403);
      const {data:p}=await admin.from('user_sessions').select('id').eq('id',c.device_session_id).eq('auth_session_id',currentSessionId!).eq('is_active',true).eq('trust_status','pending').maybeSingle();
      if(!p)return json({error:'This device login is no longer pending'},403);
    }
    const {data:challenge,error:claimError}=await admin.rpc('claim_email_account_challenge',{p_id:id,p_purpose:purpose});
    if(claimError||!challenge)return json({error:'Confirmation expired or already used. Request a new code.'},400);
    const hash=await emailSecurityHash(hashKey,id,challenge.auth_id,purpose,code);
    if(!sameEmailSecurityHash(hash,challenge.code_hash)) {
      await admin.from('email_account_challenges').update({status:challenge.attempts<5?'pending':'consumed'}).eq('id',id).eq('status','processing');
      return json({error:'That code is invalid or expired. Check your email or request a new code.'},400);
    }
    const {error:proofError}=await admin.from('email_account_challenges').update({proof_verified_at:new Date().toISOString()}).eq('id',id).eq('status','processing');
    if(proofError)return json({error:'Confirmation could not finish. Request a new code.'},503);
    if(purpose==='device_confirmation') {
      const {data:receipt,error}=await admin.rpc('finish_email_device_confirmation',{p_id:id,p_auth_session_id:currentSessionId});
      if(error||receipt?.trust_status!=='trusted') {
        return json({error:'Device confirmation could not finish. Sign in again.'},503);
      }
      return json({success:true,session_id:receipt.session_id,trust_status:'trusted'});
    }
    const {data:account,error:accountError}=await admin.auth.admin.getUserById(challenge.auth_id);
    if(accountError||!account.user?.email)return json({error:'Confirmation expired. Request a new code.'},400);
    // Obtain a private Auth bearer only after the purpose-bound email proof.
    // Its link and tokens never reach the browser; it enables global revocation.
    const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'recovery',email:account.user.email});
    if(linkError||!link.properties?.hashed_token)return json({error:'Recovery could not finish. Request a new code.'},503);
    const {data:verified,error:verifyError}=await auth.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'recovery'});
    if(verifyError||!verified.session||verified.user?.id!==challenge.auth_id)return json({error:'Recovery could not finish. Request a new code.'},503);
    const recoveryToken=verified.session.access_token;
    const {error:updateError}=await admin.auth.admin.updateUserById(challenge.auth_id,{password});
    if(updateError) {
      await admin.auth.admin.signOut(recoveryToken,'local');
      await admin.from('email_account_challenges').update({status:'consumed'}).eq('id',id);
      return json({error:'The password could not be changed. Request a new code.'},400);
    }
    const cleaned=await finishRecoveryCleanup(()=>admin.auth.admin.signOut(recoveryToken,'global'),
      ()=>admin.rpc('finish_email_password_recovery',{p_id:id}),ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    if(!cleaned)return json({success:false,password_changed:true,error:'Your password changed, but we could not confirm every old session was closed. Sign in again and review your devices.'});
    return json({success:true,password_changed:true});
  } catch(error) {
    if(error instanceof RangeError)return json({error:'Request too large'},413);
    if(error instanceof SyntaxError)return json({error:'Invalid security request'},400);
    // Never log a submitted code, password, bearer, email or provider response.
    return json({error:'The outcome could not be confirmed. Try signing in again; request a new code if needed.'},503);
  }
});
