import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export default function WorkerProTools({ profile, canUsePaidTools }: { profile: Profile; canUsePaidTools: boolean }) {
  const [view, setView] = useState<"insights" | "documents">("insights");
  return (
    <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
      {canUsePaidTools && <div className="flex flex-wrap gap-2" role="group" aria-label="Paid Worker tools">
        <ToolTab active={view === "insights"} onClick={() => setView("insights")}>Work Insights</ToolTab>
        <ToolTab active={view === "documents"} onClick={() => setView("documents")}>Quotes &amp; invoices</ToolTab>
      </div>}
      <div className={canUsePaidTools ? "mt-4" : ""}>
        {canUsePaidTools && view === "insights" ? <WorkInsights key={profile.user_id} /> : <WorkDocuments key={profile.user_id} profile={profile} canUsePaidTools={canUsePaidTools} />}
      </div>
    </section>
  );
}

function ToolTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-10 rounded-xl px-3 text-[10px] font-semibold ${active ? "bg-violet-500 text-white" : "border border-white/[.07] text-[#9BA0AF]"}`}>{children}</button>;
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

function WorkDocuments({ profile, canUsePaidTools }: { profile: Profile; canUsePaidTools: boolean }) {
  const [documents, setDocuments] = useState<WorkerWorkDocument[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [jobError, setJobError] = useState("");
  const [jobsLoading, setJobsLoading] = useState(false);
  const [retryJobs, setRetryJobs] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [type, setType] = useState<WorkerDocumentType>("quote");
  const [bookingId, setBookingId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const generation = useRef(0);
  const busy = useRef(false);
  const allowed = useRef(canUsePaidTools); allowed.current = canUsePaidTools;

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setLoadError("");
    try {
      const result = await supabase.rpc("get_my_worker_work_documents", { p_limit: 50 });
      if (request !== generation.current) return;
      if (result.error || !Array.isArray(result.data)) throw new Error("Records unavailable");
      // The same RPC also serves a customer's issued records. The Worker view
      // must show only documents authored by this identity, not another Worker.
      const owned = result.data.filter((row: WorkerWorkDocument) => row?.worker_id === profile.user_id);
      if (owned.some((row: WorkerWorkDocument) => !row.id || !row.document_number || !Array.isArray(row.items))) throw new Error("Records incomplete");
      setDocuments(owned as WorkerWorkDocument[]);
    } catch {
      if (request !== generation.current) return;
      setDocuments([]); setLoadError("Your quotes and invoices could not be loaded.");
    } finally { if (request === generation.current) setLoading(false); }
  }, [profile.user_id]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  useEffect(() => {
    if (!canUsePaidTools) { setCreating(false); setJobs([]); setBookingId(""); return; }
    if (!creating) return;
    let current = true;
    setJobsLoading(true); setJobError("");
    void (async () => {
      try {
        const result = await getCommunicationBookingConversations(profile.user_id);
        if (!current) return;
        if (result.error || !Array.isArray(result.conversations)) throw new Error("Jobs unavailable");
        setJobs(result.conversations as JobOption[]);
      } catch {
        if (current) { setJobs([]); setJobError("Your jobs could not be loaded."); }
      } finally { if (current) setJobsLoading(false); }
    })();
    return () => { current = false; };
  }, [canUsePaidTools, creating, profile.user_id, retryJobs]);

  const total = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity), price = Number(line.unitPrice);
    return sum + (Number.isFinite(quantity) && Number.isFinite(price) && quantity > 0 && price >= 0 ? Math.round(quantity * price * 100) / 100 : 0);
  }, 0), [lines]);

  async function save() {
    if (!allowed.current || busy.current || jobsLoading || jobError) return;
    if (!jobs.some(job => job.booking_id === bookingId) || title.trim().length < 2 || lines.some(line => {
      const quantity = Number(line.quantity), price = Number(line.unitPrice);
      return line.description.trim().length < 2 || line.description.trim().length > 160 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 || !Number.isFinite(price) || price < 0 || price > 10000000 || line.unitPrice.trim() === "";
    }) || total > 100000000) {
      toast.error("Choose a job and enter valid descriptions, quantities and prices"); return;
    }
    busy.current = true; setBusyId("create");
    try {
      const result = await supabase.rpc("save_my_worker_work_document", {
        p_document_id: null, p_booking_id: bookingId, p_document_type: type,
        p_title: title.trim(), p_items: lines.map(line => ({ description: line.description.trim(), quantity: Number(line.quantity), unit_price: Number(line.unitPrice) })),
        p_note: note.trim() || null,
      });
      if (result.error || !result.data) throw new Error(result.error?.message || "Document could not be saved");
      setCreating(false); setTitle(""); setNote(""); setLines([{ ...EMPTY_LINE }]);
      toast.success(`${type === "quote" ? "Quote" : "Invoice"} saved as a draft`);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Document could not be saved"); }
    finally { busy.current = false; setBusyId(""); }
  }

  async function act(document: WorkerWorkDocument, action: "send" | "paid") {
    if (!allowed.current || busy.current || document.worker_id !== profile.user_id) return;
    busy.current = true; setBusyId(document.id);
    try {
      const result = action === "send"
        ? await supabase.rpc("send_my_worker_work_document", { p_document_id: document.id })
        : await supabase.rpc("mark_my_worker_invoice_paid_offline", { p_document_id: document.id });
      if (result.error || result.data !== true) throw new Error(result.error?.message || "Document could not be updated");
      toast.success(action === "send" ? "Document sent to the customer" : "Invoice marked as paid by Worker, not verified by WeHouse");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Document could not be updated"); }
    finally { busy.current = false; setBusyId(""); }
  }

  const input = "min-h-11 w-full min-w-0 rounded-xl border border-border bg-secondary px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const button = "min-h-11 rounded-xl border border-border px-3 text-sm font-medium disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring";
  return <section aria-label="Your work documents">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-semibold">Quotes &amp; invoices</h3>
      {canUsePaidTools && <button type="button" disabled={Boolean(busyId)} onClick={() => setCreating(value => !value)} className={`${button} bg-primary text-primary-foreground`}>{creating ? "Close draft" : "New document"}</button>}
    </div>
    {!canUsePaidTools && <p className="mt-2 text-sm leading-6 text-foreground/70">Your existing records stay available to read and export.</p>}
    {canUsePaidTools && creating && <form onSubmit={event => { event.preventDefault(); void save(); }} className="mt-5 space-y-4 border-y border-border py-5">
      <fieldset disabled={Boolean(busyId)} className="space-y-4">
        <label className="block text-sm">Document type<select value={type} onChange={event => setType(event.target.value as WorkerDocumentType)} className={`${input} mt-2`}><option value="quote">Quote</option><option value="invoice">Invoice</option></select></label>
        <label className="block text-sm">WeHouse job<select aria-label="WeHouse job" disabled={jobsLoading || Boolean(jobError)} value={bookingId} onChange={event => setBookingId(event.target.value)} className={`${input} mt-2`}><option value="">{jobsLoading ? "Loading your jobs…" : "Choose a job"}</option>{jobs.map(job => <option key={job.booking_id} value={job.booking_id}>{job.service_type || "Service job"} · {job.other_person_name || "Customer"} · #{job.booking_code || "—"}</option>)}</select></label>
        {jobError && <div role="alert" className="text-sm"><p>{jobError}</p><button type="button" onClick={() => setRetryJobs(value => value + 1)} className={`${button} mt-2`}>Retry jobs</button></div>}
        <label className="block text-sm">Title<input required value={title} minLength={2} maxLength={120} onChange={event => setTitle(event.target.value)} className={`${input} mt-2`} /></label>
        <div className="divide-y divide-border">{lines.map((line, index) => <fieldset key={index} className="space-y-3 py-4">
          <legend className="text-sm font-medium">Item {index + 1}</legend>
          <label className="block text-sm">Work or material<input required aria-label={`Line ${index + 1} description`} minLength={2} maxLength={160} value={line.description} onChange={event => setLines(rows => rows.map((row, i) => i === index ? { ...row, description: event.target.value } : row))} className={`${input} mt-2`} /></label>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-end gap-2">
            <label className="min-w-0 text-sm">Quantity<input required type="number" min="0.01" max="10000" step="0.01" aria-label={`Line ${index + 1} quantity`} inputMode="decimal" value={line.quantity} onChange={event => setLines(rows => rows.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} className={`${input} mt-2`} /></label>
            <label className="min-w-0 text-sm">Unit price (₦)<input required type="number" min="0" max="10000000" step="0.01" aria-label={`Line ${index + 1} unit price`} inputMode="decimal" value={line.unitPrice} onChange={event => setLines(rows => rows.map((row, i) => i === index ? { ...row, unitPrice: event.target.value } : row))} className={`${input} mt-2`} /></label>
            <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(rows => rows.filter((_, i) => i !== index))} className={`${button} w-11 px-0`}>×</button>
          </div>
        </fieldset>)}</div>
        <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={lines.length >= 20} onClick={() => setLines(rows => [...rows, { ...EMPTY_LINE }])} className={button}>Add item</button><p className="text-base font-semibold">Total ₦{total.toLocaleString("en-NG")}</p></div>
        <label className="block text-sm">Note <span className="text-foreground/60">(optional)</span><textarea value={note} maxLength={1200} onChange={event => setNote(event.target.value)} rows={3} className={`${input} mt-2 py-3`} /></label>
        <button type="submit" disabled={Boolean(busyId) || jobsLoading || Boolean(jobError) || !bookingId} className={`${button} w-full bg-primary text-primary-foreground`}>{busyId === "create" ? "Saving…" : "Save draft"}</button>
      </fieldset>
    </form>}
    {loading ? <p role="status" className="py-6 text-sm text-foreground/70">Loading your records…</p> : loadError ? <div role="alert" className="py-6 text-sm"><p>{loadError}</p><button type="button" onClick={() => void load()} className={`${button} mt-3`}>Retry records</button></div> : documents.length === 0 ? <Empty text="No quotes or invoices yet." /> : <div className="mt-4 divide-y divide-border border-y border-border">{documents.map(document => <DocumentRow key={document.id} document={document} canUsePaidTools={canUsePaidTools} busy={Boolean(busyId)} onSend={() => void act(document, "send")} onPaid={() => void act(document, "paid")} />)}</div>}
  </section>;
}

function DocumentRow({ document, canUsePaidTools, busy, onSend, onPaid }: { document: WorkerWorkDocument; canUsePaidTools: boolean; busy: boolean; onSend: () => void; onPaid: () => void }) {
  return <article className="py-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="break-words text-xs text-foreground/60">{document.document_type === "quote" ? "Quote" : "Invoice"} · {document.document_number}</p><h4 className="mt-1 break-words text-base font-medium">{document.title}</h4><p className="mt-1 text-sm text-foreground/65">#{document.booking_code || "—"} · {document.document_status.replaceAll("_", " ")}</p></div><p className="shrink-0 text-base font-semibold">₦{Number(document.total).toLocaleString("en-NG")}</p></div>
    {document.document_type === "invoice" && <p className="mt-2 text-sm leading-6 text-foreground/75">{document.payment_label}</p>}
    <details className="mt-2"><summary className="w-fit cursor-pointer py-3 text-sm text-primary">View details</summary><dl className="divide-y divide-border">{document.items.map((item, i) => <div key={i} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><dt className="min-w-0 flex-1 break-words">{item.description}<span className="mt-1 block text-foreground/65">{item.quantity} × ₦{Number(item.unit_price).toLocaleString("en-NG")}</span></dt><dd>₦{Number(item.line_total).toLocaleString("en-NG")}</dd></div>)}</dl>{document.note && <p className="whitespace-pre-wrap break-words py-3 text-sm leading-6 text-foreground/75">{document.note}</p>}</details>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={() => downloadDocument(document)} className="min-h-11 rounded-xl border border-border px-3 text-sm">Export</button>
      {canUsePaidTools && document.document_status === "draft" && <button type="button" disabled={busy} onClick={onSend} className="min-h-11 rounded-xl bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40">Send to customer</button>}
      {canUsePaidTools && document.document_type === "invoice" && ["sent", "accepted"].includes(document.document_status) && document.payment_status === "unpaid" && <button type="button" disabled={busy} onClick={onPaid} className="min-h-11 rounded-xl border border-border px-3 text-sm disabled:opacity-40">Mark offline payment</button>}
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
