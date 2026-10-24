import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/lib/publicCatalogRead.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
 name:'native-platform-only',setup(api){api.onResolve({filter:/^@capacitor\/core$/},()=>({path:'native',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const Capacitor={isNativePlatform:()=>globalThis.__nativeTest===true}',loader:'js'}));}
}]});
const {publicCatalogRead}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
async function isolated(run){
 const saved={window:globalThis.window,fetch:globalThis.fetch,native:globalThis.__nativeTest};
 globalThis.window={location:{hostname:'wehouse-preview.vercel.app',protocol:'https:'}};
 globalThis.__nativeTest=false;
 try{await run();}finally{globalThis.window=saved.window;globalThis.fetch=saved.fetch;globalThis.__nativeTest=saved.native;}
}
test('deployed public feeds attach no Supabase token and retain protected-preview access',()=>isolated(async()=>{
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/public-catalog?kind=homes&p_limit=24&p_state=Nasarawa');assert.equal(options.credentials,'same-origin');assert.equal(options.headers,undefined);return Response.json({items:[],has_more:false});};
 const result=await publicCatalogRead('homes',{p_state:'Nasarawa',p_limit:24,p_query:null},()=>{throw Error('Direct origin must not be called');});
 assert.equal(result.error,null);assert.equal(calls,1);
}));
test('precise location, typed searches, later pages and native retain uncached RPCs',()=>isolated(async()=>{
 let direct=0;globalThis.fetch=()=>{throw Error('Private search must not reach shared URL/cache');};
 const read=()=>{direct++;return Promise.resolve({data:{items:[],has_more:false},error:null});};
 for(const body of [{p_lat:9.8,p_lng:8.5},{p_query:'a private search'},{p_cursor_id:123},{p_cursor_created_at:'2026-10-24T10:00:00Z'}])await publicCatalogRead('hotels',body,read);
 globalThis.__nativeTest=true;await publicCatalogRead('homes',{p_limit:24},read);
 globalThis.__nativeTest=false;globalThis.window.location.hostname='localhost';await publicCatalogRead('homes',{p_limit:24},read);
 assert.equal(direct,6);
}));
test('gateway failure does not stampede the database through an automatic fallback',()=>isolated(async()=>{
 globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503});
 const result=await publicCatalogRead('homes',{},()=>{throw Error('No second origin request');});
 assert.equal(result.data,null);assert.match(result.error.message,/try again/);
}));
