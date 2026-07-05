import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, updateUserRole,
  getAllListingsAdmin, deleteListing, getReports, resolveReport, dismissReport,
  getAuditLogs,
  getListingsPendingApproval, approveListing, rejectListing,
} from '@/lib/supabase';
import { AnnouncementsTab } from './CreatorDashboard';
import SettingsTab from './SettingsTab';
import UserProfileModal from '@/components/UserProfileModal';
import type { Profile, Listing } from '@/types';
import { ROLE_LABELS } from '@/types';
import { Toaster, toast } from 'sonner';

type AdminTab = 'overview' | 'users' | 'listings' | 'approval' | 'reports' | 'audit' | 'announcements' | 'settings';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

const roleColors: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  property_partner: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
};

export default function DirectorDashboard({ profile, onLogout, onNavigate }: Props) {
  const TAB_KEY = 'wh_admin_tab';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved && ['overview','users','listings','approval','reports','audit','announcements','settings'].includes(saved) ? saved as AdminTab : 'overview';
    } catch { return 'overview'; }
  });

  const handleSetTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  }, []);

  const [stats, setStats] = useState({ totalUsers: 0, staff: 0, admins: 0, newToday: 0, listings: 0, pendingApproval: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewingUser, setViewingUser] = useState<Profile | null>(null);
  const refresh = () => setRefreshKey(k => k + 1);

  // Admin sees ALL data nationwide — no state filter
  const scopeState = '';

  useEffect(() => {
    async function loadStats() {
      const [userRes, listingRes, approvalRes] = await Promise.all([
        getAllUsers(),
        getAllListingsAdmin(),
        getListingsPendingApproval(profile.role, profile.user_id, ''),
      ]);
      const users = userRes.users || [];
      const listings = listingRes.listings || [];
      const today = new Date().toISOString().split('T')[0];
      // Robust active user filter (checks both deleted flag and deleted_at)
      const isActive = (u: any) => !u.deleted && !u.deleted_at && u.user_id !== 'wehouse_support';
      setStats({
        totalUsers: users.filter(isActive).length,
        staff: users.filter((u: any) => isActive(u) && u.role === 'staff').length,
        admins: users.filter((u: any) => isActive(u) && u.role === 'admin').length,
        newToday: users.filter((u: any) => isActive(u) && u.created_at?.startsWith(today)).length,
        listings: listings.length,
        pendingApproval: approvalRes.listings.length,
      });
    }
    loadStats();
  }, [profile.role, profile.user_id, refreshKey]);

  const tabs = [
    { id: 'overview' as AdminTab, label: 'Overview', icon: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'users' as AdminTab, label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'listings' as AdminTab, label: 'Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'approval' as AdminTab, label: 'Approval', icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { id: 'reports' as AdminTab, label: 'Reports', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    { id: 'audit' as AdminTab, label: 'Audit', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { id: 'announcements' as AdminTab, label: 'Announce', icon: 'M11 5.882V19.24a1.4 1.4 0 0 1-2.338.995l-3.867-3.43a1.4 1.4 0 0 0-.93-.338H2a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1.865a1.4 1.4 0 0 0 .93-.338l3.867-3.43A1.4 1.4 0 0 1 11 5.882z' },
    { id: 'settings' as AdminTab, label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  ];

  return (
    <div className="min-h-[100dvh] bg-transparent pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" toastOptions={{ style: { background: '#1A1A24', color: '#fff', border: '1px solid #232330' } }} />

      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-5 pt-6 pb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-white">Admin Dashboard</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-indigo-300 bg-white/10 border-white/20">{ROLE_LABELS[profile.role as keyof typeof ROLE_LABELS] || profile.role}</span>
            </div>
            <p className="text-xs text-white/60">{scopeState} · Admin Level</p>
          </div>
          <div className="flex items-center gap-2">
            {onNavigate && (
              <button onClick={() => onNavigate('home')} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
            )}
            <button onClick={onLogout} className="h-8 px-3 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors">Logout</button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Users', value: stats.totalUsers },
            { label: 'Admins', value: stats.admins },
            { label: 'Staff', value: stats.staff },
            { label: 'Listings', value: stats.listings },
            { label: 'Pending', value: stats.pendingApproval, highlight: stats.pendingApproval > 0 },
          ].map(s => (
            <div key={s.label} className={`bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center ${s.highlight ? 'ring-2 ring-amber-400/50' : ''}`}>
              <div className="text-lg font-bold text-white">{s.value}</div>
              <div className="text-[9px] text-white/60">{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="px-5 -mt-4">
        <div className="glass rounded-xl p-1 flex gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleSetTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium whitespace-nowrap rounded-lg transition-all ${
                  isActive ? 'bg-indigo-500/10 text-indigo-400' : 'text-[#5C5E72] hover:text-[#8B8DA0]'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={tab.icon} /></svg>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pt-4">
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="glass rounded-2xl p-4 border border-indigo-500/10">
              <p className="text-xs text-[#8A8B9C]">As Admin, you manage all users and listings in {scopeState}. You approve listings posted by Admin and below.</p>
              {stats.pendingApproval > 0 && (
                <p className="text-xs text-amber-400 mt-2 font-medium">{stats.pendingApproval} listing{stats.pendingApproval !== 1 ? 's' : ''} awaiting your approval</p>
              )}
            </div>
          </div>
        )}
        {activeTab === 'users' && <UsersTabDirector profile={profile} scopeState={scopeState} refresh={refresh} onViewUser={setViewingUser} />}
        {activeTab === 'listings' && <ListingsTabDirector scopeState={scopeState} refresh={refresh} />}

      {/* User Profile Viewer */}
      <UserProfileModal user={viewingUser} onClose={() => setViewingUser(null)} />
        {activeTab === 'approval' && <ApprovalTabDirector profile={profile} scopeState={scopeState} refresh={refresh} />}
        {activeTab === 'reports' && <ReportsTabDirector profile={profile} refresh={refresh} />}
        {activeTab === 'audit' && <AuditTabDirector />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope={{ state: scopeState, lga: profile.city || profile.city || '' }} />}
        {activeTab === 'settings' && <SettingsTab profile={profile} onUpdate={(_p) => {}} />}
      </div>
    </div>
  );
}

// ─── USERS TAB ─────────────────────────────────────
function UsersTabDirector({ profile, scopeState, refresh, onViewUser }: { profile: Profile; scopeState: string; refresh: () => void; onViewUser?: (u: Profile) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => { load(); }, [scopeState]);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    // Show ALL users (all states), exclude only deleted and current admin
    const allUsers = (data || []).filter((u: any) => !u.deleted && u.user_id !== profile.user_id);
    setUsers(allUsers);
    setLoading(false);
  }

  async function handleRole(userId: string, newRole: string) {
    const target = users.find(u => u.user_id === userId);
    if (!target) return;
    if (userId === profile.user_id) { toast.error('Cannot change own role'); return; }
    const changerRole = (profile.role === 'creator' ? 'creator' : profile.role === 'admin' ? 'admin' : 'staff') as 'creator' | 'admin' | 'staff';
    const { error } = await updateUserRole(userId, newRole, target.role, profile.user_id, profile.email, target.email, changerRole);
    if (error) { toast.error(error.message || 'Failed'); return; }
    toast.success('Role updated');
    load();
    refresh();
  }

  const filtered = users.filter(u => {
    const matchSearch = !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  return (
    <div className="space-y-3">
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
      <div className="flex gap-2 overflow-x-auto">
        {['', 'user', 'staff', 'admin', 'worker', 'property_partner'].map(r => (
          <button key={r} onClick={() => setRoleFilter(r)} className={`px-3 h-7 rounded-lg text-[10px] font-medium whitespace-nowrap ${roleFilter === r ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-[#1A1A24] border border-[#232330] text-[#5C5E72]'}`}>
            {r ? ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r : 'All'}
          </button>
        ))}
      </div>
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {filtered.map(u => {
            const isUWorker = u.role === 'worker';
            const isUPartner = u.role === 'property_partner';
            const isUCreator = u.role === 'creator';
            const roleLocked = isUWorker || isUPartner || isUCreator;
            return (
              <div key={u.id} className="glass rounded-xl p-3 hover:border-indigo-500/20 transition-all cursor-pointer" onClick={() => onViewUser?.(u)}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xs font-bold">{(u.username || 'U').charAt(0).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">@{u.username || 'unknown'}</p>
                    <p className="text-[10px] text-[#5C5E72] truncate">{u.email}</p>
                  </div>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full border ${roleColors[u.role] || roleColors.user}`}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="flex-shrink-0"><path d="M9 18l6-6-6-6" /></svg>
                </div>
                {/* Role locked indicator for workers, partners, creators */}
                {roleLocked ? (
                  <div className="mt-2 px-2 py-1 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[10px] text-[#5C5E72]">
                    {isUWorker ? 'Worker (role locked)' : isUPartner ? 'Partner (role locked)' : 'Creator (role locked)'}
                  </div>
                ) : (
                  <select value={u.role} onChange={e => handleRole(u.user_id, e.target.value)} className="w-full h-8 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[10px] px-2 mt-2 outline-none">
                    <option value="user">{ROLE_LABELS.user}</option>
                    <option value="staff">{ROLE_LABELS.staff}</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LISTINGS TAB ──────────────────────────────────
function ListingsTabDirector({ scopeState, refresh }: { scopeState: string; refresh: () => void }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [scopeState]);

  async function load() {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    setListings((data || []).filter((l: any) => l.state === scopeState));
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const { error } = await deleteListing(id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Deleted');
    load();
    refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {listings.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No listings</p> : listings.map(l => (
        <div key={l.id} className="glass rounded-xl p-3 flex items-center gap-3">
          <img src={l.images?.[0] || 'https://placehold.co/100x100/1A1A24/5C5E72?text=No+Image'} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{l.title}</p>
            <p className="text-[10px] text-[#5C5E72]">{l.city} · ₦{l.price?.toLocaleString()}/year · <span className={l.status === 'available' ? 'text-green-400' : l.status === 'pending_approval' ? 'text-blue-400' : 'text-amber-400'}>{l.status}</span></p>
          </div>
          <button onClick={() => handleDelete(l.id)} className="h-7 px-2 rounded-lg bg-red-500/10 text-red-400 text-[10px] hover:bg-red-500/20">Delete</button>
        </div>
      ))}
    </div>
  );
}

// ─── APPROVAL TAB ──────────────────────────────────
function ApprovalTabDirector({ profile, scopeState, refresh }: { profile: Profile; scopeState: string; refresh: () => void }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { load(); }, [scopeState]);

  async function load() {
    setLoading(true);
    const { listings: data } = await getListingsPendingApproval(profile.role, profile.user_id, '');
    setListings(data || []);
    setLoading(false);
  }

  async function handleApprove(id: string) {
    const { error } = await approveListing(id, profile.user_id);
    if (error) { toast.error('Failed to approve'); return; }
    toast.success('Listing approved!');
    load();
    refresh();
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) { toast.error('Enter a rejection reason'); return; }
    const { error } = await rejectListing(id, profile.user_id, rejectReason.trim());
    if (error) { toast.error('Failed to reject'); return; }
    toast.success('Listing rejected');
    setRejectId(null);
    setRejectReason('');
    load();
    refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {listings.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">No listings pending approval</p>
          <p className="text-xs text-[#5C5E72] mt-1">Listings posted by Admin will appear here for your review</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-amber-400 font-medium">{listings.length} listing{listings.length !== 1 ? 's' : ''} awaiting approval</p>
          {listings.map(l => (
            <div key={l.id} className="glass rounded-xl p-4 border border-blue-500/10">
              <div className="flex items-start gap-3">
                <img src={l.images?.[0] || 'https://placehold.co/100x100/1A1A24/5C5E72?text=No+Image'} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{l.title}</p>
                  <p className="text-[10px] text-[#5C5E72]">{l.city}, {l.state} · ₦{l.price?.toLocaleString()}/year</p>
                  <p className="text-[10px] text-blue-400 mt-1">Posted by: {l.submitted_by_role ? (ROLE_LABELS[l.submitted_by_role as keyof typeof ROLE_LABELS] || l.submitted_by_role) : 'Unknown'}</p>
                </div>
              </div>
              {rejectId === l.id ? (
                <div className="mt-3 space-y-2">
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Why are you rejecting this listing?" rows={2} className="w-full rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 outline-none focus:border-red-500/50 resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => handleReject(l.id)} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">Confirm Reject</button>
                    <button onClick={() => { setRejectId(null); setRejectReason(''); }} className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[#5C5E72] text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => handleApprove(l.id)} className="flex-1 h-9 rounded-lg bg-green-500/10 text-green-400 text-xs font-medium border border-green-500/20 hover:bg-green-500/20 transition-colors">Approve</button>
                  <button onClick={() => setRejectId(l.id)} className="flex-1 h-9 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20 hover:bg-red-500/20 transition-colors">Reject</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── REPORTS TAB ───────────────────────────────────
function ReportsTabDirector({ profile, refresh }: { profile: Profile; refresh: () => void }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { reports: data } = await getReports();
    setReports(data || []);
    setLoading(false);
  }

  async function handleResolve(id: string) {
    await resolveReport(id, profile.user_id);
    toast.success('Resolved');
    load();
    refresh();
  }

  async function handleDismiss(id: string) {
    await dismissReport(id, profile.user_id);
    toast.success('Dismissed');
    load();
    refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {reports.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No reports</p> : reports.map(r => (
        <div key={r.id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${r.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-green-500/10 text-green-400'}`}>{r.status}</span>
            <span className="text-[8px] text-[#5C5E72]">{new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          <p className="text-xs text-white font-medium">{r.reason}</p>
          <p className="text-[10px] text-[#5C5E72]">By: {r.profiles?.username || 'Unknown'}</p>
          {r.status === 'pending' && (
            <div className="flex gap-2 mt-2">
              <button onClick={() => handleResolve(r.id)} className="flex-1 h-7 rounded-lg bg-green-500/10 text-green-400 text-[10px]">Resolve</button>
              <button onClick={() => handleDismiss(r.id)} className="flex-1 h-7 rounded-lg bg-[#1A1A24] text-[#5C5E72] text-[10px]">Dismiss</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── AUDIT TAB ─────────────────────────────────────
function AuditTabDirector() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { logs: data } = await getAuditLogs();
      setLogs(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {logs.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No audit logs</p> : logs.map(l => (
        <div key={l.id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-white">{l.action}</span>
            <span className="text-[8px] text-[#5C5E72]">{new Date(l.created_at).toLocaleString()}</span>
          </div>
          <p className="text-[10px] text-[#5C5E72]">{l.details}</p>
          <p className="text-[9px] text-[#5C5E72]">By: {l.performed_by_email}</p>
        </div>
      ))}
    </div>
  );
}