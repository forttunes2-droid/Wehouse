import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import type { Profile } from '@/types';

type Kind='text'|'email'|'number'|'toggle'|'textarea';
type Def={key:string;label:string;description:string;kind:Kind;defaultValue:string;min?:number;max?:number;step?:number;category?:string};
type DbSetting={key:string;value:string;is_active:boolean};
type Group={id:string;label:string;description:string;note?:string;settings:Def[]};

const GROUPS:Group[]=[
 {id:'identity',label:'Platform identity',description:'Public WeHouse contact information.',settings:[
  {key:'company_name',label:'Company name',description:'Name shown across the platform.',kind:'text',defaultValue:'WeHouse'},
  {key:'support_email',label:'Support email',description:'Primary public support email.',kind:'email',defaultValue:''},
  {key:'support_phone',label:'Support phone',description:'Primary public support phone number.',kind:'text',defaultValue:''},
 ]},
 {id:'worker_verification',label:'Worker verification',description:'Creator-controlled commercial settings for Worker onboarding.',note:'The private automatic face check is a fixed WeHouse safety requirement: clear live selfie → same-face comparison → automatic head movement/liveness check. No government ID and no liveness video. Payment is only an onboarding fee and never buys approval or trust.',settings:[
  {key:'worker_verification_fee',label:'Onboarding fee (₦)',description:'Amount Paystack charges when a Worker reaches the payment step. Set 0 to temporarily disable new verification payments.',kind:'number',defaultValue:'0',min:0,max:10000000,step:1,category:'worker'},
 ]},
 {id:'worker_trust',label:'WeHouse Trusted',description:'Marketplace trust is earned from real WeHouse performance after professional approval.',note:'A Worker is first WeHouse Reviewed. WeHouse Trusted is earned later from completed jobs, rating, Worker-caused cancellations and unresolved disputes.',settings:[
  {key:'worker_trust_enabled',label:'Enable WeHouse Trusted',description:'Turn on automatic earned marketplace trust only after Worker-booking reputation data is ready.',kind:'toggle',defaultValue:'false',category:'worker_trust'},
  {key:'worker_trusted_min_completed_jobs',label:'Minimum completed WeHouse jobs',description:'Completed Worker bookings required before Trusted can be earned.',kind:'number',defaultValue:'5',min:0,max:10000,step:1,category:'worker_trust'},
  {key:'worker_trusted_min_rating',label:'Minimum rating',description:'Minimum marketplace rating required for Trusted.',kind:'number',defaultValue:'4.5',min:0,max:5,step:0.1,category:'worker_trust'},
  {key:'worker_trusted_max_cancel_rate',label:'Maximum Worker cancellation rate (%)',description:'Maximum percentage of terminal jobs cancelled by the Worker while retaining Trusted.',kind:'number',defaultValue:'20',min:0,max:100,step:1,category:'worker_trust'},
  {key:'worker_trusted_block_open_disputes',label:'Block Trusted with unresolved disputes',description:'Require a clean Worker-booking dispute record before Trusted is shown.',kind:'toggle',defaultValue:'true',category:'worker_trust'},
 ]},
 {id:'access',label:'Platform access',description:'High-level access switches.',settings:[
  {key:'maintenance_mode',label:'Maintenance mode',description:'Temporarily block normal platform access.',kind:'toggle',defaultValue:'false'},
  {key:'registration_open',label:'Registration open',description:'Allow new accounts to register.',kind:'toggle',defaultValue:'true'},
 ]},
 {id:'legal',label:'Legal documents',description:'Current Privacy Policy and Terms & Conditions shown to users.',settings:[
  {key:'privacy_policy',label:'Privacy Policy',description:'Published WeHouse Privacy Policy.',kind:'textarea',defaultValue:''},
  {key:'terms_of_service',label:'Terms & Conditions',description:'Published WeHouse Terms & Conditions.',kind:'textarea',defaultValue:''},
 ]},
];

export default function CreatorSettingsTabV2({profile}:{profile?:Profile}){
 void profile;
 const defs=useMemo(()=>GROUPS.flatMap(group=>group.settings),[]),keys=useMemo(()=>defs.map(def=>def.key),[defs]);
 const[rows,setRows]=useState<DbSetting[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({}),[saving,setSaving]=useState<Record<string,boolean>>({}),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;void(async()=>{const settingsResult=await supabase.from('platform_settings').select('key,value,is_active').in('key',keys);if(!active)return;if(settingsResult.error)toast.error(settingsResult.error.message);else setRows((settingsResult.data||[]) as DbSetting[]);setLoading(false)})();return()=>{active=false}},[keys]);
 function stored(def:Def){return rows.find(row=>row.key===def.key&&row.is_active!==false)?.value??def.defaultValue}
 function current(def:Def){return drafts[def.key]!==undefined?drafts[def.key]:stored(def)}
 function normalize(def:Def,raw:string){if(def.kind!=='number')return raw;const cleaned=raw.trim().replace(/,/g,'');if(!/^\d+(\.\d+)?$/.test(cleaned))return null;const value=Number(cleaned);if(!Number.isFinite(value)||(def.min!==undefined&&value<def.min)||(def.max!==undefined&&value>def.max)||((def.step??1)>=1&&!Number.isInteger(value)))return null;return String(value)}
 async function save(def:Def,raw:string){const value=normalize(def,raw);if(value===null){toast.error(`${def.label} has an invalid value`);return false}setSaving(state=>({...state,[def.key]:true}));const{data:existing,error:readError}=await supabase.from('platform_settings').select('key').eq('key',def.key).maybeSingle();if(readError){setSaving(state=>({...state,[def.key]:false}));toast.error(readError.message);return false}const payload={value,category:def.category||'platform',label:def.label,description:def.description,data_type:def.kind==='toggle'?'boolean':def.kind==='number'?'number':'text',editable:true,is_active:true,updated_at:new Date().toISOString()};const result=existing?await supabase.from('platform_settings').update(payload).eq('key',def.key):await supabase.from('platform_settings').insert({key:def.key,...payload});setSaving(state=>({...state,[def.key]:false}));if(result.error){toast.error(result.error.message);return false}const{data:verified,error:verifyError}=await supabase.from('platform_settings').select('key,value,is_active').eq('key',def.key).maybeSingle();if(verifyError||!verified||String(verified.value)!==String(value)){toast.error(`${def.label} could not be verified after saving`);return false}setRows(state=>[...state.filter(row=>row.key!==def.key),verified as DbSetting]);setDrafts(state=>{const next={...state};delete next[def.key];return next});invalidateSettingsCache();toast.success(def.kind==='textarea'?`${def.label} published`:`${def.label} saved`);return true}
 async function saveAll(){for(const def of defs.filter(def=>drafts[def.key]!==undefined))await save(def,drafts[def.key])}
 if(loading)return <Loading/>;const changed=Object.keys(drafts).length;
 return <section className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-base font-bold">Platform settings</h2><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#686C7E]">Product policy and global configuration. Operational queues stay out of Settings.</p></div>{changed>0&&<button onClick={()=>void saveAll()} disabled={Object.values(saving).some(Boolean)} className="min-h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">Save changes ({changed})</button>}</div>
 <div className="grid gap-4 xl:grid-cols-2">{GROUPS.map(group=><section key={group.id} className={`${group.id==='legal'?'xl:col-span-2':''} rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5`}><div className="mb-4"><h3 className="text-sm font-semibold">{group.label}</h3><p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{group.description}</p>{group.note&&<p className="mt-3 rounded-xl border border-violet-500/10 bg-violet-500/[.035] p-3 text-[9px] leading-relaxed text-violet-100/70">{group.note}</p>}</div><div className="space-y-3">{group.settings.map(def=><Setting key={def.key} def={def} value={current(def)} dirty={drafts[def.key]!==undefined} busy={saving[def.key]} setValue={value=>setDrafts(state=>({...state,[def.key]:value}))} save={()=>void save(def,current(def))}/>)}</div></section>)}</div></section>
}

function Setting({def,value,dirty,busy,setValue,save}:{def:Def;value:string;dirty:boolean;busy?:boolean;setValue:(value:string)=>void;save:()=>void}){if(def.kind==='toggle'){const enabled=['true','1','yes','on'].includes(String(value).toLowerCase());return <div className="rounded-xl border border-white/[.05] bg-[#0D1017] p-3"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-[9px] leading-relaxed text-[#666A7C]">{def.description}</p></div><button onClick={()=>setValue(enabled?'false':'true')} className={`relative mt-1 h-6 w-11 shrink-0 rounded-full ${enabled?'bg-violet-500':'bg-white/[.1]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${enabled?'left-6':'left-1'}`}/></button></div>{dirty&&<button onClick={save} disabled={busy} className="mt-3 h-9 rounded-xl bg-violet-500 px-3 text-[9px] font-semibold disabled:opacity-40">{busy?'Saving…':'Save'}</button>}</div>}
 if(def.kind==='textarea')return <div className="rounded-xl border border-white/[.05] bg-[#0D1017] p-3"><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-[9px] text-[#666A7C]">{def.description}</p><textarea rows={9} value={value} onChange={event=>setValue(event.target.value)} className="mt-3 w-full resize-y rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-xs leading-5 outline-none focus:border-violet-500/40"/>{dirty&&<button onClick={save} disabled={busy} className="mt-2 h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">{busy?'Publishing…':`Publish ${def.label}`}</button>}</div>;
 return <label className="block rounded-xl border border-white/[.05] bg-[#0D1017] p-3"><span className="text-xs font-semibold">{def.label}</span><span className="mt-1 block text-[9px] leading-relaxed text-[#666A7C]">{def.description}</span><div className="mt-3 flex gap-2"><input type={def.kind==='number'?'number':def.kind==='email'?'email':'text'} min={def.min} max={def.max} step={def.step} value={value} onChange={event=>setValue(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40"/>{dirty&&<button type="button" onClick={save} disabled={busy} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">{busy?'Saving…':'Save'}</button>}</div></label>}
function Loading(){return <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
