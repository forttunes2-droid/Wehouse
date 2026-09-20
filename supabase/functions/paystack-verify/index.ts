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
        "id, user_id, payer_user_id, amount, amount_total, purpose, status, paystack_reference, worker_booking_id",
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
    if (verified.data.currency !== "NGN")
      return new Response(
        JSON.stringify({ success: false, error: "Currency mismatch" }),
        { status: 400, headers: cors },
      );

    const amountMinor = Number(verified.data.amount);
    const verifiedAmount = amountMinor / 100;
    const expectedAmount = Number(payment.amount_total ?? payment.amount ?? 0);
    if (Math.round(verifiedAmount * 100) !== Math.round(expectedAmount * 100)) {
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

    const transactionId = String(verified.data.id ?? "");
    async function recordPaymentMode() {
      const { error } = await admin.rpc("record_verified_payment_mode", {
        p_reference: reference, p_transaction_id: transactionId,
        p_domain: verified.data.domain || null,
      });
      if (error) throw new Error("Payment confirmed, but receipt details could not be saved. Please check again.");
    }
    const canonicalPurpose = new Set([
      "worker_booking",
      "shared_housing_share",
      "apartment_reservation",
      "apartment_rent",
      "rent_plan_contribution",
      "hotel_booking",
    ]).has(String(payment.purpose || ""));

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

    if (
      (payment.status === "paid" || payment.status === "completed") &&
      !canonicalPurpose
    ) {
      await recordPaymentMode();
      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          already_processed: true,
          amount: verifiedAmount,
          purpose: payment.purpose,
        }),
        { status: 200, headers: cors },
      );
    }

    if (canonicalPurpose) {
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
      if (error)
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: cors },
        );
      if (!data?.success) {
        return new Response(
          JSON.stringify({
            success: false,
            verified: true,
            charged: true,
            requires_review: true,
            error:
              data?.error ||
              "Payment was verified but its protected-funds record needs WeHouse review.",
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

    const { data, error } = await admin.rpc("confirm_booking_payment", {
      p_reference: reference,
      p_transaction_id: transactionId,
      p_verified_amount: verifiedAmount,
      p_verification_source: "edge_function",
      p_purpose: payment.purpose,
    });
    if (error)
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: cors },
      );
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
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal error",
      }),
      { status: 500, headers: cors },
    );
  }
});
