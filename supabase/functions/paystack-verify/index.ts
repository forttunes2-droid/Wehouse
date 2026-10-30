import { hasLiveSession } from "../_shared/liveSession.ts";
import { paymentMinorUnits, resolvePaymentMarket } from '../_shared/payment-market.ts';
import {recordRentChargeRoute} from '../_shared/later-rent.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: cors },
    );

  let verifiedCharge = false;
  try {
    const { reference, purpose } = await req.json();
    if (!reference)
      return new Response(
        JSON.stringify({ success: false, error: "Reference is required" }),
        { status: 400, headers: cors },
      );

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!url || !serviceKey || !paystackSecret)
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration incomplete",
        }),
        { status: 500, headers: cors },
      );

    const authHeader = req.headers.get("authorization");
    if (!authHeader)
      return new Response(
        JSON.stringify({ success: false, error: "Authorization required" }),
        { status: 401, headers: cors },
      );

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token);
    if (authError || !user)
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired token" }),
        { status: 401, headers: cors },
      );

    if (!await hasLiveSession(admin, user.id, token)) return new Response(JSON.stringify({success:false,error:'Session ended. Sign in again.'}),{status:401,headers:cors});

    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, deleted, suspended, banned")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (!profile)
      return new Response(
        JSON.stringify({ success: false, error: "Profile not found" }),
        { status: 403, headers: cors },
      );
    if (profile.deleted || profile.suspended || profile.banned)
      return new Response(
        JSON.stringify({ success: false, error: "Account not active" }),
        { status: 403, headers: cors },
      );

    const { data: payment, error: paymentError } = await admin
      .from("booking_payments")
      .select(
        "id, user_id, payer_user_id, amount, amount_total, currency, purpose, status, paystack_reference, worker_booking_id",
      )
      .eq("paystack_reference", reference)
      .maybeSingle();
    if (paymentError)
      return new Response(
        JSON.stringify({ success: false, error: paymentError.message }),
        { status: 500, headers: cors },
      );
    if (!payment)
      return new Response(
        JSON.stringify({ success: false, error: "Payment record not found" }),
        { status: 404, headers: cors },
      );

    if (purpose && payment.purpose && purpose !== payment.purpose) {
      return new Response(
        JSON.stringify({ success: false, error: "Purpose mismatch" }),
        { status: 400, headers: cors },
      );
    }

    const owner = payment.payer_user_id || payment.user_id;
    if (!owner || owner !== profile.user_id)
      return new Response(
        JSON.stringify({
          success: false,
          error: "Payment does not belong to authenticated user",
        }),
        { status: 403, headers: cors },
      );

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      },
    );
    if (!paystackResponse.ok)
      return new Response(
        JSON.stringify({
          success: false,
          error: "Paystack verification failed",
        }),
        { status: 502, headers: cors },
      );
    const verified = await paystackResponse.json();
    if (!verified?.status || verified?.data?.status !== "success")
      return new Response(
        JSON.stringify({ success: false, error: "Payment not successful" }),
        { status: 400, headers: cors },
      );
    const market=resolvePaymentMarket(payment.currency);
    if (!market || verified.data.currency !== market.currency)
      return new Response(
        JSON.stringify({ success: false, error: "Currency mismatch" }),
        { status: 400, headers: cors },
      );

    const amountMinor = Number(verified.data.amount);
    if (verified.data.reference !== reference || !Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return new Response(JSON.stringify({ success: false, error: "Provider reference or amount mismatch" }),
        { status: 400, headers: cors });
    const verifiedAmount = amountMinor / 10**market.minorDigits;
    const expectedAmount = Number(payment.amount_total ?? payment.amount ?? 0);
    if (amountMinor !== paymentMinorUnits(payment.amount_total ?? payment.amount,market.minorDigits)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Amount mismatch",
          expected: expectedAmount,
          verified: verifiedAmount,
        }),
        { status: 400, headers: cors },
      );
    }

    verifiedCharge = true;
    const transactionId = String(verified.data.id ?? "");
    if (payment.purpose === "sponsored_campaign") {
      if (!transactionId || !["test", "live"].includes(String(verified.data.domain)))
        return new Response(JSON.stringify({ success: false, error: "Provider receipt is incomplete" }),
          { status: 400, headers: cors });
      const { data, error } = await admin.rpc("confirm_sponsored_paystack_charge", {
        p_reference: reference,
        p_transaction_id: transactionId,
        p_amount_minor: amountMinor,
        p_environment: verified.data.domain,
        p_source: "edge_function",
      });
      if (error) throw new Error("Sponsored payment was verified, but its receipt needs WeHouse review. Check status before retrying.");
      return new Response(JSON.stringify({ success: data?.success === true, verified: true,
        recorded: data?.success === true, charged: true, requires_review: data?.success !== true || data?.requires_review === true,
        error: data?.error, purpose: payment.purpose, amount: verifiedAmount, result: data }),
        { status: 200, headers: cors });
    }
    if (payment.purpose === "partner_pro_access") {
      if (!transactionId || !["test", "live"].includes(String(verified.data.domain)))
        return new Response(JSON.stringify({ success: false, error: "Provider receipt is incomplete" }),
          { status: 400, headers: cors });
      const { data, error } = await admin.rpc("confirm_partner_pro_paystack_charge", {
        p_reference: reference,
        p_transaction_id: transactionId,
        p_amount_minor: amountMinor,
        p_environment: verified.data.domain,
        p_source: "edge_function",
      });
      if (error) throw new Error("Partner Pro payment was verified, but its receipt needs WeHouse review. Check status before retrying.");
      return new Response(JSON.stringify({ success: data?.success === true, verified: true,
        recorded: data?.success === true, charged: true, requires_review: data?.success !== true || data?.requires_review === true,
        error: data?.error, purpose: payment.purpose, amount: verifiedAmount, result: data }),
        { status: 200, headers: cors });
    }
    async function recordPaymentMode() {
      const { error } = await admin.rpc("record_verified_payment_mode", {
        p_reference: reference, p_transaction_id: transactionId,
        p_domain: verified.data.domain || null,
      });
      if (error) throw new Error("Payment confirmed, but receipt details could not be saved. Please check again.");
    }
    if (payment.purpose === "worker_verification") {
      if (payment.status !== "paid" && payment.status !== "completed") {
        const { error: reviewError } = await admin
          .from("booking_payments")
          .update({
            status: "review_required",
            paystack_transaction_id: String(verified.data.id ?? "") || null,
            verified_amount: verifiedAmount,
            verified_at: new Date().toISOString(),
            verification_source: "edge_function",
            webhook_processed: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.id);
        if (reviewError)
          return new Response(
            JSON.stringify({
              success: false,
              error: "Could not record retired payment review",
            }),
            { status: 500, headers: cors },
          );
      }
      return new Response(
        JSON.stringify({
          success: false,
          verified: true,
          charged: true,
          requires_review: true,
          retired: true,
          error:
            "This legacy Worker onboarding payment cannot grant WeHouse approval. Finance review is required.",
          amount: verifiedAmount,
          purpose: payment.purpose,
        }),
        { status: 200, headers: cors },
      );
    }

    // Paid-plan entitlement uses its own reviewed billing lifecycle. Never let
    // the generic legacy payment writer stand in for subscription activation.
    if (payment.purpose === "worker_pro_subscription") {
      const occurredAt = new Date(verified.data.paid_at || "");
      const domain = verified.data.domain;
      if (!transactionId || !Number.isFinite(occurredAt.getTime()) ||
        !["test", "live"].includes(domain) ||
        (domain === "test") !== paystackSecret.startsWith("sk_test_")) {
        return new Response(JSON.stringify({ success: false, verified: true, charged: true,
          requires_review: true, error: "The paid-plan provider receipt is incomplete." }),
          { status: 200, headers: cors });
      }
      const { data, error } = await admin.rpc("confirm_worker_pro_paystack_charge", {
        p_reference: reference, p_transaction_id: transactionId,
        p_verified_amount: verifiedAmount, p_currency: market.currency,
        p_subscription_code: verified.data.subscription_code || verified.data.subscription?.subscription_code || null,
        p_event_id: `verified.charge.success:${transactionId}`,
        p_event_time: occurredAt.toISOString(),
        p_environment: domain === "test" ? "sandbox" : "production",
        p_payload_sha256: await sha256Hex(canonicalChargeReceipt(reference, transactionId, amountMinor, market.currency)),
        p_safe_metadata: { paystack_transaction_id: transactionId },
      });
      if (error) return new Response(JSON.stringify({ success: false, verified: true, charged: true,
        requires_review: true, error: "Paid-plan activation could not be confirmed. Check status before retrying." }),
        { status: 200, headers: cors });
      if (data?.success !== true) return new Response(JSON.stringify({ success: false,
        verified: true, charged: true, requires_review: true,
        error: data?.error || "This paid-plan payment needs WeHouse review.", purpose: payment.purpose, amount: verifiedAmount }),
        { status: 200, headers: cors });
      await recordPaymentMode();
      return new Response(JSON.stringify({ success: true, verified: true, recorded: true,
        amount: verifiedAmount, purpose: payment.purpose, result: data }), { status: 200, headers: cors });
    }

    // Every remaining marketplace purpose, including an unknown future one,
    // must pass the durable provider-event gateway. Unsupported purposes are
    // recorded there as failed; they cannot silently become a paid booking.
    {
      if (!transactionId)
        return new Response(
          JSON.stringify({
            success: false,
            verified: true,
            charged: true,
            requires_review: true,
            error: "Paystack did not return a transaction ID.",
          }),
          { status: 200, headers: cors },
        );
      if(payment.purpose==='rent_plan_contribution')await recordRentChargeRoute(admin,reference,verified.data);
      const receiptHash = await sha256Hex(
        canonicalChargeReceipt(reference, transactionId, amountMinor, "NGN"),
      );
      const { data, error } = await admin.rpc(
        "process_verified_paystack_charge",
        {
          p_provider_event_key: `charge.success:${transactionId}`,
          p_event_type: "charge.success",
          p_provider_reference: reference,
          p_payload_sha256: receiptHash,
          // This endpoint has authenticated the provider response with the
          // server-side Paystack secret; the webhook uses its HMAC verification.
          p_signature_verified_at: new Date().toISOString(),
          p_amount_minor: amountMinor,
          p_currency: "NGN",
          p_transaction_id: transactionId,
        },
      );
      if (error) throw new Error("Payment was verified but recording its payment receipt failed. Check status before retrying.");
      if (data?.success !== true || data?.ignored === true) {
        return new Response(
          JSON.stringify({
            success: false,
            verified: true,
            charged: true,
            requires_review: true,
            error:
              data?.error ||
              "Payment was verified but its payment record needs WeHouse review.",
            amount: verifiedAmount,
            purpose: payment.purpose,
          }),
          { status: 200, headers: cors },
        );
      }
      await recordPaymentMode();
      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          recorded: true,
          amount: verifiedAmount,
          purpose: payment.purpose,
          result: data,
        }),
        { status: 200, headers: cors },
      );
    }

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
          ...(verifiedCharge ? { verified: true, charged: true, requires_review: true } : {}),
        error: error instanceof Error ? error.message : "Internal error",
      }),
      { status: verifiedCharge ? 200 : 500, headers: cors },
    );
  }
});
