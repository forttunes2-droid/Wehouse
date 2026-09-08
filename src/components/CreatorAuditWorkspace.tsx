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
 const[rows,setRows]=useState<ChangeRow[]>([]),[loading,setLoading]=useState(true),[search,setSearch]=useState(''),[area,setArea]=useState('All');
 async function load(query=search){
  setLoading(true);
  const{data,error}=await supabase.rpc('creator_get_change_history',{p_search:query.trim()||null,p_limit:180});
  if(error){toast.error(error.message||'Unable to load change history');setRows([])}else setRows((data||[]) as ChangeRow[]);
  setLoading(false);
 }
 useEffect(()=>{void load('')},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>void load(search),260);return()=>window.clearTimeout(timer)},[search]);
 const areas=useMemo(()=>['All',...Array.from(new Set(rows.map(row=>row.area_label))).sort()],[rows]);
 const visible=useMemo(()=>area==='All'?rows:rows.filter(row=>row.area_label===area),[area,rows]);
 const grouped=useMemo(()=>groupByDay(visible),[visible]);
 return <div className="space-y-4">
  <header className="border-b border-white/[.07] pb-4">
   <p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">ACCOUNTABILITY</p>
   <h2 className="mt-1 text-lg font-bold">Change history</h2>
   <p className="mt-1 text-[10px] text-[#747A8B]">Who changed what, where and when.</p>
  </header>
  <div className="flex gap-2"><div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#626879]">⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people, settings or operations" className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#12161E] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"/></div><button onClick={()=>void load()} className="h-11 shrink-0 rounded-2xl border border-white/[.08] bg-white/[.025] px-4 text-[10px] font-semibold text-[#B1B5C1]">Refresh</button></div>
  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{areas.map(value=><button key={value} onClick={()=>setArea(value)} className={`shrink-0 rounded-full px-3 py-2 text-[9px] font-semibold ${area===value?'bg-violet-500 text-white':'border border-white/[.07] text-[#858B9A]'}`}>{value}</button>)}</div>
  {loading?<Loading/>:visible.length===0?<Empty/>:<div className="space-y-5">{grouped.map(group=><section key={group.label}><p className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[.12em] text-[#5D6373]">{group.label}</p><div className="divide-y divide-white/[.05] border-y border-white/[.06]">{group.rows.map(row=><ChangeItem key={row.event_id} row={row}/>)}</div></section>)}</div>}
 </div>
}

function ChangeItem({row}:{row:ChangeRow}){return <article className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 py-3.5"><div className="grid h-9 w-9 place-items-center rounded-full bg-violet-500/10 text-[10px] font-bold text-violet-300">{icon(row.area_label)}</div><div className="min-w-0"><p className="text-[12px] font-semibold"><span className="text-white">{row.action_label}</span> <span className="text-[#C0C4CE]">{row.subject_label}</span></p><p className="mt-1 text-[9px] text-[#6E7484]">{row.area_label} · {row.actor_name}{row.actor_role&&row.actor_role!=='system'?` · ${row.actor_role}`:''}</p></div><span className="pt-1 text-[8px] text-[#555C6D]">{time(row.occurred_at)}</span></article>}
function groupByDay(rows:ChangeRow[]){const map=new Map<string,ChangeRow[]>();for(const row of rows){const d=new Date(row.occurred_at),now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);const label=d.toDateString()===now.toDateString()?'Today':d.toDateString()===yesterday.toDateString()?'Yesterday':d.toLocaleDateString([],{month:'short',day:'numeric',year:d.getFullYear()===now.getFullYear()?undefined:'numeric'});map.set(label,[...(map.get(label)||[]),row])}return Array.from(map,([label,groupRows])=>({label,rows:groupRows}))}
function icon(area:string){const a=area.toLowerCase();if(a.includes('setting'))return'⚙';if(a.includes('team')||a.includes('account'))return'◉';if(a.includes('worker'))return'W';if(a.includes('propert'))return'⌂';if(a.includes('finance'))return'₦';if(a.includes('moderation'))return'!';return'W'}
function time(value:string){return new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function Loading(){return <div className="grid min-h-52 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
function Empty(){return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-14 text-center"><p className="text-sm font-semibold">No matching changes</p><p className="mt-2 text-[10px] text-[#666C7D]">Try another search or refresh the history.</p></div>}
