import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** The booking-scoped RPC checks guest ownership and successful stay payment. */
export default function StayArrivalInstructions({ kind, bookingId }: { kind: 'home' | 'hotel'; bookingId: string }) {
  const [instructions, setInstructions] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setInstructions(null);
    void supabase.rpc('get_my_stay_arrival_instructions', {p_kind:kind,p_booking_id:bookingId})
      .then(({ data, error }) => { if (current && !error && typeof data === 'string') setInstructions(data); });
    return () => { current = false; };
  }, [kind,bookingId]);
  if (!instructions) return null;
  return <section aria-label="Arrival instructions" className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">Arrival instructions from your host</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--wh-text-secondary)]">{instructions}</p>
  </section>;
}
