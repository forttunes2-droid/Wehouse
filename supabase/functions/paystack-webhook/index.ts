import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

type Db = ReturnType<typeof createClient>;

async function hmacHex(body: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(body: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function dateOr(value: unknown, fallback: Date) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addMonth(value: Date) {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function subscriptionCode(data: any) {
  return text(data?.subscription_code || data?.subscription?.subscription_code);
}

function planCode(data: any) {
  return text(data?.plan?.plan_code || data?.plan_code || data?.subscription?.plan?.plan_code);
}

function customerCode(data: any) {
  return text(data?.customer?.customer_code || data?.customer_code || data?.subscription?.customer?.customer_code);
}

function eventTime(event: any) {
  return dateOr(
    event?.data?.paid_at || event?.data?.created_at || event?.data?.updated_at || event?.created_at,
    new Date(),
  );
}

function eventId(event: any) {
  const data = event?.data || {};
  const identity = text(data.id || data.reference || subscriptionCode(data) || data.invoice_code || data.transaction?.id);
  const occurrence = text(data.paid_at || data.updated_at || data.created_at || event?.created_at);
  return `${text(event?.event)}:${identity || 'unknown'}:${occurrence || 'undated'}`;
}

async function recordProLifecycleEvent(
  db: Db,
  event: any,
  payloadHash: string,
  environment: 'sandbox' | 'production',
) {
  const supported = new Set([
    'subscription.create', 'subscription.not_renew', 'subscription.disable',
    'invoice.update', 'invoice.payment_failed', 'charge.success',
  ]);
  if (!supported.has(text(event?.event))) return null;

  const data = event?.data || {};
  const incomingSubscriptionCode = subscriptionCode(data);
  const incomingPlanCode = planCode(data);
  const incomingCustomerCode = customerCode(data);
  let subscription: any = null;

  if (incomingSubscriptionCode) {
    const result = await db.from('worker_pro_subscriptions').select('*')
      .eq('provider', 'paystack').eq('provider_subscription_id', incomingSubscriptionCode).maybeSingle();
    if (result.error) return new Response('Subscription lookup error', { status: 500 });
    subscription = result.data;
  }

  if (!subscription && incomingCustomerCode && incomingPlanCode) {
    const paymentResult = await db.from('booking_payments')
      .select('user_id,amount_total,amount,currency,metadata,paid_at')
      .eq('purpose', 'worker_pro_subscription').in('status', ['paid', 'completed'])
      .eq('metadata->>paystack_customer_code', incomingCustomerCode)
      .eq('metadata->>plan_code', incomingPlanCode)
      .order('paid_at', { ascending: false }).limit(1).maybeSingle();
    if (paymentResult.error) return new Response('Subscription payment lookup error', { status: 500 });
    if (paymentResult.data) {
      const existingResult = await db.from('worker_pro_subscriptions').select('*')
        .eq('worker_id', paymentResult.data.user_id).maybeSingle();
      if (existingResult.error) return new Response('Subscription lookup error', { status: 500 });
      subscription = existingResult.data || {
        worker_id: paymentResult.data.user_id,
        product_id: incomingPlanCode,
        price_amount: Number(paymentResult.data.amount_total ?? paymentResult.data.amount ?? 0),
        currency: paymentResult.data.currency || 'NGN',
        current_period_start: paymentResult.data.paid_at,
        current_period_end: null,
        status: 'active',
        cancel_at_period_end: false,
        auto_renews: true,
      };
    }
  }

  if (!subscription) {
    if (text(event?.event) === 'subscription.create' && incomingPlanCode) {
      const setting = await db.from('platform_settings').select('value')
        .eq('key', 'worker_pro_web_paystack_plan_code').maybeSingle();
      if (setting.error) return new Response('Plan lookup error', { status: 500 });
      if (setting.data?.value === incomingPlanCode) return new Response('Subscription mapping is not ready', { status: 500 });
    }
    return null;
  }

  const occurredAt = eventTime(event);
  let periodStart = dateOr(subscription.current_period_start, occurredAt);
  let periodEnd = dateOr(subscription.current_period_end, addMonth(periodStart));
  let status = text(subscription.status) || 'pending';
  let cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  let autoRenews = Boolean(subscription.auto_renews);
  const kind = text(event.event);
  const paid = data?.paid === true || ['success', 'successful', 'paid'].includes(text(data?.status).toLowerCase());

  if (kind === 'subscription.create') {
    const providerNextPayment = dateOr(data?.next_payment_date, periodEnd);
    if (providerNextPayment > occurredAt) periodEnd = providerNextPayment;
    if (periodEnd <= occurredAt) periodEnd = addMonth(occurredAt);
    if (!['active', 'grace_period'].includes(status)) status = 'active';
    cancelAtPeriodEnd = false;
    autoRenews = true;
  } else if (kind === 'charge.success' || (kind === 'invoice.update' && paid)) {
    periodStart = occurredAt;
    const providerNextPayment = dateOr(data?.next_payment_date || data?.subscription?.next_payment_date, addMonth(occurredAt));
    periodEnd = providerNextPayment > occurredAt ? providerNextPayment : addMonth(occurredAt);
    status = 'active';
    cancelAtPeriodEnd = false;
    autoRenews = true;
  } else if (kind === 'invoice.update') {
    return null;
  } else if (kind === 'invoice.payment_failed') {
    status = periodEnd > occurredAt ? 'grace_period' : 'paused';
  } else if (kind === 'subscription.not_renew') {
    status = periodEnd > occurredAt ? (status === 'grace_period' ? 'grace_period' : 'active') : 'expired';
    cancelAtPeriodEnd = true;
    autoRenews = false;
  } else if (kind === 'subscription.disable') {
    status = 'cancelled';
    cancelAtPeriodEnd = true;
    autoRenews = false;
  }

  const amountMinor = Number(data?.amount ?? data?.subscription?.amount ?? 0);
  const price = amountMinor > 0 ? amountMinor / 100 : Number(subscription.price_amount || 0);
  const currency = text(data?.currency || data?.subscription?.currency || subscription.currency || 'NGN').toUpperCase();
  const result = await db.rpc('record_worker_pro_subscription_event', {
    p_worker_id: subscription.worker_id,
    p_provider: 'paystack',
    p_product_id: incomingPlanCode || subscription.product_id,
    p_provider_subscription_id: incomingSubscriptionCode || subscription.provider_subscription_id || null,
    p_provider_event_id: eventId(event),
    p_event_type: kind,
    p_status: status,
    p_event_time: occurredAt.toISOString(),
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
    p_cancel_at_period_end: cancelAtPeriodEnd,
    p_auto_renews: autoRenews,
    p_price_amount: price,
    p_currency: currency,
    p_environment: environment,
    p_payload_sha256: payloadHash,
    p_metadata: {
      paystack_transaction_id: text(data?.id || data?.transaction?.id) || null,
      paystack_invoice_code: text(data?.invoice_code) || null,
      paystack_customer_code: incomingCustomerCode || null,
    },
  });
  if (result.error) return new Response('Subscription event processing error', { status: 500 });
  return new Response('OK', { status: 200 });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const signature = req.headers.get('x-paystack-signature') || '';
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!signature || !secret || !url || !serviceKey) return new Response('Unauthorized or misconfigured', { status: 401 });
    const raw = await req.text();
    const expectedSignature = await hmacHex(raw, secret);
    if (!safeEqual(expectedSignature, signature.toLowerCase())) return new Response('Invalid signature', { status: 401 });
    const event = JSON.parse(raw);
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const payloadHash = await sha256Hex(raw);
    const environment: 'sandbox' | 'production' = secret.startsWith('sk_test_') ? 'sandbox' : 'production';

    if (['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(event.event)) {
      const reference = text(event.data?.reference);
      if (!reference) return new Response('Transfer reference missing', { status: 200 });
      const paystackStatus = event.event.split('.')[1];
      const eventKey = `${event.event}:${text(event.data?.id || reference)}`;
      const { error } = await db.rpc('settle_withdrawal_transfer_event', {
        p_reference: reference,
        p_transfer_code: text(event.data?.transfer_code) || null,
        p_paystack_status: paystackStatus,
        p_reason: text(event.data?.reason || event.data?.failures) || null,
        p_event_key: eventKey,
        p_payload: event.data || {},
      });
      if (error) return new Response('Transfer settlement error', { status: 500 });
      return new Response('OK', { status: 200 });
    }

    if (event.event !== 'charge.success') {
      return (await recordProLifecycleEvent(db, event, payloadHash, environment)) || new Response('Ignored', { status: 200 });
    }

    const reference = text(event.data?.reference);
    const amount = Number(event.data?.amount ?? 0) / 100;
    const currency = text(event.data?.currency).toUpperCase();
    const status = text(event.data?.status).toLowerCase();
    const transactionId = text(event.data?.id);
    if (!reference || status !== 'success' || currency !== 'NGN' || amount <= 0) return new Response('Invalid event', { status: 200 });
    const { data: payment, error: lookupError } = await db.from('booking_payments')
      .select('id,purpose,status,amount,amount_total,worker_booking_id')
      .eq('paystack_reference', reference).maybeSingle();
    if (lookupError) return new Response('Database error', { status: 500 });
    if (!payment) {
      return (await recordProLifecycleEvent(db, event, payloadHash, environment)) || new Response('Payment not found', { status: 200 });
    }
    if (payment.status === 'paid' || payment.status === 'completed') return new Response('Already processed', { status: 200 });
    const expected = Number(payment.amount_total ?? payment.amount ?? 0);
    if (Math.round(expected * 100) !== Math.round(amount * 100)) return new Response('Amount mismatch', { status: 400 });

    if (payment.purpose === 'worker_pro_subscription') {
      const occurredAt = eventTime(event);
      const customer = customerCode(event.data);
      const code = subscriptionCode(event.data);
      const { data, error } = await db.rpc('confirm_worker_pro_paystack_charge', {
        p_reference: reference,
        p_transaction_id: transactionId,
        p_verified_amount: amount,
        p_currency: currency,
        p_subscription_code: code || null,
        p_event_id: eventId(event),
        p_event_time: occurredAt.toISOString(),
        p_environment: environment,
        p_payload_sha256: payloadHash,
        p_safe_metadata: { paystack_customer_code: customer || null, paystack_transaction_id: transactionId || null },
      });
      if (error) return new Response('Subscription activation error', { status: 500 });
      if (!data?.success) return new Response('Subscription activation rejected', { status: 409 });
      return new Response('OK', { status: 200 });
    }

    if (payment.purpose === 'worker_booking') {
      if (!payment.worker_booking_id) return new Response('Worker booking ID missing', { status: 409 });
      const { data, error } = await db.rpc('confirm_worker_booking_payment', {
        p_booking_id: payment.worker_booking_id, p_paystack_reference: reference,
        p_amount_verified: amount, p_currency: 'NGN', p_transaction_id: transactionId,
      });
      if (error) return new Response('Processing error', { status: 500 });
      if (!data?.success) {
        const { error: reviewError } = await db.from('booking_payments').update({
          status: 'review_required', paystack_transaction_id: transactionId || null,
          verified_amount: amount, verified_at: new Date().toISOString(),
          verification_source: 'webhook', updated_at: new Date().toISOString(),
        }).eq('id', payment.id);
        if (reviewError) return new Response('Could not record payment review state', { status: 500 });
        return new Response('Worker payment review recorded', { status: 200 });
      }
      return new Response('OK', { status: 200 });
    }
    if (payment.purpose === 'shared_housing_share') {
      const { error } = await db.rpc('confirm_shared_housing_payment', {
        p_reference: reference, p_transaction_id: transactionId, p_verified_amount: amount,
      });
      if (error) return new Response('Shared-home processing error', { status: 500 });
      return new Response('OK', { status: 200 });
    }
    const { error } = await db.rpc('confirm_booking_payment', {
      p_reference: reference, p_transaction_id: transactionId, p_verified_amount: amount,
      p_verification_source: 'webhook', p_purpose: payment.purpose,
    });
    if (error) return new Response('Processing error', { status: 500 });
    return new Response('OK', { status: 200 });
  } catch {
    return new Response('Internal error', { status: 500 });
  }
});
