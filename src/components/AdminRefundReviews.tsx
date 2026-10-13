import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import WeHouseLoadingState from "@/components/WeHouseLoadingState";

type Review = {
  review_id: string; worker_booking_id: string; kind: string; reason: string; status: string; created_at: string;
  amount_total: number | null; released_amount: number | null; refunded_amount: number | null;
  refund_percent: number | null; refund_amount: number | null; max_refund_percent: number;
};
const KINDS: Record<string, string> = {
  customer_cancel_after_start: "Customer no longer wants the job",
  worker_no_show: "Worker did not show up",
  worker_not_delivered: "Work not delivered",
};
const money = (n: number | null) => `₦${Number(n ?? 0).toLocaleString()}`;

export default function AdminRefundReviews() {
  const [status, setStatus] = useState<"open" | "decided">("open");
  const [rows, setRows] = useState<Review[] | null>(null);
  const [percent, setPercent] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await supabase.rpc("list_worker_refund_reviews", { p_status: status });
    if (error) {
      toast.error(error.message || "Could not load refund reviews");
      return setRows([]);
    }
    setRows((data ?? []) as Review[]);
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function decide(row: Review) {
    const pct = Number(percent[row.review_id]);
    if (!Number.isFinite(pct) || pct < 0 || pct > row.max_refund_percent) return toast.error(`Enter a refund between 0 and ${row.max_refund_percent}%`);
    if ((note[row.review_id] ?? "").trim().length < 5) return toast.error("Write the reason for your decision");
    setBusy(row.review_id);
    const { error } = await supabase.rpc("decide_worker_refund", { p_review_id: row.review_id, p_refund_percent: pct, p_reason: note[row.review_id].trim() });
    setBusy(null);
    if (error) return toast.error(error.message || "Decision could not be saved");
    toast.success("Decision saved. The refund and any Worker payment are queued once.");
    void load();
  }

  return (
    <section className="space-y-3" aria-label="Refund reviews">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Service Worker refund reviews</h2>
        <div className="flex gap-2">
          {(["open", "decided"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
              className={`min-h-10 rounded-full border px-4 text-xs font-semibold capitalize ${status === s ? "border-violet-400 bg-[var(--wh-interactive)]" : "border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}>{s}</button>
          ))}
        </div>
      </div>
      {rows === null ? <WeHouseLoadingState compact label="Loading refund reviews" />
        : rows.length === 0 ? <p className="rounded-2xl border border-[var(--wh-border-subtle)] p-5 text-sm text-[var(--wh-text-secondary)]">No {status} refund reviews.</p>
        : rows.map((row) => (
          <article key={row.review_id} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{KINDS[row.kind] ?? row.kind}</strong>
              <time className="text-[11px] text-[var(--wh-text-muted)]" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
            </div>
            <p className="mt-2 whitespace-pre-line text-xs leading-5 text-[var(--wh-text-secondary)]">{row.reason}</p>
            <p className="mt-2 text-[11px] text-[var(--wh-text-muted)]">Paid {money(row.amount_total)} · already released {money(row.released_amount)} · already refunded {money(row.refunded_amount)}</p>
            {status === "decided" ? (
              <p className="mt-2 text-xs">Refunded {row.refund_percent ?? 0}% ({money(row.refund_amount)})</p>
            ) : (
              <div className="mt-3 space-y-2">
                <label className="block text-[11px] text-[var(--wh-text-muted)]">Refund to the customer (0 to {row.max_refund_percent}% of what remains protected)
                  <input type="number" min={0} max={row.max_refund_percent} inputMode="numeric" value={percent[row.review_id] ?? ""} onChange={(e) => setPercent({ ...percent, [row.review_id]: e.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm" />
                </label>
                <textarea rows={2} value={note[row.review_id] ?? ""} onChange={(e) => setNote({ ...note, [row.review_id]: e.target.value })} placeholder="Reason for your decision"
                  className="w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-transparent p-3 text-sm" />
                <button type="button" disabled={busy === row.review_id} onClick={() => void decide(row)} className="min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-60">{busy === row.review_id ? "Saving…" : "Save decision"}</button>
              </div>
            )}
          </article>
        ))}
    </section>
  );
}
