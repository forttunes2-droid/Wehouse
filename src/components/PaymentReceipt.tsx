import BackButton from "@/components/BackButton";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { displayDate, displayDateTime } from "@/lib/displayDate";
import { getPaymentReceipts, type PaymentReceipt as Receipt } from "@/lib/supabase/receipts";

export function ReceiptDocument({ receipt: r }: { receipt: Receipt }) {
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: r.currency || "NGN" }).format(value);
  return <article className="wehouse-receipt rounded-xl bg-white p-4 text-[#18181B] sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E4E4E7] pb-4">
      <div><img src="/brand-mark-light.svg" alt="WeHouse" className="mb-3 h-9 w-9" /><p className="text-sm font-semibold">WeHouse</p><p className="text-xs text-[#52525B]">wehouse.com.ng</p></div>
      <div className="text-right"><h2 className="text-sm font-semibold">Payment receipt</h2><p className="mt-1 text-xs text-[#52525B]">{displayDateTime(r.paid_at, "Africa/Lagos") + " WAT"}</p></div>
    </header>
    {r.environment === "test" && <p className="mt-4 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">Test payment · No real money was charged.</p>}
    {r.environment === null && <p className="mt-4 text-xs text-[#52525B]">Payment mode was not recorded for this transaction.</p>}
    <h3 className="mt-5 break-words text-base font-semibold">{r.merchant_name}</h3>
    <p className="mt-1 text-xs text-[#52525B]">Paid by {r.payer_name}</p>
    <dl className="mt-5 space-y-3 text-xs">
      <ReceiptLine label="For" value={[r.description, r.package_name].filter(Boolean).join(" · ")} />
      {r.check_in && <ReceiptLine label="Check-in" value={displayDate(r.check_in)} />}
      {r.check_out && <ReceiptLine label="Check-out" value={displayDate(r.check_out)} />}
      {r.nights && <ReceiptLine label="Stay" value={`${r.nights} night${r.nights === 1 ? "" : "s"}${r.guests ? ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}` : ""}`} />}
      {r.stay_amount != null && <ReceiptLine label="Stay price" value={money(r.stay_amount)} />}
      {Number(r.deposit_amount) > 0 && <ReceiptLine label="Refundable caution" value={money(Number(r.deposit_amount))} />}
      <ReceiptLine label="Payment provider" value="Paystack" />
      <div className="border-t border-[#E4E4E7] pt-3"><dt className="text-[#52525B]">Payment reference</dt><dd className="mt-1 break-all font-mono text-[11px] leading-5">{r.reference}</dd></div>
    </dl>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#E4E4E7] pt-5"><span className="text-sm font-semibold">Amount paid</span><strong className="text-xl">{money(r.amount)}</strong></div>
    {r.status.includes("refund") && <p className="mt-4 text-sm font-semibold">{r.status === "refunded" ? "Refunded" : "Partially refunded"}{r.refund_processed_at ? ` · ${displayDate(r.refund_processed_at)}` : ""}</p>}
    <footer className="mt-5 border-t border-[#E4E4E7] pt-4 text-xs leading-5 text-[#52525B]">Payment collected through WeHouse. Keep this receipt for your records.</footer>
  </article>;
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4"><dt className="text-[#52525B]">{label}</dt><dd className="break-words text-right font-medium [overflow-wrap:anywhere]">{value}</dd></div>;
}

export function ReceiptPrintButton({ receipt }: { receipt: Receipt }) {
  const [printReady, setPrintReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  async function download() {
    setDownloading(true); setDownloadError(false);
    try {
      const { downloadReceiptPdf } = await import("@/lib/receiptPdf");
      await downloadReceiptPdf(receipt);
    } catch { setDownloadError(true); }
    finally { setDownloading(false); }
  }
  useEffect(() => {
    if (!printReady) return;
    const cleanup = () => { document.body.classList.remove("printing-wehouse-receipt"); setPrintReady(false); };
    document.body.classList.add("printing-wehouse-receipt");
    window.addEventListener("afterprint", cleanup);
    const timer = window.setTimeout(() => window.print(), 100);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", cleanup); document.body.classList.remove("printing-wehouse-receipt"); };
  }, [printReady]);
  return <><div className="w-full"><div className="flex items-center justify-end gap-2"><button type="button" onClick={() => setPrintReady(true)} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-semibold">Print</button><button type="button" onClick={() => void download()} disabled={downloading} className="min-h-11 rounded-xl bg-violet-500 px-5 text-xs font-semibold text-white disabled:opacity-60">{downloading ? "Preparing PDF…" : "Download PDF"}</button></div>{downloadError && <p role="alert" className="mt-2 text-xs text-red-300">The PDF could not be saved. Try again or use Print.</p>}</div>{printReady && createPortal(<div className="wehouse-print-document"><ReceiptDocument receipt={receipt} /></div>, document.body)}</>;
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
    <ReceiptViewer open={open} onClose={() => setOpen(false)} receipt={selected} onList={receipts.length > 1 ? () => setSelected(null) : undefined}>
      {loading ? <p role="status" className="py-6 text-sm">Loading receipts…</p> : error ? <div role="alert"><p>We couldn’t load your receipts.</p><button className="min-h-11 text-violet-300" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : receipts.length ? <div>{receipts.map(receipt => <button key={receipt.id} onClick={() => setSelected(receipt)} className="block min-h-16 w-full border-b border-white/10 py-3 text-left"><span className="block text-sm font-semibold">{receipt.merchant_name}</span><span className="mt-1 block text-xs text-[#A1A1AA]">{receipt.description} · {displayDate(receipt.paid_at)}</span></button>)}</div> : <p className="py-6 text-sm text-[#A1A1AA]">No verified payments yet. A receipt will appear here after payment is confirmed.</p>}
    </ReceiptViewer>
  </>;
}

export function ReceiptViewer({ open, onClose, receipt, onList, children }: { open: boolean; onClose: () => void; receipt: Receipt | null; onList?: () => void; children?: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent showCloseButton={false} overlayClassName="!z-[100400]" className="!z-[100410] !left-0 !top-0 !flex h-[100dvh] !w-full !max-w-none !translate-x-0 !translate-y-0 flex-col !gap-0 !rounded-none border-white/10 bg-[#100D15] !p-0 text-white sm:!left-1/2 sm:!top-1/2 sm:h-[min(90dvh,850px)] sm:!max-w-xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!rounded-2xl">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]">
        <BackButton onClick={receipt && onList ? onList : onClose} ariaLabel={receipt && onList ? "All receipts" : "Close receipts"} />
        <div><DialogTitle className="text-sm">{receipt ? "Payment receipt" : "Payment receipts"}</DialogTitle><DialogDescription className="mt-0.5 text-xs text-[#A1A1AA]">Verified payments through WeHouse</DialogDescription></div>
        {receipt && onList && <button onClick={onClose} className="ml-auto min-h-11 px-3 text-sm" aria-label="Close receipts">Close</button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">{receipt ? <ReceiptDocument receipt={receipt} /> : children}</div>
      {receipt && <footer className="flex shrink-0 justify-end border-t border-white/10 px-3 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))]"><ReceiptPrintButton receipt={receipt} /></footer>}
    </DialogContent>
  </Dialog>;
}
