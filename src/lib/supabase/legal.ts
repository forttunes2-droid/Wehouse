import { supabase } from "./client";

export type PublishedLegalDocument = {
  policy_version_id: string;
  version: number;
  title: string;
  body: string;
  locale: string;
  effective_from: string;
  checksum: string;
};

export type CurrentLegalDocuments = {
  privacy: PublishedLegalDocument | null;
  terms: PublishedLegalDocument | null;
};

export async function getCurrentLegalDocuments() {
  const { data, error } = await supabase.rpc("get_current_legal_documents");
  const value = (data || {}) as Partial<CurrentLegalDocuments>;
  return {
    documents: {
      privacy: value.privacy || null,
      terms: value.terms || null,
    } as CurrentLegalDocuments,
    error,
  };
}

// The server checks the exact version that was shown, not whichever version
// happens to be current when the request reaches it.
export async function acceptReviewedLegalDocument(kind: 'privacy' | 'terms', document: PublishedLegalDocument) {
  return supabase.rpc('accept_reviewed_legal', {
    p_document: kind,
    p_policy_version_id: document.policy_version_id,
    p_checksum: document.checksum,
  });
}
