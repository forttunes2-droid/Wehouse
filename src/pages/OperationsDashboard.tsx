import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile, Listing } from '@/types';
import { Toaster, toast } from 'sonner';

interface OperationsDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

export default function OperationsDashboard({ profile }: OperationsDashboardProps) {
  const [stats, setStats] = useState({ listings: 0, users: 0, workers: 0, reservations: 0, pendingWorkers: 0, activeChats: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'listings' | 'staff' | 'activity'>('overview');

  useEffect(() => {
    async function loadStats() {
      const [
        { count: listingsCount },
        { count: usersCount },
        { count: workersCount },
        { count: reservationsCount },
        { count: pendingWorkersCount },
        { count: activeChatsCount },
      ] = await Promise.all([
        supabase.from('listings').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker'),
        supabase.from('reservations').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending'),
        supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      setStats({
        listings: listingsCount || 0,
        users: usersCount || 0,
        workers: workersCount || 0,
        reservations: reservationsCount || 0,
        pendingWorkers: pendingWorkersCount || 0,
        activeChats: activeChatsCount || 0,
      });
      setLoading(false);
    }
    loadStats();
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Operations</h1>
          <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Operations</span>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.04]">
        {(['overview', 'listings', 'staff', 'activity'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 h-9 rounded-xl text-[11px] font-semibold transition-all ${
              activeTab === tab
                ? 'bg-[#3B82F6] text-white'
                : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="px-5 py-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Listings" value={stats.listings} color="blue" />
                  <StatCard label="Users" value={stats.users} color="emerald" />
                  <StatCard label="Workers" value={stats.workers} color="amber" />
                  <StatCard label="Reservations" value={stats.reservations} color="violet" />
                  <StatCard label="Pending Workers" value={stats.pendingWorkers} color="rose" />
                  <StatCard label="Active Chats" value={stats.activeChats} color="cyan" />
                </div>

                {/* Quick Actions */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Quick Actions</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <QuickAction label="Add Listing" icon="M12 4v16M4 12h16" onClick={() => toast.info('Navigate to Listings tab')} />
                    <QuickAction label="Verify Workers" icon="M9 12l2 2 4-4" onClick={() => setActiveTab('staff')} />
                    <QuickAction label="View Reports" icon="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" onClick={() => toast.info('Reports feature coming soon')} />
                    <QuickAction label="Send Announcement" icon="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" onClick={() => toast.info('Use Creator Dashboard for announcements')} />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'listings' && <ListingsManagementTab />}
        {activeTab === 'staff' && <StaffCoordinationTab profile={profile} />}
        {activeTab === 'activity' && <ActivityFeedTab />}
      </main>
    </div>
  );
}

// ─── STAT CARD ─────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 text-blue-400 border-blue-500/20',
    emerald: 'from-emerald-500/10 to-emerald-600/5 text-emerald-400 border-emerald-500/20',
    amber: 'from-amber-500/10 to-amber-600/5 text-amber-400 border-amber-500/20',
    violet: 'from-violet-500/10 to-violet-600/5 text-violet-400 border-violet-500/20',
    rose: 'from-rose-500/10 to-rose-600/5 text-rose-400 border-rose-500/20',
    cyan: 'from-cyan-500/10 to-cyan-600/5 text-cyan-400 border-cyan-500/20',
  };
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorMap[color]} border p-4 text-center`}>
      <p className="text-2xl font-extrabold">{value.toLocaleString()}</p>
      <p className="text-[10px] mt-1 opacity-70">{label}</p>
    </div>
  );
}

// ─── QUICK ACTION ──────────────────────────────────
function QuickAction({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center hover:bg-white/[0.02] transition-colors">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" className="mx-auto mb-2">
        <path d={icon} />
      </svg>
      <span className="text-[11px] text-white font-medium">{label}</span>
    </button>
  );
}

// ─── LISTINGS MANAGEMENT ───────────────────────────
function ListingsManagementTab() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('listings')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
      setListings(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Recent Listings</h3>
      {listings.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No listings found</div>
      ) : (
        listings.map(l => (
          <div key={l.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{l.title}</p>
                <p className="text-[10px] text-[#5C5E72]">{l.city}, {l.state} &middot; {l.bedrooms} bed &middot; N{l.price?.toLocaleString()}</p>
              </div>
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                l.status === 'available' ? 'bg-emerald-500/10 text-emerald-400' :
                l.status === 'reserved' ? 'bg-amber-500/10 text-amber-400' :
                'bg-gray-500/10 text-gray-400'
              }`}>
                {l.status}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── STAFF COORDINATION ────────────────────────────
function StaffCoordinationTab({ profile: _profile }: { profile: Profile }) {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['staff', 'admin', 'state_admin', 'assistant_state_admin', 'director'])
        .order('created_at', { ascending: false });
      setStaff(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">
        Staff ({staff.length})
      </h3>
      {staff.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No staff found</div>
      ) : (
        staff.map(s => (
          <div key={s.user_id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1A1A24] flex items-center justify-center text-sm font-bold text-[#5C5E72]">
              {(s.username || s.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">@{s.username || 'unknown'}</p>
              <p className="text-[10px] text-[#5C5E72]">{s.email} &middot; {s.role}</p>
              <p className="text-[9px] text-[#5C5E72]">{s.city || 'No location'}</p>
            </div>
            <div className={`w-2 h-2 rounded-full ${s.is_online ? 'bg-emerald-400' : 'bg-gray-600'}`} />
          </div>
        ))
      )}
    </div>
  );
}

// ─── ACTIVITY FEED ─────────────────────────────────
function ActivityFeedTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      setLogs(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Recent Activity</h3>
      {logs.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No activity yet</div>
      ) : (
        logs.map(log => (
          <div key={log.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <p className="text-[11px] text-white flex-1">{log.action}</p>
              <span className="text-[9px] text-[#5C5E72]">{new Date(log.created_at).toLocaleDateString()}</span>
            </div>
            {log.details && <p className="text-[10px] text-[#5C5E72] ml-3.5 mt-0.5">{log.details}</p>}
          </div>
        ))
      )}
    </div>
  );
}
