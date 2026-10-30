import {parsePublicCatalogQuery} from '../src/lib/publicCatalogContract.js';
import {resolveSupabaseEnvironment} from '../src/lib/supabase/environment.js';

type Environment = Record<string,string|undefined>;
type CatalogDiagnostic={event:'public_catalog_unavailable';kind:'homes'|'hotels';stage:string;status?:number};
const uncached={'Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store'};
// Bound decoded data, including chunked/compressed responses whose advertised
// length cannot be trusted. A slow or malformed origin must not grow heap usage
// without limit across concurrent cache misses.
const MAX_CATALOG_BYTES=2*1024*1024;
async function readCatalogReceipt(response:Response):Promise<unknown>{
  const reader=response.body?.getReader();
  if(!reader)throw Object.assign(Error('Missing catalog body'),{gatewayStage:'origin_receipt'});
  let bytes=0,complete=false;
  try{
    if(Number(response.headers.get('content-length'))>MAX_CATALOG_BYTES)throw Error('Catalog body exceeds budget');
    // Fixed storage also bounds overhead when an origin sends tiny chunks.
    const body=new Uint8Array(MAX_CATALOG_BYTES);
    while(true){
      const part=await reader.read();
      if(part.done){complete=true;break;}
      if(bytes+part.value.byteLength>MAX_CATALOG_BYTES)throw Error('Catalog body exceeds budget');
      body.set(part.value,bytes);bytes+=part.value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(0,bytes)));
  }catch{throw Object.assign(Error('Invalid public catalog receipt'),{gatewayStage:'origin_receipt'});}
  finally{
    if(!complete)try{await reader.cancel();}catch{/* Preserve the public receipt failure. */}
    reader.releaseLock();
  }
}
/** This endpoint never receives a session, privileged key or write-capable RPC. */
export function createPublicCatalogHandler(env:Environment,upstream:typeof fetch=fetch,
  report:(event:CatalogDiagnostic)=>void=event=>console.error(JSON.stringify(event))){
  const pending=new Map<string,Promise<unknown>>();
  let configurationReported=false;
  const diagnostic=(event:CatalogDiagnostic)=>{try{report(event);}catch{/* Logging must not change a public error response. */}};
  return async(request:Request):Promise<Response>=>{
    if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...uncached,Allow:'GET'}});
    const url=new URL(request.url);
    if(url.search.length>2048)return Response.json({error:'Search is too large'},{status:400,headers:uncached});
    let parsed:ReturnType<typeof parsePublicCatalogQuery>;
    try{parsed=parsePublicCatalogQuery(url.searchParams);}catch{return Response.json({error:'Unsupported public search'},{status:400,headers:uncached});}
    // The deployment environment and real request origin must both agree. A
    // Preview cannot become Production through a spoofed host header.
    const official=['wehouse.com.ng','www.wehouse.com.ng'].includes(url.hostname);
    let project:ReturnType<typeof resolveSupabaseEnvironment>;
    try{project=resolveSupabaseEnvironment(env.VERCEL_ENV==='production'&&official?url.hostname:'preview.vercel.app',
      env.VITE_SUPABASE_URL||'',env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY||'');}
    catch{
      if(!configurationReported){configurationReported=true;diagnostic({event:'public_catalog_unavailable',kind:parsed.kind,stage:'configuration'});}
      return Response.json({error:'Catalog environment is unavailable'},{status:503,headers:uncached});
    }
    const canonical=parsed.canonical.toString();
    if(url.search.slice(1)!==canonical)return new Response(null,{status:308,headers:{...uncached,Location:`/api/public-catalog?${canonical}`}});
    if(!pending.has(canonical)&&pending.size>=16)return Response.json({error:'Catalog is busy. Try again.'},{status:503,headers:{...uncached,'Retry-After':'1'}});
    if(!pending.has(canonical)){
      const operation=(async()=>{
        const response=await upstream(`${project.url}/rest/v1/rpc/${parsed.kind==='homes'?'search_discoverable_homes':'search_discoverable_hotels'}`,{
          method:'POST',headers:{apikey:project.key,Authorization:`Bearer ${project.key}`,'Content-Type':'application/json'},
          body:JSON.stringify(parsed.body),signal:AbortSignal.timeout(8000),redirect:'error',
        });
        if(!response.ok){
          // Discard error streams so failed requests release their connection;
          // provider bodies are neither buffered nor exposed to customers.
          try{await response.body?.cancel();}catch{/* Retain the safe HTTP status. */}
          throw Object.assign(Error('Public catalog lookup failed'),{gatewayStage:'origin_status',gatewayStatus:response.status});
        }
        const result=await readCatalogReceipt(response) as {items?:unknown;has_more?:unknown}|null;
        if(!result||!Array.isArray(result.items)||result.items.length>24||typeof result.has_more!=='boolean')throw Object.assign(Error('Invalid public catalog receipt'),{gatewayStage:'origin_receipt'});
        return result;
      })().catch((failure:unknown)=>{
        const details=failure as {gatewayStage?:string;gatewayStatus?:number}|null;
        diagnostic({event:'public_catalog_unavailable',kind:parsed.kind,
          stage:['origin_status','origin_receipt'].includes(details?.gatewayStage||'')?details!.gatewayStage!:'origin_transport',
          status:typeof details?.gatewayStatus==='number'&&details.gatewayStatus>=100&&details.gatewayStatus<=599?details.gatewayStatus:undefined});
        throw failure;
      });
      pending.set(canonical,operation);
      void operation.finally(()=>pending.delete(canonical)).catch(()=>{});
    }
    try{
      const result=await pending.get(canonical);
      return Response.json(result,{headers:{'Cache-Control':'public, max-age=0, must-revalidate',
        'Vercel-CDN-Cache-Control':'public, s-maxage=5',
        'X-WeHouse-Catalog':'public-feed-v1','X-Content-Type-Options':'nosniff'}});
    }catch{return Response.json({error:'Public catalog could not be loaded. Try again.'},{status:503,headers:uncached});}
  };
}
export default {fetch:createPublicCatalogHandler(process.env)};
