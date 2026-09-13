import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { WorkerWorkDocument } from "@/types";

export default function WorkerBookingDocuments({
  bookingId,
  isWorker,
}: {
  bookingId: string;
  isWorker: boolean;
}) {
  const [documents, setDocuments] = useState<WorkerWorkDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_worker_work_documents", { p_limit: 100 });
    setLoading(false);
    if (error) return toast.error(error.message || "Job documents could not be loaded");
    setDocuments(((data || []) as WorkerWorkDocument[]).filter((document) => document.booking_id === bookingId));
  }, [bookingId]);
  useEffect(() => { void load(); }, [load]);

  async function respond(documentId: string, accept: boolean) {
    setBusyId(documentId);
    const { data, error } = await supabase.rpc("respond_to_my_worker_quote", {
      p_document_id: documentId,
      p_accept: accept,
    });
    setBusyId("");
    if (error || data !== true) return toast.error(error?.message || "Quote response could not be saved");
    toast.success(accept ? "Quote accepted" : "Quote declined");
    await load();
  }

  if (loading) return <p className="mt-4 text-[9px] text-[#6B7181]">Loading job documents…</p>;
  if (documents.length === 0) return null;
  return <section className="mt-4 border-t border-white/[.06] pt-4" aria-label="Quotes and invoices">
    <p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[#626879]">Quotes &amp; invoices</p>
    <div className="mt-2 space-y-2">{documents.map((document) => <article key={document.id} className="rounded-xl border border-white/[.06] bg-black/10 p-3">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[.1em] text-violet-300">{document.document_type} · {document.document_number}</p><p className="mt-1 truncate text-[10px] font-semibold">{document.title}</p><p className="mt-1 text-[8px] text-[#6C7282]">{document.document_status.replaceAll("_", " ")}</p></div><p className="shrink-0 text-[11px] font-bold">₦{Number(document.total).toLocaleString("en-NG")}</p></div>
      <div className="mt-2 space-y-1 border-t border-white/[.05] pt-2">{document.items.map((item, index) => <div key={`${document.id}-${index}`} className="flex justify-between gap-3 text-[8px] text-[#9297A5]"><span>{item.description} · {item.quantity}</span><span>₦{Number(item.line_total).toLocaleString("en-NG")}</span></div>)}</div>
      {document.document_type === "invoice" && <p className={`mt-2 text-[8px] font-semibold ${document.payment_status === "paid_through_wehouse" ? "text-emerald-300" : document.payment_status === "marked_paid_by_worker" ? "text-amber-300" : "text-[#858B9A]"}`}>{document.payment_label}</p>}
      {!isWorker && document.document_type === "quote" && document.document_status === "sent" && <><p className="mt-3 text-[8px] leading-relaxed text-[#858B9A]">Accepting records your agreement to this quote. Protected payment and the job status still use the booking controls.</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={busyId === document.id} onClick={() => void respond(document.id, false)} className="h-9 rounded-lg border border-white/[.07] text-[9px] font-semibold disabled:opacity-40">Decline</button><button type="button" disabled={busyId === document.id} onClick={() => void respond(document.id, true)} className="h-9 rounded-lg bg-violet-500 text-[9px] font-semibold disabled:opacity-40">Accept quote</button></div></>}
    </article>)}</div>
  </section>;
}
