import WeHouseChoice from "@/components/WeHouseChoice";
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
type Campaign={ campaign_id:string; resource_type:ResourceType; status:string;
  amount_ngn:number; starts_at:string|null; ends_at:string|null;
  payment_reference:string|null; impressions:number; opens:number };
type StoreProduct={rule_id:string;duration_days:number;platform:"apple"|"google";
  product_id:string;price_ngn:number;enabled:boolean};

const resourceLabels:Record<ResourceType,string>={worker:"Service Workers",property:"Homes",hotel:"Hotels"};

export default function SponsoredMarketRules(){
  const{requestElevation}=useCreatorAuth();
  const[rules,setRules]=useState<Rule[]>([]);
  const[campaigns,setCampaigns]=useState<Campaign[]>([]);
  const[storeProducts,setStoreProducts]=useState<StoreProduct[]>([]);
  const[selectedRule,setSelectedRule]=useState("");
  const[storePlatform,setStorePlatform]=useState<"apple"|"google">("apple");
  const[storeDuration,setStoreDuration]=useState(7);
  const[storeProductId,setStoreProductId]=useState("");
  const[storeEnabled,setStoreEnabled]=useState(false);
  const[pauseReason,setPauseReason]=useState("");
  const[pauseTarget,setPauseTarget]=useState("");
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
    const[{data,error},activity,products]=await Promise.all([
      supabase.rpc("creator_get_sponsored_market_rules"),
      supabase.rpc("creator_get_sponsored_campaigns"),
      supabase.rpc("creator_get_sponsored_store_products"),
    ]);
    setLoading(false);
    if(error)return toast.error(error.message||"Sponsored controls could not be loaded");
    setRules(Array.isArray(data)?data.map((row:any)=>({
      ...row,
      slot_count:Number(row.slot_count||0),
      allowed_durations:Array.isArray(row.allowed_durations)?row.allowed_durations.map(Number):[],
    })):[]);
    if(!activity.error)setCampaigns((activity.data||[]) as Campaign[]);
    if(!products.error)setStoreProducts((products.data||[]) as StoreProduct[]);
  }
  useEffect(()=>{void load()},[]);

  function edit(rule:Rule){
    setSelectedRule(rule.rule_id);
    setResourceType(rule.resource_type);setScopeType(rule.scope_type);
    setState(rule.state_name||"");setLga(rule.lga_name||"");
    setEnabled(Boolean(rule.enabled));setSlots(String(rule.slot_count));
    setPrice(String(rule.daily_price_ngn??""));
    setDurations((rule.allowed_durations||[]).join(","));
    setStoreDuration(rule.allowed_durations?.[0]||7);
  }

  function saveStoreProduct(){
    const rule=rules.find(item=>item.rule_id===selectedRule);
    if(!rule||!rule.allowed_durations.includes(storeDuration))return toast.error("Choose a saved rule and duration");
    if(!/^[A-Za-z0-9_.-]{3,180}$/.test(storeProductId))return toast.error("Enter a valid store product ID");
    requestElevation("policy_publish",elevationId=>{
      void(async()=>{
        setBusy(true);
        const{error}=await supabase.rpc("creator_set_sponsored_store_product",{
          p_rule_id:rule.rule_id,p_duration_days:storeDuration,p_platform:storePlatform,
          p_product_id:storeProductId,p_price_ngn:Number(rule.daily_price_ngn)*storeDuration,
          p_enabled:storeEnabled,p_creator_elevation_id:elevationId,
        });
        setBusy(false);
        if(error)return toast.error(error.message||"Store product could not be saved");
        toast.success("Store product saved");await load();
      })();
    });
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

  function pause(campaignId:string){
    if(pauseReason.trim().length<10)return toast.error("Enter at least 10 characters for the pause reason");
    requestElevation("policy_publish",elevationId=>{
      void(async()=>{
        setBusy(true);
        const{error}=await supabase.rpc("creator_pause_sponsored_campaign",{
          p_campaign_id:campaignId,p_reason:pauseReason.trim(),p_creator_elevation_id:elevationId,
        });
        setBusy(false);
        if(error)return toast.error(error.message||"Campaign could not be paused");
        setPauseReason("");setPauseTarget("");toast.success("Sponsored placement paused");await load();
      })();
    });
  }

  return <section>
    <div><h3 className="text-sm font-semibold text-foreground">Sponsored marketplace</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Paid visibility rules shared by Workers, Homes and Hotels. Sponsored never changes verification, reviews, trust or organic ranking.</p></div>

    <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
      <Field label="What can be promoted"><WeHouseChoice aria-label="What can be promoted" value={resourceType} onChange={e=>setResourceType(e.target.value as ResourceType)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground">{(Object.keys(resourceLabels) as ResourceType[]).map(value=><option key={value} value={value}>{resourceLabels[value]}</option>)}</WeHouseChoice></Field>
      <Field label="Market scope"><WeHouseChoice aria-label="Market scope" value={scopeType} onChange={e=>{setScopeType(e.target.value as ScopeType);setState("");setLga("");}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="global">Global default</option><option value="lga">Specific LGA</option></WeHouseChoice></Field>
      {scopeType==="lga"?<>
        <Field label="State"><WeHouseChoice aria-label="State" value={state} onChange={e=>{setState(e.target.value);setLga("");}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose State</option>{NIGERIA_STATES.map(row=><option key={row.state} value={row.state}>{row.state}</option>)}</WeHouseChoice></Field>
        <Field label="LGA"><WeHouseChoice aria-label="LGA" value={lga} disabled={!state} onChange={e=>setLga(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"><option value="">Choose LGA</option>{lgas.map(value=><option key={value} value={value}>{value}</option>)}</WeHouseChoice></Field>
      </>:null}
      <Field label="Sponsored slots"><input inputMode="numeric" value={slots} onChange={e=>setSlots(e.target.value.replace(/\D/g,""))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <Field label="Daily price (₦)"><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value.replace(/[^0-9.]/g,""))} placeholder="0" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <Field label="Durations (days)"><input value={durations} onChange={e=>setDurations(e.target.value)} placeholder="7,14,30" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
      <label className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3"><span><span className="block text-xs font-semibold text-foreground">Open Sponsored campaigns</span><span className="mt-0.5 block text-[10px] text-muted-foreground">This rule only opens eligibility; campaigns still require verified payment activation.</span></span><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} className="h-4 w-4 accent-primary"/></label>
      <button type="button" disabled={busy||(scopeType==="lga"&&(!state||!lga))} onClick={save} className="min-h-11 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40 sm:col-span-2">{busy?"Saving…":"Save Sponsored rule"}</button>
    </div>

    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <h4 className="text-xs font-semibold text-foreground">App Store and Google Play Sponsored products</h4>
      <p className="mt-1 text-[10px] text-muted-foreground">Create the matching product in each store, then link it to a saved market and duration. The store controls the customer’s displayed price. Only enabled matches can start a native checkout.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Saved market"><WeHouseChoice aria-label="Saved market" value={selectedRule} onChange={e=>{
          const rule=rules.find(item=>item.rule_id===e.target.value);
          setSelectedRule(e.target.value);setStoreDuration(rule?.allowed_durations?.[0]||7);
        }} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose market</option>{rules.map(rule=><option key={rule.rule_id} value={rule.rule_id}>{resourceLabels[rule.resource_type]} · {rule.scope_type==="global"?"Global":rule.lga_name}</option>)}</WeHouseChoice></Field>
        <Field label="Store"><WeHouseChoice aria-label="Store" value={storePlatform} onChange={e=>setStorePlatform(e.target.value as "apple"|"google")} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="apple">App Store</option><option value="google">Google Play</option></WeHouseChoice></Field>
        <Field label="Duration"><WeHouseChoice aria-label="Duration" value={storeDuration} onChange={e=>setStoreDuration(Number(e.target.value))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground">{(rules.find(rule=>rule.rule_id===selectedRule)?.allowed_durations||[]).map(days=><option key={days} value={days}>{days} days</option>)}</WeHouseChoice></Field>
        <Field label="Store product ID"><input value={storeProductId} onChange={e=>setStoreProductId(e.target.value.trim())} placeholder="com.wehouse.sponsored.7d" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"/></Field>
        <label className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3 text-xs">Open this store product <input type="checkbox" checked={storeEnabled} onChange={e=>setStoreEnabled(e.target.checked)}/></label>
        <button type="button" disabled={busy||!selectedRule} onClick={saveStoreProduct} className="h-11 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40">Save store product</button>
      </div>
      {storeProducts.length>0&&<ul className="mt-3 space-y-1 text-[10px] text-muted-foreground">{storeProducts.map(product=><li key={`${product.rule_id}:${product.duration_days}:${product.platform}`}>
        <button type="button" onClick={()=>{
          const rule=rules.find(item=>item.rule_id===product.rule_id);
          if(rule)edit(rule);
          setStorePlatform(product.platform);setStoreDuration(product.duration_days);
          setStoreProductId(product.product_id);setStoreEnabled(product.enabled);
        }} className="w-full rounded-lg border border-border p-2 text-left">
          {product.platform} · {product.duration_days} days · {product.product_id} · ₦{Number(product.price_ngn).toLocaleString("en-NG")} · {product.enabled?"Open":"Off"}
        </button>
      </li>)}</ul>}
    </div>

    <div className="mt-4">
      {loading?<p role="status" className="py-6 text-xs text-muted-foreground">Loading Sponsored controls…</p>:!rules.length?<p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No Sponsored markets configured. Sponsored stays off.</p>:<div className="divide-y divide-border border-y border-border">
        {rules.map(rule=><button key={rule.rule_id} type="button" onClick={()=>edit(rule)} className="flex w-full items-center gap-3 py-3 text-left">
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-foreground">{resourceLabels[rule.resource_type]} · {rule.scope_type==="global"?"Global":rule.lga_name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{rule.slot_count} slots · ₦{Number(rule.daily_price_ngn||0).toLocaleString("en-NG")}/day · {(rule.allowed_durations||[]).join(", ")} days</span></span>
          <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${rule.enabled?"border-emerald-500/20 text-emerald-600 dark:text-emerald-300":"border-border text-muted-foreground"}`}>{rule.enabled?"Open":"Off"}</span>
        </button>)}
      </div>}
    </div>

    <div className="mt-6">
      <h4 className="text-xs font-semibold text-foreground">Campaign delivery</h4>
      <p className="mt-1 text-[10px] text-muted-foreground">Recent campaigns, payment references and unique daily viewer counts. Paused paid campaigns need Finance follow up.</p>
      {campaigns.length===0?<p className="mt-3 text-xs text-muted-foreground">No campaigns yet.</p>:<div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
        {campaigns.map(campaign=><div key={campaign.campaign_id} className="rounded-xl border border-border bg-card p-3 text-[10px]">
          <div className="flex flex-wrap items-center gap-2"><strong>{resourceLabels[campaign.resource_type]}</strong><span>{campaign.status==="active"&&campaign.ends_at&&new Date(campaign.ends_at)<=new Date()?"expired":campaign.status}</span><span>₦{Number(campaign.amount_ngn).toLocaleString("en-NG")}</span></div>
          <div className="mt-1 text-muted-foreground">{campaign.impressions} daily viewer records · {campaign.opens} opens{campaign.ends_at?` · Ends ${new Date(campaign.ends_at).toLocaleDateString()}`:""}</div>
          {campaign.payment_reference&&<div className="mt-1 break-all font-mono text-muted-foreground">{campaign.payment_reference}</div>}
          {campaign.status==="active"&&(!campaign.ends_at||new Date(campaign.ends_at)>new Date())&&(pauseTarget===campaign.campaign_id?<div className="mt-2 flex flex-wrap gap-2"><input aria-label="Reason to pause Sponsored campaign" value={pauseReason} onChange={e=>setPauseReason(e.target.value)} placeholder="Reason for pause (10+ characters)" className="h-10 min-w-48 flex-1 rounded-lg border border-border bg-background px-3 text-foreground"/><button disabled={busy||pauseReason.trim().length<10} onClick={()=>pause(campaign.campaign_id)} className="rounded-lg border border-border px-3 font-semibold disabled:opacity-40">Confirm pause</button><button onClick={()=>{setPauseTarget("");setPauseReason("");}} className="px-2">Cancel</button></div>:<button onClick={()=>setPauseTarget(campaign.campaign_id)} className="mt-2 rounded-lg border border-border px-3 py-2 font-semibold">Pause placement</button>)}
        </div>)}
      </div>}
    </div>

    <p className="mt-4 text-[10px] leading-5 text-muted-foreground">Owners see enabled offers in their Worker or Property Partner workspace. The price and allowed durations here control checkout; only a verified payment can activate a campaign. Closing a rule stops new offers and placement delivery.</p>
  </section>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){
  return <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">{label}</span>{children}</label>;
}
