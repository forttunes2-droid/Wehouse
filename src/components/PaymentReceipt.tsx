import BackButton from "@/components/BackButton";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { displayDate, displayDateTime } from "@/lib/displayDate";
import { getPaymentReceipts, type PaymentReceipt as Receipt } from "@/lib/supabase/receipts";

export function ReceiptDocument({ receipt: r }: { receipt: Receipt }) {
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: r.currency || "NGN" }).format(value);
  return <article className="wehouse-receipt mx-auto max-w-md overflow-hidden rounded-2xl bg-white text-[#24212B] shadow-xl shadow-black/20">
    <div className="h-1 bg-violet-600" />
    <header className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
      <div className="flex items-center gap-2.5"><img src="/brand-mark-light.svg" alt="WeHouse" className="h-10 w-10 rounded-xl" /><div><p className="text-base font-bold tracking-tight">WeHouse</p><p className="text-xs text-[#625D6B]">wehouse.com.ng</p></div></div>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${r.status.includes("refund") ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{r.status === "refunded" ? "Refunded" : r.status.includes("refund") ? "Partial refund" : "Paid"}</span>
    </header>
    <div className="px-5 pb-5 pt-6 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#6D6875]">Payment receipt</p>
      <p className="mt-2 text-xs text-[#625D6B]">{displayDateTime(r.paid_at, "Africa/Lagos") + " WAT"}</p>
      <div className="mt-5 rounded-2xl bg-[#F6F3FC] px-4 py-4">
        <p className="text-xs font-semibold text-[#625D6B]">Amount paid</p>
        <strong className="mt-1 block text-2xl tracking-tight">{money(r.amount)}</strong>
      </div>
      {r.environment === "test" && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">Test payment · No real money was charged.</p>}
      {r.environment === null && <p className="mt-4 text-xs text-[#625D6B]">Payment mode was not recorded for this transaction.</p>}
      <div className="mt-6 border-b border-[#E8E5EC] pb-5">
        <p className="text-xs text-[#625D6B]">Paid to</p>
        <h3 className="mt-1 break-words text-base font-semibold">{r.merchant_name}</h3>
        <p className="mt-2 text-sm text-[#625D6B]">Paid by <span className="font-medium text-[#24212B]">{r.payer_name}</span></p>
      </div>
      <dl className="mt-5 space-y-3 text-sm">
        <ReceiptLine label="For" value={[r.description, r.package_name].filter(Boolean).join(" · ")} />
        {r.check_in && <ReceiptLine label="Check-in" value={displayDate(r.check_in)} />}
        {r.check_out && <ReceiptLine label="Check-out" value={displayDate(r.check_out)} />}
        {r.nights && <ReceiptLine label="Stay" value={`${r.nights} night${r.nights === 1 ? "" : "s"}${r.guests ? ` · ${r.guests} guest${r.guests === 1 ? "" : "s"}` : ""}`} />}
        {r.stay_amount != null && <ReceiptLine label="Stay price" value={money(r.stay_amount)} />}
        {Number(r.deposit_amount) > 0 && <ReceiptLine label="Refundable caution" value={money(Number(r.deposit_amount))} />}
        <ReceiptLine label="Payment provider" value="Paystack" />
      </dl>
      <div className="mt-6 border-t border-[#E8E5EC] pt-4"><p className="text-xs text-[#625D6B]">Payment reference</p><p className="mt-1 break-all font-mono text-xs font-semibold leading-5">{r.reference}</p></div>
      {r.status.includes("refund") && <p className="mt-4 text-sm font-semibold">{r.status === "refunded" ? "Refunded" : "Partially refunded"}{r.refund_processed_at ? ` · ${displayDate(r.refund_processed_at)}` : ""}</p>}
    </div>
    <footer className="border-t border-dashed border-[#DCD7E3] bg-[#FBFAFD] px-5 py-4 text-xs leading-5 text-[#625D6B] sm:px-6">Payment collected through WeHouse. Keep this receipt for your records.</footer>
  </article>;
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-3"><dt className="text-[#625D6B]">{label}</dt><dd className="break-words text-right font-medium [overflow-wrap:anywhere]">{value}</dd></div>;
}

export function ReceiptPrintButton({ receipt }: { receipt: Receipt }) {
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
  return <div className="w-full text-right"><button type="button" onClick={() => void download()} disabled={downloading} className="min-h-11 rounded-xl bg-violet-500 px-5 text-xs font-semibold text-white disabled:opacity-60">{downloading ? "Preparing PDF…" : "Download PDF"}</button>{downloadError && <p role="alert" className="mt-2 text-xs text-red-300">The PDF could not be saved. Try again.</p>}</div>;
}

export default function ReceiptAccess({
  subjectType,
  subjectId,
}: {
  subjectType?: string;
  subjectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setOpen(false);
    setReceipts([]);
    setSelected(null);
    setError(false);
    setLoaded(false);
    setLoading(false);
  }, [subjectType, subjectId]);

  async function loadReceipts(force = false) {
    setOpen(true);
    if (loaded && !force) return;
    setLoading(true);
    setError(false);
    setSelected(null);
    try {
      const rows = await getPaymentReceipts(undefined, subjectType, subjectId);
      setReceipts(rows);
      setLoaded(true);
      if (rows.length === 1) setSelected(rows[0]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void loadReceipts()}
        className="min-h-10 px-2 text-xs font-semibold text-violet-300"
      >
        Receipt
      </button>
      <ReceiptViewer
        open={open}
        onClose={() => setOpen(false)}
        receipt={selected}
        onList={receipts.length > 1 ? () => setSelected(null) : undefined}
      >
        {loading ? (
          <p role="status" className="py-6 text-sm">
            Loading receipt…
          </p>
        ) : error ? (
          <div role="alert">
            <p>We couldn’t load this payment receipt.</p>
            <button
              className="min-h-11 text-violet-300"
              onClick={() => void loadReceipts(true)}
            >
              Try again
            </button>
          </div>
        ) : receipts.length > 1 ? (
          <div>
            {receipts.map((receipt) => (
              <button
                key={receipt.id}
                onClick={() => setSelected(receipt)}
                className="block min-h-16 w-full border-b border-white/10 py-3 text-left"
              >
                <span className="block text-sm font-semibold">
                  {receipt.description || receipt.merchant_name}
                </span>
                <span className="mt-1 block text-xs text-[#A1A1AA]">
                  {new Intl.NumberFormat("en-NG", {
                    style: "currency",
                    currency: receipt.currency || "NGN",
                  }).format(receipt.amount)}
                  {" · "}
                  {displayDate(receipt.paid_at)}
                </span>
              </button>
            ))}
          </div>
        ) : loaded && receipts.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold">No receipt yet</p>
            <p className="mt-2 text-xs leading-5 text-[#7D8392]">A verified payment receipt will appear here after payment is confirmed.</p>
          </div>
        ) : null}
      </ReceiptViewer>
    </>
  );
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
