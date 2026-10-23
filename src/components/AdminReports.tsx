import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { REPORT_REASONS, listContentReports, resolveContentReport, type ContentReport } from "@/lib/supabase/reports";
import { withTimeout } from "@/lib/withTimeout";

const FILTERS: ContentReport["status"][] = ["open", "reviewing", "actioned", "dismissed"];
const SUBJECTS: Record<string, string> = {
  roommate_chat: "Roommate chat", friend_chat: "Friend chat", worker_chat: "Worker chat",
  hotel_chat: "Hotel chat", support_case: "Support", profile: "Profile", message: "Message", listing: "Property listing", hotel: "Hotel listing",
};

export default function AdminReports() {
  const [status, setStatus] = useState<ContentReport["status"]>("open");
  const [rows, setRows] = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState<Record<string,string>>({});
  const generation = useRef(0);
  const actionInFlight = useRef(false);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await withTimeout(listContentReports(status),15000,'Reports timed out');
      if(error || !Array.isArray(data)) throw error || new Error('Invalid report response');
      if(request === generation.current)setRows(data);
    }catch{if(request === generation.current)setLoadError(true)}
    finally{if(request === generation.current)setLoading(false)}
  }, [status]);
  useEffect(() => { void load(); return()=>{generation.current++}; }, [load]);
  async function decide(id: string, next: "reviewing" | "actioned" | "dismissed") {
    if(actionInFlight.current)return;
    actionInFlight.current=true;
    setBusy(id);
    try{
    const { error } = await resolveContentReport(id, next, notes[id]?.trim());
    if (error) return toast.error(error.message || "Could not update the report");
    toast.success("Report updated");
    await load();
    }catch{toast.message('The report update is not confirmed. Refreshing its current status.');await load()}
    finally{actionInFlight.current=false;setBusy(null)}
  }
  const reasonLabel = (value: string) => REPORT_REASONS.find(([key]) => key === value)?.[1] ?? value;
  return (
    <section className="space-y-4" aria-label="Reports">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button key={item} type="button" disabled={Boolean(busy)} onClick={() => setStatus(item)} aria-pressed={status === item}
            className={`min-h-10 rounded-full border px-4 text-xs font-semibold capitalize ${status === item ? "border-violet-400 bg-[var(--wh-interactive)]" : "border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}>{item}</button>
        ))}
      </div>
      {loading ? <p className="text-sm text-[var(--wh-text-secondary)]">Loading reports…</p>
        : loadError ? <div role="alert" className="rounded-2xl border border-[var(--wh-border-subtle)] p-4 text-sm"><p>Reports could not be loaded. The queue has not been confirmed empty.</p><button type="button" onClick={()=>void load()} className="mt-2 min-h-11 font-semibold text-[var(--wh-accent-text)]">Try again</button></div>
        : rows.length === 0 ? <p className="rounded-2xl border border-[var(--wh-border-subtle)] p-5 text-sm text-[var(--wh-text-secondary)]">No {status} reports in your coverage.</p>
        : rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{SUBJECTS[row.subject_type] ?? row.subject_type} · {reasonLabel(row.reason)}</strong>
              <time className="text-[11px] text-[var(--wh-text-muted)]" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
            </div>
            {row.details ? <p className="mt-2 whitespace-pre-line text-xs leading-5 text-[var(--wh-text-secondary)]">{row.details}</p> : null}
            <p className="mt-2 break-all text-xs text-[var(--wh-text-secondary)]">Report reference: {row.id}</p>
            {['listing','hotel'].includes(row.subject_type) && row.subject_ref ? <p className="mt-2 text-[11px] text-[var(--wh-text-muted)]">{row.subject_type === 'hotel' ? 'Hotel' : 'Listing'} reference: {row.subject_ref}</p> : null}
            <p className="mt-2 text-[11px] text-[var(--wh-text-muted)]">Reported account: {row.subject_user_id}</p>
            {row.resolution_note ? <p className="mt-1 text-[11px] text-[var(--wh-text-muted)]">Note: {row.resolution_note}</p> : null}
            {status === "open" || status === "reviewing" ? (
              <div className="mt-3 space-y-3"><label className="block text-xs text-[var(--wh-text-secondary)]">Review note (optional)<textarea value={notes[row.id]||''} onChange={event=>setNotes(current=>({...current,[row.id]:event.target.value.slice(0,1000)}))} maxLength={1000} className="mt-2 block min-h-20 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-sm" /></label><p className="text-xs text-[var(--wh-text-muted)]">Record the outcome here after any separate listing or account action. Updating a report does not itself remove a listing or restrict an account.</p><div className="grid grid-cols-3 gap-2">
                {status === "open" ? <button type="button" disabled={busy === row.id} onClick={() => void decide(row.id, "reviewing")} className="h-10 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-40">Review</button> : <span />}
                <button type="button" disabled={busy === row.id} onClick={() => void decide(row.id, "actioned")} className="h-10 rounded-xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">Actioned</button>
                <button type="button" disabled={busy === row.id} onClick={() => void decide(row.id, "dismissed")} className="h-10 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-40">Dismiss</button>
              </div></div>
            ) : null}
          </article>
        ))}
    </section>
  );
}
