import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// HTTP read paths only; no hosted URL, payment, booking or messaging mutation.
const status = JSON.parse(execFileSync('npx', ['--yes','supabase@2.114.0','status','-o','json'], { encoding:'utf8' }));
const origin = new URL(status.API_URL || status.api_url);
assert.ok(['localhost','127.0.0.1'].includes(origin.hostname) && origin.protocol === 'http:', 'Disposable local Supabase only');
const key = status.ANON_KEY || status.anon_key || status.PUBLISHABLE_KEY || status.publishable_key;
assert.ok(key);
const counts = execFileSync('docker', ['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-Atc',
  "select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.hotels where hotel_id between -5000000 and -1000001),(select count(*) from public.profiles where user_id like 'load-user-%')"], { encoding:'utf8' }).trim();
assert.equal(counts, '3000000|4000000|20000000', 'Exact synthetic catalog/profile row counts required');

const scenarios = [
  { name:'home_feed',rpc:'search_discoverable_homes',body:()=>({p_limit:24}),valid:d=>d?.items?.length===24 },
  { name:'home_city',rpc:'search_discoverable_homes',body:()=>({p_city:'Lafia',p_limit:24}),valid:d=>d?.items?.length===24&&d.items.every(x=>x.city==='Lafia') },
  { name:'hotel_feed',rpc:'search_discoverable_hotels',body:()=>({p_limit:24}),valid:d=>d?.items?.length===24 },
  { name:'hotel_city',rpc:'search_discoverable_hotels',body:()=>({p_city:'Lafia',p_limit:24}),valid:d=>d?.items?.length===24&&d.items.every(x=>x.city==='Lafia') },
  { name:'hotel_price',rpc:'search_discoverable_hotels',body:()=>({p_min_price:22000,p_max_price:24000,p_limit:24}),valid:d=>d?.items?.length===24 },
  { name:'one_hotel',rpc:'get_public_hotel_detail',body:()=>({p_hotel_id:-1000001}),valid:d=>d?.hotel_id===-1000001 },
  { name:'spread_hotel',rpc:'get_public_hotel_detail',body:i=>({p_hotel_id:-1000001-i%4000000}),valid:d=>Number.isInteger(d?.hotel_id) },
  { name:'one_home',rpc:'get_public_listing_detail',body:()=>({p_listing_id:'load-home-scale-1'}),valid:d=>d?.listing_id==='load-home-scale-1' },
  { name:'spread_home',rpc:'get_public_listing_detail',body:i=>({p_listing_id:`load-home-scale-${1+i%3000000}`}),valid:d=>typeof d?.listing_id==='string' },
];
async function sample(scenario,i) {
  const start=performance.now();
  try {
    const response=await fetch(new URL(`/rest/v1/rpc/${scenario.rpc}`,origin),{
      method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify(scenario.body(i)),signal:AbortSignal.timeout(20000),
    });
    const body=await response.text(); const data=response.ok?JSON.parse(body):null;
    return {ms:performance.now()-start,bytes:Buffer.byteLength(body),ok:response.ok&&scenario.valid(data),status:response.status};
  } catch(error) { return {ms:performance.now()-start,bytes:0,ok:false,status:error.name}; }
}
const percentile=(arr,p)=>Math.round(arr[Math.ceil(arr.length*p)-1]*10)/10;
async function stage(scenario,concurrency,count) {
  let next=0;const samples=[];const start=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<count){const i=next++;samples[i]=await sample(scenario,i);}
  }));
  const sorted=samples.map(x=>x.ms).sort((a,b)=>a-b);
  return {scenario:scenario.name,concurrency,requests:count,errors:samples.filter(x=>!x.ok).length,
    error_statuses:[...new Set(samples.filter(x=>!x.ok).map(x=>x.status))],
    p50_ms:percentile(sorted,.5),p95_ms:percentile(sorted,.95),p99_ms:percentile(sorted,.99),
    requests_per_second:Math.round(count/((performance.now()-start)/1000)*10)/10,
    response_megabytes:Math.round(samples.reduce((n,x)=>n+x.bytes,0)/1048576*100)/100};
}
const report={source:'disposable local Supabase HTTP API',catalog:{homes:3000000,hotels:4000000,synthetic_profiles:20000000,real_auth_users:0},
  caveat:'Closed-loop read traffic on one machine. This does not model 20 million simultaneous signed-in users, writes, CDN, payments or hosted infrastructure.',
  measured_at:new Date().toISOString(),stages:[]};
for(const {concurrency,count} of [{concurrency:1,count:50},{concurrency:20,count:200},{concurrency:100,count:500},{concurrency:400,count:800}]){
  for(const scenario of scenarios){
    const result=await stage(scenario,concurrency,count);report.stages.push(result);
    console.log(`${result.scenario} c=${concurrency} ok=${count-result.errors}/${count} p95=${result.p95_ms}ms p99=${result.p99_ms}ms rps=${result.requests_per_second}`);
  }
}
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/catalog-scale.json',JSON.stringify(report,null,2)+'\n');
if(report.stages.some(x=>x.errors))process.exitCode=1;
