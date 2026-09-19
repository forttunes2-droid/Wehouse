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
  return matchesLegalChoice(documents.privacy, choices.privacy) && matchesLegalChoice(documents.terms, choices.terms);
}

export function legalDocumentKey(documents: CurrentLegalDocuments) {
  return [documents.privacy?.policy_version_id, documents.privacy?.checksum,
    documents.terms?.policy_version_id, documents.terms?.checksum].join(':');
}
