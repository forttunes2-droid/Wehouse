import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { withTimeout } from '@/lib/withTimeout';

type Publication = {
  enabled: boolean; launch_approved: boolean;
  review?: { status: string; authority: string; reference: string; scope: string; approved_at: string; expires_at: string | null } | null;
  worker?: { publicly_visible: boolean; eligible: boolean; publication_paused: boolean; identity_required: boolean; identity_current: boolean; reasons: string[] } | null;
};
/** One server projection supplies the same eligibility used by public discovery.
 * Account suspension, professional approval and optional paid tools are separate. */
export default function WorkerPublicationControls({ userId, workerId }: { userId: string; workerId?: string }) {
  const { requestElevation } = useCreatorAuth();
  const [state, setState] = useState<Publication | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''), [attempt, setAttempt] = useState(0), [reviewOpen, setReviewOpen] = useState(false);
  const [authority, setAuthority] = useState(''), [reference, setReference] = useState(''), [scope, setScope] = useState('');
  const [reviewDate, setReviewDate] = useState(''), [expiry, setExpiry] = useState(''), [attested, setAttested] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; setState(null); setError(''); setNotice(''); setReason(''); setBusy(false);
    void withTimeout(supabase.rpc('creator_get_worker_publication', {p_worker_id:workerId || null}),15000,'Publication state took too long.').then(result => {
      if (current !== generation.current) return;
      if (result.error || !result.data || typeof result.data.enabled !== 'boolean' || typeof result.data.launch_approved !== 'boolean'
        || (workerId && (!result.data.worker || !Array.isArray(result.data.worker.reasons)))) throw new Error('Publication state could not be verified.');
      setState(result.data as Publication);
    }).catch(() => { if (current === generation.current) setError('Publication controls could not be loaded. No setting was changed.'); });
    return () => { generation.current += 1; };
  }, [userId, workerId, attempt]);

  async function submit(name: string, params: Record<string, unknown>, elevationId: string, current: number) {
    if (current !== generation.current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await withTimeout(supabase.rpc(name, {...params,p_creator_elevation_id:elevationId}),20000,'The change could not be confirmed. Refresh before retrying.');
      if (result.error) throw result.error;
      if (current !== generation.current) return;
      const refreshed = await withTimeout(supabase.rpc('creator_get_worker_publication',{p_worker_id:workerId || null}),15000,'Could not verify the resulting publication state.');
      if (refreshed.error || !refreshed.data || typeof refreshed.data.enabled !== 'boolean') throw new Error('Refresh to verify the resulting publication state.');
      if (current !== generation.current) return;
      setState(refreshed.data as Publication); setReason(''); setReviewOpen(false); setAttested(false);
      setNotice(name === 'creator_record_worker_launch_review' ? 'Review recorded. Opening the marketplace is a separate decision.' : 'Publication control saved. Approval, identity and availability requirements still apply.');
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : String((failure as {message?:string})?.message || 'Change could not be confirmed. Refresh before retrying.'));
    } finally { if (current === generation.current) setBusy(false); }
  }
  function change() {
    if (!state || busy || reason.trim().length < 3) return;
    const current = generation.current;
    const params = workerId ? {p_worker_id:workerId,p_paused:!state.worker?.publication_paused,p_reason:reason.trim()}
      : {p_enabled:!state.enabled,p_reason:reason.trim()};
    requestElevation('all_sensitive', id => void submit(workerId ? 'creator_set_worker_publication' : 'creator_set_worker_marketplace',params,id,current));
  }
  function recordReview() {
    if (busy || !attested || authority.trim().length < 3 || reference.trim().length < 3 || scope.trim().length < 10 || !reviewDate) return;
    const current=generation.current;
    const params={p_authority:authority.trim(),p_reference:reference.trim(),p_scope:scope.trim(),p_approved_at:`${reviewDate}T00:00:00+01:00`,p_expires_at:expiry ? `${expiry}T23:59:59+01:00` : null};
    requestElevation('all_sensitive', id => void submit('creator_record_worker_launch_review',params,id,current));
  }
  const worker=state?.worker;
  const inputClass='mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-[#191C25] px-3 py-2 text-base text-white';
  return <section className="space-y-4 rounded-2xl border border-white/10 bg-[#11141C] p-4 text-white sm:p-5" aria-label={workerId ? 'Worker publication' : 'Worker marketplace controls'}>
    <header><h3 className="text-base font-semibold">{workerId ? 'Public visibility' : 'Worker marketplace'}</h3>
      <p className="mt-2 text-sm leading-6 text-[#B3ADBF]">{workerId ? 'Publication is separate from this person’s Personal account and optional paid tools.' : 'Control customer discovery here. Professional review and each Worker’s eligibility still apply.'}</p></header>
    {error && <div role="alert" className="text-sm leading-6 text-amber-200"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setAttempt(n=>n+1)} className="min-h-11 font-semibold underline">Refresh controls</button></div>}
    {notice && <p role="status" className="text-sm leading-6 text-violet-200">{notice}</p>}
    {!state && !error ? <p role="status" className="text-sm text-[#B3ADBF]">Loading publication state…</p> : state && <>
      <p className="text-base font-semibold">{workerId ? worker?.publicly_visible ? 'Visible to eligible customers' : 'Not visible to customers' : state.enabled && state.launch_approved ? 'Open' : 'Paused'}</p>
      {workerId ? <>
        {worker?.reasons.map(reason=><p key={reason} className="text-sm leading-6 text-[#B3ADBF]">{reason}</p>)}
        {!worker?.identity_required && <p className="text-sm leading-6 text-[#B3ADBF]">Identity checks are currently disabled by platform policy. This is not a passed face check.</p>}
        <p className="text-sm leading-6 text-[#B3ADBF]">Customers also need to match service coverage and cannot see a Worker where a block applies.</p>
      </> : <>
        <p className="text-sm leading-6 text-[#B3ADBF]">{state.launch_approved ? `Launch review recorded: ${state.review?.authority || ''} · ${state.review?.reference || ''}` : 'A current marketplace launch review must be recorded before opening discovery.'}</p>
        <button type="button" onClick={()=>setReviewOpen(open=>!open)} aria-expanded={reviewOpen} className="min-h-11 text-sm font-semibold text-violet-300">{reviewOpen ? 'Close review form' : 'Record an obtained launch review'}</button>
      </>}
      {!reviewOpen && <div>
        <label className="block text-sm">Reason for this change<textarea rows={2} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className={inputClass} /></label>
        <button type="button" disabled={busy || reason.trim().length<3 || (!workerId && !state.enabled && !state.launch_approved)} onClick={change} className="mt-3 min-h-11 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-40">
          {busy ? 'Saving…' : workerId ? worker?.publication_paused ? 'Restore publication eligibility' : 'Pause publication' : state.enabled ? 'Pause customer discovery' : 'Open customer discovery'}
        </button>
      </div>}
      {!workerId && reviewOpen && <div className="space-y-4 border-t border-white/10 pt-4">
        <p className="text-sm leading-6 text-[#B3ADBF]">Record an actual review you obtained and retain its evidence in your restricted company records. Completing this form does not perform legal review or grant a licence.</p>
        <label className="block text-sm">Reviewer or authority<input maxLength={200} value={authority} onChange={e=>setAuthority(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm">Review reference<input maxLength={300} value={reference} onChange={e=>setReference(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm">What the review covers<textarea rows={3} maxLength={3000} value={scope} onChange={e=>setScope(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm">Review date<input type="date" value={reviewDate} onChange={e=>setReviewDate(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm">Expiry date, when applicable<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)} className={inputClass} /></label>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />I obtained this review and can provide its evidence. This does not approve any individual Worker.</label>
        <button type="button" disabled={busy || !attested || !reviewDate || authority.trim().length<3 || reference.trim().length<3 || scope.trim().length<10} onClick={recordReview} className="min-h-11 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-40">Record review</button>
      </div>}
    </>}
  </section>;
}
