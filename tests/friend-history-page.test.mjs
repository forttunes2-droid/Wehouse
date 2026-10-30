import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
const source=fs.readFileSync('src/lib/supabase/friends.ts','utf8');
const start=source.indexOf('export type FriendMessageCursor=');
const end=source.indexOf('export async function uploadFriendChatAttachment',start);
const {outputFiles}=await build({stdin:{contents:'const supabase=globalThis.__historyClient;\n'+source.slice(start,end),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
async function api(result){const calls=[];globalThis.__historyClient={rpc:async(name,args)=>{calls.push({name,args});return result;}};const api=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//'+Math.random()).toString('base64'));return {api,calls};}
test('Friend history retains one lookahead and advances by the oldest displayed row without losing timestamp precision',async()=>{
 const rows=Array.from({length:51},(_,n)=>({id:String(100-n),created_at:'2026-10-26T08:00:00.123456+00:00',encrypted_attachments:[]}));
 const {api:client,calls}=await api({data:rows,error:null});const before={at:'2026-10-26T08:00:01.123456+00:00',id:'earlier'};
 const result=await client.getFriendEncryptedMessages('thread',before);
 assert.equal(result.messages.length,50);assert.equal(result.messages[0].id,'51');assert.equal(result.messages.at(-1).id,'100');
 assert.deepEqual(result.older,{at:rows[49].created_at,id:'51'});assert.equal(rows[0].id,'100');
 assert.deepEqual(calls,[{name:'get_friend_encrypted_messages_page',args:{p_friend_id:'thread',p_before_at:before.at,p_before_id:before.id,p_limit:51}}]);
});
test('malformed history is an error rather than an empty successful conversation; pin cursor also validates its receipt',async()=>{
 for(const data of [null,{},[{id:'x',created_at:'today'}]]){
  const {api:client}=await api({data,error:null});const result=await client.getFriendEncryptedMessages('thread');assert.ok(result.error);assert.deepEqual(result.messages,[]);
 }
 const {api:client}=await api({data:{before:null},error:null});assert.equal(await client.getFriendMessageHistoryCursor('thread','message'),null);
 const {api:invalid}=await api({data:{},error:null});await assert.rejects(invalid.getFriendMessageHistoryCursor('thread','message'),/could not be located/);
});
