import { hasLiveSession } from "../_shared/liveSession.ts";
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const allowedActions = new Set([
  'all_sensitive',
  'policy_publish',
  'staff_authority',
  'finance_exception',
  'private_evidence',
  'clean_launch_reset',
]);

function jwtSessionId(token: string): string {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return String(payload?.session_id || '');
  } catch {
    return '';
  }
}

async function hashIp(value: string): Promise<string | null> {
  if (!value) return null;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ success: false, error: 'Authorization required' }, 401);
  const token = authorization.replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !publicKey) {
    return json({ success: false, error: 'Creator verification is unavailable' }, 503);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const password = String(body?.password || '');
    const otpCode = String(body?.otp_code || '').replace(/\D/g, '');
    const actionClass = String(body?.action_class || 'all_sensitive');
    if (!password || !allowedActions.has(actionClass)) {
      return json({ success: false, error: 'Invalid verification request' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: current, error: currentError } = await admin.auth.getUser(token);
    if (currentError || !current.user?.email) {
      return json({ success: false, error: 'Session expired. Sign in again.' }, 401);
    }
    if (!await hasLiveSession(admin, current.user.id, token)) return json({success:false,error:'Session ended. Sign in again.'},401);
    const sessionId = jwtSessionId(token);
    if (!sessionId) return json({ success: false, error: 'Signed-in session is incomplete' }, 401);

    const verifier = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: passwordSession, error: passwordError } = await verifier.auth.signInWithPassword({
      email: current.user.email,
      password,
    });
    if (passwordError || passwordSession.user?.id !== current.user.id) {
      return json({ success: false, error: 'Incorrect account password' }, 200);
    }

    const { data: factorData, error: factorError } = await verifier.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const verifiedFactor = factorData.totp.find((factor) => factor.status === 'verified');
    let verificationMethod = 'password';
    if (verifiedFactor) {
      if (!/^\d{6}$/.test(otpCode)) return json({ success: false, needs_mfa: true }, 200);
      const { data: challenge, error: challengeError } = await verifier.auth.mfa.challenge({
        factorId: verifiedFactor.id,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await verifier.auth.mfa.verify({
        factorId: verifiedFactor.id,
        challengeId: challenge.id,
        code: otpCode,
      });
      if (verifyError) return json({ success: false, error: 'Incorrect authenticator code' }, 200);
      const { data: assurance, error: assuranceError } =
        await verifier.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || assurance.currentLevel !== 'aal2') {
        return json({ success: false, error: 'MFA assurance could not be confirmed' }, 403);
      }
      verificationMethod = 'password_mfa';
    }

    const ipHash = await hashIp(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '');
    const { data: elevationId, error: elevationError } = await admin.rpc(
      'issue_creator_elevation_from_service',
      {
        p_auth_user_id: current.user.id,
        p_auth_session_id: sessionId,
        p_action_classes: [actionClass],
        p_verification_method: verificationMethod,
        p_ip_hash: ipHash,
      },
    );
    if (elevationError || !elevationId) {
      console.error('creator elevation issue failed', elevationError?.message);
      return json({ success: false, error: 'Creator authority could not be confirmed' }, 403);
    }
    return json({ success: true, creator_elevation_id: elevationId, expires_in_seconds: 600 });
  } catch (reason) {
    console.error('creator-step-up failed', reason instanceof Error ? reason.message : reason);
    return json({ success: false, error: 'Creator verification failed' }, 500);
  }
});

