// One temporary, empty public subscription initialises Supabase's managed
// Broadcast partitions. No message, table read, private channel or login occurs.
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
const url=new URL(process.env.WEHOUSE_TEST_SUPABASE_URL||'https://qoobnkedfyosnizrlttt.supabase.co');
const key=process.env.WEHOUSE_TEST_PUBLISHABLE_KEY||'';
if(url.username||url.password||url.search||url.hash||!['/',''].includes(url.pathname)||!(url.origin==='https://qoobnkedfyosnizrlttt.supabase.co'||url.origin==='http://127.0.0.1:54321'))throw Error('Realtime readiness is restricted to the reviewed Test/local project.');
if(!key.startsWith('sb_publishable_')){
 let role;try{role=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role;}catch{/* Invalid public key is rejected below. */}
 if(role!=='anon')throw Error('A publishable/anon Test key is required; privileged credentials are refused.');
}
const client=createClient(url.origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
let timeout;
try{
 await new Promise((resolve,reject)=>{
  timeout=setTimeout(()=>reject(Error('Test Realtime did not become ready within 15 seconds.')),15000);
  client.channel('wehouse-readiness-'+randomUUID()).subscribe(status=>{
   if(status==='SUBSCRIBED')resolve();
   if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))reject(Error('Test Realtime subscription failed: '+status));
  });
 });
 console.log('Test Realtime readiness: one empty subscription succeeded.');
}finally{clearTimeout(timeout);await client.removeAllChannels();client.realtime.disconnect();}
