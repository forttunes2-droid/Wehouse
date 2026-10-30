import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/lib/serviceBookingLive.ts'],write:false,bundle:true,format:'esm',platform:'node',plugins:[{
 name:'service-session-fixture',setup(api){api.onResolve({filter:/supabase\/client$/},()=>({path:'fixture',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase=globalThis.__serviceLiveClient;',loader:'js'}));}
}]});
async function fixture(session=Promise.resolve({data:{session:{user:{id:'customer-auth'}}},error:null})){
 const state={channels:[],removed:0};
 const channel={on(type,filter,callback){assert.equal(type,'broadcast');assert.equal(filter.event,'service_booking_changed');state.signal=callback;return this;},subscribe(callback){state.status=callback;return this;}};
 globalThis.__serviceLiveClient={auth:{getSession:()=>session},realtime:{setAuth:async()=>{}},channel:(topic,options)=>{state.channels.push({topic,options});return channel;},removeChannel:()=>state.removed++};
 const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+`\n//${Math.random()}`).toString('base64'));
 return {...api,state};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('service quotes use recipient-private signals and authoritative refreshes',async()=>{
 const {state,subscribeToServiceBookingChanges}=await fixture();let refreshed=0;const health=[];
 const close=subscribeToServiceBookingChanges('booking-a',()=>refreshed++,value=>health.push(value));await flush();
 assert.deepEqual(state.channels,[{topic:'wehouse:service-booking:customer-auth',options:{config:{private:true}}}]);
 state.status('SUBSCRIBED');assert.equal(refreshed,1);assert.deepEqual(health,[false]);
 state.signal({payload:{booking_id:'other',price:1}});assert.equal(refreshed,1);
 state.signal({payload:{booking_id:'booking-a'}});assert.equal(refreshed,2);assert.equal(health.at(-1),true);
 state.status('CHANNEL_ERROR');assert.equal(health.at(-1),false);close();
 state.signal({payload:{booking_id:'booking-a'}});assert.equal(refreshed,2);assert.equal(state.removed,1);
});
test('closing or signing out cannot create a late public subscription',async()=>{
 let done;const pending=new Promise(resolve=>done=resolve);
 const {state,subscribeToServiceBookingChanges}=await fixture(pending);
 const close=subscribeToServiceBookingChanges('booking',()=>assert.fail('disposed'));close();
 done({data:{session:{user:{id:'late'}}},error:null});await flush();assert.equal(state.channels.length,0);
 const signedOut=await fixture(Promise.resolve({data:{session:null},error:null}));
 signedOut.subscribeToServiceBookingChanges('booking',()=>assert.fail('signed out'));await flush();assert.equal(signedOut.state.channels.length,0);
});
