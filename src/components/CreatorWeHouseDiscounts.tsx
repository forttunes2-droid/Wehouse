import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Row = { id: string; state_key: string | null; listing_id: string | null; percent: number; ends_on: string | null };

export default function CreatorWeHouseDiscounts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [ceiling, setCeiling] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("creator_list_wehouse_discounts");
    if (error) return toast.error(error.message || "Discounts could not be loaded");
    setRows((data as Row[]) || []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void supabase.rpc("wehouse_discount_ceiling").then(({ data }) => setCeiling(Number(data || 0)));
  }, []);

  async function save() {
    const value = Number(percent);
    if (!state.trim()) return toast.error("Enter a state");
    if (!Number.isFinite(value) || value < 5 || value > ceiling) return toast.error(`WeHouse-funded discounts are 5–${ceiling}% (your commission)`);
    setBusy(true);
    const { error } = await supabase.rpc("creator_set_wehouse_discount", { p_listing_id: null, p_state: state.trim(), p_percent: value });
    setBusy(false);
    if (error) return toast.error(error.message || "Discount could not be saved");
    setState(""); setPercent(""); await load();
    toast.success("WeHouse discount started for new bookings");
  }

  async function stop(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("creator_stop_wehouse_discount", { p_id: id });
    setBusy(false);
    if (error) return toast.error(error.message || "Discount could not be stopped");
    await load();
    toast.success("Discount stopped");
  }

  return (
    <section className="mt-6 border-t border-[var(--wh-border-subtle)] pt-5">
      <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">WeHouse-funded discount</p>
      <p className="mt-1 text-[10px] leading-5 text-[var(--wh-text-secondary)]">WeHouse pays at least 5% and at most its own commission ({ceiling}% now) of the nightly price for every Short Let in a state. It adds to any host discount, up to 50% in total, and only affects new bookings.</p>
      <div className="mt-3 flex gap-2">
        <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State, e.g. Lagos" aria-label="State" className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm outline-none" />
        <input value={percent} inputMode="numeric" onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} placeholder={`5–${ceiling} %`} aria-label="Discount percent" className="h-11 w-24 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm outline-none" />
        <button type="button" disabled={busy || !state || !percent} onClick={() => void save()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35">Start</button>
      </div>
      {rows.length ? (
        <div className="mt-3 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[11px]">{row.state_key || "One property"} · {row.percent}%</span>
              <button type="button" disabled={busy} onClick={() => void stop(row.id)} className="min-h-10 text-[10px] font-semibold text-violet-300 disabled:opacity-35">Stop</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[10px] text-[var(--wh-text-muted)]">No WeHouse-funded discounts running.</p>
      )}
    </section>
  );
}
