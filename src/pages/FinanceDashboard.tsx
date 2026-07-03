import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getFinancialAuditLogs, getWorkerSystemStats } from '@/lib/supabase';
import type { Profile, EscrowTransaction, Withdrawal, FinancialAuditLog } from '@/types';
import { ESCROW_STATUS_LABELS, WITHDRAWAL_STATUS_LABELS, WITHDRAWAL_STATUS_COLORS } from '@/types';

interface FinanceDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

type FinanceTab = 'overview' | 'escrow' | 'withdrawals' | 'wallets' | 'audit' | 'workers';

export default function FinanceDashboard({ onLogout, onNavigate }: FinanceDashboardProps) {
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');

  const tabs: { id: FinanceTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'escrow', label: 'Escrow' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'wallets', label: 'Wallets' },
    { id: 'audit', label: 'Audit' },
    { id: 'workers', label: 'Workers' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      {/* Header */}
      <header className="bg-[#12121A] border-b border-[#1E1E2C] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onNavigate && (
              <button onClick={() => onNavigate('home')} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
            )}
            <div>
              <h1 className="text-sm font-bold text-white">Finance Monitor</h1>
              <p className="text-[10px] text-[#5C5E72]">View-only. All payouts are automatic.</p>
            </div>
          </div>
          <button onClick={onLogout} className="text-[10px] text-[#5C5E72] hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
            Logout
          </button>
        </div>
      </header>

      {/* Monitor-only badge */}
      <div className="mx-5 mt-3 px-3 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/10 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
        <p className="text-[10px] text-blue-400">Monitor-only mode. Payouts are processed automatically via Paystack.</p>
      </div>

      {/* Tabs */}
      <nav className="border-b border-[#1E1E2C] px-5 mt-3">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-[11px] font-medium whitespace-nowrap rounded-t-lg transition-all ${
                activeTab === tab.id
                  ? 'text-emerald-400 border-b-2 border-emerald-400'
                  : 'text-[#5C5E72] hover:text-[#8B8DA0]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="px-5 py-4 max-w-lg mx-auto">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'escrow' && <EscrowTab />}
        {activeTab === 'withdrawals' && <WithdrawalsTab />}
        {activeTab === 'wallets' && <WalletsTab />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'workers' && <WorkersTab />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════

function OverviewTab() {
  const [stats, setStats] = useState({
    totalEscrow: 0,
    releasedEscrow: 0,
    pendingEscrow: 0,
    totalWallets: 0,
    totalWalletBalance: 0,
    pendingWithdrawals: 0,
    totalWithdrawn: 0,
    totalAuditEvents: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [
        { data: escrow },
        { data: wallets },
        { data: withdrawals },
        { count: auditCount },
      ] = await Promise.all([
        supabase.from('escrow_transactions').select('status,gross_amount,net_amount'),
        supabase.from('wallets').select('available_balance,pending_balance,total_withdrawn'),
        supabase.from('withdrawals').select('status,amount'),
        supabase.from('financial_audit_logs').select('*', { count: 'exact', head: true }),
      ]);

      const held = escrow?.filter(e => e.status === 'held').reduce((s, e) => s + (e.gross_amount || 0), 0) || 0;
      const released = escrow?.filter(e => e.status === 'released').reduce((s, e) => s + (e.net_amount || 0), 0) || 0;
      const totalWalletBal = wallets?.reduce((s, w) => s + (w.available_balance || 0), 0) || 0;
      const totalWithdrawn = wallets?.reduce((s, w) => s + (w.total_withdrawn || 0), 0) || 0;
      const pendingWith = withdrawals?.filter(w => w.status === 'pending').reduce((s, w) => s + (w.amount || 0), 0) || 0;

      setStats({
        totalEscrow: (escrow || []).reduce((s, e) => s + (e.gross_amount || 0), 0),
        releasedEscrow: released,
        pendingEscrow: held,
        totalWallets: wallets?.length || 0,
        totalWalletBalance: totalWalletBal,
        pendingWithdrawals: pendingWith,
        totalWithdrawn: totalWithdrawn,
        totalAuditEvents: auditCount || 0,
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Escrow" value={`₦${stats.totalEscrow.toLocaleString()}`} color="blue" />
        <StatCard label="Released" value={`₦${stats.releasedEscrow.toLocaleString()}`} color="emerald" />
        <StatCard label="Wallet Balances" value={`₦${stats.totalWalletBalance.toLocaleString()}`} color="amber" />
        <StatCard label="Total Withdrawn" value={`₦${stats.totalWithdrawn.toLocaleString()}`} color="purple" />
      </div>

      {/* Escrow Status */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-white mb-3">Escrow Status</h3>
        <div className="space-y-2">
          <ProgressBar label="Released" value={stats.releasedEscrow} max={stats.totalEscrow} color="emerald" />
          <ProgressBar label="Held" value={stats.pendingEscrow} max={stats.totalEscrow} color="amber" />
        </div>
      </div>

      {/* Summary */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4 space-y-2">
        <h3 className="text-xs font-semibold text-white mb-2">Summary</h3>
        <InfoRow label="Active Wallets" value={stats.totalWallets.toString()} />
        <InfoRow label="Pending Withdrawals" value={`₦${stats.pendingWithdrawals.toLocaleString()}`} />
        <InfoRow label="Audit Events" value={stats.totalAuditEvents.toLocaleString()} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ESCROW TAB
// ═══════════════════════════════════════════════════════════════

function EscrowTab() {
  const [escrows, setEscrows] = useState<EscrowTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('escrow_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      setEscrows(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = filter === 'all' ? escrows : escrows.filter(e => e.status === filter);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Escrow Transactions</h3>
        <span className="text-[10px] text-[#5C5E72]">{escrows.length} total</span>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 flex-wrap">
        {['all', 'held', 'released', 'refunded', 'disputed'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${
              filter === f ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#12121A] text-[#5C5E72]'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No escrow transactions" />
      ) : (
        <div className="space-y-2">
          {filtered.map(e => (
            <div key={e.id} className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#5C5E72] font-mono">{e.reference}</span>
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                  e.status === 'released' ? 'bg-emerald-500/10 text-emerald-400' :
                  e.status === 'held' ? 'bg-amber-500/10 text-amber-400' :
                  e.status === 'refunded' ? 'bg-gray-500/10 text-gray-400' :
                  'bg-red-500/10 text-red-400'
                }`}>{ESCROW_STATUS_LABELS[e.status] || e.status}</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-[#5C5E72]">{e.transaction_type}</p>
                  <p className="text-[10px] text-[#5C5E72]">Gross: ₦{e.gross_amount.toLocaleString()} | Commission: ₦{e.wehouse_commission.toLocaleString()}</p>
                </div>
                <p className="text-xs font-medium text-emerald-400">Net: ₦{e.net_amount.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WITHDRAWALS TAB
// ═══════════════════════════════════════════════════════════════

function WithdrawalsTab() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('withdrawals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      setWithdrawals(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner />;

  const pending = withdrawals.filter(w => w.status === 'pending');
  const successful = withdrawals.filter(w => w.status === 'successful');
  const failed = withdrawals.filter(w => w.status === 'failed');

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-amber-400">{pending.length}</p>
          <p className="text-[9px] text-[#5C5E72]">Pending</p>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-emerald-400">{successful.length}</p>
          <p className="text-[9px] text-[#5C5E72]">Successful</p>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-red-400">{failed.length}</p>
          <p className="text-[9px] text-[#5C5E72]">Failed</p>
        </div>
      </div>

      {/* Withdrawals List */}
      <h3 className="text-xs font-semibold text-white">All Withdrawals</h3>
      {withdrawals.length === 0 ? (
        <EmptyState message="No withdrawals yet" />
      ) : (
        <div className="space-y-2">
          {withdrawals.map(w => (
            <div key={w.id} className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-white">₦{w.amount.toLocaleString()}</span>
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${WITHDRAWAL_STATUS_COLORS[w.status] || ''}`}>
                  {WITHDRAWAL_STATUS_LABELS[w.status] || w.status}
                </span>
              </div>
              <p className="text-[10px] text-[#5C5E72]">{w.bank_name} • {w.bank_account_number}</p>
              {w.failed_reason && <p className="text-[9px] text-red-400 mt-0.5">{w.failed_reason}</p>}
              <p className="text-[9px] text-[#3C3D4D] mt-0.5">{new Date(w.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WALLETS TAB
// ═══════════════════════════════════════════════════════════════

function WalletsTab() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('wallets')
        .select('*')
        .order('available_balance', { ascending: false })
        .limit(100);
      setWallets(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner />;

  const totalAvailable = wallets.reduce((s, w) => s + (w.available_balance || 0), 0);
  const totalPending = wallets.reduce((s, w) => s + (w.pending_balance || 0), 0);
  const totalFrozen = wallets.reduce((s, w) => s + (w.frozen_balance || 0), 0);

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-emerald-400">₦{totalAvailable.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72]">Available</p>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-amber-400">₦{totalPending.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72]">Pending</p>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-red-400">₦{totalFrozen.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72]">Frozen</p>
        </div>
      </div>

      {/* Wallet List */}
      <h3 className="text-xs font-semibold text-white">Wallets ({wallets.length})</h3>
      {wallets.length === 0 ? (
        <EmptyState message="No wallets yet" />
      ) : (
        <div className="space-y-2">
          {wallets.map(w => (
            <div key={w.id} className={`bg-[#12121A] border rounded-xl p-3 ${w.is_frozen ? 'border-red-500/30' : 'border-[#1E1E2C]'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#5C5E72]">{w.owner_type}</span>
                {w.is_frozen && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Frozen</span>}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-white">₦{(w.available_balance || 0).toLocaleString()}</p>
                <p className="text-[9px] text-[#5C5E72]">Withdrawn: ₦{(w.total_withdrawn || 0).toLocaleString()}</p>
              </div>
              {w.bank_name && <p className="text-[9px] text-[#5C5E72] mt-0.5">{w.bank_name} • {w.bank_account_number}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIT TAB
// ═══════════════════════════════════════════════════════════════

function AuditTab() {
  const [logs, setLogs] = useState<FinancialAuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { logs: data } = await getFinancialAuditLogs({ limit: 100 });
      setLogs(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Audit Log</h3>
        <span className="text-[10px] text-[#5C5E72]">{logs.length} events</span>
      </div>

      {logs.length === 0 ? (
        <EmptyState message="No audit events yet" />
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#3B82F6] font-medium">{log.event_type.replace(/_/g, ' ')}</span>
                <span className="text-[9px] text-[#5C5E72]">{new Date(log.created_at).toLocaleDateString()}</span>
              </div>
              {log.description && <p className="text-[10px] text-[#8B8DA0]">{log.description}</p>}
              {log.amount && <p className="text-[10px] text-emerald-400">₦{log.amount.toLocaleString()}</p>}
              {log.reference_id && <p className="text-[9px] text-[#3C3D4D] font-mono mt-0.5">{log.reference_id}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WORKERS TAB
// ═══════════════════════════════════════════════════════════════

function WorkersTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getWorkerSystemStats();
      setStats(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-white">Worker System Stats</h3>

      {/* Worker counts */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-2.5 text-center">
          <p className="text-sm font-bold text-white">{stats.workers.total}</p>
          <p className="text-[8px] text-[#5C5E72]">Total</p>
        </div>
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-2.5 text-center">
          <p className="text-sm font-bold text-amber-400">{stats.workers.pending}</p>
          <p className="text-[8px] text-[#5C5E72]">Pending</p>
        </div>
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-2.5 text-center">
          <p className="text-sm font-bold text-emerald-400">{stats.workers.verified}</p>
          <p className="text-[8px] text-[#5C5E72]">Verified</p>
        </div>
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-2.5 text-center">
          <p className="text-sm font-bold text-red-400">{stats.workers.suspended}</p>
          <p className="text-[8px] text-[#5C5E72]">Suspended</p>
        </div>
      </div>

      {/* Verifications */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <p className="text-[10px] text-[#5C5E72] mb-2">Verifications</p>
        <div className="space-y-1.5">
          <InfoRow label="Pending Review" value={stats.verifications.pending.toString()} />
          <InfoRow label="Under Review" value={stats.verifications.under_review.toString()} />
          <InfoRow label="Approved" value={stats.verifications.approved.toString()} />
          <InfoRow label="Rejected" value={stats.verifications.rejected.toString()} />
        </div>
      </div>

      {/* Blue Badges */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4">
        <p className="text-[10px] text-blue-400 mb-1">Blue Badge Subscriptions</p>
        <p className="text-lg font-bold text-white">{stats.blueBadges.active} active</p>
        <p className="text-[9px] text-[#5C5E72]">of {stats.blueBadges.total} total subscriptions</p>
      </div>

      {/* Wallets */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <p className="text-[10px] text-[#5C5E72] mb-2">Worker Wallets</p>
        <div className="space-y-1.5">
          <InfoRow label="Total Balance" value={`₦${stats.wallets.totalBalance.toLocaleString()}`} />
          <InfoRow label="Worker Wallets" value={stats.wallets.workerWallets.toString()} />
          <InfoRow label="Partner Wallets" value={stats.wallets.partnerWallets.toString()} />
        </div>
      </div>

      {/* Withdrawals */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <p className="text-[10px] text-[#5C5E72] mb-2">Withdrawals</p>
        <div className="space-y-1.5">
          <InfoRow label="Pending" value={stats.withdrawals.pending.toString()} />
          <InfoRow label="Total Paid Out" value={`₦${stats.withdrawals.totalAmount.toLocaleString()}`} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/20',
    emerald: 'border-emerald-500/20',
    amber: 'border-amber-500/20',
    purple: 'border-purple-500/20',
  };
  return (
    <div className={`bg-[#12121A] border ${colorMap[color] || 'border-[#1E1E2C]'} rounded-2xl p-4`}>
      <p className="text-[10px] text-[#5C5E72]">{label}</p>
      <p className="text-sm font-bold text-white mt-1">{value}</p>
    </div>
  );
}

function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    blue: 'bg-blue-500',
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#5C5E72]">{label}</span>
        <span className="text-[10px] text-white">₦{value.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="h-1.5 bg-[#1E1E2C] rounded-full overflow-hidden">
        <div className={`h-full ${colorMap[color] || 'bg-[#3B82F6]'} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-[#5C5E72]">{label}</span>
      <span className="text-[11px] text-white font-medium">{value}</span>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-10">
      <p className="text-sm text-[#5C5E72]">{message}</p>
    </div>
  );
}
