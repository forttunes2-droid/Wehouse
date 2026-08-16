import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function validHmac(body: string, sig: string, secret: string) {
  const e = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', e.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, e.encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === sig;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const signature = req.headers.get('x-paystack-signature');
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!signature || !secret || !url || !serviceKey) return new Response('Unauthorized or misconfigured', { status: 401 });
    const raw = await req.text();
    if (!(await validHmac(raw, signature, secret))) return new Response('Invalid signature', { status: 401 });
    const event = JSON.parse(raw);
    if (event.event !== 'charge.success') return new Response('Ignored', { status: 200 });
    const reference = event.data?.reference;
    const amount = Number(event.data?.amount ?? 0) / 100;
    const currency = event.data?.currency;
    const status = event.data?.status;
    const transactionId = String(event.data?.id ?? '');
    if (!reference || status !== 'success' || currency !== 'NGN' || amount <= 0) return new Response('Invalid event', { status: 200 });
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: payment, error: lookupError } = await db.from('booking_payments').select('id,purpose,status,amount,amount_total,worker_booking_id').eq('paystack_reference', reference).maybeSingle();
    if (lookupError) return new Response('Database error', { status: 500 });
    if (!payment) return new Response('Payment not found', { status: 200 });
    if (payment.status === 'paid' || payment.status === 'completed') return new Response('Already processed', { status: 200 });
    const expected = Number(payment.amount_total ?? payment.amount ?? 0);
    if (Math.round(expected * 100) !== Math.round(amount * 100)) return new Response('Amount mismatch', { status: 400 });
    if (payment.purpose === 'worker_booking') {
      if (!payment.worker_booking_id) return new Response('Worker booking ID missing', { status: 409 });
      const { data, error } = await db.rpc('confirm_worker_booking_payment', { p_booking_id: payment.worker_booking_id, p_paystack_reference: reference, p_amount_verified: amount, p_currency: 'NGN', p_transaction_id: transactionId });
      if (error) return new Response('Processing error', { status: 500 });
      if (!data?.success) {
        const { error: reviewError } = await db.from('booking_payments').update({
          status: 'review_required',
          paystack_transaction_id: transactionId || null,
          verified_amount: amount,
          verified_at: new Date().toISOString(),
          verification_source: 'webhook',
          updated_at: new Date().toISOString(),
        }).eq('id', payment.id);
        if (reviewError) return new Response('Could not record payment review state', { status: 500 });
        return new Response('Worker payment review recorded', { status: 200 });
      }
      return new Response('OK', { status: 200 });
    }
    const { error } = await db.rpc('confirm_booking_payment', { p_reference: reference, p_transaction_id: transactionId, p_verified_amount: amount, p_verification_source: 'webhook', p_purpose: payment.purpose });
    if (error) return new Response('Processing error', { status: 500 });
    return new Response('OK', { status: 200 });
  } catch {
    return new Response('Internal error', { status: 500 });
  }
});
