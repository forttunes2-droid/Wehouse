import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NIGERIA_STATES, getCitiesForState } from "@/data/nigeria-locations";
import { getServiceCategories } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";

type Rule={
  capacity_id:string;
  state_name:string;
  lga_name:string;
  occupation_name:string;
  target_count:number|null;
  hard_limit:number|null;
  approvals_paused:boolean;
  note?:string|null;
  live_count:number;
  remaining:number|null;
  updated_at:string;
};

export default function WorkerCapacityManager(){
  const{requestElevation}=useCreatorAuth();
  const[rules,setRules]=useState<Rule[]>([]);
  const[occupations,setOccupations]=useState<string[]>([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[state,setState]=useState("");
  const[lga,setLga]=useState("");
  const[occupation,setOccupation]=useState("");
  const[target,setTarget]=useState("");
  const[limit,setLimit]=useState("");
  const[paused,setPaused]=useState(false);
  const[note,setNote]=useState("");
  const[selectedId,setSelectedId]=useState<string|null>(null);

  async function load(){
    setLoading(true);
    const[{data,error},{categories}]=await Promise.all([
      supabase.rpc("creator_get_worker_market_capacity"),
      getServiceCategories(true),
    ]);
    setLoading(false);
    if(error)toast.error(error.message||"Worker capacity could not be loaded");
    setRules(Array.isArray(data)?data.map((row:any)=>({...row,live_count:Number(row.live_count||0),remaining:row.remaining==null?null:Number(row.remaining)})):[]);
    setOccupations((categories||[]).filter((row:any)=>row.is_active!==false).map((row:any)=>String(row.name||"").trim()).filter(Boolean));
  }
  useEffect(()=>{void load()},[]);
  const lgas=useMemo(()=>state?getCitiesForState(state):[],[state]);

  function clear(){
    setSelectedId(null);setState("");setLga("");setOccupation("");setTarget("");setLimit("");setPaused(false);setNote("");
  }
  function edit(rule:Rule){
    setSelectedId(rule.capacity_id);setState(rule.state_name);setLga(rule.lga_name);setOccupation(rule.occupation_name);
    setTarget(rule.target_count==null?"":String(rule.target_count));
    setLimit(rule.hard_limit==null?"":String(rule.hard_limit));
    setPaused(rule.approvals_paused);setNote(rule.note||"");
  }
  function save(){
    if(!state||!lga||!occupation)return toast.error("Choose State, LGA and occupation");
    const targetValue=target.trim()===""?null:Number(target);
    const limitValue=limit.trim()===""?null:Number(limit);
    if(targetValue!=null&&(!Number.isInteger(targetValue)||targetValue<0))return toast.error("Enter a valid target");
    if(limitValue!=null&&(!Number.isInteger(limitValue)||limitValue<0))return toast.error("Enter a valid hard limit");
    if(targetValue!=null&&limitValue!=null&&targetValue>limitValue)return toast.error("Target cannot be above the hard limit");
    requestElevation("staff_authority",(elevationId)=>{
      void(async()=>{
        setBusy(true);
        const{error}=await supabase.rpc("creator_set_worker_market_capacity",{
          p_state:state,p_lga:lga,p_occupation:occupation,
          p_target_count:targetValue,p_hard_limit:limitValue,
          p_approvals_paused:paused,p_note:note.trim()||null,
          p_creator_elevation_id:elevationId,
        });
        setBusy(false);
        if(error)return toast.error(error.message||"Capacity rule could not be saved");
        toast.success("Worker capacity saved");clear();await load();
      })();
    });
  }
  function remove(rule:Rule){
    requestElevation("staff_authority",(elevationId)=>{
      void(async()=>{
        setBusy(true);
        const{error}=await supabase.rpc("creator_remove_worker_market_capacity",{p_capacity_id:rule.capacity_id,p_creator_elevation_id:elevationId});
        setBusy(false);
        if(error)return toast.error(error.message||"Capacity rule could not be removed");
        toast.success("Worker capacity rule removed");if(selectedId===rule.capacity_id)clear();await load();
      })();
    });
  }

  return <section className="border-t border-border pt-5">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-foreground">Worker capacity</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Control how many verified Workers can be public for each LGA and occupation. Signup and onboarding stay open.</p></div>
      {selectedId?<button type="button" onClick={clear} className="min-h-10 text-xs font-semibold text-primary">New rule</button>:null}
    </div>

    <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
      <Field label="State"><select value={state} onChange={e=>{setState(e.target.value);setLga("");}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose State</option>{NIGERIA_STATES.map(row=><option key={row.state} value={row.state}>{row.state}</option>)}</select></Field>
      <Field label="LGA"><select value={lga} disabled={!state} onChange={e=>setLga(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"><option value="">Choose LGA</option>{lgas.map(value=><option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Occupation"><select value={occupation} onChange={e=>setOccupation(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose occupation</option>{occupations.map(value=><option key={value} value={value}>{value}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Target"><input inputMode="numeric" value={target} onChange={e=>setTarget(e.target.value.replace(/\D/g,""))} placeholder="Optional" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field><Field label="Hard limit"><input inputMode="numeric" value={limit} onChange={e=>setLimit(e.target.value.replace(/\D/g,""))} placeholder="Optional" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field></div>
      <Field label="Internal note"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <label className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3"><span><span className="block text-xs font-semibold text-foreground">Pause approvals</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Keep onboarding open but stop new public approvals in this bucket.</span></span><input type="checkbox" checked={paused} onChange={e=>setPaused(e.target.checked)} className="h-4 w-4 accent-primary"/></label>
      <button type="button" disabled={busy||!state||!lga||!occupation} onClick={save} className="min-h-11 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40 sm:col-span-2">{busy?"Saving…":selectedId?"Update capacity":"Add capacity rule"}</button>
    </div>

    <div className="mt-4">
      {loading?<p role="status" className="py-6 text-xs text-muted-foreground">Loading capacity…</p>:!rules.length?<p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No LGA occupation limits yet. Without a rule, verified approval remains uncapped for that market.</p>:<div className="divide-y divide-border border-y border-border">
        {rules.map(rule=><article key={rule.capacity_id} className="flex items-center gap-3 py-3">
          <button type="button" onClick={()=>edit(rule)} className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-foreground">{rule.occupation_name} · {rule.lga_name}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{rule.state_name} · {rule.live_count} live{rule.hard_limit==null?" · no hard limit":` / ${rule.hard_limit} max`}{rule.approvals_paused?" · approvals paused":""}</p>
          </button>
          {rule.hard_limit!=null?<span className="rounded-full border border-border px-2 py-1 text-[9px] text-muted-foreground">{rule.remaining} left</span>:null}
          <button type="button" disabled={busy} onClick={()=>remove(rule)} className="min-h-10 px-2 text-[10px] font-semibold text-destructive disabled:opacity-40">Remove</button>
        </article>)}
      </div>}
    </div>
  </section>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){
  return <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">{label}</span>{children}</label>;
}
