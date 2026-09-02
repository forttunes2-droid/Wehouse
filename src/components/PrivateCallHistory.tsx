import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { launchPrivateCall, type PrivateCallContext, type PrivateCall } from "@/lib/private-calls";

export default function PrivateCallHistory({contextType,contextId}:{contextType:PrivateCallContext;contextId:string}){
  const [rows,setRows]=useState<PrivateCall[]>([]);
  const [me,setMe]=useState("");
  useEffect(()=>{
    let live=true;
    async function load(){
      const [{data:userId},{data}]=await Promise.all([
        supabase.rpc("current_profile_user_id"),
        supabase.from("private_calls").select("*").eq("context_type",contextType).eq("context_id",contextId).order("created_at",{ascending:false}).limit(8),
      ]);
      if(live){setMe(String(userId||""));setRows((data||[]) as PrivateCall[])}
    }
    void load();
    const channel=supabase.channel(`call-history:${contextType}:${contextId}`).on("postgres_changes",{event:"*",schema:"public",table:"private_calls",filter:`context_id=eq.${contextId}`},()=>void load()).subscribe();
    return()=>{live=false;void supabase.removeChannel(channel)};
  },[contextId,contextType]);
  if(!rows.length)return null;
  return <details className="my-3 rounded-2xl border border-white/[.06] bg-white/[.02] px-3 py-2 text-[9px]">
    <summary className="cursor-pointer list-none font-semibold text-[#AEB3C0]">Calls · {rows.length}</summary>
    <div className="mt-2 divide-y divide-white/[.05]">{rows.map(row=>{
      const outgoing=row.caller_id===me;
      const ended=row.ended_at?new Date(row.ended_at).getTime():0,answered=row.answered_at?new Date(row.answered_at).getTime():0;
      const duration=ended&&answered?Math.max(0,Math.round((ended-answered)/1000)):0;
      return <div key={row.id} className="flex items-center justify-between gap-3 py-2.5"><div><p className="font-semibold text-[#C7CBD5]">{outgoing?"Outgoing":"Incoming"} {row.call_type} call</p><p className={`mt-1 capitalize ${row.status==="missed"||row.status==="failed"?"text-red-300":"text-[#696F7F]"}`}>{row.status}{duration?` · ${formatDuration(duration)}`:""} · {new Date(row.created_at).toLocaleString()}</p></div><button type="button" onClick={()=>launchPrivateCall(contextType,contextId,row.call_type)} className="shrink-0 rounded-lg bg-violet-500/10 px-3 py-2 font-semibold text-violet-300">Call again</button></div>
    })}</div>
  </details>
}

function formatDuration(seconds:number){const minutes=Math.floor(seconds/60),rest=seconds%60;return minutes?`${minutes}m ${rest}s`:`${rest}s`}
