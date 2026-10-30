import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import BookingDateField from '@/components/BookingDateField';
import { displayDate } from '@/lib/displayDate';

type Row = { id: string; hotel_id: number | null; hotel_name: string | null; room_id: number | null; rate_plan_id: number | null; percent: number; ends_on: string | null };
type Hotel = { hotel_id: number; name: string };

export default function CreatorHotelDiscounts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelId, setHotelId] = useState("");
  const [percent, setPercent] = useState("");
  const [endsOn,setEndsOn]=useState('');
  const [busy, setBusy] = useState(false);
  const [ceiling, setCeiling] = useState(0);
  const actionLock=useRef(false);
  const [loadError,setLoadError]=useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("creator_list_wehouse_hotel_discounts");
    if(error||!Array.isArray(data)){setLoadError(true);toast.error(error?.message || "Hotel discounts could not be confirmed");return null;}
    setLoadError(false);
    const rows=data as Row[];setRows(rows);return rows;
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refreshCeiling=useCallback(async()=>{const {data,error}=await supabase.rpc('wehouse_hotel_discount_ceiling');const value=Number(data);setCeiling(!error&&data!==null&&Number.isFinite(value)&&value>=0&&value<=50?value:0);},[]);
  useEffect(() => {
    void refreshCeiling();
    void supabase.from("hotels").select("hotel_id,name").eq("status", "active").order("name").limit(200)
      .then(({ data }) => setHotels((data as Hotel[]) || []));
  }, [refreshCeiling]);

  async function save() {
    if(actionLock.current)return;
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 5 || value > ceiling) return toast.error(`WeHouse-funded discounts are 5–${ceiling}% (the hotel commission)`);
    actionLock.current=true;setBusy(true);
    try{
    const { data,error } = await supabase.rpc("creator_set_wehouse_hotel_discount", {
      p_hotel_id: hotelId ? Number(hotelId) : null, p_room_id: null, p_rate_plan_id: null, p_percent: value, p_ends_on:endsOn||null,
    });
    if (error) throw error;
    const confirmed=await load();
    if(typeof data!=='string'||!confirmed?.some(row=>row.id===data&&Number(row.percent)===value&&(row.ends_on||null)===(endsOn||null)))throw new Error('The saved hotel discount could not be confirmed. Refresh the list before retrying.');
    setPercent(""); setHotelId("");setEndsOn('');
    toast.success("WeHouse hotel discount started for new bookings");
    }catch(error){toast.error(error instanceof Error?error.message:(error as {message?:string})?.message||'Discount could not be confirmed. Refresh before retrying.');}
    finally{actionLock.current=false;setBusy(false);}
  }

  async function stop(id: string) {
    if(actionLock.current)return;actionLock.current=true;setBusy(true);
    try{
    const { error } = await supabase.rpc("creator_stop_wehouse_hotel_discount", { p_id: id });
    if (error) throw error;
    const confirmed=await load();
    if(!confirmed||confirmed.some(row=>row.id===id))throw new Error('The stop could not be confirmed. Refresh the list before retrying.');
    toast.success("Discount stopped");
    }catch(error){toast.error(error instanceof Error?error.message:(error as {message?:string})?.message||'The stop could not be confirmed. Refresh before retrying.');}
    finally{actionLock.current=false;setBusy(false);}
  }

  return (
    <section className="mt-6 border-t border-[var(--wh-border-subtle)] pt-5">
      <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">WeHouse-funded hotel discount</p>
      <p className="mt-1 text-[10px] leading-5 text-[var(--wh-text-secondary)]">Fund an offer from WeHouse’s Hotel commission within the configured limit. The hotel keeps its agreed share; the discount comes from WeHouse’s commission. Host and WeHouse discounts together never pass 50%.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_7rem_auto]">
        <select value={hotelId} onChange={(e) => setHotelId(e.target.value)} aria-label="Hotel" className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-xs">
          <option value="">All hotels</option>
          {hotels.map((h) => <option key={h.hotel_id} value={h.hotel_id}>{h.name}</option>)}
        </select>
        <input value={percent} inputMode="decimal" onChange={(e) => setPercent(e.target.value)} placeholder={ceiling>=5?`5–${ceiling} %`:'Unavailable'} aria-label="Discount percent" className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs" />
        <button type="button" disabled={busy || !percent || ceiling<5 || loadError} onClick={() => void save()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35">Start</button>
      </div>
      <div className="mt-3 max-w-sm"><BookingDateField label="Hotel discount end date (optional)" value={endsOn} onChange={setEndsOn} context="WeHouse-funded offer"/>{endsOn&&<button type="button" className="mt-1 min-h-9 text-xs underline" onClick={()=>setEndsOn('')}>Keep running until stopped</button>}</div>
      <button type="button" disabled={busy} className="mt-2 min-h-9 text-xs underline" onClick={()=>{void load();void refreshCeiling();}}>Refresh Hotel discounts</button>
      {ceiling<5&&<p className="text-xs text-[var(--wh-text-secondary)]">Confirm an eligible commission limit before starting a funded offer.</p>}
      {loadError&&<p role="alert" className="text-sm">Saved Hotel discounts could not be loaded. Refresh before changing this offer.</p>}
      {rows.length ? (
        <div className="mt-3 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[11px]">{row.hotel_name || "All hotels"} · {row.percent}% · {row.ends_on?`Through ${displayDate(row.ends_on)}`:'Until stopped'}</span>
              <button type="button" disabled={busy} onClick={() => void stop(row.id)} className="min-h-10 text-[10px] font-semibold text-violet-300 disabled:opacity-35">Stop</button>
            </div>
          ))}
        </div>
      ) : (
        !loadError&&<p className="mt-3 text-[10px] text-[var(--wh-text-muted)]">No WeHouse-funded hotel discounts running.</p>
      )}
    </section>
  );
}
