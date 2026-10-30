// Run only through scripts/run-isolated-crypto-check.py. No real accounts,
// network, database, filesystem output or providers are used by these cases.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
const root=new URL('../../',import.meta.url);
const modules={
 './privateMessagingSession':['src/lib/privateMessagingSession.ts','PrivateMessagingSessionChanged','assertPrivateMessagingSession','privateMessagingSessionVersion','invalidatePrivateMessagingSession','onPrivateMessagingSessionInvalidated','observePrivateMessagingAuth','rememberPrivateMessagingKeyVersion','storedPrivateMessagingKeyVersion'],
 './byteCache':['src/lib/byteCache.ts','ByteCache'],
 './e2ee':['src/lib/e2ee.ts','rememberPrivateMessagingProfile','createEncryptionIdentity','unlockEncryptionIdentity','lockEncryptionIdentity','changeEncryptionRecoveryPin','encryptionIdentityStatus','privateConversationReadiness','encryptPrivateMessage','decryptPrivateMessage','encryptPrivateAttachment','decryptPrivateAttachment','encryptedAttachmentsForSend'],
 './e2eeRecovery':['src/lib/e2eeRecovery.ts','resetEncryptionRecoveryPin'],
};
const compiled=new Map(Object.entries(modules).map(([name,[path,...names]])=>{
 const source=stripTypeScriptTypes(readFileSync(new URL(path,root),'utf8'),{mode:'strip'}).replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/gm,(_,bindings,target)=>`const {${bindings}} = require(${JSON.stringify(target)});`).replace(/^export\s+/gm,'');
 return [name,source+'\nObject.assign(exports,{'+names.join(',')+'});'];
}));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(condition){for(let i=0;i<100&&!condition();i++)await new Promise(r=>setTimeout(r,2));assert.ok(condition(),'bounded fixture did not reach its expected state');}
const thread='99700000-1000-4000-8000-000000000001';
function database(){return {identities:new Map(),envelopes:new Map(),files:new Map()};}
function device(db,actor){
 const controls={actor,identityReads:0,envelopeReads:0,peerReads:0,profileGate:null,decryptGate:null,fetchGate:null,rejectUpdate:false,downloads:0,activeDownloads:0,peakDownloads:0,oversized:false};
 const storage=new Map(),objects=[],moduleCache=new Map();
 const storageAPI={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i]??null,get length(){return storage.size;}};
 class Query {
  constructor(table){this.table=table;this.actor=controls.actor;this.filters={};}
  select(){return this;}eq(k,v){this.filters[k]=v;return this;}order(){return this;}limit(){return this;}
  update(patch){this.patch=patch;return this;}
  async insert(row){if(row.user_id!==this.actor)return {error:Error('fixture ownership denied')};db.identities.set(row.user_id,{...row});return {error:null};}
  async maybeSingle(){
   if(this.table==='user_encryption_identities'){
    controls.identityReads++;
    let row=db.identities.get(this.actor);
    if(this.filters.user_id!==undefined&&this.filters.user_id!==this.actor)row=null;
    if(this.patch){if(controls.rejectUpdate||!row||row.key_version!==this.filters.key_version)return {data:null,error:null};Object.assign(row,this.patch);}
    return {data:row?{...row}:null,error:null};
   }
   assert.equal(this.table,'conversation_key_envelopes');controls.envelopeReads++;
   return {data:db.envelopes.get(`${this.filters.conversation_kind}:${this.filters.conversation_id}:${this.filters.recipient_user_id}`)||null,error:null};
  }
 }
 const supabase={from:t=>new Query(t),storage:{from:()=>({createSignedUrl:async path=>({data:{signedUrl:'https://fixture.invalid/'+path},error:null})})},rpc:async(name,args)=>{
  if(name==='current_profile_user_id'){const value=controls.actor;if(controls.profileGate)await controls.profileGate.promise;return {data:value,error:null};}
  if(name==='get_private_chat_peer_public_key'){controls.peerReads++;return {data:[db.identities.get(args.p_peer_user_id)],error:null};}
  if(name==='establish_private_conversation_key'){
   const prefix=args.p_conversation_kind+':'+args.p_conversation_id+':';if([...db.envelopes.keys()].some(k=>k.startsWith(prefix)))return {data:false,error:null};
   for(const e of args.p_envelopes)db.envelopes.set(prefix+e.recipient_user_id,{...e});return {data:true,error:null};
  }
  if(name==='reset_my_encryption_identity'){
   const identity=db.identities.get(controls.actor),next=identity.key_version+1;
   for(const k of db.envelopes.keys())db.envelopes.delete(k);
   db.identities.set(controls.actor,{user_id:controls.actor,key_version:next,public_key_jwk:args.p_public_key_jwk,encrypted_private_key:args.p_encrypted_private_key,backup_iv:args.p_backup_iv,backup_salt:args.p_backup_salt,kdf_iterations:args.p_kdf_iterations});return {data:next,error:null};
  }
  throw Error('Unexpected fixture RPC '+name);
 }};
 const subtle=new Proxy(webcrypto.subtle,{get(target,key){if(key==='decrypt')return async(...args)=>{const result=await target.decrypt(...args);if(controls.decryptGate)await controls.decryptGate.promise;return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,Response,Request,AbortController,Event,atob,btoa,setTimeout,clearTimeout,console,sessionStorage:storageAPI,window:{dispatchEvent(){},setTimeout,clearTimeout},URL:{createObjectURL(blob){objects.push(blob);return 'blob:fixture/'+objects.length;}},crypto:{subtle,getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},fetch:async(url,{signal})=>{
  controls.downloads++;controls.activeDownloads++;controls.peakDownloads=Math.max(controls.peakDownloads,controls.activeDownloads);
  try{if(controls.fetchGate)await Promise.race([controls.fetchGate.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))]);
   const file=db.files.get(url.replace('https://fixture.invalid/',''));return new Response(file,{headers:{'content-length':String(controls.oversized?999999999:file.byteLength)}});
  }finally{controls.activeDownloads--;}
 }});
 function load(name){if(moduleCache.has(name))return moduleCache.get(name);const exports={};moduleCache.set(name,exports);
  const require=target=>target==='@/lib/supabase'?{supabase}:target==='@/lib/chatMediaPolicy'?{validateMessageMedia:async()=>{},normaliseChatMediaType:type=>type}:load(target);
  vm.runInContext('(function(exports,require){'+compiled.get(name)+'\n})',context,{timeout:3000})(exports,require);return exports;
 }
 const e2ee=load('./e2ee'),session=load('./privateMessagingSession'),recovery=load('./e2eeRecovery');session.observePrivateMessagingAuth(actor);if(actor)e2ee.rememberPrivateMessagingProfile(actor);
 return {e2ee,session,recovery,controls,storage,objects};
}
test('private messaging key and resource lifecycle with real WebCrypto and dummy transport',async t=>{
 const db=database(),a=device(db,'alice'),b=device(db,'bob');
 await a.e2ee.createEncryptionIdentity('123456');await b.e2ee.createEncryptionIdentity('654321');
 let oldMessage;
 await t.test('browser encrypts text and reuses one established conversation key',async()=>{
  oldMessage=await a.e2ee.encryptPrivateMessage('friend',thread,'bob','synthetic confidential text');
  assert.equal(await b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv),'synthetic confidential text');
  const reads=b.controls.envelopeReads;
  await Promise.all(Array.from({length:6},()=>b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv)));
  assert.equal(b.controls.envelopeReads,reads);assert.ok(!JSON.stringify([...db.identities.values(),...db.envelopes.values()]).includes('synthetic confidential text'));
 });
 await t.test('readiness hints do not repeat identity and envelope reads for each message refresh',async()=>{
  assert.equal((await b.e2ee.privateConversationReadiness('friend',thread,'alice')).state,'ready');const identities=b.controls.identityReads,envelopes=b.controls.envelopeReads;
  for(let i=0;i<8;i++)assert.equal((await b.e2ee.privateConversationReadiness('friend',thread,'alice')).state,'ready');
  assert.equal(b.controls.identityReads,identities);assert.equal(b.controls.envelopeReads,envelopes);
 });
 await t.test('concurrent attachment opens share ciphertext fetch; new opens reuse encrypted cache',async()=>{
  const encrypted=await a.e2ee.encryptPrivateAttachment('friend',thread,'bob',new Blob(['synthetic file']),{name:'example.pdf',type:'application/pdf'});
  const item={...encrypted,path:'same-file'};db.files.set(item.path,await encrypted.blob.arrayBuffer());
  const before=b.controls.downloads;const opened=await Promise.all([b.e2ee.decryptPrivateAttachment('friend',thread,'alice',item),b.e2ee.decryptPrivateAttachment('friend',thread,'alice',item)]);
  assert.equal(b.controls.downloads-before,1);assert.equal(await b.objects.at(-1).text(),'synthetic file');assert.equal(opened.length,2);
  await b.e2ee.decryptPrivateAttachment('friend',thread,'alice',item);assert.equal(b.controls.downloads-before,1);
 });
 await t.test('media work stays within two active fetch/decrypt slots',async()=>{
  const encrypted=await a.e2ee.encryptPrivateAttachment('friend',thread,'bob',new Blob(['bounded']),{name:'example.pdf',type:'application/pdf'});
  for(let i=0;i<4;i++)db.files.set('parallel-'+i,await encrypted.blob.arrayBuffer());
  const gate=deferred();b.controls.fetchGate=gate;const pending=Array.from({length:4},(_,i)=>b.e2ee.decryptPrivateAttachment('friend',thread,'alice',{...encrypted,path:'parallel-'+i}));
  await until(()=>b.controls.activeDownloads===2);assert.equal(b.controls.peakDownloads,2);gate.resolve();await Promise.all(pending);b.controls.fetchGate=null;assert.equal(b.controls.peakDownloads,2);
 });
 await t.test('declared oversized ciphertext is rejected before a large response is buffered',async()=>{
  b.controls.oversized=true;db.files.set('oversized',new Uint8Array([1]).buffer);
  await assert.rejects(b.e2ee.decryptPrivateAttachment('friend',thread,'alice',{path:'oversized',file_iv:'',metadata_ciphertext:'',metadata_iv:''}),/too large/);b.controls.oversized=false;
 });
 await t.test('locking cancels a decrypt result already in flight and clears the unlock',async()=>{
  const gate=deferred();b.controls.decryptGate=gate;
  const pending=b.e2ee.decryptPrivateMessage('friend',thread,'alice',oldMessage.ciphertext,oldMessage.iv);await tick();await b.e2ee.lockEncryptionIdentity();gate.resolve();await assert.rejects(pending,/access changed/);b.controls.decryptGate=null;
  assert.equal((await b.e2ee.encryptionIdentityStatus()).unlocked,false);await b.e2ee.unlockEncryptionIdentity('654321');
 });
 await t.test('account switch rejects a late profile lookup and cannot reuse previous account keys',async()=>{
  const d=device(db,null),gate=deferred();d.controls.actor='alice';d.controls.profileGate=gate;
  const pending=d.e2ee.encryptionIdentityStatus();await tick();d.controls.actor='bob';d.session.observePrivateMessagingAuth('bob');d.e2ee.rememberPrivateMessagingProfile('bob');gate.resolve();await assert.rejects(pending,/access changed/);d.controls.profileGate=null;
  assert.equal((await d.e2ee.encryptionIdentityStatus()).unlocked,false);
 });
 await t.test('stale passcode-backup update cannot report success without a matching receipt',async()=>{
  a.controls.rejectUpdate=true;await assert.rejects(a.e2ee.changeEncryptionRecoveryPin('123456','222222'),/changed in another session/);a.controls.rejectUpdate=false;
 });
 await t.test('forgotten passcode discards cached Friend keys and permits a fresh exchange',async()=>{
  const fileBeforeReset=await a.e2ee.encryptPrivateAttachment('friend',thread,'bob',new Blob(['before reset']),{name:'example.pdf',type:'application/pdf'});
  const prepared={path:'old-upload',file_iv:fileBeforeReset.file_iv,metadata_ciphertext:fileBeforeReset.metadata_ciphertext,metadata_iv:fileBeforeReset.metadata_iv,prepared_envelope_token:fileBeforeReset.envelopeToken};
  const sendable=a.e2ee.encryptedAttachmentsForSend([prepared],oldMessage.envelopeToken);
  assert.equal(sendable.length,1);assert.ok(!('prepared_envelope_token' in sendable[0]));
  const version=await a.recovery.resetEncryptionRecoveryPin('333333');assert.equal(version,2);assert.equal(a.session.storedPrivateMessagingKeyVersion('alice'),2);
  b.session.invalidatePrivateMessagingSession('identity');
  const next=await b.e2ee.encryptPrivateMessage('friend',thread,'alice','after key replacement');
  assert.equal(await a.e2ee.decryptPrivateMessage('friend',thread,'bob',next.ciphertext,next.iv),'after key replacement');
  const ownNext=await a.e2ee.encryptPrivateMessage('friend',thread,'bob','send with current key');
  assert.throws(()=>a.e2ee.encryptedAttachmentsForSend([prepared],ownNext.envelopeToken),/changed while this file was uploading/);
  assert.throws(()=>a.e2ee.encryptedAttachmentsForSend([{...prepared,prepared_envelope_token:undefined}],ownNext.envelopeToken),/changed while this file was uploading/);
  await assert.rejects(a.e2ee.decryptPrivateMessage('friend',thread,'bob',oldMessage.ciphertext,oldMessage.iv));
 });
});
