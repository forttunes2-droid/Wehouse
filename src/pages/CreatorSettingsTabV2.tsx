import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import { CREATOR_SETTING_GROUPS, type CreatorSettingsGroupId, type Def } from '@/lib/creatorSettingsSchema';
import { saveCreatorSetting, type DbSetting } from '@/lib/saveCreatorSetting';
import type { Profile } from '@/types';

type Props = { profile?: Profile; groups?: CreatorSettingsGroupId[]; title?: string; description?: string; embedded?: boolean };
export default function CreatorSettingsTabV2({groups,title='Platform settings',description='Product policy and global configuration.',embedded=false}: Props){
 const groupKey=groups?.join('|')||'';
 const visibleGroups=useMemo(()=>{const selected=new Set(groupKey?groupKey.split('|'):[]);return selected.size?CREATOR_SETTING_GROUPS.filter(group=>selected.has(group.id)):CREATOR_SETTING_GROUPS},[groupKey]);
 const defs=useMemo(()=>visibleGroups.flatMap(group=>group.settings),[visibleGroups]);
 const keys=useMemo(()=>defs.map(def=>def.key),[defs]);
 const [rows,setRows]=useState<DbSetting[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
 const savingRef=useRef(false);
 useEffect(()=>{
   let active=true; setLoading(true); setLoadError(''); setDrafts({});
   void (async()=>{try{
     const result=await supabase.from('platform_settings').select('key,value,is_active').in('key',keys);
     if(result.error)throw result.error;
     if(active)setRows((result.data||[]) as DbSetting[]);
   }catch{if(active)setLoadError('Settings could not be loaded. Reload before making changes.');}
   finally{if(active)setLoading(false);}})();
   return()=>{active=false};
 },[keys,reload]);
 function current(def:Def){return drafts[def.key]??rows.find(row=>row.key===def.key&&row.is_active!==false)?.value??def.defaultValue}
 const save=useCallback(async(def:Def,raw:string)=>{
   try{
     const result=await saveCreatorSetting(def,raw);
     setRows(state=>[...state.filter(row=>row.key!==def.key),result.row]);
     setDrafts(state=>{if(state[def.key]!==raw)return state;const next={...state};delete next[def.key];return next});
     invalidateSettingsCache();
     if(result.warning){toast.error(result.warning);return false;}
     toast.success(`${def.label} saved`);return true;
   }catch(error){toast.error(error instanceof Error?error.message:'The change could not be saved. Please try again.');return false;}
 },[]);
 async function saveChanges(selected:Def[]){
   if(savingRef.current||loading||loadError)return;
   savingRef.current=true;setBusy(true);
   try{for(const def of selected){if(!await save(def,current(def)))break;}}
   finally{savingRef.current=false;setBusy(false);}
 }
 if(loading)return <Loading/>;
 if(loadError)return <div role="alert" className="space-y-3"><p className="text-sm text-red-200">{loadError}</p><button type="button" onClick={()=>setReload(value=>value+1)} className="min-h-11 text-sm font-semibold text-violet-300">Reload settings</button></div>;
 const changed=defs.filter(def=>drafts[def.key]!==undefined);
 return <section className="space-y-5">
  {(!embedded||changed.length>0)&&<div className="flex flex-wrap items-center justify-between gap-3">
   {!embedded&&<div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-[#AAA3B3]">{description}</p></div>}
   {changed.length>0&&<button type="button" onClick={()=>void saveChanges(changed)} disabled={busy} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold disabled:opacity-40">{busy?'Saving…':`Save changes (${changed.length})`}</button>}
  </div>}
  <fieldset disabled={busy} className="min-w-0 space-y-6">
   {visibleGroups.map(group=><section key={group.id} className="space-y-4">
    {(!embedded||visibleGroups.length>1)&&<div><h3 className="text-sm font-semibold">{group.label}</h3><p className="mt-1 text-sm leading-6 text-[#AAA3B3]">{group.description}</p></div>}
    {group.note&&<p className="max-w-3xl text-sm leading-6 text-[#AAA3B3]">{group.note}</p>}
    <div className="grid gap-4 xl:grid-cols-2">{group.settings.map(def=><Setting key={def.key} def={def} value={current(def)} dirty={drafts[def.key]!==undefined} busy={busy} setValue={value=>setDrafts(state=>({...state,[def.key]:value}))} save={()=>void saveChanges([def])}/>)}</div>
   </section>)}
  </fieldset>
 </section>;
}

function Setting({def,value,dirty,busy,setValue,save}:{def:Def;value:string;dirty:boolean;busy?:boolean;setValue:(value:string)=>void;save:()=>void}){if(def.kind==='toggle'){const enabled=['true','1','yes','on'].includes(String(value).toLowerCase());return <div className="rounded-xl border border-white/[.05] bg-[#15121B] p-3"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-xs leading-relaxed text-[#AAA3B3]">{def.description}</p></div><button type="button" aria-label={def.label} aria-pressed={enabled} onClick={()=>setValue(enabled?'false':'true')} className={`relative mt-1 h-6 w-11 shrink-0 rounded-full ${enabled?'bg-violet-500':'bg-white/[.1]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${enabled?'left-6':'left-1'}`}/></button></div>{dirty&&<button type="button" onClick={save} disabled={busy} className="mt-3 h-9 rounded-xl bg-violet-500 px-3 text-xs font-semibold disabled:opacity-40">{busy?'Saving…':'Save'}</button>}</div>}
 if(def.kind==='textarea')return <div className="rounded-xl border border-white/[.05] bg-[#15121B] p-3"><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-xs text-[#AAA3B3]">{def.description}</p><textarea aria-label={def.label} rows={9} value={value} onChange={event=>setValue(event.target.value)} className="mt-3 w-full resize-y rounded-xl border border-white/[.08] bg-[#1B1722] p-3 text-base leading-7 outline-none focus:border-violet-500/40"/>{dirty&&<button onClick={save} disabled={busy} className="mt-2 h-10 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">{busy?'Publishing…':`Publish ${def.label}`}</button>}</div>;
 return <label className="block rounded-xl border border-white/[.05] bg-[#15121B] p-3"><span className="text-xs font-semibold">{def.label}</span><span className="mt-1 block text-xs leading-relaxed text-[#AAA3B3]">{def.description}</span><div className="mt-3 flex gap-2"><input type={def.kind==='number'?'number':def.kind==='email'?'email':'text'} min={def.min} max={def.max} step={def.step} value={value} onChange={event=>setValue(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#1B1722] px-3 text-base outline-none focus:border-violet-500/40"/>{dirty&&<button type="button" onClick={save} disabled={busy} className="h-11 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">{busy?'Saving…':'Save'}</button>}</div></label>}
function Loading(){return <p role="status" className="py-8 text-sm text-[#AAA3B3]">Loading settings…</p>}
