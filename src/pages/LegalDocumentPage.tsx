import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { acceptReviewedLegalDocument, getCurrentLegalDocuments, type PublishedLegalDocument } from '@/lib/supabase/legal';
import { legalTitles, type LegalKind } from '@/lib/legalConsent';
import LegalDocumentBody from '@/components/LegalDocumentBody';

export default function LegalDocumentPage({ kind }: { kind: LegalKind }) {
  const [document, setDocument] = useState<PublishedLegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const markEnd = useCallback(() => setReachedEnd(true), []);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setChecked(false); setReachedEnd(false); setAccepted(false);
    try {
      const [{ documents, error: readError }, { data: session, error: sessionError }] = await Promise.all([
        getCurrentLegalDocuments(), supabase.auth.getSession(),
      ]);
      if (readError || sessionError) throw readError || sessionError;
      setDocument(documents[kind]);
      setLoggedIn(Boolean(session.session));
      if (session.session) {
        const { data, error: statusError } = await supabase.rpc('get_my_legal_status');
        if (statusError) throw statusError;
        setAccepted(Boolean(data?.[`${kind}_accepted`] && data?.[`${kind}_version_id`] === documents[kind]?.policy_version_id));
      }
    } catch { setError('This document could not be loaded. Please try again.'); }
    finally { setLoading(false); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  async function accept() {
    if (!document || !checked || !reachedEnd || saving) return;
    setSaving(true); setError('');
    try {
      const { error: saveError } = await acceptReviewedLegalDocument(kind, document);
      if (saveError) throw saveError;
      setAccepted(true);
    } catch {
      setChecked(false); setError('Could not save your confirmation. Reload the document and try again.');
    } finally { setSaving(false); }
  }
  function back() { if (window.history.length > 1) window.history.back(); else window.location.href = '/'; }

  return <div className="min-h-[100svh] bg-[#0E0C12] text-[#F6F2FC]">
    <main className="mx-auto w-full max-w-3xl pl-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))] pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))] sm:px-8 sm:pt-10">
      <button type="button" onClick={back} className="mb-6 min-h-11 rounded-md pr-4 text-sm font-semibold text-violet-300">← Back</button>
      <h1 className="text-3xl font-semibold tracking-tight">{legalTitles[kind]}</h1>
      {loading ? <p role="status" className="mt-8 text-sm text-[#AAA3B3]">Loading document…</p> : error ?
        <div className="mt-8"><p role="alert" className="text-sm text-red-200">{error}</p><button onClick={() => void load()} className="mt-4 min-h-11 text-sm font-semibold text-violet-300">Reload document</button></div> : document ? <>
          <p className="mb-8 mt-3 text-sm text-[#AAA3B3]">Version {document.version} · Effective {new Date(document.effective_from).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <LegalDocumentBody key={`${document.policy_version_id}:${document.checksum}`} body={document.body} onReachedEnd={loggedIn && !accepted ? markEnd : undefined} />
          {loggedIn && <section className="mt-8 border-t border-white/10 pt-6">
            {accepted ? <p role="status" className="text-sm text-emerald-300">You have confirmed this version.</p> : <>
              <label className="flex min-h-12 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={checked} disabled={!reachedEnd} onChange={event => setChecked(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-violet-500" /><span>{kind === 'privacy' ? 'I have read and acknowledge this policy.' : 'I have read and agree to these terms.'}</span></label>
              <button onClick={() => void accept()} disabled={!checked || !reachedEnd || saving} className="mt-4 min-h-12 w-full rounded-xl bg-violet-600 px-5 text-sm font-semibold disabled:opacity-40 sm:w-auto">{saving ? 'Saving…' : 'Confirm'}</button>
            </>}
          </section>}
        </> : <p className="mt-8 text-base leading-7 text-[#AAA3B3]">Not published yet. The reviewed document will appear here when it is available.</p>}
    </main>
  </div>;
}
