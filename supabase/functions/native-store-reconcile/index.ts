// Run through a private scheduler with x-cron-secret. Each pass rotates the
// oldest verified subscriptions and placements so a fixed batch cannot starve.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import { verifyStorePurchase } from '../_shared/native-store.ts';

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const expected = Deno.env.get('WEHOUSE_CRON_SECRET') || '';
  const actual = request.headers.get('x-cron-secret') || '';
  if (expected.length < 32 || actual.length !== expected.length) return json({ error: 'Forbidden' }, 403);
  const left = new TextEncoder().encode(actual);
  const right = new TextEncoder().encode(expected);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  if (difference !== 0) return json({ error: 'Forbidden' }, 403);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Backend configuration missing' }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let checked = 0;
  let paused = 0;
  const failures: string[] = [];
  const { data: subscriptions, error: subscriptionError } = await admin.from('worker_pro_subscriptions')
    .select('worker_id,provider,product_id,provider_subscription_id,environment,status,billing_period')
    .in('provider', ['apple', 'google']).in('status', ['active', 'grace_period', 'cancelled'])
    .order('last_verified_at', { ascending: true }).limit(50);
  if (subscriptionError) return json({ error: 'Could not read store subscriptions' }, 503);
  for (const subscription of subscriptions || []) {
    try {
      const { data: profile, error: profileError } = await admin.from('profiles')
        .select('auth_id').eq('user_id', subscription.worker_id).maybeSingle();
      if (profileError || !profile?.auth_id || !subscription.provider_subscription_id)
        throw new Error('Subscription account lookup failed');
      const purchase = await verifyStorePurchase({
        platform: subscription.provider, productId: subscription.product_id,
        transactionId: subscription.provider === 'apple' ? subscription.provider_subscription_id : undefined,
        purchaseToken: subscription.provider === 'google' ? subscription.provider_subscription_id : undefined,
        accountToken: profile.auth_id, productType: 'subscription', reconciliation: true,
      });
      if (purchase.environment !== subscription.environment) throw new Error('Environment changed');
      const status = purchase.active ? 'active' : 'revoked';
      const eventId = `${purchase.originalTransactionId}:${purchase.transactionId}:${status}:${purchase.autoRenews ? 'renew' : 'end'}`;
      const { data: recorded, error } = await admin.rpc('record_worker_pro_subscription_event', {
        p_worker_id: subscription.worker_id, p_provider: subscription.provider,
        p_product_id: subscription.product_id, p_provider_subscription_id: purchase.originalTransactionId,
        p_provider_event_id: eventId, p_event_type: 'store_reconciliation',
        p_status: status, p_event_time: new Date().toISOString(),
        p_period_start: purchase.purchasedAt, p_period_end: purchase.expiresAt,
        p_cancel_at_period_end: !purchase.autoRenews, p_auto_renews: purchase.autoRenews,
        p_price_amount: Math.max(0, purchase.priceAmount), p_currency: purchase.currency,
        p_environment: purchase.environment, p_payload_sha256: purchase.payloadHash,
        p_metadata: { billing_period: subscription.billing_period, verified_by: 'native_store_reconcile' },
      });
      if (error || !recorded?.success) throw new Error('Subscription state could not be recorded');
      await admin.from('worker_pro_subscriptions').update({ last_verified_at: new Date().toISOString() })
        .eq('worker_id', subscription.worker_id).eq('provider', subscription.provider);
      checked += 1;
      if (!purchase.active) paused += 1;
    } catch {
      failures.push(`subscription:${subscription.worker_id}`);
    }
  }
  const { data: claims, error: claimError } = await admin.from('sponsored_store_transactions')
    .select('platform,provider_transaction_id,account_user_id,product_id,purchase_token,environment,campaign_id')
    .order('verified_at', { ascending: true }).limit(50);
  if (claimError) return json({ error: 'Could not read store claims', checked, failures: failures.length }, 503);
  for (const claim of claims || []) {
    try {
      const purchase = await verifyStorePurchase({
        platform: claim.platform, productId: claim.product_id,
        transactionId: claim.platform === 'apple' ? claim.provider_transaction_id : undefined,
        purchaseToken: claim.platform === 'google' ? claim.purchase_token : undefined,
        accountToken: claim.account_user_id, productType: 'consumable', reconciliation: true,
      });
      if (purchase.environment !== claim.environment || purchase.transactionId !== claim.provider_transaction_id)
        throw new Error('Store claim changed');
      if (!purchase.active) {
        const { error } = await admin.rpc('pause_sponsored_store_transaction', {
          p_platform: claim.platform, p_transaction_id: claim.provider_transaction_id,
          p_reason: 'store_refund',
        });
        if (error) throw error;
        paused += 1;
      }
      const { error } = await admin.from('sponsored_store_transactions')
        .update({ verified_at: new Date().toISOString() })
        .eq('platform', claim.platform).eq('provider_transaction_id', claim.provider_transaction_id);
      if (error) throw error;
      checked += 1;
    } catch {
      failures.push(`campaign:${claim.campaign_id}`);
    }
  }
  return json({ success: failures.length === 0, checked, paused, failures: failures.length },
    failures.length ? 503 : 200);
});
