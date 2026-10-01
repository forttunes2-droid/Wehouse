import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Agent, request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';

// Refuse any caller-supplied or hosted endpoint. These are real local Auth
// sessions and booking RPCs against a disposable Supabase stack only.
const status = JSON.parse(execFileSync('npx',['--yes','supabase@2.114.0','status','-o','json'],{encoding:'utf8'}));
const origin = new URL(status.API_URL || status.api_url);
assert.equal(origin.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(origin.hostname),'Local stack required');
const anon = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
const secret = status.SERVICE_ROLE_KEY || status.service_role_key;
assert.ok(anon && secret);
// All 3,000 journeys begin together. Reuse a bounded transport pool so the
// load generator does not exhaust its own ephemeral sockets before the local
// gateway has a chance to handle the work.
const rpcAgent = new Agent({ keepAlive: true, maxSockets: 300, maxFreeSockets: 100 });
const admin = createClient(origin.href,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const suffix = randomBytes(5).toString('hex');
const actors = [];
let rpcSamples = [];
const report = { scope:'Disposable local Supabase, real synthetic Auth users, HTTP hotel quotes and booking RPCs',
  catalog:{homes:500000,hotels:50000}, payment:'No Paystack payment, webhook, check-in or hosted infrastructure exercised',
  started_at:new Date().toISOString(), provisioned:0, stages:[], contention:null, invariants:null };
mkdirSync('test-results',{recursive:true});
function save() { writeFileSync('test-results/requested-bookings.json',JSON.stringify(report,null,2)+'\n'); }
function future(offset) { const d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+offset)).toISOString().slice(0,10); }
function percentile(values,p) { return values.length ? Math.round(values[Math.ceil(values.length*p)-1]*10)/10 : null; }
async function rpc(actor,name,body) {
  const payload=JSON.stringify(body);
  const submitted=performance.now();
  let socketAt=null;
  return await new Promise((resolve,reject)=>{
    const request=httpRequest(new URL(`/rest/v1/rpc/${name}`,origin),{
      method:'POST',agent:rpcAgent,headers:{apikey:anon,authorization:`Bearer ${actor.token}`,
        'content-type':'application/json','content-length':Buffer.byteLength(payload)},
    },response=>{
      let text=''; response.setEncoding('utf8');
      response.on('data',chunk=>{text+=chunk;});
      response.on('end',()=>{
        const ended=performance.now();
        rpcSamples.push({name,transport_queue_ms:(socketAt ?? ended)-submitted,response_ms:ended-(socketAt ?? submitted),total_ms:ended-submitted});
        let data; try {data=JSON.parse(text);} catch {data=text.slice(0,180);}
        if (response.statusCode<200 || response.statusCode>=300)
          reject(new Error(`${response.statusCode}:${String(data?.message || data?.error || data).slice(0,150)}`));
        else resolve(data);
      });
      response.on('error',reject);
    });
    request.on('socket',()=>{socketAt=performance.now();});
    request.setTimeout(30000,()=>request.destroy(new Error('RPC response timeout')));
    request.on('error',error=>reject(new Error(`${error.message}${error.code ? ` (${error.code})` : ''}`)));
    request.end(payload);
  });
}
async function provision(i) {
  const email=`requested-${suffix}-${i}@example.invalid`,password=randomBytes(24).toString('base64url');
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if (created.error || !created.data.user) throw new Error(`Create Auth ${i}: ${created.error?.message}`);
  const client=createClient(origin.href,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await client.auth.signInWithPassword({email,password});
  if (signed.error || !signed.data.session) throw new Error(`Sign in ${i}: ${signed.error?.message}`);
  const profile=await client.rpc('create_my_profile',{p_email:email,p_role:'user'});
  if (profile.error || !profile.data?.user_id) throw new Error(`Profile ${i}: ${profile.error?.message}`);
  actors[i]={token:signed.data.session.access_token,userId:profile.data.user_id};
  report.provisioned++;
}
async function pool(count,workers,fn) {
  let cursor=0;
  await Promise.all(Array.from({length:workers},async()=>{
    while(cursor<count) await fn(cursor++);
  }));
}
function target(index,offset) {
  const hotel=1+index%50,day=offset+Math.floor(index/50)%10;
  return { hotel_id:-1000000-hotel,room_id:-10000000-hotel,rate_plan_id:-3000000-hotel,
    check_in:future(day),check_out:future(day+1) };
}
async function book(actor,t) {
  const quote=await rpc(actor,'quote_hotel_room_rate',{
    p_hotel_id:t.hotel_id,p_room_id:t.room_id,p_rate_plan_id:t.rate_plan_id,
    p_check_in:t.check_in,p_check_out:t.check_out,
  });
  if (quote?.available !== true) throw new Error('inventory-unavailable-quote');
  const booking=await rpc(actor,'create_my_hotel_booking_with_rate',{
    p_hotel_id:t.hotel_id,p_room_id:t.room_id,p_rate_plan_id:t.rate_plan_id,
    p_check_in:t.check_in,p_check_out:t.check_out,p_guest_count:1,
    p_guest_name:'Synthetic Guest',p_guest_phone:'08000000000',p_special_requests:null,
  });
  if (!booking?.booking_id || booking.user_id!==actor.userId) throw new Error('wrong booking owner or missing ID');
  return booking.booking_id;
}
async function stage(name,start,count,offset) {
  rpcSamples=[];
  const began=performance.now();
  const results=await Promise.all(Array.from({length:count},async(_,i)=>{
    const time=performance.now();
    try { const id=await book(actors[start+i],target(i,offset));return {ok:true,ms:performance.now()-time,id}; }
    catch(error) {return {ok:false,ms:performance.now()-time,error:String(error?.message || error).slice(0,180)};}
  }));
  const successful=results.filter(row=>row.ok).map(row=>row.ms).sort((a,b)=>a-b);
  const failures=results.filter(row=>!row.ok);
  const elapsed=(performance.now()-began)/1000;
  const row={name,simultaneous_users:count,bookings_attempted:count,accepted:successful.length,
    errors:failures.length,error_examples:[...new Set(failures.map(row=>row.error))].slice(0,10),
    p50_ms:percentile(successful,.5),p95_ms:percentile(successful,.95),p99_ms:percentile(successful,.99),
    elapsed_seconds:Math.round(elapsed*100)/100,completed_per_second:Math.round(count/elapsed*10)/10};
  row.transport_max_sockets=rpcAgent.maxSockets;
  row.rpc_timings=Object.fromEntries(['quote_hotel_room_rate','create_my_hotel_booking_with_rate'].map(name=>{
    const samples=rpcSamples.filter(x=>x.name===name);
    return [name,{completed:samples.length,
      transport_queue_p95_ms:percentile(samples.map(x=>x.transport_queue_ms).sort((a,b)=>a-b),.95),
      response_p95_ms:percentile(samples.map(x=>x.response_ms).sort((a,b)=>a-b),.95),
      total_p95_ms:percentile(samples.map(x=>x.total_ms).sort((a,b)=>a-b),.95)}];
  }));
  report.stages.push(row); save();
  console.log(`${name}: ${row.accepted}/${count}, p95=${row.p95_ms}ms, errors=${row.errors}`);
}
try {
  const counts=execFileSync('docker',['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-Atc',
    "select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.hotels where hotel_id between -1050000 and -1000001)"],{encoding:'utf8'}).trim();
  assert.equal(counts,'500000|50000','Exact catalog size required');
  await pool(3601,30,async i=>{await provision(i);if(report.provisioned%300===0){console.log(`Provisioned ${report.provisioned}/3601`);save();}});
  await book(actors[3600],target(0,12));
  await stage('600-user spread',0,600,30);
  await stage('3000-user spread',600,3000,60);
  const collision=await Promise.all(Array.from({length:20},async(_,i)=>{
    try {await book(actors[i],target(0,150));return {ok:true};}
    catch(error) {return {ok:false,error:String(error?.message || error).slice(0,160)};}
  }));
  report.contention={attempted:20,capacity:10,accepted:collision.filter(x=>x.ok).length,
    inventory_denied:collision.filter(x=>!x.ok&&/unavailable|not available/i.test(x.error)).length,
    unexpected_errors:collision.filter(x=>!x.ok&&!/unavailable|not available/i.test(x.error)).map(x=>x.error).slice(0,5)};
  const invariant=execFileSync('docker',['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-Atc',
    `select count(*),count(distinct booking_id),(select coalesce(max(c),0) from (select count(*) c from public.hotel_bookings where hotel_id between -1000050 and -1000001 and status in ('pending','confirmed','checked_in') group by room_id,check_in) z) from public.hotel_bookings where hotel_id between -1000050 and -1000001`],{encoding:'utf8'}).trim();
  const [rows,unique,maxOccupied]=invariant.split('|').map(Number);
  report.invariants={booking_rows:rows,unique_ids:rows===unique,highest_occupied_room_night:maxOccupied,within_capacity:maxOccupied<=10};
  report.passed=report.stages.every(x=>x.errors===0)&&report.contention.accepted===10&&report.contention.inventory_denied===10&&report.contention.unexpected_errors.length===0&&report.invariants.unique_ids&&report.invariants.within_capacity;
} catch(error) {report.fatal_error=String(error?.message || error).slice(0,300);report.passed=false;}
report.finished_at=new Date().toISOString();save();
rpcAgent.destroy();
console.log(JSON.stringify({stages:report.stages,contention:report.contention,invariants:report.invariants,fatal_error:report.fatal_error,passed:report.passed}));
if (!report.passed) process.exitCode=1;
