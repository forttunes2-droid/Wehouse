import { hasLiveSession } from "../_shared/liveSession.ts";
import {consumeUserAction} from '../_shared/rateLimit.ts';
import {paystackSubscriptionDestination} from '../_shared/payment-checkout.ts';
import {resolvePaymentReturnUrl} from '../_shared/payment-return.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control':'no-store',
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
    // Reuse the established backend/key/app-origin boundary. No caller chooses
    // the environment and no return URL is accepted from the request.
    if(!resolvePaymentReturnUrl(url,Deno.env.get('APP_URL'),paystackSecret,'worker_dashboard'))return json({success:false,error:'Subscription environment configuration is incomplete or mismatched'},503);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false },global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})} });
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return json({ success: false, error: 'Invalid or expired session' }, 401);
    if (!await hasLiveSession(admin, user.id, authHeader.replace(/^Bearer\s+/i, ''))) return json({success:false,error:'Session ended. Sign in again.'},401);
    const { data: profile } = await admin.from('profiles').select('user_id,role,deleted,suspended,banned').eq('auth_id', user.id).maybeSingle();
    if (!profile || profile.deleted || profile.suspended || profile.banned) return json({ success: false, error: 'Active account required' }, 403);
    const budget=await consumeUserAction(admin,user.id,'subscription_management',5,60,true);
    if(!budget.allowed)return json({success:false,error:'Please wait before opening subscription management again.',retry_after_seconds:budget.retryAfterSeconds},429);
    const { data: subscription,error:subscriptionError } = await admin.from('worker_pro_subscriptions').select('provider,provider_subscription_id,environment').eq('worker_id', profile.user_id).maybeSingle();
    if(subscriptionError)return json({success:false,error:'Subscription details could not be confirmed. Refresh billing before retrying.'},503);
    if (!subscription || subscription.provider !== 'paystack' || !subscription.provider_subscription_id) return json({ success: false, error: 'No Paystack subscription is recorded for this account' }, 404);
    const expectedEnvironment=/^sk_test_/.test(paystackSecret)?'sandbox':/^sk_live_/.test(paystackSecret)?'production':null;
    if(!expectedEnvironment||subscription.environment!==expectedEnvironment)return json({success:false,error:'Subscription provider environment could not be confirmed.'},409);
    const response = await fetch(`https://api.paystack.co/subscription/${encodeURIComponent(subscription.provider_subscription_id)}/manage/link`, {signal:AbortSignal.timeout(12000), headers: { Authorization: `Bearer ${paystackSecret}` } });
    const payload = await response.json().catch(() => null);
    const destination=paystackSubscriptionDestination(payload?.data?.link);
    if (!response.ok || payload?.status!==true || !destination) return json({ success: false, error: 'Paystack subscription management could not be confirmed. Try again or ask WeHouse for billing help.' }, 502);
    return json({ success: true, url: destination });
  } catch (error) {
    console.error('[worker-pro-manage] billing access failed',{message:error instanceof Error?error.message:'Unknown failure'});
    return json({ success: false, error: 'Subscription management could not be confirmed. Retry or ask WeHouse for billing help.' }, 503);
  }
});
