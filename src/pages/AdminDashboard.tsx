import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, getAllListingsAdmin, getReports,
  resolveReport, dismissReport, logAuditAction,
  getAllWorkers, updateWorkerStatus, parseWorkerStatus,
} from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';
import { Input } from '@/components/ui/input';

interface AdminDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onBack?: () => void;
}

const ROLE_COLORS: Record<string, string> = {
  creator: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  admin: 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20',
  staff: 'bg-green-500/10 text-green-400 border-green-500/20',
  user: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  worker: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
};

type AdminTab = 'overview' | 'users' | 'listings' | 'workers' | 'reports';

export default function AdminDashboard({ profile, onLogout, onBack: _onBack }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState({ users: 0, listings: 0, workers: 0, reports: 0 });

  const scope = {
    state: profile.assigned_state || profile.state || '',
    lga: profile.assigned_lga || profile.city || '',
  };

  // Load scoped stats
  useEffect(() => {
    async function load() {
      const { users } = await getAllUsers();
      const { listings } = await getAllListingsAdmin();
      const { workers } = await getAllWorkers();
      const { reports } = await getReports();

      // Filter by scope
      const scopedUsers = (users || []).filter(u => u.state === scope.state && u.city === scope.lga);
      const scopedListings = (listings || []).filter(l => l.state === scope.state && l.city === scope.lga);
      const scopedWorkers = (workers || []).filter(w => w.state === scope.state && w.city === scope.lga);
      const scopedReports = (reports || []).filter(r => {
        const listing = (listings || []).find(l => l.listing_id === r.listing_id);
        return listing?.state === scope.state && listing?.city === scope.lga;
      });

      setStats({
        users: scopedUsers.length,
        listings: scopedListings.length,
        workers: scopedWorkers.length,
        reports: scopedReports.filter(r => r.status === 'pending').length,
      });
    }
    if (scope.state && scope.lga) load();
  }, [scope.state, scope.lga]);

  const tabs: Array<{ id: AdminTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'M4 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM14 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V6zM4 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2zM14 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2z' },
    { id: 'users', label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'listings', label: 'Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'workers', label: 'Workers', icon: 'M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z' },
    { id: 'reports', label: 'Reports', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">Admin Dashboard</h1>
            <p className="text-[10px] text-[#3B82F6]">{scope.lga}, {scope.state}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">ADMIN</span>
            <button onClick={onLogout} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex gap-0 overflow-x-auto px-2 no-scrollbar">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-3 text-[10px] font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.id ? 'text-[#3B82F6] border-[#3B82F6]' : 'text-[#5C5E72] border-transparent'
              }`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={tab.icon} /></svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-5 py-5">
        {activeTab === 'overview' && (
          <OverviewTab profile={profile} stats={stats} scope={scope} />
        )}
        {activeTab === 'users' && <UsersTab scope={scope} />}
        {activeTab === 'listings' && <ListingsTab scope={scope} />}
        {activeTab === 'workers' && <WorkersTab profile={profile} scope={scope} />}
        {activeTab === 'reports' && <ReportsTab profile={profile} scope={scope} />}
        {/* scope passed for future filtering */}
      </div>
    </div>
  );
}

// ─── OVERVIEW (scoped) ─────────────────────────────
function OverviewTab({ profile: _profile, stats, scope }: { profile: Profile; stats: any; scope: { state: string; lga: string } }) {
  return (
    <div className="space-y-4">
      {/* Scope Banner */}
      <div className="glass rounded-2xl p-4 border border-[#3B82F6]/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Your Assigned Area</p>
            <p className="text-[11px] text-[#5C5E72]">{scope.lga}, {scope.state}</p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Local Users', value: stats.users, icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', color: '#3B82F6' },
          { label: 'Listings', value: stats.listings, icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', color: '#10B981' },
          { label: 'Workers', value: stats.workers, icon: 'M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2z', color: '#F59E0B' },
          { label: 'Pending Reports', value: stats.reports, icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', color: '#EF4444' },
        ].map(s => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="1.5" className="mb-2"><path d={s.icon} /></svg>
            <div className="text-xl font-bold text-white">{s.value}</div>
            <div className="text-[10px] text-[#5C5E72]">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── USERS (scoped) ────────────────────────────────
function UsersTab({ scope }: { scope: { state: string; lga: string } }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { users: data } = await getAllUsers();
    // Filter by scope
    const scoped = (data || []).filter(u => u.state === scope.state && u.city === scope.lga && !u.deleted);
    setUsers(scoped);
    setLoading(false);
  }, [scope.state, scope.lga]);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72]" />
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{filtered.length} Users in {scope.lga}</div>
          {filtered.map(u => (
            <div key={u.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">{(u.username || 'U').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold text-white truncate">@{u.username || '...'}</div>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${ROLE_COLORS[u.role] || ROLE_COLORS.user}`}>{u.role}</span>
                  </div>
                  <div className="text-[10px] text-[#5C5E72] truncate">{u.email}</div>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-10 text-xs text-[#5C5E72]">No users in this area</div>}
        </div>
      )}
    </div>
  );
}

// ─── LISTINGS (scoped) ─────────────────────────────
function ListingsTab({ scope }: { scope: { state: string; lga: string } }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    const scoped = (data || []).filter(l => l.state === scope.state && l.city === scope.lga);
    setListings(scoped);
    setLoading(false);
  }, [scope.state, scope.lga]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{listings.length} Listings in {scope.lga}</div>
          {listings.map(l => (
            <div key={l.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[10px] text-[#5C5E72]">🏠</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{l.title}</div>
                  <div className="text-[10px] text-[#5C5E72]">₦{l.price?.toLocaleString()} · {l.status || 'available'}</div>
                </div>
              </div>
            </div>
          ))}
          {listings.length === 0 && <div className="text-center py-10 text-xs text-[#5C5E72]">No listings in this area</div>}
        </div>
      )}
    </div>
  );
}

// ─── WORKERS (scoped) ──────────────────────────────
function WorkersTab({ profile, scope }: { profile: Profile; scope: { state: string; lga: string } }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { workers: data } = await getAllWorkers();
    const scoped = (data || []).filter(w => w.state === scope.state && w.city === scope.lga);
    setWorkers(scoped);
    setLoading(false);
  }, [scope.state, scope.lga]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? workers : workers.filter(w => parseWorkerStatus(w) === filter);

  async function handleStatus(userId: string, status: 'verified' | 'suspended' | 'rejected') {
    const { error } = await updateWorkerStatus(userId, status);
    if (error) { toast.error('Failed: ' + error.message); return; }
    await logAuditAction(profile.user_id, profile.email, `worker_${status}`, 'worker', userId, `Worker ${status}`);
    toast.success(`Worker ${status}`);
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {['all', 'pending', 'verified', 'suspended'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`h-7 px-3 rounded-lg text-[10px] font-medium ${filter === f ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-[#5C5E72]'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(w => (
            <div key={w.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full border ${parseWorkerStatus(w) === 'pending' ? 'bg-amber-500/10 text-amber-400' : parseWorkerStatus(w) === 'verified' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  {parseWorkerStatus(w)}
                </span>
              </div>
              <div className="text-xs font-semibold text-white">{w.full_name || w.username || 'Worker'}</div>
              <div className="text-[10px] text-[#5C5E72]">{w.worker_occupation} · {w.email}</div>
              {parseWorkerStatus(w) === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handleStatus(w.user_id, 'verified')} className="flex-1 h-7 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px]">Approve</button>
                  <button onClick={() => handleStatus(w.user_id, 'suspended')} className="flex-1 h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px]">Reject</button>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-10 text-xs text-[#5C5E72]">No workers in this area</div>}
        </div>
      )}
    </div>
  );
}

// ─── REPORTS (scoped) ──────────────────────────────
function ReportsTab({ profile }: { profile: Profile; scope: { state: string; lga: string } }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { reports: data } = await getReports();
    setReports(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleResolve(id: string) {
    const { error } = await resolveReport(id, profile.user_id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Resolved'); load();
  }

  async function handleDismiss(id: string) {
    const { error } = await dismissReport(id, profile.user_id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Dismissed'); load();
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#5C5E72]">No reports</div>
      ) : (
        reports.map(r => (
          <div key={r.id} className="glass rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${r.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : r.status === 'resolved' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{r.status}</span>
            </div>
            <p className="text-xs text-white font-medium mb-1">{r.reason}</p>
            {r.status === 'pending' && (
              <div className="flex gap-2">
                <button onClick={() => handleResolve(r.id)} className="flex-1 h-8 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px]">Resolve</button>
                <button onClick={() => handleDismiss(r.id)} className="flex-1 h-8 rounded-lg bg-gray-500/10 border border-gray-500/20 text-gray-400 text-[10px]">Dismiss</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
