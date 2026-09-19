import { useCallback, useState } from 'react';
import type { CurrentLegalDocuments, PublishedLegalDocument } from '@/lib/supabase/legal';
import { legalTitles, matchesLegalChoice, type LegalChoices, type LegalKind } from '@/lib/legalConsent';
import LegalDocumentBody from './LegalDocumentBody';

export default function LegalReview({ documents, choices, onChange }: {
  documents: CurrentLegalDocuments; choices: LegalChoices; onChange: (choices: LegalChoices) => void;
}) {
  const count = Number(Boolean(documents.privacy)) + Number(Boolean(documents.terms));
  if (!count) return null;
  return <section aria-label="Review legal documents" className="space-y-3">
    <p className="text-sm leading-6 text-[#AAA3B3]">{count === 2 ? 'Read both documents and confirm below each one.' : 'Read the document and confirm below it.'}</p>
    {(['privacy', 'terms'] as const).map(kind => {
      const document = documents[kind];
      return document ? <DocumentReview key={`${document.policy_version_id}:${document.checksum}`} document={document}
        kind={kind} checked={matchesLegalChoice(document, choices[kind])}
        onChange={checked => onChange({ ...choices, [kind]: checked ? {
          policy_version_id: document.policy_version_id, checksum: document.checksum,
        } : undefined })} /> : null;
    })}
  </section>;
}

function DocumentReview({ document, kind, checked, onChange }: {
  document: PublishedLegalDocument; kind: LegalKind; checked: boolean; onChange: (checked: boolean) => void;
}) {
  const [reachedEnd, setReachedEnd] = useState(false);
  const markEnd = useCallback(() => setReachedEnd(true), []);
  return <details className="min-w-0 border-b border-white/10 pb-3">
    <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-violet-200">
      {legalTitles[kind]} <span className="font-normal text-[#AAA3B3]">· v{document.version}{checked ? ' · Reviewed' : ''}</span>
    </summary>
    <LegalDocumentBody body={document.body} onReachedEnd={markEnd} />
    <label className="mt-4 flex min-h-12 items-start gap-3 py-3 text-sm leading-6 text-[#F6F2FC]">
      <input type="checkbox" checked={checked} disabled={!reachedEnd}
        onChange={event => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-violet-500" />
      <span>{kind === 'privacy' ? 'I have read and acknowledge this Privacy Policy.' : 'I have read and agree to these Terms of Service.'}</span>
    </label>
  </details>;
}
