import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface FinanceDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

interface FinanceSummary {
  total_revenue: number;
  total_commission: number;
  total_worker_earnings: number;
  total_partner_earnings: number;
  total_withdrawn: number;
  pending_withdrawals: number;
  escrow_holding: number;
  failed_payouts: number;
  total_refunds: number;
}

interface WithdrawalRequest {
  id: string;
  user_id: string;
  username: string;
  user_role: string;
  amount_requested: number;
  withdrawal_fee: number;
  amount_paid: number;
  status: string;
  bank_name: string;
  bank_account_number: string;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

type FinanceTab = 'overview' | 'payments' | 'commissions' | 'withdrawals' | 'refunds' | 'escrow' | 'audit';

export default function FinanceDashboard({ profile, onLogout }: FinanceDashboardProps) {
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [withdrawalFilter, setWithdrawalFilter] = useState<string>('all');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month');

  useEffect(() => { loadData(); }, [period]);

  async function loadData() {
    await Promise.all([loadSummary(), loadWithdrawals()]);
  }

  async function loadSummary() {
    let startDate: string | null = null;
    const now = new Date();
    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString();
    } else if (period === 'month') {
      const d = new Date(now); d.setMonth(d.getMonth() - 1); startDate = d.toISOString();
    }

    const { data, error } = await supabase.rpc('get_platform_finance_summary', {
      p_start_date: startDate,
      p_end_date: null,
    });
    if (!error && data) {
      const s = typeof data === 'string' ? JSON.parse(data) : data;
      setSummary(s);
    }
  }

  async function loadWithdrawals() {
    const status = withdrawalFilter === 'all' ? null : withdrawalFilter;
    const { data, error } = await supabase.rpc('get_withdrawal_requests', {
      p_status: status,
      p_limit: 50,
    });
    if (!error && data) {
      setWithdrawals(data || []);
    }
  }

  async function handleFreezeWallet(userId: string, freeze: boolean) {
    const reason = freeze ? prompt('Reason for freezing:') : null;
    if (freeze && !reason) return;
    const { error } = await supabase.rpc('set_wallet_frozen', {
      p_user_id: userId,
      p_frozen: freeze,
      p_reason: reason,
      p_frozen_by: profile.user_id,
    });
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success(freeze ? 'Wallet frozen' : 'Wallet unfrozen');
    loadWithdrawals();
  }

  async function handleRetryWithdrawal(requestId: string) {
    const { error } = await supabase.rpc('complete_withdrawal', {
      p_request_id: requestId,
      p_status: 'retrying',
    });
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Marked for retry');
    loadWithdrawals();
  }

  const formatN = (n: number) => `N${Number(n || 0).toLocaleString()}`;
  const statusColor = (s: string) => {
    switch (s) {
      case 'paid': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'pending': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'processing': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'failed': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'rejected': return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
      default: return 'text-[#5C5E72] bg-[#12121A] border-[#1E1E2C]';
    }
  };

  const tabs: { id: FinanceTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'payments', label: 'Payments' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'refunds', label: 'Refunds' },
    { id: 'escrow', label: 'Escrow' },
    { id: 'audit', label: 'Audit' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <header className="px-5 pt-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-white">Finance Dashboard</h1>
            <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
          </div>
          <button onClick={onLogout} className="h-9 px-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-[#5C5E72] hover:text-red-400 text-[11px]">
            Logout
          </button>
        </div>

        {/* Period selector */}
        <div className="flex gap-1.5">
          {(['today', 'week', 'month', 'all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${
                period === p ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#12121A] text-[#5C5E72]'
              }`}>
              {p === 'all' ? 'All Time' : p}
            </button>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto px-5 pb-3 scrollbar-hide">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              activeTab === t.id ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#12121A] text-[#5C5E72]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-5 space-y-4">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && summary && (
          <>
            {/* Revenue Cards */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Total Revenue', value: formatN(summary.total_revenue), color: 'text-emerald-400' },
                { label: 'Commission Earned', value: formatN(summary.total_commission), color: 'text-blue-400' },
                { label: 'Worker Earnings', value: formatN(summary.total_worker_earnings), color: 'text-purple-400' },
                { label: 'Partner Earnings', value: formatN(summary.total_partner_earnings), color: 'text-pink-400' },
              ].map(card => (
                <div key={card.label} className="glass rounded-xl p-3">
                  <p className="text-[9px] text-[#5C5E72] uppercase tracking-wider">{card.label}</p>
                  <p className={`text-sm font-bold ${card.color} mt-1`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Escrow Holding', value: formatN(summary.escrow_holding), alert: summary.escrow_holding > 0 },
                { label: 'Pending Withdrawals', value: formatN(summary.pending_withdrawals), alert: summary.pending_withdrawals > 0 },
                { label: 'Failed Payouts', value: formatN(summary.failed_payouts), alert: summary.failed_payouts > 0 },
              ].map(card => (
                <div key={card.label} className={`rounded-xl p-2.5 text-center border ${
                  card.alert ? 'bg-red-500/5 border-red-500/20' : 'bg-[#12121A] border-[#1E1E2C]'
                }`}>
                  <p className={`text-[11px] font-bold ${card.alert ? 'text-red-400' : 'text-white'}`}>{card.value}</p>
                  <p className="text-[8px] text-[#5C5E72] mt-0.5">{card.label}</p>
                </div>
              ))}
            </div>

            {/* Withdrawal Summary */}
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-white">Recent Withdrawals</h3>
                <button onClick={() => setActiveTab('withdrawals')} className="text-[10px] text-[#3B82F6]">View All</button>
              </div>
              {withdrawals.slice(0, 5).map(w => (
                <div key={w.id} className="flex items-center justify-between py-2 border-b border-[#1E1E2C] last:border-0">
                  <div>
                    <p className="text-[11px] text-white font-medium">@{w.username}</p>
                    <p className="text-[9px] text-[#5C5E72]">{w.bank_name} •••{w.bank_account_number?.slice(-4)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-white font-semibold">{formatN(w.amount_requested)}</p>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full border ${statusColor(w.status)}`}>{w.status}</span>
                  </div>
                </div>
              ))}
              {withdrawals.length === 0 && <p className="text-[10px] text-[#5C5E72] text-center py-4">No withdrawals yet</p>}
            </div>
          </>
        )}

        {/* WITHDRAWALS TAB */}
        {activeTab === 'withdrawals' && (
          <>
            {/* Filters */}
            <div className="flex gap-1.5 flex-wrap">
              {['all', 'pending', 'processing', 'paid', 'failed', 'rejected'].map(f => (
                <button key={f} onClick={() => { setWithdrawalFilter(f); loadWithdrawals(); }}
                  className={`px-3 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${
                    withdrawalFilter === f ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#12121A] text-[#5C5E72]'
                  }`}>
                  {f}
                </button>
              ))}
            </div>

            {/* Withdrawal List */}
            <div className="space-y-2">
              {withdrawals.map(w => (
                <div key={w.id} className="glass rounded-xl p-3.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-white">@{w.username}</p>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6]">{w.user_role}</span>
                      </div>
                      <p className="text-[10px] text-[#5C5E72] mt-0.5">{w.bank_name} •••{w.bank_account_number?.slice(-4)}</p>
                      <p className="text-[9px] text-[#5C5E72]">{new Date(w.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">{formatN(w.amount_requested)}</p>
                      <p className="text-[9px] text-[#5C5E72]">Fee: {formatN(w.withdrawal_fee)}</p>
                      <p className="text-[9px] text-emerald-400">Net: {formatN(w.amount_paid)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#1E1E2C]">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border ${statusColor(w.status)}`}>{w.status}</span>
                    <div className="flex gap-1.5">
                      {w.status === 'failed' && (
                        <button onClick={() => handleRetryWithdrawal(w.id)}
                          className="text-[9px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          Retry
                        </button>
                      )}
                      <button onClick={() => handleFreezeWallet(w.user_id, true)}
                        className="text-[9px] px-2 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
                        Freeze Wallet
                      </button>
                    </div>
                  </div>
                  {w.failure_reason && (
                    <p className="text-[9px] text-red-400 mt-1">{w.failure_reason}</p>
                  )}
                </div>
              ))}
              {withdrawals.length === 0 && (
                <p className="text-[11px] text-[#5C5E72] text-center py-10">No withdrawal requests found</p>
              )}
            </div>
          </>
        )}

        {/* COMMISSIONS TAB */}
        {activeTab === 'commissions' && (
          <div className="text-center py-20">
            <p className="text-[11px] text-[#5C5E72]">Commission details coming soon</p>
          </div>
        )}

        {/* REFUNDS TAB */}
        {activeTab === 'refunds' && (
          <div className="text-center py-20">
            <p className="text-[11px] text-[#5C5E72]">Refund management coming soon</p>
          </div>
        )}

        {/* ESCROW TAB */}
        {activeTab === 'escrow' && (
          <div className="text-center py-20">
            <p className="text-[11px] text-[#5C5E72]">Escrow monitoring coming soon</p>
          </div>
        )}

        {/* AUDIT TAB */}
        {activeTab === 'audit' && (
          <div className="text-center py-20">
            <p className="text-[11px] text-[#5C5E72]">Audit log viewer coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}
