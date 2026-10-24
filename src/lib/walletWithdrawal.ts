export type WalletOwnerType = 'worker' | 'property_partner';
export type WithdrawalIntent = { requestId: string; amount: number; bankAccountId: string };
export type WithdrawalResult =
  | { state: 'confirmed'; requestId: string; status: string }
  | { state: 'rejected'; message: string }
  | { state: 'unknown' };

export function parseWithdrawalIntent(raw: string | null): WithdrawalIntent | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as WithdrawalIntent;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(value.requestId) || !uuid.test(value.bankAccountId)
    || !Number.isFinite(value.amount) || value.amount <= 0) throw new Error('Invalid saved withdrawal');
  return { requestId: value.requestId, amount: value.amount, bankAccountId: value.bankAccountId };
}

// A database rejection rolls back the entire financial command. A broken
// connection or malformed receipt cannot establish whether the command committed.
export async function sendWithdrawalIntent(
  send: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<WithdrawalResult> {
  try {
    const { data, error } = await send();
    if (error) {
      if (/^[0-9A-Z]{5}$|^PGRST\d+$/.test(error.code || '')) {
        return { state: 'rejected', message: error.message || 'This withdrawal could not be requested.' };
      }
      return { state: 'unknown' };
    }
    const receipt = data as { success?: boolean; request_id?: string; status?: string; error?: string } | null;
    if (receipt?.success === false) return { state: 'rejected', message: receipt.error || 'This withdrawal could not be requested.' };
    if (receipt?.success === true && receipt.request_id && receipt.status) {
      return { state: 'confirmed', requestId: receipt.request_id, status: receipt.status };
    }
    return { state: 'unknown' };
  } catch { return { state: 'unknown' }; }
}
