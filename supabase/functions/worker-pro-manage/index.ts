import { hasLiveSession, hasActiveWorkspace } from "../_shared/liveSession.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('authorization');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!authHeader) return json({ success: false, error: 'Authorization required' }, 401);
    if (!url || !serviceKey || !paystackSecret) return json({ success: false, error: 'Subscription server configuration is incomplete' }, 503);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return json({ success: false, error: 'Invalid or expired session' }, 401);
    if (!await hasLiveSession(admin, user.id, authHeader.replace(/^Bearer\s+/i, ''))) return json({success:false,error:'Session ended. Sign in again.'},401);
    const { data: profile } = await admin.from('profiles').select('user_id,role,deleted,suspended,banned').eq('auth_id', user.id).maybeSingle();
    if (!profile || !await hasActiveWorkspace(admin,profile.user_id,'worker') || profile.deleted || profile.suspended || profile.banned) return json({ success: false, error: 'Active Worker account required' }, 403);
    const { data: subscription } = await admin.from('worker_pro_subscriptions').select('provider,provider_subscription_id').eq('worker_id', profile.user_id).maybeSingle();
    if (!subscription || subscription.provider !== 'paystack' || !subscription.provider_subscription_id) return json({ success: false, error: 'A Paystack paid Worker subscription was not found' }, 404);
    const response = await fetch(`https://api.paystack.co/subscription/${encodeURIComponent(subscription.provider_subscription_id)}/manage/link`, { headers: { Authorization: `Bearer ${paystackSecret}` } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.status || !payload?.data?.link) return json({ success: false, error: payload?.message || 'Paystack subscription management could not open' }, 502);
    return json({ success: true, url: payload.data.link });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'Subscription management failed' }, 500);
  }
});
