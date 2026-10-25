import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const bundle=await build({entryPoints:['src/lib/friendChatLive.ts'],write:false,bundle:true,format:'esm',platform:'node',plugins:[{
 name:'session-channel-fixture',setup(api){api.onResolve({filter:/supabase\/client$/},()=>({path:'fixture',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase=globalThis.__friendLiveClient;',loader:'js'}));}
}]});
async function setup(session=Promise.resolve({data:{session:{user:{id:'my-auth-id'}}},error:null})){
 const state={removed:0,channels:[],callback:null,status:null};
 const channel={on(type,filter,callback){assert.equal(type,'broadcast');assert.equal(filter.event,'friend_chat_changed');state.callback=callback;return this;},subscribe(callback){state.status=callback;return this;}};
 globalThis.__friendLiveClient={auth:{getSession:()=>session},realtime:{setAuth:async()=>{}},channel:(topic,options)=>{state.channels.push({topic,options});return channel;},removeChannel:()=>{state.removed++;}};
 const {subscribeToFriendChatChanges}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n// ${Math.random()}`).toString('base64'));
 return {state,subscribeToFriendChatChanges};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Friend chat joins its own private topic and filters thread/kind hints',async()=>{
 const {state,subscribeToFriendChatChanges}=await setup();let changes=0;const health=[];
 const close=subscribeToFriendChatChanges('thread-a',()=>changes++,value=>health.push(value));await flush();
 assert.deepEqual(state.channels,[{topic:'wehouse:friend:my-auth-id',options:{config:{private:true}}}]);
 state.status('SUBSCRIBED');assert.equal(changes,1);
 state.status('CHANNEL_ERROR');assert.deepEqual(health,[true,false]);
 for(const payload of [{friend_id:'other',kind:'reaction'},{friend_id:'thread-a',kind:'unknown'},null])state.callback({payload});
 assert.equal(changes,1);
 for(const kind of ['reaction','message'])state.callback({payload:{friend_id:'thread-a',kind}});
 assert.equal(changes,3);close();assert.equal(state.removed,1);
 state.callback({payload:{friend_id:'thread-a',kind:'reaction'}});assert.equal(changes,3);
});
test('closing before session lookup completes leaves no late Friend subscription',async()=>{
 let finish;const session=new Promise(resolve=>{finish=resolve;});
 const {state,subscribeToFriendChatChanges}=await setup(session);
 const close=subscribeToFriendChatChanges('thread',()=>assert.fail('closed'));close();
 finish({data:{session:{user:{id:'late-auth'}}},error:null});await flush();assert.equal(state.channels.length,0);
});
test('signed-out Friend chat never joins a public fallback',async()=>{
 const {state,subscribeToFriendChatChanges}=await setup(Promise.resolve({data:{session:null},error:null}));
 subscribeToFriendChatChanges('thread',()=>{});await flush();assert.equal(state.channels.length,0);
});
test('Friend chat reconciles visibly without eight-second full-thread polling',()=>{
 const source=readFileSync('src/components/FriendChat.tsx','utf8');
 assert.match(source,/createRefreshScheduler\(load,\(\)=>document.visibilityState==='visible'\)/);
 assert.match(source,/setInterval\(\(\)=>\{if\(!live\)refresh\(\);\},60_000\)/);assert.doesNotMatch(source,/setInterval\([^;]+8000/);
 assert.match(source,/loadVersion.current\+\+;scheduler.dispose\(\);unsubscribe\(\)/);
});
