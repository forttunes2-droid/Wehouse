import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: cors });

  try {
    const { reference, purpose } = await req.json();
    if (!reference) return new Response(JSON.stringify({ success: false, error: 'Reference is required' }), { status: 400, headers: cors });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!url || !serviceKey || !paystackSecret) return new Response(JSON.stringify({ success: false, error: 'Server configuration incomplete' }), { status: 500, headers: cors });

    const authHeader = req.headers.get('authorization');
    if (!authHeader) return new Response(JSON.stringify({ success: false, error: 'Authorization required' }), { status: 401, headers: cors });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), { status: 401, headers: cors });

    const { data: profile } = await admin.from('profiles').select('user_id, deleted, suspended, banned').eq('auth_id', user.id).maybeSingle();
    if (!profile) return new Response(JSON.stringify({ success: false, error: 'Profile not found' }), { status: 403, headers: cors });
    if (profile.deleted || profile.suspended || profile.banned) return new Response(JSON.stringify({ success: false, error: 'Account not active' }), { status: 403, headers: cors });

    const { data: payment, error: paymentError } = await admin
      .from('booking_payments')
      .select('id, user_id, payer_user_id, amount, amount_total, purpose, status, paystack_reference, worker_booking_id')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (paymentError) return new Response(JSON.stringify({ success: false, error: paymentError.message }), { status: 500, headers: cors });
    if (!payment) return new Response(JSON.stringify({ success: false, error: 'Payment record not found' }), { status: 404, headers: cors });

    if (purpose && payment.purpose && purpose !== payment.purpose) {
      return new Response(JSON.stringify({ success: false, error: 'Purpose mismatch' }), { status: 400, headers: cors });
    }

    const owner = payment.payer_user_id || payment.user_id;
    if (!owner || owner !== profile.user_id) return new Response(JSON.stringify({ success: false, error: 'Payment does not belong to authenticated user' }), { status: 403, headers: cors });

    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    if (!paystackResponse.ok) return new Response(JSON.stringify({ success: false, error: 'Paystack verification failed' }), { status: 502, headers: cors });
    const verified = await paystackResponse.json();
    if (!verified?.status || verified?.data?.status !== 'success') return new Response(JSON.stringify({ success: false, error: 'Payment not successful' }), { status: 400, headers: cors });
    if (verified.data.currency !== 'NGN') return new Response(JSON.stringify({ success: false, error: 'Currency mismatch' }), { status: 400, headers: cors });

    const verifiedAmount = Number(verified.data.amount) / 100;
    const expectedAmount = Number(payment.amount_total ?? payment.amount ?? 0);
    if (Math.round(verifiedAmount * 100) !== Math.round(expectedAmount * 100)) {
      return new Response(JSON.stringify({ success: false, error: 'Amount mismatch', expected: expectedAmount, verified: verifiedAmount }), { status: 400, headers: cors });
    }

    if (payment.status === 'paid' || payment.status === 'completed') {
      return new Response(JSON.stringify({ success: true, verified: true, already_processed: true, amount: verifiedAmount, purpose: payment.purpose }), { status: 200, headers: cors });
    }

    const transactionId = String(verified.data.id ?? '');
    if (payment.purpose === 'worker_booking') {
      if (!payment.worker_booking_id) return new Response(JSON.stringify({ success: false, error: 'Worker booking ID missing' }), { status: 409, headers: cors });
      const { data, error } = await admin.rpc('confirm_worker_booking_payment', {
        p_booking_id: payment.worker_booking_id,
        p_paystack_reference: reference,
        p_amount_verified: verifiedAmount,
        p_currency: 'NGN',
        p_transaction_id: transactionId,
      });
      if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: cors });
      return new Response(JSON.stringify({ success: true, verified: true, recorded: true, amount: verifiedAmount, purpose: payment.purpose, result: data }), { status: 200, headers: cors });
    }

    const { data, error } = await admin.rpc('confirm_booking_payment', {
      p_reference: reference,
      p_transaction_id: transactionId,
      p_verified_amount: verifiedAmount,
      p_verification_source: 'edge_function',
      p_purpose: payment.purpose,
    });
    if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: cors });
    return new Response(JSON.stringify({ success: true, verified: true, recorded: true, amount: verifiedAmount, purpose: payment.purpose, result: data }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Internal error' }), { status: 500, headers: cors });
  }
});
