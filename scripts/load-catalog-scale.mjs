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
const medium = process.env.WEHOUSE_CAPACITY_PRESET === 'medium';
const million = process.env.WEHOUSE_CAPACITY_PRESET === 'million';
const large = process.env.WEHOUSE_CAPACITY_PRESET === 'large';
const largeMaxConcurrency = Number(process.env.WEHOUSE_LARGE_CONCURRENCY || 1000);
assert.ok(!process.env.WEHOUSE_CAPACITY_PRESET || ['requested','medium','million','large','full','launch'].includes(process.env.WEHOUSE_CAPACITY_PRESET), 'Unknown capacity preset');
assert.ok(!large || (Number.isInteger(largeMaxConcurrency) && largeMaxConcurrency >= 500 && largeMaxConcurrency <= 50000), 'Large capacity concurrency must be between 500 and 50000');
const catalog = process.env.WEHOUSE_CAPACITY_PRESET === 'launch'
  ? {homes:500000,hotels:500000,synthetic_profiles:500000,real_auth_users:0}
  : medium
  ? {homes:50000,hotels:100000,synthetic_profiles:50000,real_auth_users:0}
  : process.env.WEHOUSE_CAPACITY_PRESET === 'requested' ? {homes:500000,hotels:50000,synthetic_profiles:50000,real_auth_users:0}
  : million ? {homes:1000000,hotels:1000000,synthetic_profiles:1000000,real_auth_users:0}
  : large ? {homes:7000000,hotels:0,synthetic_profiles:6000000,real_auth_users:0}
  : {homes:3000000,hotels:4000000,synthetic_profiles:20000000,real_auth_users:0};
const counts = execFileSync('docker', ['exec','supabase_db_wehouse','psql','-U','postgres','-d','postgres','-Atc',
  "select (select count(*) from public.listings where listing_id like 'load-home-scale-%'),(select count(*) from public.hotels where hotel_id between -5000000 and -1000001),(select count(*) from public.profiles where user_id like 'load-user-%')"], { encoding:'utf8' }).trim();
assert.equal(counts, `${catalog.homes}|${catalog.hotels}|${catalog.synthetic_profiles}`, 'Exact synthetic catalog/profile row counts required');

const scenarios = [
  { name:'home_feed',rpc:'search_discoverable_homes',body:()=>({p_limit:24}),valid:d=>d?.items?.length===24 },
  { name:'home_city',rpc:'search_discoverable_homes',body:()=>({p_city:'Lafia',p_limit:24}),valid:d=>d?.items?.length===24&&d.items.every(x=>x.city==='Lafia') },
  { name:'hotel_feed',rpc:'search_discoverable_hotels',body:()=>({p_limit:24}),valid:d=>d?.items?.length===24 },
  { name:'hotel_city',rpc:'search_discoverable_hotels',body:()=>({p_city:'Lafia',p_limit:24}),valid:d=>d?.items?.length===24&&d.items.every(x=>x.city==='Lafia') },
  { name:'hotel_price',rpc:'search_discoverable_hotels',body:()=>({p_min_price:22000,p_max_price:24000,p_limit:24}),valid:d=>d?.items?.length===24 },
  { name:'one_hotel',rpc:'get_public_hotel_detail',body:()=>({p_hotel_id:-1000001}),valid:d=>d?.hotel_id===-1000001 },
  { name:'spread_hotel',rpc:'get_public_hotel_detail',body:i=>({p_hotel_id:-1000001-i%catalog.hotels}),valid:d=>Number.isInteger(d?.hotel_id) },
  { name:'one_home',rpc:'get_public_listing_detail',body:()=>({p_listing_id:'load-home-scale-1'}),valid:d=>d?.listing_id==='load-home-scale-1' },
  { name:'spread_home',rpc:'get_public_listing_detail',body:i=>({p_listing_id:`load-home-scale-${1+i%catalog.homes}`}),valid:d=>typeof d?.listing_id==='string' },
].filter(s => catalog.hotels > 0 || !s.name.startsWith('hotel_') && s.name !== 'one_hotel' && s.name !== 'spread_hotel');
async function sample(scenario,i) {
  const start=performance.now();
  try {
    const response=await fetch(new URL(`/rest/v1/rpc/${scenario.rpc}`,origin),{
      method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify(scenario.body(i)),signal:AbortSignal.timeout(20000),
    });
    const body=await response.text(); const data=response.ok?JSON.parse(body):null;
    return {ms:performance.now()-start,bytes:Buffer.byteLength(body),ok:response.ok&&scenario.valid(data),status:response.status};
  } catch(error) { return {ms:performance.now()-start,bytes:0,ok:false,status:`${error.name}:${error.cause?.code || error.message}`}; }
}
const percentile=(arr,p)=>arr.length?Math.round(arr[Math.ceil(arr.length*p)-1]*10)/10:null;
async function stage(scenario,concurrency,count) {
  let next=0, inFlight=0, peakInFlight=0;const samples=[];const start=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<count){
      const i=next++;
      inFlight++; peakInFlight=Math.max(peakInFlight,inFlight);
      try { samples[i]=await sample(scenario,i); }
      finally { inFlight--; }
    }
  }));
  const seconds=(performance.now()-start)/1000;
  const successful=samples.filter(x=>x.ok).map(x=>x.ms).sort((a,b)=>a-b);
  const failures=samples.filter(x=>!x.ok);
  const error_counts=Object.fromEntries([...new Set(failures.map(x=>String(x.status)))].map(status=>[
    status,failures.filter(x=>String(x.status)===status).length,
  ]));
  return {scenario:scenario.name,configured_concurrency:concurrency,peak_in_flight:peakInFlight,requests:count,successes:successful.length,errors:failures.length,
    error_counts,p50_ms:percentile(successful,.5),p95_ms:percentile(successful,.95),p99_ms:percentile(successful,.99),
    elapsed_seconds:Math.round(seconds*100)/100,
    requests_per_second:Math.round(count/seconds*10)/10,
    response_megabytes:Math.round(samples.reduce((n,x)=>n+x.bytes,0)/1048576*100)/100};
}
const report={source:'disposable local Supabase HTTP API',catalog,
  caveat:large ? 'Staged disposable read ramp capped at ' + largeMaxConcurrency + ' concurrent workers against a 7m listing catalog. It measures this runner and local stack; production capacity still requires the same workload on production-equivalent hosted infrastructure.' : 'Closed-loop read traffic on one machine. This does not model 20 million simultaneous signed-in users, writes, CDN, payments or hosted infrastructure.',
  measured_at:new Date().toISOString(),stages:[]};
mkdirSync('test-results',{recursive:true});
const stages = process.env.WEHOUSE_CAPACITY_PRESET === 'requested'
  ? [{concurrency:1,count:30},{concurrency:100,count:300}]
  : process.env.WEHOUSE_CAPACITY_PRESET === 'large'
    ? [
        {concurrency:500,count:1000},
        {concurrency:1000,count:2000},
        {concurrency:2500,count:5000},
        {concurrency:5000,count:10000},
        {concurrency:10000,count:20000},
        {concurrency:20000,count:40000},
        {concurrency:35000,count:70000},
        {concurrency:50000,count:100000},
      ].filter(stage => stage.concurrency <= largeMaxConcurrency)
    : [{concurrency:1,count:50},{concurrency:20,count:200},{concurrency:100,count:500},{concurrency:200,count:800},{concurrency:400,count:800}];
stageLoop: for(const {concurrency,count} of stages){
  // Keep the broad endpoint suite at lower loads; at the highest steps use a
  // feed query and a spread-out detail query to measure the full connection ramp.
  const stageScenarios = process.env.WEHOUSE_CAPACITY_PRESET === 'large' && concurrency >= 10000
    ? scenarios.filter(s => s.name === 'home_feed' || s.name === 'spread_home')
    : scenarios;
  for(const scenario of stageScenarios){
    const result=await stage(scenario,concurrency,count);report.stages.push(result);
    writeFileSync('test-results/catalog-scale.json',JSON.stringify(report,null,2)+'\n');
    console.log(`${result.scenario} configured=${concurrency} peak_in_flight=${result.peak_in_flight} ok=${count-result.errors}/${count} p95=${result.p95_ms}ms p99=${result.p99_ms}ms rps=${result.requests_per_second}`);
    if (result.errors > 0) {
      console.error(`Stopping catalog ramp at first failing stage (${scenario.name}, concurrency=${concurrency}); preserve runner capacity for booking and roommate tests.`);
      break stageLoop;
    }
  }
}
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/catalog-scale.json',JSON.stringify(report,null,2)+'\n');
if(report.stages.some(x=>x.errors))process.exitCode=1;
