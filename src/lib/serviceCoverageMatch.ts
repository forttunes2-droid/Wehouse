type Coverage={state?:unknown;lga?:unknown;areas?:unknown};
function key(value:unknown){return String(value??'').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
function stateKey(value:unknown){const normalized=key(value).replace(/state$/,'');return ['abuja','abujafct','fct','federalcapitalterritory'].includes(normalized)?'fct':normalized;}
function rows(worker:unknown):Coverage[]{const coverage=(worker as {coverage?:unknown}|null)?.coverage;return Array.isArray(coverage)?coverage.filter(row=>row&&typeof row==='object'):[];}
/** Current State/LGA coverage; never infer travel coverage from a private home/base address. */
export function workerServesLocation(worker:unknown,state:string,city:string){
  if(!state.trim()&&!city.trim())return true;
  return rows(worker).some(row=>(!state.trim()||stateKey(row.state)===stateKey(state))&&(!city.trim()||key(row.lga)===key(city)));
}
export function workerCoverageSearchText(worker:unknown){return rows(worker).flatMap(row=>[row.state,row.lga,...(Array.isArray(row.areas)?row.areas:[])]).filter(value=>typeof value==='string').join(' ');}
