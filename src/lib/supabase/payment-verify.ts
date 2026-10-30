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

export function paymentVerificationReceipt(value: unknown, purpose?: string): VerifyPaymentResult {
  const invalid = (): VerifyPaymentResult => ({ success: false,
    error: 'Payment confirmation could not be read. Check payment status before retrying.' });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (typeof row.success !== 'boolean') return invalid();
  for (const key of ['verified', 'recorded', 'already_processed', 'charged', 'requires_review']) {
    if (row[key] !== undefined && typeof row[key] !== 'boolean') return invalid();
  }
  if (row.amount !== undefined && (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0)) return invalid();
  if (row.error !== undefined && typeof row.error !== 'string') return invalid();
  if (row.purpose !== undefined && typeof row.purpose !== 'string') return invalid();
  if (row.success && (row.verified !== true || row.requires_review === true ||
    (row.recorded !== true && row.already_processed !== true) ||
    (purpose !== undefined && row.purpose !== purpose))) return invalid();
  return row as unknown as VerifyPaymentResult;
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
  return paymentVerificationReceipt(data, options?.purpose);
}

// ─── Verify + retry with backoff ───
// Retries only on transient failures. Deterministic auth/ownership/amount errors
// and verified charges that require WeHouse review return immediately.
export async function verifyPaymentWithRetry(
  reference: string,
  options?: { purpose?: string; expected_amount?: number },
  maxRetries = 3,
): Promise<VerifyPaymentResult> {
  let lastResult: VerifyPaymentResult = { success: false, error: 'Payment status could not be confirmed. Check status before retrying.' };
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await verifyPaymentServerSide(reference, options);
    lastResult = result;
    if (result.success || result.requires_review || result.charged) return result;

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
  return lastResult;
}
