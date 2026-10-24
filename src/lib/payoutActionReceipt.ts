export type PayoutAction = 'approve' | 'reject' | 'reconcile';
export function payoutActionConfirmed(action: PayoutAction, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.success !== true || typeof receipt.status !== 'string') return false;
  if (action === 'approve') return receipt.status === 'processing';
  if (action === 'reject') return receipt.status === 'rejected';
  return ['awaiting_review', 'processing', 'paid', 'failed', 'reversed', 'rejected', 'cancelled'].includes(receipt.status);
}
