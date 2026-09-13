import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return json({ success: false, error: 'Authorization required' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const appUrl = (Deno.env.get('APP_URL') || 'https://wehouse.com.ng').replace(/\/$/, '');
    if (!supabaseUrl || !serviceKey || !paystackSecret) return json({ success: false, error: 'Subscription server configuration is incomplete' }, 503);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user?.email) return json({ success: false, error: 'Invalid or expired session' }, 401);
    const { data: profile } = await admin.from('profiles').select('user_id,role,worker_status,worker_verified,deleted,suspended,banned').eq('auth_id', user.id).maybeSingle();
    if (!profile || profile.role !== 'worker' || profile.worker_status !== 'verified' || profile.worker_verified !== true) return json({ success: false, error: 'A WeHouse Reviewed Worker account is required' }, 403);
    if (profile.deleted || profile.suspended || profile.banned) return json({ success: false, error: 'Worker account is not active' }, 403);

    const body = await req.json();
    const reference = String(body?.reference || '').trim();
    if (!/^WHP-[a-f0-9-]{36}$/.test(reference)) return json({ success: false, error: 'Invalid subscription reference' }, 400);
    const { data: payment, error: paymentError } = await admin.from('booking_payments')
      .select('id,user_id,payer_user_id,amount,amount_total,currency,status,purpose,paystack_reference,metadata')
      .eq('paystack_reference', reference).eq('purpose', 'worker_pro_subscription').maybeSingle();
    if (paymentError) return json({ success: false, error: paymentError.message }, 500);
    if (!payment) return json({ success: false, error: 'WeHouse Pro checkout was not found' }, 404);
    if ((payment.payer_user_id || payment.user_id) !== profile.user_id) return json({ success: false, error: 'Checkout does not belong to this Worker' }, 403);
    if (payment.status === 'paid' || payment.status === 'completed') return json({ success: true, already_paid: true, reference });
    if (payment.status !== 'pending') return json({ success: false, error: 'This checkout can no longer be initialized' }, 409);

    const amount = Number(payment.amount_total ?? payment.amount ?? 0);
    const metadata = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata as Record<string, unknown> : {};
    const planCode = String(metadata.plan_code || '');
    if (!/^PLN_[A-Za-z0-9]+$/.test(planCode) || !Number.isFinite(amount) || amount <= 0 || payment.currency !== 'NGN') return json({ success: false, error: 'Invalid monthly plan configuration' }, 409);

    const planResponse = await fetch(`https://api.paystack.co/plan/${encodeURIComponent(planCode)}`, { headers: { Authorization: `Bearer ${paystackSecret}` } });
    const planPayload = await planResponse.json().catch(() => null);
    const plan = planPayload?.data;
    if (!planResponse.ok || !planPayload?.status || !plan) return json({ success: false, error: planPayload?.message || 'Paystack monthly plan could not be verified' }, 502);
    if (String(plan.interval || '').toLowerCase() !== 'monthly' || String(plan.currency || 'NGN').toUpperCase() !== 'NGN' || Math.round(Number(plan.amount || 0)) !== Math.round(amount * 100)) {
      return json({ success: false, error: 'Creator price and Paystack monthly plan do not match' }, 409);
    }

    const existingUrl = typeof metadata.paystack_authorization_url === 'string' ? metadata.paystack_authorization_url : '';
    if (existingUrl) return json({ success: true, reference, authorization_url: existingUrl, existing: true });
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        amount: String(Math.round(amount * 100)),
        currency: 'NGN',
        reference,
        plan: planCode,
        callback_url: `${appUrl}/#worker_dashboard`,
        metadata: {
          purpose: 'worker_pro_subscription',
          worker_id: profile.user_id,
          payment_id: payment.id,
          plan: 'worker_pro_monthly',
          period: 'P1M',
          terms_version: metadata.terms_version,
        },
      }),
    });
    const initialized = await response.json().catch(() => null);
    if (!response.ok || !initialized?.status || !initialized?.data?.authorization_url || !initialized?.data?.access_code) return json({ success: false, error: initialized?.message || 'Paystack could not initialize Pro checkout' }, response.status >= 500 ? 502 : 400);
    const nextMetadata = {
      ...metadata,
      paystack_access_code: String(initialized.data.access_code),
      paystack_authorization_url: String(initialized.data.authorization_url),
      paystack_plan_verified_at: new Date().toISOString(),
      paystack_initialized_at: new Date().toISOString(),
    };
    const { error: updateError } = await admin.from('booking_payments').update({ metadata: nextMetadata, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
    if (updateError) return json({ success: false, error: 'Checkout was initialized but could not be recorded safely' }, 500);
    return json({ success: true, reference, authorization_url: initialized.data.authorization_url, access_code: initialized.data.access_code, existing: false });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'Pro checkout initialization failed' }, 500);
  }
});
