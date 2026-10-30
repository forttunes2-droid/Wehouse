export type PropertyDocumentRequirement = { code: string; label: string; instructions: string; requires_expiry: boolean };
export type PropertyDocument = {
  id: string; request_id: string; requirement_code: string; requirements_revision: number; version: number;
  original_name: string; mime_type: string; byte_size: number; object_path: string;
  status: 'uploading' | 'submitted' | 'approved' | 'correction_required' | 'rejected' | 'abandoned';
  submitted_at: string | null; reviewed_at: string | null; review_note: string | null; expires_at: string | null;
};
export type WorkerCredentialContext = {
  occupation: string | null; skills: string[] | null; country: string | null; state: string | null;
  coverage: { state: string; lga: string }[];
};
export type PropertyDocumentReview = {
  configured: boolean; revision: number; requirements: PropertyDocumentRequirement[]; documents: PropertyDocument[];
  requirements_note: string | null; requirements_set_at: string | null; ready: boolean; can_review: boolean; can_submit: boolean;
  context_current?:boolean;
  service_context?: WorkerCredentialContext;
  requirements_context?: WorkerCredentialContext | null;
};
export const PROPERTY_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const PROPERTY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export async function validatePropertyDocument(file: Blob): Promise<void> {
  if (!PROPERTY_DOCUMENT_TYPES.some(type => type === file.type) || file.size < 1 || file.size > PROPERTY_DOCUMENT_MAX_BYTES) {
    throw new Error('Choose a PDF, JPG, PNG or WebP document up to 10 MB.');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const text = new TextDecoder().decode(bytes);
  const matches = file.type === 'application/pdf' ? text.startsWith('%PDF-')
    : file.type === 'image/jpeg' ? starts(0xff, 0xd8, 0xff)
      : file.type === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP';
  if (!matches) throw new Error('The file contents do not match its document type. Choose the original document.');
}

export function propertyDocumentStatus(document?: Pick<PropertyDocument, 'status' | 'expires_at'>, now = Date.now()): string {
  if (!document) return 'Not submitted';
  if (document.status === 'approved' && document.expires_at && !Number.isFinite(Date.parse(document.expires_at))) return 'Expiry unavailable';
  if (document.status === 'approved' && document.expires_at && Date.parse(document.expires_at) <= now) return 'Expired';
  return { uploading: 'Upload unfinished', submitted: 'Awaiting review', approved: 'Approved',
    correction_required: 'Correction required', rejected: 'Rejected', abandoned: 'Discarded' }[document.status];
}

export function parsePropertyDocumentReview(value: unknown): PropertyDocumentReview {
  const row = value as PropertyDocumentReview | null;
  const validContext = (context: WorkerCredentialContext | null | undefined) => context == null ||
    typeof context === 'object' && Array.isArray(context.coverage) &&
    context.coverage.every(area => area && typeof area.state === 'string' && typeof area.lga === 'string') &&
    [context.occupation, context.country, context.state].every(item => item == null || typeof item === 'string');
  if (!row || typeof row.configured !== 'boolean' || !Number.isInteger(row.revision) || typeof row.ready !== 'boolean'
    || typeof row.can_review !== 'boolean' || typeof row.can_submit !== 'boolean' || !Array.isArray(row.requirements) || !Array.isArray(row.documents)
    || row.context_current!==undefined&&typeof row.context_current!=='boolean' || row.context_current===false&&(row.ready||row.can_submit)
    || row.ready&&!row.configured
    || !validContext(row.service_context) || !validContext(row.requirements_context)
    || row.requirements.some(item => !item || typeof item.code !== 'string' || typeof item.label !== 'string' || typeof item.instructions !== 'string' || typeof item.requires_expiry !== 'boolean')
    || row.documents.some(item => !item || typeof item.id !== 'string' || typeof item.object_path !== 'string' || typeof item.original_name !== 'string'
      || !['uploading','submitted','approved','correction_required','rejected','abandoned'].includes(item.status)
      || item.expires_at!=null&&(typeof item.expires_at!=='string'||!Number.isFinite(Date.parse(item.expires_at))))) {
    throw new Error('Document status could not be confirmed.');
  }
  return row;
}
