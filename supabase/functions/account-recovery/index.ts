import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import {consumeUserAction} from '../_shared/rateLimit.ts';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!request.headers.get('content-type')?.toLowerCase().includes('application/json'))return reply({error:'Use application/json'},415);
 try{
  const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
  let size=0,raw='';const decoder=new TextDecoder();
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();return reply({error:'Request too large'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid request'},400);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key||!service)return reply({error:'Account review is temporarily unavailable'},503);
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}};
  const db=createClient(url,service,options);
  const network=request.headers.get('cf-connecting-ip')||request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  if(!(await consumeUserAction(db,'recovery-network:'+await hash(network),'recovery_network',60,600,true)).allowed||!(await consumeUserAction(db,'recovery:all','recovery_total',3000,600,true)).allowed)return reply({error:'Too many recovery requests. Please wait.'},429);
  if(body.action==='send_code'||body.action==='verify_code'){
   if(Deno.env.get('ACCOUNT_RECOVERY_EMAIL_ENABLED')!=='true')return reply({error:'Email verification for account reviews is not available yet. Use the account support option below.'},503);
   const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
   if(email.length>320||!/^\S+@\S+\.\S+$/.test(email))return reply({error:'Enter your account email'},400);
   const action=body.action==='send_code'?'recovery_email':'recovery_verify';
   const budget=await consumeUserAction(db,'recovery:'+await hash(email),action,body.action==='send_code'?3:10,600,true);
   if(!budget.allowed)return reply({error:'Please wait before trying again'},429);
   if(!(await consumeUserAction(db,'recovery:global',action,body.action==='send_code'?300:1000,3600,true)).allowed)return reply({error:'Account review is busy. Please try later.'},429);
   const auth=createClient(url,key,options);
   if(body.action==='send_code'){
    const {error}=await auth.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
    // Unknown accounts and existing accounts have the same acknowledgement.
    if(error&&error.status!==400&&error.status!==422)return reply({error:'The email request could not be confirmed. Please wait before retrying.'},503);
    return reply({success:true,message:'If this email belongs to an existing account, check your inbox for its sign-in code.'});
   }
   if(typeof body.code!=='string'||!/^\d{6,10}$/.test(body.code))return reply({error:'Enter the code from your email'},400);
   const verified=await auth.auth.verifyOtp({email,token:body.code,type:'email'});
   if(verified.error||!verified.data.session||!verified.data.user)return reply({error:'The code is invalid or expired. Request another code.'},401);
   try{
    const payload=JSON.parse(atob(verified.data.session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if(payload.sub!==verified.data.user.id||typeof payload.session_id!=='string')throw Error('Invalid verified session');
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const saved=await db.rpc('bind_account_recovery_session',{p_auth_id:verified.data.user.id,p_auth_session_id:payload.session_id,p_token:token});
    if(saved.error||saved.data?.eligible!==true)throw Error('Review session unavailable');
    return reply({success:true,recovery_token:token,expires_in_seconds:1800});
   }catch{return reply({error:'Ownership verification could not be completed. Try again.'},503);}
   finally{await auth.auth.signOut({scope:'local'}).catch(()=>{});}
  }
  if(!['portal','close'].includes(body.action)||typeof body.recovery_token!=='string'||!/^[0-9a-f]{64}$/.test(body.recovery_token))return reply({error:'Verify account ownership again'},401);
  if(!(await consumeUserAction(db,'recovery-token:'+await hash(body.recovery_token),'review_portal',60,600,true)).allowed)return reply({error:'Please wait before refreshing the review'},429);
  if(body.action==='close'){const closed=await db.rpc('close_account_recovery_session',{p_token:body.recovery_token});return closed.error?reply({error:'Recovery closure could not be confirmed'},503):reply({success:true});}
  const {data,error}=await db.rpc('account_recovery_portal',{
   p_token:body.recovery_token,p_workspace:body.workspace??null,p_explanation:body.explanation??null,
   p_version:body.version??null,p_case_id:body.case_id??null,p_reply:body.reply??null,p_reply_key:body.reply_key??null});
  if(error)return reply({error:'The review result could not be confirmed. Refresh your reviews before retrying; verify your email again if the session expired.'},409);
  return reply({success:true,portal:data});
 }catch{return reply({error:'Account review could not be completed. Refresh before retrying.'},503);}
});
