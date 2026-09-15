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
