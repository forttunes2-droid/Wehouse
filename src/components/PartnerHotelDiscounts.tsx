import { useCallback, useEffect, useState } from "react";
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
  const room = rooms.find((r) => String(r.room_id) === roomId);

  const load = useCallback(async () => {
    const { discounts, error } = await partnerListHotelDiscounts(hotelId);
    if (error) toast.error(error.message || "Discounts could not be loaded");
    setRows(discounts);
  }, [hotelId]);
  useEffect(() => { void load(); }, [load]);

  const scopeLabel = (row: HotelDiscountRow) => {
    if (row.room_id === null) return "Whole hotel";
    const r = rooms.find((x) => x.room_id === row.room_id);
    const p = r?.rate_plans?.find((x) => x.rate_plan_id === row.rate_plan_id);
    return p ? `${r?.room_type} · ${p.name}` : r?.room_type ?? "Room";
  };

  async function save() {
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 5 || value > 50) return toast.error("A discount must be between 5% and 50%");
    setBusy(true);
    const { error } = await partnerSetHotelDiscount({
      hotelId, roomId: roomId ? Number(roomId) : null, ratePlanId: roomId && planId ? Number(planId) : null,
      percent: value, endsOn: endsOn || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "Discount could not be saved");
    toast.success("Discount saved. Guests see the original price and your discount.");
    await load();
  }

  async function clear(id: string) {
    setBusy(true);
    const { error } = await partnerClearHotelDiscount(id);
    setBusy(false);
    if (error) return toast.error(error.message || "Discount could not be removed");
    await load();
  }

  const field = "mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm";
  return (
    <section className="mt-6 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      <h3 className="text-base font-bold">Discounts</h3>
      <p className="mt-1 text-sm leading-5 text-[var(--wh-text-secondary)]">Choose what the discount covers. Guests see the normal price crossed out and your discount. The narrowest discount that applies is used; they do not add up.</p>
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
      <button type="button" disabled={busy} onClick={() => void save()} className="mt-3 min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-60">Save discount</button>
      <div className="mt-4 space-y-2">
        {rows === null ? <WeHouseLoadingState compact label="Loading discounts" />
          : rows.length === 0 ? <p className="text-sm text-[var(--wh-text-secondary)]">No active discounts.</p>
          : rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--wh-border-subtle)] p-3 text-sm">
              <div><strong>{row.percent}% off</strong> · {scopeLabel(row)}<p className="text-xs text-[var(--wh-text-muted)]">{row.ends_on ? `Until check-in ${row.ends_on}` : "No end date"}</p></div>
              <button type="button" disabled={busy} onClick={() => void clear(row.id)} className="min-h-10 rounded-lg border border-[var(--wh-border-subtle)] px-3 text-xs font-semibold">Remove</button>
            </div>
          ))}
      </div>
    </section>
  );
}
