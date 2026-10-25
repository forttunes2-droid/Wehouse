import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Realtime owns its daily broadcast partitions and initializes them on connection.
// Never create/alter its tables from application migrations or SQL fixtures.
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const origin=new URL(status.API_URL||status.api_url);
assert.equal(origin.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(origin.hostname),'Disposable local Realtime only');
const key=status.ANON_KEY||status.anon_key||status.PUBLISHABLE_KEY||status.publishable_key;
assert.ok(key,'Local public key required');
const target=new URL('/realtime/v1/websocket',origin);target.protocol='ws:';
target.searchParams.set('apikey',key);target.searchParams.set('vsn','1.0.0');
await new Promise((resolve,reject)=>{
 const socket=new WebSocket(target);
 const finish=error=>{clearTimeout(timer);socket.close();error?reject(error):resolve();};
 const timer=setTimeout(()=>finish(Error('Local Realtime join deadline')),20000);
 socket.addEventListener('open',()=>socket.send(JSON.stringify({topic:'realtime:wehouse-local-readiness',event:'phx_join',ref:'1',payload:{config:{broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[],private:false}}})));
 socket.addEventListener('message',async event=>{
  try{
   const reply=JSON.parse(String(event.data));
   if(reply.event!=='phx_reply'||reply.ref!=='1')return;
   if(reply.payload?.status!=='ok')return finish(Error('Local Realtime join rejected'));
   const deadline=Date.now()+10000;
   while(Date.now()<deadline){
    const ready=execFileSync('docker',['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-At','-c',
     "select exists(select 1 from pg_replication_slots s join pg_stat_replication r on r.pid=s.active_pid where s.slot_name like 'supabase_realtime_messages%' and s.active and r.state='streaming')"],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    if(ready==='t')return finish();
    await new Promise(done=>setTimeout(done,250));
   }
   finish(Error('Local database broadcast replication not streaming'));
  }catch{finish(Error('Local Realtime readiness check failed'));}
 });
 socket.addEventListener('error',()=>finish(Error('Local Realtime connection failed')));
});
console.log('Disposable Realtime socket joined and database broadcast replication is streaming');
