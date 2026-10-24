import {assessCatalogStage} from './catalog-capacity-gates.mjs';
const paths=['home_feed','hotel_feed','home_city','hotel_city','hotel_price','home_detail','hotel_detail'];
const rates=[1,5,10,25,50,100,200];
export function assessDistributedCatalog(reports){
 const failures=[];
 if(!Array.isArray(reports)||reports.length!==4)return {passed:false,failures:['Four generator reports are required']};
 if(new Set(reports.map(r=>r.shard_id)).size!==4||reports.some(r=>!['0','1','2','3'].includes(r.shard_id)))failures.push('Distinct expected generator identities are required');
 if(reports.some(r=>!r.reviewed_sha||r.reviewed_sha!==reports[0].reviewed_sha))failures.push('Generator versions differ or are missing');
 const windows=[];
 for(const report of reports){
  if(report.project!=='WeHouse Test (qoobnkedfyosnizrlttt)'||!report.passed||report.status!=='passed'||report.stages?.length!==rates.length){failures.push(`Generator ${report.shard_id} did not complete the Test workload`);continue;}
  for(let i=0;i<rates.length;i++){
   const stage=report.stages[i];
   if(stage.target_rps!==rates[i]||stage.seconds!==30||!assessCatalogStage(stage,paths).passed)failures.push(`Generator ${report.shard_id} stage ${rates[i]} failed its own gates`);
  }
  const stage=report.stages.at(-1);
  if(!Number.isFinite(stage.started_at_ms)||!Number.isFinite(stage.dispatch_finished_at_ms)||stage.dispatch_finished_at_ms<=stage.started_at_ms)failures.push('Generator time windows are missing or invalid');
  else windows.push([stage.started_at_ms,stage.dispatch_finished_at_ms]);
 }
 const overlap=windows.length===4?Math.max(0,Math.min(...windows.map(w=>w[1]))-Math.max(...windows.map(w=>w[0]))):0;
 if(overlap<10000)failures.push('Passing 200-RPS stages did not overlap for at least ten seconds');
 return {passed:failures.length===0,failures,reviewed_sha:reports[0].reviewed_sha,
  configured_target_rps:800,offered_rps_during_overlap:failures.length===0?800:null,overlap_ms:overlap,
  scope:'Four independent anonymous catalog generators only; not sustained production or transactional capacity'};
}
