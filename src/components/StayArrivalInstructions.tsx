import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';

/** The booking-scoped RPC checks guest ownership and successful stay payment. */
export default function StayArrivalInstructions({ kind, bookingId }: { kind: 'home' | 'hotel'; bookingId: string }) {
  const [instructions, setInstructions] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading,setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setInstructions(null);
    setError(false);
    setLoading(true);
    void withTimeout(supabase.rpc('get_my_stay_arrival_instructions', {p_kind:kind,p_booking_id:bookingId}), 10000, 'Arrival details took too long to load')
      .then(({ data, error }) => {
        if (error || (data !== null && typeof data !== 'string')) throw new Error('Arrival details unavailable');
        if (current) setInstructions(data);
      }).catch(() => { if (current) setError(true); }).finally(()=>{if(current)setLoading(false);});
    return () => { current = false; };
  }, [kind,bookingId,revision]);
  if (error) return <section role="alert" className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-sm text-[var(--wh-text)]"><p>Arrival information could not be loaded.</p><button type="button" onClick={() => setRevision(value => value + 1)} className="mt-2 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 font-semibold">Retry arrival information</button></section>;
  if(loading)return <p role="status" className="mt-4 text-sm text-[var(--wh-text-secondary)]">Loading arrival information…</p>;
  if (!instructions) return <section className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-sm text-[var(--wh-text-secondary)]"><h3 className="font-semibold text-[var(--wh-text-primary)]">Arrival information</h3><p className="mt-2">Instructions have not been provided yet. Contact your arrival manager or get help from WeHouse through this booking before travelling.</p></section>;
  return <section aria-label="Arrival instructions" className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">Arrival instructions from your host</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--wh-text-secondary)]">{instructions}</p>
  </section>;
}
