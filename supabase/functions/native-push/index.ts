import {hasLiveSession} from '../_shared/liveSession.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import {createPushSender,pushConfiguration,type PushJob} from '../_shared/pushDelivery.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-push-worker-secret','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:object,status=200)=>new Response(JSON.stringify(body),{status,headers});
async function sameSecret(a:string,b:string){const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));const [x,y]=await Promise.all([digest(a),digest(b)]);return x.reduce((diff,value,index)=>diff|(value^y[index]),0)===0;}
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 try {
  // Stream bounds apply even when Content-Length is missing or false.
  const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
  let content='';const decoder=new TextDecoder();let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return reply({error:'Request too large'},413);}content+=decoder.decode(value,{stream:true});}content+=decoder.decode();}finally{reader.releaseLock();}
  const body=JSON.parse(content),config=pushConfiguration(name=>Deno.env.get(name));
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return reply({error:'Notifications unavailable'},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}});
  if(body.action==='status'){
   const bearer=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
   const {data,error}=await admin.auth.getUser(bearer);if(error||!data.user||!await hasLiveSession(admin,data.user.id,bearer))return reply({error:'Sign in required'},401);
   return reply({android:!!config.fcm,ios:!!config.apple});
  }
  if(body.action!=='dispatch')return reply({error:'Invalid request'},400);
  const workerSecret=Deno.env.get('PUSH_WORKER_SECRET')||'';
  if(workerSecret.length<32||!await sameSecret(request.headers.get('x-push-worker-secret')||'',workerSecret))return reply({error:'Worker authorization required'},401);
  if(!config.fcm&&!config.apple)return reply({error:'Push delivery is not configured'},503);
  const maintenance=await admin.rpc('maintain_native_push_queue');if(maintenance.error)return reply({error:'Queue maintenance unavailable'},503);
  const {data,error}=await admin.rpc('claim_native_push_jobs',{p_limit:25});if(error||!Array.isArray(data))return reply({error:'Queue unavailable'},503);
  const send=createPushSender(config);let accepted=0,unconfirmed=0;
  // Five bounded parallel sends; provider acceptance is not a device-read receipt.
  for(let offset=0;offset<data.length;offset+=5)await Promise.all((data.slice(offset,offset+5) as PushJob[]).map(async job=>{
   const outcome=await send(job);
   const result=await admin.rpc('finish_native_push_job',{p_job_id:job.job_id,p_lease_id:job.lease_id,p_outcome:outcome.outcome,p_receipt:outcome.receipt||null,p_error:outcome.error||null});
   if(result.error||result.data!==true)unconfirmed++;else if(outcome.outcome==='sent')accepted++;
  }));
  return reply({claimed:data.length,provider_accepted:accepted,unconfirmed},unconfirmed?503:200);
 }catch{return reply({error:'Notification request could not be completed'},503);}
});
