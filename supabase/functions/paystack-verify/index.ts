import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface VerifyRequest {
  reference: string;
  purpose?: string;
  expected_amount?: number;
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
    const { reference, purpose, expected_amount } = body;

    if (!reference) {
      return new Response(
        JSON.stringify({ success: false, error: 'Reference is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 1. Verify with Paystack API (server-side) ───
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

    // ─── 2. Verify expected amount matches ───
    if (expected_amount && Math.abs(verifiedAmount - expected_amount) > 1) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Amount mismatch',
          expected: expected_amount,
          verified: verifiedAmount,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── 3. Call Supabase RPC to record payment ───
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Supabase not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: confirmResult, error: confirmError } = await supabase.rpc(
      'confirm_booking_payment',
      {
        p_reference: reference,
        p_transaction_id: paystackData.data.id?.toString() || null,
        p_verified_amount: verifiedAmount,
        p_verification_source: 'edge_function',
        p_purpose: purpose || null,
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

    // ─── 4. Return result ───
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
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
