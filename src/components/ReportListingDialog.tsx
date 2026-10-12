import { useState } from "react";
import { createPortal } from "react-dom";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { createReport } from "@/lib/supabase/admin";
import { toast } from "sonner";

const REASONS = [
  ["misleading", "Misleading or inaccurate information"],
  ["suspicious", "Suspicious activity or possible fraud"],
  ["prohibited", "Prohibited or unsafe content"],
  ["safety", "A safety concern"],
  ["other", "Something else"],
] as const;

type Props = {
  listingId: string;
  listingTitle: string;
  reporterId: string;
  onClose: () => void;
};

export default function ReportListingDialog({
  listingId,
  listingTitle,
  reporterId,
  onClose,
}: Props) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0] | "">("");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogInteraction(onClose);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason || saving) return;
    setSaving(true);
    try {
      const label = REASONS.find(([value]) => value === reason)?.[1] || "Other";
      const fullReason = details.trim()
        ? `${label}\n\n${details.trim()}`
        : label;
      const result = await createReport(reporterId, fullReason, listingId);
      if (result.error) throw result.error;
      toast.success("Your report was sent to WeHouse for review.");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn’t send your report. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-listing-title"
      className="fixed inset-0 z-[100040] flex items-end justify-center bg-black/70 p-0 text-[var(--wh-text)] sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[.15em] text-violet-300">
              LISTING SAFETY
            </p>
            <h2 id="report-listing-title" className="mt-1 text-lg font-bold">
              Report this listing
            </h2>
            <p className="mt-1 line-clamp-2 text-xs text-[var(--wh-text-muted)]">
              {listingTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close report form"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl text-[var(--wh-text-secondary)] disabled:opacity-50"
          >
            ×
          </button>
        </header>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">
              What should WeHouse review?
            </legend>
            {REASONS.map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[var(--wh-border-subtle)] px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="listing-report-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  className="accent-violet-500"
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <label className="block text-sm font-medium" htmlFor="listing-report-details">
            Details <span className="font-normal text-[var(--wh-text-muted)]">(optional)</span>
          </label>
          <textarea
            id="listing-report-details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="Tell us what you noticed. Don’t include payment details or access codes."
            className="w-full resize-y rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-sm outline-none focus:border-violet-400"
          />
          <p className="-mt-3 text-right text-[10px] text-[var(--wh-text-muted)]">
            {details.length}/1000
          </p>

          <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">
            WeHouse reviews reports through its operations team. Reporting does
            not automatically cancel a reservation or hide the listing.
          </p>
          <button
            type="submit"
            disabled={saving || !reason}
            className="min-h-12 w-full rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Sending report…" : "Send report"}
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
