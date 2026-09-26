import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

type Assignment={
  assignment_id:string;
  user_id:string;
  name?:string|null;
  username?:string|null;
  role:"owner"|"manager";
  status:"invited"|"active"|"revoked"|"declined";
};
type ManagementState={
  listing_id:string;
  management_mode:"host"|"wehouse";
  wehouse_management_status:"not_required"|"requested"|"approved"|"declined";
  management_host_user_id?:string|null;
  management_updated_at?:string|null;
  assignments:Assignment[];
};

export default function PropertyManagementPanel({listingId,profile,onChanged,onModeChange}:{listingId:string;profile:Profile;onChanged?:()=>void;onModeChange?:(mode:"host"|"wehouse")=>void}){
  const [state,setState]=useState<ManagementState|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [username,setUsername]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.rpc("get_my_property_management",{p_listing_id:listingId});
    setLoading(false);
    if(error||!data){setState(null);return toast.error(error?.message||"Property management could not be loaded")}
    setState(data as ManagementState);
  },[listingId]);
  useEffect(()=>{void load()},[load]);
  const mine=useMemo(()=>state?.assignments.find(row=>row.user_id===profile.user_id&&row.status==="active")||null,[profile.user_id,state]);
  const owner=mine?.role==="owner";
  const active=state?.assignments.filter(row=>row.status==="active")||[];

  async function setMode(mode:"host"|"wehouse"){
    if(!owner||busy||!state||state.management_mode===mode)return;
    setBusy(true);
    const {data,error}=await supabase.rpc("set_my_property_management_mode",{p_listing_id:listingId,p_mode:mode});
    setBusy(false);
    if(error||!data)return toast.error(error?.message||"Management responsibility could not be changed");
    setState(data as ManagementState);onModeChange?.(mode);onChanged?.();
    toast.success(mode==="host"?"Host management active":"WeHouse management request sent");
  }
  async function invite(){
    const value=username.trim().replace(/^@/,"");
    if(!owner||busy||!value)return;
    setBusy(true);
    const {error}=await supabase.rpc("invite_property_host_manager",{p_listing_id:listingId,p_username:value});
    setBusy(false);
    if(error)return toast.error(error.message);
    setUsername("");toast.success("Manager invitation sent");await load();
  }
  async function setResponsible(userId:string){
    if(!owner||busy)return;
    setBusy(true);
    const {data,error}=await supabase.rpc("set_property_responsible_host",{p_listing_id:listingId,p_user_id:userId});
    setBusy(false);
    if(error||!data)return toast.error(error?.message||"Responsible Host could not be changed");
    setState(data as ManagementState);onChanged?.();toast.success("Responsible Host updated");
  }
  async function revoke(assignmentId:string){
    if(!owner||busy)return;
    setBusy(true);
    const {data,error}=await supabase.rpc("revoke_property_host_manager",{p_assignment_id:assignmentId});
    setBusy(false);
    if(error||data!==true)return toast.error(error?.message||"Manager could not be removed");
    toast.success("Manager access removed");await load();onChanged?.();
  }

  if(loading)return <section className="border-y border-white/[.07] py-5"><p className="text-[10px] text-[#7C8291]">Loading management…</p></section>;
  if(!state)return null;

  const wehouseActive=state.management_mode==="wehouse"&&state.wehouse_management_status==="approved";
  const statusLabel=state.management_mode==="host"
    ? "Active"
    : wehouseActive
      ? "Active"
      : state.wehouse_management_status==="requested"
        ? "Pending"
        : state.wehouse_management_status==="declined"
          ? "Declined"
          : "Needs action";

  return <section className="border-y border-white/[.07] py-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">Management</p>
        <h3 className="mt-1 text-sm font-semibold">{state.management_mode==="host"?"Host managed":"WeHouse managed"}</h3>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${statusLabel==="Active"?"border-emerald-400/15 bg-emerald-400/[.06] text-emerald-300":statusLabel==="Pending"?"border-amber-300/15 bg-amber-300/[.06] text-amber-200":"border-white/[.08] text-[#A0A6B4]"}`}>{statusLabel}</span>
    </div>

    {owner?<div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Who manages this property">
      <button type="button" disabled={busy} aria-pressed={state.management_mode==="host"} onClick={()=>void setMode("host")} className={`min-h-14 rounded-2xl border px-3 text-left transition disabled:opacity-40 ${state.management_mode==="host"?"border-violet-400/35 bg-violet-500/[.08]":"border-white/[.07] bg-white/[.015]"}`}><span className="block text-xs font-semibold">Host</span><span className="mt-0.5 block text-[9px] text-[#737A8B]">You or your manager</span></button>
      <button type="button" disabled={busy} aria-pressed={state.management_mode==="wehouse"} onClick={()=>void setMode("wehouse")} className={`min-h-14 rounded-2xl border px-3 text-left transition disabled:opacity-40 ${state.management_mode==="wehouse"?"border-violet-400/35 bg-violet-500/[.08]":"border-white/[.07] bg-white/[.015]"}`}><span className="block text-xs font-semibold">WeHouse</span><span className="mt-0.5 block text-[9px] text-[#737A8B]">Property Operations</span></button>
    </div>:null}

    {state.management_mode==="wehouse"&&!wehouseActive?<div className="mt-3 rounded-xl border border-amber-300/10 bg-amber-300/[.035] px-3 py-2.5 text-[9px] leading-4 text-[#B9A985]">
      {state.wehouse_management_status==="requested"?"Operations review is pending. New WeHouse-managed bookings stay unavailable until accepted.":state.wehouse_management_status==="declined"?"WeHouse management was not accepted. Choose Host or contact support.":"Complete the management handoff before taking new bookings."}
    </div>:null}

    {state.management_mode==="wehouse"&&wehouseActive?<div className="mt-4 flex items-center justify-between border-t border-white/[.06] pt-4">
      <span className="text-[10px] text-[#777E8E]">Operator</span>
      <span className="text-[10px] font-semibold text-[#D7DAE1]">WeHouse Property Operations</span>
    </div>:null}

    {state.management_mode==="host"?<div className="mt-5">
      <div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold">Hosting team</h4><span className="text-[9px] text-[#747A8A]">{active.length} active</span></div>
      <div className="mt-2 divide-y divide-white/[.06] border-y border-white/[.06]">{active.map(row=><div key={row.assignment_id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.user_id===profile.user_id?"You":row.name||row.username||"Property Partner"}</p><p className="mt-0.5 text-[9px] text-[#747A8A]">{row.role==="owner"?"Owner":"Manager"}{row.user_id===state.management_host_user_id?" · Responsible Host":""}</p></div>{owner&&row.user_id!==state.management_host_user_id?<button type="button" disabled={busy} onClick={()=>void setResponsible(row.user_id)} className="min-h-10 px-2 text-[10px] font-semibold text-violet-300">Make responsible</button>:null}{owner&&row.role==="manager"?<button type="button" disabled={busy} onClick={()=>void revoke(row.assignment_id)} className="min-h-10 px-2 text-[10px] font-semibold text-red-300">Remove</button>:null}</div>)}</div>
      {owner?<div className="mt-4"><p className="text-[10px] font-semibold">Add manager</p><div className="mt-2 flex gap-2"><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="WeHouse username" className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#151820] px-3 text-sm outline-none focus:border-violet-500/40"/><button type="button" disabled={busy||!username.trim()} onClick={()=>void invite()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">Invite</button></div></div>:null}
    </div>:null}
  </section>;
}

export function PropertyHostInvitations({profile,onChanged}:{profile:Profile;onChanged?:()=>void}){
  const [rows,setRows]=useState<any[]>([]);
  const [busy,setBusy]=useState("");
  const load=useCallback(async()=>{
    const {data}=await supabase.rpc("get_my_property_host_invites");
    setRows(Array.isArray(data)?data:[]);
  },[]);
  useEffect(()=>{void load()},[load,profile.user_id]);
  async function answer(id:string,accept:boolean){
    if(busy)return;setBusy(id);
    const {error}=await supabase.rpc("respond_to_property_host_invite",{p_assignment_id:id,p_accept:accept});
    setBusy("");
    if(error)return toast.error(error.message);
    toast.success(accept?"Property added to your workspace":"Invitation declined");
    await load();onChanged?.();window.dispatchEvent(new Event("wehouse:property-host-changed"));
  }
  if(!rows.length)return null;
  return <section className="border-y border-violet-500/15 py-4"><p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">Property invitations</p><div className="mt-2 divide-y divide-white/[.06]">{rows.map(row=><div key={row.assignment_id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.title||"Property"}</p><p className="mt-1 truncate text-[9px] text-[#747A8A]">{[row.city,row.state].filter(Boolean).join(", ")}</p></div><button type="button" disabled={Boolean(busy)} onClick={()=>void answer(row.assignment_id,true)} className="min-h-10 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-40">Accept</button><button type="button" disabled={Boolean(busy)} onClick={()=>void answer(row.assignment_id,false)} className="min-h-10 px-2 text-[10px] font-semibold text-[#9AA0AF]">Decline</button></div>)}</div></section>;
}

export function HostArrivalAction({stay,profile,onChanged}:{stay:any;profile:Profile;onChanged?:()=>void}){
  const active=stay.management_mode_snapshot==="host"&&stay.responsible_host_user_id===profile.user_id&&stay.status==="ready_for_move_in";
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  if(!active)return null;
  async function confirm(){
    const value=code.trim().toUpperCase();
    if(!value||busy)return;
    setBusy(true);
    const result=stay.stay_type==="short_let"
      ? await supabase.rpc("host_confirm_short_stay_check_in",{p_booking_code:value})
      : await supabase.rpc("host_confirm_long_let_handover",{p_booking_code:value});
    setBusy(false);
    if(result.error)return toast.error(result.error.message);
    setCode("");toast.success(stay.stay_type==="short_let"?"Guest checked in":"Handover confirmed");onChanged?.();
  }
  return <div className="mt-4 border-t border-violet-500/15 pt-4"><p className="text-[10px] font-semibold text-violet-200">{stay.stay_type==="short_let"?"Confirm guest arrival":"Confirm move-in handover"}</p><p className="mt-1 text-[9px] leading-4 text-[#747A8A]">Ask the guest to show their booking code at the property. The code is intentionally not shown in your dashboard.</p><div className="mt-2 flex gap-2"><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="Guest booking code" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#151820] px-3 font-mono text-sm tracking-wide outline-none"/><button type="button" disabled={busy||!code.trim()} onClick={()=>void confirm()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">{busy?"Checking…":"Confirm"}</button></div></div>;
}
