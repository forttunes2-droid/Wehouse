import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import { hasLiveSession } from '../_shared/liveSession.ts';
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
    const body = await request.json();
    const platform = body?.platform === 'apple' ? 'apple' : body?.platform === 'google' ? 'google' : null;
    const reference = String(body?.reference || '');
    if (!platform || !/^WHS-[0-9a-f-]{36}$/i.test(reference))
      return json({ success: false, error: 'Invalid Sponsored store order' }, 400);
    const { data: order, error: orderError } = await admin.from('booking_payments')
      .select('id,payer_user_id,payment_method,purpose,status,metadata')
      .eq('payment_reference', reference).eq('purpose', 'sponsored_campaign').maybeSingle();
    const { data: profile } = await admin.from('profiles')
      .select('user_id').eq('auth_id', user.id).maybeSingle();
    if (orderError || !order || !profile || order.payer_user_id !== profile.user_id
      || order.payment_method !== platform || !['pending', 'expired', 'paid'].includes(order.status))
      return json({ success: false, error: 'Sponsored store order is not open for this account' }, 409);
    const productId = String(order.metadata?.store_product_id || '');
    if (String(body?.product_id || '') !== productId)
      return json({ success: false, error: 'Store product does not match this order' }, 409);
    if (order.status === 'paid') {
      const { data: claim } = await admin.from('sponsored_store_transactions')
        .select('account_user_id,provider_transaction_id,purchase_token')
        .eq('payment_id', order.id).maybeSingle();
      if (!claim || claim.account_user_id !== user.id
        || (platform === 'apple' && claim.provider_transaction_id !== String(body?.transaction_id || ''))
        || (platform === 'google' && claim.purchase_token !== String(body?.purchase_token || '')))
        return json({ success: false, error: 'This transaction belongs to a different order' }, 409);
    }
    const purchase = await verifyStorePurchase({
      platform, productId, transactionId: String(body?.transaction_id || ''),
      purchaseToken: String(body?.purchase_token || ''), accountToken: user.id,
      productType: 'consumable', reconciliation: order.status === 'paid',
    });
    if (!purchase.active || !purchase.transactionId)
      return json({ success: false, error: 'The store purchase is not active' }, 409);
    const { data: recorded, error: recordError } = await admin.rpc('confirm_sponsored_store_purchase', {
      p_reference: reference, p_platform: platform, p_product_id: productId,
      p_transaction_id: purchase.transactionId, p_account_user_id: user.id,
      p_environment: purchase.environment, p_payload_sha256: purchase.payloadHash,
      p_purchase_token: purchase.purchaseToken,
    });
    if (recordError) return json({ success: false, error: recordError.message }, 409);
    // Even if the market closed after a completed charge, finish the store purchase.
    // The paid order stays with Finance for review; no placement is delivered.
    if (purchase.platform === 'google') await settleGoogleStorePurchase(purchase, 'consumable');
    return json({ success: Boolean(recorded?.success), charged: Boolean(recorded?.charged),
      requires_review: Boolean(recorded?.requires_review), status: recorded?.status,
      error: recorded?.error });
  } catch (error) {
    return json({ success: false,
      error: error instanceof Error ? error.message : 'Store verification failed' }, 502);
  }
});
