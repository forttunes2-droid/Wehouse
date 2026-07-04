import { useState, useEffect } from 'react';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import { supabase } from '@/lib/supabase';
// nigeria-locations import not needed in this version — location derived from inspection data
import SettingsTab from './SettingsTab';
import type { Profile, SupportTicket } from '@/types';
import { STAFF_PERMISSION_LABELS, TICKET_TYPE_LABELS, TICKET_STATUS_COLORS, TICKET_PRIORITY_COLORS } from '@/types';
import type { TicketStatus } from '@/types';
import { Toaster, toast } from 'sonner';

interface StaffDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onGoToChat: (convId?: string) => void;
  onNavigate?: (page: string) => void;
}

type StaffTab = 'overview' | 'operations' | 'finance' | 'support' | 'verification' | 'field_officer' | 'settings';

const TAB_ICONS: Record<StaffTab, string> = {
  overview: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  operations: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  finance: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  support: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  verification: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  field_officer: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
};

export default function StaffDashboard({ profile, onLogout, onGoToChat, onNavigate }: StaffDashboardProps) {
  const { permissions, loading: permsLoading, hasPermission } = useStaffPermissions(profile.user_id);
  const TAB_KEY = 'wh_staff_tab';
  const [activeTab, setActiveTab] = useState<StaffTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved && (
        saved === 'overview' || saved === 'settings' ||
        (saved === 'operations' && hasPermission('operations')) ||
        (saved === 'finance' && hasPermission('finance')) ||
        (saved === 'support' && hasPermission('support')) ||
        (saved === 'verification' && hasPermission('verification')) ||
        (saved === 'field_officer' && hasPermission('field_officer'))
      )) return saved as StaffTab;
    } catch { /* ignore */ }
    return 'overview';
  });

  const handleSetTab = (tab: StaffTab) => {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  };

  const availableTabs: StaffTab[] = ['overview'];
  if (hasPermission('operations')) availableTabs.push('operations');
  if (hasPermission('finance')) availableTabs.push('finance');
  if (hasPermission('support')) availableTabs.push('support');
  if (hasPermission('verification')) availableTabs.push('verification');
  if (hasPermission('field_officer')) availableTabs.push('field_officer');
  availableTabs.push('settings');

  if (permsLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      <Toaster position="top-center" richColors />

      {/* ═══ MODERN HEADER ═══ */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#0A0A0F] to-[#16213e]" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30" />
        <div className="relative px-5 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-blue-500/20">
                <span className="text-white font-bold text-sm">{(profile.username || profile.email)[0].toUpperCase()}</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-white">
                  {permissions.length > 0 ? permissions.map(p => STAFF_PERMISSION_LABELS[p]).join(' & ') : 'Staff Portal'}
                </h1>
                <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#5C5E72] hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/5 transition-all"
              title="Logout"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>

          {/* Stats Row */}
          <StaffStats profile={profile} permissions={permissions} />
        </div>
      </header>

      {/* ═══ MODERN TAB NAV ═══ */}
      <nav className="sticky top-0 z-40 bg-[#0A0A0F]/80 backdrop-blur-xl border-b border-white/[0.04] px-3 py-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {availableTabs.map(tab => (
            <button
              key={tab}
              onClick={() => handleSetTab(tab)}
              className={`flex-shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/25'
                  : 'text-[#5C5E72] hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={TAB_ICONS[tab]} />
              </svg>
              {tab === 'field_officer' ? 'Field' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </nav>

      {/* ═══ TAB CONTENT ═══ */}
      <main className="px-4 py-4">
        {activeTab === 'overview' && <OverviewModule profile={profile} permissions={permissions} onGoToChat={onGoToChat} onNavigate={onNavigate} onSetTab={handleSetTab} />}
        {activeTab === 'operations' && <OperationsModule profile={profile} />}
        {activeTab === 'finance' && <FinanceModule />}
        {activeTab === 'support' && <SupportModule profile={profile} onGoToChat={onGoToChat} />}
        {activeTab === 'verification' && <VerificationModule profile={profile} onGoToChat={onGoToChat} />}
        {activeTab === 'field_officer' && <FieldOfficerModule profile={profile} />}
        {activeTab === 'settings' && <SettingsTab profile={profile} onUpdate={() => {}} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════════════════

function StaffStats({ profile, permissions }: { profile: Profile; permissions: string[] }) {
  const [stats, setStats] = useState({ inspections: 0, tickets: 0, listings: 0, workers: 0 });

  useEffect(() => {
    async function load() {
      const promises = [];
      if (permissions.includes('field_officer')) {
        promises.push(supabase.from('user_inspection_requests').select('*', { count: 'exact', head: true }).eq('field_officer_id', profile.user_id).in('status', ['scheduled', 'in_progress']));
      }
      if (permissions.includes('support')) {
        promises.push(supabase.from('support_tickets').select('*', { count: 'exact', head: true }).eq('status', 'open'));
      }
      if (permissions.includes('operations')) {
        promises.push(supabase.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'pending_approval'));
      }
      if (permissions.includes('verification')) {
        promises.push(supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending'));
      }
      const results = await Promise.all(promises);
      const s: any = {};
      let idx = 0;
      if (permissions.includes('field_officer')) s.inspections = results[idx++]?.count || 0;
      if (permissions.includes('support')) s.tickets = results[idx++]?.count || 0;
      if (permissions.includes('operations')) s.listings = results[idx++]?.count || 0;
      if (permissions.includes('verification')) s.workers = results[idx++]?.count || 0;
      setStats(s);
    }
    load();
  }, [permissions, profile.user_id]);

  const statItems = [];
  if (permissions.includes('field_officer')) statItems.push({ label: 'Inspections', value: stats.inspections, color: 'from-blue-500 to-blue-600' });
  if (permissions.includes('support')) statItems.push({ label: 'Open Tickets', value: stats.tickets, color: 'from-amber-500 to-amber-600' });
  if (permissions.includes('operations')) statItems.push({ label: 'Pending', value: stats.listings, color: 'from-emerald-500 to-emerald-600' });
  if (permissions.includes('verification')) statItems.push({ label: 'To Review', value: stats.workers, color: 'from-purple-500 to-purple-600' });

  if (statItems.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {statItems.map(s => (
        <div key={s.label} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <p className="text-lg font-bold text-white">{s.value}</p>
          <p className="text-[10px] text-[#5C5E72]">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW MODULE
// ═══════════════════════════════════════════════════════════════

function OverviewModule({ profile, permissions, onGoToChat: _onGoToChat, onNavigate: _onNavigate, onSetTab }: {
  profile: Profile; permissions: string[]; onGoToChat: (c?: string) => void; onNavigate?: (p: string) => void; onSetTab: (t: StaffTab) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#5C5E72]">Welcome back, <span className="text-white font-medium">{profile.full_name || profile.username || 'Staff'}</span>. Here&apos;s your overview.</p>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        {permissions.includes('field_officer') && (
          <QuickCard icon="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" title="My Inspections" subtitle="View assigned inspections" color="from-blue-500 to-blue-600" onClick={() => onSetTab('field_officer')} />
        )}
        {permissions.includes('support') && (
          <QuickCard icon="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" title="Support Tickets" subtitle="Handle customer issues" color="from-amber-500 to-amber-600" onClick={() => onSetTab('support')} />
        )}
        {permissions.includes('operations') && (
          <QuickCard icon="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" title="Properties" subtitle="Review & manage listings" color="from-emerald-500 to-emerald-600" onClick={() => onSetTab('operations')} />
        )}
        {permissions.includes('verification') && (
          <QuickCard icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" title="Worker Review" subtitle="Approve worker applications" color="from-purple-500 to-purple-600" onClick={() => onSetTab('verification')} />
        )}
        {permissions.includes('finance') && (
          <QuickCard icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" title="Finance" subtitle="Payouts & commissions" color="from-rose-500 to-rose-600" onClick={() => onSetTab('finance')} />
        )}
      </div>
    </div>
  );
}

function QuickCard({ icon, title, subtitle, color, onClick }: { icon: string; title: string; subtitle: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 text-left hover:border-white/[0.12] hover:bg-white/[0.04] transition-all active:scale-[0.98]">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-3 shadow-lg`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </div>
      <p className="text-xs font-semibold text-white group-hover:text-blue-400 transition-colors">{title}</p>
      <p className="text-[10px] text-[#5C5E72] mt-0.5">{subtitle}</p>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// OPERATIONS MODULE
// ═══════════════════════════════════════════════════════════════

function OperationsModule({ profile }: { profile: Profile }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { loadListings(); }, [statusFilter]);

  async function loadListings() {
    setLoading(true);
    let query = supabase.from('listings').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data } = await query;
    setListings(data || []);
    setLoading(false);
  }

  async function approveListing(id: string) {
    const { error } = await supabase.from('listings').update({ status: 'available', approved_by: profile.user_id, approved_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Approved'); loadListings();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white">Property Management</p>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-[10px] px-2 outline-none">
          <option value="all">All</option>
          <option value="available">Live</option>
          <option value="pending_approval">Pending</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">No listings</p>
        </div>
      ) : (
        listings.map(l => (
          <div key={l.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 hover:border-white/[0.12] transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{l.title}</p>
                <p className="text-[10px] text-[#5C5E72]">{l.city}, {l.state} &middot; {l.bedrooms} bed &middot; N{l.price?.toLocaleString()}</p>
              </div>
              <span className={`text-[9px] px-2 py-1 rounded-full border ${
                l.status === 'available' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                l.status === 'pending_approval' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                'bg-red-500/10 text-red-400 border-red-500/20'
              }`}>{l.status}</span>
            </div>
            {l.status === 'pending_approval' && (
              <div className="mt-3">
                {rejectingId === l.id ? (
                  <div className="space-y-2">
                    <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection..." rows={2}
                      className="w-full rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 py-2 placeholder:text-[#5C5E72] outline-none focus:border-red-500 resize-none" />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="flex-1 h-8 rounded-lg bg-white/[0.03] text-[#5C5E72] text-[11px]">Cancel</button>
                      <button onClick={() => { if (!rejectReason.trim()) return; supabase.from('listings').update({ status: 'rejected', rejection_reason: rejectReason }).eq('id', l.id).then(() => { toast.success('Rejected'); setRejectingId(null); setRejectReason(''); loadListings(); }); }}
                        className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold">Reject</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => approveListing(l.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Approve</button>
                    <button onClick={() => setRejectingId(l.id)} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold">Reject</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FINANCE MODULE
// ═══════════════════════════════════════════════════════════════

function FinanceModule() {
  const [activeSubTab, setActiveSubTab] = useState<'payouts' | 'rules'>('payouts');
  const [payouts, setPayouts] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from('payouts').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(20),
      supabase.from('commission_rules').select('*').order('created_at', { ascending: false }),
    ]);
    setPayouts(p || []);
    setRules(r || []);
    setLoading(false);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1">
        {(['payouts', 'rules'] as const).map(t => (
          <button key={t} onClick={() => setActiveSubTab(t)}
            className={`flex-1 h-8 rounded-lg text-[11px] font-semibold transition-all ${activeSubTab === t ? 'bg-[#3B82F6] text-white' : 'text-[#5C5E72]'}`}>
            {t === 'payouts' ? 'Payouts' : 'Commission Rules'}
          </button>
        ))}
      </div>

      {activeSubTab === 'payouts' && (
        payouts.length === 0 ? <EmptyState icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" title="No payouts yet" /> : (
          <div className="space-y-2">
            {payouts.map(p => (
              <div key={p.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{(p as any).profiles?.full_name || 'Unknown'}</p>
                  <span className={`text-[9px] px-2 py-1 rounded-full ${p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{p.status}</span>
                </div>
                <p className="text-xs text-white font-bold mt-1">N{p.amount?.toLocaleString()}</p>
                <p className="text-[10px] text-[#5C5E72]">{p.period_start} to {p.period_end}</p>
              </div>
            ))}
          </div>
        )
      )}

      {activeSubTab === 'rules' && (
        rules.length === 0 ? <EmptyState icon="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" title="No commission rules" /> : (
          <div className="space-y-2">
            {rules.map(r => (
              <div key={r.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
                <p className="text-sm font-semibold text-white">{r.name}</p>
                <p className="text-[10px] text-[#5C5E72]">{r.description}</p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT MODULE
// ═══════════════════════════════════════════════════════════════

function SupportModule({ profile, onGoToChat: _onGoToChat }: { profile: Profile; onGoToChat: (c?: string) => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');

  useEffect(() => { loadTickets(); }, [statusFilter]);

  async function loadTickets() {
    setLoading(true);
    let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data } = await query.limit(30);
    setTickets(data || []);
    setLoading(false);
  }

  async function assignTicket(id: string) {
    const { error } = await supabase.from('support_tickets').update({ assigned_to: profile.user_id, status: 'in_progress' }).eq('id', id);
    if (error) toast.error('Failed');
    else { toast.success('Assigned to you'); loadTickets(); }
  }

  async function resolveTicket(id: string) {
    if (!resolveNotes.trim()) { toast.error('Enter notes'); return; }
    const { error } = await supabase.from('support_tickets').update({ status: 'resolved', resolution_notes: resolveNotes, resolved_at: new Date().toISOString(), resolved_by: profile.user_id }).eq('id', id);
    if (error) toast.error('Failed');
    else { toast.success('Resolved'); setResolvingId(null); setResolveNotes(''); loadTickets(); }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white">Tickets ({tickets.length})</p>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | 'all')} className="h-8 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-[10px] px-2 outline-none">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {tickets.length === 0 ? <EmptyState icon="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" title="No tickets" /> : (
        tickets.map(t => (
          <div key={t.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{t.subject}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${TICKET_STATUS_COLORS[t.status]}`}>{t.status}</span>
                </div>
                <p className="text-[10px] text-[#5C5E72] mt-1">{t.ticket_code} &middot; {TICKET_TYPE_LABELS[t.type]} &middot; <span className={TICKET_PRIORITY_COLORS[t.priority]}>{t.priority}</span></p>
                <p className="text-[11px] text-[#8A8B9C] mt-2">{t.description}</p>
              </div>
            </div>
            <div className="mt-3">
              {resolvingId === t.id ? (
                <div className="space-y-2">
                  <textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} placeholder="How was this resolved?" rows={2}
                    className="w-full rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 py-2 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6] resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => { setResolvingId(null); setResolveNotes(''); }} className="flex-1 h-8 rounded-lg bg-white/[0.03] text-[#5C5E72] text-[11px]">Cancel</button>
                    <button onClick={() => resolveTicket(t.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Submit</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {t.status === 'open' && <button onClick={() => assignTicket(t.id)} className="flex-1 h-8 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[11px] font-semibold">Assign to Me</button>}
                  {t.status === 'in_progress' && t.assigned_to === profile.user_id && <button onClick={() => setResolvingId(t.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Resolve</button>}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VERIFICATION MODULE
// ═══════════════════════════════════════════════════════════════

function VerificationModule({ profile: _profile, onGoToChat: _onGoToChat }: { profile: Profile; onGoToChat: (c?: string) => void }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'verified' | 'suspended' | 'all'>('pending');

  useEffect(() => { loadWorkers(); }, [filter]);

  async function loadWorkers() {
    setLoading(true);
    let query = supabase.from('profiles').select('*').eq('role', 'worker').order('created_at', { ascending: false });
    if (filter !== 'all') query = query.eq('worker_status', filter);
    const { data } = await query;
    setWorkers(data || []);
    setLoading(false);
  }

  async function setStatus(userId: string, status: 'verified' | 'suspended' | 'rejected') {
    const { error } = await supabase.from('profiles').update({ worker_status: status, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (error) { toast.error('Failed'); return; }
    toast.success(`Worker ${status}`);
    loadWorkers();
  }

  if (loading) return <LoadingSpinner />;

  const statusColors: Record<string, string> = { pending: 'bg-amber-500/10 text-amber-400', verified: 'bg-emerald-500/10 text-emerald-400', suspended: 'bg-red-500/10 text-red-400', rejected: 'bg-gray-500/10 text-gray-400' };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1">
        {(['pending', 'verified', 'suspended', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 h-8 rounded-lg text-[10px] font-semibold transition-all ${filter === f ? 'bg-[#3B82F6] text-white' : 'text-[#5C5E72]'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {workers.length === 0 ? <EmptyState icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" title={`No ${filter} workers`} /> : (
        workers.map(w => (
          <div key={w.user_id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-sm font-bold">
                {(w.full_name || w.username || 'W')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{w.full_name || w.username || '...'}</p>
                <p className="text-[10px] text-[#5C5E72]">{w.worker_occupation || 'No occupation'} &middot; {w.city || 'No location'}</p>
              </div>
              <span className={`text-[8px] px-2 py-1 rounded-full ${statusColors[w.worker_status] || ''}`}>{w.worker_status}</span>
            </div>
            {w.worker_bio && <p className="text-[10px] text-[#8A8B9C] mt-2 italic line-clamp-2">{w.worker_bio}</p>}
            <div className="flex gap-2 mt-3">
              {w.worker_status === 'pending' && (
                <>
                  <button onClick={() => setStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Approve</button>
                  <button onClick={() => setStatus(w.user_id, 'rejected')} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold">Reject</button>
                </>
              )}
              {w.worker_status === 'verified' && (
                <button onClick={() => setStatus(w.user_id, 'suspended')} className="flex-1 h-8 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-semibold">Suspend</button>
              )}
              {w.worker_status === 'suspended' && (
                <button onClick={() => setStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Reinstate</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FIELD OFFICER MODULE — WITH POST PROPERTY ON COMPLETED INSPECTIONS
// ═══════════════════════════════════════════════════════════════

function FieldOfficerModule({ profile }: { profile: Profile }) {
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [report, setReport] = useState('');
  const [condition, setCondition] = useState<'excellent' | 'good' | 'fair' | 'poor'>('good');
  // Post property from inspection
  const [postingForInspection, setPostingForInspection] = useState<string | null>(null);
  const [postSaving, setPostSaving] = useState(false);
  const [postImages, setPostImages] = useState<string[]>([]);
  const [postForm, setPostForm] = useState({ title: '', description: '', price: '', bedrooms: '1', bathrooms: '1', contactPhone: '' });

  useEffect(() => { loadInspections(); }, []);

  async function loadInspections() {
    setLoading(true);
    try {
      // Use RPC that bypasses RLS — field officers can always see their assignments
      const { data, error } = await supabase.rpc('get_my_inspections', {
        p_field_officer_id: profile.user_id,
      });
      if (error) {
        console.error('[get_my_inspections] error:', error);
        toast.error('Failed to load inspections: ' + error.message);
      }
      setInspections(data || []);
    } catch (e: any) {
      console.error('[loadInspections] exception:', e);
      toast.error('Error loading inspections');
    }
    setLoading(false);
  }

  async function startInspection(id: string, source: string = 'user') {
    const { data: success, error } = await supabase.rpc('update_inspection_status', {
      p_inspection_id: id,
      p_new_status: 'in_progress',
      p_source: source,
    });
    if (error || !success) { toast.error('Failed: ' + (error?.message || 'unknown')); return; }
    toast.success('Inspection started'); loadInspections();
  }

  async function completeInspection(id: string, source: string = 'user') {
    if (!report.trim()) { toast.error('Enter a report'); return; }
    const { data: success, error } = await supabase.rpc('update_inspection_status', {
      p_inspection_id: id,
      p_new_status: 'completed',
      p_source: source,
      p_report: report,
      p_condition: condition,
    });
    if (error || !success) { toast.error('Failed: ' + (error?.message || 'unknown')); return; }
    toast.success('Inspection completed');
    setCompletingId(null); setReport(''); loadInspections();
  }

  async function submitPostProperty(inspection: any) {
    if (!postForm.title.trim() || !postForm.price) { toast.error('Title and price required'); return; }
    setPostSaving(true);
    try {
      const { error } = await supabase.rpc('post_property_from_inspection', {
        p_data: {
          title: postForm.title.trim(),
          description: postForm.description.trim() || null,
          price: parseInt(postForm.price) || 0,
          state: inspection.property_state || inspection.listing_state || '',
          city: inspection.property_city || inspection.listing_city || '',
          address: inspection.property_address || inspection.listing_address || '',
          bedrooms: parseInt(postForm.bedrooms) || 1,
          bathrooms: parseInt(postForm.bathrooms) || 1,
          sub_type: 'short_let',
          images: postImages,
          contact_phone: postForm.contactPhone.trim() || null,
          owner_id: profile.user_id,
          partner_id: inspection._source === 'partner' ? inspection.owner_id : null,
        },
      });
      if (error) { toast.error('Failed: ' + error.message); setPostSaving(false); return; }
      toast.success('Property submitted for approval');
      setPostingForInspection(null);
      setPostForm({ title: '', description: '', price: '', bedrooms: '1', bathrooms: '1', contactPhone: '' });
      setPostImages([]);
    } catch (e: any) {
      toast.error('Error: ' + e.message);
    }
    setPostSaving(false);
  }

  async function uploadImage(file: File) {
    const path = `field_officer/${profile.user_id}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('listing-images').upload(path, file, { contentType: file.type });
    if (error) { toast.error('Upload failed'); return; }
    const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
    setPostImages(prev => [...prev, data.publicUrl]);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Inspections */}
      <h4 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">My Inspections ({inspections.length})</h4>

      {inspections.length === 0 ? <EmptyState icon="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" title="No inspections assigned" /> : (
        inspections.map(ins => (
          <div key={ins.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 hover:border-white/[0.1] transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{ins.listing_title || ins.property_address || 'Property Inspection'}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
                    ins.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                    ins.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' :
                    ins.status === 'scheduled' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>{ins.status}</span>
                </div>
                <p className="text-[10px] text-[#5C5E72] mt-0.5">{ins.listing_address || ins.property_address || 'No address'}{ins.listing_city || ins.property_city ? `, ${ins.listing_city || ins.property_city}` : ''}</p>
                <p className="text-[9px] text-[#5C5E72]">Code: {ins.inspection_code || ins.id?.slice(0, 8)}</p>
                {ins.contact_phone && <p className="text-[9px] text-[#5C5E72]">Phone: {ins.contact_phone}</p>}
              </div>
            </div>

            {/* Complete Form */}
            {completingId === ins.id ? (
              <div className="mt-3 space-y-2">
                <textarea value={report} onChange={e => setReport(e.target.value)} placeholder="Describe what you found during the inspection..." rows={3}
                  className="w-full rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 py-2 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6] resize-none" />
                <select value={condition} onChange={e => setCondition(e.target.value as any)}
                  className="w-full h-9 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 outline-none focus:border-[#3B82F6]">
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={() => { setCompletingId(null); setReport(''); }} className="flex-1 h-8 rounded-lg bg-white/[0.03] text-[#5C5E72] text-[11px]">Cancel</button>
                  <button onClick={() => completeInspection(ins.id, ins._source)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Submit Report</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-3">
                {ins.status === 'scheduled' && <button onClick={() => startInspection(ins.id, ins._source)} className="flex-1 h-8 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[11px] font-semibold">Start</button>}
                {ins.status === 'in_progress' && <button onClick={() => setCompletingId(ins.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Complete</button>}
                {ins.status === 'completed' && (
                  <button onClick={() => setPostingForInspection(ins.id)} className="flex-1 h-8 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-[11px] font-semibold flex items-center justify-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    Post This Property
                  </button>
                )}
              </div>
            )}

            {/* Post Property Form (appears inline for completed inspections) */}
            {postingForInspection === ins.id && (
              <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-[#3B82F6]/20 space-y-3">
                <p className="text-[11px] text-[#3B82F6] font-medium">Post the property you inspected</p>
                <input value={postForm.title} onChange={e => setPostForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Property title" className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 outline-none focus:border-[#3B82F6]" />
                <input value={postForm.price} onChange={e => setPostForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="Price (NGN)" type="text" inputMode="numeric" className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 outline-none focus:border-[#3B82F6]" />
                <textarea value={postForm.description} onChange={e => setPostForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Description" rows={2} className="w-full rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 py-2 outline-none focus:border-[#3B82F6] resize-none" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={postForm.contactPhone} onChange={e => setPostForm(f => ({ ...f, contactPhone: e.target.value }))}
                    placeholder="Contact phone" className="h-9 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-xs px-3 outline-none focus:border-[#3B82F6]" />
                  <div className="flex flex-wrap gap-1">
                    {postImages.map((img, i) => (
                      <div key={i} className="relative w-9 h-9 rounded-lg overflow-hidden">
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setPostImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-bl flex items-center justify-center text-white text-[7px]">&times;</button>
                      </div>
                    ))}
                    <label className="w-9 h-9 rounded-lg border border-dashed border-white/[0.15] flex items-center justify-center cursor-pointer hover:border-[#3B82F6]">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                      <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.currentTarget.value = ''; }} />
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPostingForInspection(null)} className="flex-1 h-8 rounded-lg bg-white/[0.03] text-[#5C5E72] text-[11px]">Cancel</button>
                  <button onClick={() => submitPostProperty(ins)} disabled={postSaving} className="flex-1 h-8 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-[11px] font-semibold disabled:opacity-40">
                    {postSaving ? 'Submitting...' : 'Submit for Approval'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </div>
      <p className="text-sm text-[#5C5E72]">{title}</p>
    </div>
  );
}
