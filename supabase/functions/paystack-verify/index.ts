import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface VerifyRequest {
  reference: string;
  purpose?: string;
}

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const body: VerifyRequest = await req.json();
    const { reference, purpose } = body;

    if (!reference) {
      return new Response(
        JSON.stringify({ success: false, error: 'Reference is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 0. Authenticate caller ───
    // FAIL CLOSED: every payment verification MUST have a valid authenticated user.
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Supabase not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the JWT from the Authorization header — fail closed if missing/invalid/expired
    let authenticatedUserId: string | null = null;
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Look up the WH user_id from profiles and verify account is active
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id, deleted, suspended, banned')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (!profile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Profile not found' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (profile.deleted || profile.suspended || profile.banned) {
      return new Response(
        JSON.stringify({ success: false, error: 'Account not active' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    authenticatedUserId = profile.user_id;

    // ─── 1. Find payment record in database ───
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('booking_payments')
      .select('id, user_id, payer_user_id, amount, amount_total, purpose, status, paystack_reference')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (paymentError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Database error: ' + paymentError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 2. Verify with Paystack API (server-side) ───
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      return new Response(
        JSON.stringify({ success: false, error: 'Paystack secret not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      }
    );

    if (!paystackRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: 'Paystack verification failed' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payment not successful',
          paystack_status: paystackData.data?.status || 'unknown',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const verifiedAmount = paystackData.data.amount / 100; // Paystack amount is in kobo

    // ─── 3. Verify currency = NGN ───
    if (paystackData.data.currency !== 'NGN') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Currency mismatch',
          expected: 'NGN',
          verified: paystackData.data.currency,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 4. Derive expected amount from canonical DB row ───
    // FAIL CLOSED: no DB record = no verification.
    if (!paymentRecord) {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment record not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const dbExpectedAmount = paymentRecord.amount_total || paymentRecord.amount || null;

    // ─── 5. Verify amount matches ───
    if (dbExpectedAmount && dbExpectedAmount > 0) {
      if (Math.abs(verifiedAmount - dbExpectedAmount) > 1) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Amount mismatch',
            expected: dbExpectedAmount,
            verified: verifiedAmount,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment amount not set' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 6. Verify purpose matches ───
    if (purpose && paymentRecord?.purpose && purpose !== paymentRecord.purpose) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Purpose mismatch',
          expected: paymentRecord.purpose,
          provided: purpose,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 7. Verify user ownership ───
    // FAIL CLOSED: for customer-initiated payments, the caller must own the payment.
    const paymentOwner = paymentRecord.payer_user_id || paymentRecord.user_id;
    if (!paymentOwner || paymentOwner !== authenticatedUserId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payment does not belong to authenticated user',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 8. Check already-processed (idempotency) ───
    const { data: alreadyVerified } = await supabase
      .from('verified_paystack_references')
      .select('paystack_reference')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (alreadyVerified || paymentRecord?.status === 'paid' || paymentRecord?.status === 'completed') {
      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          recorded: true,
          already_processed: true,
          amount: verifiedAmount,
          paystack_status: paystackData.data.status,
          transaction_id: paystackData.data.id,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // ─── 9. Route by payment purpose ───
    const transactionId = paystackData.data.id?.toString() || null;

    if (paymentRecord.purpose === 'worker_booking') {
      // ── 9a. WORKER BOOKING ──
      // Derive booking_id from canonical worker_bookings table (NOT from browser).
      const { data: workerBooking, error: wbError } = await supabase
        .from('worker_bookings')
        .select('id')
        .eq('paystack_reference', reference)
        .maybeSingle();

      if (wbError || !workerBooking) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Worker booking not found for this payment',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Call the worker-specific RPC (service_role only)
      const { data: confirmResult, error: confirmError } = await supabase.rpc(
        'confirm_worker_booking_payment',
        {
          p_booking_id: workerBooking.id,
          p_paystack_reference: reference,
          p_amount_verified: verifiedAmount,
          p_currency: 'NGN',
          p_transaction_id: transactionId,
        }
      );

      if (confirmError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: confirmError.message,
            verified: true,
            recorded: false,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const resultJson = typeof confirmResult === 'string' ? JSON.parse(confirmResult) : confirmResult;

      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          recorded: true,
          amount: verifiedAmount,
          paystack_status: paystackData.data.status,
          transaction_id: paystackData.data.id,
          confirm_result: resultJson,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    } else {
      // ── 9b. ALL OTHER PAYMENT TYPES ──
      // (worker_verification, apartment_reservation, apartment_rent, hotel_booking, etc.)
      const { data: confirmResult, error: confirmError } = await supabase.rpc(
        'confirm_booking_payment',
        {
          p_reference: reference,
          p_transaction_id: transactionId,
          p_verified_amount: verifiedAmount,
          p_verification_source: 'edge_function',
          p_purpose: paymentRecord.purpose || purpose || null,
        }
      );

      if (confirmError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: confirmError.message,
            verified: true,
            recorded: false,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          recorded: true,
          amount: verifiedAmount,
          paystack_status: paystackData.data.status,
          transaction_id: paystackData.data.id,
          confirm_result: confirmResult,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
