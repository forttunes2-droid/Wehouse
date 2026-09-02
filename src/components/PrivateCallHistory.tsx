import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type PrivateCallContext, type PrivateCall } from "@/lib/private-calls";

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
  return <details className="my-2 border-y border-white/[.055] py-2 text-[9px]">
    <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-[#8E94A3]"><span>Call history</span><span>{rows.length} {rows.length===1?'call':'calls'} · View</span></summary>
    <div className="mt-2 max-h-36 divide-y divide-white/[.05] overflow-y-auto">{rows.map(row=>{
      const outgoing=row.caller_id===me;
      const ended=row.ended_at?new Date(row.ended_at).getTime():0,answered=row.answered_at?new Date(row.answered_at).getTime():0;
      const duration=ended&&answered?Math.max(0,Math.round((ended-answered)/1000)):0;
      return <div key={row.id} className="flex items-center justify-between gap-3 py-2"><p className="font-medium text-[#B7BBC6]">{outgoing?"Outgoing":"Incoming"} {row.call_type}</p><p className={`shrink-0 capitalize ${row.status==="missed"||row.status==="failed"?"text-red-300":"text-[#696F7F]"}`}>{row.status}{duration?` · ${formatDuration(duration)}`:""}</p></div>
    })}</div>
  </details>
}

function formatDuration(seconds:number){const minutes=Math.floor(seconds/60),rest=seconds%60;return minutes?`${minutes}m ${rest}s`:`${rest}s`}
