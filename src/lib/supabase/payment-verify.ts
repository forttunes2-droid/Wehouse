// ═══════════════════════════════════════════════════════════
// Payment Verification — calls Paystack Verify Edge Function
// Server-side verification with amount + purpose validation
// ═══════════════════════════════════════════════════════════

import { supabase } from './client';

export interface VerifyPaymentResult {
  success: boolean;
  verified?: boolean;
  recorded?: boolean;
  already_processed?: boolean;
  charged?: boolean;
  requires_review?: boolean;
  amount?: number;
  paystack_status?: string;
  transaction_id?: number;
  purpose?: string;
  error?: string;
  expected?: number;
}

export async function verifyPaymentServerSide(
  reference: string,
  options?: {
    purpose?: string;
    expected_amount?: number;
  },
): Promise<VerifyPaymentResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    return { success: false, error: 'Not authenticated' };
  }

  // Use the configured Supabase client rather than reconstructing the Edge
  // Function URL from a separate Vite environment variable. This keeps the
  // payment verifier tied to the same project as Auth/Database/Storage.
  const { data, error } = await supabase.functions.invoke('paystack-verify', {
    body: {
      reference,
      purpose: options?.purpose,
      expected_amount: options?.expected_amount,
    },
  });

  if (error) {
    return { success: false, error: error.message || 'Payment verification request failed' };
  }
  return (data || { success: false, error: 'Empty payment verification response' }) as VerifyPaymentResult;
}

// ─── Verify + retry with backoff ───
// Retries only on transient failures. Deterministic auth/ownership/amount errors
// and verified charges that require WeHouse review return immediately.
export async function verifyPaymentWithRetry(
  reference: string,
  options?: { purpose?: string; expected_amount?: number },
  maxRetries = 3,
): Promise<VerifyPaymentResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await verifyPaymentServerSide(reference, options);
    if (result.success || result.requires_review) return result;

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

    if (isClientError) return result;

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  return { success: false, error: 'Max retries exceeded' };
}
