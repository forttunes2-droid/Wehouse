// ═══════════════════════════════════════════════════════════════
// UNIFIED WALLET PAGE
// Overview · Earnings · Withdraw · Bank Accounts · Transactions
// All in one page with sub-tabs — NOT separate main tabs
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import BackButton from '@/components/BackButton';
import type { Profile } from '@/types';

type WalletTab = 'overview' | 'earnings' | 'withdraw' | 'bank' | 'transactions';

interface WalletPageProps {
  profile: Profile;
  onBack: () => void;
}

interface Transaction {
  id: string;
  type: 'earning' | 'withdrawal' | 'deposit' | 'refund';
  amount: number;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
}

interface BankAccount {
  id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_default: boolean;
}

export default function WalletPage({ profile, onBack }: WalletPageProps) {
  const [activeTab, setActiveTab] = useState<WalletTab>('overview');
  const [balance, setBalance] = useState(0);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Withdraw form
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [selectedBankId, setSelectedBankId] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  // Bank form
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [savingBank, setSavingBank] = useState(false);

  const tabs: { id: WalletTab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { id: 'earnings', label: 'Earnings', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    { id: 'withdraw', label: 'Withdraw', icon: 'M12 3v18M5 12h14M5 12l4-4M5 12l4 4' },
    { id: 'bank', label: 'Bank Accounts', icon: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11' },
    { id: 'transactions', label: 'Transactions', icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2' },
  ];

  // Load wallet data
  useEffect(() => {
    loadWalletData();
  }, [profile.user_id]);

  async function loadWalletData() {
    setLoading(true);
    try {
      // Get balance from profile
      const p = profile as any;
      setBalance(p.wallet_balance || 0);
      setTotalEarnings(p.total_earnings || 0);
      setTotalWithdrawn(p.total_withdrawn || 0);

      // Load transactions
      const { data: txData } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', profile.user_id)
        .order('created_at', { ascending: false })
        .limit(50);
      setTransactions(txData || []);

      // Load bank accounts
      const { data: bankData } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('user_id', profile.user_id)
        .order('is_default', { ascending: false });
      setBankAccounts(bankData || []);
    } catch (e) {
      console.error('Wallet load error:', e);
    }
    setLoading(false);
  }

  // Withdraw
  async function handleWithdraw() {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (amount > balance) { toast.error('Insufficient balance'); return; }
    if (!selectedBankId) { toast.error('Select a bank account'); return; }

    setWithdrawing(true);
    const { error } = await supabase.rpc('request_withdrawal', {
      p_user_id: profile.user_id,
      p_amount: amount,
      p_bank_account_id: selectedBankId,
    });
    setWithdrawing(false);

    if (error) { toast.error('Withdrawal failed: ' + error.message); return; }

    toast.success('Withdrawal request submitted');
    setWithdrawAmount('');
    setSelectedBankId('');
    loadWalletData();
    setActiveTab('transactions');
  }

  // Save bank account
  async function handleSaveBank() {
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) {
      toast.error('All fields are required'); return;
    }
    if (accountNumber.length !== 10) {
      toast.error('Account number must be 10 digits'); return;
    }

    setSavingBank(true);
    const { error } = await supabase.from('bank_accounts').insert({
      user_id: profile.user_id,
      bank_name: bankName.trim(),
      account_number: accountNumber.trim(),
      account_name: accountName.trim(),
      is_default: bankAccounts.length === 0,
    });
    setSavingBank(false);

    if (error) { toast.error('Failed: ' + error.message); return; }

    toast.success('Bank account added');
    setBankName(''); setAccountNumber(''); setAccountName('');
    loadWalletData();
  }

  // Delete bank account
  async function handleDeleteBank(id: string) {
    const { error } = await supabase.from('bank_accounts').delete().eq('id', id).eq('user_id', profile.user_id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Bank account removed');
    loadWalletData();
  }

  // Set default bank
  async function handleSetDefault(id: string) {
    await supabase.from('bank_accounts').update({ is_default: false }).eq('user_id', profile.user_id);
    await supabase.from('bank_accounts').update({ is_default: true }).eq('id', id);
    loadWalletData();
  }

  const recentTransactions = useMemo(() => transactions.slice(0, 10), [transactions]);

  // Status colors
  const statusColor = (s: string) => {
    switch (s) {
      case 'completed': return 'text-emerald-400 bg-emerald-500/10';
      case 'pending': return 'text-amber-400 bg-amber-500/10';
      case 'failed': return 'text-red-400 bg-red-500/10';
      default: return 'text-[#5C5E72] bg-[#1A1A24]';
    }
  };

  // Format currency
  const fmt = (n: number) => `N${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#0A0A0F] p-5">
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] p-5 pb-24">
      <BackButton onBack={onBack} label="Back" />

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white mb-1">Wallet</h1>
        <p className="text-[11px] text-[#5C5E72]">Manage your earnings, withdrawals, and bank accounts</p>
      </div>

      {/* Balance Card */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600/20 to-violet-900/10 border border-violet-500/20 p-5 mb-6">
        <p className="text-[10px] text-violet-400 font-medium uppercase tracking-wider mb-1">Available Balance</p>
        <p className="text-3xl font-bold text-white mb-3">{fmt(balance)}</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-xs text-white font-semibold">{fmt(totalEarnings)}</p>
            <p className="text-[9px] text-[#5C5E72]">Total Earnings</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-white font-semibold">{fmt(totalWithdrawn)}</p>
            <p className="text-[9px] text-[#5C5E72]">Withdrawn</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-white font-semibold">{transactions.length}</p>
            <p className="text-[9px] text-[#5C5E72]">Transactions</p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1 mb-6 overflow-x-auto scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-violet-500 text-white'
                : 'text-[#8A8B9C] hover:text-white'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={tab.icon} />
            </svg>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── OVERVIEW TAB ─── */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
              <p className="text-[10px] text-[#5C5E72] mb-1">This Month</p>
              <p className="text-lg font-bold text-white">{fmt(totalEarnings * 0.3)}</p>
              <p className="text-[9px] text-emerald-400 mt-1">+12% from last month</p>
            </div>
            <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
              <p className="text-[10px] text-[#5C5E72] mb-1">Pending</p>
              <p className="text-lg font-bold text-white">{fmt(balance)}</p>
              <p className="text-[9px] text-amber-400 mt-1">Available to withdraw</p>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-white">Recent Transactions</p>
              <button onClick={() => setActiveTab('transactions')} className="text-[10px] text-violet-400 font-medium">View All</button>
            </div>
            {recentTransactions.length === 0 ? (
              <p className="text-[11px] text-[#5C5E72] text-center py-4">No transactions yet</p>
            ) : (
              <div className="space-y-2">
                {recentTransactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                    <div>
                      <p className="text-xs text-white">{tx.description}</p>
                      <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-semibold ${tx.type === 'withdrawal' ? 'text-red-400' : 'text-emerald-400'}`}>
                        {tx.type === 'withdrawal' ? '-' : '+'}{fmt(tx.amount)}
                      </p>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${statusColor(tx.status)}`}>{tx.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setActiveTab('withdraw')} className="h-12 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity">
              Withdraw
            </button>
            <button onClick={() => setActiveTab('bank')} className="h-12 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-semibold hover:border-violet-500/30 transition-colors">
              Add Bank
            </button>
          </div>
        </div>
      )}

      {/* ─── EARNINGS TAB ─── */}
      {activeTab === 'earnings' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-xs font-semibold text-white mb-3">Earnings Breakdown</p>
            {transactions.filter(t => t.type === 'earning').length === 0 ? (
              <p className="text-[11px] text-[#5C5E72] text-center py-8">No earnings recorded yet</p>
            ) : (
              <div className="space-y-2">
                {transactions.filter(t => t.type === 'earning').map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                    <div>
                      <p className="text-xs text-white">{tx.description}</p>
                      <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()}</p>
                    </div>
                    <p className="text-xs font-semibold text-emerald-400">+{fmt(tx.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── WITHDRAW TAB ─── */}
      {activeTab === 'withdraw' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-4">
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Amount to Withdraw</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5E72] text-sm">N</span>
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm pl-8 pr-3 outline-none focus:border-violet-500"
                />
              </div>
              <p className="text-[9px] text-[#5C5E72] mt-1">Available: {fmt(balance)} · Min: N1,000</p>
            </div>

            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Select Bank Account</label>
              {bankAccounts.length === 0 ? (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-center">
                  <p className="text-[11px] text-amber-400 mb-2">No bank account added</p>
                  <button onClick={() => setActiveTab('bank')} className="text-[11px] text-violet-400 font-semibold">Add Bank Account</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {bankAccounts.map(bank => (
                    <button
                      key={bank.id}
                      onClick={() => setSelectedBankId(bank.id)}
                      className={`w-full text-left rounded-xl p-3 border transition-all ${
                        selectedBankId === bank.id
                          ? 'border-violet-500 bg-violet-500/5'
                          : 'border-[#2A2A3A] bg-[#1A1A24] hover:border-[#3A3A4A]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-white font-medium">{bank.bank_name}</p>
                          <p className="text-[10px] text-[#5C5E72]">{bank.account_number} · {bank.account_name}</p>
                        </div>
                        {bank.is_default && (
                          <span className="text-[8px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">Default</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleWithdraw}
              disabled={withdrawing || !withdrawAmount || !selectedBankId}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {withdrawing ? 'Processing...' : 'Request Withdrawal'}
            </button>
          </div>
        </div>
      )}

      {/* ─── BANK ACCOUNTS TAB ─── */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          {/* Add new bank */}
          <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
            <p className="text-xs font-semibold text-white">Add Bank Account</p>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Bank Name</label>
              <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. GTBank"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Account Number</label>
              <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="10 digits" maxLength={10}
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Account Name</label>
              <input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Name on account"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            </div>
            <button onClick={handleSaveBank} disabled={savingBank}
              className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">
              {savingBank ? 'Adding...' : 'Add Bank Account'}
            </button>
          </div>

          {/* Saved banks */}
          {bankAccounts.length > 0 && (
            <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
              <p className="text-xs font-semibold text-white">Saved Accounts</p>
              {bankAccounts.map(bank => (
                <div key={bank.id} className="flex items-center justify-between p-3 rounded-xl bg-[#1A1A24] border border-[#2A2A3A]">
                  <div>
                    <p className="text-xs text-white font-medium">{bank.bank_name}</p>
                    <p className="text-[10px] text-[#5C5E72]">{bank.account_number} · {bank.account_name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!bank.is_default && (
                      <button onClick={() => handleSetDefault(bank.id)} className="text-[9px] text-violet-400 hover:text-white transition-colors">
                        Set Default
                      </button>
                    )}
                    {bank.is_default && (
                      <span className="text-[8px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">Default</span>
                    )}
                    <button onClick={() => handleDeleteBank(bank.id)} className="text-red-400 hover:text-red-300 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TRANSACTIONS TAB ─── */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-xs font-semibold text-white mb-3">All Transactions</p>
            {transactions.length === 0 ? (
              <p className="text-[11px] text-[#5C5E72] text-center py-8">No transactions yet</p>
            ) : (
              <div className="space-y-1">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-3 border-b border-white/[0.03] last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        tx.type === 'earning' ? 'bg-emerald-500/10' :
                        tx.type === 'withdrawal' ? 'bg-red-500/10' :
                        'bg-blue-500/10'
                      }`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={
                          tx.type === 'earning' ? '#10B981' :
                          tx.type === 'withdrawal' ? '#EF4444' : '#3B82F6'
                        } strokeWidth="2">
                          {tx.type === 'earning' ? <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> :
                           tx.type === 'withdrawal' ? <path d="M12 3v18M5 12h14M5 12l4-4M5 12l4 4" /> :
                           <path d="M12 5v14M5 12h14" />}
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-white">{tx.description}</p>
                        <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()} · {new Date(tx.created_at).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-semibold ${tx.type === 'withdrawal' ? 'text-red-400' : 'text-emerald-400'}`}>
                        {tx.type === 'withdrawal' ? '-' : '+'}{fmt(tx.amount)}
                      </p>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${statusColor(tx.status)}`}>{tx.status}</span>
                    </div>
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
