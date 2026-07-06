// ═══════════════════════════════════════════════════════════
// PAYSTACK WEBHOOK HANDLER — Supabase Edge Function
// Securely processes charge.success events server-side
// ═══════════════════════════════════════════════════════════
// 
// DEPLOY: npx supabase functions deploy paystack-webhook
// URL: https://<project>.supabase.co/functions/v1/paystack-webhook
// Add this URL to your Paystack Dashboard → Settings → Webhooks

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-paystack-signature, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Compute HMAC-SHA512 signature for Paystack verification
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === signature;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Get Paystack signature from header
    const signature = req.headers.get('x-paystack-signature');
    if (!signature) {
      return new Response('Missing signature', { status: 401, headers: corsHeaders });
    }

    // Get secret key from environment
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      console.error('[Webhook] PAYSTACK_SECRET_KEY not set');
      return new Response('Server misconfigured', { status: 500, headers: corsHeaders });
    }

    // Read raw body for signature verification
    const rawBody = await req.text();

    // Verify signature
    const isValid = await verifySignature(rawBody, signature, secretKey);
    if (!isValid) {
      console.error('[Webhook] Invalid signature');
      return new Response('Invalid signature', { status: 401, headers: corsHeaders });
    }

    // Parse event
    const event = JSON.parse(rawBody);
    const eventType = event.event;

    console.log(`[Webhook] Received ${eventType}`, event.data?.reference);

    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Handle charge.success
    if (eventType === 'charge.success') {
      const data = event.data;
      const reference = data.reference;
      const transactionId = String(data.id);
      const amount = data.amount / 100; // Convert kobo to naira
      const status = data.status;

      console.log(`[Webhook] Processing charge.success: ref=${reference}, amount=${amount}, status=${status}`);

      if (status !== 'success') {
        return new Response('Ignored: not success', { status: 200, headers: corsHeaders });
      }

      // Call the confirm function (idempotent)
      const { data: result, error } = await supabase.rpc('confirm_booking_payment', {
        p_reference: reference,
        p_transaction_id: transactionId
      });

      if (error) {
        console.error('[Webhook] confirm_booking_payment error:', error.message);
        return new Response('Processing error', { status: 500, headers: corsHeaders });
      }

      const resultJson = typeof result === 'string' ? JSON.parse(result) : result;
      console.log('[Webhook] Result:', JSON.stringify(resultJson));

      return new Response(JSON.stringify(resultJson), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle transfer.success (for payouts to workers)
    if (eventType === 'transfer.success') {
      console.log('[Webhook] Transfer success:', event.data?.reference);
      // Could update withdrawal status here
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    // Handle refund
    if (eventType === 'refund.processed') {
      console.log('[Webhook] Refund processed:', event.data?.transaction_reference);
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    // Unknown event type — acknowledge but ignore
    console.log(`[Webhook] Ignored event type: ${eventType}`);
    return new Response('Event ignored', { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error('[Webhook] Unhandled error:', err.message);
    return new Response('Internal error', { status: 500, headers: corsHeaders });
  }
});
