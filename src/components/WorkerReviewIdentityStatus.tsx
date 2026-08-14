import { useEffect,useState } from 'react';
import { supabase } from '@/lib/supabase';

type IdentityState={identity_status?:string;identity_provider?:string|null;identity_checked_at?:string|null;identity_failure_reason?:string|null};

export default function WorkerReviewIdentityStatus({workerId}:{workerId:string}){
 const[data,setData]=useState<IdentityState|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);void supabase.rpc('admin_get_worker_review_identity_status',{p_worker_id:workerId}).then(({data,error})=>{if(!active)return;setData(error?null:(data||null) as IdentityState|null);setLoading(false)});return()=>{active=false}},[workerId]);
 const status=String(data?.identity_status||'not_started');
 const good=status==='verified',bad=status==='failed'||status==='needs_retry';
 return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3">
  <p className="text-[9px] font-semibold uppercase tracking-wide text-[#666D7E]">External government identity</p>
  {loading?<p className="mt-2 text-[10px] text-[#666D7E]">Checking identity status…</p>:<>
   <div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[8px] font-semibold uppercase ${good?'bg-emerald-500/10 text-emerald-300':bad?'bg-red-500/10 text-red-300':'bg-amber-500/10 text-amber-300'}`}>{status.replace(/_/g,' ')}</span>{data?.identity_provider&&<span className="rounded-full border border-white/[.07] px-2 py-1 text-[8px] text-[#8A8F9E]">{data.identity_provider}</span>}</div>
   <p className="mt-2 text-[10px] leading-relaxed text-[#73798A]">The external identity provider verifies government identity. Raw government ID is not shown in this WeHouse review workspace.</p>
   {data?.identity_failure_reason&&<p className="mt-2 text-[10px] text-amber-300">{data.identity_failure_reason}</p>}
  </>}
 </div>
}
