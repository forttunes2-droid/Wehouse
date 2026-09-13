import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";
import type {
  Profile,
  WorkerDocumentType,
  WorkerWorkDocument,
  WorkerWorkInsights,
} from "@/types";

type JobOption = {
  booking_id: string;
  booking_code?: string | null;
  service_type?: string | null;
  other_person_name?: string | null;
};

type DraftLine = {
  description: string;
  quantity: string;
  unitPrice: string;
};

const EMPTY_LINE: DraftLine = {
  description: "",
  quantity: "1",
  unitPrice: "",
};

export default function WorkerProTools({ profile }: { profile: Profile }) {
  const [view, setView] = useState<"insights" | "documents">("insights");
  return (
    <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
      <div className="flex gap-2" role="tablist" aria-label="Paid Worker tools">
        <ToolTab active={view === "insights"} onClick={() => setView("insights")}>Work Insights</ToolTab>
        <ToolTab active={view === "documents"} onClick={() => setView("documents")}>Quotes &amp; invoices</ToolTab>
      </div>
      <div className="mt-4">
        {view === "insights" ? <WorkInsights /> : <WorkDocuments profile={profile} />}
      </div>
    </section>
  );
}

function ToolTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`min-h-10 rounded-xl px-3 text-[10px] font-semibold ${active ? "bg-violet-500 text-white" : "border border-white/[.07] text-[#9BA0AF]"}`}>{children}</button>;
}

function WorkInsights() {
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const [data, setData] = useState<WorkerWorkInsights | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase.rpc("get_my_worker_work_insights", { p_days: days }).then(({ data: result, error }) => {
      if (!active) return;
      setLoading(false);
      if (error) {
        setData(null);
        toast.error(error.message || "Work Insights could not be loaded");
      } else setData(result as WorkerWorkInsights);
    });
    return () => { active = false; };
  }, [days]);

  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">Work Insights</h3>
        <p className="mt-1 text-[9px] leading-4 text-[#73798A]">Only completed jobs, released earnings, verified reviews and recorded Sponsored activity.</p>
      </div>
      <div className="flex gap-1" role="group" aria-label="Insights period">
        {([30, 90, 365] as const).map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={`h-8 rounded-lg px-2.5 text-[9px] font-semibold ${days === value ? "bg-white/[.1] text-white" : "text-[#73798A]"}`}>{value === 365 ? "1 year" : `${value} days`}</button>)}
      </div>
    </div>
    {loading ? <Empty text="Loading real work records…" /> : !data ? <Empty text="Insights are unavailable right now." /> : <>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Completed jobs" value={String(data.completed_jobs)} detail={data.definitions.completed_jobs} />
        <Metric label="Released earnings" value={`₦${Number(data.released_earnings_ngn).toLocaleString("en-NG")}`} detail={data.definitions.released_earnings_ngn} />
        <Metric label="Active jobs" value={String(data.active_jobs)} detail={data.definitions.active_jobs} />
        <Metric label="Verified rating" value={data.review_count ? `${Number(data.rating).toFixed(1)} · ${data.review_count}` : "No reviews yet"} detail={data.definitions.rating} />
        <Metric label="Repeat customers" value={String(data.repeat_customers)} detail={data.definitions.repeat_customers} />
        <Metric label="Worker cancellations" value={String(data.worker_cancelled_jobs)} detail={data.definitions.worker_cancelled_jobs} />
        <Metric label="Sponsored impressions" value={String(data.featured.signed_in_unique_impressions)} detail={data.definitions.featured} />
        <Metric label="Sponsored bookings" value={String(data.featured.booking_requests)} detail={`Profile opens: ${data.featured.unique_profile_opens}. ${data.definitions.featured}`} />
      </div>
      <p className="mt-3 text-[8px] text-[#606676]">Generated {new Date(data.generated_at).toLocaleString()} · Empty records stay zero; WeHouse does not invent estimates.</p>
    </>}
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article title={detail} className="min-h-24 rounded-xl border border-white/[.055] bg-black/10 p-3">
    <p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[#686E7F]">{label}</p>
    <p className="mt-2 break-words text-base font-bold text-[#ECEEF3]">{value}</p>
    <p className="mt-1 line-clamp-2 text-[8px] leading-4 text-[#696F80]">{detail}</p>
  </article>;
}

function WorkDocuments({ profile }: { profile: Profile }) {
  const [documents, setDocuments] = useState<WorkerWorkDocument[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [type, setType] = useState<WorkerDocumentType>("quote");
  const [bookingId, setBookingId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  const load = useCallback(async () => {
    setLoading(true);
    const [documentResult, jobResult] = await Promise.all([
      supabase.rpc("get_my_worker_work_documents", { p_limit: 50 }),
      getCommunicationBookingConversations(profile.user_id),
    ]);
    setLoading(false);
    if (documentResult.error) toast.error(documentResult.error.message);
    else setDocuments((documentResult.data || []) as WorkerWorkDocument[]);
    if (jobResult.error) toast.error(jobResult.error.message);
    else {
      const rows = (jobResult.conversations || []) as JobOption[];
      setJobs(rows);
      setBookingId((current) => current || rows[0]?.booking_id || "");
    }
  }, [profile.user_id]);

  useEffect(() => { void load(); }, [load]);
  const total = useMemo(() => lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0), 0), [lines]);

  async function save() {
    if (!bookingId || title.trim().length < 2 || lines.some((line) => line.description.trim().length < 2 || !(Number(line.quantity) > 0) || Number(line.unitPrice) < 0 || line.unitPrice === "")) {
      toast.error("Choose a job and complete every line description, quantity and price");
      return;
    }
    setBusyId("create");
    const result = await supabase.rpc("save_my_worker_work_document", {
      p_document_id: null,
      p_booking_id: bookingId,
      p_document_type: type,
      p_title: title.trim(),
      p_items: lines.map((line) => ({ description: line.description.trim(), quantity: Number(line.quantity), unit_price: Number(line.unitPrice) })),
      p_note: note.trim() || null,
    });
    setBusyId("");
    if (result.error) return toast.error(result.error.message || "Document could not be saved");
    setCreating(false);
    setTitle("");
    setNote("");
    setLines([{ ...EMPTY_LINE }]);
    toast.success(`${type === "quote" ? "Quote" : "Invoice"} saved as a draft`);
    await load();
  }

  async function act(document: WorkerWorkDocument, action: "send" | "paid") {
    setBusyId(document.id);
    const result = action === "send"
      ? await supabase.rpc("send_my_worker_work_document", { p_document_id: document.id })
      : await supabase.rpc("mark_my_worker_invoice_paid_offline", { p_document_id: document.id });
    setBusyId("");
    if (result.error || result.data !== true) return toast.error(result.error?.message || "Document could not be updated");
    toast.success(action === "send" ? "Document sent to the customer" : "Invoice marked as paid by Worker, not verified by WeHouse");
    await load();
  }

  return <div>
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold">Quotes &amp; invoices</h3><p className="mt-1 text-[9px] leading-4 text-[#73798A]">Linked to real WeHouse jobs. Records remain readable and exportable if the plan ends.</p></div>
      <button type="button" onClick={() => setCreating((value) => !value)} className="min-h-9 rounded-xl bg-violet-500 px-3 text-[9px] font-semibold">{creating ? "Close" : "New document"}</button>
    </div>
    {creating && <div className="mt-4 space-y-3 rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-3">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Document type">
        {(["quote", "invoice"] as const).map((kind) => <button type="button" key={kind} aria-pressed={type === kind} onClick={() => setType(kind)} className={`h-10 rounded-xl text-[10px] font-semibold ${type === kind ? "bg-violet-500" : "border border-white/[.07]"}`}>{kind === "quote" ? "Quote" : "Invoice"}</button>)}
      </div>
      <label className="block text-[9px] font-semibold text-[#A6ABBA]">WeHouse job<select value={bookingId} onChange={(event) => setBookingId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs"><option value="">Choose a job</option>{jobs.map((job) => <option key={job.booking_id} value={job.booking_id}>{job.service_type || "Service job"} · {job.other_person_name || "Customer"} · #{job.booking_code || "—"}</option>)}</select></label>
      <label className="block text-[9px] font-semibold text-[#A6ABBA]">Title<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder={type === "quote" ? "Work quote" : "Service invoice"} className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" /></label>
      {lines.map((line, index) => <div key={index} className="grid grid-cols-[1fr_70px_110px_auto] gap-2">
        <input aria-label={`Line ${index + 1} description`} value={line.description} onChange={(event) => setLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} placeholder="Work or material" className="h-10 min-w-0 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-[10px] outline-none" />
        <input aria-label={`Line ${index + 1} quantity`} inputMode="decimal" value={line.quantity} onChange={(event) => setLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} placeholder="Qty" className="h-10 min-w-0 rounded-xl border border-white/[.08] bg-[#171A23] px-2 text-[10px] outline-none" />
        <input aria-label={`Line ${index + 1} unit price`} inputMode="decimal" value={line.unitPrice} onChange={(event) => setLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: event.target.value } : row))} placeholder="₦ price" className="h-10 min-w-0 rounded-xl border border-white/[.08] bg-[#171A23] px-2 text-[10px] outline-none" />
        <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="h-10 w-10 rounded-xl border border-white/[.07] text-[#858B9A] disabled:opacity-30">×</button>
      </div>)}
      <div className="flex items-center justify-between"><button type="button" disabled={lines.length >= 20} onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])} className="text-[9px] font-semibold text-violet-300 disabled:opacity-40">+ Add line</button><p className="text-xs font-bold">Total ₦{total.toLocaleString("en-NG")}</p></div>
      <textarea value={note} maxLength={1200} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Note or terms (optional)" className="w-full resize-none rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-[10px] outline-none" />
      <button type="button" disabled={busyId === "create"} onClick={() => void save()} className="h-11 w-full rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">{busyId === "create" ? "Saving…" : "Save draft"}</button>
    </div>}
    {loading ? <Empty text="Loading documents…" /> : documents.length === 0 ? <Empty text="No quotes or invoices yet." /> : <div className="mt-4 divide-y divide-white/[.06] border-y border-white/[.06]">{documents.map((document) => <DocumentRow key={document.id} document={document} busy={busyId === document.id} onSend={() => void act(document, "send")} onPaid={() => void act(document, "paid")} />)}</div>}
  </div>;
}

function DocumentRow({ document, busy, onSend, onPaid }: { document: WorkerWorkDocument; busy: boolean; onSend: () => void; onPaid: () => void }) {
  return <article className="py-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[.12em] text-violet-300">{document.document_type} · {document.document_number}</p><h4 className="mt-1 truncate text-sm font-semibold">{document.title}</h4><p className="mt-1 text-[9px] text-[#6F7586]">#{document.booking_code || "—"} · {document.document_status.replaceAll("_", " ")}</p></div><p className="shrink-0 text-sm font-bold">₦{Number(document.total).toLocaleString("en-NG")}</p></div>
    {document.document_type === "invoice" && <p className={`mt-2 text-[9px] font-semibold ${document.payment_status === "paid_through_wehouse" ? "text-emerald-300" : document.payment_status === "marked_paid_by_worker" ? "text-amber-300" : "text-[#858B9A]"}`}>{document.payment_label}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => downloadDocument(document)} className="rounded-lg border border-white/[.07] px-3 py-2 text-[9px] font-semibold">Export</button>
      {document.document_status === "draft" && <button type="button" disabled={busy} onClick={onSend} className="rounded-lg bg-violet-500 px-3 py-2 text-[9px] font-semibold disabled:opacity-40">Send to customer</button>}
      {document.document_type === "invoice" && ["sent", "accepted"].includes(document.document_status) && document.payment_status === "unpaid" && <button type="button" disabled={busy} onClick={onPaid} className="rounded-lg border border-amber-300/20 bg-amber-300/[.06] px-3 py-2 text-[9px] font-semibold text-amber-200 disabled:opacity-40">Mark offline payment</button>}
    </div>
  </article>;
}

function downloadDocument(document: WorkerWorkDocument) {
  const lines = [
    `${document.document_type.toUpperCase()} ${document.document_number}`,
    document.title,
    `WeHouse job: #${document.booking_code || "—"}`,
    "",
    ...document.items.map((item) => `${item.description} · ${item.quantity} × ₦${Number(item.unit_price).toLocaleString("en-NG")} = ₦${Number(item.line_total).toLocaleString("en-NG")}`),
    "",
    `TOTAL: ₦${Number(document.total).toLocaleString("en-NG")}`,
    document.document_type === "invoice" ? `PAYMENT: ${document.payment_label}` : `STATUS: ${document.document_status}`,
    document.note ? `NOTE: ${document.note}` : "",
  ].filter((line) => line !== "").join("\n");
  const url = URL.createObjectURL(new Blob([lines], { type: "text/plain;charset=utf-8" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.document_number}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Empty({ text }: { text: string }) {
  return <div className="mt-4 rounded-xl border border-dashed border-white/[.08] px-4 py-8 text-center text-[9px] text-[#6D7384]">{text}</div>;
}
