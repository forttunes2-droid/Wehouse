import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Row = { id: string; hotel_id: number | null; hotel_name: string | null; room_id: number | null; rate_plan_id: number | null; percent: number; ends_on: string | null };
type Hotel = { hotel_id: number; name: string };

export default function CreatorHotelDiscounts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelId, setHotelId] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [ceiling, setCeiling] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("creator_list_wehouse_hotel_discounts");
    if (error) return toast.error(error.message || "Hotel discounts could not be loaded");
    setRows((data as Row[]) || []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void supabase.rpc("wehouse_hotel_discount_ceiling").then(({ data }) => setCeiling(Number(data || 0)));
    void supabase.from("hotels").select("hotel_id,name").eq("status", "active").order("name").limit(200)
      .then(({ data }) => setHotels((data as Hotel[]) || []));
  }, []);

  async function save() {
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 5 || value > ceiling) return toast.error(`WeHouse-funded discounts are 5–${ceiling}% (the hotel commission)`);
    setBusy(true);
    const { error } = await supabase.rpc("creator_set_wehouse_hotel_discount", {
      p_hotel_id: hotelId ? Number(hotelId) : null, p_room_id: null, p_rate_plan_id: null, p_percent: value, p_ends_on: null,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "Discount could not be saved");
    setPercent(""); setHotelId(""); await load();
    toast.success("WeHouse hotel discount started for new bookings");
  }

  async function stop(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("creator_stop_wehouse_hotel_discount", { p_id: id });
    setBusy(false);
    if (error) return toast.error(error.message || "Discount could not be stopped");
    await load();
    toast.success("Discount stopped");
  }

  return (
    <section className="mt-6 border-t border-[var(--wh-border-subtle)] pt-5">
      <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">WeHouse-funded hotel discount</p>
      <p className="mt-1 text-[10px] leading-5 text-[var(--wh-text-secondary)]">WeHouse pays 5% up to its hotel commission ({ceiling}% now). The hotel is still paid on its own price; the discount comes out of WeHouse's commission only. Host and WeHouse discounts together never pass 50%.</p>
      <div className="mt-3 flex gap-2">
        <select value={hotelId} onChange={(e) => setHotelId(e.target.value)} aria-label="Hotel" className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-xs">
          <option value="">All hotels</option>
          {hotels.map((h) => <option key={h.hotel_id} value={h.hotel_id}>{h.name}</option>)}
        </select>
        <input value={percent} inputMode="numeric" onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} placeholder={`5–${ceiling} %`} aria-label="Discount percent" className="h-11 w-24 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-xs" />
        <button type="button" disabled={busy || !percent} onClick={() => void save()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35">Start</button>
      </div>
      {rows.length ? (
        <div className="mt-3 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[11px]">{row.hotel_name || "All hotels"} · {row.percent}%</span>
              <button type="button" disabled={busy} onClick={() => void stop(row.id)} className="min-h-10 text-[10px] font-semibold text-violet-300 disabled:opacity-35">Stop</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[10px] text-[var(--wh-text-muted)]">No WeHouse-funded hotel discounts running.</p>
      )}
    </section>
  );
}
