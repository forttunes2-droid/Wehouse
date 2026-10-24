import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';

/** Essential fulfillment information belongs in normal property operations. */
export default function PropertyArrivalInstructions({ kind, assetId, accountId }: {
  kind: 'home' | 'hotel'; assetId: string; accountId: string;
}) {
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    const request = ++generation.current;
    setDraft(''); setState('loading'); setBusy(false); saving.current = false;
    void (async () => {
      try {
        const result = await withTimeout(supabase.rpc('get_my_property_arrival_instructions', {
          p_kind: kind, p_asset_id: assetId,
        }), 10000, 'Arrival instructions took too long to load');
        if (result.error || typeof result.data !== 'string') throw new Error('Unavailable');
        if (request === generation.current) { setDraft(result.data); setState('ready'); }
      } catch { if (request === generation.current) setState('error'); }
    })();
    return () => { generation.current++; };
  }, [kind, assetId, accountId, revision]);
  async function save() {
    if (saving.current || state !== 'ready') return;
    saving.current = true; setBusy(true);
    const request = generation.current;
    try {
      const result = await withTimeout(supabase.rpc('save_my_property_arrival_instructions', {
        p_kind: kind, p_asset_id: assetId, p_instructions: draft.trim(),
      }), 10000, 'Save confirmation is delayed. Reload the instructions before trying again.');
      if (result.error || result.data !== true) throw new Error('Save confirmation is unavailable. Reload before trying again.');
      if (request === generation.current) toast.success('Arrival instructions saved');
    } catch (error) {
      if (request === generation.current) {
        setState('error');
        toast.error(error instanceof Error ? error.message : 'Reload instructions to check whether they saved');
      }
    } finally {
      if (request === generation.current) { saving.current = false; setBusy(false); }
    }
  }
  return <section aria-label="Guest arrival instructions" className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)]">
    <h3 className="text-base font-semibold">Guest arrival instructions</h3>
    <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Included with normal hosting. Directions, reception details and entry steps appear in eligible paid bookings. Send temporary access codes privately closer to arrival.</p>
    {state === 'loading' ? <p role="status" className="text-sm">Loading instructions…</p> : state === 'error' ?
      <div role="alert" className="text-sm"><p>Instructions could not be confirmed. Reload to check the saved version.</p><button type="button" onClick={() => setRevision(value => value + 1)} className="mt-2 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 font-semibold">Reload instructions</button></div> : <>
        <label className="block text-sm font-medium">Instructions<textarea aria-label="Instructions" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} rows={5} maxLength={1500} className="mt-2 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-sm leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500" /></label>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[var(--wh-text-secondary)]">{draft.length}/1500 · Clear and save to remove</span><button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save instructions'}</button></div>
      </>}
  </section>;
}
