import chatMediaPolicy from './helpers/chat-media-policy.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const plain = value => JSON.parse(JSON.stringify(value));
function harness(rows, failure = null) {
  const calls = [], decryptions = [], exports = {};
  const deps = {
    '@/lib/chatMediaPolicy': chatMediaPolicy,
    './client': { supabase: {
      rpc: async (name, params) => { calls.push([name,params]); return {data:rows,error:failure}; },
      storage: { from: bucket => {
        assert.equal(bucket,'chat-files'); return { createSignedUrls: async paths => ({ data:paths.filter(path=>path!=='missing.jpg').map(path=>({path,signedUrl:`https://test.invalid/${path}?token=test`})),error:null }) };
      } },
    } },
    './utils': {}, '@/lib/workerBookingContract': {},
    '@/lib/e2ee': {
      preparePrivateConversation() {},
      decryptPrivateMessage: async () => 'Readable text',
      decryptPrivateAttachment: async (kind,id,peer,item) => {
        decryptions.push([kind,id,peer,item.path]);
        if(item.path==='failed') throw new Error('Authentication failed');
        return {url:`blob:test-${item.path}`,type:item.path==='voice'?'audio/webm':'image/webp',name:item.path==='voice'?'voice.webm':'room.webp'};
      },
    },
  };
  const code=ts.transpileModule(fs.readFileSync('src/lib/supabase/worker-bookings.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in deps,name);return deps[name];}});
  return {...exports,calls,decryptions};
}
test('worker decrypted attachments retain MIME and names with each surviving URL',async()=>{
 const h=harness([{id:'m1',ciphertext:'cipher',encryption_iv:'iv',legacy_attachments:['legacy.pdf','missing.jpg'],encrypted_attachments:[{path:'voice'},{path:'failed'},{path:'photo'}]}]);
 const {messages,error}=await h.getBookingMessages('job-thread','peer');assert.equal(error,null);
 assert.equal(messages[0].content,'Readable text');
 assert.deepEqual(plain(messages[0].attachments),['https://test.invalid/legacy.pdf?token=test','blob:test-voice','blob:test-photo']);
 assert.deepEqual(plain(messages[0].attachment_types),['','audio/webm','image/webp']);
 assert.deepEqual(plain(messages[0].attachment_names),['','voice.webm','room.webp']);
 assert.equal(messages[0].attachment_failed,true);
 assert.deepEqual(plain(h.calls),[['get_private_encrypted_messages',{p_conversation_kind:'worker',p_conversation_id:'job-thread'}]]);
 assert.ok(h.decryptions.every(([kind,id,peer])=>kind==='worker'&&id==='job-thread'&&peer==='peer'));
});
test('worker metadata is never exposed before decryption or after permission denial',async()=>{
 const h=harness([{id:'m1',encrypted_attachments:[{path:'voice',type:'audio/webm',name:'private.webm'}]}]);
 const locked=await h.getBookingMessages('job-thread');assert.equal(h.decryptions.length,0);
 assert.deepEqual(plain(locked.messages[0].attachment_names),[]);assert.deepEqual(plain(locked.messages[0].attachment_types),[]);
 const denied=harness(null,{message:'Not permitted'});const result=await denied.getBookingMessages('job-thread','peer');
 assert.equal(result.error.message,'Not permitted');assert.equal(denied.decryptions.length,0);
});
test('worker message renderer groups authorised media while retaining MIME and partial failure',()=>{
 const source=fs.readFileSync('src/components/BookingNegotiationChat.tsx','utf8');
 assert.match(source,/type: msg\.attachment_types\?\.\[i\], name: msg\.attachment_names\?\.\[i\]/);
 assert.match(source,/msg\.attachment_failed && <AttachmentState error/);
});
