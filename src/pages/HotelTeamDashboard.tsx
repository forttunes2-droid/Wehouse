import { useEffect,useState } from 'react';
import { toast,Toaster } from 'sonner';
import { supabase } from '@/lib/supabase';
import AccountShell from '@/components/AccountShell';
import PartnerHotelOperations from '@/components/PartnerHotelOperations';
import type { Profile } from '@/types';

type Hotel={hotel_id:number;name:string;city:string|null;state:string|null;status:string;images:string[]|null;access_role:'manager'|'staff'};

export default function HotelTeamDashboard({profile}:{profile:Profile;onLogout:()=>void;onNavigate?:(page:string)=>void}){
 const[hotels,setHotels]=useState<Hotel[]>([]),[selected,setSelected]=useState<Hotel|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;void(async()=>{const{data,error}=await supabase.rpc('get_my_hotel_operations');if(!active)return;if(error)toast.error(error.message);setHotels((Array.isArray(data)?data:[]) as Hotel[]);setLoading(false)})();return()=>{active=false}},[]);
 if(selected)return <div className="min-h-dvh bg-[#0A0A0F] px-4 py-5 text-white sm:px-6"><Toaster position="top-center" richColors/><div className="mx-auto max-w-6xl"><PartnerHotelOperations hotel={selected} accessRole={selected.access_role} onBack={()=>setSelected(null)}/></div></div>;
 return <AccountShell profile={profile} title="Hotel Operations" description="Work only inside hotels where the owner assigned you.">
  <Toaster position="top-center" richColors/>
  <section className="space-y-4"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">ASSIGNED HOTELS</p><h2 className="mt-2 text-xl font-bold">Your hotel work</h2><p className="mt-1 text-[10px] leading-relaxed text-[#737A8B]">Managers control rooms and availability. Hotel Staff handle front-desk arrivals and departures. Neither role can change ownership or team access.</p></div>
  {loading?<div className="min-h-40" role="status" aria-label="Loading assigned hotels"/>:hotels.length===0?<div className="rounded-2xl border border-dashed border-white/[.08] p-10 text-center text-xs text-[#687080]">No active hotel assignment is available.</div>:<div className="grid gap-3 sm:grid-cols-2">{hotels.map(hotel=><button key={hotel.hotel_id} onClick={()=>setSelected(hotel)} className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#10141C] text-left"><div className="h-32 bg-[#171B24]">{hotel.images?.[0]&&<img src={hotel.images[0]} alt="" className="h-full w-full object-cover"/>}</div><div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{hotel.name}</p><p className="mt-1 text-[9px] text-[#6D7485]">{[hotel.city,hotel.state].filter(Boolean).join(', ')}</p></div><span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-semibold uppercase text-violet-300">{hotel.access_role}</span></div></div></button>)}</div>}
  </section>
 </AccountShell>;
}
