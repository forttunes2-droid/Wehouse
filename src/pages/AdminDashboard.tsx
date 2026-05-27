import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, getAllListingsAdmin, getReports,
  resolveReport, dismissReport, logAuditAction,
  getAllWorkers,
  updateUserRole, deleteListing,
} from '@/lib/supabase';
import type { Profile } from '@/types';
import { AnnouncementsTab } from './CreatorDashboard';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { Toaster, toast } from 'sonner';
import { Input } from '@/components/ui/input';

interface AdminDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

type AdminTab = 'overview' | 'staff' | 'users' | 'listings' | 'reports' | 'announcements';

export default function AdminDashboard({ profile, onLogout }: AdminDashboardProps) {
  // Persist dashboard sub-tab across refreshes
  const ADMIN_TAB_KEY = 'wh_admin_tab';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const saved = localStorage.getItem(ADMIN_TAB_KEY);
      return saved && ['overview','staff','users','listings','reports','announcements'].includes(saved) ? saved as AdminTab : 'overview';
    } catch { return 'overview'; }
  });

  // Save tab change to localStorage
  const handleSetTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem(ADMIN_TAB_KEY, tab);
  }, []);

  const [stats, setStats] = useState({ users: 0, staff: 0, listings: 0, workers: 0, reports: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  const scope = {
    state: profile.assigned_state || profile.state || '',
    lga: profile.assigned_lga || profile.city || '',
  };

  const refresh = () => setRefreshKey(k => k + 1);

  // Load scoped stats
  useEffect(() => {
    async function load() {
      const [{ users }, { listings }, { workers }, { reports }] = await Promise.all([
        getAllUsers(), getAllListingsAdmin(), getAllWorkers(), getReports()
      ]);

      const inScope = (u: any) => u.state === scope.state && u.city === scope.lga && !u.deleted;

      const scopedUsers = (users || []).filter(inScope);
      const scopedStaff = scopedUsers.filter(u => u.role === 'staff');
      const scopedListings = (listings || []).filter(inScope);
      const scopedWorkers = (workers || []).filter(inScope);

      setStats({
        users: scopedUsers.filter(u => u.role === 'user').length,
        staff: scopedStaff.length,
        listings: scopedListings.length,
        workers: scopedWorkers.length,
        reports: (reports || []).filter(r => r.status === 'pending').length,
      });
    }
    if (scope.state && scope.lga) load();
  }, [scope.state, scope.lga, refreshKey]);

  const tabs: Array<{ id: AdminTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { id: 'staff', label: 'Staff', icon: 'M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM10 4h4v2h-4V4z' },
    { id: 'users', label: 'Users', icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z' },
    { id: 'listings', label: 'Listings', icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' },
    { id: 'reports', label: 'Reports', icon: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z' },
    { id: 'announcements', label: 'Announce', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">Local Dashboard</h1>
            <p className="text-[10px] text-blue-400 mt-0.5">{scope.lga || 'Unassigned'} · {scope.state || 'Unassigned'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">ADMIN</span>
            <button onClick={onLogout} className="text-red-400 hover:text-red-300 transition-colors p-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex gap-0 overflow-x-auto px-2 no-scrollbar">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => handleSetTab(tab.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-3 text-[10px] font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.id ? 'text-blue-400 border-blue-400' : 'text-[#5C5E72] border-transparent'
              }`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d={tab.icon} /></svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-5">
        {activeTab === 'overview' && <OverviewTab stats={stats} scope={scope} />}
        {activeTab === 'staff' && <StaffTab scope={scope} profile={profile} refresh={refresh} />}
        {activeTab === 'users' && <UsersTab scope={scope} profile={profile} refresh={refresh} />}
        {activeTab === 'listings' && <ListingsTab scope={scope} profile={profile} refresh={refresh} />}
        {activeTab === 'reports' && <ReportsTab profile={profile} />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope={scope} />}
      </div>
    </div>
  );
}

// ─── OVERVIEW ─────────────────────────────────────
function OverviewTab({ stats, scope }: { stats: any; scope: { state: string; lga: string } }) {
  return (
    <div className="space-y-4">
      {/* Scope Card */}
      <div className="glass rounded-2xl p-4 border border-blue-500/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Your Managed Area</p>
            <p className="text-[11px] text-[#5C5E72]">{scope.lga}, {scope.state}</p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Users', value: stats.users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Staff', value: stats.staff, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Listings', value: stats.listings, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Workers', value: stats.workers, color: 'text-pink-400', bg: 'bg-pink-500/10' },
        ].map(s => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-[#5C5E72] mt-0.5">{s.label} in {scope.lga}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="glass rounded-2xl p-4">
        <p className="text-xs font-semibold text-white mb-3">Quick Actions</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Manage Staff', desc: 'View & control staff' },
            { label: 'View Users', desc: 'Users in your LGA' },
            { label: 'Moderate Listings', desc: 'Approve or remove' },
            { label: 'View Reports', desc: 'Pending reports' },
          ].map(a => (
            <div key={a.label} className="p-3 rounded-xl bg-[#1A1A24] border border-[#2A2A3A]">
              <p className="text-xs text-white font-medium">{a.label}</p>
              <p className="text-[10px] text-[#5C5E72]">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── STAFF TAB ────────────────────────────────────
function StaffTab({ scope, profile, refresh }: { scope: { state: string; lga: string }; profile: Profile; refresh: () => void }) {
  const { ask, dialogProps } = useConfirm();
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { users } = await getAllUsers();
    const inScope = (users || []).filter(u => u.state === scope.state && u.city === scope.lga && !u.deleted && u.role === 'staff');
    setStaff(inScope);
    setLoading(false);
  }, [scope.state, scope.lga]);

  useEffect(() => { load(); }, [load]);

  async function handleDemote(userId: string, email: string) {
    const demoteOk = await ask({ title: 'Demote this staff?', confirmLabel: 'Demote', variant: 'warning' });
    if (!demoteOk) return;
    const { error } = await updateUserRole(userId, 'user', 'staff', profile.user_id, profile.email, email);
    if (error) { toast.error(error.message || 'Failed'); return; }
    toast.success('Staff demoted to user');
    await logAuditAction(profile.user_id, profile.email, 'demote_staff', 'user', userId, 'Staff demoted to user');
    load(); refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{staff.length} Staff in {scope.lga}</div>
      {staff.length === 0 && <div className="text-center py-10 text-xs text-[#5C5E72]">No staff in this area</div>}
      {staff.map(s => (
        <div key={s.id} className="glass rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white text-xs font-bold">
              {(s.username || s.email[0]).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white truncate">@{s.username || '...'}</span>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">STAFF</span>
              </div>
              <div className="text-[10px] text-[#5C5E72] truncate">{s.email}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-2.5">
            <button onClick={() => handleDemote(s.user_id, s.email)}
              className="flex-1 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] hover:bg-amber-500/20 transition-colors">
              Demote to User
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── USERS TAB ────────────────────────────────────
function UsersTab({ scope, profile, refresh }: { scope: { state: string; lga: string }; profile: Profile; refresh: () => void }) {
  const { ask, dialogProps } = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { users: data } = await getAllUsers();
    const inScope = (data || []).filter(u => u.state === scope.state && u.city === scope.lga && !u.deleted && u.role === 'user');
    setUsers(inScope);
    setLoading(false);
  }, [scope.state, scope.lga]);

  useEffect(() => { load(); }, [load]);

  async function handlePromote(userId: string, email: string) {
    const promoteOk = await ask({ title: 'Promote to staff?', confirmLabel: 'Promote', variant: 'info' });
    if (!promoteOk) return;
    const { error } = await updateUserRole(userId, 'staff', 'user', profile.user_id, profile.email, email);
    if (error) { toast.error(error.message || 'Failed'); return; }
    toast.success('User promoted to staff');
    await logAuditAction(profile.user_id, profile.email, 'promote_staff', 'user', userId, 'User promoted to staff');
    load(); refresh();
  }

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72]" />
      <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{filtered.length} Users in {scope.lga}</div>
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-xs text-[#5C5E72]">No users found</div>
      ) : (
        filtered.map(u => (
          <div key={u.id} className="glass rounded-xl p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
                {(u.username || u.email[0]).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-white truncate">@{u.username || '...'}</span>
                <div className="text-[10px] text-[#5C5E72] truncate">{u.email}</div>
              </div>
            </div>
            <button onClick={() => handlePromote(u.user_id, u.email)}
              className="w-full mt-2 h-7 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors">
              Promote to Staff
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ─── LISTINGS TAB ─────────────────────────────────
function ListingsTab({ scope, profile: _profile, refresh }: { scope: { state: string; lga: string }; profile: Profile; refresh: () => void }) {
  const { ask, dialogProps } = useConfirm();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    const inScope = (data || []).filter(l => l.state === scope.state && l.city === scope.lga);
    setListings(inScope);
    setLoading(false);
  }, [scope.state, scope.lga]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(listingId: string) {
    const delOk = await ask({ title: 'Delete this listing?', confirmLabel: 'Delete', variant: 'danger' });
    if (!delOk) return;
    const { error } = await deleteListing(listingId);
    if (error) { toast.error('Delete failed'); return; }
    toast.success('Listing deleted');
    load(); refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{listings.length} Listings in {scope.lga}</div>
      {listings.length === 0 && <div className="text-center py-10 text-xs text-[#5C5E72]">No listings in this area</div>}
      {listings.map(l => (
        <div key={l.id} className="glass rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-[#1A1A24] flex items-center justify-center overflow-hidden">
              {l.images?.[0] ? <img src={l.images[0]} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">🏠</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">{l.title}</div>
              <div className="text-[10px] text-[#5C5E72]">₦{l.price?.toLocaleString()} · {l.status || 'available'}</div>
            </div>
          </div>
          <button onClick={() => handleDelete(l.listing_id)}
            className="w-full mt-2 h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">
            Remove Listing
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── REPORTS TAB ──────────────────────────────────
function ReportsTab({ profile }: { profile: Profile }) {
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
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /></div> :
        reports.length === 0 ? <div className="text-center py-16 text-xs text-[#5C5E72]">No reports</div> :
        reports.map(r => (
          <div key={r.id} className="glass rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${r.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-green-500/10 text-green-400'}`}>{r.status}</span>
            </div>
            <p className="text-xs text-white font-medium mb-1">{r.reason}</p>
            {r.status === 'pending' && (
              <div className="flex gap-2 mt-2">
                <button onClick={() => handleResolve(r.id)} className="flex-1 h-7 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px]">Resolve</button>
                <button onClick={() => handleDismiss(r.id)} className="flex-1 h-7 rounded-lg bg-gray-500/10 border border-gray-500/20 text-gray-400 text-[10px]">Dismiss</button>
              </div>
            )}
          </div>
        ))
      }
    </div>
  );
}
