import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function validSignature(rawBody: string, signatureHeader: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  const supplied = signatureHeader.trim().replace(/^sha256=/i, '');
  return constantTimeEqual(supplied.toLowerCase(), toHex(signature)) || constantTimeEqual(supplied, toBase64(signature));
}
function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = Deno.env.get('YOUVERIFY_WEBHOOK_SECRET');
    const signature = req.headers.get('x-youverify-signature') || '';
    if (!supabaseUrl || !serviceKey || !webhookSecret) return new Response('Webhook configuration incomplete', { status: 503 });
    if (!signature) return new Response('Missing signature', { status: 401 });

    const rawBody = await req.text();
    if (!(await validSignature(rawBody, signature, webhookSecret))) return new Response('Invalid signature', { status: 401 });
    let event: any;
    try { event = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }
    if (event?.event !== 'identity.completed') return new Response('Ignored', { status: 200 });

    const data = event?.data && typeof event.data === 'object' ? event.data : {};
    const reference = firstString(data?.id, data?.verificationId, data?.referenceId, data?.reportId);
    if (!reference) return new Response('Ignored', { status: 200 });
    const rawStatus = firstString(data?.status, data?.taskStatus, event?.status).toLowerCase();
    const faceMatch = data?.validations?.selfie?.selfieVerification?.match === true;
    const validationMessage = firstString(data?.validations?.validationMessages, data?.reason, event?.message);

    let identityStatus: 'verified' | 'failed' | 'pending_external' | 'needs_retry';
    let failureReason: string | null = null;
    if (['pending', 'pending_external', 'processing', 'in_progress'].includes(rawStatus)) identityStatus = 'pending_external';
    else if (rawStatus === 'found' && faceMatch) identityStatus = 'verified';
    else if (rawStatus === 'found') { identityStatus = 'failed'; failureReason = validationMessage || 'Selfie did not match the government identity'; }
    else if (['not_found', 'failed', 'rejected'].includes(rawStatus)) { identityStatus = 'failed'; failureReason = validationMessage || 'Government identity verification failed'; }
    else { identityStatus = 'needs_retry'; failureReason = validationMessage || 'Identity provider returned an unrecognized completion state'; }

    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: workerId, error } = await db.rpc('record_external_worker_identity_result_by_reference', {
      p_provider: 'youverify',
      p_reference: reference,
      p_status: identityStatus,
      p_failure_reason: failureReason,
    });
    if (error) return new Response('Processing error', { status: 500 });
    if (!workerId) return new Response('Ignored', { status: 200 });
    return new Response('OK', { status: 200 });
  } catch {
    return new Response('Internal error', { status: 500 });
  }
});
