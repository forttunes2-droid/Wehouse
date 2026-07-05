import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

interface Props {
  profile: Profile;
  onBack: () => void;
}

export default function UserWalletPage({ profile, onBack }: Props) {
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: w } = await supabase.from('wallets').select('*').eq('user_id', profile.user_id).maybeSingle();
    setWallet(w);
    const { data: tx } = await supabase.from('wallet_transactions').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(30);
    setTransactions(tx || []);
    setLoading(false);
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] px-5 pt-5 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-base font-bold text-white">Wallet</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4 max-w-lg mx-auto">
          {/* Balance Card */}
          <div className="rounded-2xl bg-gradient-to-br from-[#3B82F6]/10 to-[#2563EB]/5 border border-[#3B82F6]/20 p-5">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Available Balance</p>
            <p className="text-3xl font-bold text-white mt-2">
              N{(wallet?.available_balance || 0).toLocaleString()}
            </p>
            <div className="flex gap-4 mt-4">
              <div>
                <p className="text-[9px] text-[#5C5E72]">Pending</p>
                <p className="text-xs text-amber-400 font-semibold">
                  N{(wallet?.pending_balance || 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-[#5C5E72]">Total Withdrawn</p>
                <p className="text-xs text-emerald-400 font-semibold">
                  N{(wallet?.total_withdrawn || 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div>
            <h3 className="text-xs font-semibold text-white mb-3">Transaction History</h3>
            {transactions.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm text-[#5C5E72]">No transactions yet</p>
                <p className="text-[10px] text-[#3C3D4D] mt-1">Your wallet activity will appear here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx: any) => (
                  <div key={tx.id} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-white capitalize">{tx.type.replace(/_/g, ' ')}</p>
                      <p className="text-[9px] text-[#5C5E72]">{tx.description || 'No description'}</p>
                      <p className="text-[9px] text-[#3C3D4D]">{new Date(tx.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={`text-xs font-bold ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount > 0 ? '+' : ''}N{Math.abs(tx.amount).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
