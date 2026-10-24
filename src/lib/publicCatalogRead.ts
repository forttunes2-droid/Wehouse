import {publicCatalogQuery,type PublicCatalogKind} from './publicCatalogContract';
import {Capacitor} from '@capacitor/core';

/** Native/local development retain direct RPCs; deployed web uses its same-origin cache. */
export async function publicCatalogRead(kind:PublicCatalogKind,body:Record<string,unknown>,direct:()=>PromiseLike<{data:any;error:any}>){
  const host=typeof window==='undefined'?'':window.location.hostname;
  const deployed=!Capacitor.isNativePlatform()&&typeof window!=='undefined'&&window.location.protocol==='https:'&&
    (['wehouse.com.ng','www.wehouse.com.ng'].includes(host)||host.endsWith('.vercel.app'));
  let query:URLSearchParams;
  try{query=publicCatalogQuery(kind,body);}catch{return direct();}
  if(!deployed)return direct();
  try{
    // Same-origin credentials permit a protected deployment's access cookie.
    // No Supabase session token is attached; the server always uses its public key.
    const response=await fetch(`/api/public-catalog?${query}`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Catalog is temporarily unavailable');
    const data=await response.json();
    if(!Array.isArray(data?.items)||typeof data.has_more!=='boolean')throw Error('Invalid catalog response');
    return {data,error:null};
  }catch{return {data:null,error:{message:'Catalog could not be loaded. Please try again.'}};}
}
