import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { displayDate, displayDateTime } from "@/lib/displayDate";
import { getPaymentReceipts, type PaymentReceipt as Receipt } from "@/lib/supabase/receipts";

export function ReceiptDocument({ receipt: r }: { receipt: Receipt }) {
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: r.currency || "NGN" }).format(value);
  return <article className="wehouse-receipt rounded-2xl bg-white p-5 text-[#18181B] sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E4E4E7] pb-5">
      <div><img src="/brand-mark-light.svg" alt="WeHouse" className="mb-3 h-9 w-9" /><p className="text-sm font-semibold">WeHouse</p><p className="text-xs text-[#52525B]">wehouse.com.ng</p></div>
      <div className="text-right"><h2 className="text-lg font-bold">Payment receipt</h2><p className="mt-1 text-xs text-[#52525B]">{displayDateTime(r.paid_at)}</p></div>
    </header>
    {r.environment === "test" && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">Test payment · No real money was charged.</p>}
    {r.environment === null && <p className="mt-4 text-xs text-[#52525B]">Payment mode was not recorded for this transaction.</p>}
    <h3 className="mt-6 break-words text-xl font-bold">{r.merchant_name}</h3>
    <p className="mt-2 text-sm text-[#52525B]">Paid by {r.payer_name}</p>
    <dl className="mt-6 space-y-4 text-sm">
      <ReceiptLine label="For" value={[r.description, r.package_name].filter(Boolean).join(" · ")} />
      {r.check_in && <ReceiptLine label="Check-in" value={displayDate(r.check_in)} />}
      {r.check_out && <ReceiptLine label="Check-out" value={displayDate(r.check_out)} />}
      {r.nights && <ReceiptLine label="Stay" value={`${r.nights} night${r.nights === 1 ? "" : "s"}${r.guests ? ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}` : ""}`} />}
      {r.stay_amount != null && <ReceiptLine label="Stay price" value={money(r.stay_amount)} />}
      {Number(r.deposit_amount) > 0 && <ReceiptLine label="Refundable caution" value={money(Number(r.deposit_amount))} />}
      <ReceiptLine label="Payment method" value="Paystack" />
      <ReceiptLine label="Reference" value={r.reference} />
    </dl>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#E4E4E7] pt-5"><span className="text-sm font-semibold">Amount paid</span><strong className="text-2xl">{money(r.amount)}</strong></div>
    {r.status.includes("refund") && <p className="mt-4 text-sm font-semibold">{r.status === "refunded" ? "Refunded" : "Partially refunded"}{r.refund_processed_at ? ` · ${displayDate(r.refund_processed_at)}` : ""}</p>}
    <footer className="mt-7 border-t border-[#E4E4E7] pt-4 text-xs leading-5 text-[#52525B]">Payment collected through WeHouse. This receipt confirms the payment recorded above; booking and refund details remain available in Bookings.</footer>
  </article>;
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4"><dt className="text-[#52525B]">{label}</dt><dd className="break-words text-right font-medium [overflow-wrap:anywhere]">{value}</dd></div>;
}

export function ReceiptPrintButton({ receipt }: { receipt: Receipt }) {
  const [printReady, setPrintReady] = useState(false);
  useEffect(() => {
    if (!printReady) return;
    const cleanup = () => { document.body.classList.remove("printing-wehouse-receipt"); setPrintReady(false); };
    document.body.classList.add("printing-wehouse-receipt");
    window.addEventListener("afterprint", cleanup);
    const timer = window.setTimeout(() => window.print(), 100);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", cleanup); document.body.classList.remove("printing-wehouse-receipt"); };
  }, [printReady]);
  return <><button type="button" onClick={() => setPrintReady(true)} className="min-h-12 rounded-xl border border-white/15 px-4 text-sm font-semibold">Print / save PDF</button>{printReady && createPortal(<div className="wehouse-print-document"><ReceiptDocument receipt={receipt} /></div>, document.body)}</>;
}

export default function ReceiptAccess({ subjectType, subjectId }: { subjectType?: string; subjectId?: string }) {
  const [open, setOpen] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setError(false); setSelected(null);
    getPaymentReceipts(undefined, subjectType, subjectId).then(rows => {
      if (current) { setReceipts(rows); if (rows.length === 1) setSelected(rows[0]); }
    }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, subjectType, subjectId, attempt]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-2 text-sm font-semibold text-violet-300">Payment receipts</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent overlayClassName="!z-[100400]" className="!z-[100410] max-h-[90dvh] overflow-y-auto border-white/10 bg-[#100D15] text-white sm:max-w-xl">
      <DialogTitle>Payment receipts</DialogTitle><DialogDescription className="text-[#A1A1AA]">Your verified payments through WeHouse.</DialogDescription>
      {loading ? <p role="status" className="py-6 text-sm">Loading receipts…</p> : error ? <div role="alert"><p>We couldn’t load your receipts.</p><button className="min-h-11 text-violet-300" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : selected ? <>
        {receipts.length > 1 && <button onClick={() => setSelected(null)} className="min-h-11 text-left text-sm text-violet-300">← All receipts</button>}
        <ReceiptDocument receipt={selected} /><ReceiptPrintButton receipt={selected} />
      </> : receipts.length ? <div>{receipts.map(receipt => <button key={receipt.id} onClick={() => setSelected(receipt)} className="block w-full border-b border-white/10 py-4 text-left"><span className="block font-semibold">{receipt.merchant_name}</span><span className="mt-1 block text-sm text-[#A1A1AA]">{receipt.description} · {displayDate(receipt.paid_at)}</span></button>)}</div> : <p className="py-6 text-sm text-[#A1A1AA]">No verified payments yet. A receipt will appear here after payment is confirmed.</p>}
    </DialogContent></Dialog>
  </>;
}
