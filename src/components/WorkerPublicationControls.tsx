import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { withTimeout } from '@/lib/withTimeout';

type Publication = {
  enabled: boolean;
  worker?: { publicly_visible: boolean; eligible: boolean; publication_paused: boolean; identity_required: boolean; identity_current: boolean; reasons: string[] } | null;
};

/** Creator controls discovery; the server still checks each Worker's eligibility. */
export default function WorkerPublicationControls({ userId, workerId }: { userId: string; workerId?: string }) {
  const { requestElevation } = useCreatorAuth();
  const [state, setState] = useState<Publication | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''), [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setState(null); setError(''); setNotice(''); setReason(''); setBusy(false);
    void withTimeout(supabase.rpc('creator_get_worker_publication', { p_worker_id: workerId || null }), 15000, 'Publication state took too long.').then(result => {
      if (current !== generation.current) return;
      if (result.error || !result.data || typeof result.data.enabled !== 'boolean'
        || (workerId && (!result.data.worker || !Array.isArray(result.data.worker.reasons)))) throw new Error('Publication state could not be verified.');
      setState(result.data as Publication);
    }).catch(() => { if (current === generation.current) setError('Publication controls could not be loaded. No setting was changed.'); });
    return () => { generation.current++; };
  }, [userId, workerId, attempt]);

  function change() {
    if (!state || busy || reason.trim().length < 3) return;
    const current = generation.current;
    const name = workerId ? 'creator_set_worker_publication' : 'creator_set_worker_marketplace';
    const params = workerId ? { p_worker_id: workerId, p_paused: !state.worker?.publication_paused, p_reason: reason.trim() }
      : { p_enabled: !state.enabled, p_reason: reason.trim() };
    requestElevation('all_sensitive', id => {
      if (current !== generation.current) return;
      void (async () => {
        setBusy(true); setError(''); setNotice('');
        try {
          const result = await withTimeout(supabase.rpc(name, { ...params, p_creator_elevation_id: id }), 20000, 'The change could not be confirmed. Refresh before retrying.');
          if (result.error) throw result.error;
          const refreshed = await withTimeout(supabase.rpc('creator_get_worker_publication', { p_worker_id: workerId || null }), 15000, 'Could not verify the resulting publication state.');
          if (refreshed.error || !refreshed.data || typeof refreshed.data.enabled !== 'boolean') throw new Error('Refresh to verify the resulting publication state.');
          if (current !== generation.current) return;
          setState(refreshed.data as Publication); setReason('');
          setNotice('Publication control saved. Professional review, the configured identity policy and availability requirements still apply.');
        } catch (failure) {
          if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Change could not be confirmed. Refresh before retrying.');
        } finally { if (current === generation.current) setBusy(false); }
      })();
    });
  }

  const worker = state?.worker;
  return <section className="space-y-4 rounded-2xl border border-white/10 bg-[#11141C] p-4 text-white sm:p-5" aria-label={workerId ? 'Worker publication' : 'Worker marketplace controls'}>
    <header><h3 className="text-base font-semibold">{workerId ? 'Public visibility' : 'Worker marketplace'}</h3>
      <p className="mt-2 text-sm leading-6 text-[#B3ADBF]">{workerId ? 'Publication is separate from this person’s Personal account and optional paid tools.' : 'Control customer discovery here. Each Worker still has to qualify to appear.'}</p></header>
    {error && <div role="alert" className="text-sm leading-6 text-amber-200"><p>{error}</p><button type="button" disabled={busy} onClick={() => setAttempt(n => n + 1)} className="min-h-11 font-semibold underline">Refresh controls</button></div>}
    {notice && <p role="status" className="text-sm leading-6 text-violet-200">{notice}</p>}
    {!state && !error ? <p role="status" className="text-sm text-[#B3ADBF]">Loading publication state…</p> : state && <>
      <p className="text-base font-semibold">{workerId ? worker?.publicly_visible ? 'Visible to eligible customers' : 'Not visible to customers' : state.enabled ? 'Open' : 'Paused'}</p>
      {workerId ? <>
        {worker?.reasons.map(item => <p key={item} className="text-sm leading-6 text-[#B3ADBF]">{item}</p>)}
        {!worker?.identity_required && <p className="text-sm leading-6 text-[#B3ADBF]">Identity checks are currently disabled by platform policy. This is not a passed face check.</p>}
        <p className="text-sm leading-6 text-[#B3ADBF]">Service coverage and account blocks still apply to customer discovery.</p>
      </> : <p className="text-sm leading-6 text-[#B3ADBF]">Workers need an approved professional profile, availability and service coverage. Identity checks apply when enabled; opening discovery does not approve any Worker.</p>}
      <div><label className="block text-sm">Reason for this change<textarea rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-[#191C25] px-3 py-2 text-base text-white" /></label>
        <button type="button" disabled={busy || reason.trim().length < 3} onClick={change} className="mt-3 min-h-11 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-40">
          {busy ? 'Saving…' : workerId ? worker?.publication_paused ? 'Restore publication eligibility' : 'Pause publication' : state.enabled ? 'Pause customer discovery' : 'Open customer discovery'}
        </button></div>
    </>}
  </section>;
}
