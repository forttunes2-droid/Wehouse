import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface WorkerWalletProps {
  profile: Profile;
}

interface WalletData {
  available_balance: number;
  pending_balance: number;
  total_earned: number;
  total_withdrawn: number;
  frozen: boolean;
  frozen_reason: string | null;
  transactions: WalletTransaction[];
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

interface WithdrawalRequest {
  id: string;
  amount_requested: number;
  withdrawal_fee: number;
  amount_paid: number;
  status: string;
  bank_name: string;
  bank_account_number: string;
  created_at: string;
  completed_at: string | null;
}

export default function WorkerWallet({ profile }: WorkerWalletProps) {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => { loadWallet(); }, []);

  async function loadWallet() {
    setLoading(true);
    const [{ data: walletData }, { data: withdrawalData }] = await Promise.all([
      supabase.rpc('get_user_wallet', { p_user_id: profile.user_id }),
      supabase.from('withdrawal_requests').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(10),
    ]);
    if (walletData) setWallet(typeof walletData === 'string' ? JSON.parse(walletData) : walletData);
    setWithdrawals(withdrawalData || []);
    setLoading(false);
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (!wallet || amount > wallet.available_balance) { toast.error('Insufficient balance'); return; }
    if (!profile.bank_code || !profile.bank_account_number) {
      toast.error('Bank details not set. Add them in Profile Settings.');
      return;
    }

    setProcessing(true);
    const { data, error } = await supabase.rpc('create_withdrawal_request', {
      p_user_id: profile.user_id,
      p_amount: amount,
      p_bank_name: profile.bank_name || '',
      p_bank_code: profile.bank_code || '',
      p_account_number: profile.bank_account_number || '',
    });
    setProcessing(false);

    if (error) {
      toast.error(error.message || 'Withdrawal failed');
      return;
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    if (result?.success) {
      toast.success(`Withdrawal request created! Net: N${result.net_amount}`);
      setShowWithdrawForm(false);
      setWithdrawAmount('');
      loadWallet();
    } else {
      toast.error(result?.error || 'Failed');
    }
  }

  const formatN = (n: number) => `N${Number(n || 0).toLocaleString()}`;
  const statusColor = (s: string) => {
    switch (s) {
      case 'paid': return 'text-emerald-400 bg-emerald-500/10';
      case 'pending': return 'text-amber-400 bg-amber-500/10';
      case 'processing': return 'text-blue-400 bg-blue-500/10';
      case 'failed': return 'text-red-400 bg-red-500/10';
      default: return 'text-[#5C5E72] bg-[#12121A]';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-lg font-bold text-white">My Wallet</h1>
        <p className="text-[10px] text-[#5C5E72]">{profile.role === 'worker' ? 'Worker Earnings' : 'Property Partner Earnings'}</p>
      </div>

      <div className="px-5 space-y-4">
        {/* Balance Card */}
        <div className="glass rounded-2xl p-5 border border-[#3B82F6]/10">
          {wallet?.frozen && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-[10px] text-red-400 font-medium">Wallet Frozen: {wallet.frozen_reason}</p>
            </div>
          )}

          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Available Balance</p>
          <p className="text-3xl font-bold text-white mt-1">{formatN(wallet?.available_balance || 0)}</p>

          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[#1E1E2C]">
            <div>
              <p className="text-[9px] text-[#5C5E72]">Pending</p>
              <p className="text-sm font-semibold text-amber-400">{formatN(wallet?.pending_balance || 0)}</p>
            </div>
            <div>
              <p className="text-[9px] text-[#5C5E72]">Total Earned</p>
              <p className="text-sm font-semibold text-emerald-400">{formatN(wallet?.total_earned || 0)}</p>
            </div>
            <div>
              <p className="text-[9px] text-[#5C5E72]">Withdrawn</p>
              <p className="text-sm font-semibold text-blue-400">{formatN(wallet?.total_withdrawn || 0)}</p>
            </div>
          </div>

          {/* Withdraw Button */}
          <button
            onClick={() => {
              if (wallet?.frozen) { toast.error('Wallet is frozen'); return; }
              if ((wallet?.available_balance || 0) <= 0) { toast.error('No balance to withdraw'); return; }
              setShowWithdrawForm(true);
            }}
            className="w-full mt-4 h-11 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold hover:bg-[#2563EB] transition-colors"
          >
            Withdraw Funds
          </button>
        </div>

        {/* Withdraw Form */}
        {showWithdrawForm && (
          <form onSubmit={handleWithdraw} className="glass rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-white">Request Withdrawal</p>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Amount (N)</label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                placeholder={`Max: ${formatN(wallet?.available_balance || 0)}`}
                min="1000"
                max={wallet?.available_balance || 0}
                className="w-full h-10 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-sm px-3 focus:border-[#3B82F6]/50 outline-none"
              />
              <p className="text-[9px] text-[#5C5E72] mt-1">Min: N1,000 • Fee: N50 per withdrawal</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={processing}
                className="flex-1 h-9 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] disabled:opacity-50">
                {processing ? 'Processing...' : 'Confirm Withdrawal'}
              </button>
              <button type="button" onClick={() => setShowWithdrawForm(false)}
                className="h-9 px-4 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Recent Transactions */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-xs font-semibold text-white mb-3">Recent Transactions</h3>
          <div className="space-y-2">
            {(wallet?.transactions || []).map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-[#1E1E2C] last:border-0">
                <div>
                  <p className="text-[11px] text-white">{tx.description}</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className={`text-[11px] font-semibold ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tx.amount >= 0 ? '+' : ''}{formatN(tx.amount)}
                  </p>
                </div>
              </div>
            ))}
            {(!wallet?.transactions || wallet.transactions.length === 0) && (
              <p className="text-[10px] text-[#5C5E72] text-center py-4">No transactions yet</p>
            )}
          </div>
        </div>

        {/* Withdrawal History */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-xs font-semibold text-white mb-3">Withdrawal History</h3>
          <div className="space-y-2">
            {withdrawals.map(w => (
              <div key={w.id} className="flex items-center justify-between py-2 border-b border-[#1E1E2C] last:border-0">
                <div>
                  <p className="text-[11px] text-white font-medium">{formatN(w.amount_requested)}</p>
                  <p className="text-[9px] text-[#5C5E72]">
                    {w.bank_name} •••{w.bank_account_number?.slice(-4)}
                  </p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(w.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${statusColor(w.status)}`}>{w.status}</span>
                  {w.amount_paid > 0 && <p className="text-[9px] text-emerald-400 mt-0.5">Net: {formatN(w.amount_paid)}</p>}
                </div>
              </div>
            ))}
            {withdrawals.length === 0 && (
              <p className="text-[10px] text-[#5C5E72] text-center py-4">No withdrawals yet</p>
            )}
          </div>
        </div>

        {/* Bank Details */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-xs font-semibold text-white mb-2">Payout Bank Details</h3>
          <div className="space-y-1">
            <p className="text-[10px] text-[#5C5E72]">Bank: <span className="text-white">{profile.bank_name || 'Not set'}</span></p>
            <p className="text-[10px] text-[#5C5E72]">Account: <span className="text-white">{profile.bank_account_number ? `•••${profile.bank_account_number.slice(-4)}` : 'Not set'}</span></p>
          </div>
          {!profile.bank_account_number && (
            <p className="text-[9px] text-amber-400 mt-2">Add your bank details in Profile Settings to withdraw</p>
          )}
        </div>
      </div>
    </div>
  );
}
