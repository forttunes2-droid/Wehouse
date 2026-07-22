import { useState, useEffect } from 'react';
import type { Profile } from '@/types';
import { supabase } from '@/lib/supabase';
import { Toaster } from 'sonner';

type AnTab = 'overview' | 'activity' | 'reports';

interface AnalyticsData {
  totalRevenue: number;
  activeUsers: number;
  totalBookings: number;
  totalListings: number;
  totalWorkers: number;
  totalPartners: number;
  pendingVerifications: number;
  pendingInspections: number;
  loading: boolean;
}

// ─── Activity Tab ──────────────────────────────────────────
function ActivityTab({ isCreator, isAdmin }: { isCreator: boolean; isAdmin: boolean }) {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('audit_logs')
        .select('action, target_type, target_id, admin_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      setActivities(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const actionColor = (action: string) => {
    if (action === 'UPDATE' || action === 'ROLE_CHANGE') return 'text-blue-400';
    if (action === 'INSERT') return 'text-emerald-400';
    if (action === 'DELETE' || action === 'BAN' || action === 'SUSPEND') return 'text-red-400';
    return 'text-[#5C5E72]';
  };

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">
        Recent Platform Activity
      </p>
      {loading && (
        <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
          <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          Loading activity...
        </div>
      )}
      {!loading && activities.length === 0 && (
        <div className="text-center py-10">
          <p className="text-sm text-[#5C5E72]">No activity recorded yet</p>
          <p className="text-[10px] text-[#5C5E72]/70 mt-1">Actions appear here when settings are changed or users are managed</p>
        </div>
      )}
      {!loading && activities.map((a, i) => (
        <div key={i} className="glass rounded-xl p-3 border border-white/[0.04] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#12121A] flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={a.action === 'UPDATE' ? '#3B82F6' : a.action === 'INSERT' ? '#10B981' : '#EF4444'} strokeWidth="2">
              {a.action === 'UPDATE' ? <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></> :
               a.action === 'INSERT' ? <><path d="M12 5v14M5 12h14" /></> :
               <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>}
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white">
              <span className={actionColor(a.action)}>{a.action}</span>
              {' '}<span className="text-[#5C5E72]">&middot;</span>{' '}
              <span className="text-[#8A8B9C]">{a.target_type}</span>
              {a.target_id && <><span className="text-[#5C5E72]"> &middot; </span><span className="text-[#8A8B9C] truncate">{a.target_id}</span></>}
            </p>
            <p className="text-[9px] text-[#5C5E72] mt-0.5">
              {new Date(a.created_at).toLocaleString()}
              {a.admin_id && <span> &middot; by {a.admin_id.slice(-6)}</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Reports Tab ──────────────────────────────────────────
function ReportsTab({ isCreator }: { isCreator: boolean }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      // Load platform reports data
      const [{ data: rData }, { data: uData }, { data: wData }] = await Promise.all([
        supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('profiles').select('role, created_at').is('deleted_at', null),
        supabase.from('worker_verifications').select('status, created_at'),
      ]);

      const roleBreakdown: Record<string, number> = {};
      (uData || []).forEach((u: any) => { roleBreakdown[u.role] = (roleBreakdown[u.role] || 0) + 1; });

      const verifStatus: Record<string, number> = {};
      (wData || []).forEach((w: any) => { verifStatus[w.status] = (verifStatus[w.status] || 0) + 1; });

      setReports([
        { type: 'summary', roleBreakdown, verifStatus, totalUsers: uData?.length || 0 },
        { type: 'list', items: rData || [] },
      ]);
      setLoading(false);
    }
    load();
  }, []);

  const summary = reports.find((r: any) => r.type === 'summary');
  const list = reports.find((r: any) => r.type === 'list');

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Total Users</p>
            <p className="text-xl font-bold text-white mt-1">{summary.totalUsers}</p>
          </div>
          {Object.entries(summary.roleBreakdown || {}).map(([role, count]) => (
            <div key={role} className="glass rounded-2xl p-4 border border-white/[0.06]">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">{role.replace(/_/g, ' ')}</p>
              <p className="text-xl font-bold text-white mt-1">{count as number}</p>
            </div>
          ))}
          {Object.entries(summary.verifStatus || {}).map(([status, count]) => (
            <div key={status} className="glass rounded-2xl p-4 border border-white/[0.06]">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">{status}</p>
              <p className={`text-xl font-bold mt-1 ${status === 'approved' ? 'text-emerald-400' : status === 'pending' ? 'text-amber-400' : 'text-white'}`}>{count as number}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reports List */}
      <div>
        <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">
          Recent Reports
        </p>
        {loading && (
          <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
            <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
            Loading reports...
          </div>
        )}
        {!loading && (!list || list.items.length === 0) && (
          <div className="text-center py-8">
            <p className="text-sm text-[#5C5E72]">No reports filed</p>
          </div>
        )}
        {!loading && list?.items.map((r: any, i: number) => (
          <div key={i} className="glass rounded-xl p-3 border border-white/[0.04] mb-2">
            <p className="text-xs text-white">{r.reason || 'No reason'}</p>
            <p className="text-[9px] text-[#5C5E72] mt-1">
              Status: <span className={r.status === 'open' ? 'text-amber-400' : r.status === 'resolved' ? 'text-emerald-400' : 'text-[#5C5E72]'}>{r.status}</span>
              {' '} &middot; {new Date(r.created_at).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage({ profile }: { profile: Profile | null }) {
  const [activeTab, setActiveTab] = useState<AnTab>('overview');
  const [data, setData] = useState<AnalyticsData>({
    totalRevenue: 0,
    activeUsers: 0,
    totalBookings: 0,
    totalListings: 0,
    totalWorkers: 0,
    totalPartners: 0,
    pendingVerifications: 0,
    pendingInspections: 0,
    loading: true,
  });

  const role = profile?.role || '';
  const isCreator = role === 'creator';
  const isAdmin = role === 'admin';

  // Determine tabs based on role
  const getTabs = () => {
    if (isCreator) {
      return [
        { id: 'overview' as AnTab, label: 'Overview' },
        { id: 'activity' as AnTab, label: 'Activity' },
        { id: 'reports' as AnTab, label: 'Reports' },
      ];
    }
    if (isAdmin) {
      return [
        { id: 'overview' as AnTab, label: 'Overview' },
        { id: 'activity' as AnTab, label: 'Activity' },
        { id: 'reports' as AnTab, label: 'Reports' },
      ];
    }
    // Staff — only activity relevant to their modules
    return [
      { id: 'overview' as AnTab, label: 'Overview' },
      { id: 'activity' as AnTab, label: 'Activity' },
    ];
  };

  const tabs = getTabs();

  useEffect(() => {
    async function loadStats() {
      const promises: any[] = [];

      // Active Users — count non-deleted users (all roles see this)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'user')
          .is('deleted_at', null)
      );

      // Total Listings (all roles see this)
      promises.push(
        supabase
          .from('listings')
          .select('*', { count: 'exact', head: true })
          .is('deleted_at', null)
      );

      // Total Bookings (all roles see this)
      promises.push(
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
      );

      // Total Workers (all roles see this)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'worker')
          .is('deleted_at', null)
      );

      // Total Partners (all roles see this)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'property_partner')
          .is('deleted_at', null)
      );

      // Pending Verifications (workers pending approval)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'worker')
          .eq('worker_status', 'pending')
          .is('deleted_at', null)
      );

      // Revenue — ONLY for creator
      if (isCreator) {
        promises.push(
          supabase
            .from('transactions')
            .select('amount')
            .eq('status', 'completed')
        );
      }

      const results = await Promise.all(promises);

      const activeUsers = results[0].count || 0;
      const totalListings = results[1].count || 0;
      const totalBookings = results[2].count || 0;
      const totalWorkers = results[3].count || 0;
      const totalPartners = results[4].count || 0;
      const pendingVerifications = results[5].count || 0;

      // Revenue only for creator (last result)
      let totalRevenue = 0;
      if (isCreator && results[6]?.data) {
        totalRevenue = results[6].data.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
      }

      setData({
        totalRevenue,
        activeUsers,
        totalBookings,
        totalListings,
        totalWorkers,
        totalPartners,
        pendingVerifications,
        pendingInspections: 0, // TODO: from inspections table
        loading: false,
      });
    }

    loadStats();
  }, [isCreator]);

  const formatCurrency = (n: number) => {
    if (n === 0) return 'N0.00';
    if (n >= 1000000) return `N${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `N${(n / 1000).toFixed(1)}K`;
    return `N${n.toLocaleString()}`;
  };

  // Render different cards based on role
  const renderCards = () => {
    if (isCreator) {
      // Creator sees: Revenue, Users, Bookings, Listings, Workers, Partners, Pending Verifications
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Total Revenue</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-16 h-5 bg-white/[0.06] rounded animate-pulse" /> : formatCurrency(data.totalRevenue)}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.activeUsers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Bookings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalBookings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalListings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Workers</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalWorkers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Partners</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalPartners.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06] col-span-2">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending Verifications</p>
            <p className="text-xl font-bold text-amber-400 mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.pendingVerifications.toLocaleString()}
            </p>
          </div>
        </div>
      );
    }

    if (isAdmin) {
      // Admin sees: Users, Bookings, Listings, Workers, Partners, Pending Verifications — NO Revenue
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.activeUsers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Bookings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalBookings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalListings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Workers</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalWorkers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Partners</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalPartners.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending Verifications</p>
            <p className="text-xl font-bold text-amber-400 mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.pendingVerifications.toLocaleString()}
            </p>
          </div>
        </div>
      );
    }

    // Staff — only show metrics relevant to their assigned modules
    // No revenue, no sensitive financial data
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
          <p className="text-xl font-bold text-white mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.activeUsers.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
          <p className="text-xl font-bold text-white mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalListings.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Workers</p>
          <p className="text-xl font-bold text-white mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalWorkers.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending Verifications</p>
          <p className="text-xl font-bold text-amber-400 mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.pendingVerifications.toLocaleString()}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-0">
        <h1 className="text-lg font-bold text-white mb-3">
          {isCreator ? 'Platform Analytics' : isAdmin ? 'Platform Overview' : 'Analytics'}
        </h1>
        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-3">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 h-8 px-3 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.id ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] text-[#5C5E72] hover:text-white'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 py-8 space-y-4">
        {/* TAB: Overview */}
        {activeTab === 'overview' && (
          <>
            {renderCards()}
            <div className="text-center py-8">
              <p className="text-[11px] text-[#5C5E72]">
                {isCreator ? 'Full platform financial data' : isAdmin ? 'Platform management metrics' : 'Metrics for your assigned modules'}
              </p>
            </div>
          </>
        )}

        {/* TAB: Activity */}
        {activeTab === 'activity' && (
          <ActivityTab isCreator={isCreator} isAdmin={isAdmin} />
        )}

        {/* TAB: Reports */}
        {activeTab === 'reports' && (
          <ReportsTab isCreator={isCreator} />
        )}
      </div>
    </div>
  );
}
