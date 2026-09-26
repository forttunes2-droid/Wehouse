import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import { ListingMediaImage } from "@/components/ListingCandidateMedia";
import PropertyHostBookingChat from "@/components/PropertyHostBookingChat";
import WorkspaceSwitchSheet from "@/components/WorkspaceSwitchSheet";
import { PropertyDetails } from "@/pages/PropertyOwnerDashboard";
import { getMyPropertyHostConversations, type PropertyHostConversation } from "@/lib/supabase/property-host-chat";
import { locationLabel } from "@/lib/locationPresentation";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import type { WorkspaceAccess, WorkspaceChoice } from "@/pages/AccountCenter";

type Tab="properties"|"inbox";

export default function PropertyHostingDashboard({
  profile,
  onLogout,
  onNavigate,
  workspaceAccess,
  activeWorkspace,
  onSwitchWorkspace,
}:{
  profile:Profile;
  onLogout:()=>void;
  onNavigate:(page:string,id?:string)=>void;
  workspaceAccess?:WorkspaceAccess|null;
  activeWorkspace?:WorkspaceChoice;
  onSwitchWorkspace?:(workspace:WorkspaceChoice)=>void;
}){
  const[tab,setTab]=useState<Tab>("properties");
  const[selected,setSelected]=useState<any|null>(null);
  const[switchOpen,setSwitchOpen]=useState(false);
  const[unread,setUnread]=useState(0);
  const canSwitch=Boolean(workspaceAccess&&onSwitchWorkspace);
  const title=tab==="properties"?"Hosting":"Inbox";

  return <>
    <WorkspaceFrameV2
      label="WEHOUSE · HOSTING"
      title={title}
      description={tab==="properties"?"Homes you have accepted co-host access to.":"Guest conversations for properties you help operate."}
      items={[
        {id:"properties",label:"Properties"},
        {id:"inbox",label:"Inbox",badge:unread||undefined},
      ]}
      active={tab}
      setActive={(id)=>{setSelected(null);setTab(id as Tab);}}
      onAccount={()=>onNavigate("profile")}
      onWorkspaceSwitch={canSwitch?()=>setSwitchOpen(true):undefined}
      onLogout={onLogout}
      immersive={Boolean(selected)}
    >
      {selected
        ? <PropertyDetails property={selected} profile={profile} onBack={()=>setSelected(null)} onOpenInbox={()=>{setSelected(null);setTab("inbox");}} />
        : tab==="properties"
          ? <HostingProperties profile={profile} onOpen={setSelected}/>
          : <HostingInbox profile={profile} onUnread={setUnread}/>}
    </WorkspaceFrameV2>
    {workspaceAccess&&onSwitchWorkspace?<WorkspaceSwitchSheet
      open={switchOpen}
      access={workspaceAccess}
      active={activeWorkspace}
      identityName={profile.full_name||profile.username}
      identityAvatar={profile.avatar_url}
      onClose={()=>setSwitchOpen(false)}
      onSwitch={onSwitchWorkspace}
    />:null}
  </>;
}

function HostingProperties({profile,onOpen}:{profile:Profile;onOpen:(property:any)=>void}){
  const[rows,setRows]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    const{data,error}=await supabase.rpc("get_my_hosting_properties");
    setLoading(false);
    if(error){setRows([]);return toast.error(error.message||"Hosting properties could not be loaded");}
    setRows(Array.isArray(data)?data:[]);
  },[]);
  useEffect(()=>{void load()},[load,profile.user_id]);
  useEffect(()=>{
    const refresh=()=>void load();
    window.addEventListener("wehouse:property-host-changed",refresh);
    return()=>window.removeEventListener("wehouse:property-host-changed",refresh);
  },[load]);

  if(loading)return <p role="status" className="py-10 text-sm text-[#8B91A0]">Loading Hosting…</p>;
  if(!rows.length)return <div className="grid min-h-52 place-items-center text-center"><div><p className="text-sm font-semibold">No hosting properties</p><p className="mt-2 text-[10px] text-[#6E7484]">A property appears here after you accept a co-host invitation.</p></div></div>;

  return <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
    {rows.map(property=><button key={property.id} type="button" onClick={()=>onOpen(property)} className="flex w-full items-center gap-3 py-4 text-left active:bg-white/[.02]">
      <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-[#171A22]">
        {property.images?.[0]?<ListingMediaImage reference={property.images[0]} alt={property.title||"Property"} className="h-full w-full object-cover"/>:<span className="grid h-full place-items-center text-[9px] text-muted-foreground">No image</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{property.title||"Property"}</p>
        <p className="mt-1 truncate text-[9px] text-[#6F7585]">{locationLabel(property.address,property.city,property.state)}</p>
        <p className="mt-2 text-[9px] font-semibold text-violet-300">{property._access_level==="full_hosting"?"Full hosting":"Operations"}</p>
      </div>
      <span className="text-[#5E6575]">›</span>
    </button>)}
  </div>;
}

function HostingInbox({profile,onUnread}:{profile:Profile;onUnread:(count:number)=>void}){
  const[rows,setRows]=useState<PropertyHostConversation[]>([]);
  const[active,setActive]=useState<PropertyHostConversation|null>(null);
  const[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    const result=await getMyPropertyHostConversations();
    setLoading(false);
    if(result.error)return toast.error(result.error.message||"Hosting messages could not be loaded");
    setRows(result.conversations||[]);
  },[]);
  useEffect(()=>{void load()},[load,profile.user_id]);
  useEffect(()=>{onUnread(rows.reduce((sum,row)=>sum+Number(row.unread_count||0),0));},[onUnread,rows]);
  useEffect(()=>{
    const channel=supabase.channel(`hosting-inbox:${profile.user_id}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"property_host_messages"},()=>void load())
      .subscribe();
    return()=>{void supabase.removeChannel(channel);};
  },[load,profile.user_id]);

  if(active)return <PropertyHostBookingChat conversation={active} profile={profile} onClose={()=>{setActive(null);void load();}} onUpdated={load}/>;
  if(loading)return <p role="status" className="py-10 text-sm text-[#8B91A0]">Loading messages…</p>;
  if(!rows.length)return <div className="grid min-h-52 place-items-center text-center"><div><p className="text-sm font-semibold">No guest conversations yet</p><p className="mt-2 text-[10px] text-[#6E7484]">Conversations appear when you are responsible for a Host-managed booking.</p></div></div>;

  return <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
    {rows.map(row=><button key={row.conversation_id} type="button" onClick={()=>setActive(row)} className="flex w-full items-center gap-3 py-4 text-left active:bg-white/[.02]">
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/12 text-xs font-bold text-violet-200">{row.other_person_avatar?<img src={row.other_person_avatar} alt="" className="h-full w-full object-cover"/>:(row.other_person_name||"G")[0].toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{row.other_person_name||"Guest"}</span><span className="mt-1 block truncate text-[9px] text-[#777D8D]">{row.listing_title} · {row.last_message||"Booking conversation"}</span></span>
      {row.unread_count>0?<span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{row.unread_count>99?"99+":row.unread_count}</span>:<span className="text-[#5E6575]">›</span>}
    </button>)}
  </div>;
}
