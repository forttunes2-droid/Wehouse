import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import { shareInvitationExternally } from "@/lib/resourceInvitation";
import SentResourceInvitations from "@/components/SentResourceInvitations";
import { withTimeout } from "@/lib/withTimeout";
import { parsePropertyManagement, parseHostArrivalReceipt, type PropertyManagementState } from "@/lib/propertyManagement";

type Props={listingId:string;profile:Profile;onChanged?:()=>void;onModeChange?:(mode:"host"|"wehouse")=>void;onContact?:()=>void};
export default function PropertyManagementPanel(props:Props){
  return <PropertyManagementForProperty key={props.profile.user_id+':'+props.listingId} {...props}/>;
}
function PropertyManagementForProperty({listingId,profile,onChanged,onModeChange,onContact}:Props){
  const [state,setState]=useState<PropertyManagementState|null>(null);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState(false);
  const [busy,setBusy]=useState(false);
  const [username,setUsername]=useState("");
  const [inviteAccess,setInviteAccess]=useState<"operations"|"full_hosting">("operations");
  const request=useRef(0),mutating=useRef(false),mounted=useRef(true);
  const load=useCallback(async()=>{
    const current=++request.current;
    setLoading(true);setLoadError(false);
    try{
      const result=await withTimeout(supabase.rpc("get_my_property_management",{p_listing_id:listingId}),10000,"Property management took too long to load");
      if(result.error)throw result.error;
      const next=parsePropertyManagement(result.data,listingId);
      if(mounted.current&&current===request.current)setState(next);
    }catch{
      if(mounted.current&&current===request.current){setState(null);setLoadError(true);}
    }finally{if(mounted.current&&current===request.current)setLoading(false);}
  },[listingId]);
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;request.current++;}},[load]);
  const mine=useMemo(()=>state?.assignments.find(row=>row.user_id===profile.user_id&&row.status==="active")||null,[profile.user_id,state]);
  const owner=mine?.role==="owner";
  const active=state?.assignments.filter(row=>row.status==="active")||[];
  const configured=Boolean(state?.management_updated_at);
  async function mutate(task:()=>Promise<void>,fallback:string){
    if(mutating.current)return;
    mutating.current=true;setBusy(true);
    try{await task();}catch(error){if(mounted.current)toast.error(error instanceof Error?error.message:fallback);}
    finally{mutating.current=false;if(mounted.current)setBusy(false);}
  }
  async function setMode(mode:"host"|"wehouse"){
    if(!owner||!state||configured)return;
    await mutate(async()=>{
      const {data,error}=await supabase.rpc("set_my_property_management_mode",{p_listing_id:listingId,p_mode:mode});
      if(!mounted.current)return;
      if(error)throw error;
      const next=parsePropertyManagement(data,listingId);
      if(next.management_mode!==mode||!next.management_updated_at)throw new Error("Management choice could not be confirmed. Reload the current state.");
      setState(next);onModeChange?.(mode);onChanged?.();
      toast.success(mode==="host"?"Host management active":"WeHouse management request sent");
    },"Management choice could not be confirmed. Refresh before trying again.");
  }
  async function invite(){
    const value=username.trim().replace(/^@/,"");if(!owner||!value)return;
    await mutate(async()=>{
      const {data,error}=await supabase.rpc("create_property_cohost_invitation",{p_listing_id:listingId,p_identifier:value,p_delivery:"direct",p_access_level:inviteAccess});
      if(!mounted.current)return;
      if(error)throw error;
      if(typeof data?.invitation_id!=="string"||data.status!=="pending")throw new Error("Invitation could not be confirmed. Check sent invitations before sending again.");
      setUsername("");toast.success(data.reused?"Invitation is already pending":"Team member invitation sent");window.dispatchEvent(new Event("wehouse:resource-invitations-changed"));await load();
    },"Invitation could not be confirmed. Check sent invitations before sending again.");
  }
  async function shareInvite(){
    if(!owner)return;
    await mutate(async()=>{
      const {data,error}=await supabase.rpc("create_property_cohost_invitation",{p_listing_id:listingId,p_identifier:null,p_delivery:"link",p_access_level:inviteAccess});
      if(!mounted.current)return;
      if(error||typeof data?.invitation_id!=="string"||data.status!=="pending"||typeof data?.token!=="string"||!data.token)throw new Error("Invite link could not be confirmed. Check sent invitations before trying again.");
      try{
        const result=await shareInvitationExternally(String(data.token),"Join a property team on WeHouse");
        if(mounted.current&&result==="copied")toast.success("Invite link copied");
      }finally{
        if(mounted.current){window.dispatchEvent(new Event("wehouse:resource-invitations-changed"));await load();}
      }
    },"The invitation was created, but its link could not be shared. Check sent invitations.");
  }
  async function setResponsible(userId:string){
    if(!owner)return;
    await mutate(async()=>{
      const {data,error}=await supabase.rpc("set_property_responsible_host",{p_listing_id:listingId,p_user_id:userId});
      if(!mounted.current)return;
      if(error)throw error;
      const next=parsePropertyManagement(data,listingId);
      if(next.management_host_user_id!==userId)throw new Error("Responsible Host could not be confirmed. Reload the current state.");
      setState(next);onChanged?.();toast.success("Responsible Host updated");
    },"Responsible Host could not be confirmed. Refresh before trying again.");
  }
  async function revoke(assignmentId:string){
    if(!owner)return;
    await mutate(async()=>{
      const {data,error}=await supabase.rpc("revoke_property_host_manager",{p_assignment_id:assignmentId});
      if(!mounted.current)return;
      if(error||data!==true)throw new Error("Team member removal could not be confirmed. Refresh before trying again.");
      toast.success("Team member removed. Active Host bookings moved to you.");await load();onChanged?.();
    },"Team member removal could not be confirmed. Refresh before trying again.");
  }

  if(loading)return <section className="border-y border-[var(--wh-border-subtle)] py-5"><p role="status" className="text-sm text-[var(--wh-text-secondary)]">Loading property management…</p></section>;
  if(loadError||!state)return <section role="alert" aria-label="Property management unavailable" className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-sm text-[var(--wh-text)]"><h3 className="font-semibold">Property management could not be loaded</h3><p className="text-[var(--wh-text-secondary)]">Refresh to confirm the current operator and access before making changes.</p><button type="button" onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 font-semibold">Reload property management</button>{onContact?<button type="button" onClick={onContact} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 font-semibold">Contact WeHouse</button>:null}</section>;

  const wehouseActive=configured&&state.management_mode==="wehouse"&&state.wehouse_management_status==="approved";
  const statusLabel=!configured
    ? "Choose"
    : state.management_mode==="host"
      ? "Active"
      : wehouseActive
        ? "Active"
        : state.wehouse_management_status==="requested"
          ? "Pending"
          : state.wehouse_management_status==="declined"
            ? "Declined"
            : "Needs action";

  return <section className="border-y border-[var(--wh-border-subtle)] py-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">Property management</h3>
        <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">{configured?"The operator for this published home is recorded. Ask WeHouse support to review any handoff.":"This older home needs its initial operator choice before new bookings."}</p>
      </div>
      <button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-3 text-xs font-semibold disabled:opacity-40">Refresh management</button>
      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${statusLabel==="Active"?"border-emerald-400/15 bg-emerald-400/[.06] text-emerald-700 dark:text-emerald-300":statusLabel==="Pending"?"border-amber-300/15 bg-amber-300/[.06] text-amber-800 dark:text-amber-200":"border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}>{statusLabel}</span>
    </div>

    {owner&&!configured?<div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Who manages this property">
      <button type="button" disabled={busy} aria-pressed={configured&&state.management_mode==="host"} onClick={()=>void setMode("host")} className={`min-h-[72px] rounded-2xl border px-3 py-3 text-left transition active:scale-[.99] disabled:opacity-40 ${configured&&state.management_mode==="host"?"border-violet-400/35 bg-violet-500/[.09]":"border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"}`}><span className="block text-xs font-semibold">Host manages</span><span className="mt-1 block text-[9px] leading-4 text-[var(--wh-text-secondary)]">You or an assigned team member</span></button>
      <button type="button" disabled={busy} aria-pressed={configured&&state.management_mode==="wehouse"} onClick={()=>void setMode("wehouse")} className={`min-h-[72px] rounded-2xl border px-3 py-3 text-left transition active:scale-[.99] disabled:opacity-40 ${configured&&state.management_mode==="wehouse"?"border-violet-400/35 bg-violet-500/[.09]":"border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"}`}><span className="block text-xs font-semibold">WeHouse manages</span><span className="mt-1 block text-[9px] leading-4 text-[var(--wh-text-secondary)]">Property Operations runs the stay</span></button>
    </div>:null}
    {owner&&configured&&onContact?<button type="button" onClick={onContact} className="mt-3 min-h-11 rounded-xl border border-violet-400/20 px-4 text-xs font-semibold text-violet-700 dark:text-violet-200">Request a reviewed handoff</button>:null}

    {configured&&state.management_mode==="host"?<div className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-[9px] text-[var(--wh-text-muted)]">Responsible operator</p><p className="mt-0.5 text-xs font-semibold">Host</p></div>
        <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-semibold text-violet-700 dark:text-violet-200">Direct control</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[8px] font-medium text-[var(--wh-text-secondary)]">
        <span className="rounded-lg bg-[var(--wh-interactive)] px-2 py-2">Guest chat</span>
        <span className="rounded-lg bg-[var(--wh-interactive)] px-2 py-2">Access & arrival</span>
        <span className="rounded-lg bg-[var(--wh-interactive)] px-2 py-2">Handover</span>
      </div>
      <p className="mt-3 text-[8px] leading-4 text-[var(--wh-text-muted)]">WeHouse still handles protected payments, platform support and disputes.</p>
    </div>:null}

    {configured&&state.management_mode==="wehouse"&&!wehouseActive?<div className="mt-3 rounded-xl border border-amber-300/10 bg-amber-300/[.035] px-3 py-2.5 text-[9px] leading-4 text-amber-800 dark:text-amber-200">
      {state.wehouse_management_status==="requested"?"Property Operations must accept management before new WeHouse-managed bookings are available.":state.wehouse_management_status==="declined"?"WeHouse management was not accepted. Contact support for a reviewed decision.":"Complete the management review before taking new bookings."}
    </div>:null}

    {configured&&state.management_mode==="wehouse"&&wehouseActive?<div className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-[9px] text-[var(--wh-text-muted)]">Responsible operator</p><p className="mt-0.5 text-xs font-semibold">WeHouse Property Operations</p></div>
        <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-semibold text-violet-700 dark:text-violet-200">Managed</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[8px] font-medium text-[var(--wh-text-secondary)]">
        <span className="rounded-lg bg-[var(--wh-interactive)] px-2 py-2">Guest coordination</span>
        <span className="rounded-lg bg-[var(--wh-interactive)] px-2 py-2">Access & arrival</span>
        <span className="rounded-lg bg-[var(--wh-interactive)] px-2 py-2">Handover</span>
      </div>
      <p className="mt-3 text-[8px] leading-4 text-[var(--wh-text-muted)]">You keep ownership of the property record while WeHouse runs the operational stay flow.</p>
    </div>:null}

    {configured&&state.management_mode==="host"?<div className="mt-5">
      <div className="flex items-end justify-between gap-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-violet-700 dark:text-violet-300">Hosting team</p><h4 className="mt-1 text-base font-semibold">People with access</h4><p className="mt-1 text-[10px] leading-4 text-[var(--wh-text-muted)]">Manage who can operate this property and exactly what they can change.</p></div>
        <span className="rounded-full border border-[var(--wh-border-subtle)] px-2.5 py-1 text-[9px] font-semibold text-[var(--wh-text-secondary)]">{active.length} active</span>
      </div>
      <div className="mt-4 divide-y divide-[var(--wh-border-subtle)] rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-4">{active.map(row=><div key={row.assignment_id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.user_id===profile.user_id?"You":row.name||row.username||"Property Partner"}</p><p className="mt-0.5 text-[9px] text-[var(--wh-text-muted)]">{row.role==="owner"?"Owner":row.access_level==="full_hosting"?"Team member · Full hosting":"Team member · Operations"}{row.user_id===state.management_host_user_id?" · Responsible Host":""}</p></div>{owner&&row.user_id!==state.management_host_user_id?<button type="button" disabled={busy} onClick={()=>void setResponsible(row.user_id)} className="min-h-10 px-2 text-[10px] font-semibold text-violet-700 dark:text-violet-300">Make responsible</button>:null}{owner&&row.role==="manager"?<button type="button" disabled={busy} onClick={()=>void revoke(row.assignment_id)} className="min-h-10 px-2 text-[10px] font-semibold text-red-700 dark:text-red-300">Remove</button>:null}</div>)}</div>
      {owner?<div className="mt-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-violet-700 dark:text-violet-300">Add someone</p><p className="mt-1 text-xs font-semibold">Choose access before sending the invitation</p><p className="mt-1 text-[9px] leading-4 text-[var(--wh-text-muted)]">The person joins only this property. Their WeHouse identity and other workspaces do not change.</p></div>
        <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Team member access">
          <button type="button" aria-pressed={inviteAccess==="operations"} onClick={()=>setInviteAccess("operations")} className={`min-h-14 rounded-2xl border px-3 text-left text-[10px] ${inviteAccess==="operations"?"border-violet-400/30 bg-violet-500/[.07] text-violet-800 dark:text-violet-100":"border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}><span className="block font-semibold">Operations</span><span className="mt-1 block text-[8px] opacity-75">Guests, arrival and handover</span></button>
          <button type="button" aria-pressed={inviteAccess==="full_hosting"} onClick={()=>setInviteAccess("full_hosting")} className={`min-h-14 rounded-2xl border px-3 text-left text-[10px] ${inviteAccess==="full_hosting"?"border-violet-400/30 bg-violet-500/[.07] text-violet-800 dark:text-violet-100":"border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}><span className="block font-semibold">Full hosting</span><span className="mt-1 block text-[8px] opacity-75">Also future price and availability</span></button>
        </div>
        <div className="mt-2 flex gap-2"><input value={username} onChange={e=>setUsername(e.target.value)} aria-label="Team member username or user ID" placeholder="@username" className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm outline-none focus:border-violet-500/40"/><button type="button" disabled={busy||!username.trim()} onClick={()=>void invite()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">Invite</button></div>
        <button type="button" disabled={busy} onClick={()=>void shareInvite()} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] text-[10px] font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-40">Share invite link</button>
        <SentResourceInvitations resourceType="property" resourceId={listingId} />
      </div>:null}
    </div>:null}
  </section>;
}

export function HostArrivalAction({stay,profile,onChanged}:{stay:any;profile:Profile;onChanged?:()=>void}){
  return <HostArrivalForReservation key={profile.user_id+':'+String(stay.reservation_id||stay.id)} stay={stay} profile={profile} onChanged={onChanged}/>;
}
function HostArrivalForReservation({stay,profile,onChanged}:{stay:any;profile:Profile;onChanged?:()=>void}){
  const reservationId=stay.reservation_id||stay.id;
  const active=stay.management_mode_snapshot==="host"&&stay.responsible_host_user_id===profile.user_id&&stay.status==="ready_for_move_in";
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const confirming=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  if(!active)return null;
  async function confirm(){
    const value=code.trim().toUpperCase();
    if(!value||typeof reservationId!=='string'||!reservationId||confirming.current)return;
    confirming.current=true;setBusy(true);
    try{
      const result=await withTimeout(supabase.rpc(stay.stay_type==="short_let"?"host_confirm_short_stay_check_in":"host_confirm_long_let_handover",{p_booking_code:value,p_reservation_id:reservationId}),10000,'Arrival confirmation is delayed. Refresh this reservation before retrying.');
      if(result.error)throw result.error;
      parseHostArrivalReceipt(result.data,reservationId);
      if(!mounted.current)return;
      setCode("");toast.success(stay.stay_type==="short_let"?"Guest checked in":"Handover confirmed");onChanged?.();
    }catch(error){if(mounted.current)toast.error(error instanceof Error?error.message:"Arrival could not be confirmed. Refresh the booking before trying again.");}
    finally{if(mounted.current){confirming.current=false;setBusy(false);}}
  }
  return <div className="mt-4 border-t border-[var(--wh-border-subtle)] pt-4"><p className="text-sm font-semibold wh-accent-text">{stay.stay_type==="short_let"?"Confirm guest arrival":"Confirm move-in handover"}</p><p className="mt-1 text-xs leading-5 text-[var(--wh-text-muted)]">Ask the guest to show their booking code at the property. The code is intentionally not shown in your dashboard.</p><div className="mt-2 flex gap-2"><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} aria-label="Guest booking code" placeholder="Guest booking code" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 font-mono text-sm tracking-wide outline-none"/><button type="button" disabled={busy||!code.trim()} onClick={()=>void confirm()} className="min-h-11 rounded-xl bg-violet-600 px-4 text-white text-xs font-semibold disabled:opacity-40">{busy?"Checking…":"Confirm"}</button></div></div>;
}
