export type PrivateMessagingReset='authentication'|'profile'|'lock'|'identity';
let version=0;
let authIdentity:string|undefined;
const AUTH_CONTEXT='wehouse:e2ee:auth-context';
const listeners=new Set<(reason:PrivateMessagingReset)=>void>();
export class PrivateMessagingSessionChanged extends Error {
 constructor(){super('Private-message access changed. Unlock the current account before continuing.');this.name='PrivateMessagingSessionChanged';}
}
export function privateMessagingSessionVersion(){return version;}
export function storedPrivateMessagingKeyVersion(profileId:string){
 try{const value=Number(sessionStorage.getItem(`wehouse:e2ee:private-key:${profileId}:version`));return Number.isSafeInteger(value)&&value>0?value:null;}catch{return null;}
}
export function rememberPrivateMessagingKeyVersion(profileId:string,keyVersion:number){
 if(!Number.isSafeInteger(keyVersion)||keyVersion<1)throw new Error('Private-message key version could not be confirmed');
 sessionStorage.setItem(`wehouse:e2ee:private-key:${profileId}:version`,String(keyVersion));
}
export function assertPrivateMessagingSession(expected:number){if(expected!==version)throw new PrivateMessagingSessionChanged();}
export function onPrivateMessagingSessionInvalidated(listener:(reason:PrivateMessagingReset)=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function invalidatePrivateMessagingSession(reason:PrivateMessagingReset,clearStoredKeys=false){
 version++;
 if(clearStoredKeys&&typeof sessionStorage!=='undefined'){
  try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('wehouse:e2ee:private-key:'))sessionStorage.removeItem(key);}}catch{/* Memory access is still invalidated when browser storage is unavailable. */}
 }
 for(const listener of listeners)listener(reason);
}
/** Called by the existing Auth listener; it makes no API calls inside Auth's lock. */
export function observePrivateMessagingAuth(identity:string,signedOut=false){
 let previous=authIdentity;
 if(previous===undefined){try{previous=sessionStorage.getItem(AUTH_CONTEXT)??undefined;}catch{/* No persisted unlock is trusted without a matching context. */}}
 const changed=signedOut||(previous!==undefined&&previous!==identity)||(previous===undefined&&Boolean(identity));
 authIdentity=identity;
 try{sessionStorage.setItem(AUTH_CONTEXT,identity);}catch{/* In-memory checks still apply when browser storage is unavailable. */}
 if(changed)invalidatePrivateMessagingSession('authentication',true);
 return changed;
}

/** Cache partition only: server authorization still verifies the actual JWT/session. */
export function privateMessagingAuthIdentity(userId:string,accessToken?:string){
 if(!userId)return '';
 try{
  const payload=accessToken?.split('.')[1];
  if(!payload||payload.length>32768)throw Error('Session marker unavailable');
  const sessionId=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/'))).session_id;
  if(typeof sessionId==='string'&&sessionId.length>0&&sessionId.length<=128)return `${userId}:${sessionId}`;
 }catch{/* An unconfirmed client context cannot authorize any server operation. */}
 return `${userId}:unconfirmed`;
}
