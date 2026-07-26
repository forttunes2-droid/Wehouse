// ═══════════════════════════════════════════════════════════
// Payment Verification — calls Paystack Verify Edge Function
// Server-side verification with amount + purpose validation
// ═══════════════════════════════════════════════════════════

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-verify`;

export interface VerifyPaymentResult {
  success: boolean;
  verified?: boolean;
  recorded?: boolean;
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
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
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
export async function verifyPaymentWithRetry(
  reference: string,
  options?: { purpose?: string; expected_amount?: number },
  maxRetries = 3
): Promise<VerifyPaymentResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await verifyPaymentServerSide(reference, options);
    if (result.success) return result;

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return { success: false, error: 'Max retries exceeded' };
}
