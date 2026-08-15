import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return json({ success: false, error: 'Authorization required' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!supabaseUrl || !serviceKey || !paystackSecret) {
      return json({ success: false, error: 'Payment server configuration is incomplete' }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user?.email) return json({ success: false, error: 'Invalid or expired session' }, 401);

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('user_id,role,deleted,suspended,banned')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (profileError) return json({ success: false, error: profileError.message }, 500);
    if (!profile || profile.role !== 'worker') return json({ success: false, error: 'Worker account required' }, 403);
    if (profile.deleted || profile.suspended || profile.banned) return json({ success: false, error: 'Worker account is not active' }, 403);

    const body = await req.json();
    const reference = String(body?.reference || '').trim();
    if (!/^[A-Za-z0-9.=-]{6,100}$/.test(reference)) {
      return json({ success: false, error: 'Invalid payment reference' }, 400);
    }

    const { data: payment, error: paymentError } = await admin
      .from('booking_payments')
      .select('id,user_id,payer_user_id,amount,amount_total,currency,status,purpose,paystack_reference,metadata')
      .eq('paystack_reference', reference)
      .eq('purpose', 'worker_verification')
      .maybeSingle();
    if (paymentError) return json({ success: false, error: paymentError.message }, 500);
    if (!payment) return json({ success: false, error: 'Worker verification payment was not found' }, 404);

    const owner = payment.payer_user_id || payment.user_id;
    if (owner !== profile.user_id) return json({ success: false, error: 'Payment does not belong to this Worker' }, 403);
    if (payment.status === 'paid' || payment.status === 'completed') {
      return json({ success: true, already_paid: true, reference });
    }
    if (payment.status !== 'pending') return json({ success: false, error: 'This payment can no longer be initialized' }, 409);

    const amount = Number(payment.amount_total ?? payment.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return json({ success: false, error: 'Invalid verification amount' }, 409);
    if ((payment.currency || 'NGN') !== 'NGN') return json({ success: false, error: 'Worker verification must be paid in NGN' }, 409);

    const meta = (payment.metadata && typeof payment.metadata === 'object') ? payment.metadata as Record<string, unknown> : {};
    const existingUrl = typeof meta.paystack_authorization_url === 'string' ? meta.paystack_authorization_url : '';
    const existingCode = typeof meta.paystack_access_code === 'string' ? meta.paystack_access_code : '';
    if (existingUrl && existingCode) {
      return json({ success: true, reference, authorization_url: existingUrl, access_code: existingCode, existing: true });
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: String(Math.round(amount * 100)),
        currency: 'NGN',
        reference,
        callback_url: 'https://www.wehouse.com.ng/#worker_verification',
        metadata: JSON.stringify({
          purpose: 'worker_verification',
          worker_id: profile.user_id,
          payment_id: payment.id,
        }),
      }),
    });

    let initialized: any = null;
    try { initialized = await response.json(); } catch { initialized = null; }
    if (!response.ok || !initialized?.status || !initialized?.data?.authorization_url || !initialized?.data?.access_code) {
      return json({ success: false, error: initialized?.message || 'Paystack could not initialize this payment' }, response.status >= 500 ? 502 : 400);
    }

    const authorizationUrl = String(initialized.data.authorization_url);
    const accessCode = String(initialized.data.access_code);
    const nextMeta = {
      ...meta,
      source: meta.source || 'create_worker_verification_payment',
      paystack_access_code: accessCode,
      paystack_authorization_url: authorizationUrl,
      paystack_initialized_at: new Date().toISOString(),
    };
    await admin.from('booking_payments').update({ metadata: nextMeta, updated_at: new Date().toISOString() }).eq('id', payment.id);

    return json({
      success: true,
      reference,
      authorization_url: authorizationUrl,
      access_code: accessCode,
      existing: false,
    });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'Payment initialization failed' }, 500);
  }
});
