import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";

type Db = ReturnType<typeof createClient>;

async function hmacHex(body: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(body: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalChargeReceipt(
  reference: string,
  transactionId: string,
  amountMinor: number,
  currency: string,
) {
  return JSON.stringify({
    provider: "paystack",
    event: "charge.success",
    reference,
    transaction_id: transactionId,
    amount_minor: amountMinor,
    currency,
  });
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function dateOr(value: unknown, fallback: Date) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addBillingPeriod(value: Date, billingPeriod: "monthly" | "yearly") {
  const next = new Date(value);
  if (billingPeriod === "yearly")
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function subscriptionCode(data: any) {
  return text(data?.subscription_code || data?.subscription?.subscription_code);
}

function planCode(data: any) {
  return text(
    data?.plan?.plan_code ||
      data?.plan_code ||
      data?.subscription?.plan?.plan_code,
  );
}

function customerCode(data: any) {
  return text(
    data?.customer?.customer_code ||
      data?.customer_code ||
      data?.subscription?.customer?.customer_code,
  );
}

function eventTime(event: any) {
  return dateOr(
    event?.data?.paid_at ||
      event?.data?.created_at ||
      event?.data?.updated_at ||
      event?.created_at,
    new Date(),
  );
}

function eventId(event: any) {
  const data = event?.data || {};
  const identity = text(
    data.id ||
      data.reference ||
      subscriptionCode(data) ||
      data.invoice_code ||
      data.transaction?.id,
  );
  const occurrence = text(
    data.paid_at || data.updated_at || data.created_at || event?.created_at,
  );
  return `${text(event?.event)}:${identity || "unknown"}:${occurrence || "undated"}`;
}

async function recordProLifecycleEvent(
  db: Db,
  event: any,
  payloadHash: string,
  environment: "sandbox" | "production",
) {
  const supported = new Set([
    "subscription.create",
    "subscription.not_renew",
    "subscription.disable",
    "invoice.update",
    "invoice.payment_failed",
    "charge.success",
  ]);
  if (!supported.has(text(event?.event))) return null;

  const data = event?.data || {};
  const incomingSubscriptionCode = subscriptionCode(data);
  const incomingPlanCode = planCode(data);
  const incomingCustomerCode = customerCode(data);
  let subscription: any = null;

  if (incomingSubscriptionCode) {
    const result = await db
      .from("worker_pro_subscriptions")
      .select("*")
      .eq("provider", "paystack")
      .eq("provider_subscription_id", incomingSubscriptionCode)
      .maybeSingle();
    if (result.error)
      return new Response("Subscription lookup error", { status: 500 });
    subscription = result.data;
  }

  if (!subscription && incomingCustomerCode && incomingPlanCode) {
    const paymentResult = await db
      .from("booking_payments")
      .select("user_id,amount_total,amount,currency,metadata,paid_at")
      .eq("purpose", "worker_pro_subscription")
      .in("status", ["paid", "completed"])
      .eq("metadata->>paystack_customer_code", incomingCustomerCode)
      .eq("metadata->>plan_code", incomingPlanCode)
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentResult.error)
      return new Response("Subscription payment lookup error", { status: 500 });
    if (paymentResult.data) {
      const existingResult = await db
        .from("worker_pro_subscriptions")
        .select("*")
        .eq("worker_id", paymentResult.data.user_id)
        .maybeSingle();
      if (existingResult.error)
        return new Response("Subscription lookup error", { status: 500 });
      subscription = existingResult.data || {
        worker_id: paymentResult.data.user_id,
        product_id: incomingPlanCode,
        billing_period:
          text(paymentResult.data.metadata?.billing_period) || "monthly",
        price_amount: Number(
          paymentResult.data.amount_total ?? paymentResult.data.amount ?? 0,
        ),
        currency: paymentResult.data.currency || "NGN",
        current_period_start: paymentResult.data.paid_at,
        current_period_end: null,
        status: "active",
        cancel_at_period_end: false,
        auto_renews: true,
      };
    }
  }

  if (!subscription) {
    if (text(event?.event) === "subscription.create" && incomingPlanCode) {
      const settings = await db
        .from("platform_settings")
        .select("value")
        .in("key", [
          "worker_pro_web_paystack_plan_code",
          "worker_pro_web_paystack_yearly_plan_code",
        ]);
      if (settings.error)
        return new Response("Plan lookup error", { status: 500 });
      if (
        (settings.data || []).some(
          (setting) => setting.value === incomingPlanCode,
        )
      ) {
        return new Response("Subscription mapping is not ready", {
          status: 500,
        });
      }
    }
    return null;
  }

  let billingPeriod: "monthly" | "yearly" =
    subscription.billing_period === "yearly" ? "yearly" : "monthly";
  if (incomingPlanCode) {
    const resolved = await db.rpc("worker_pro_billing_period_for_product", {
      p_provider: "paystack",
      p_product_id: incomingPlanCode,
    });
    if (resolved.error)
      return new Response("Plan period lookup error", { status: 500 });
    if (resolved.data === "yearly" || resolved.data === "monthly")
      billingPeriod = resolved.data;
  }
  const occurredAt = eventTime(event);
  let periodStart = dateOr(subscription.current_period_start, occurredAt);
  let periodEnd = dateOr(
    subscription.current_period_end,
    addBillingPeriod(periodStart, billingPeriod),
  );
  let status = text(subscription.status) || "pending";
  let cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  let autoRenews = Boolean(subscription.auto_renews);
  const kind = text(event.event);
  const paid =
    data?.paid === true ||
    ["success", "successful", "paid"].includes(
      text(data?.status).toLowerCase(),
    );

  if (kind === "subscription.create") {
    const providerNextPayment = dateOr(data?.next_payment_date, periodEnd);
    if (providerNextPayment > occurredAt) periodEnd = providerNextPayment;
    if (periodEnd <= occurredAt)
      periodEnd = addBillingPeriod(occurredAt, billingPeriod);
    if (!["active", "grace_period"].includes(status)) status = "active";
    cancelAtPeriodEnd = false;
    autoRenews = true;
  } else if (kind === "charge.success" || (kind === "invoice.update" && paid)) {
    periodStart = occurredAt;
    const providerNextPayment = dateOr(
      data?.next_payment_date || data?.subscription?.next_payment_date,
      addBillingPeriod(occurredAt, billingPeriod),
    );
    periodEnd =
      providerNextPayment > occurredAt
        ? providerNextPayment
        : addBillingPeriod(occurredAt, billingPeriod);
    status = "active";
    cancelAtPeriodEnd = false;
    autoRenews = true;
  } else if (kind === "invoice.update") {
    return null;
  } else if (kind === "invoice.payment_failed") {
    const graceSetting = await db
      .from("platform_settings")
      .select("value")
      .eq("key", "worker_pro_payment_grace_days")
      .maybeSingle();
    if (graceSetting.error)
      return new Response("Grace period lookup error", { status: 500 });
    const rawGraceDays = Number(graceSetting.data?.value || 0);
    const configuredGraceDays = Number.isFinite(rawGraceDays)
      ? Math.max(0, Math.min(14, Math.trunc(rawGraceDays)))
      : 0;
    const graceEnd = new Date(occurredAt);
    graceEnd.setUTCDate(graceEnd.getUTCDate() + configuredGraceDays);
    if (graceEnd > periodEnd) periodEnd = graceEnd;
    status = periodEnd > occurredAt ? "grace_period" : "paused";
  } else if (kind === "subscription.not_renew") {
    status =
      periodEnd > occurredAt
        ? status === "grace_period"
          ? "grace_period"
          : "active"
        : "expired";
    cancelAtPeriodEnd = true;
    autoRenews = false;
  } else if (kind === "subscription.disable") {
    status =
      periodEnd > occurredAt
        ? status === "grace_period"
          ? "grace_period"
          : "active"
        : "expired";
    cancelAtPeriodEnd = true;
    autoRenews = false;
  }

  const amountMinor = Number(data?.amount ?? data?.subscription?.amount ?? 0);
  const price =
    amountMinor > 0
      ? amountMinor / 100
      : Number(subscription.price_amount || 0);
  const currency = text(
    data?.currency ||
      data?.subscription?.currency ||
      subscription.currency ||
      "NGN",
  ).toUpperCase();
  const result = await db.rpc("record_worker_pro_subscription_event", {
    p_worker_id: subscription.worker_id,
    p_provider: "paystack",
    p_product_id: incomingPlanCode || subscription.product_id,
    p_provider_subscription_id:
      incomingSubscriptionCode || subscription.provider_subscription_id || null,
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
      billing_period: billingPeriod,
    },
  });
  if (result.error)
    return new Response("Subscription event processing error", { status: 500 });
  return new Response("OK", { status: 200 });
}

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  try {
    const signature = req.headers.get("x-paystack-signature") || "";
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!signature || !secret || !url || !serviceKey)
      return new Response("Unauthorized or misconfigured", { status: 401 });
    const raw = await req.text();
    const expectedSignature = await hmacHex(raw, secret);
    if (!safeEqual(expectedSignature, signature.toLowerCase()))
      return new Response("Invalid signature", { status: 401 });
    const event = JSON.parse(raw);
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payloadHash = await sha256Hex(raw);
    const environment: "sandbox" | "production" = secret.startsWith("sk_test_")
      ? "sandbox"
      : "production";

    if (
      ["transfer.success", "transfer.failed", "transfer.reversed"].includes(
        event.event,
      )
    ) {
      const reference = text(event.data?.reference);
      if (!reference)
        return new Response("Transfer reference missing", { status: 200 });
      const paystackStatus = event.event.split(".")[1];
      const eventKey = `${event.event}:${text(event.data?.id || reference)}`;
      const { error } = await db.rpc("settle_withdrawal_transfer_event", {
        p_reference: reference,
        p_transfer_code: text(event.data?.transfer_code) || null,
        p_paystack_status: paystackStatus,
        p_reason: text(event.data?.reason || event.data?.failures) || null,
        p_event_key: eventKey,
        p_payload: event.data || {},
      });
      if (error)
        return new Response("Transfer settlement error", { status: 500 });
      return new Response("OK", { status: 200 });
    }

    if (event.event !== "charge.success") {
      return (
        (await recordProLifecycleEvent(db, event, payloadHash, environment)) ||
        new Response("Ignored", { status: 200 })
      );
    }

    const reference = text(event.data?.reference);
    const amountMinor = Number(event.data?.amount ?? 0);
    const amount = amountMinor / 100;
    const currency = text(event.data?.currency).toUpperCase();
    const status = text(event.data?.status).toLowerCase();
    const transactionId = text(event.data?.id);
    if (
      !reference ||
      !transactionId ||
      status !== "success" ||
      currency !== "NGN" ||
      amount <= 0
    )
      return new Response("Invalid event", { status: 200 });
    const { data: payment, error: lookupError } = await db
      .from("booking_payments")
      .select("id,purpose,status,amount,amount_total,worker_booking_id")
      .eq("paystack_reference", reference)
      .maybeSingle();
    if (lookupError) return new Response("Database error", { status: 500 });
    if (!payment) {
      return (
        (await recordProLifecycleEvent(db, event, payloadHash, environment)) ||
        new Response("Payment not found", { status: 200 })
      );
    }
    if (
      payment.purpose === "worker_pro_subscription" &&
      payment.status === "review_required"
    ) {
      return new Response("Subscription payment review already recorded", {
        status: 200,
      });
    }
    const expected = Number(payment.amount_total ?? payment.amount ?? 0);
    if (Math.round(expected * 100) !== Math.round(amount * 100))
      return new Response("Amount mismatch", { status: 400 });

    // This retired purpose may exist only on old test/checkouts. Preserve the
    // verified charge for Finance reconciliation, but never advance Worker
    // review or marketplace eligibility from money.
    if (payment.purpose === "worker_verification") {
      if (payment.status !== "paid" && payment.status !== "completed") {
        const { error } = await db
          .from("booking_payments")
          .update({
            status: "review_required",
            paystack_transaction_id: transactionId || null,
            verified_amount: amount,
            verified_at: new Date().toISOString(),
            verification_source: "webhook",
            webhook_processed: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.id);
        if (error)
          return new Response("Could not record retired payment review", {
            status: 500,
          });
      }
      return new Response(
        "Retired Worker payment recorded for Finance review",
        { status: 200 },
      );
    }

    if (payment.purpose === "worker_pro_subscription") {
      const occurredAt = eventTime(event);
      const customer = customerCode(event.data);
      const code = subscriptionCode(event.data);
      const { data, error } = await db.rpc(
        "confirm_worker_pro_paystack_charge",
        {
          p_reference: reference,
          p_transaction_id: transactionId,
          p_verified_amount: amount,
          p_currency: currency,
          p_subscription_code: code || null,
          p_event_id: eventId(event),
          p_event_time: occurredAt.toISOString(),
          p_environment: environment,
          p_payload_sha256: payloadHash,
          p_safe_metadata: {
            paystack_customer_code: customer || null,
            paystack_transaction_id: transactionId || null,
          },
        },
      );
      if (error)
        return new Response("Subscription activation error", { status: 500 });
      if (data?.conflict)
        return new Response(
          "Subscription payment conflict recorded for review",
          { status: 200 },
        );
      if (!data?.success)
        return new Response("Subscription activation rejected", {
          status: 409,
        });
      return new Response("OK", { status: 200 });
    }

    const canonicalPurpose = new Set([
      "worker_booking",
      "shared_housing_share",
      "apartment_reservation",
      "apartment_rent",
      "rent_plan_contribution",
      "hotel_booking",
    ]).has(String(payment.purpose || ""));

    if (!canonicalPurpose) {
      const { data, error } = await db.rpc("confirm_booking_payment", {
        p_reference: reference,
        p_transaction_id: transactionId || null,
        p_verified_amount: amount,
        p_verification_source: "webhook",
        p_purpose: payment.purpose,
      });
      if (error) return new Response("Processing error", { status: 500 });
      if (!data?.success)
        return new Response("Payment confirmation rejected", { status: 409 });
      return new Response("OK", { status: 200 });
    }

    // Every marketplace charge goes through the canonical provider-event
    // gateway. That gateway owns payment confirmation, Payment Protection and
    // ledger linkage as one idempotent transaction. Do not return early merely
    // because a legacy path already marked the booking payment paid: replaying
    // here is how an otherwise-valid paid row is reconciled fail closed.
    const receiptHash = await sha256Hex(
      canonicalChargeReceipt(reference, transactionId, amountMinor, currency),
    );
    const { data, error } = await db.rpc("process_verified_paystack_charge", {
      p_provider_event_key: `charge.success:${transactionId}`,
      p_event_type: "charge.success",
      p_provider_reference: reference,
      p_payload_sha256: receiptHash,
      p_signature_verified_at: new Date().toISOString(),
      p_amount_minor: amountMinor,
      p_currency: currency,
      p_transaction_id: transactionId,
    });
    if (error) return new Response("Processing error", { status: 500 });
    if (!data?.success)
      return new Response("Payment requires Finance review", { status: 500 });
    return new Response("OK", { status: 200 });
  } catch {
    return new Response("Internal error", { status: 500 });
  }
});
