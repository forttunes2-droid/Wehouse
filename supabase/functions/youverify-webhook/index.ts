import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function hmacSha256Hex(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('Method not allowed', 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = Deno.env.get('YOUVERIFY_WEBHOOK_SECRET') || Deno.env.get('YOUVERIFY_API_TOKEN');
    const suppliedSignature = req.headers.get('x-youverify-signature') || '';

    if (!supabaseUrl || !serviceKey || !webhookSecret || !suppliedSignature) {
      return text('Unauthorized or misconfigured', 401);
    }

    const raw = await req.text();
    const expectedSignature = await hmacSha256Hex(raw, webhookSecret);
    if (!safeEqual(expectedSignature, suppliedSignature)) return text('Invalid signature', 401);

    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return text('Invalid JSON', 400);
    }

    const data = event?.data && typeof event.data === 'object' ? event.data : event;
    const reference = firstString(data?.id, data?.referenceId, data?.verificationId);
    if (!reference) return text('Ignored: no verification reference', 200);

    const rawStatus = firstString(data?.status, data?.taskStatus, event?.status).toLowerCase();
    const face = data?.validations?.selfie?.selfieVerification;
    const faceMatch = face?.match === true;
    const validationMessage = firstString(data?.validations?.validationMessages, data?.reason, event?.message);

    let identityStatus: 'verified' | 'failed' | 'pending_external' | 'needs_retry';
    let failureReason: string | null = null;

    if (rawStatus === 'pending' || rawStatus === 'pending_external' || rawStatus === 'processing' || rawStatus === 'in_progress') {
      identityStatus = 'pending_external';
    } else if (rawStatus === 'found' && faceMatch) {
      identityStatus = 'verified';
    } else if (rawStatus === 'found') {
      identityStatus = 'failed';
      failureReason = validationMessage || 'Selfie did not match the government identity';
    } else if (rawStatus === 'not_found' || rawStatus === 'failed' || rawStatus === 'rejected') {
      identityStatus = 'failed';
      failureReason = validationMessage || 'Government identity verification failed';
    } else {
      identityStatus = 'needs_retry';
      failureReason = validationMessage || 'Identity provider returned an unrecognized completion state';
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: workerId, error } = await admin.rpc('record_external_worker_identity_result_by_reference', {
      p_provider: 'youverify',
      p_reference: reference,
      p_status: identityStatus,
      p_failure_reason: failureReason,
    });

    if (error) return text('Processing error', 500);
    if (!workerId) return text('Ignored: verification not owned by WeHouse', 200);

    return text('OK', 200);
  } catch {
    return text('Internal error', 500);
  }
});
