import {publicCatalogQuery,type PublicCatalogKind} from './publicCatalogContract';
import {Capacitor} from '@capacitor/core';

type PublicReadResult={data:any;error:any};
// In-flight work only: no completed response or account data is retained here.
const pendingFeeds=new Map<string,Promise<PublicReadResult>>();
const unavailable=():PublicReadResult=>({data:null,error:{message:'Catalog could not be loaded. Please try again.'}});

/** Native/local development retain direct RPCs; deployed web uses its same-origin cache. */
export async function publicCatalogRead(kind:PublicCatalogKind,body:Record<string,unknown>,direct:()=>PromiseLike<{data:any;error:any}>){
  const host=typeof window==='undefined'?'':window.location.hostname;
  const deployed=!Capacitor.isNativePlatform()&&typeof window!=='undefined'&&window.location.protocol==='https:'&&
    (['wehouse.com.ng','www.wehouse.com.ng'].includes(host)||host.endsWith('.vercel.app'));
  let query:URLSearchParams;
  try{query=publicCatalogQuery(kind,body);}catch{return direct();}
  if(!deployed)return direct();
  const key=`${window.location.origin||`${window.location.protocol}//${host}`}|${query}`;
  if(!pendingFeeds.has(key)){
    // Limit distinct misses per tab as well as sharing identical reads. A busy
    // screen must not fan out unlimited requests or fall back to the database.
    if(pendingFeeds.size>=16)return unavailable();
    const operation=(async():Promise<PublicReadResult>=>{try{
    // Same-origin credentials permit a protected deployment's access cookie.
    // No Supabase session token is attached; the server always uses its public key.
    const response=await fetch(`/api/public-catalog?${query}`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Catalog is temporarily unavailable');
    const data=await response.json();
    if(!Array.isArray(data?.items)||typeof data.has_more!=='boolean')throw Error('Invalid catalog response');
    return {data,error:null};
    }catch{return unavailable();}})();
    pendingFeeds.set(key,operation);
    void operation.finally(()=>pendingFeeds.delete(key)).catch(()=>{});
  }
  // Consumers may prepare cards in place. Do not let one screen mutate another
  // screen's receipt merely because they shared network work.
  // The receipt contains JSON only; avoid requiring a newer clone API on web.
  return JSON.parse(JSON.stringify(await pendingFeeds.get(key)!)) as PublicReadResult;
}
