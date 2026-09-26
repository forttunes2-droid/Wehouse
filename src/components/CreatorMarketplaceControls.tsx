import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { NIGERIA_STATES } from "@/data/nigeria-locations";
import { getServiceCategories } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";
import WeHouseSelect from "@/components/WeHouseSelect";

type CapacityRow = {
  capacity_id: string;
  state_name: string;
  lga_name: string;
  occupation_name: string;
  target_count: number | null;
  hard_limit: number | null;
  approvals_paused: boolean;
  note?: string | null;
  live_count: number;
  remaining: number | null;
  updated_at: string;
};

type SponsoredRule = {
  rule_id: string;
  resource_type: "worker" | "property" | "hotel";
  scope_type: "global" | "lga";
  state_name?: string | null;
  lga_name?: string | null;
  enabled: boolean;
  slot_count: number;
  daily_price_ngn: number;
  allowed_durations: number[];
};

export function CreatorWorkerCapacityControl() {
  const { requestElevation } = useCreatorAuth();
  const [rows, setRows] = useState<CapacityRow[]>([]);
  const [occupations, setOccupations] = useState<string[]>([]);
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [occupation, setOccupation] = useState("");
  const [target, setTarget] = useState("");
  const [hard, setHard] = useState("");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const stateData = useMemo(() => NIGERIA_STATES.find(item => item.state === state), [state]);

  async function load() {
    setLoading(true);
    const [capacity, categories] = await Promise.all([
      supabase.rpc("creator_get_worker_market_capacity"),
      getServiceCategories(true),
    ]);
    setLoading(false);
    if (capacity.error) toast.error(capacity.error.message);
    else setRows(Array.isArray(capacity.data) ? capacity.data as CapacityRow[] : []);
    if (!categories.error) setOccupations((categories.categories || []).filter(item => item.is_active).map(item => item.name));
  }

  useEffect(() => { void load(); }, []);

  function save() {
    if (!state || !lga || !occupation) return toast.error("Choose State, LGA and occupation");
    const targetValue = target.trim() === "" ? null : Number(target);
    const hardValue = hard.trim() === "" ? null : Number(hard);
    requestElevation("staff_authority", elevationId => {
      void (async () => {
        const { error } = await supabase.rpc("creator_set_worker_market_capacity", {
          p_state: state,
          p_lga: lga,
          p_occupation: occupation,
          p_target_count: targetValue,
          p_hard_limit: hardValue,
          p_approvals_paused: paused,
          p_note: null,
          p_creator_elevation_id: elevationId,
        });
        if (error) return toast.error(error.message);
        toast.success("Worker capacity updated");
        await load();
      })();
    });
  }

  function remove(id: string) {
    requestElevation("staff_authority", elevationId => {
      void (async () => {
        const { error } = await supabase.rpc("creator_remove_worker_market_capacity", {
          p_capacity_id: id,
          p_creator_elevation_id: elevationId,
        });
        if (error) return toast.error(error.message);
        toast.success("Worker capacity rule removed");
        await load();
      })();
    });
  }

  return <section className="space-y-4">
    <div>
      <h3 className="text-sm font-semibold">Worker market capacity</h3>
      <p className="mt-1 text-[9px] leading-5 text-[#6C7283]">Limits apply only when a reviewed Worker is about to become public. Signup and onboarding stay open.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <WeHouseSelect value={state} options={[{value:"",label:"Choose State"},...NIGERIA_STATES.map(item=>({value:item.state,label:item.state}))]} onChange={value=>{setState(value);setLga("");}} eyebrow="Capacity" title="State" ariaLabel="Worker capacity State" />
      <WeHouseSelect value={lga} options={[{value:"",label:"Choose LGA"},...(stateData?.cities || []).map(item=>({value:item,label:item}))]} onChange={setLga} eyebrow="Capacity" title="LGA" ariaLabel="Worker capacity LGA" />
      <WeHouseSelect value={occupation} options={[{value:"",label:"Choose occupation"},...occupations.map(item=>({value:item,label:item}))]} onChange={setOccupation} eyebrow="Capacity" title="Occupation" ariaLabel="Worker occupation" />
      <label className="text-[9px] text-[#747B8B]">Target<input value={target} onChange={e=>setTarget(e.target.value)} inputMode="numeric" placeholder="Optional" className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-sm text-white outline-none" /></label>
      <label className="text-[9px] text-[#747B8B]">Hard limit<input value={hard} onChange={e=>setHard(e.target.value)} inputMode="numeric" placeholder="No hard limit" className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-sm text-white outline-none" /></label>
      <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-white/[.08] px-3 text-[10px] text-[#B8BDCA]"><input type="checkbox" checked={paused} onChange={e=>setPaused(e.target.checked)} className="accent-violet-500" />Pause new approvals</label>
    </div>
    <button type="button" onClick={save} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold">Save capacity</button>

    {loading ? <p className="py-4 text-[10px] text-[#73798A]">Loading capacity…</p> : rows.length ? (
      <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
        {rows.map(row => <div key={row.capacity_id} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{row.occupation_name} · {row.lga_name}, {row.state_name}</p>
            <p className="mt-1 text-[9px] text-[#747B8B]">{row.live_count} live{row.hard_limit != null ? ` · ${row.remaining} spaces left · limit ${row.hard_limit}` : " · no hard limit"}{row.approvals_paused ? " · approvals paused" : ""}</p>
          </div>
          <button type="button" onClick={()=>remove(row.capacity_id)} className="min-h-10 px-2 text-[9px] font-semibold text-red-300">Remove</button>
        </div>)}
      </div>
    ) : <p className="py-4 text-[10px] text-[#73798A]">No Worker capacity limits yet.</p>}
  </section>;
}

export function CreatorSponsoredControl() {
  const { requestElevation } = useCreatorAuth();
  const [rows, setRows] = useState<SponsoredRule[]>([]);
  const [resource, setResource] = useState<"worker"|"property"|"hotel">("worker");
  const [scope, setScope] = useState<"global"|"lga">("global");
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots] = useState("3");
  const [dailyPrice, setDailyPrice] = useState("0");
  const [durations, setDurations] = useState("7,14,30");
  const [loading, setLoading] = useState(true);
  const stateData = useMemo(() => NIGERIA_STATES.find(item => item.state === state), [state]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("creator_get_sponsored_market_rules");
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows(Array.isArray(data) ? data as SponsoredRule[] : []);
  }
  useEffect(()=>{ void load(); },[]);

  function save() {
    if (scope === "lga" && (!state || !lga)) return toast.error("Choose the Sponsored State and LGA");
    const days = durations.split(",").map(value=>Number(value.trim())).filter(value=>Number.isInteger(value) && value>0);
    if (!days.length) return toast.error("Add at least one duration");
    requestElevation("policy_publish", elevationId => {
      void (async () => {
        const { error } = await supabase.rpc("creator_set_sponsored_market_rule", {
          p_resource_type: resource,
          p_scope_type: scope,
          p_state: scope === "lga" ? state : null,
          p_lga: scope === "lga" ? lga : null,
          p_enabled: enabled,
          p_slot_count: Number(slots),
          p_daily_price_ngn: Number(dailyPrice),
          p_allowed_durations: days,
          p_creator_elevation_id: elevationId,
        });
        if (error) return toast.error(error.message);
        toast.success("Sponsored market rule updated");
        await load();
      })();
    });
  }

  return <section className="space-y-4">
    <div>
      <h3 className="text-sm font-semibold">Sponsored marketplace</h3>
      <p className="mt-1 text-[9px] leading-5 text-[#6C7283]">Paid visibility only. It never changes verification, ratings, trust or organic ranking.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <WeHouseSelect value={resource} options={[{value:"worker",label:"Service Workers"},{value:"property",label:"Homes"},{value:"hotel",label:"Hotels"}]} onChange={value=>setResource(value as typeof resource)} eyebrow="Sponsored" title="Resource" ariaLabel="Sponsored resource type" />
      <WeHouseSelect value={scope} options={[{value:"global",label:"Global rule"},{value:"lga",label:"One LGA"}]} onChange={value=>setScope(value as typeof scope)} eyebrow="Sponsored" title="Coverage" ariaLabel="Sponsored coverage" />
      {scope === "lga" ? <>
        <WeHouseSelect value={state} options={[{value:"",label:"Choose State"},...NIGERIA_STATES.map(item=>({value:item.state,label:item.state}))]} onChange={value=>{setState(value);setLga("");}} eyebrow="Sponsored" title="State" ariaLabel="Sponsored State" />
        <WeHouseSelect value={lga} options={[{value:"",label:"Choose LGA"},...(stateData?.cities || []).map(item=>({value:item,label:item}))]} onChange={setLga} eyebrow="Sponsored" title="LGA" ariaLabel="Sponsored LGA" />
      </> : null}
      <label className="text-[9px] text-[#747B8B]">Sponsored slots<input value={slots} onChange={e=>setSlots(e.target.value)} inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-sm text-white outline-none" /></label>
      <label className="text-[9px] text-[#747B8B]">Price per day (₦)<input value={dailyPrice} onChange={e=>setDailyPrice(e.target.value)} inputMode="decimal" className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-sm text-white outline-none" /></label>
      <label className="text-[9px] text-[#747B8B]">Durations in days<input value={durations} onChange={e=>setDurations(e.target.value)} placeholder="7,14,30" className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-sm text-white outline-none" /></label>
      <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-white/[.08] px-3 text-[10px] text-[#B8BDCA]"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} className="accent-violet-500" />Sponsored sales enabled</label>
    </div>
    <button type="button" onClick={save} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold">Save Sponsored rule</button>

    {loading ? <p className="py-4 text-[10px] text-[#73798A]">Loading Sponsored rules…</p> : rows.length ? (
      <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
        {rows.map(row => <div key={row.rule_id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="text-xs font-semibold capitalize">{row.resource_type} · {row.scope_type === "global" ? "Global" : `${row.lga_name}, ${row.state_name}`}</p><p className="mt-1 text-[9px] text-[#747B8B]">{row.enabled ? "Enabled" : "Off"} · {row.slot_count} slots · ₦{Number(row.daily_price_ngn).toLocaleString()}/day · {(row.allowed_durations || []).join(", ")} days</p></div>
        </div>)}
      </div>
    ) : <p className="py-4 text-[10px] text-[#73798A]">No generic Sponsored rules configured yet.</p>}
  </section>;
}
