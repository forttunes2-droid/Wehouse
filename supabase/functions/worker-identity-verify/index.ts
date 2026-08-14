import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response({ success: false, error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return response({ success: false, error: 'Authorization required' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const youverifyToken = Deno.env.get('YOUVERIFY_API_TOKEN');
    const youverifyBaseUrl = Deno.env.get('YOUVERIFY_BASE_URL');
    if (!supabaseUrl || !serviceKey) return response({ success: false, error: 'Server configuration incomplete' }, 500);
    if (!youverifyToken || !youverifyBaseUrl) {
      return response({
        success: false,
        error: 'Youverify connection is not configured yet',
        code: 'YOUVERIFY_NOT_CONFIGURED',
      }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return response({ success: false, error: 'Invalid or expired session' }, 401);

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('user_id,role,profile_complete,deleted,suspended,banned')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (profileError) return response({ success: false, error: profileError.message }, 500);
    if (!profile || profile.role !== 'worker') return response({ success: false, error: 'Worker account required' }, 403);
    if (profile.deleted || profile.suspended || profile.banned) return response({ success: false, error: 'Worker account is not active' }, 403);
    if (!profile.profile_complete) return response({ success: false, error: 'Complete the professional profile first' }, 409);

    const [paymentResult, testResult, evidenceResult] = await Promise.all([
      admin.from('booking_payments').select('id').eq('user_id', profile.user_id).eq('purpose', 'worker_verification').in('status', ['paid', 'completed']).limit(1),
      admin.from('worker_test_attempts').select('id').eq('worker_id', profile.user_id).eq('passed', true).not('submitted_at', 'is', null).limit(1),
      admin.from('worker_verifications').select('id,verification_video_url,identity_status').eq('worker_id', profile.user_id).maybeSingle(),
    ]);

    if (paymentResult.error) return response({ success: false, error: paymentResult.error.message }, 500);
    if (testResult.error) return response({ success: false, error: testResult.error.message }, 500);
    if (evidenceResult.error) return response({ success: false, error: evidenceResult.error.message }, 500);
    if (!paymentResult.data?.length) return response({ success: false, error: 'Verified Paystack payment is required first' }, 409);
    if (!testResult.data?.length) return response({ success: false, error: 'Pass the Worker readiness test first' }, 409);
    if (!evidenceResult.data?.verification_video_url) return response({ success: false, error: 'Professional evidence is required first' }, 409);
    if (evidenceResult.data.identity_status === 'verified') return response({ success: true, verified: true, already_verified: true });

    const body = await req.json();
    const vnin = String(body?.vnin || '').trim().toUpperCase();
    const selfieImage = String(body?.selfieImage || '');
    const isSubjectConsent = body?.isSubjectConsent === true;

    if (!isSubjectConsent) return response({ success: false, error: 'Identity verification consent is required' }, 400);
    if (!/^[A-Z0-9-]{8,40}$/.test(vnin)) return response({ success: false, error: 'Enter a valid virtual NIN' }, 400);
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(selfieImage)) return response({ success: false, error: 'A clear selfie image is required' }, 400);
    if (selfieImage.length > 7_500_000) return response({ success: false, error: 'Selfie image is too large' }, 413);

    // Raw vNIN/selfie are deliberately not inserted into WeHouse tables/storage
    // and are not written to logs. They are sent only to the configured provider.
    const providerUrl = `${youverifyBaseUrl.replace(/\/$/, '')}/v2/api/identity/ng/vnin`;
    const providerResponse = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: youverifyToken,
      },
      body: JSON.stringify({
        id: vnin,
        isSubjectConsent: true,
        validations: { selfie: { image: selfieImage } },
        metadata: { requestId: `wehouse-worker-${profile.user_id}-${Date.now()}` },
      }),
    });

    let provider: any = null;
    try {
      provider = await providerResponse.json();
    } catch {
      provider = null;
    }

    if (!providerResponse.ok || !provider?.success) {
      const transient = providerResponse.status >= 500 || providerResponse.status === 429;
      const failure = transient ? 'Identity provider is temporarily unavailable' : (provider?.message || 'Identity verification request failed');
      await admin.rpc('record_external_worker_identity_result', {
        p_worker_id: profile.user_id,
        p_provider: 'youverify',
        p_reference: provider?.data?.id || null,
        p_status: transient ? 'needs_retry' : 'failed',
        p_failure_reason: failure,
      });
      return response({ success: false, verified: false, reason: failure }, transient ? 503 : 400);
    }

    const providerData = provider.data || {};
    const face = providerData?.validations?.selfie?.selfieVerification;
    const found = providerData.status === 'found';
    const faceMatch = face?.match === true;
    const verified = found && faceMatch;
    const providerReference = String(providerData.id || '');
    const reason = verified
      ? null
      : (providerData?.validations?.validationMessages || providerData?.reason || (!found ? 'Government identity was not found' : 'Selfie did not match the government identity'));

    const { error: recordError } = await admin.rpc('record_external_worker_identity_result', {
      p_worker_id: profile.user_id,
      p_provider: 'youverify',
      p_reference: providerReference || null,
      p_status: verified ? 'verified' : 'failed',
      p_failure_reason: reason,
    });
    if (recordError) return response({ success: false, error: recordError.message }, 500);

    return response({
      success: true,
      verified,
      reference: providerReference || undefined,
      reason: reason || undefined,
    });
  } catch (error) {
    return response({ success: false, error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
});
