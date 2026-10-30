import { useCallback, useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { toast } from "sonner";
import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import {
  partnerClearHotelDiscount,
  partnerListHotelDiscounts,
  partnerSetHotelDiscount,
  type HotelDiscountRow,
} from "@/lib/supabase/hotels";

type RoomOption = { room_id: number; room_type: string; rate_plans?: { rate_plan_id: number; name: string }[] };

// Scope is the hotel's choice: the whole hotel, one room type, or one room package.
export default function PartnerHotelDiscounts({ hotelId, rooms }: { hotelId: number; rooms: RoomOption[] }) {
  const [rows, setRows] = useState<HotelDiscountRow[] | null>(null);
  const [roomId, setRoomId] = useState("");
  const [planId, setPlanId] = useState("");
  const [percent, setPercent] = useState("10");
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure,setFailure]=useState("");
  const pending=useRef(false),generation=useRef(0),readSequence=useRef(0);
  const room = rooms.find((r) => String(r.room_id) === roomId);

  const load = useCallback(async () => {
    const screen=generation.current,request=++readSequence.current;
    try{
      const {discounts,error}=await withTimeout(partnerListHotelDiscounts(hotelId),15000,"Discounts could not be confirmed. Refresh before changing them.");
      if(screen!==generation.current||request!==readSequence.current)return null;
      if(error)throw error;
      if(!Array.isArray(discounts)||discounts.some(row=>!row||typeof row.id!=="string"||!Number.isFinite(Number(row.percent))||Number(row.percent)<0||Number(row.percent)>100||!['host','wehouse'].includes(row.funded_by)))throw new Error("Discounts could not be confirmed.");
      setRows(discounts);setFailure("");return discounts;
    }catch(error){if(screen===generation.current&&request===readSequence.current){setRows(null);setFailure(error instanceof Error?error.message:"Discounts could not be loaded.");}return null;}
  }, [hotelId]);
  useEffect(()=>{generation.current++;pending.current=false;setBusy(false);setRows(null);setFailure("");setRoomId("");setPlanId("");setPercent("");setEndsOn("");void load();return()=>{generation.current++;readSequence.current++;};},[load]);

  const scopeLabel = (row: HotelDiscountRow) => {
    if (row.room_id === null) return "Whole hotel";
    const r = rooms.find((x) => x.room_id === row.room_id);
    const p = r?.rate_plans?.find((x) => x.rate_plan_id === row.rate_plan_id);
    return p ? `${r?.room_type} · ${p.name}` : r?.room_type ?? "Room";
  };

  async function save() {
    const value=Number(percent);
    if(!Number.isFinite(value)||value<5||value>50)return toast.error("A discount must be between 5% and 50%");
    if(pending.current||rows===null)return;
    pending.current=true;setBusy(true);setFailure("");const screen=generation.current;
    try{
      const {id,error}=await withTimeout(partnerSetHotelDiscount({hotelId,roomId:roomId?Number(roomId):null,ratePlanId:roomId&&planId?Number(planId):null,percent:value,endsOn:endsOn||null}),15000,"The discount may have saved. Refresh before retrying.");
      if(screen!==generation.current)return;if(error)throw error;
      if(typeof id!=="string"||!id)throw new Error("The discount receipt could not be confirmed. Refresh before retrying.");
      const saved=await load();if(saved){if(!saved.some(row=>row.id===id&&Number(row.percent)===value))throw new Error("The saved discount could not be confirmed. Refresh before retrying.");toast.success("Discount saved for new bookings.");}
    }catch(error){if(screen===generation.current){setRows(null);setFailure(error instanceof Error?error.message:"The discount could not be confirmed. Refresh before retrying.");}}
    finally{if(screen===generation.current){pending.current=false;setBusy(false);}}
  }
  async function clear(id:string){
    if(pending.current||rows===null)return;pending.current=true;setBusy(true);setFailure("");const screen=generation.current;
    try{
      const {error}=await withTimeout(partnerClearHotelDiscount(id),15000,"Discount removal could not be confirmed. Refresh before retrying.");
      if(screen!==generation.current)return;if(error)throw error;
      const saved=await load();if(saved){if(saved.some(row=>row.id===id))throw new Error("Discount removal could not be confirmed. Refresh before retrying.");toast.success("Discount removed.");}
    }catch(error){if(screen===generation.current){setRows(null);setFailure(error instanceof Error?error.message:"Discount removal could not be confirmed.");}}
    finally{if(screen===generation.current){pending.current=false;setBusy(false);}}
  }

  const field = "mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm";
  return (
    <section className="mt-6 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      <h3 className="text-base font-bold">Discounts (optional)</h3>
      <p className="mt-1 text-sm text-[var(--wh-text-secondary)]">Keep your standard rates or offer a discount. Existing bookings keep their agreed price.</p>
      {failure&&<div role="alert" className="mt-3 text-sm"><p>{failure}</p><button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 font-semibold">Refresh discounts</button></div>}
      <p className="mt-1 text-sm leading-5 text-[var(--wh-text-secondary)]">Choose what the discount covers. Guests see the normal price crossed out and your discount. A WeHouse-funded discount never reduces what you are paid. The narrowest discount that applies is used; they do not add up.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--wh-text-muted)]">Covers
          <select className={field} value={roomId} onChange={(e) => { setRoomId(e.target.value); setPlanId(""); }}>
            <option value="">Whole hotel</option>
            {rooms.map((r) => <option key={r.room_id} value={r.room_id}>{r.room_type}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--wh-text-muted)]">Package
          <select className={field} value={planId} disabled={!room} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">All packages of this room</option>
            {room?.rate_plans?.map((p) => <option key={p.rate_plan_id} value={p.rate_plan_id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--wh-text-muted)]">Discount (5–50%)
          <input className={field} type="number" inputMode="numeric" min={5} max={50} value={percent} onChange={(e) => setPercent(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--wh-text-muted)]">Last check-in date (optional)
          <input className={field} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
      </div>
      <button type="button" disabled={busy||rows===null||!percent} onClick={() => void save()} className="mt-3 min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-60">Save discount</button>
      <div className="mt-4 space-y-2">
        {rows === null ? failure?null:<WeHouseLoadingState compact label="Loading discounts" />
          : rows.length === 0 ? <p className="text-sm text-[var(--wh-text-secondary)]">No active discounts.</p>
          : rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--wh-border-subtle)] p-3 text-sm">
              <div><strong>{row.percent}% off</strong> · {scopeLabel(row)}{row.funded_by === "wehouse" ? " · paid by WeHouse" : ""}<p className="text-xs text-[var(--wh-text-muted)]">{row.ends_on ? `Until check-in ${row.ends_on}` : "No end date"}</p></div>
              {row.funded_by === "host" ? <button type="button" disabled={busy} onClick={() => void clear(row.id)} className="min-h-10 rounded-lg border border-[var(--wh-border-subtle)] px-3 text-xs font-semibold">Remove</button> : null}
            </div>
          ))}
      </div>
    </section>
  );
}
