import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type TrustState = {
  payment_confirmed?: boolean;
  readiness_passed?: boolean;
  readiness_percent?: number | null;
  evidence_saved?: boolean;
  submitted?: boolean;
  review_status?: string | null;
};

export default function WorkerReviewIdentityStatus({ workerId }: { workerId: string }) {
  const [data, setData] = useState<TrustState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase.rpc('admin_get_worker_review_trust_status', { p_worker_id: workerId }).then(({ data, error }) => {
      if (!active) return;
      setData(error ? null : ((data || null) as TrustState | null));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [workerId]);

  const ready = Boolean(data?.payment_confirmed && data?.readiness_passed && data?.evidence_saved);

  return (
    <div className="rounded-xl border border-white/[.06] bg-black/10 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#666D7E]">WeHouse professional checks</p>
      {loading ? (
        <p className="mt-2 text-[10px] text-[#666D7E]">Checking professional status…</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge good={!!data?.payment_confirmed}>Payment</Badge>
            <Badge good={!!data?.readiness_passed}>Readiness{data?.readiness_percent != null ? ` ${data.readiness_percent}%` : ''}</Badge>
            <Badge good={!!data?.evidence_saved}>Work evidence</Badge>
            <Badge good={!!data?.submitted}>Submitted</Badge>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#73798A]">
            {ready
              ? 'The required WeHouse professional checks are present. Final approval should focus on professional quality, conduct and work evidence.'
              : 'One or more required professional checks are still incomplete. Government ID is not part of this review.'}
          </p>
        </>
      )}
    </div>
  );
}

function Badge({ good, children }: { good: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${good ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{good ? '✓ ' : '• '}{children}</span>;
}
