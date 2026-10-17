import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { REPORT_REASONS, listContentReports, resolveContentReport, type ContentReport } from "@/lib/supabase/reports";

const FILTERS: ContentReport["status"][] = ["open", "reviewing", "actioned", "dismissed"];
const SUBJECTS: Record<string, string> = {
  roommate_chat: "Roommate chat", companion_chat: "Friend chat", worker_chat: "Worker chat",
  hotel_chat: "Hotel chat", support_case: "Support", profile: "Profile", message: "Message",
};

export default function AdminReports() {
  const [status, setStatus] = useState<ContentReport["status"]>("open");
  const [rows, setRows] = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listContentReports(status);
    if (error) toast.error(error.message || "Could not load reports");
    setRows(data);
    setLoading(false);
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  async function decide(id: string, next: "reviewing" | "actioned" | "dismissed") {
    setBusy(id);
    const { error } = await resolveContentReport(id, next);
    setBusy(null);
    if (error) return toast.error(error.message || "Could not update the report");
    toast.success("Report updated");
    void load();
  }
  const reasonLabel = (value: string) => REPORT_REASONS.find(([key]) => key === value)?.[1] ?? value;
  return (
    <section className="space-y-4" aria-label="Reports">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button key={item} type="button" onClick={() => setStatus(item)} aria-pressed={status === item}
            className={`min-h-10 rounded-full border px-4 text-xs font-semibold capitalize ${status === item ? "border-violet-400 bg-[var(--wh-interactive)]" : "border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}>{item}</button>
        ))}
      </div>
      {loading ? <p className="text-sm text-[var(--wh-text-secondary)]">Loading reports…</p>
        : rows.length === 0 ? <p className="rounded-2xl border border-[var(--wh-border-subtle)] p-5 text-sm text-[var(--wh-text-secondary)]">No {status} reports in your coverage.</p>
        : rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{SUBJECTS[row.subject_type] ?? row.subject_type} · {reasonLabel(row.reason)}</strong>
              <time className="text-[11px] text-[var(--wh-text-muted)]" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
            </div>
            {row.details ? <p className="mt-2 whitespace-pre-line text-xs leading-5 text-[var(--wh-text-secondary)]">{row.details}</p> : null}
            <p className="mt-2 text-[11px] text-[var(--wh-text-muted)]">Reported account: {row.subject_user_id}</p>
            {row.resolution_note ? <p className="mt-1 text-[11px] text-[var(--wh-text-muted)]">Note: {row.resolution_note}</p> : null}
            {status === "open" || status === "reviewing" ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {status === "open" ? <button type="button" disabled={busy === row.id} onClick={() => void decide(row.id, "reviewing")} className="h-10 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-40">Review</button> : <span />}
                <button type="button" disabled={busy === row.id} onClick={() => void decide(row.id, "actioned")} className="h-10 rounded-xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">Actioned</button>
                <button type="button" disabled={busy === row.id} onClick={() => void decide(row.id, "dismissed")} className="h-10 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-40">Dismiss</button>
              </div>
            ) : null}
          </article>
        ))}
    </section>
  );
}
