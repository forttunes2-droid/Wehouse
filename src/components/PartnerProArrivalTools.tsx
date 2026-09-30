import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import WeHouseChoice from '@/components/WeHouseChoice';
import { supabase } from '@/lib/supabase';

type Asset = { kind: 'home' | 'hotel'; id: string; title: string };
type Occupancy = { kind: Asset['kind']; asset_id: string; title: string; booked_unit_nights: number; available_unit_nights: number };
type Instructions = { kind: Asset['kind']; asset_id: string; instructions: string };
const assetKey = (kind: string, id: string) => `${kind}:${id}`;

export default function PartnerProArrivalTools({ assets }: { assets: Asset[] }) {
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [instructions, setInstructions] = useState<Instructions[]>([]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: failure } = await supabase.rpc('get_my_partner_pro_arrival_setup');
      if (failure || !Array.isArray(data?.occupancy) || !Array.isArray(data?.instructions)) {
        setError(true); setOccupancy([]); setInstructions([]);
      } else { setError(false); setOccupancy(data.occupancy); setInstructions(data.instructions); }
    } catch { setError(true); setOccupancy([]); setInstructions([]); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const current = assets.find(row => assetKey(row.kind,row.id) === selected);
  function choose(value: string) {
    setSelected(value);
    const item = instructions.find(row => assetKey(row.kind,row.asset_id) === value);
    setDraft(item?.instructions || '');
  }
  async function save() {
    if (!current || busy) return;
    setBusy(true);
    try {
      const { error: failure } = await supabase.rpc('save_my_partner_pro_arrival_instructions', {
        p_kind: current.kind,p_asset_id: current.id,p_instructions: draft.trim(),
      });
      if (failure) throw failure;
      toast.success('Arrival instructions saved');
      await load();
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : 'Could not save instructions'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Occupancy and arrival instructions" className="space-y-5">
    {loading ? <p role="status" className="py-8 text-sm">Loading occupancy and arrival details…</p> : error ?
      <div role="alert" className="rounded-2xl border p-4 text-sm">Could not load the portfolio details. <button onClick={()=>void load()} className="underline">Try again</button></div> : <>
      <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Next 30 days</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">Booked unit nights from paid or confirmed stays, divided by listed room capacity for hotels or 30 nights for a home. Cancelled stays are excluded. Room closures and manual occupancy are not counted.</p>
        {!occupancy.length ? <p className="mt-4 text-sm">No owned places to report.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{occupancy.map(row => {
          const percent = row.available_unit_nights > 0 ? Math.min(100,Math.round(row.booked_unit_nights / row.available_unit_nights * 100)) : null;
          return <article key={assetKey(row.kind,row.asset_id)} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><div className="flex justify-between gap-2"><h3 className="text-sm font-semibold">{row.title}</h3><strong className="text-violet-600 dark:text-violet-300">{percent===null ? '—' : `${percent}%`}</strong></div><p className="mt-2 text-xs text-[var(--wh-text-secondary)]">{row.booked_unit_nights} booked of {row.available_unit_nights} listed unit nights · {row.kind==='hotel'?'Hotel':'Home'}</p><div role="img" aria-label={percent===null?'No listed room capacity':`${percent}% occupied`} className="mt-3 h-2 rounded-full bg-[var(--wh-interactive)]"><div className="h-full rounded-full bg-violet-500" style={{width:`${percent || 0}%`}}/></div></article>;
        })}</div>}
      </section>
      <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Guest arrival instructions</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">Add directions, entry steps or a reception note. These appear in the guest’s paid booking. Avoid permanent door codes or other secrets that should be sent closer to arrival.</p>
        <label className="mt-4 block text-sm font-medium">Place<WeHouseChoice aria-label="Arrival instructions property" value={selected} onChange={event=>choose(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-3"><option value="">Choose a place</option>{assets.map(row=><option key={assetKey(row.kind,row.id)} value={assetKey(row.kind,row.id)}>{row.title} · {row.kind}</option>)}</WeHouseChoice></label>
        {current && <><textarea aria-label="Guest arrival instructions" rows={5} maxLength={1500} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="e.g. Enter through reception on Main Street. Ask for the WeHouse booking desk." className="mt-3 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3 text-sm"/><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-[var(--wh-text-secondary)]">{draft.length}/1500 · Clear and save to remove</span><button type="button" disabled={busy} onClick={()=>void save()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy?'Saving…':'Save instructions'}</button></div></>}
      </section>
    </>}
  </section>;
}
