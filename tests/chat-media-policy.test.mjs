import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const policy = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/chatMediaPolicy.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:policy,Blob,File,Uint8Array,WeakSet});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0sAAAAASUVORK5CYII=','base64');
const file=(bytes,name,type)=>new File([bytes],name,{type});
const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('webm')]);
test('picker is photos/videos only; documents, arbitrary MIME, external audio and empty files fail closed',()=>{
 for(const type of ['application/pdf','text/plain','application/zip','application/msword','application/octet-stream','image/svg+xml','image/x-anything','audio/webm','audio/mp3']) assert.equal(policy.isSelectableChatMedia({type,size:5}),false,type);
 for(const type of [...policy.CHAT_PHOTO_TYPES,...policy.CHAT_VIDEO_TYPES]) assert.equal(policy.isSelectableChatMedia({type,size:5}),true,type);
 assert.equal(policy.isSelectableChatMedia({type:'image/png',size:0}),false);
 assert.equal(policy.isSelectableChatMedia({type:'image/png',size:policy.CHAT_MEDIA_MAX_BYTES+1}),false);
 assert.doesNotMatch(policy.CHAT_MEDIA_ACCEPT,/audio|application|text|svg|\*/);
});
test('real photo signature is allowed before upload and after decryption',async()=>{
 await policy.validateChatUpload(file(png,'room.png','image/png'));
 await policy.validateMessageMedia(new Blob([png]),{type:'image/png',name:'room.png'});
});
test('renaming a PDF or script to a photo/video does not bypass validation',async()=>{
 for(const [name,type] of [['fake.png','image/png'],['fake.jpg','image/jpeg'],['fake.mp4','video/mp4'],['fake.webm','video/webm'],['fake.mov','video/quicktime']]) {
  await assert.rejects(policy.validateChatUpload(file('%PDF-1.7 <script>bad</script>',name,type)),/not a supported/);
 }
 await assert.rejects(policy.validateChatUpload(file(png,'report.pdf','image/png')),/name does not match/);
 await assert.rejects(policy.validateMessageMedia(new Blob([png]),{type:'image/png',name:'../private.png'}),/name does not match/);
});
test('voice notes require recorder provenance locally, not a voice-looking filename',async()=>{
 const note=file(webm,'voice-123.webm','audio/webm;codecs=opus');
 await assert.rejects(policy.validateChatUpload(note),/microphone/);
 policy.markRecordedVoiceNote(note); await policy.validateChatUpload(note);
 await assert.rejects(policy.validateChatUpload(note,false),/microphone/);
 // Encrypted recipients validate authenticated bytes/type, not sender-only WeakSet.
 await policy.validateMessageMedia(note,{type:note.type,name:note.name});
});
test('supported video and voice containers pass signature checks; wrong container fails',async()=>{
 const ftyp=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom00000000')]);
 for(const [data,name,type] of [[webm,'room.webm','video/webm'],[ftyp,'room.mp4','video/mp4'],[ftyp,'room.mov','video/quicktime']]) await policy.validateChatUpload(file(data,name,type));
 await assert.rejects(policy.validateMessageMedia(new Blob([png]),{type:'audio/webm',name:'voice.webm'}),/not a supported/);
});
test('all existing upload boundaries enforce policy and only the recorder grants local voice provenance',()=>{
 for(const path of ['src/lib/supabase/chat.ts','src/lib/supabase/worker-bookings.ts','src/lib/supabase/hotel-chat.ts','src/lib/supabase/support.ts']) assert.match(fs.readFileSync(path,'utf8'),/await validateChatUpload\(file/);
 assert.match(fs.readFileSync('src/hooks/useVoiceRecorder.ts','utf8'),/markRecordedVoiceNote\(file\)/);
 assert.match(fs.readFileSync('src/lib/e2ee.ts','utf8'),/await validateMessageMedia\(blob, metadata\)/);
 const picker=fs.readFileSync('src/components/ChatAttachmentPicker.tsx','utf8'); assert.doesNotMatch(picker,/allowDocuments|allowAudio|application\/pdf/);assert.match(picker,/Add photo or video/);
});
test('chat rendering does not offer arbitrary documents for download',()=>{
 const renderer=fs.readFileSync('src/components/MessageMedia.tsx','utf8'); assert.doesNotMatch(renderer,/download|attachmentFileLabel|<a\s/);assert.match(renderer,/Documents are not supported in chat/);
 const support=fs.readFileSync('src/components/SupportChat.tsx','utf8');assert.doesNotMatch(support,/accept="[^"]*(?:application\/pdf|\.doc)/);
});
test('all five real upload entrypoints reject documents and disguised media before touching storage', async()=>{
 const touched=[];
 const deps={'@/lib/chatMediaPolicy':policy,'./client':{supabase:{storage:{from(bucket){touched.push(bucket);throw new Error('Storage must not be reached');}}}},'./utils':{},'@/lib/e2ee':{},'@/lib/workerBookingContract':{},'@/lib/propertyBookingLifecycle':{},'@/lib/hotelConversationContext':{}};
 const api={};
 for(const path of ['chat','worker-bookings','hotel-chat','support']) {
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/lib/supabase/${path}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(name in deps,name);return deps[name];},Blob,File,URL,console});api[path]=exports;
 }
 const entries=[f=>api.chat.uploadRoommateChatAttachment(f,'thread','peer'), f=>api['worker-bookings'].uploadBookingChatAttachment(f,'thread','peer'),f=>api['hotel-chat'].uploadHotelChatAttachment('thread','self',f),f=>api.support.uploadSupportAttachment('thread',f),f=>api.support.uploadSupportDraftAttachment('draft','self',f)];
 for(const entry of entries) for(const f of [file('%PDF-1.7','lease.pdf','application/pdf'),file('%PDF-1.7','lease.png','image/png'),file('untrusted','room.svg','image/svg+xml'),file(webm,'voice.webm','audio/webm')]) {
  const result=await entry(f);assert.ok(result.error,result);assert.equal(result.path,null);
 }
 assert.equal(touched.length,0);
});
