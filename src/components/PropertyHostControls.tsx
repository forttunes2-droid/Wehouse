import { useCallback, useEffect, useRef, useState } from "react";
import { currencySymbol } from "@/lib/regional";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/withTimeout";
import BookingDateField from "@/components/BookingDateField";
import { formatMoney } from "@/lib/regional";

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



function displayDate(value:string){
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
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
  const [discount,setDiscount]=useState("");
  const [discountEnds,setDiscountEnds]=useState("");
  const [discountEndsOn,setDiscountEndsOn]=useState<string|null>(null);
  const [activeDiscount,setActiveDiscount]=useState(0);

  const [loadError,setLoadError]=useState("");
  const [actionError,setActionError]=useState("");
  const [discountError,setDiscountError]=useState("");
  const [hostDiscount,setHostDiscount]=useState(0);
  const generation=useRef(0);
  const readSequence=useRef(0);
  const discountSequence=useRef(0);
  const pending=useRef(false);
  const money=(value:number)=>formatMoney(value,{currency:state?.currency});

  function controls(value:unknown):HostControlsState {
    const row=value as HostControlsState|null;
    if(!row||row.listing_id!==listingId||typeof row.accepting_reservations!=="boolean"||typeof row.can_manage_commercials!=="boolean"||typeof row.currency!=="string"||! /^[A-Z]{3}$/.test(row.currency)||!Number.isFinite(Number(row.price))||Number(row.price)<=0||!Array.isArray(row.date_blocks)||row.date_blocks.some(block=>!block||typeof block.block_id!=="string"||typeof block.start_date!=="string"||typeof block.reopen_date!=="string"))throw new Error("Hosting controls could not be confirmed. Refresh before retrying.");
    return row;
  }
  const load=useCallback(async()=>{
    const request=++readSequence.current,screen=generation.current;
    setLoading(true);setLoadError("");
    try{
      const {data,error}=await withTimeout(supabase.rpc("get_my_property_host_controls",{p_listing_id:listingId}),15000,"Hosting controls timed out. Try again.");
      if(screen!==generation.current||request!==readSequence.current)return;
      if(error)throw error;
      const row=data as HostControlsState|null;
      if(!row||row.listing_id!==listingId||typeof row.accepting_reservations!=="boolean"||typeof row.can_manage_commercials!=="boolean"||typeof row.currency!=="string"||! /^[A-Z]{3}$/.test(row.currency)||!Number.isFinite(Number(row.price))||Number(row.price)<=0||!Array.isArray(row.date_blocks)||row.date_blocks.some(block=>!block||typeof block.block_id!=="string"||typeof block.start_date!=="string"||typeof block.reopen_date!=="string"))throw new Error("Hosting controls could not be confirmed.");
      setState(row);setPrice(String(row.price));
    }catch(error){if(screen===generation.current&&request===readSequence.current){setState(null);setLoadError(error instanceof Error?error.message:"Hosting controls could not be loaded.");}}
    finally{if(screen===generation.current&&request===readSequence.current)setLoading(false);}
  },[listingId]);

  const loadDiscount=useCallback(async()=>{
    const screen=generation.current,request=++discountSequence.current;
    try{
      const {data,error}=await withTimeout(supabase.rpc("listing_discount_breakdown",{p_listing_id:listingId}),15000,"Discount could not be confirmed. Refresh before changing it.");
      if(screen!==generation.current||request!==discountSequence.current)return null;
      if(error)throw error;
      if(!data||!Number.isFinite(Number(data.total_percent))||!Number.isFinite(Number(data.host_percent))||Number(data.total_percent)<0||Number(data.total_percent)>100)throw new Error("Discount could not be confirmed.");
      setActiveDiscount(Number(data.total_percent));setHostDiscount(Number(data.host_percent));setDiscountEndsOn(data.ends_on||null);setDiscountError("");return {hostPercent:Number(data.host_percent)};
    }catch(error){if(screen===generation.current&&request===discountSequence.current)setDiscountError(error instanceof Error?error.message:"Discount could not be loaded.");return null;}
  },[listingId]);

  useEffect(()=>{
    generation.current++;pending.current=false;setBusy("");setState(null);setActionError("");setDiscountError("");setActiveDiscount(0);setHostDiscount(0);setDiscountEndsOn(null);setDiscount("");setDiscountEnds("");setFrom("");setReopen("");
    void load();void loadDiscount();
    return()=>{generation.current++;readSequence.current++;discountSequence.current++;};
  },[load,loadDiscount]);

  async function mutate(key:string,task:()=>PromiseLike<{data:unknown;error:unknown}>,accept:(data:unknown)=>Promise<void>|void){
    if(pending.current||actionError)return;
    pending.current=true;setBusy(key);setActionError("");
    const screen=generation.current;
    try{
      const {data,error}=await withTimeout(task(),15000,"The change could not be confirmed. Refresh controls before retrying; it may already have been saved.");
      if(screen!==generation.current)return;
      if(error)throw error;
      await accept(data);
      if(screen===generation.current)onChanged?.();
    }catch(error){if(screen===generation.current)setActionError(error instanceof Error?error.message:"The change could not be confirmed. Refresh controls before retrying.");}
    finally{if(screen===generation.current){pending.current=false;setBusy("");}}
  }
  async function saveDiscount(){
    const percent=Number(discount);
    if(!Number.isFinite(percent)||percent<5||percent>50)return toast.error("A discount must be between 5% and 50%");
    await mutate("discount",()=>supabase.rpc("set_my_listing_discount",{p_listing_id:listingId,p_percent:percent,p_ends_on:discountEnds||null}),async data=>{
      if(typeof data!=="string"||!data)throw new Error("Discount receipt could not be confirmed. Refresh before retrying.");
      setDiscount("");setDiscountEnds("");const result=await loadDiscount();if(result){if(result.hostPercent!==percent)throw new Error("The saved discount did not match. Refresh before retrying.");toast.success("Discount saved for new bookings");}
    });
  }
  async function removeDiscount(){
    await mutate("discount",()=>supabase.rpc("clear_my_listing_discount",{p_listing_id:listingId}),async()=>{const result=await loadDiscount();if(result){if(result.hostPercent!==0)throw new Error("Discount removal could not be confirmed. Refresh before retrying.");toast.success("Your discount was removed");}});
  }
  async function savePrice(){
    const amount=Number(price);
    if(!Number.isFinite(amount)||amount<=0)return toast.error("Enter a valid price");
    await mutate("price",()=>supabase.rpc("set_my_property_future_price",{p_listing_id:listingId,p_price:amount}),data=>{
      const next=controls(data);if(Math.abs(Number(next.price)-Math.round(amount*100)/100)>0.001)throw new Error("The saved price did not match. Refresh controls.");
      setState(next);setPrice(String(next.price));toast.success("Future price updated");
    });
  }
  async function toggleBookings(){
    if(!state)return;const accepting=!state.accepting_reservations;
    await mutate("availability",()=>supabase.rpc("set_my_property_booking_availability",{p_listing_id:listingId,p_accepting:accepting}),data=>{
      const next=controls(data);if(next.accepting_reservations!==accepting)throw new Error("Booking availability could not be confirmed. Refresh controls.");
      setState(next);toast.success(accepting?"Bookings opened":"Bookings paused");
    });
  }
  async function closeDates(){
    if(!from||!reopen)return toast.error("Choose the dates");
    if(reopen<=from)return toast.error("Reopen date must be after the start date");
    await mutate("dates",()=>supabase.rpc("block_my_property_dates",{p_listing_id:listingId,p_start_date:from,p_reopen_date:reopen}),data=>{
      const next=controls(data);if(!next.date_blocks.some(block=>block.start_date<=from&&block.reopen_date>=reopen))throw new Error("Closed dates could not be confirmed. Refresh controls.");
      setState(next);setFrom("");setReopen("");toast.success("Dates closed");
    });
  }
  async function openDates(blockId:string){
    await mutate(blockId,()=>supabase.rpc("unblock_my_property_dates",{p_block_id:blockId}),data=>{
      const next=controls(data);if(next.date_blocks.some(block=>block.block_id===blockId))throw new Error("Reopened dates could not be confirmed. Refresh controls.");
      setState(next);toast.success("Dates reopened");
    });
  }

  if(loading||(state&&state.listing_id!==listingId))return <section className="border-b border-[var(--wh-border-subtle)] py-5"><p className="text-[10px] text-[var(--wh-text-secondary)]">Loading hosting controls…</p></section>;
  if(!state)return <section role="alert" className="border-b border-[var(--wh-border-subtle)] py-5"><p className="text-sm text-[var(--wh-text-secondary)]">{loadError||"Hosting controls are unavailable."}</p><button type="button" onClick={()=>void load()} className="min-h-10 text-[10px] font-semibold text-violet-700 dark:text-violet-300">Retry hosting controls</button></section>;

  const shortLet=(state.sub_type||subType)==="short_let";
  const hotelLike=!shortLet&&(state.sub_type||subType)!=="long_stay";
  const currentPrice=Number(state.price||0);
  const canManageCommercials=Boolean(state.can_manage_commercials);

  if(!canManageCommercials)return <section className="border-b border-[var(--wh-border-subtle)] py-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-700 dark:text-violet-300">Hosting access</p>
        <p className="mt-1 text-sm font-semibold">Operations</p>
      </div>
      <span className="rounded-full border border-[var(--wh-border-subtle)] px-2.5 py-1 text-[9px] font-semibold text-[var(--wh-text-secondary)]">Guest operations</span>
    </div>
    <p className="mt-2 text-[9px] leading-5 text-[var(--wh-text-muted)]">You can operate assigned stays and guest handovers. Future price, booking availability and closed dates stay with the owner or a Full hosting co-host.</p>
  </section>;

  return <section className="border-b border-[var(--wh-border-subtle)] py-5">
    {actionError&&<div role="alert" className="mb-4 rounded-xl border border-[var(--wh-border-subtle)] p-3 text-sm"><p>{actionError}</p><button type="button" disabled={Boolean(busy)} onClick={()=>{setActionError("");void load();void loadDiscount();}} className="mt-2 min-h-11 font-semibold">Refresh controls</button></div>}
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-700 dark:text-violet-300">Hosting controls</p>
        <p className="mt-1 text-sm font-semibold">{state.accepting_reservations?"Accepting reservations":"Bookings paused"}</p>
      </div>
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={()=>void toggleBookings()}
        className={`min-h-10 rounded-xl border px-3 text-[10px] font-semibold disabled:opacity-40 ${state.accepting_reservations?"border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]":"border-violet-500/25 bg-violet-500/[.07] text-violet-700 dark:text-violet-200"}`}
      >
        {busy==="availability"?"Saving…":state.accepting_reservations?"Pause bookings":"Open bookings"}
      </button>
    </div>

    <div className="mt-4">
      <label className="text-[9px] font-semibold text-[var(--wh-text-secondary)]">{shortLet?"Nightly price":"Rent"}</label>
      <div className="mt-1.5 flex gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3">
          <span className="mr-1 text-xs text-[var(--wh-text-muted)]">{currencySymbol(state.currency)}</span>
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
      <p className="mt-1.5 text-xs text-[var(--wh-text-secondary)]">Booking currency: {state.currency?.toUpperCase()||"Not confirmed"}. {shortLet?`${money(currentPrice)} per night`:money(currentPrice)}</p>
    </div>

    {hotelLike?null:<div className="mt-5 border-t border-[var(--wh-border-subtle)] pt-4">
      <h4 className="text-xs font-semibold">Discount (optional)</h4>
      <p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Keep your standard price or offer a discount for new bookings. You can remove your discount later.</p>
      {discountError&&<div role="alert" className="mt-2 text-sm"><p>{discountError}</p><button type="button" disabled={Boolean(busy)} onClick={()=>void loadDiscount()} className="min-h-11 font-semibold">Refresh discount</button></div>}
      <p className="mt-1 text-[9px] leading-5 text-[var(--wh-text-muted)]">{shortLet?"Take 5–50% off the nightly price for new bookings. Stays already booked keep the price they were quoted.":"Take 5–50% off the Year 1 rent for new reservations. Later years stay at the full rent, and reservations already made keep the price they were quoted."}</p>
      <div className="mt-2 flex gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3">
          <input
            inputMode="numeric"
            value={discount}
            placeholder="5–50"
            onChange={event=>setDiscount(event.target.value.replace(/[^0-9]/g,"").slice(0,2))}
            aria-label="Discount percent"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          />
          <span className="ml-1 text-xs text-[var(--wh-text-muted)]">%</span>
        </div>
        <button type="button" disabled={Boolean(busy)||Boolean(discountError)||!discount} onClick={()=>void saveDiscount()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35">{busy==="discount"?"Saving…":"Save"}</button>
      </div>
      <div className="mt-2">
        <BookingDateField label="Ends on (optional, otherwise it runs until you remove it)" value={discountEnds} min={new Date().toISOString().slice(0,10)} onChange={setDiscountEnds} context="Discount" />
      </div>
      {activeDiscount>0?<div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[9px] text-[var(--wh-text-secondary)]">{shortLet?`Guests now pay ${money(currentPrice*(1-activeDiscount/100))} per night`:`New renters pay ${money(currentPrice*(1-activeDiscount/100))} for Year 1`} ({activeDiscount}% off{discountEndsOn?`, until ${discountEndsOn}`:""})</p>
        <button type="button" disabled={Boolean(busy)||Boolean(discountError)||hostDiscount<=0} onClick={()=>void removeDiscount()} className="min-h-10 text-[10px] font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-35">Remove mine</button>
      </div>:null}
    </div>}

    {shortLet?<div className="mt-5 border-t border-[var(--wh-border-subtle)] pt-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold">Closed dates</h4>
        {state.min_nights&&state.max_nights?<span className="text-[9px] text-[var(--wh-text-muted)]">{state.min_nights}–{state.max_nights} nights</span>:null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <BookingDateField label="From" value={from} onChange={setFrom} context="Closed dates" />
        <BookingDateField label="Reopen on" value={reopen} min={from || undefined} onChange={setReopen} context="Closed dates" />
      </div>
      <button type="button" disabled={Boolean(busy)||!from||!reopen} onClick={()=>void closeDates()} className="mt-2 min-h-11 w-full rounded-xl border border-violet-500/20 text-[10px] font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-35">{busy==="dates"?"Saving…":"Close dates"}</button>

      {state.date_blocks?.length?<div className="mt-3 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
        {state.date_blocks.map(block=><div key={block.block_id} className="flex items-center gap-3 py-3">
          <p className="min-w-0 flex-1 text-[10px] font-medium">{displayDate(block.start_date)} → {displayDate(block.reopen_date)}</p>
          <button type="button" disabled={Boolean(busy)} onClick={()=>void openDates(block.block_id)} className="min-h-10 px-2 text-[10px] font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-35">{busy===block.block_id?"Opening…":"Open dates"}</button>
        </div>)}
      </div>:null}
    </div>:null}
  </section>;
}
