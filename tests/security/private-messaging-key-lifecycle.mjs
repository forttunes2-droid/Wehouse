import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto,randomUUID} from 'node:crypto';
import test from 'node:test';

// Invoked only by run-isolated-crypto-check.py: no network/credentials, bounded
// CPU/memory/time, read-only source/toolchain and scratch-only writes.
const root=new URL('../../',import.meta.url);
const modules={
 './privateMessagingSession':['src/lib/privateMessagingSession.ts','privateMessagingSessionVersion','assertPrivateMessagingSession','onPrivateMessagingSessionInvalidated','invalidatePrivateMessagingSession','PrivateMessagingSessionChanged','observePrivateMessagingAuth','rememberPrivateMessagingKeyVersion','storedPrivateMessagingKeyVersion','privateMessagingAuthIdentity'],
 './byteCache':['src/lib/byteCache.ts','ByteCache'],
 './privateDeviceKeys':['src/lib/privateDeviceKeys.ts','readPrivateDeviceJwk','keepPrivateDeviceJwk','preparePrivateDeviceIdentity','samePrivatePublicKey','validatePrivateJwk'],
 './privatePasskeyBackup':['src/lib/privatePasskeyBackup.ts','passkeyBackupAvailable','privatePrfResult','publicPasskeyRegistration','sealPasskeyBackup','openPasskeyBackup','createPasskeyBackup'],
 './e2ee':['src/lib/e2ee.ts','rememberPrivateMessagingProfile','createEncryptionIdentity','unlockEncryptionIdentity','encryptionIdentityStatus','privateConversationReadiness','encryptPrivateMessage','decryptPrivateMessage','encryptPrivateAttachment','decryptPrivateAttachment','encryptedAttachmentsForSend','refreshPrivateMessageKeys','savePrivateChatPasskeyBackup','restorePrivateChatPasskeyBackup','removePrivateChatBackup','startPrivateChatsWithoutHistory'],
};
const compiled=new Map(Object.entries(modules).map(([name,[path,...names]])=>{
 const source=stripTypeScriptTypes(readFileSync(new URL(path,root),'utf8'),{mode:'strip'}).replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/gm,(_,bindings,target)=>`const {${bindings}}=require(${JSON.stringify(target)});`).replace(/^export\s+/gm,'');
 return [name,source+'\nObject.assign(exports,{'+names.join(',')+'});'];
}));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(condition){for(let i=0;i<100&&!condition();i++)await new Promise(r=>setTimeout(r,2));assert.ok(condition(),'bounded fixture did not reach expected state');}
const thread='99700000-1000-4000-8000-000000000001';
const pub={kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'A'.repeat(43)};
function device(db,actor,{storage=new Map(),localKeys=new Map(),authContext=actor}={}){
 const controls={actor,identityReads:0,envelopeReads:0,profileGate:null,decryptGate:null,fetchGate:null,rejectUpdate:false,downloads:0,activeDownloads:0,peakDownloads:0,oversized:false,prf:true,cancel:false,registered:[],passkeys:[]};
 const objects=[],moduleCache=new Map();
 const storageAPI={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i]??null,get length(){return storage.size;}};
 class Query{
  constructor(table){this.table=table;this.actor=controls.actor;this.filters={};}select(){return this;}eq(k,v){this.filters[k]=v;return this;}limit(){return this;}
  async maybeSingle(){if(this.table==='user_encryption_identities'){controls.identityReads++;return {data:db.identities.has(this.actor)?{...db.identities.get(this.actor)}:null,error:null};}
   assert.equal(this.table,'conversation_key_envelopes');controls.envelopeReads++;
   return {data:[...db.envelopes.values()].find(row=>Object.entries(this.filters).every(([k,v])=>row[k]===v))??null,error:null};}
 }
 const credential=id=>({id,type:'public-key',rawId:Uint8Array.from(atob(id),c=>c.charCodeAt(0)).buffer,response:{clientDataJSON:new Uint8Array([1]).buffer,attestationObject:new Uint8Array([2]).buffer,getTransports:()=>['internal']},getClientExtensionResults:()=>controls.prf?{credProps:{rk:true},prf:{enabled:true,results:{first:new Uint8Array(32).fill(7).buffer}}}:{prf:{enabled:false}}});
 const credentials={async create(){if(controls.cancel)throw new DOMException('cancelled','NotAllowedError');const id=btoa('synthetic-passkey').replace(/=+$/,'');controls.passkeys.push(id);return credential(id);},async get(options){if(controls.cancel)throw new DOMException('cancelled','NotAllowedError');return credential(btoa(String.fromCharCode(...new Uint8Array(options.publicKey.allowCredentials[0].id))));}};
 const supabase={from:t=>new Query(t),storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:'https://fixture.invalid/'+path},error:null})})},auth:{passkey:{
  startRegistration:async()=>({data:{challenge_id:'synthetic-challenge',options:{rp:{id:'fixture.invalid',name:'Synthetic'},user:{id:'dXNlcg',name:'Synthetic',displayName:'Synthetic'},challenge:'Y2hhbGxlbmdl',pubKeyCredParams:[{type:'public-key',alg:-7}],excludeCredentials:controls.passkeys.map(id=>({id,type:'public-key'}))}},error:null}),
  verifyRegistration:async args=>{assert.ok(!JSON.stringify(args).includes('prf'),'PRF secret sent to Auth');controls.registered.push(args);return {data:{id:'99700000-0000-4000-8000-000000000055'},error:null};},
 }},rpc:async(name,args)=>{
  if(name==='current_profile_user_id'){const value=controls.actor;if(controls.profileGate)await controls.profileGate.promise;return {data:value,error:null};}
  if(name==='create_my_automatic_private_identity'){
   if(!db.identities.has(controls.actor))db.identities.set(controls.actor,{user_id:controls.actor,key_version:1,public_key_jwk:args.p_public_key_jwk,backup_scheme:'device_only',updated_at:'revision-1'});
   return {data:{...db.identities.get(controls.actor)},error:null};
  }
  if(name==='get_private_chat_peer_public_key'){if(!['alice','bob'].includes(controls.actor))return {data:null,error:Error('access denied')};return {data:[db.identities.get(args.p_peer_user_id)],error:null};}
  if(name==='establish_private_conversation_key'){
   if(!['alice','bob'].includes(controls.actor))return {data:null,error:Error('access denied')};
   if([...db.envelopes.values()].some(e=>e.conversation_id===args.p_conversation_id&&e.is_current))return {data:false,error:null};
   for(const e of args.p_envelopes)db.envelopes.set(args.p_key_id+':'+e.recipient_user_id,{...e,conversation_kind:args.p_conversation_kind,conversation_id:args.p_conversation_id,key_id:args.p_key_id,is_current:true});return {data:true,error:null};
  }
  if(name==='set_my_private_chat_backup'){
   const row=db.identities.get(controls.actor);if(controls.rejectUpdate||row.updated_at!==args.p_revision)return {data:null,error:Error('stale backup revision')};
   Object.assign(row,{backup_scheme:args.p_scheme,encrypted_private_key:args.p_encrypted_private_key,backup_iv:args.p_backup_iv,backup_salt:args.p_backup_salt,backup_credential_id:args.p_credential_id,backup_rp_id:args.p_rp_id,backup_auth_passkey_id:args.p_auth_passkey_id,updated_at:randomUUID()});
   return {data:{user_id:row.user_id,key_version:row.key_version,backup_scheme:row.backup_scheme,request_id:args.p_request_id},error:null};
  }
  if(name==='start_my_new_private_identity'){
   const row=db.identities.get(controls.actor);assert.equal(row.key_version,args.p_expected_version);
   for(const e of db.envelopes.values())e.is_current=false;
   Object.assign(row,{key_version:row.key_version+1,public_key_jwk:args.p_public_key_jwk,backup_scheme:'device_only',encrypted_private_key:null,updated_at:randomUUID()});return {data:{...row},error:null};
  }
  throw Error('Unexpected fixture RPC '+name);
 }};
 const privateKeyStorage={async confirm(profile,version,publicKey){for(const [key,row]of localKeys)if(row.profileId===profile&&row.keyVersion===version){if(row.publicKey.x===publicKey.x)row.confirmed=true;else localKeys.delete(key);}},async get(profile,version,expected){return [...localKeys.values()].find(k=>k.profileId===profile&&k.keyVersion===version&&(!expected||k.publicKey.x===expected.x&&k.publicKey.y===expected.y));},async add(row){const key=row.profileId+':'+row.keyVersion+':'+row.publicKey.x;if(localKeys.has(key))return false;localKeys.set(key,row);return true;},async remove(profile,version){for(const [key,row]of localKeys)if(row.profileId===profile&&row.keyVersion===version)localKeys.delete(key);}};
 const subtle=new Proxy(webcrypto.subtle,{get(target,key){if(key==='decrypt')return async(...args)=>{const result=await target.decrypt(...args);if(controls.decryptGate)await controls.decryptGate.promise;return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,Response,Request,AbortController,DOMException,Event,atob,btoa,setTimeout,clearTimeout,console,sessionStorage:storageAPI,navigator:{credentials},window:{dispatchEvent(){},setTimeout,clearTimeout},URL:{createObjectURL(blob){objects.push(blob);return 'blob:fixture/'+objects.length;}},crypto:{subtle,randomUUID,getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},fetch:async(url,{signal})=>{
  controls.downloads++;controls.activeDownloads++;controls.peakDownloads=Math.max(controls.peakDownloads,controls.activeDownloads);
  try{if(controls.fetchGate)await Promise.race([controls.fetchGate.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))]);const file=db.files.get(url.replace('https://fixture.invalid/',''));return new Response(file,{headers:{'content-length':String(controls.oversized?999999999:file.byteLength)}});}finally{controls.activeDownloads--;}
 }});
 function load(name){if(moduleCache.has(name))return moduleCache.get(name);const exports={};moduleCache.set(name,exports);
  const require=target=>target==='@/lib/supabase'?{supabase,isWebPasskeyEnabled:true}:target==='./privateKeyStorage'?{privateKeyStorage}:target==='@/lib/chatMediaPolicy'?{validateMessageMedia:async()=>{},normaliseChatMediaType:type=>type}:load(target);
  vm.runInContext('(function(exports,require){'+compiled.get(name)+'\n})',context,{timeout:3000})(exports,require);return exports;
 }
 const e2ee=load('./e2ee'),session=load('./privateMessagingSession'),backup=load('./privatePasskeyBackup');session.observePrivateMessagingAuth(authContext||'');if(actor)e2ee.rememberPrivateMessagingProfile(actor);
 return {e2ee,session,backup,controls,storage,localKeys,objects};
}

test('automatic private chats, recovery and bounded media with real WebCrypto',async t=>{
 const db={identities:new Map(),envelopes:new Map(),files:new Map()},a=device(db,'alice'),b=device(db,'bob');let oldMessage;
 await t.test('fresh trusted profiles automatically store only locally wrapped private keys',async()=>{
  assert.equal((await a.e2ee.encryptionIdentityStatus()).unlocked,true);assert.equal((await b.e2ee.encryptionIdentityStatus()).unlocked,true);
  for(const row of db.identities.values()){assert.equal(row.backup_scheme,'device_only');assert.equal(row.encrypted_private_key,undefined);assert.ok(!row.public_key_jwk.d);}
  assert.ok([...a.localKeys.values()].every(row=>!row.deviceKey.extractable&&!row.jwk));assert.ok(![...a.storage.keys()].some(k=>k.startsWith('wehouse:e2ee:private-key:')));
 });
 await t.test('property-share text decrypts only for the intended participant and reuses one key',async()=>{
  const clear=JSON.stringify({kind:'property_share',listing_id:'synthetic-42'});oldMessage=await a.e2ee.encryptPrivateMessage('friend',thread,'bob',clear);
  assert.equal(await b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId),clear);
  const reads=b.controls.envelopeReads;await Promise.all(Array.from({length:6},()=>b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId)));assert.equal(b.controls.envelopeReads,reads);
  const outsider=device(db,'carol');await outsider.e2ee.encryptionIdentityStatus();await assert.rejects(outsider.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId));
 });
 await t.test('readiness hints stay bounded instead of querying on every message refresh',async()=>{
  assert.equal((await b.e2ee.privateConversationReadiness('friend',thread,'alice')).state,'ready');const reads=b.controls.identityReads;
  for(let i=0;i<8;i++)assert.equal((await b.e2ee.privateConversationReadiness('friend',thread,'alice')).state,'ready');assert.equal(b.controls.identityReads,reads);
 });
 await t.test('same device reload and new verified login restore automatically; a different device does not',async()=>{
  const reloaded=device(db,'bob',{storage:b.storage,localKeys:b.localKeys,authContext:'bob:new-auth-session'});assert.equal((await reloaded.e2ee.encryptionIdentityStatus()).unlocked,true);
  assert.equal((await device(db,'bob').e2ee.encryptionIdentityStatus()).unlocked,false);
 });
 await t.test('cancelled or unsupported passkeys never replace the current recovery method',async()=>{
  a.controls.cancel=true;await assert.rejects(a.e2ee.savePrivateChatPasskeyBackup(true),/not completed/);a.controls.cancel=false;
  a.controls.prf=false;await assert.rejects(a.e2ee.savePrivateChatPasskeyBackup(true),/No backup has been saved/);assert.equal(db.identities.get('alice').backup_scheme,'device_only');a.controls.prf=true;
 });
 await t.test('passkey backup encrypts locally, strips PRF output from Auth and restores the same public identity',async()=>{
  await a.e2ee.savePrivateChatPasskeyBackup();const identity=db.identities.get('alice');assert.equal(identity.backup_scheme,'passkey_prf_v1');assert.ok(!JSON.stringify(a.controls.registered).includes('prf'));
  const other=device(db,'alice');await other.e2ee.restorePrivateChatPasskeyBackup();assert.equal((await other.e2ee.encryptionIdentityStatus()).unlocked,true);
  assert.equal(await other.e2ee.decryptPrivateMessage('friend',thread,'bob',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId),JSON.stringify({kind:'property_share',listing_id:'synthetic-42'}));
 });
 await t.test('tampered backup cannot install a key and stale saves cannot report success',async()=>{
  const row=db.identities.get('alice'),saved=row.encrypted_private_key;row.encrypted_private_key='A'.repeat(saved.length);const other=device(db,'alice');await assert.rejects(other.e2ee.restorePrivateChatPasskeyBackup());assert.equal(other.localKeys.size,0);row.encrypted_private_key=saved;
  a.controls.rejectUpdate=true;await assert.rejects(a.e2ee.savePrivateChatPasskeyBackup(),/stale/);a.controls.rejectUpdate=false;assert.equal(row.encrypted_private_key,saved);
 });
 await t.test('account changes cancel in-flight private reads and cannot use another profile’s device key',async()=>{
  const d=device(db,null),gate=deferred();d.controls.actor='alice';d.controls.profileGate=gate;const pending=d.e2ee.encryptionIdentityStatus();await new Promise(r=>setImmediate(r));d.controls.actor='bob';d.session.observePrivateMessagingAuth('bob');d.e2ee.rememberPrivateMessagingProfile('bob');gate.resolve();await assert.rejects(pending,/access changed/);d.controls.profileGate=null;assert.equal((await d.e2ee.encryptionIdentityStatus()).unlocked,false);
  const decryptGate=deferred();b.controls.decryptGate=decryptGate;const read=b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId);await new Promise(r=>setImmediate(r));b.session.observePrivateMessagingAuth('',true);decryptGate.resolve();await assert.rejects(read,/access changed/);b.controls.decryptGate=null;b.controls.actor='bob';b.session.observePrivateMessagingAuth('bob:next');b.e2ee.rememberPrivateMessagingProfile('bob');
 });
 await t.test('file opens share ciphertext and stay within two active download slots',async()=>{
  const encrypted=await a.e2ee.encryptPrivateAttachment('friend',thread,'bob',new Blob(['synthetic file']),{name:'example.pdf',type:'application/pdf'}),item={...encrypted,key_id:encrypted.keyId,path:'same-file'};db.files.set(item.path,await encrypted.blob.arrayBuffer());
  const before=b.controls.downloads;await Promise.all([b.e2ee.decryptPrivateAttachment('friend',thread,'alice',item),b.e2ee.decryptPrivateAttachment('friend',thread,'alice',item)]);assert.equal(b.controls.downloads-before,1);assert.equal(await b.objects.at(-1).text(),'synthetic file');
  for(let i=0;i<4;i++)db.files.set('parallel-'+i,await encrypted.blob.arrayBuffer());const gate=deferred();b.controls.fetchGate=gate;
  const pending=Array.from({length:4},(_,i)=>b.e2ee.decryptPrivateAttachment('friend',thread,'alice',{...item,path:'parallel-'+i}));await until(()=>b.controls.activeDownloads===2);gate.resolve();await Promise.all(pending);b.controls.fetchGate=null;assert.equal(b.controls.peakDownloads,2);
  b.controls.oversized=true;db.files.set('oversized',new Uint8Array([1]).buffer);await assert.rejects(b.e2ee.decryptPrivateAttachment('friend',thread,'alice',{...item,path:'oversized'}),/too large/);b.controls.oversized=false;
 });
 await t.test('explicit restart preserves the peer’s historical text/files and uses a new generation',async()=>{
  const prepared=await a.e2ee.encryptPrivateAttachment('friend',thread,'bob',new Blob(['old file']),{name:'old.pdf',type:'application/pdf'});db.files.set('historical',await prepared.blob.arrayBuffer());
  const missing=device(db,'alice');assert.equal((await missing.e2ee.encryptionIdentityStatus()).unlocked,false);await missing.e2ee.startPrivateChatsWithoutHistory();assert.equal((await missing.e2ee.encryptionIdentityStatus()).unlocked,true);
  await b.e2ee.refreshPrivateMessageKeys();assert.equal(await b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId),JSON.stringify({kind:'property_share',listing_id:'synthetic-42'}));
  await b.e2ee.decryptPrivateAttachment('friend',thread,'alice',{...prepared,key_id:prepared.keyId,path:'historical'});assert.equal(await b.objects.at(-1).text(),'old file');
  await assert.rejects(missing.e2ee.decryptPrivateMessage('friend',thread,'bob',oldMessage.ciphertext,oldMessage.iv,oldMessage.keyId));
  const next=await b.e2ee.encryptPrivateMessage('friend',thread,'alice','new generation');assert.notEqual(next.keyId,oldMessage.keyId);assert.equal(await missing.e2ee.decryptPrivateMessage('friend',thread,'bob',next.ciphertext,next.iv,next.keyId),'new generation');
  const ownNext=await missing.e2ee.encryptPrivateMessage('friend',thread,'bob','send');assert.throws(()=>missing.e2ee.encryptedAttachmentsForSend([{...prepared,prepared_envelope_token:prepared.envelopeToken,path:'historical'}],ownNext.envelopeToken),/changed while this file was uploading/);
 });
 await t.test('backup derivation binds person, version and credential; missing PRF is a failure',async()=>{
  const identity=db.identities.get('bob'),other=device(db,'bob');const secret=new Uint8Array(32).fill(7),salt=new Uint8Array(32).fill(9);
  const local=[...b.localKeys.values()][0];assert.ok(local);const saved=await b.e2ee.encryptionIdentityStatus();assert.equal(saved.unlocked,true);
  assert.throws(()=>other.backup.privatePrfResult({getClientExtensionResults:()=>({prf:{}})}),/cannot encrypt/);
  const sealed=await other.backup.sealPasskeyBackup('bob',1,pub,secret,salt,btoa('synthetic-passkey'),'fixture.invalid');assert.ok(secret.every(x=>x===0));
  await assert.rejects(other.backup.openPasskeyBackup('alice',1,identity.public_key_jwk,sealed));
 });
});
