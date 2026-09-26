import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NIGERIA_STATES, getCitiesForState } from "@/data/nigeria-locations";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";

type ResourceType="worker"|"property"|"hotel";
type ScopeType="global"|"lga";
type Rule={
  rule_id:string;
  resource_type:ResourceType;
  scope_type:ScopeType;
  state_name?:string|null;
  lga_name?:string|null;
  enabled:boolean;
  slot_count:number;
  daily_price_ngn:number|string;
  allowed_durations:number[];
};

const resourceLabels:Record<ResourceType,string>={worker:"Service Workers",property:"Homes",hotel:"Hotels"};

export default function SponsoredMarketRules(){
  const{requestElevation}=useCreatorAuth();
  const[rules,setRules]=useState<Rule[]>([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[resourceType,setResourceType]=useState<ResourceType>("worker");
  const[scopeType,setScopeType]=useState<ScopeType>("global");
  const[state,setState]=useState("");
  const[lga,setLga]=useState("");
  const[enabled,setEnabled]=useState(false);
  const[slots,setSlots]=useState("3");
  const[price,setPrice]=useState("");
  const[durations,setDurations]=useState("7,14,30");

  const lgas=useMemo(()=>state?getCitiesForState(state):[],[state]);

  async function load(){
    setLoading(true);
    const{data,error}=await supabase.rpc("creator_get_sponsored_market_rules");
    setLoading(false);
    if(error)return toast.error(error.message||"Sponsored controls could not be loaded");
    setRules(Array.isArray(data)?data.map((row:any)=>({
      ...row,
      slot_count:Number(row.slot_count||0),
      allowed_durations:Array.isArray(row.allowed_durations)?row.allowed_durations.map(Number):[],
    })):[]);
  }
  useEffect(()=>{void load()},[]);

  function edit(rule:Rule){
    setResourceType(rule.resource_type);setScopeType(rule.scope_type);
    setState(rule.state_name||"");setLga(rule.lga_name||"");
    setEnabled(Boolean(rule.enabled));setSlots(String(rule.slot_count));
    setPrice(String(rule.daily_price_ngn??""));
    setDurations((rule.allowed_durations||[]).join(","));
  }

  function save(){
    if(scopeType==="lga"&&(!state||!lga))return toast.error("Choose State and LGA");
    const slotCount=Number(slots);
    const dailyPrice=Number(price);
    const durationValues=[...new Set(durations.split(",").map(value=>Number(value.trim())).filter(value=>Number.isInteger(value)&&value>=1&&value<=90))].sort((a,b)=>a-b);
    if(!Number.isInteger(slotCount)||slotCount<0||slotCount>12)return toast.error("Slots must be between 0 and 12");
    if(!Number.isFinite(dailyPrice)||dailyPrice<0)return toast.error("Enter a valid daily price");
    if(!durationValues.length)return toast.error("Add at least one duration between 1 and 90 days");
    requestElevation("policy_publish",(elevationId)=>{
      void(async()=>{
        setBusy(true);
        const{error}=await supabase.rpc("creator_set_sponsored_market_rule",{
          p_resource_type:resourceType,p_scope_type:scopeType,
          p_state:scopeType==="lga"?state:null,p_lga:scopeType==="lga"?lga:null,
          p_enabled:enabled,p_slot_count:slotCount,p_daily_price_ngn:dailyPrice,
          p_allowed_durations:durationValues,p_creator_elevation_id:elevationId,
        });
        setBusy(false);
        if(error)return toast.error(error.message||"Sponsored rule could not be saved");
        toast.success("Sponsored market rule saved");await load();
      })();
    });
  }

  return <section>
    <div><h3 className="text-sm font-semibold text-foreground">Sponsored marketplace</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Paid visibility rules shared by Workers, Homes and Hotels. Sponsored never changes verification, reviews, trust or organic ranking.</p></div>

    <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
      <Field label="What can be promoted"><select value={resourceType} onChange={e=>setResourceType(e.target.value as ResourceType)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground">{(Object.keys(resourceLabels) as ResourceType[]).map(value=><option key={value} value={value}>{resourceLabels[value]}</option>)}</select></Field>
      <Field label="Market scope"><select value={scopeType} onChange={e=>{setScopeType(e.target.value as ScopeType);setState("");setLga("");}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="global">Global default</option><option value="lga">Specific LGA</option></select></Field>
      {scopeType==="lga"?<>
        <Field label="State"><select value={state} onChange={e=>{setState(e.target.value);setLga("");}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose State</option>{NIGERIA_STATES.map(row=><option key={row.state} value={row.state}>{row.state}</option>)}</select></Field>
        <Field label="LGA"><select value={lga} disabled={!state} onChange={e=>setLga(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"><option value="">Choose LGA</option>{lgas.map(value=><option key={value} value={value}>{value}</option>)}</select></Field>
      </>:null}
      <Field label="Sponsored slots"><input inputMode="numeric" value={slots} onChange={e=>setSlots(e.target.value.replace(/\D/g,""))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <Field label="Daily price (₦)"><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value.replace(/[^0-9.]/g,""))} placeholder="0" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <Field label="Durations (days)"><input value={durations} onChange={e=>setDurations(e.target.value)} placeholder="7,14,30" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <label className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3"><span><span className="block text-xs font-semibold text-foreground">Open Sponsored campaigns</span><span className="mt-0.5 block text-[10px] text-muted-foreground">This rule only opens eligibility; campaigns still require verified payment activation.</span></span><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} className="h-4 w-4 accent-primary"/></label>
      <button type="button" disabled={busy||(scopeType==="lga"&&(!state||!lga))} onClick={save} className="min-h-11 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40 sm:col-span-2">{busy?"Saving…":"Save Sponsored rule"}</button>
    </div>

    <div className="mt-4">
      {loading?<p role="status" className="py-6 text-xs text-muted-foreground">Loading Sponsored controls…</p>:!rules.length?<p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No Sponsored markets configured. Sponsored stays off.</p>:<div className="divide-y divide-border border-y border-border">
        {rules.map(rule=><button key={rule.rule_id} type="button" onClick={()=>edit(rule)} className="flex w-full items-center gap-3 py-3 text-left">
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-foreground">{resourceLabels[rule.resource_type]} · {rule.scope_type==="global"?"Global":rule.lga_name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{rule.slot_count} slots · ₦{Number(rule.daily_price_ngn||0).toLocaleString("en-NG")}/day · {(rule.allowed_durations||[]).join(", ")} days</span></span>
          <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${rule.enabled?"border-emerald-500/20 text-emerald-600 dark:text-emerald-300":"border-border text-muted-foreground"}`}>{rule.enabled?"Open":"Off"}</span>
        </button>)}
      </div>}
    </div>

    <p className="mt-4 text-[10px] leading-5 text-muted-foreground">Campaign checkout/activation is intentionally not enabled by this control alone. A draft campaign has no discovery effect until WeHouse verifies its advertising payment.</p>
  </section>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){
  return <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">{label}</span>{children}</label>;
}
