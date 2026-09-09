import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type View = "payments" | "payouts" | "ledger";

export default function StaffFinanceRecords({ view }: { view: View }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_staff_finance_queue");
    if (error) toast.error(error.message);
    const result = data || {};
    setRows(
      view === "payments"
        ? result.payments || []
        : view === "payouts"
          ? [
              ...(result.withdrawals || []).map((row: any) => ({ ...row, _kind: "Withdrawal" })),
              ...(result.refunds || []).map((row: any) => ({ ...row, _kind: "Refund" })),
            ]
          : [
              ...(result.commissions || []).map((row: any) => ({ ...row, _kind: "Commission" })),
              ...(result.payment_protection || []).map((row: any) => ({ ...row, _kind: "Payment Protection" })),
              ...(result.audit || []).map((row: any) => ({ ...row, _kind: "Audit" })),
            ],
    );
    setLoading(false);
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  async function payoutAction(row: any, action: "approve" | "reject" | "reconcile") {
    const reason = action === "reject" ? rejectionReason.trim() : null;
    if (action === "reject" && !reason) return;
    setActing(row.id);
    const { data, error } = await supabase.functions.invoke("payout-withdrawal", {
      body: { action, withdrawal_id: row.id, reason: reason?.trim() },
    });
    setActing(null);
    if (error || !data?.success) {
      toast.error(data?.error || error?.message || "Payout action failed");
      return;
    }
    if (action === "reject") {
      setRejecting(null);
      setRejectionReason("");
    }
    toast.success(
      action === "approve"
        ? data.approval_required
          ? "Paystack approval is required before this transfer can continue"
          : "Transfer sent to Paystack. It remains processing until confirmed."
        : action === "reconcile"
          ? `Paystack status: ${statusLabel(data.status)}`
          : "Withdrawal rejected and held funds returned",
    );
    await load();
  }

  if (loading) return <Empty text="Loading finance records…" />;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">
          {view === "payments" ? "Payments" : view === "payouts" ? "Payouts" : "Ledger & Audit"}
        </h2>
        <p className="mt-1 text-[10px] text-[#707687]">
          {view === "payments"
            ? "Verified incoming payment records."
            : view === "payouts"
              ? "Withdrawals are reviewed here, sent through Paystack and finalized only by Paystack confirmation."
              : "Commission, Payment Protection and audit trail."}
        </p>
      </div>
      {rows.length === 0 ? (
        <Empty text="No finance records in this view." />
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const withdrawal = row._kind === "Withdrawal";
            const pending = row.status === "awaiting_review";
            const processing = row.status === "processing";
            return (
              <article key={`${row._kind || view}-${row.id || index}`} className="rounded-2xl border border-white/[.06] bg-[#10141D] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{row._kind || row.purpose || row.booking_type || "Finance record"}</p>
                    {row.owner_name && <p className="mt-1 text-[10px] text-[#A2A7B4]">{row.owner_name} · {statusLabel(row.owner_type)}</p>}
                    <p className="mt-1 break-words text-[9px] text-[#666D7E]">
                      {row.description || row.refund_reason || bankSummary(row) || row.paystack_reference || row.payment_reference || time(row.created_at)}
                    </p>
                    {row.failed_reason && <p className="mt-2 text-[9px] text-rose-300">{row.failed_reason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {money(row) && <p className="text-xs font-bold">{money(row)}</p>}
                    <p className="mt-1 text-[8px] uppercase text-[#6C7282]">{statusLabel(row.status || row.status_after || "recorded")}</p>
                  </div>
                </div>
                {withdrawal && (pending || processing) && (
                  <div className="mt-3 flex gap-2 border-t border-white/[.05] pt-3">
                    {pending && (
                      <>
                        <button type="button" disabled={acting === row.id} onClick={() => { setRejecting(row.id); setRejectionReason(""); }} className="min-h-10 flex-1 rounded-xl border border-rose-500/20 text-[9px] font-semibold text-rose-300 disabled:opacity-40">Reject</button>
                        <button type="button" disabled={acting === row.id} onClick={() => void payoutAction(row, "approve")} className="min-h-10 flex-1 rounded-xl bg-violet-500 text-[9px] font-semibold disabled:opacity-40">{acting === row.id ? "Contacting Paystack…" : "Review and send"}</button>
                      </>
                    )}
                    {processing && (
                      <button type="button" disabled={acting === row.id} onClick={() => void payoutAction(row, "reconcile")} className="min-h-10 w-full rounded-xl border border-violet-500/25 bg-violet-500/[.06] text-[9px] font-semibold text-violet-200 disabled:opacity-40">{acting === row.id ? "Checking Paystack…" : "Check Paystack status"}</button>
                    )}
                  </div>
                )}
                {withdrawal && pending && rejecting === row.id && (
                  <div className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[.04] p-3">
                    <label className="text-[9px] font-semibold text-rose-200" htmlFor={`reject-${row.id}`}>Reason for rejection</label>
                    <textarea
                      id={`reject-${row.id}`}
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      placeholder="Explain what must be corrected before another withdrawal request."
                      className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/[.08] bg-[#0B0E14] px-3 py-2 text-[10px] outline-none placeholder:text-[#555C6C] focus:border-rose-400/40"
                    />
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={acting === row.id} onClick={() => { setRejecting(null); setRejectionReason(""); }} className="min-h-9 flex-1 rounded-lg border border-white/[.08] text-[9px] font-semibold text-[#A8ADBA] disabled:opacity-40">Cancel</button>
                      <button type="button" disabled={acting === row.id || !rejectionReason.trim()} onClick={() => void payoutAction(row, "reject")} className="min-h-9 flex-1 rounded-lg bg-rose-500 text-[9px] font-semibold text-white disabled:opacity-40">{acting === row.id ? "Rejecting…" : "Confirm rejection"}</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function money(row: any) {
  const value = row.commission_amount ?? row.amount_total ?? row.amount ?? row.amount_payee;
  return value == null ? "" : `₦${Number(value).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}
function bankSummary(row: any) {
  const number = String(row.snapshot_bank_account_number || "");
  return row.snapshot_bank_name ? `${row.snapshot_bank_name} · •••• ${number.slice(-4)} · ${row.snapshot_bank_account_name || "Verified account"}` : "";
}
function statusLabel(value: any) {
  return String(value || "").replace(/_/g, " ");
}
function time(value: any) {
  return value ? new Date(value).toLocaleString() : "Recorded";
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666D7E]">{text}</div>;
}
