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
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  const supplied = signatureHeader.trim().replace(/^sha256=/i, '');
  return constantTimeEqual(supplied.toLowerCase(), toHex(signature)) || constantTimeEqual(supplied, toBase64(signature));
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

    const data = event?.data || {};
    const reference = String(data.id || data.verificationId || data.referenceId || data.reportId || '').trim();
    if (!reference) return new Response('Ignored', { status: 200 });

    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: verification, error: lookupError } = await db
      .from('worker_verifications')
      .select('worker_id,identity_status')
      .eq('identity_provider', 'youverify')
      .eq('identity_reference', reference)
      .maybeSingle();
    if (lookupError) return new Response('Database error', { status: 500 });
    if (!verification) return new Response('Ignored', { status: 200 });
    if (verification.identity_status === 'verified') return new Response('Already processed', { status: 200 });

    const providerStatus = String(data.status || '').toLowerCase();
    const selfieVerification = data?.validations?.selfie?.selfieVerification;
    const faceMatch = selfieVerification?.match === true;
    const found = providerStatus === 'found';
    const verified = found && faceMatch;
    const reason = verified
      ? null
      : (data?.validations?.validationMessages || data?.reason || (!found ? 'Government identity was not found' : 'Selfie did not match the government identity'));

    const { error: updateError } = await db.rpc('record_external_worker_identity_result', {
      p_worker_id: verification.worker_id,
      p_provider: 'youverify',
      p_reference: reference,
      p_status: verified ? 'verified' : 'failed',
      p_failure_reason: reason,
    });
    if (updateError) return new Response('Processing error', { status: 500 });

    return new Response('OK', { status: 200 });
  } catch {
    return new Response('Internal error', { status: 500 });
  }
});
