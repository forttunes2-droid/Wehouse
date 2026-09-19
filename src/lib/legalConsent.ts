import type { CurrentLegalDocuments, PublishedLegalDocument } from './supabase/legal';

export type LegalKind = 'privacy' | 'terms';
export type LegalChoice = { policy_version_id: string; checksum: string };
export type LegalChoices = Partial<Record<LegalKind, LegalChoice>>;
export const legalTitles: Record<LegalKind, string> = { privacy: 'Privacy Policy', terms: 'Terms of Service' };

export function matchesLegalChoice(document: PublishedLegalDocument | null, choice?: LegalChoice) {
  return Boolean(document?.body.trim() && document.policy_version_id && document.checksum &&
    choice?.policy_version_id === document.policy_version_id && choice?.checksum === document.checksum);
}

export function hasLegalConsent(documents: CurrentLegalDocuments, choices: LegalChoices) {
  // Unpublished documents have no text to accept. Each published document
  // independently requires confirmation of its current version.
  return (['privacy', 'terms'] as const).every(kind =>
    documents[kind] === null || matchesLegalChoice(documents[kind], choices[kind]));
}

export function legalDocumentKey(documents: CurrentLegalDocuments) {
  return [documents.privacy?.policy_version_id, documents.privacy?.checksum,
    documents.terms?.policy_version_id, documents.terms?.checksum].join(':');
}
