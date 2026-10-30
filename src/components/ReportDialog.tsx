import { useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';
import { toast } from "sonner";
import { withTimeout } from '@/lib/withTimeout';
import { REPORT_REASONS, reportContent, type ReportSubject } from "../lib/supabase/reports";

export default function ReportDialog({ subjectType, subjectUserId, subjectName, subjectRef, onClose }: {
  subjectType: ReportSubject;
  subjectUserId: string;
  subjectName: string;
  subjectRef?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const dialogRef = useDialogInteraction(onClose);
  async function submit() {
    if (!reason || inFlight.current) return;
    inFlight.current=true;
    setBusy(true);
    try{
    const { reportId, error } = await withTimeout(reportContent(subjectType, subjectUserId, reason, details, subjectRef), 15000, 'Report receipt took too long.');
    if (error) return toast.error(error.message || "Could not send the report");
    if(!reportId)return toast.error('WeHouse could not confirm receipt. Please try again.');
    toast.success(`Report sent to WeHouse moderation · Ref ${reportId.slice(0,8)}.`);
    onClose();
    }catch{toast.error('Your report is not confirmed. Check Reports you sent before trying again.')}
    finally{inFlight.current=false;setBusy(false)}
  }
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Report ${subjectName}`} className="fixed inset-0 z-[100040] grid place-items-end bg-black/60 sm:place-items-center" onClick={onClose}>
      <section className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-base font-bold">Report {subjectName}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">WeHouse moderation reviews this. The person is not told who reported.</p>
        <p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Check Reports you sent for the reference and status. Closing this form does not cancel a report already being sent.</p>
        <div className="mt-4 grid gap-2">
          {REPORT_REASONS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setReason(value)} aria-pressed={reason === value}
              className={`min-h-11 rounded-xl border px-3 text-left text-sm ${reason === value ? "border-violet-400 bg-[var(--wh-interactive)]" : "border-[var(--wh-border-subtle)]"}`}>{label}</button>
          ))}
        </div>
        <textarea value={details} onChange={(event) => setDetails(event.target.value.slice(0, 1000))} rows={3} placeholder="Details (optional)"
          className="mt-3 w-full resize-none rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3 text-xs outline-none focus:border-violet-400" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={!reason || busy} className="h-11 rounded-xl bg-red-500 text-xs font-semibold text-white disabled:opacity-40">{busy ? "Sending…" : "Send report"}</button>
        </div>
      </section>
    </div>,document.body
  );
}
