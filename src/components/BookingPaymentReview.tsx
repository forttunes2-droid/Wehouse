import type { ReactNode } from "react";

export type BookingPaymentReviewRow = {
  label: string;
  value: ReactNode;
};

type Props = {
  eyebrow: string;
  title: string;
  subtitle: string;
  rows: BookingPaymentReviewRow[];
  amountLabel: string;
  amount: string;
  termsTitle: string;
  terms: ReactNode;
  note?: ReactNode;
  editLabel?: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onEdit: () => void;
  onConfirm: () => void;
};

export default function BookingPaymentReview({
  eyebrow,
  title,
  subtitle,
  rows,
  amountLabel,
  amount,
  termsTitle,
  terms,
  note,
  editLabel = "Edit details",
  confirmLabel,
  busyLabel = "Opening secure checkout…",
  busy = false,
  onEdit,
  onConfirm,
}: Props) {
  return (
    <section
      aria-label="Review booking and payment"
      className="w-full overflow-hidden rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)] shadow-2xl sm:p-6"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">
          {subtitle}
        </p>
      </header>

      <dl className="mt-5 divide-y divide-[var(--wh-border-subtle)] rounded-2xl border border-[var(--wh-border-subtle)] px-4">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-5 py-3">
            <dt className="shrink-0 text-sm text-[var(--wh-text-muted)]">{row.label}</dt>
            <dd className="min-w-0 text-right text-sm font-medium text-[var(--wh-text)]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-end justify-between gap-4 rounded-2xl bg-[var(--wh-elevated)] p-4">
        <div>
          <p className="text-sm font-medium text-[var(--wh-text)]">{amountLabel}</p>
          <p className="mt-1 text-xs text-[var(--wh-text-muted)]">Secure checkout by Paystack</p>
        </div>
        <p className="shrink-0 text-xl font-bold tabular-nums text-[var(--wh-text)]">{amount}</p>
      </div>

      <section className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] p-4">
        <h3 className="text-sm font-semibold">{termsTitle}</h3>
        <div className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{terms}</div>
      </section>

      {note ? (
        <p className="mt-4 text-xs leading-5 text-[var(--wh-text-muted)]">{note}</p>
      ) : null}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="min-h-12 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold text-[var(--wh-text)] transition hover:bg-[var(--wh-interactive)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-36"
        >
          {editLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-12 rounded-xl bg-violet-700 px-5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 sm:min-w-52"
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </section>
  );
}
