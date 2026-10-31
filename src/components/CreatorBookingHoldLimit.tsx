import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';
import {supabase} from '@/lib/supabase';
import {withTimeout} from '@/lib/withTimeout';

type Limit = {limit: number; updated_at: string};
function readLimit(data: unknown): Limit {
  const value = data as Partial<Limit> | null;
  if (!value || !Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 20 ||
      typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new Error('Reservation limits are unavailable');
  return value as Limit;
}

export default function CreatorBookingHoldLimit() {
  const {requestElevation} = useCreatorAuth();
  const generation = useRef(0);
  const saving = useRef(false);
  const [saved, setSaved] = useState<Limit | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const current = ++generation.current;
    setSaved(null);setError('');
    try {
      const {data, error: failure} = await withTimeout(supabase.rpc('creator_get_unpaid_home_hold_limit'),15000,'Reservation limits took too long to load');
      if (failure) throw failure;
      const next = readLimit(data);
      if (current === generation.current) {setSaved(next);setValue(String(next.limit));}
    } catch {
      if (current === generation.current) setError('Reservation limits could not be loaded. Try again before editing.');
    }
  }
  useEffect(() => {void load();return () => {generation.current += 1;};}, []);
  const next = Number(value);
  const valid = Number.isInteger(next) && next >= 1 && next <= 20;
  function save() {
    if (!saved || !valid || next === saved.limit || saving.current) return;
    const current = generation.current;
    const previous = saved;
    requestElevation('policy_publish', elevation => {
      if (current !== generation.current || saving.current) return;
      saving.current = true;setBusy(true);
      void (async () => {
        try {
          const {data, error: failure} = await withTimeout(supabase.rpc('creator_set_unpaid_home_hold_limit', {
            p_limit: next, p_expected_updated_at: previous.updated_at, p_creator_elevation_id: elevation,
          }),15000,'Save could not be confirmed. Reload the limit before retrying.');
          if (failure) throw failure;
          const result = readLimit(data);
          if (current !== generation.current) return;
          setSaved(result);setValue(String(result.limit));setError('');toast.success('Reservation limit updated');
        } catch {
          if (current === generation.current) {setSaved(null);setError('Save could not be confirmed. Reload the current limit before editing again.');}
        } finally {
          saving.current = false;
          if (current === generation.current) setBusy(false);
        }
      })();
    });
  }
  return <section className="rounded-2xl border border-[var(--wh-border-subtle)] p-4">
    <h4 className="text-sm font-semibold">Unpaid reservations</h4>
    <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">Limit simultaneous unpaid Long Let and Short Let checkouts per person. Paid bookings do not count. Changing this limit does not cancel existing holds.</p>
    {error ? <div role="alert" className="mt-3 text-xs text-[var(--wh-text-secondary)]">{error}<button type="button" disabled={busy} onClick={() => void load()} className="ml-2 min-h-11 underline">Reload</button></div> :
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--wh-text-secondary)]">Maximum per person
          <input type="number" min={1} max={20} step={1} value={value} disabled={!saved || busy} onChange={event => setValue(event.target.value)}
            className="mt-1 block min-h-11 w-24 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-[var(--wh-text)] disabled:opacity-50" />
        </label>
        <button type="button" onClick={save} disabled={!saved || !valid || next === saved.limit || busy}
          className="min-h-11 rounded-xl bg-[var(--wh-text)] px-4 text-xs font-semibold text-[var(--wh-bg)] disabled:opacity-40">{busy ? 'Saving…' : 'Save limit'}</button>
        {!saved && <p role="status" className="text-xs text-[var(--wh-text-muted)]">Loading limit…</p>}
      </div>}
  </section>;
}
