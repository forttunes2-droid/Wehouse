import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync('src/hooks/useSponsoredDiscovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(rpc,session=async()=>({data:{session:{}}})){
 const exports={},updates=[],timers=[];let effect;
 const dependencies={react:{useState:()=>[[],value=>updates.push(value)],useEffect:fn=>{effect=fn;}},'@/lib/supabase':{supabase:{rpc,auth:{getSession:session}}},'@/lib/withTimeout':{withTimeout:task=>Promise.resolve(task)}};
 vm.runInNewContext(code,{exports,require:name=>dependencies[name],window:{setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}}});
 return{api:exports,updates,start(category=''){exports.useSponsoredDiscovery('property','Nasarawa','Lafia',category);const cleanup=effect();timers.shift()();return cleanup;}};
}
test('Sponsored discovery clears previous results and limits validated placements',async()=>{
 const h=harness(async()=>({data:[null,{campaign_id:1,resource_id:'bad'},...Array.from({length:8},(_,i)=>({campaign_id:`campaign-${i}`,resource_id:`home-${i}`}))],error:null}));
 h.start();assert.equal(h.updates[0].length,0);await flush();assert.equal(h.updates.at(-1).length,6);
});
test('failed Sponsored reads become empty results without an unhandled rejection',async()=>{
 const h=harness(async()=>{throw Error('offline');});h.start();await flush();assert.equal(h.updates.at(-1).length,0);
});
test('a retired discovery request cannot restore placements from the previous location',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));const cleanup=h.start();await flush();cleanup();finish({data:[{campaign_id:'old',resource_id:'old'}],error:null});await flush();assert.equal(h.updates.length,1);
});
test('failed Sponsored analytics do not escape as unhandled rejections',async()=>{
 const h=harness(async()=>{throw Error('offline');});h.api.recordSponsoredImpression('campaign','home_discovery');h.api.recordSponsoredOpen('campaign');await flush();assert.equal(h.updates.length,0);
});

 test('Sponsored discovery sends the selected category before limiting campaign candidates',async()=>{
 const calls=[];const h=harness(async(name,args)=>{calls.push({name,args});return{data:[],error:null};});
 h.start('short_let');await flush();assert.equal(calls[0].args.p_category,'short_let');
 const all=[];const broad=harness(async(name,args)=>{all.push(args);return{data:[],error:null};});
 broad.start();await flush();assert.equal(all[0].p_category,null);
});
