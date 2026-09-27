import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import { hasLiveSession, hasActiveWorkspace } from '../_shared/liveSession.ts';
import { settleGoogleStorePurchase, verifyStorePurchase } from '../_shared/native-store.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  try {
    if (Deno.env.get('NATIVE_STORE_PURCHASES_ENABLED') !== 'true')
      return json({ success: false, error: 'Native store purchases are not open' }, 503);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!url || !key || !token) return json({ success: false, error: 'Sign in again' }, 401);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user || !await hasLiveSession(admin, user.id, token))
      return json({ success: false, error: 'Session ended. Sign in again.' }, 401);
    const { data: worker } = await admin.from('profiles')
      .select('user_id,worker_status,worker_verified,deleted,suspended,banned')
      .eq('auth_id', user.id).maybeSingle();
    if (!worker || worker.deleted || worker.suspended || worker.banned
      || worker.worker_status !== 'verified' || worker.worker_verified !== true
      || !await hasActiveWorkspace(admin, worker.user_id, 'worker'))
      return json({ success: false, error: 'An active Reviewed Worker account is required' }, 403);

    const body = await request.json();
    const platform = body?.platform === 'apple' ? 'apple' : body?.platform === 'google' ? 'google' : null;
    const productId = String(body?.product_id || '');
    if (!platform) return json({ success: false, error: 'Choose an app store' }, 400);
    const { data: settings, error: settingError } = await admin.from('platform_settings')
      .select('key,value,is_active').in('key', [
        'worker_pro_ios_sales_enabled', 'worker_pro_android_sales_enabled',
        'worker_pro_apple_product_id', 'worker_pro_apple_yearly_product_id',
        'worker_pro_google_product_id', 'worker_pro_google_yearly_product_id',
        'worker_pro_terms_version', 'worker_pro_terms_content',
      ]);
    if (settingError) return json({ success: false, error: 'Subscription settings are unavailable' }, 503);
    const values = Object.fromEntries((settings || []).filter(row => row.is_active).map(row => [row.key, String(row.value || '')]));
    const prefix = platform === 'apple' ? 'worker_pro_apple' : 'worker_pro_google';
    const { data: current } = await admin.from('worker_pro_subscriptions')
      .select('provider,product_id,billing_period,provider_subscription_id,status,current_period_end')
      .eq('worker_id', worker.user_id).maybeSingle();
    const existing = current?.provider === platform && current.product_id === productId;
    const period = productId && productId === values[`${prefix}_product_id`] ? 'monthly'
      : productId && productId === values[`${prefix}_yearly_product_id`] ? 'yearly'
      : existing && ['monthly', 'yearly'].includes(current.billing_period) ? current.billing_period : null;
    if (!period) return json({ success: false, error: 'This store plan is not configured by WeHouse' }, 409);
    const flag = platform === 'apple' ? values.worker_pro_ios_sales_enabled : values.worker_pro_android_sales_enabled;
    if (!existing && flag !== 'true') return json({ success: false, error: 'This store plan is not open' }, 409);
    if (!existing) {
      const version = values.worker_pro_terms_version;
      const terms = values.worker_pro_terms_content;
      if (!version || !terms || terms.length < 100)
        return json({ success: false, error: 'Paid plan terms are not published' }, 409);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(terms));
      const termsHash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
      const { data: accepted } = await admin.from('worker_pro_terms_acceptances')
        .select('id').eq('worker_id', worker.user_id).eq('terms_version', version)
        .eq('terms_sha256', termsHash).maybeSingle();
      if (!accepted) return json({ success: false, error: 'Accept the current subscription terms first' }, 409);
    }

    const purchase = await verifyStorePurchase({
      platform, productId, transactionId: String(body?.transaction_id || ''),
      purchaseToken: String(body?.purchase_token || ''), accountToken: user.id,
      productType: 'subscription',
    });
    if (!purchase.transactionId || !purchase.expiresAt)
      return json({ success: false, error: 'The store has not completed this subscription' }, 409);
    const status = purchase.active ? 'active' : 'revoked';
    const periodStart = purchase.purchasedAt && !Number.isNaN(Date.parse(purchase.purchasedAt))
      ? purchase.purchasedAt : new Date().toISOString();
    const eventId = `${purchase.originalTransactionId}:${purchase.transactionId}:${status}:${purchase.autoRenews ? 'renew' : 'end'}`;
    const { data: recorded, error: recordError } = await admin.rpc('record_worker_pro_subscription_event', {
      p_worker_id: worker.user_id, p_provider: platform, p_product_id: productId,
      p_provider_subscription_id: purchase.originalTransactionId,
      p_provider_event_id: eventId, p_event_type: 'store_server_verification',
      p_status: status, p_event_time: new Date().toISOString(),
      p_period_start: periodStart, p_period_end: purchase.expiresAt,
      p_cancel_at_period_end: !purchase.autoRenews, p_auto_renews: purchase.autoRenews,
      p_price_amount: Math.max(0, purchase.priceAmount), p_currency: purchase.currency,
      p_environment: purchase.environment, p_payload_sha256: purchase.payloadHash,
      p_metadata: { billing_period: period, verified_by: 'native_worker_pro',
        store_transaction_id: purchase.transactionId },
    });
    if (recordError || !recorded?.success)
      return json({ success: false, error: recordError?.message || 'Paid plan needs Finance review' }, 409);
    const { data: event } = await admin.from('worker_pro_subscription_events')
      .select('worker_id').eq('provider', platform).eq('provider_event_id', eventId).maybeSingle();
    if (event?.worker_id !== worker.user_id)
      return json({ success: false, error: 'This store transaction belongs to another account' }, 409);
    if (purchase.platform === 'google' && purchase.active)
      await settleGoogleStorePurchase(purchase, 'subscription');
    return json({ success: true, active: purchase.active, status: recorded.status,
      duplicate: Boolean(recorded.duplicate) });
  } catch (error) {
    return json({ success: false,
      error: error instanceof Error ? error.message : 'Store verification failed' }, 502);
  }
});
