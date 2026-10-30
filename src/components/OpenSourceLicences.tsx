import {useEffect,useMemo,useState} from 'react';
import AccountShell from '@/components/AccountShell';
import type {Profile} from '@/types';

type Library={name:string;version:string;licence:string;source:string;notices:string;evidence:string};
function receipt(value:unknown):Library[]{
 const data=value as {format?:number;packages?:Library[]}|null;
 if(data?.format!==1||!Array.isArray(data.packages)||data.packages.length>2000||data.packages.some(item=>!item||['name','version','licence','notices','evidence'].some(key=>typeof item[key as keyof Library]!=='string')||item.notices.length>1_000_000||typeof item.source!=='string'||!validSource(item.source)))throw Error('Library notices could not be confirmed.');
 return data.packages;
}
function validSource(value:string){try{const url=new URL(value);return url.origin==='https://registry.npmjs.org'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.endsWith('.tgz');}catch{return false;}}
export default function OpenSourceLicences({profile,onBack}:{profile:Profile;onBack:()=>void}){
 const [libraries,setLibraries]=useState<Library[]>([]),[selected,setSelected]=useState<Library|null>(null),[query,setQuery]=useState(''),[limit,setLimit]=useState(30),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let live=true;
  setLoading(true);setError('');
  void fetch('./third-party-licences.json',{cache:'no-cache',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Library notices could not be loaded.');
   const text=await response.text();if(text.length>8_000_000)throw Error('Library notices exceed the supported document size.');
   const items=receipt(JSON.parse(text));if(live)setLibraries(items);
  }).catch(()=>{if(live)setError('Library notices could not be loaded. Check your connection and retry.');}).finally(()=>{clearTimeout(timer);if(live)setLoading(false);});
  return()=>{live=false;clearTimeout(timer);controller.abort();};
 },[attempt]);
 const filtered=useMemo(()=>{const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);return libraries.filter(item=>words.every(word=>(item.name+' '+item.licence).toLowerCase().includes(word)));},[libraries,query]);
 return <AccountShell profile={profile} title={selected?selected.name:'Open-source licences'} description={selected?selected.version+' · '+selected.licence:'Notices for libraries used by this app.'} onBack={selected?()=>setSelected(null):onBack}>
  {error?<section role="alert" className="space-y-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 text-sm"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4">Retry notices</button></section>:loading?<p role="status" className="text-sm">Loading library notices…</p>:selected?<section className="min-w-0 space-y-5">
   <a href={selected.source} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--wh-accent-text)] underline">Original versioned package and source</a>
   <pre className="whitespace-pre-wrap break-words rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 font-sans text-sm leading-6 text-[var(--wh-text-secondary)] [overflow-wrap:anywhere]">{selected.notices}</pre>
  </section>:<section className="space-y-4">
   <label className="block space-y-2 text-sm"><span>Find a library or licence</span><input type="search" value={query} onChange={event=>{setQuery(event.target.value.slice(0,100));setLimit(30);}} className="min-h-12 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3 text-base"/></label>
   <p role="status" className="text-xs text-[var(--wh-text-secondary)]">{filtered.length} libraries</p>
   <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">{filtered.slice(0,limit).map(item=><button key={item.name+'@'+item.version} type="button" onClick={()=>setSelected(item)} className="flex min-h-20 w-full items-center justify-between gap-3 py-4 text-left"><span className="min-w-0"><span className="block break-words text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs text-[var(--wh-text-secondary)]">{item.version} · {item.licence}</span></span><span aria-hidden="true">›</span></button>)}</div>
   {limit<filtered.length&&<button type="button" onClick={()=>setLimit(value=>value+30)} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm">Show more libraries</button>}
   <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Each library keeps its own licence. These notices do not change ownership of WeHouse or your content.</p>
  </section>}
 </AccountShell>;
}
