import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { parseWithdrawalIntent, sendWithdrawalIntent, type WithdrawalIntent, type WalletOwnerType } from '@/lib/walletWithdrawal';

export function useWalletWithdrawal(userId: string, ownerType: WalletOwnerType, onConfirmed: () => void | Promise<void>) {
  const storageKey = `wehouse:withdrawal:${userId}:${ownerType}`;
  const [pending, setPending] = useState<{ key: string; intent: WithdrawalIntent } | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const active = useRef(false);
  const currentKey = useRef(storageKey);
  currentKey.current = storageKey;
  const confirmed = useRef(onConfirmed);
  confirmed.current = onConfirmed;

  useEffect(() => {
    try {
      const intent = parseWithdrawalIntent(localStorage.getItem(storageKey));
      setPending(intent ? { key: storageKey, intent } : null);
      setStorageError('');
    } catch { setStorageError('Your saved withdrawal request could not be read. Contact Support before requesting another withdrawal.'); }
  }, [storageKey]);

  async function submit(amount: number, bankAccountId: string) {
    if (active.current || storageError) return;
    let intent: WithdrawalIntent;
    let recovering = false;
    try {
      const previous = parseWithdrawalIntent(localStorage.getItem(storageKey));
      recovering = Boolean(previous);
      intent = previous || { requestId: crypto.randomUUID(), amount, bankAccountId };
      localStorage.setItem(storageKey, JSON.stringify(intent));
    } catch {
      setStorageError('We could not save your withdrawal request in this browser. Allow site storage and reload before continuing.');
      return;
    }
    active.current = true; setBusy(true); setPending({ key: storageKey, intent });
    let result;
    try {
      result = await withTimeout(sendWithdrawalIntent(() => supabase.rpc('request_my_wallet_withdrawal', {
        p_owner_type: ownerType, p_amount: intent.amount,
        p_bank_account_id: intent.bankAccountId, p_request_id: intent.requestId,
      })), 15000, 'Still confirming withdrawal');
    } catch { result = { state: 'unknown' as const }; }
    finally { active.current = false; if (currentKey.current === storageKey) setBusy(false); }
    if (currentKey.current !== storageKey) return;
    if (result.state === 'unknown') {
      toast.message('Your withdrawal is still being confirmed. Check the same request before trying another.');
      return;
    }
    // A denied retry cannot prove the earlier in-flight command rolled back.
    // Preserve its ID until a receipt is recovered, even after account/session changes.
    if (result.state === 'rejected' && recovering) {
      toast.error(result.message);
      toast.message('The earlier withdrawal is still unconfirmed. Keep checking this request or contact Support.');
      return;
    }
    try {
      const latest = parseWithdrawalIntent(localStorage.getItem(storageKey));
      if (latest && latest.requestId !== intent.requestId) setPending({ key: storageKey, intent: latest });
      else { localStorage.removeItem(storageKey); setPending(null); }
    }
    catch {
      setStorageError('The result is confirmed, but this browser could not clear the saved request. Contact Support before requesting another withdrawal.');
      return;
    }
    if (result.state === 'rejected') { toast.error(result.message); return; }
    toast.message(`Withdrawal ${result.status.replaceAll('_', ' ')}`, { description: `Reference ${result.requestId.slice(0, 8)}` });
    await confirmed.current();
  }

  const intent = pending?.key === storageKey ? pending.intent : null;
  return { pending: intent, busy, storageError, submit,
    check: () => intent ? submit(intent.amount, intent.bankAccountId) : Promise.resolve() };
}
