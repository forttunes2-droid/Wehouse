import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { acceptReviewedLegalDocument, getCurrentLegalDocuments, type CurrentLegalDocuments } from '@/lib/supabase/legal';
import { hasLegalConsent, legalDocumentKey, type LegalChoices, type LegalKind } from '@/lib/legalConsent';
import LegalReview from './LegalReview';
import WeHouseLoadingState from './WeHouseLoadingState';

type Status = Partial<Record<`${LegalKind}_accepted` | `${LegalKind}_version_id`, boolean | string | null>>;

// Documents a signed-in user still has to accept. Unpublished documents never block.
export function pendingLegalDocuments(documents: CurrentLegalDocuments, status: Status | null): LegalKind[] {
  return (['privacy', 'terms'] as const).filter(kind => {
    const document = documents[kind];
    if (!document?.body.trim()) return false;
    const versionId = status?.[`${kind}_version_id`];
    return !(status?.[`${kind}_accepted`] && (!versionId || versionId === document.policy_version_id));
  });
}

// Blocks signed-in users until they accept the current published Terms and Privacy Policy,
// including existing users when a document is first published or changes.
export default function LegalGate({ userId, onLogout }: { userId: string; onLogout: () => void }) {
  const [documents, setDocuments] = useState<CurrentLegalDocuments | null>(null);
  const [pending, setPending] = useState<LegalKind[]>([]);
  const [choices, setChoices] = useState<LegalChoices>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const [{ documents: current, error: readError }, { data: status, error: statusError }] = await Promise.all([
        getCurrentLegalDocuments(), supabase.rpc('get_my_legal_status'),
      ]);
      // A failed check must not lock people out of the app.
      if (readError || statusError) { setPending([]); return; }
      setDocuments(current);
      setPending(pendingLegalDocuments(current, status as Status));
    } catch { setPending([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void check(); }, [check, userId]);

  async function confirm() {
    if (!documents || saving) return;
    const required = { privacy: pending.includes('privacy') ? documents.privacy : null, terms: pending.includes('terms') ? documents.terms : null };
    if (!hasLegalConsent(required, choices)) return;
    setSaving(true); setError('');
    try {
      for (const kind of pending) {
        const document = documents[kind];
        if (!document) continue;
        const { error: saveError } = await acceptReviewedLegalDocument(kind, document);
        if (saveError) throw saveError;
      }
      setPending([]);
    } catch { setError('Could not save your confirmation. Check your connection and try again.'); }
    finally { setSaving(false); }
  }

  if (loading || !documents || !pending.length) return null;
  const required: CurrentLegalDocuments = { privacy: pending.includes('privacy') ? documents.privacy : null, terms: pending.includes('terms') ? documents.terms : null };
  const ready = hasLegalConsent(required, choices);
  return <div role="dialog" aria-modal="true" aria-labelledby="legal-gate-title" className="fixed inset-0 z-[1000] overflow-y-auto bg-[var(--wh-bg)] text-[var(--wh-text)]">
    <main key={legalDocumentKey(documents)} className="mx-auto w-full max-w-3xl px-5 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] sm:px-8 sm:pt-10">
      <h1 id="legal-gate-title" className="text-2xl font-semibold tracking-tight">Review our updated terms</h1>
      <p className="mb-6 mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">Before you continue, please read and confirm the documents below.</p>
      {saving && <WeHouseLoadingState compact label="Saving" />}
      <LegalReview documents={required} choices={choices} onChange={setChoices} />
      {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
      <button onClick={() => void confirm()} disabled={!ready || saving} className="mt-6 min-h-12 w-full rounded-xl bg-violet-600 px-5 text-sm font-semibold disabled:opacity-40">Confirm and continue</button>
      <button onClick={onLogout} className="mt-3 min-h-12 w-full text-sm font-semibold text-[var(--wh-text-secondary)]">Sign out</button>
    </main>
  </div>;
}
