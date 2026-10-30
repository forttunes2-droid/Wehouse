import {isWebPasskeyEnabled, supabase} from '@/lib/supabase';
import {assertPrivateMessagingSession, onPrivateMessagingSessionInvalidated, privateMessagingSessionVersion} from './privateMessagingSession';
import {validatePrivateJwk} from './privateDeviceKeys';

const encoder = new TextEncoder();
export type PasskeyBackup = {encrypted_private_key:string;backup_iv:string;backup_salt:string;backup_credential_id:string;backup_rp_id:string;backup_auth_passkey_id:string|null};
type PrfExtensions = AuthenticationExtensionsClientInputs & {prf:{eval:{first:BufferSource}}};
type PrfOutput = AuthenticationExtensionsClientOutputs & {prf?:{enabled?:boolean;results?:{first?:ArrayBuffer}}};

export function backupBase64(bytes:ArrayBuffer|Uint8Array){return btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array?bytes:bytes)));}
export function backupBytes(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));}
function url64(bytes:ArrayBuffer){return backupBase64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function input(salt:Uint8Array):PrfExtensions{return {prf:{eval:{first:salt as BufferSource}}};}
export function passkeyBackupAvailable(){return isWebPasskeyEnabled && typeof navigator.credentials?.get==='function' && typeof navigator.credentials?.create==='function';}

function checkedCredential(value:Credential|null){
  if(!value || value.type!=='public-key')throw new Error('Passkey backup was cancelled. Your existing chat keys are unchanged.');
  return value as PublicKeyCredential;
}
export function privatePrfResult(credential:PublicKeyCredential){
  const first=(credential.getClientExtensionResults() as PrfOutput).prf?.results?.first;
  if(!first || first.byteLength!==32)throw new Error('This passkey cannot encrypt a chat backup. Chats still work on this device; try a compatible passkey or password manager.');
  return new Uint8Array(first.slice(0));
}
/** Never call credential.toJSON(): extension results may contain the PRF secret. */
export function publicPasskeyRegistration(credential:PublicKeyCredential){
  const response=credential.response as AuthenticatorAttestationResponse;
  const credProps=credential.getClientExtensionResults().credProps;
  return {id:credential.id,rawId:url64(credential.rawId),type:'public-key' as const,
    response:{clientDataJSON:url64(response.clientDataJSON),attestationObject:url64(response.attestationObject),transports:(response.getTransports?.()??[]) as AuthenticatorTransport[]},
    ...(credential.authenticatorAttachment?{authenticatorAttachment:credential.authenticatorAttachment as 'platform'|'cross-platform'}:{}),
    clientExtensionResults:credProps?{credProps:{rk:credProps.rk}}:{}};
}
async function ceremony<T>(run:(signal:AbortSignal)=>Promise<T>){
  const epoch=privateMessagingSessionVersion(),controller=new AbortController();
  const stop=onPrivateMessagingSessionInvalidated(()=>controller.abort());
  const timer=setTimeout(()=>controller.abort(),60000);
  try{const result=await run(controller.signal);assertPrivateMessagingSession(epoch);return result;}
  catch(error){if(error instanceof DOMException && ['NotAllowedError','AbortError'].includes(error.name))throw new Error('Passkey backup was not completed. Your existing chat keys are unchanged.');throw error;}
  finally{clearTimeout(timer);stop();}
}
function backupContext(person:string,version:number,credentialId:string,rpId:string){return encoder.encode(`wehouse:private-chat-backup:v1:${person}:${version}:${credentialId}:${rpId}`);}
async function backupKey(secret:Uint8Array,salt:Uint8Array,context:Uint8Array){
  const material=await crypto.subtle.importKey('raw',secret as BufferSource,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:salt as BufferSource,info:context as BufferSource},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealPasskeyBackup(person:string,version:number,jwk:JsonWebKey,secret:Uint8Array,salt:Uint8Array,credentialId:string,rpId:string){
  if(secret.byteLength!==32||salt.byteLength!==32)throw new Error('Passkey backup secret is unavailable.');
  const context=backupContext(person,version,credentialId,rpId),iv=crypto.getRandomValues(new Uint8Array(12)),clear=encoder.encode(JSON.stringify(jwk));
  try{const key=await backupKey(secret,salt,context);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context as BufferSource},key,clear);
    return {encrypted_private_key:backupBase64(ciphertext),backup_iv:backupBase64(iv),backup_salt:backupBase64(salt),backup_credential_id:credentialId,backup_rp_id:rpId};
  }finally{clear.fill(0);secret.fill(0);}
}
async function requestSecret(credentialIds:string[],rpId:string,salt:Uint8Array,signal:AbortSignal){
  const credential=checkedCredential(await navigator.credentials.get({signal,publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId,userVerification:'required',timeout:60000,
    allowCredentials:credentialIds.map(id=>({type:'public-key',id:backupBytes(id) as BufferSource})),extensions:input(salt)}}));
  const credentialId=url64(credential.rawId);
  if(!credentialIds.includes(credentialId))throw new Error('Choose the passkey used for this chat backup.');
  return {secret:privatePrfResult(credential),credentialId};
}
export async function createPasskeyBackup(person:string,version:number,jwk:JsonWebKey,createNew=false):Promise<PasskeyBackup>{
  if(!passkeyBackupAvailable())throw new Error('Passkey backup is unavailable on this browser or WeHouse sign-in service. Private chats still work on this device.');
  return ceremony(async signal=>{
    const epoch=privateMessagingSessionVersion();
    const {data,error}=await supabase.auth.passkey.startRegistration();if(error||!data)throw error||new Error('Passkey setup could not be started.');
    assertPrivateMessagingSession(epoch);
    const options=data.options,rpId=options.rp.id;
    if(!rpId)throw new Error('A stable WeHouse passkey domain is required before backup can be enabled.');
    const salt=crypto.getRandomValues(new Uint8Array(32));
    const existing=!createNew?(options.excludeCredentials??[]).map(item=>item.id):[];
    if(!createNew&&!existing.length)throw new Error('No account passkey is available. Choose “Create a passkey for backup”.');
    let credentialId:string,authId:string|null=null,secret:Uint8Array;
    if(!createNew){({credentialId,secret}=await requestSecret(existing,rpId,salt,signal));}
    else{
      const credential=checkedCredential(await navigator.credentials.create({signal,publicKey:{
        rp:options.rp,user:{...options.user,id:backupBytes(options.user.id) as BufferSource},challenge:backupBytes(options.challenge) as BufferSource,
        pubKeyCredParams:options.pubKeyCredParams,timeout:60000,attestation:'none',
        excludeCredentials:options.excludeCredentials?.map(c=>({type:'public-key',id:backupBytes(c.id) as BufferSource})),
        authenticatorSelection:{residentKey:'required',userVerification:'required'},extensions:{credProps:true,...input(salt)}}}));
      assertPrivateMessagingSession(epoch);
      const {data:registered,error:registrationError}=await supabase.auth.passkey.verifyRegistration({challengeId:data.challenge_id,credential:publicPasskeyRegistration(credential)});
      if(registrationError||!registered)throw registrationError||new Error('Passkey registration could not be confirmed. Refresh Passkeys before trying again.');
      authId=registered.id;credentialId=url64(credential.rawId);
      try{secret=privatePrfResult(credential);}catch{
        throw new Error('Your sign-in passkey was added. To finish chat backup, choose “Use existing passkey”; no backup has been saved yet.');
      }
    }
    try{assertPrivateMessagingSession(epoch);return {...await sealPasskeyBackup(person,version,jwk,secret,salt,credentialId,rpId),backup_auth_passkey_id:authId};}
    finally{secret.fill(0);}
  });
}
export async function openPasskeyBackup(person:string,version:number,publicKey:JsonWebKey,backup:PasskeyBackup){
  if(!passkeyBackupAvailable())throw new Error('Open WeHouse in a compatible browser with the passkey used for this backup.');
  return ceremony(async signal=>{
    if(backup.encrypted_private_key.length>20000)throw new Error('The encrypted backup is invalid.');
    const salt=backupBytes(backup.backup_salt),{secret}=await requestSecret([backup.backup_credential_id],backup.backup_rp_id,salt,signal);
    const context=backupContext(person,version,backup.backup_credential_id,backup.backup_rp_id);let clear:Uint8Array|undefined;
    try{const key=await backupKey(secret,salt,context);clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:backupBytes(backup.backup_iv) as BufferSource,additionalData:context as BufferSource},key,backupBytes(backup.encrypted_private_key) as BufferSource));
      const jwk=JSON.parse(new TextDecoder().decode(clear)) as JsonWebKey;await validatePrivateJwk(jwk,publicKey);return jwk;
    }finally{secret.fill(0);clear?.fill(0);}
  });
}
