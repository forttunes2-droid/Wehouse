import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';
import { hasLiveSession, hasActiveWorkspace } from '../_shared/liveSession.ts';
import { resolvePaymentReturnUrl } from '../_shared/payment-return.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const returnUrl = url && secret && resolvePaymentReturnUrl(url, Deno.env.get('APP_URL'), secret, 'payment-return');
    if (!url || !key || !secret || !returnUrl) return json({ success: false, error: 'Payment environment is not configured' }, 503);
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user?.email || !await hasLiveSession(admin, user.id, token))
      return json({ success: false, error: 'Sign in again to continue' }, 401);
    const { data: partner } = await admin.from('profiles')
      .select('user_id,deleted,suspended,banned').eq('auth_id', user.id).maybeSingle();
    if (!partner || partner.deleted || partner.suspended || partner.banned
      || !await hasActiveWorkspace(admin, partner.user_id, 'property_partner'))
      return json({ success: false, error: 'Property Partner access required' }, 403);
    const body = await req.json();
    const reference = String(body?.reference || '').trim();
    if (!/^WHPP-[a-f0-9-]{36}$/.test(reference)) return json({ success: false, error: 'Invalid payment reference' }, 400);
    const { data: payment, error: paymentError } = await admin.from('booking_payments')
      .select('id,payer_user_id,amount_total,currency,status,purpose,metadata')
      .eq('paystack_reference', reference).eq('purpose', 'partner_pro_access').maybeSingle();
    if (paymentError || !payment || payment.payer_user_id !== partner.user_id)
      return json({ success: false, error: 'Checkout does not belong to this Partner' }, 403);
    if (payment.status === 'paid') return json({ success: true, already_paid: true, reference });
    if (payment.status !== 'pending' || payment.currency !== 'NGN' || Number(payment.amount_total) <= 0)
      return json({ success: false, error: 'Checkout is unavailable' }, 409);
    if (payment.metadata?.paystack_authorization_url)
      return json({ success: true, reference, authorization_url: payment.metadata.paystack_authorization_url });
    const environment = secret.startsWith('sk_live_') ? 'live' : 'test';
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, amount: String(Math.round(Number(payment.amount_total) * 100)),
        currency: 'NGN', reference, callback_url: returnUrl,
        metadata: { purpose: 'partner_pro_access', payment_id: payment.id,
          billing_period: payment.metadata?.billing_period },
      }),
    });
    const initialized = await response.json().catch(() => null);
    if (!response.ok || !initialized?.status || !initialized?.data?.authorization_url)
      return json({ success: false, error: initialized?.message || 'Paystack checkout could not start' }, 502);
    const { error: updateError } = await admin.from('booking_payments').update({
      metadata: { ...payment.metadata, paystack_environment: environment,
        paystack_authorization_url: initialized.data.authorization_url,
        paystack_access_code: initialized.data.access_code },
      updated_at: new Date().toISOString(),
    }).eq('id', payment.id).eq('status', 'pending');
    if (updateError) return json({ success: false, error: 'Checkout could not be saved safely' }, 500);
    return json({ success: true, reference, authorization_url: initialized.data.authorization_url });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'Checkout failed' }, 500);
  }
});
