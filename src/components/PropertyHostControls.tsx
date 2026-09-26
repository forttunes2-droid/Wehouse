import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type DateBlock={
  block_id:string;
  start_date:string;
  reopen_date:string;
  created_at?:string|null;
};

type HostControlsState={
  listing_id:string;
  sub_type:string;
  price:number;
  currency?:string|null;
  status:string;
  availability_status:string;
  host_booking_paused:boolean;
  accepting_reservations:boolean;
  access_level?:"operations"|"full_hosting";
  can_manage_commercials?:boolean;
  min_nights?:number|null;
  max_nights?:number|null;
  date_blocks:DateBlock[];
};

const money=(value:number)=>`₦${Number(value||0).toLocaleString("en-NG",{maximumFractionDigits:2})}`;

function displayDate(value:string){
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"});
}

export default function PropertyHostControls({
  listingId,
  subType,
  onChanged,
}:{
  listingId:string;
  subType?:string|null;
  onChanged?:()=>void;
}){
  const [state,setState]=useState<HostControlsState|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [price,setPrice]=useState("");
  const [from,setFrom]=useState("");
  const [reopen,setReopen]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.rpc("get_my_property_host_controls",{p_listing_id:listingId});
    setLoading(false);
    if(error||!data){
      setState(null);
      toast.error(error?.message||"Hosting controls could not be loaded");
      return;
    }
    const next=data as HostControlsState;
    setState(next);
    setPrice(String(Number(next.price||0)));
  },[listingId]);

  useEffect(()=>{void load()},[load]);

  async function savePrice(){
    const amount=Number(price);
    if(!Number.isFinite(amount)||amount<=0)return toast.error("Enter a valid price");
    if(busy)return;
    setBusy("price");
    const {data,error}=await supabase.rpc("set_my_property_future_price",{p_listing_id:listingId,p_price:amount});
    setBusy("");
    if(error||!data)return toast.error(error?.message||"Price could not be updated");
    const next=data as HostControlsState;
    setState(next);setPrice(String(Number(next.price||amount)));onChanged?.();
    toast.success("Future price updated");
  }

  async function toggleBookings(){
    if(!state||busy)return;
    const accepting=!state.accepting_reservations;
    setBusy("availability");
    const {data,error}=await supabase.rpc("set_my_property_booking_availability",{p_listing_id:listingId,p_accepting:accepting});
    setBusy("");
    if(error||!data)return toast.error(error?.message||"Booking availability could not be updated");
    setState(data as HostControlsState);onChanged?.();
    toast.success(accepting?"Bookings opened":"Bookings paused");
  }

  async function closeDates(){
    if(!from||!reopen)return toast.error("Choose the dates");
    if(reopen<=from)return toast.error("Reopen date must be after the start date");
    if(busy)return;
    setBusy("dates");
    const {data,error}=await supabase.rpc("block_my_property_dates",{
      p_listing_id:listingId,
      p_start_date:from,
      p_reopen_date:reopen,
    });
    setBusy("");
    if(error||!data)return toast.error(error?.message||"Those dates could not be closed");
    setState(data as HostControlsState);setFrom("");setReopen("");onChanged?.();
    toast.success("Dates closed");
  }

  async function openDates(blockId:string){
    if(busy)return;
    setBusy(blockId);
    const {data,error}=await supabase.rpc("unblock_my_property_dates",{p_block_id:blockId});
    setBusy("");
    if(error||!data)return toast.error(error?.message||"Those dates could not be reopened");
    setState(data as HostControlsState);onChanged?.();
    toast.success("Dates reopened");
  }

  if(loading)return <section className="border-b border-white/[.07] py-5"><p className="text-[10px] text-[#7C8291]">Loading hosting controls…</p></section>;
  if(!state)return <section className="border-b border-white/[.07] py-5"><button type="button" onClick={()=>void load()} className="min-h-10 text-[10px] font-semibold text-violet-300">Retry hosting controls</button></section>;

  const shortLet=(state.sub_type||subType)==="short_let";
  const currentPrice=Number(state.price||0);
  const canManageCommercials=Boolean(state.can_manage_commercials);

  if(!canManageCommercials)return <section className="border-b border-white/[.07] py-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">Hosting access</p>
        <p className="mt-1 text-sm font-semibold">Operations</p>
      </div>
      <span className="rounded-full border border-white/[.08] px-2.5 py-1 text-[9px] font-semibold text-[#A0A6B4]">Guest operations</span>
    </div>
    <p className="mt-2 text-[9px] leading-5 text-[#707687]">You can operate assigned stays and guest handovers. Future price, booking availability and closed dates stay with the owner or a Full hosting co-host.</p>
  </section>;

  return <section className="border-b border-white/[.07] py-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">Hosting controls</p>
        <p className="mt-1 text-sm font-semibold">{state.accepting_reservations?"Accepting reservations":"Bookings paused"}</p>
      </div>
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={()=>void toggleBookings()}
        className={`min-h-10 rounded-xl border px-3 text-[10px] font-semibold disabled:opacity-40 ${state.accepting_reservations?"border-white/[.08] text-[#A2A8B6]":"border-violet-500/25 bg-violet-500/[.07] text-violet-200"}`}
      >
        {busy==="availability"?"Saving…":state.accepting_reservations?"Pause bookings":"Open bookings"}
      </button>
    </div>

    <div className="mt-4">
      <label className="text-[9px] font-semibold text-[#8F95A4]">{shortLet?"Nightly price":"Rent"}</label>
      <div className="mt-1.5 flex gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-white/[.08] bg-[#151820] px-3">
          <span className="mr-1 text-xs text-[#777E8F]">₦</span>
          <input
            inputMode="decimal"
            value={price}
            onChange={event=>setPrice(event.target.value.replace(/[^0-9.]/g,""))}
            aria-label={shortLet?"Nightly price":"Rent"}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          />
        </div>
        <button
          type="button"
          disabled={Boolean(busy)||Number(price)===currentPrice}
          onClick={()=>void savePrice()}
          className="min-h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35"
        >
          {busy==="price"?"Saving…":"Save"}
        </button>
      </div>
      <p className="mt-1.5 text-[9px] text-[#686F7F]">{shortLet?`${money(currentPrice)} per night`:money(currentPrice)}</p>
    </div>

    {shortLet?<div className="mt-5 border-t border-white/[.06] pt-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold">Closed dates</h4>
        {state.min_nights&&state.max_nights?<span className="text-[9px] text-[#686F7F]">{state.min_nights}–{state.max_nights} nights</span>:null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[9px] text-[#858B9A]">From<input type="date" value={from} onChange={event=>setFrom(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-xs outline-none"/></label>
        <label className="text-[9px] text-[#858B9A]">Reopen on<input type="date" value={reopen} onChange={event=>setReopen(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-[#151820] px-3 text-xs outline-none"/></label>
      </div>
      <button type="button" disabled={Boolean(busy)||!from||!reopen} onClick={()=>void closeDates()} className="mt-2 min-h-11 w-full rounded-xl border border-violet-500/20 text-[10px] font-semibold text-violet-300 disabled:opacity-35">{busy==="dates"?"Saving…":"Close dates"}</button>

      {state.date_blocks?.length?<div className="mt-3 divide-y divide-white/[.06] border-y border-white/[.06]">
        {state.date_blocks.map(block=><div key={block.block_id} className="flex items-center gap-3 py-3">
          <p className="min-w-0 flex-1 text-[10px] font-medium">{displayDate(block.start_date)} → {displayDate(block.reopen_date)}</p>
          <button type="button" disabled={Boolean(busy)} onClick={()=>void openDates(block.block_id)} className="min-h-10 px-2 text-[10px] font-semibold text-violet-300 disabled:opacity-35">{busy===block.block_id?"Opening…":"Open dates"}</button>
        </div>)}
      </div>:null}
    </div>:null}
  </section>;
}
