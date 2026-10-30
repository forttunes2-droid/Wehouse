import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";
import { formatMoney } from "@/lib/regional";
import { withTimeout } from "@/lib/withTimeout";
import { payoutActionConfirmed } from "@/lib/payoutActionReceipt";

type View = "payments" | "payouts" | "ledger";

type Props = {
  view: View;
  creatorProtected?: boolean;
};

export default function StaffFinanceRecords({
  view,
  creatorProtected = false,
}: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadGeneration = useRef(0);
  const actionInFlight = useRef(false);
  const [acting, setActing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actorRole, setActorRole] = useState("");
  const [refundProviderIds,setRefundProviderIds]=useState<Record<string,string>>({});
  const { requestElevation } = useCreatorAuth();

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(false);
    try {
    const { data, error } = await withTimeout(supabase.rpc("get_my_staff_finance_queue"), 15000, "Finance records timed out");
    if (error) throw error;
    const result = data;
    const required = view === "payments" ? ["payments"] : view === "payouts" ? ["withdrawals", "refunds", "financial_actions"] : ["commissions", "payment_protection", "audit"];
    if (!result || !["creator","admin","staff"].includes(result.actor_role) || required.some(key => !Array.isArray(result[key]))) throw new Error("Finance records are incomplete");
    if (generation !== loadGeneration.current) return;
    setActorRole(result.actor_role);
    setRows(
      view === "payments"
        ? result.payments || []
        : view === "payouts"
          ? [
              ...result.financial_actions.map((row: any) => ({...row,_kind:"Financial action"})),
              ...(result.withdrawals || []).map((row: any) => ({
                ...row,
                _kind: "Withdrawal",
              })),
              ...(result.refunds || []).map((row: any) => ({
                ...row,
                _kind: "Refund",
              })),
            ]
          : [
              ...(result.commissions || []).map((row: any) => ({
                ...row,
                _kind: "Commission",
              })),
              ...(result.payment_protection || []).map((row: any) => ({
                ...row,
                _kind: "Payment Protection",
              })),
              ...(result.audit || []).map((row: any) => ({
                ...row,
                _kind: "Audit",
              })),
            ],
    );
    } catch { if (generation === loadGeneration.current) { setRows([]); setLoadError(true); } }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [view]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current++; };
  }, [load]);

  async function executePayoutAction(
    row: any,
    action: "approve" | "reject" | "reconcile",
    creatorElevationId?: string,
  ) {
    const reason = action === "reject" ? rejectionReason.trim() : null;
    if (action === "reject" && !reason) return;
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActing(row.id);
    try {
    const { data, error } = await withTimeout(supabase.functions.invoke("payout-withdrawal", {
      body: {
        action,
        withdrawal_id: row.id,
        reason: reason?.trim(),
        creator_elevation_id: creatorElevationId || null,
      },
    }),20000,"Payout outcome could not be confirmed. Check its status before another action.");
    setActing(null);
    if (error) {
      toast.message("The payout outcome is not confirmed. Refreshing the authoritative finance records before another action.");
      await load();
      return;
    }
    if (!payoutActionConfirmed(action,data)) {
      toast.error(data?.error || "Payout outcome could not be confirmed. Refreshing its status.");
      await load();
      return;
    }
    if (action === "reject") {
      setRejecting(null);
      setRejectionReason("");
    }
    toast.success(
      action === "approve"
        ? data.reconciliation_required
          ? "This withdrawal is already processing. Check Paystack status."
          : data.approval_required
          ? "Paystack approval is required before this transfer can continue"
          : "Transfer sent to Paystack. It remains processing until confirmed."
        : action === "reconcile"
          ? `Paystack status: ${statusLabel(data.status)}`
          : "Withdrawal rejected and held funds returned",
    );
    await load();
    } catch {
      toast.message("The payout outcome is not confirmed. Refreshing the authoritative finance records before another action.");
      await load();
    } finally { actionInFlight.current = false; setActing(null); }
  }

  function payoutAction(
    row: any,
    action: "approve" | "reject" | "reconcile",
  ) {
    const reason = action === "reject" ? rejectionReason.trim() : null;
    if (action === "reject" && !reason) return;

    if ((creatorProtected || actorRole === "creator") && action !== "reconcile") {
      requestElevation("finance_exception", (creatorElevationId) => {
        void executePayoutAction(row, action, creatorElevationId);
      });
      return;
    }

    void executePayoutAction(row, action);
  }

  async function reconcileRefund(row:any){
    if(actionInFlight.current)return;
    actionInFlight.current=true;setActing(row.id);
    try{
      const {data,error}=await withTimeout(supabase.functions.invoke('financial-action-reconcile',{body:{financial_action_id:row.id,provider_refund_id:refundProviderIds[row.id]?.trim()}}),25000,'Refund verification took too long. Refresh its state before retrying.');
      if(error||data?.success!==true||data.financial_action_id!==row.id)throw new Error(data?.error||error?.message||'Refund verification could not be confirmed');
      toast.success(data.status==='completed'?'Provider refund processed. Bank posting may take additional time.':'Provider refund status refreshed');
    }catch(reason){toast.error(reason instanceof Error?reason.message:'Refund verification could not be confirmed');}
    finally{await load();actionInFlight.current=false;setActing(null);}
  }

  if (loading) return <Empty text="Loading finance records…" />;
  if (loadError) return <section role="alert" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><p className="text-sm font-semibold">Finance records could not be loaded</p><p className="mt-2 text-sm text-[var(--wh-text-secondary)]">The queue has not been confirmed. Check again before taking a financial action.</p><button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm">Try again</button></section>;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">
          {view === "payments"
            ? "Payments"
            : view === "payouts"
              ? "Payouts & refunds"
              : "Ledger & Audit"}
        </h2>
        <p className="mt-1 text-xs text-[var(--wh-text-muted)]">
          {view === "payments"
            ? "Verified incoming payment records."
            : view === "payouts"
              ? "Review withdrawals, queued releases and refunds. Processing or manual review does not mean money has reached its recipient."
              : "Commission, Payment Protection and audit trail."}
        </p>
        <button type="button" onClick={()=>void load()} className="wh-motion-control mt-3 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">Refresh finance records</button>
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
              <article
                key={`${row._kind || view}-${row.id || index}`}
                className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {row._kind === "Financial action" ? statusLabel(row.action_type) : row._kind ||
                        row.purpose ||
                        row.booking_type ||
                        "Finance record"}
                    </p>
                    {row.owner_name && (
                      <p className="mt-1 text-xs text-[var(--wh-text-secondary)]">
                        {row.owner_name} · {statusLabel(row.owner_type)}
                      </p>
                    )}
                    <p className="mt-1 break-words text-xs text-[var(--wh-text-muted)]">
                      {row.description ||
                        row.refund_reason ||
                        bankSummary(row) ||
                        row.paystack_reference ||
                        row.payment_reference ||
                        time(row.created_at)}
                    </p>
                    {row.failed_reason && (
                      <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                        {row.failed_reason}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    {money(row) && (
                      <p className="text-xs font-bold">{money(row)}</p>
                    )}
                    <p className="mt-1 text-xs text-[var(--wh-text-muted)]">
                      {statusLabel(row.status || row.status_after || "recorded")}
                    </p>
                  </div>
                </div>
                {row._kind === "Financial action" && <div className="mt-3 space-y-2 border-t border-[var(--wh-border-subtle)] pt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">
                  <p className="break-words">Action reference: {row.id}</p>
                  <p>{statusLabel(row.subject_type)} · {row.subject_id}</p>
                  {row.provider_action_id&&<p className="break-words">Provider refund: {row.provider_action_id}</p>}
                  {row.last_error&&<p role="status" className="text-amber-800 dark:text-amber-200">{row.last_error}</p>}
                  {row.status==='manual_review'&&<p>Reconcile the original provider outcome before retrying. This record does not mean the customer has received a refund.</p>}
                  {String(row.action_type).startsWith('refund_')&&['processing','manual_review','provider_pending','provider_attention'].includes(row.status)&&<div className="space-y-2 pt-2">
                    {!row.provider_action_id&&<label className="block text-sm font-medium">Provider refund ID<input aria-label={`Provider refund ID for ${row.id}`} inputMode="numeric" value={refundProviderIds[row.id]||''} onChange={event=>setRefundProviderIds(current=>({...current,[row.id]:event.target.value}))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-[var(--wh-text)]"/><span className="mt-1 block text-xs font-normal">Use the refund ID from Paystack. WeHouse will verify it against the original payment.</span></label>}
                    <button type="button" disabled={acting!==null||!/^\d+$/.test(String(row.provider_action_id||refundProviderIds[row.id]||''))} onClick={()=>void reconcileRefund(row)} className="wh-motion-control min-h-11 w-full rounded-xl border border-violet-500/25 bg-violet-500/10 px-3 text-sm font-semibold text-violet-700 disabled:opacity-40 dark:text-violet-200">{acting===row.id?'Checking provider…':'Check refund with Paystack'}</button>
                  </div>}
                </div>}
                {withdrawal && (pending || processing) && (
                  <div className="mt-3 flex gap-2 border-t border-[var(--wh-border-subtle)] pt-3">
                    {pending && (
                      <>
                        <button
                          type="button"
                          disabled={acting === row.id}
                          onClick={() => {
                            setRejecting(row.id);
                            setRejectionReason("");
                          }}
                          className="min-h-11 flex-1 rounded-xl border border-rose-500/20 text-xs font-semibold text-rose-700 dark:text-rose-300 disabled:opacity-40"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={acting === row.id}
                          onClick={() => payoutAction(row, "approve")}
                          className="min-h-11 flex-1 rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40"
                        >
                          {acting === row.id
                            ? "Contacting Paystack…"
                            : "Review and send"}
                        </button>
                      </>
                    )}
                    {processing && (
                      <button
                        type="button"
                        disabled={acting === row.id}
                        onClick={() => payoutAction(row, "reconcile")}
                        className="min-h-11 w-full rounded-xl border border-violet-500/25 bg-violet-500/[.06] text-xs font-semibold text-violet-700 dark:text-violet-200 disabled:opacity-40"
                      >
                        {acting === row.id
                          ? "Checking Paystack…"
                          : "Check Paystack status"}
                      </button>
                    )}
                  </div>
                )}
                {withdrawal && pending && rejecting === row.id && (
                  <div className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[.04] p-3">
                    <label
                      className="text-xs font-semibold text-rose-200"
                      htmlFor={`reject-${row.id}`}
                    >
                      Reason for rejection
                    </label>
                    <textarea
                      id={`reject-${row.id}`}
                      value={rejectionReason}
                      onChange={(event) =>
                        setRejectionReason(event.target.value)
                      }
                      placeholder="Explain what must be corrected before another withdrawal request."
                      className="mt-2 min-h-20 w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-3 py-2 text-xs outline-none placeholder:text-[var(--wh-text-muted)] focus:border-rose-400/40"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={acting === row.id}
                        onClick={() => {
                          setRejecting(null);
                          setRejectionReason("");
                        }}
                        className="min-h-11 flex-1 rounded-lg border border-[var(--wh-border-subtle)] text-xs font-semibold text-[var(--wh-text-secondary)] disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={acting === row.id || !rejectionReason.trim()}
                        onClick={() => payoutAction(row, "reject")}
                        className="min-h-11 flex-1 rounded-lg bg-rose-500 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        {acting === row.id ? "Rejecting…" : "Confirm rejection"}
                      </button>
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
  const value =
    row.commission_amount ?? row.amount_total ?? row.amount ?? row.amount_payee;
  if(value==null)return '';
  if(!Number.isFinite(Number(value)))return 'Amount unavailable';
  const currency=typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency)?row.currency:row._kind?'NGN':null;
  return currency?formatMoney(Number(value),{currency}):'Currency not recorded';
}
function bankSummary(row: any) {
  const number = String(row.snapshot_bank_account_number || "");
  return row.snapshot_bank_name
    ? `${row.snapshot_bank_name} · •••• ${number.slice(-4)} · ${row.snapshot_bank_account_name || "Verified account"}`
    : "";
}
function statusLabel(value: any) {
  return String(value || "").replace(/_/g, " ");
}
function time(value: any) {
  return value ? new Date(value).toLocaleString() : "Recorded";
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--wh-border-subtle)] px-5 py-12 text-center text-xs text-[var(--wh-text-muted)]">
      {text}
    </div>
  );
}
