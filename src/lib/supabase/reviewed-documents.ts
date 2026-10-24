import { supabase } from './client';
import { withTimeout } from '@/lib/withTimeout';
import { requestKeyFor, releaseRequestKey, runSafeAction } from '@/lib/safeAction';
import { parsePropertyDocumentReview, validatePropertyDocument, type PropertyDocument } from '@/lib/propertyDocuments';

export type DocumentKind='property'|'worker'|'experience';
const route=(kind:DocumentKind)=>kind==='experience'?{read:'get_experience_evidence_review',begin:'begin_experience_evidence_upload',finish:'finish_experience_evidence_upload',key:'p_activity_id',bucket:'experience-evidence'}:kind==='worker'?{read:'get_worker_credential_review',begin:'begin_worker_credential_upload',finish:'finish_worker_credential_upload',key:'p_worker_id',bucket:'worker-credentials'}:{read:'get_property_document_review',begin:'begin_property_document_upload',finish:'finish_property_document_upload',key:'p_request_id',bucket:'property-documents'};
export async function getReviewedDocuments(requestId: string,kind:DocumentKind='property') {
  const source=route(kind);
  const { data, error } = await withTimeout(supabase.rpc(source.read, { [source.key]: requestId }), 15000, 'Documents took too long to load.');
  if (error) throw error;
  return parsePropertyDocumentReview(data);
}

export async function submitReviewedDocument(requestId: string, code: string, file: File,kind:DocumentKind='property') {
  const source=route(kind);
  return runSafeAction(`${kind}-document:${requestId}:${code}`, async () => {
    await validatePropertyDocument(file);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
    const signature = `${kind}-document:${requestId}:${code}:${digest}`;
    const { data, error } = await withTimeout(supabase.rpc(source.begin, {
      [source.key]: requestId, p_requirement_code: code, p_request_key: requestKeyFor(signature),
      p_mime_type: file.type, p_byte_size: file.size, p_original_name: file.name.slice(0, 180),
    }), 15000, 'The upload reference could not be confirmed. Refresh status before retrying.');
    if (error) throw error;
    const document = data as PropertyDocument;
    if (!document?.id || !document.object_path || document.request_id !== requestId || document.requirement_code !== code ||
      document.mime_type !== file.type || document.byte_size !== file.size || document.original_name !== file.name.slice(0, 180).trim() ||
      !Number.isSafeInteger(document.requirements_revision) || document.requirements_revision < 1 ||
      !Number.isSafeInteger(document.version) || document.version < 1 ||
      !['uploading','submitted','approved','correction_required','rejected','abandoned'].includes(document.status)) throw new Error('The upload reference could not be confirmed.');
    if (document.status === 'abandoned') { releaseRequestKey(signature); throw new Error('The earlier upload was discarded. Choose the file again to start a new version.'); }
    if (document.status !== 'uploading') { releaseRequestKey(signature); return document; }
    const upload = await withTimeout(supabase.storage.from(source.bucket).upload(document.object_path, file, { contentType: file.type, upsert: false }), 90000, 'Upload confirmation timed out. Refresh status before retrying the same file.');
    if (upload.error && String(upload.error.statusCode) !== '409' && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
    const result = await withTimeout(supabase.rpc(source.finish, { p_document_id: document.id, p_discard: false }), 15000, 'Submission confirmation timed out. Refresh status before retrying.');
    if (result.error) throw result.error;
    const confirmed = result.data as PropertyDocument;
    if (confirmed?.id !== document.id || confirmed.request_id !== requestId ||
      confirmed.requirement_code !== code || confirmed.object_path !== document.object_path ||
      confirmed.mime_type !== document.mime_type || confirmed.byte_size !== document.byte_size ||
      confirmed.requirements_revision !== document.requirements_revision || confirmed.version !== document.version ||
      !confirmed.submitted_at || !['submitted','approved','correction_required','rejected'].includes(confirmed.status)) throw new Error('The document submission has not been confirmed.');
    releaseRequestKey(signature);
    return confirmed;
  });
}

export async function finishReviewedDocument(documentId: string, discard = false,kind:DocumentKind='property') {
  const { data, error } = await withTimeout(supabase.rpc(route(kind).finish, { p_document_id: documentId, p_discard: discard }), 15000, 'Document status could not be confirmed. Refresh before retrying.');
  if (error) throw error;
  if (data?.id !== documentId || !(discard ? ['abandoned'] : ['submitted','approved','correction_required','rejected']).includes(data.status)) throw new Error('Document status could not be confirmed.');
  return data as PropertyDocument;
}

export async function downloadReviewedDocument(document: PropertyDocument,kind:DocumentKind='property'): Promise<Blob> {
  const { data, error } = await withTimeout(supabase.storage.from(route(kind).bucket).download(document.object_path), 30000, 'Document download timed out.');
  if (error || !data) throw error || new Error('Document could not be downloaded.');
  await validatePropertyDocument(data.slice(0, data.size, document.mime_type));
  return data.slice(0, data.size, document.mime_type);
}
