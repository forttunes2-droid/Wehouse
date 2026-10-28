import { useCallback, useEffect, useRef, useState } from 'react';
import { listMyContentReports, type MyContentReport } from '@/lib/supabase/reports';
import { withTimeout } from '@/lib/withTimeout';

const statusLabel: Record<MyContentReport['status'], string> = {
  open: 'Received',
  reviewing: 'Under review',
  actioned: 'Reviewed',
  dismissed: 'Closed',
};

const subjectLabel: Record<string, string> = {
  roommate_chat: 'Roommate conversation',
  friend_chat: 'Friend conversation',
  worker_chat: 'Service conversation',
  hotel_chat: 'Hotel conversation',
  support_case: 'Support conversation',
  profile: 'Profile',
  message: 'Message',
  listing: 'Property listing',
  hotel: 'Hotel listing',
  provider_review: 'Provider review',
  provider_review_appeal: 'Review appeal',
};

export default function MyReports() {
  const [rows, setRows] = useState<MyContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const result = await withTimeout(listMyContentReports(), 15000, 'Report history took too long.');
      if (result.error) throw result.error;
      if (request === generation.current) setRows(result.data);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  return (
    <section aria-label="Reports you sent" className="space-y-3">
      <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">
        Check whether WeHouse has received or reviewed a report you sent.
      </p>
      {loading ? <p role="status" className="rounded-2xl border border-[var(--wh-border-subtle)] p-4 text-sm text-[var(--wh-text-secondary)]">Loading your reports…</p>
        : error ? <div role="alert" className="rounded-2xl border border-[var(--wh-border-subtle)] p-4">
          <p className="text-sm text-[var(--wh-text-secondary)]">Your reports could not be loaded. Try again.</p>
          <button type="button" onClick={() => void load()} className="mt-2 min-h-11 font-semibold text-violet-600 dark:text-violet-300">Try again</button>
        </div>
          : rows.length === 0 ? <p className="rounded-2xl border border-[var(--wh-border-subtle)] p-4 text-sm text-[var(--wh-text-secondary)]">You have not sent any reports.</p>
            : rows.map((row) => (
              <article key={row.report_id} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{subjectLabel[row.subject_type] ?? 'Report'}</h3>
                    <p className="mt-1 text-xs capitalize text-[var(--wh-text-secondary)]">{row.reason.replaceAll('_', ' ')}</p>
                  </div>
                  <span className="rounded-full border border-[var(--wh-border-subtle)] px-3 py-1 text-xs font-semibold">{statusLabel[row.status]}</span>
                </div>
                <time className="mt-3 block text-xs text-[var(--wh-text-muted)]" dateTime={row.created_at}>Sent {new Date(row.created_at).toLocaleString()}</time>
                <p className="mt-2 break-all text-xs text-[var(--wh-text-secondary)]">Report reference: {row.report_id}</p>
                {row.resolved_at ? <time className="mt-1 block text-xs text-[var(--wh-text-muted)]" dateTime={row.resolved_at}>Last updated {new Date(row.resolved_at).toLocaleString()}</time> : null}
              </article>
            ))}
    </section>
  );
}
