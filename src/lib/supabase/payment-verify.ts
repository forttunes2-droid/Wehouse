// ═══════════════════════════════════════════════════════════
// Payment Verification — calls Paystack Verify Edge Function
// Server-side verification with amount + purpose validation
// ═══════════════════════════════════════════════════════════

import { supabase } from './client';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-verify`;

export interface VerifyPaymentResult {
  success: boolean;
  verified?: boolean;
  recorded?: boolean;
  already_processed?: boolean;
  amount?: number;
  paystack_status?: string;
  transaction_id?: number;
  error?: string;
  expected?: number;
}

export async function verifyPaymentServerSide(
  reference: string,
  options?: {
    purpose?: string;
    expected_amount?: number;
  }
): Promise<VerifyPaymentResult> {
  // Get the user's session JWT — the Edge Function requires valid auth.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    return { success: false, error: 'Not authenticated' };
  }

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      reference,
      purpose: options?.purpose,
      expected_amount: options?.expected_amount,
    }),
  });

  const data = await res.json();
  return data as VerifyPaymentResult;
}

// ─── Verify + retry with backoff ───
// Retries only on network failures or 5xx server errors.
// Does NOT retry on 400-499 client errors (auth failure, amount mismatch, etc.)
// because those are deterministic and will not resolve by retrying.
export async function verifyPaymentWithRetry(
  reference: string,
  options?: { purpose?: string; expected_amount?: number },
  maxRetries = 3
): Promise<VerifyPaymentResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await verifyPaymentServerSide(reference, options);
    if (result.success) return result;

    // Do NOT retry on client errors (4xx): these are deterministic.
    // The Edge Function returns 4xx for:
    //   401 = missing/invalid auth
    //   403 = wrong user, inactive account
    //   404 = payment or booking not found
    //   400 = amount mismatch, purpose mismatch, bad currency, etc.
    // Only retry on transient failures (no success flag, no error, or 5xx).
    const isClientError = result.error && (
      result.error.includes('Not authenticated') ||
      result.error.includes('Invalid or expired token') ||
      result.error.includes('Profile not found') ||
      result.error.includes('Account not active') ||
      result.error.includes('Payment does not belong') ||
      result.error.includes('Amount mismatch') ||
      result.error.includes('Currency mismatch') ||
      result.error.includes('Purpose mismatch') ||
      result.error.includes('Payment record not found') ||
      result.error.includes('Worker booking ID not found')
    );

    if (isClientError) {
      return result;
    }

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return { success: false, error: 'Max retries exceeded' };
}
