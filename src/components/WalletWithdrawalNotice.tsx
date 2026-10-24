import type { WithdrawalIntent } from '@/lib/walletWithdrawal';

export default function WalletWithdrawalNotice({ pending, busy, storageError, check }: {
  pending: WithdrawalIntent | null; busy: boolean; storageError: string; check: () => Promise<void>;
}) {
  if (storageError) return <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--wh-text)]">{storageError}</div>;
  if (!pending) return null;
  return <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--wh-text)]">
    <p className="font-semibold">{busy ? 'Confirming your withdrawal' : 'Withdrawal needs confirmation'}</p>
    <p className="mt-1 text-xs leading-5">Keep this request until WeHouse confirms its result. Checking it uses the same request and cannot reserve the money twice.</p>
    <button type="button" disabled={busy} onClick={() => void check()} className="mt-2 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold disabled:opacity-40">{busy ? 'Checking…' : 'Check request'}</button>
  </div>;
}
