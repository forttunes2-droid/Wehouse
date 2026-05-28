import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, getAllListingsAdmin, getReports,
  resolveReport, dismissReport, logAuditAction,
  getAllWorkers,
  updateUserRole, deleteListing,
} from '@/lib/supabase';
import type { Profile } from '@/types';
import { AnnouncementsTab, HotelsTab } from './CreatorDashboard';
import { isCreator } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { Toaster, toast } from 'sonner';
import { Input } from '@/components/ui/input';

interface AdminDashboardProps {
  profile: Profile;
  onLogout: () => void;
  isStateAdmin?: boolean;
  isAssistant?: boolean;
}

type AdminTab = 'overview' | 'staff' | 'users' | 'listings' | 'reports' | 'announcements' | 'hotels';

export default function AdminDashboard({ profile, onLogout, isStateAdmin, isAssistant }: AdminDashboardProps) {
  const dashboardLabel = isStateAdmin ? ROLE_LABELS.state_admin : isAssistant ? ROLE_LABELS.assistant_state_admin : ROLE_LABELS.admin;
  const headerGradient = isStateAdmin ? 'from-emerald-600 to-emerald-800' : isAssistant ? 'from-teal-600 to-teal-800' : 'from-[#3B82F6] to-[#2563EB]';
  const badgeClass = isStateAdmin ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : isAssistant ? 'text-teal-400 bg-teal-500/10 border-teal-500/20' : 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20';

  // Persist dashboard sub-tab across refreshes
  const TAB_KEY = isStateAdmin ? 'wh_state_admin_tab' : isAssistant ? 'wh_assistant_tab' : 'wh_admin_tab';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved && ['overview','staff','users','listings','reports','announcements','hotels'].includes(saved) ? saved as AdminTab : 'overview';
    } catch { return 'overview'; }
  });

  const handleSetTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  }, [TAB_KEY]);

  const [stats, setStats] = useState({ users: 0, staff: 0, listings: 0, workers: 0, reports: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  // Admin (state_admin) sees entire state; Head of Staff (admin) sees only their LGA
  const scope = {
    state: profile.assigned_state || profile.state || '',
    lga: isStateAdmin || isAssistant ? '' : (profile.assigned_lga || profile.city || ''),
  };

  const refresh = () => setRefreshKey(k => k + 1);

  // Load scoped stats
  useEffect(() => {
    async function load() {
      const [{ users }, { listings }, { workers }, { reports }] = await Promise.all([
        getAllUsers(), getAllListingsAdmin(), getAllWorkers(), getReports()
      ]);

      // Admin: match state only; Head of Staff: match state + lga
      const inScope = (item: any) => {
        const matchesState = item.state === scope.state;
        const matchesLga = scope.lga ? item.city === scope.lga : true;
        return matchesState && matchesLga && !item.deleted;
      };

      const scopedUsers = (users || []).filter(inScope);
      const scopedStaff = scopedUsers.filter((u: any) => u.role === 'staff');
      const scopedListings = (listings || []).filter(inScope);
      const scopedWorkers = (workers || []).filter(inScope);

      setStats({
        users: scopedUsers.filter((u: any) => u.role === 'user').length,
        staff: scopedStaff.length,
        listings: scopedListings.length,
        workers: scopedWorkers.length,
        reports: (reports || []).filter((r: any) => r.status === 'pending').length,
      });
    }
    if (scope.state) load();
  }, [scope.state, scope.lga, refreshKey]);

  const tabs: Array<{ id: AdminTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { id: 'users', label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'listings', label: 'Listings', icon: 'M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z' },
    { id: 'reports', label: 'Reports', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
    { id: 'announcements', label: 'Announce', icon: 'M11 5.882V19.24a1.4 1.4 0 0 1-2.338.995l-3.867-3.43a1.4 1.4 0 0 0-.93-.338H2a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1.865a1.4 1.4 0 0 0 .93-.338l3.867-3.43A1.4 1.4 0 0 1 11 5.882z' },
    { id: 'hotels', label: 'Hotels', icon: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM2 20h20M12 11v-6M9 11v-2M15 11v-2' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-6">
      <Toaster position="top-center" toastOptions={{ style: { background: '#1A1A24', color: '#fff', border: '1px solid #232330' } }} />

      {/* Header */}
      <header className={`bg-gradient-to-r ${headerGradient} px-5 pt-6 pb-8`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-white">{dashboardLabel} Dashboard</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClass}`}>{ROLE_LABELS[profile.role as keyof typeof ROLE_LABELS] || profile.role}</span>
            </div>
            <p className="text-xs text-white/60">
              {scope.state}{scope.lga ? ` · ${scope.lga}` : ' (State-wide)'}
            </p>
          </div>
          <button onClick={onLogout} className="h-8 px-3 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors">Logout</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { label: 'Users', value: stats.users },
            { label: 'Staff', value: stats.staff },
            { label: 'Listings', value: stats.listings },
            { label: 'Pending', value: stats.reports },
          ].map(s => (
            <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center">
              <div className="text-lg font-bold text-white">{s.value}</div>
              <div className="text-[9px] text-white/60">{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="px-5 -mt-4">
        <div className="glass rounded-xl p-1 flex gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleSetTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium whitespace-nowrap rounded-lg transition-all flex-shrink-0 ${
                activeTab === tab.id ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C] hover:text-white'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d={tab.icon} /></svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pt-4">
        {activeTab === 'overview' && <OverviewTab stats={stats} scope={scope} isStateAdmin={isStateAdmin} />}
        {activeTab === 'users' && <UsersTab scope={scope} profile={profile} refresh={refresh} isStateAdmin={isStateAdmin} isAssistant={isAssistant} />}
        {activeTab === 'listings' && <ListingsTab scope={scope} refresh={refresh} />}
        {activeTab === 'reports' && <ReportsTab profile={profile} />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope={scope} />}
        {activeTab === 'hotels' && <HotelsTab profile={profile} />}
      </div>
    </div>
  );
}

// ─── OVERVIEW ─────────────────────────────────────
function OverviewTab({ stats, scope, isStateAdmin }: { stats: any; scope: { state: string; lga: string }; isStateAdmin?: boolean }) {
  return (
    <div className="space-y-3">
      <div className={`glass rounded-2xl p-4 border ${isStateAdmin ? 'border-emerald-500/10' : 'border-[#3B82F6]/10'}`}>
        <p className="text-xs text-[#8A8B9C]">
          Managing {stats.users} users, {stats.staff} staff, {stats.listings} listings in {scope.state}{scope.lga ? ` · ${scope.lga}` : ' (entire state)'}
        </p>
        {isStateAdmin && (
          <p className="text-[10px] text-emerald-400/70 mt-1">
            As Admin, you can promote users to Head of Staff within your state.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── USERS ────────────────────────────────────────
function UsersTab({ scope, profile, refresh, isStateAdmin, isAssistant }: { scope: { state: string; lga: string }; profile: Profile; refresh: () => void; isStateAdmin?: boolean; isAssistant?: boolean }) {
  const { dialogProps } = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
  }, [scope.state, scope.lga]);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    // State Admin: filter by state only; Local Admin: filter by state + lga
    const filtered = (data || []).filter((u: any) => {
      const matchesState = u.state === scope.state;
      const matchesLga = scope.lga ? u.city === scope.lga : true;
      return matchesState && matchesLga;
    });
    setUsers(filtered);
    setLoading(false);
  }

  async function handleRole(userId: string, newRole: string) {
    const target = users.find(u => u.user_id === userId);
    if (!target) return;
    if (userId === profile.user_id) { toast.error('Cannot change own role'); return; }
    if (isCreator(target.role)) { toast.error('Creator cannot be changed'); return; }
    if (target.role === 'worker') { toast.error('Worker role is locked'); return; }
    if (target.role === 'state_admin' && !isStateAdmin) { toast.error('Only Creator can change State Admin'); return; }

    // State Admin can only assign roles within their state, and can promote to Admin
    // Assistant is read-only
    if (isAssistant) { toast.error('Assistant Admin is read-only'); return; }

    // For local admin: can only change user <-> staff
    // For state admin: can change user/staff/admin/assistant_state_admin within their state
    const allowedRoles = isStateAdmin
      ? ['user', 'staff', 'admin', 'assistant_state_admin']
      : ['user', 'staff'];

    if (!allowedRoles.includes(newRole)) {
      const roleNames = allowedRoles.map(r => ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r);
      toast.error(`As ${ROLE_LABELS[profile.role as keyof typeof ROLE_LABELS] || profile.role}, you can only assign: ${roleNames.join(', ')}`);
      return;
    }

    const { error } = await updateUserRole(userId, newRole, target.role, profile.user_id, profile.email, target.email);
    if (error) { toast.error(error.message || 'Failed'); return; }
    await logAuditAction(profile.user_id, profile.email, 'update_role', 'user', userId, `Changed role from ${target.role} to ${newRole}`);
    const oldLabel = ROLE_LABELS[target.role as keyof typeof ROLE_LABELS] || target.role;
    const newLabel = ROLE_LABELS[newRole as keyof typeof ROLE_LABELS] || newRole;
    toast.success(`Role changed: ${oldLabel} → ${newLabel}`);
    load();
    refresh();
  }

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()));

  const roleColors: Record<string, string> = {
    creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    creator_admin: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    state_admin: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    assistant_state_admin: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
    staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
    worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  };

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white" />
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {isAssistant && <p className="text-[10px] text-teal-400/70">Read-only view. You cannot modify users.</p>}
          {filtered.map(u => (
            <div key={u.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
                  {(u.username || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">@{u.username || '...'}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full border ${roleColors[u.role] || roleColors.user}`}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}</span>
                  </div>
                  <span className="text-[10px] text-[#5C5E72]">{u.email} · {u.city}</span>
                </div>
              </div>
              {!isAssistant && (
                <select
                  value={u.role}
                  onChange={e => handleRole(u.user_id, e.target.value)}
                  className="mt-2 w-full h-7 rounded-lg bg-[#1A1A24] border border-[#232330] text-[10px] px-2 text-white"
                  disabled={isCreator(u.role) || u.role === 'worker' || u.role === 'state_admin'}
                >
                  <option value="user">User</option>
                  <option value="staff">Staff</option>
                  <option value="admin">{ROLE_LABELS.admin}</option>
                  {isStateAdmin && <option value="assistant_state_admin">{ROLE_LABELS.assistant_state_admin}</option>}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LISTINGS ─────────────────────────────────────
function ListingsTab({ scope, refresh }: { scope: { state: string; lga: string }; refresh: () => void }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [scope.state, scope.lga]);

  async function load() {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    const filtered = (data || []).filter((l: any) => l.state === scope.state && (scope.lga ? l.city === scope.lga : true));
    setListings(filtered);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const { error } = await deleteListing(id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Deleted');
    load();
    refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {listings.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No listings in this area</p> : listings.map(l => (
        <div key={l.id} className="glass rounded-xl p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{l.title}</p>
            <p className="text-[10px] text-[#5C5E72]">{l.city} · ₦{l.price?.toLocaleString()}/year</p>
          </div>
          <button onClick={() => handleDelete(l.id)} className="h-7 px-2 rounded-lg bg-red-500/10 text-red-400 text-[10px] hover:bg-red-500/20">Delete</button>
        </div>
      ))}
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────
function ReportsTab({ profile }: { profile: Profile }) {
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
  }

  async function handleDismiss(id: string) {
    await dismissReport(id, profile.user_id);
    toast.success('Dismissed');
    load();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {reports.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No pending reports</p> : reports.map(r => (
        <div key={r.id} className="glass rounded-xl p-3">
          <p className="text-xs text-white">{r.reason}</p>
          <p className="text-[10px] text-[#5C5E72] mt-1">{r.status}</p>
          <div className="flex gap-2 mt-2">
            <button onClick={() => handleResolve(r.id)} className="flex-1 h-7 rounded-lg bg-green-500/10 text-green-400 text-[10px] hover:bg-green-500/20">Resolve</button>
            <button onClick={() => handleDismiss(r.id)} className="flex-1 h-7 rounded-lg bg-red-500/10 text-red-400 text-[10px] hover:bg-red-500/20">Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
