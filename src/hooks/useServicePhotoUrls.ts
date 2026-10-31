import {useEffect,useState} from 'react';
import {servicePhotoUrls} from '@/lib/serviceOfferPhotos';

// Request previews in batches, independent of card count. Cache only signed
// references for this mounted/account-scoped view, never private file bytes.
export function useServicePhotoUrls(paths:string[],identity?:string|null){
 const key=JSON.stringify([...new Set(paths)].sort());
 const [urls,setUrls]=useState<Record<string,string>>({}),[attempt,setAttempt]=useState(0),[error,setError]=useState('');
 useEffect(()=>{let active=true;setUrls({});setError('');const selected=JSON.parse(key) as string[];
  void (async()=>{for(let start=0;start<selected.length;start+=24){if(!active)return;const batch=await servicePhotoUrls(selected.slice(start,start+24));if(active)setUrls(previous=>({...previous,...batch}));}})().catch(()=>{if(active)setError('Some service photos could not be loaded. Refresh photos to retry.');});
  return()=>{active=false;};
 },[key,identity,attempt]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')setAttempt(n=>n+1);},240000);const refresh=()=>setAttempt(n=>n+1);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 return {urls,error,retry:()=>setAttempt(n=>n+1)};
}
