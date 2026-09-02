import { useEffect,useState } from 'react';
import { supabase } from '@/lib/supabase';

type Monitor={stats?:Record<string,number>;alerts?:any[];auth_audit_available?:boolean};

export default function StaffSecurityOverviewV2({onOpenCases}:{onOpenCases:()=>void}){
 const[data,setData]=useState<Monitor>({}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let live=true;void(async()=>{const{data:result,error:requestError}=await supabase.rpc('get_my_staff_security_monitor');if(live){setData((result||{}) as Monitor);setError(requestError?.message||'');setLoading(false)}})();return()=>{live=false}},[]);
 const stats=data.stats||{},alerts=data.alerts||[];
 return <div className="space-y-5">
  <section className="rounded-3xl border border-red-500/15 bg-gradient-to-br from-red-500/[.08] via-[#15131A] to-[#0D1118] p-5 sm:p-6 lg:p-8">
   <p className="text-[9px] font-bold uppercase tracking-[.18em] text-red-300">SECURITY OPERATIONS</p>
   <h2 className="mt-3 text-2xl font-bold">Review recorded branch security signals.</h2>
   <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#8990A1]">This workspace shows recorded sign-in patterns, active sessions and restricted accounts in your assigned branch. Security reviews and escalates; it cannot ban users or change Staff access.</p>
   <button onClick={onOpenCases} className="mt-5 rounded-xl bg-red-500 px-4 py-3 text-xs font-semibold">Open security activity</button>
  </section>
  <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Active sessions" value={stats.active_sessions||0}/><Metric label="Multiple-location sessions" value={stats.multi_ip_accounts||0}/><Metric label="Login bursts" value={stats.login_bursts||0}/><Metric label="Restricted accounts" value={stats.restricted_accounts||0}/></section>
  <section><div className="mb-3"><h3 className="text-base font-bold">Signals requiring review</h3><p className="mt-1 text-[10px] text-[#666D7E]">Only recorded activity that crosses a monitoring rule appears here.</p></div>{loading?<Empty text="Loading recorded activity…"/>:error?<Empty text={`Security data could not load: ${error}`}/>:alerts.length===0?<Empty text="No current monitoring rule is triggered in this branch."/>:<div className="space-y-2">{alerts.slice(0,8).map((item,index)=><article key={`${item.kind}-${index}`} className={`rounded-2xl border p-4 ${item.severity==='high'?'border-red-500/20 bg-red-500/[.04]':'border-amber-500/20 bg-amber-500/[.04]'}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">{item.title||'Activity signal'}</p><span className={`rounded-full px-2 py-1 text-[8px] font-semibold uppercase ${item.severity==='high'?'bg-red-500/10 text-red-300':'bg-amber-500/10 text-amber-300'}`}>{item.severity||'review'}</span></div><p className="mt-2 text-[10px] leading-relaxed text-[#818797]">{item.detail}</p></article>)}</div>}</section>
  {!data.auth_audit_available&&<p className="rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-[9px] leading-relaxed text-[#666D7E]">Detailed authentication events are not connected yet. WeHouse does not invent failed-login or password alerts when no source event exists.</p>}
 </div>
}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4"><p className="text-xl font-bold">{value}</p><p className="mt-1 text-[9px] text-[#697080]">{label}</p></div>}
function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center text-[10px] text-[#666D7E]">{text}</div>}
