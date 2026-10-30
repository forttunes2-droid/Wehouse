import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';

type Occupancy = { kind: 'home' | 'hotel'; asset_id: string; title: string; booked_unit_nights: number; available_unit_nights: number };
const assetKey = (kind: string, id: string) => `${kind}:${id}`;

export default function PartnerProOccupancy() {
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: failure } = await withTimeout(supabase.rpc('get_my_partner_pro_occupancy'), 10000, 'Occupancy took too long to load');
      if (failure || !Array.isArray(data?.occupancy)) {
        setError(true); setOccupancy([]);
      } else { setError(false); setOccupancy(data.occupancy); }
    } catch { setError(true); setOccupancy([]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section aria-label="Portfolio occupancy" className="space-y-5">
    {loading ? <WeHouseLoadingState compact label="Loading portfolio occupancy" /> : error ?
      <div role="alert" className="rounded-2xl border p-4 text-sm">Could not load the portfolio details. <button onClick={()=>void load()} className="underline">Try again</button></div> : <>
      <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Next 30 days</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">Booked unit nights from paid or confirmed stays, divided by listed room capacity for hotels or 30 nights for a home. Cancelled stays are excluded. Room closures and manual occupancy are not counted.</p>
        {!occupancy.length ? <p className="mt-4 text-sm">No owned places to report.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{occupancy.map(row => {
          const percent = row.available_unit_nights > 0 ? Math.min(100,Math.round(row.booked_unit_nights / row.available_unit_nights * 100)) : null;
          return <article key={assetKey(row.kind,row.asset_id)} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><div className="flex justify-between gap-2"><h3 className="text-sm font-semibold">{row.title}</h3><strong className="text-violet-600 dark:text-violet-300">{percent===null ? '—' : `${percent}%`}</strong></div><p className="mt-2 text-xs text-[var(--wh-text-secondary)]">{row.booked_unit_nights} booked of {row.available_unit_nights} listed unit nights · {row.kind==='hotel'?'Hotel':'Home'}</p><div role="img" aria-label={percent===null?'No listed room capacity':`${percent}% occupied`} className="mt-3 h-2 rounded-full bg-[var(--wh-interactive)]"><div className="h-full rounded-full bg-violet-500" style={{width:`${percent || 0}%`}}/></div></article>;
        })}</div>}
      </section>
    </>}
  </section>;
}
