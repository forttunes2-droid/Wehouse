import { useEffect,useMemo,useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type ChangeRow={
  event_id:string;
  actor_name:string;
  actor_role:string;
  action_label:string;
  area_label:string;
  subject_label:string;
  occurred_at:string;
};

export default function CreatorAuditWorkspace(){
 const[rows,setRows]=useState<ChangeRow[]>([]),[loading,setLoading]=useState(true),[search,setSearch]=useState('');
 async function load(query=search){
  setLoading(true);
  const{data,error}=await supabase.rpc('creator_get_change_history',{p_search:query.trim()||null,p_limit:180});
  if(error){toast.error(error.message||'Unable to load change history');setRows([])}else setRows((data||[]) as ChangeRow[]);
  setLoading(false);
 }
 useEffect(()=>{void load('')},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>void load(search),260);return()=>window.clearTimeout(timer)},[search]);
 const grouped=useMemo(()=>groupByDay(rows),[rows]);
 return <div className="space-y-5">
  <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#11141D] to-[#0D1017] p-5 sm:p-6">
   <p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">CHANGE HISTORY</p>
   <h2 className="mt-2 text-xl font-bold">Platform actions that matter</h2>
   <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#747A8B]">A clean record of management changes across WeHouse. Internal payloads, secret values, database identifiers and security implementation details stay private on the server.</p>
  </section>
  <div className="flex gap-2"><div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#626879]">⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people, settings or operations" className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#12161E] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"/></div><button onClick={()=>void load()} className="h-11 shrink-0 rounded-2xl border border-white/[.08] bg-white/[.025] px-4 text-[10px] font-semibold text-[#B1B5C1]">Refresh</button></div>
  {loading?<Loading/>:rows.length===0?<Empty/>:<div className="space-y-5">{grouped.map(group=><section key={group.label}><p className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[.12em] text-[#5D6373]">{group.label}</p><div className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B] divide-y divide-white/[.05]">{group.rows.map(row=><ChangeItem key={row.event_id} row={row}/>)}</div></section>)}</div>}
 </div>
}

function ChangeItem({row}:{row:ChangeRow}){return <article className="flex items-start gap-3 px-4 py-3.5 sm:px-5"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-[11px] font-bold text-violet-300">{icon(row.area_label)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 text-[12px] font-semibold"><span className="text-white">{row.action_label}</span> <span className="text-[#C0C4CE]">{row.subject_label}</span></p><span className="shrink-0 text-[8px] text-[#555C6D]">{time(row.occurred_at)}</span></div><div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px]"><span className="rounded-full bg-white/[.035] px-2 py-1 text-[#73798A]">{row.area_label}</span><span className="text-[#5F6575]">by</span><span className="font-medium text-[#9298A8]">{row.actor_name}</span>{row.actor_role&&row.actor_role!=='system'&&<span className="capitalize text-[#5F6575]">· {row.actor_role}</span>}</div></div></article>}
function groupByDay(rows:ChangeRow[]){const map=new Map<string,ChangeRow[]>();for(const row of rows){const d=new Date(row.occurred_at),now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);const label=d.toDateString()===now.toDateString()?'Today':d.toDateString()===yesterday.toDateString()?'Yesterday':d.toLocaleDateString([],{month:'short',day:'numeric',year:d.getFullYear()===now.getFullYear()?undefined:'numeric'});map.set(label,[...(map.get(label)||[]),row])}return Array.from(map,([label,groupRows])=>({label,rows:groupRows}))}
function icon(area:string){const a=area.toLowerCase();if(a.includes('setting'))return'⚙';if(a.includes('team')||a.includes('account'))return'◉';if(a.includes('worker'))return'W';if(a.includes('propert'))return'⌂';if(a.includes('finance'))return'₦';if(a.includes('moderation'))return'!';return'W'}
function time(value:string){return new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function Loading(){return <div className="grid min-h-52 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
function Empty(){return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-14 text-center"><p className="text-sm font-semibold">No matching changes</p><p className="mt-2 text-[10px] text-[#666C7D]">Try another search or refresh the history.</p></div>}
