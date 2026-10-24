type PushConfig={fcm?:{project_id:string;client_email:string;private_key:string};apple?:{teamId:string;keyId:string;privateKey:string;topic:string;sandbox:boolean}};
export type PushJob={job_id:string;lease_id:string;platform:'android'|'ios';token:string;user_id:string;activity_event_id:string;workspace:string;attempts:number};
export type PushResult={outcome:'sent'|'retry'|'invalid'|'failed';receipt?:string;error?:string};
const enc=new TextEncoder();
function base64url(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function pem(value:string){return Uint8Array.from(atob(value.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));}
async function jwt(header:object,payload:object,key:string,apple=false){
 const algorithm=apple?{name:'ECDSA',namedCurve:'P-256'}:{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
 const imported=await crypto.subtle.importKey('pkcs8',pem(key),algorithm,false,['sign']);
 const input=base64url(enc.encode(JSON.stringify(header)))+'.'+base64url(enc.encode(JSON.stringify(payload)));
 const signature=await crypto.subtle.sign(apple?{name:'ECDSA',hash:'SHA-256'}:{name:'RSASSA-PKCS1-v1_5'},imported,enc.encode(input));
 return input+'.'+base64url(new Uint8Array(signature));
}
export function pushConfiguration(env:(name:string)=>string|undefined):PushConfig {
 const config:PushConfig={};
 if(env('NATIVE_PUSH_ENABLED')!=='true')return config;
 try {const fcm=JSON.parse(env('FCM_SERVICE_ACCOUNT_JSON')||'null');if(fcm&&/^[a-z][a-z0-9-]{4,62}$/.test(fcm.project_id)&&typeof fcm.client_email==='string'&&typeof fcm.private_key==='string')config.fcm=fcm;}catch{/* unavailable */}
 const teamId=env('APNS_TEAM_ID'),keyId=env('APNS_KEY_ID'),privateKey=env('APNS_PRIVATE_KEY'),topic=env('APNS_TOPIC');
 const environment=env('APNS_ENVIRONMENT');
 if(teamId&&keyId&&privateKey&&topic==='com.wehouse.app'&&['sandbox','production'].includes(environment||''))config.apple={teamId,keyId,privateKey,topic,sandbox:environment==='sandbox'};
 return config;
}
// Lock-screen payloads never contain chat text, names, addresses or financial facts.
export function pushPayload(job:PushJob){return{title:'WeHouse',body:'You have a new update. Open WeHouse to view it.',data:{recipient:job.user_id,eventId:job.activity_event_id,workspace:job.workspace,destination:'inbox'}};}
export function pushFailure(status:number,code:string):PushResult {
 if(['UNREGISTERED','BadDeviceToken','Unregistered','DeviceTokenNotForTopic'].includes(code))return{outcome:'invalid',error:code};
 return{outcome:status===429||status>=500?'retry':'failed',error:`provider_${status}`};
}
export function createPushSender(config:PushConfig,send:typeof fetch=fetch) {
 let googleAccess='',googleUntil=0,appleToken='',appleUntil=0;
 return async(job:PushJob):Promise<PushResult>=>{
  const now=Math.floor(Date.now()/1000),payload=pushPayload(job);
  try {
   if(job.platform==='android') {
    if(!config.fcm)return{outcome:'retry',error:'android_not_configured'};
    if(!googleAccess||googleUntil<=now+60){
     const assertion=await jwt({alg:'RS256',typ:'JWT'},{iss:config.fcm.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600},config.fcm.private_key);
     const response=await send('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
     if(!response.ok)return{outcome:response.status>=500||response.status===429?'retry':'failed',error:'fcm_auth_unavailable'};
     const auth=await response.json();if(typeof auth.access_token!=='string'||!Number.isFinite(auth.expires_in))return{outcome:'failed',error:'fcm_auth_receipt_missing'};
     googleAccess=auth.access_token;googleUntil=now+Math.min(auth.expires_in,3600);
    }
    const response=await send(`https://fcm.googleapis.com/v1/projects/${config.fcm.project_id}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${googleAccess}`,'Content-Type':'application/json'},body:JSON.stringify({message:{token:job.token,notification:{title:payload.title,body:payload.body},data:payload.data,android:{priority:'normal',ttl:'86400s',collapse_key:job.job_id,notification:{channel_id:'wehouse_updates',tag:job.job_id,icon:'ic_push'}}}}),signal:AbortSignal.timeout(10000)});
    const receipt=await response.json();
    if(response.ok&&typeof receipt.name==='string'&&receipt.name.startsWith('projects/'))return{outcome:'sent',receipt:receipt.name};
    const code=receipt.error?.details?.find((item:{errorCode?:string})=>item.errorCode)?.errorCode||'';
    return response.ok?{outcome:'failed',error:'fcm_receipt_missing'}:pushFailure(response.status,code);
   }
   if(!config.apple)return{outcome:'retry',error:'ios_not_configured'};
   if(!appleToken||appleUntil<=now){appleToken=await jwt({alg:'ES256',kid:config.apple.keyId},{iss:config.apple.teamId,iat:now},config.apple.privateKey,true);appleUntil=now+2400;}
   const response=await send(`https://api${config.apple.sandbox?'.sandbox':''}.push.apple.com/3/device/${job.token}`,{method:'POST',headers:{authorization:`bearer ${appleToken}`,'apns-topic':config.apple.topic,'apns-push-type':'alert','apns-priority':'5','apns-expiration':String(now+86400),'apns-collapse-id':job.job_id,'apns-id':job.job_id,'content-type':'application/json'},body:JSON.stringify({aps:{alert:{title:payload.title,body:payload.body},sound:'default'},...payload.data}),signal:AbortSignal.timeout(10000)});
   if(response.ok&&response.headers.get('apns-id'))return{outcome:'sent',receipt:response.headers.get('apns-id')!};
   const failure=await response.json().catch(()=>({reason:''}));return response.ok?{outcome:'failed',error:'apns_receipt_missing'}:pushFailure(response.status,failure.reason||'');
  }catch{return{outcome:'retry',error:'delivery_unconfirmed'};}
 };
}
