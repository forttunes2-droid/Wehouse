export type PrivateMessagingReset='authentication'|'profile'|'lock'|'identity';
let version=0;
let authIdentity:string|undefined;
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
 const changed=signedOut||(authIdentity!==undefined&&authIdentity!==identity);
 authIdentity=identity;
 if(changed)invalidatePrivateMessagingSession('authentication',true);
 return changed;
}
