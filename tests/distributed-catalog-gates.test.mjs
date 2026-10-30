import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDistributedCatalog} from '../scripts/lib/distributed-catalog-gates.mjs';
const paths=['home_feed','hotel_feed','home_city','hotel_city','hotel_price','home_detail','hotel_detail'];
function reports(){return Array.from({length:4},(_,shard)=>({shard_id:String(shard),reviewed_sha:'same-version',project:'WeHouse Test (qoobnkedfyosnizrlttt)',passed:true,status:'passed',stages:[1,5,10,25,50,100,200].map(rate=>{
 const offered=rate*30,counts=paths.map((_,i)=>Math.floor(offered/7)+(i<offered%7?1:0));
 return {target_rps:rate,seconds:30,offered,completed:offered,errors:0,dropped:0,retry_rate_pct:0,p95_ms:200,dispatch_seconds:30,
  started_at_ms:100000+shard*1000,dispatch_finished_at_ms:130000+shard*1000,
  by_path:Object.fromEntries(paths.map((name,i)=>[name,{requests:counts[i],errors:0,p95_ms:200}]))};})}));}
test('distributed capacity requires independently passing overlapping workloads',()=>{
 const result=assessDistributedCatalog(reports());assert.equal(result.passed,true);assert.equal(result.overlap_ms,27000);assert.equal(result.offered_rps_during_overlap,800);
});
test('sequential, failed, incomplete and mismatched runs cannot be added into a capacity claim',()=>{
 for(const mutate of [r=>{r[3].stages.at(-1).started_at_ms=200000;r[3].stages.at(-1).dispatch_finished_at_ms=230000;},
  r=>r[1].stages.at(-1).errors=1,r=>r[1].stages[0].p95_ms=3000,r=>r[2].shard_id='0',r=>r[0].reviewed_sha='other-version',r=>r.pop()]){
  const sample=reports();mutate(sample);const result=assessDistributedCatalog(sample);assert.equal(result.passed,false);assert.equal(result.offered_rps_during_overlap??null,null);
 }
});
