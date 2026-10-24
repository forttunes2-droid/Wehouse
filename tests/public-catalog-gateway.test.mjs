import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const compiled=await build({entryPoints:['api/public-catalog.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createPublicCatalogHandler}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const env={VERCEL_ENV:'preview',VITE_SUPABASE_URL:'https://qoobnkedfyosnizrlttt.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
const receipt={items:[{listing_id:'public-home',title:'Public home'}],has_more:false,next_cursor_id:null};
const request=(query='kind=homes&p_limit=24',options={})=>new Request('https://preview.vercel.app/api/public-catalog?'+query,options);

test('public gateway uses anonymous redacted RPCs, ignoring caller identity and cookies',async()=>{
 let observed;
 const handler=createPublicCatalogHandler(env,async(url,options)=>{observed={url,options};return Response.json(receipt);});
 const response=await handler(request(undefined,{headers:{Authorization:'Bearer private-user-token',Cookie:'private-session'}}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),receipt);
 assert.equal(observed.url,env.VITE_SUPABASE_URL+'/rest/v1/rpc/search_discoverable_homes');
 assert.equal(observed.options.headers.Authorization,'Bearer sb_publishable_synthetic');
 assert.equal(observed.options.headers.Cookie,undefined);assert.equal(observed.options.redirect,'error');
 assert.equal(response.headers.get('Vercel-CDN-Cache-Control'),'public, s-maxage=5');
 assert.equal(response.headers.get('Set-Cookie'),null);
 assert.equal(response.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
});

test('private, precise-location, arbitrary-RPC, duplicate and excessive queries never reach origin',async()=>{
 let calls=0;const handler=createPublicCatalogHandler(env,async()=>{calls++;return Response.json(receipt);});
 for(const query of ['kind=payments','kind=homes&rpc=delete_user_account','kind=hotels&p_lat=9.8','kind=homes&p_query=private',
  'kind=homes&kind=hotels','kind=homes&p_limit=1000','kind=homes&p_min_price=900&p_max_price=10','kind=hotels&p_amenities=not-json']){
  const response=await handler(request(query));assert.equal(response.status,400,query);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
 assert.equal((await handler(request(undefined,{method:'POST',body:'{}'}))).status,405);assert.equal(calls,0);
});

test('identical cold requests share one origin operation and independent response bodies',async()=>{
 let finish,calls=0;const blocked=new Promise(resolve=>{finish=resolve;});
 const handler=createPublicCatalogHandler(env,async()=>{calls++;await blocked;return Response.json(receipt);});
 const waiting=Array.from({length:100},()=>handler(request()));
 await Promise.resolve();assert.equal(calls,1);finish();
 const responses=await Promise.all(waiting);assert.equal(responses.length,100);
 assert.ok(responses.every(response=>response.status===200));
 assert.deepEqual(await responses[0].json(),await responses[99].json());
});

test('high-cardinality misses are bounded and errors cannot be cached or leak provider details',async()=>{
 let finish,calls=0;const blocked=new Promise(resolve=>{finish=resolve;});
 const handler=createPublicCatalogHandler(env,async()=>{calls++;await blocked;return Response.json({secret:'provider diagnostics'},{status:500});});
 const waiting=Array.from({length:16},(_,i)=>handler(request(`kind=homes&p_limit=24&p_min_price=${i}`)));
 const busy=await handler(request('kind=homes&p_limit=24&p_min_price=100'));
 assert.equal(busy.status,503);assert.equal(busy.headers.get('Retry-After'),'1');assert.equal(calls,16);
 finish();const responses=await Promise.all(waiting);
 for(const response of responses){assert.equal(response.headers.get('Vercel-CDN-Cache-Control'),'no-store');assert.ok(!(await response.text()).includes('provider diagnostics'));}
});

test('Preview cannot read Production even with an official Host or forged headers',async()=>{
 let calls=0;const upstream=async()=>{calls++;return Response.json(receipt);};
 const live={...env,VITE_SUPABASE_URL:'https://rkrhnkhppeihvmuwvsvn.supabase.co'};
 const handler=createPublicCatalogHandler(live,upstream);
 assert.equal((await handler(new Request('https://wehouse.com.ng/api/public-catalog?kind=homes&p_limit=24'))).status,503);
 assert.equal((await handler(request(undefined,{headers:{Host:'wehouse.com.ng','x-forwarded-host':'wehouse.com.ng'}}))).status,503);
 assert.equal(calls,0);
 assert.equal((await createPublicCatalogHandler({...env,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden'},upstream)(request())).status,503);
});

test('canonical ordering redirects without origin work; invalid upstream receipts are not cached',async()=>{
 let calls=0;const handler=createPublicCatalogHandler(env,async()=>{calls++;return Response.json({items:[],has_more:'unknown'});});
 const redirect=await handler(request('p_limit=24&kind=homes'));assert.equal(redirect.status,308);assert.equal(calls,0);
 assert.equal(redirect.headers.get('Location'),'/api/public-catalog?kind=homes&p_limit=24');
 const failure=await handler(request());assert.equal(failure.status,503);assert.equal(failure.headers.get('Cache-Control'),'no-store');
});
