import {useId} from 'react';
import {createPortal} from 'react-dom';
import {useDialogInteraction} from '@/hooks/useDialogInteraction';
import type {AccommodationProtection} from '@/lib/supabase/accommodation-protection';
import {displayDateTime,displayDateTimeAtProperty} from '@/lib/displayDate';

export default function AccommodationProtectionPanel({
  protection,
  onReport,
  timezone,
}: {
  protection: AccommodationProtection;
  onReport: () => void;
  timezone?: string;
}) {
  const deadline = protection.arrival_issue_deadline_at
    ? new Date(protection.arrival_issue_deadline_at)
    : null;
  const open =
    Boolean(protection.arrival_issue_case_id) ||
    protection.protection_state === "disputed";
  return (
    <section
      className={`mt-4 rounded-2xl border p-4 ${
        open
          ? "border-amber-500/20 bg-amber-500/[.045]"
          : "border-emerald-500/15 bg-emerald-500/[.035]"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--wh-text)]">
        Payment Protection
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">
        {open
          ? "Arrival issue open. The accommodation payment is frozen for WeHouse review."
          : protection.protection_state === "released"
            ? "Payment released to the property."
            : protection.protection_state === "refunded"
              ? "Payment refunded."
              : deadline
                ? `Arrival-issue deadline: ${timezone ? displayDateTimeAtProperty(deadline,timezone) : displayDateTime(deadline)}.`
                : protection.protection_state === "protected" && !protection.checked_in_at
                  ? "Your payment is protected. The arrival-issue window starts when you check in."
                  : "Open the payment details or contact WeHouse to check the release status."}
      </p>
      {protection.can_report_arrival_issue ? (
        <button
          type="button"
          onClick={onReport}
          className="mt-3 min-h-11 w-full rounded-xl border border-amber-500/25 bg-amber-500/[.07] text-xs font-semibold text-[var(--wh-text)]"
        >
          Report arrival issue
        </button>
      ) : null}
    </section>
  );
}

export function ArrivalIssueDialog({
  open,
  label,
  reason,
  busy,
  onReason,
  onClose,
  onSubmit,
}: {
  open: boolean;
  label: string;
  reason: string;
  busy: boolean;
  onReason: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const root=useDialogInteraction(()=>{if(!busy)onClose();},open);
  const titleId=useId();
  if (!open) return null;
  return createPortal(
    <div ref={root} tabIndex={-1}
      className="fixed inset-0 z-[100050] grid place-items-end bg-black/75 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-lg rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)] shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--wh-text)]">
          Formal arrival issue
        </p>
        <h2 id={titleId} className="mt-2 text-lg font-bold">
          Report a problem with {label}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">
          Confirming pauses release of the protected accommodation payments for
          this stay and opens a WeHouse review case.
        </p>
        <label className="mt-4 block">
          <span className="text-xs text-[var(--wh-text-secondary)]">What is wrong?</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            maxLength={1500}
            rows={5}
            className="mt-2 w-full resize-none rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3 text-xs outline-none focus:border-amber-500/35"
            placeholder="Describe the room/property, access, safety, or listing mismatch."
          />
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy || reason.trim().length < 10}
            onClick={onSubmit}
            className="min-h-11 rounded-xl bg-amber-500 text-xs font-semibold text-[#1A1000] disabled:opacity-50"
          >
            {busy ? "Opening case…" : "Freeze payment & report"}
          </button>
        </div>
      </div>
    </div>,document.body
  );
}
