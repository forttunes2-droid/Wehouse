import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, getUserCount, updateUserRole, deleteUser, restoreUser,
  getAllListingsAdmin, deleteListing, getReports,
  resolveReport, dismissReport, getAuditLogs, getSystemSettings,
  updateSystemSetting, logAuditAction, getAllWorkers, updateWorkerStatus, parseWorkerStatus,
  sendOfficialMessage,
} from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import { isCreator, validateRoleTransition } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import type { Profile, Listing } from '@/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { Toaster, toast } from 'sonner';

type AdminTab = 'overview' | 'users' | 'listings' | 'reports' | 'audit' | 'settings' | 'workers' | 'announcements';

interface CreatorDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
}

// ─── ROLE CONFIG ───────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
};

export default function CreatorDashboard({ profile, onLogout, onGoToNewListing }: CreatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const isCreatorAccount = isCreator(profile.role);

  const tabs = [
    { id: 'overview' as AdminTab, label: 'Overview', icon: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'users' as AdminTab, label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'listings' as AdminTab, label: 'Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'reports' as AdminTab, label: 'Reports', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
    { id: 'audit' as AdminTab, label: 'Audit', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
    { id: 'settings' as AdminTab, label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
    { id: 'workers' as AdminTab, label: 'Workers', icon: 'M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z' },
    { id: 'announcements' as AdminTab, label: 'Announce', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Creator Header — Differentiated from user profile */}
      <header className="bg-gradient-to-b from-[#1A1029] via-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Purple gradient for creator — distinct from blue admin */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-[#7C3AED] flex items-center justify-center glow-purple-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-white">
                  {isCreatorAccount ? 'Creator' : profile.role === 'admin' ? 'Admin' : 'Staff'} Dashboard
                </h1>
                {isCreatorAccount && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    CREATOR
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[#5C5E72]">@{profile.username}</p>
            </div>
          </div>
          <button onClick={onLogout} className="text-[10px] text-[#5C5E72] hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10">
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-[#1E1E2C] overflow-x-auto scrollbar-hide mb-4">
        <div className="flex px-5 gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap rounded-t-lg transition-all ${
                  isActive
                    ? isCreatorAccount ? 'text-purple-400 border-b-2 border-purple-400' : 'text-[#3B82F6] border-b-2 border-[#3B82F6]'
                    : 'text-[#5C5E72] hover:text-[#8B8DA0]'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-lg mx-auto px-5 pb-6">
        {activeTab === 'overview' && <OverviewTab profile={profile} isCreator={isCreatorAccount} onGoToNewListing={onGoToNewListing} onGoToUsers={() => setActiveTab('users')} />}
        {activeTab === 'users' && <UsersTab profile={profile} />}
        {activeTab === 'listings' && <ListingsTab profile={profile} />}
        {activeTab === 'reports' && <ReportsTab profile={profile} />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'settings' && <SettingsTab profile={profile} isCreator={isCreatorAccount} />}
        {activeTab === 'workers' && <WorkerApplicationsTab profile={profile} />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope="all" />}
      </main>
    </div>
  );
}

// ─── OVERVIEW ──────────────────────────────────────
function OverviewTab({ profile, isCreator, onGoToNewListing, onGoToUsers }: { profile: Profile; isCreator: boolean; onGoToNewListing?: () => void; onGoToUsers?: () => void }) {
  const [stats, setStats] = useState({ users: 0, listings: 0, reports: 0, today: 0 });

  useEffect(() => {
    async function load() {
      const { total, today } = await getUserCount();
      const { listings } = await getAllListingsAdmin();
      const { reports } = await getReports();
      setStats({ users: total, listings: listings?.length || 0, reports: reports?.filter(r => r.status === 'pending').length || 0, today });
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total Users', value: stats.users, color: isCreator ? 'from-purple-500 to-[#7C3AED]' : 'from-[#3B82F6] to-[#2563EB]', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
          { label: 'Listings', value: stats.listings, color: 'from-[#10B981] to-[#059669]', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
          { label: 'Pending Reports', value: stats.reports, color: stats.reports > 0 ? 'from-[#EF4444] to-[#DC2626]' : 'from-[#6B7280] to-[#4B5563]', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' },
          { label: 'New Today', value: stats.today, color: isCreator ? 'from-purple-400 to-purple-600' : 'from-[#8B5CF6] to-[#7C3AED]', icon: 'M12 5v14M5 12h14' },
        ].map(c => (
          <div key={c.label} className={`bg-gradient-to-br ${c.color} rounded-2xl p-4 relative overflow-hidden`}>
            <svg className="absolute top-3 right-3 w-8 h-8 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={c.icon} /></svg>
            <div className="text-2xl font-bold text-white relative z-10">{c.value}</div>
            <div className="text-[10px] text-white/70 relative z-10">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      {onGoToNewListing && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onGoToNewListing} className="glass rounded-2xl p-4 flex items-center gap-3 card-hover text-left group border border-green-500/10">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Add Listing</div>
              <div className="text-[10px] text-[#5C5E72]">Post new property</div>
            </div>
          </button>
          <button onClick={onGoToUsers} className="glass rounded-2xl p-4 flex items-center gap-3 card-hover text-left group border border-[#3B82F6]/10">
            <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center group-hover:bg-[#3B82F6]/20 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-white">All Users</div>
              <div className="text-[10px] text-[#5C5E72]">Manage users</div>
            </div>
          </button>
        </div>
      )}

      {/* Identity Card — Creator gets purple accent */}
      <div className={`glass rounded-2xl p-5 ${isCreator ? 'border border-purple-500/10' : ''}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isCreator ? 'bg-purple-500/10' : 'bg-[#3B82F6]/10'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isCreator ? '#A78BFA' : '#3B82F6'} strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {isCreator ? 'Creator Identity' : profile.role === 'admin' ? 'Admin Identity' : 'Staff Identity'}
            </h3>
          </div>
        </div>
        <div className="space-y-2.5">
          {[{ l: 'User ID', v: profile.user_id }, { l: 'Username', v: `@${profile.username}` }, { l: 'Email', v: profile.email }, { l: 'Role', v: isCreator ? 'Creator' : profile.role.charAt(0).toUpperCase() + profile.role.slice(1) }].map(i => (
            <div key={i.l} className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">{i.l}</span>
              <span className="text-[#8B8DA0]">{i.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Creator Tools — Only for creator */}
      {isCreator && (
        <div className="glass rounded-2xl p-5 border border-purple-500/10">
          <h3 className="text-sm font-semibold text-purple-400 mb-3">Creator Tools</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              Full platform control
            </div>
            <div className="flex items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              Admin management
            </div>
            <div className="flex items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              System settings
            </div>
            <div className="flex items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              Critical controls
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── USERS ─────────────────────────────────────────
function UsersTab({ profile }: { profile: Profile }) {
  const { ask, dialogProps } = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { users: data } = await getAllUsers();
    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRole(userId: string, newRole: string) {
    const target = users.find(u => u.user_id === userId);
    if (!target) { toast.error('User not found'); return; }

    // Cannot change own role
    if (userId === profile.user_id) { toast.error('You cannot change your own role'); return; }

    // Validate using the permission matrix
    const validation = validateRoleTransition(profile.role, target.role, newRole);
    if (!validation.allowed) {
      toast.error(validation.reason || 'Role change not allowed');
      return;
    }

    // Execute the change
    const { error } = await updateUserRole(
      userId, newRole, target.role,
      profile.user_id, profile.email,
      target.email
    );
    if (error) { toast.error(error.message || 'Failed'); return; }

    await logAuditAction(profile.user_id, profile.email, 'update_role', 'user', userId, `Changed role from ${target.role} to ${newRole}`);
    toast.success(`Role changed: ${target.role} → ${newRole}`);
    load();
  }

  async function handleDelete(userId: string) {
    const target = users.find(u => u.user_id === userId);
    if (!target) { toast.error('User not found'); return; }
    if (isCreator(target.role)) { toast.error('Creator accounts cannot be deleted'); return; }
    if (userId === profile.user_id) { toast.error('You cannot delete your own account from here'); return; }

    const sdOk = await ask({ title: 'Delete this user?', confirmLabel: 'Delete', variant: 'danger' });
    if (!sdOk) return;
    const { error } = await deleteUser(userId);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    await logAuditAction(profile.user_id, profile.email, 'delete_user', 'user', userId, 'User soft-deleted');
    toast.success('User deleted');
    load();
  }

  async function handleRestore(userId: string) {
    const restoreOk = await ask({ title: 'Restore this user?', confirmLabel: 'Restore', variant: 'info' });
    if (!restoreOk) return;
    const { error } = await restoreUser(userId);
    if (error) { toast.error('Restore failed: ' + error.message); return; }
    await logAuditAction(profile.user_id, profile.email, 'restore_user', 'user', userId, 'User restored');
    toast.success('User restored');
    load();
  }

  const filtered = users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20" />

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{filtered.length} Users</div>
          {filtered.map(u => {
            const roleBadge = ROLE_COLORS[u.role] || ROLE_COLORS.user;
            const isCreatorAccount = isCreator(u.role);
            const isWorkerAccount = u.role === 'worker';
            const canDelete = !isCreatorAccount && u.user_id !== profile.user_id;
            const isDeleted = u.deleted;

            return (
              <div key={u.id} className={`glass rounded-xl p-3 ${isDeleted ? 'opacity-50 border-red-500/10' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold relative">
                    {(u.username || 'U').charAt(0).toUpperCase()}
                    {isDeleted && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-[#12121A]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-semibold text-white truncate">@{u.username || '...'}</div>
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${roleBadge}`}>
                        {u.role}
                      </span>
                      {isDeleted && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">DELETED</span>}
                    </div>
                    <div className="text-[10px] text-[#5C5E72] truncate">{u.email}</div>
                  </div>
                </div>

                <div className="flex gap-2 mt-2.5">
                  {isDeleted ? (
                    <button
                      onClick={() => handleRestore(u.user_id)}
                      className="flex-1 h-7 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors"
                    >
                      Restore
                    </button>
                  ) : isCreatorAccount ? (
                    <div className="flex-1 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] px-2 flex items-center font-medium">
                      Creator — cannot be changed
                    </div>
                  ) : isWorkerAccount ? (
                    <div className="flex-1 h-7 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400 text-[10px] px-2 flex items-center font-medium">
                      Worker — signed up as worker
                    </div>
                  ) : (
                    <select
                      value={u.role}
                      onChange={(e) => handleRole(u.user_id, e.target.value)}
                      className="flex-1 h-7 rounded-lg bg-[#1A1A24] border border-[#232330] text-[10px] px-2 text-white"
                    >
                      <option value="user">User</option>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}

                  {!isDeleted && (
                    <button
                      onClick={() => handleDelete(u.user_id)}
                      disabled={!canDelete}
                      className="h-7 px-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LISTINGS ──────────────────────────────────────
function ListingsTab({ profile }: { profile: Profile }) {
  const { ask, dialogProps } = useConfirm();
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    setListings(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDeleteL(id: string) {
    const rmOk = await ask({ title: 'Delete this listing?', confirmLabel: 'Delete', variant: 'danger' });
    if (!rmOk) return;
    await deleteListing(id);
    await logAuditAction(profile.user_id, profile.email, 'delete_listing', 'listing', id, 'Listing removed');
    toast.success('Listing removed');
    load();
  }

  const filtered = filter === 'all' ? listings : listings.filter(l => l.availability_status === filter);

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {['all', 'available', 'reserved', 'occupied', 'hidden'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 h-8 rounded-lg text-[10px] font-medium capitalize whitespace-nowrap transition-colors ${filter === f ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] border border-[#232330] text-[#5C5E72] hover:text-white'}`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(l => (
            <div key={l.id} className="glass rounded-xl p-3">
              <div className="flex gap-3">
                <img src={l.images?.[0] || 'https://placehold.co/60x60/1A1A24/5C5E72?text=No+Image'} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{l.title}</div>
                  <div className="text-[10px] text-[#3B82F6] font-bold">N{l.price.toLocaleString()}</div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${l.availability_status === 'available' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{l.availability_status}</span>
                </div>
              </div>
              <button onClick={() => handleDeleteL(l.id)} className="mt-2 w-full h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">Remove</button>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-10 text-xs text-[#5C5E72]">No listings</div>}
        </div>
      )}
    </div>
  );
}

// ─── REPORTS ───────────────────────────────────────
function ReportsTab({ profile }: { profile: Profile }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved' | 'dismissed'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { reports: data, error: err } = await getReports();
      if (err) {
        setError('Unable to load reports: ' + (err.message || 'Permission denied'));
      } else {
        setReports(data || []);
      }
    } catch {
      setError('Unable to load reports. Admin access required.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleResolve(id: string) {
    const { error } = await resolveReport(id, profile.user_id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    await logAuditAction(profile.user_id, profile.email, 'resolve_report', 'report', id, 'Resolved');
    toast.success('Resolved');
    load();
  }

  async function handleDismiss(id: string) {
    const { error } = await dismissReport(id, profile.user_id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    await logAuditAction(profile.user_id, profile.email, 'dismiss_report', 'report', id, 'Dismissed');
    toast.success('Dismissed');
    load();
  }

  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter);
  const tabs: Array<{ id: typeof filter; label: string; color: string }> = [
    { id: 'all', label: `All (${reports.length})`, color: 'text-white' },
    { id: 'pending', label: `Pending (${reports.filter(r => r.status === 'pending').length})`, color: 'text-amber-400' },
    { id: 'resolved', label: `Resolved (${reports.filter(r => r.status === 'resolved').length})`, color: 'text-green-400' },
    { id: 'dismissed', label: `Dismissed (${reports.filter(r => r.status === 'dismissed').length})`, color: 'text-gray-400' },
  ];

  return (
    <div className="space-y-3">
      {error && (
        <div className="glass rounded-2xl p-4 border border-red-500/10 flex items-start gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" className="flex-shrink-0 mt-0.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
          </svg>
          <div>
            <p className="text-sm font-medium text-red-400">Access Denied</p>
            <p className="text-[11px] text-[#5C5E72] mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            className={`h-8 px-3 rounded-xl text-[11px] font-medium whitespace-nowrap transition-all ${
              filter === t.id ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20' : 'bg-[#1A1A24] text-[#5C5E72] border border-[#232330]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#5C5E72]">No reports</div>
      ) : (
        filtered.map(r => (
          <div key={r.id} className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  r.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                  r.status === 'resolved' ? 'bg-green-500/10 text-green-400' :
                  'bg-gray-500/10 text-gray-400'
                }`}>{r.status}</span>
                <span className="text-[10px] text-[#5C5E72]">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              {r.reporter_id && (
                <span className="text-[9px] text-[#5C5E72]">Reporter: {r.reporter_id.slice(0, 8)}...</span>
              )}
            </div>
            <p className="text-xs text-white font-medium mb-1">{r.reason}</p>
            <div className="flex gap-3 mb-3">
              {r.listing_id && <span className="text-[9px] text-[#5C5E72] bg-[#1A1A24] px-2 py-0.5 rounded-md">Listing: {r.listing_id.slice(0, 12)}</span>}
              {r.reported_user_id && <span className="text-[9px] text-[#5C5E72] bg-[#1A1A24] px-2 py-0.5 rounded-md">User: {r.reported_user_id.slice(0, 12)}</span>}
            </div>
            {r.status === 'pending' && (
              <div className="flex gap-2">
                <button onClick={() => handleResolve(r.id)} className="flex-1 h-8 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors">Resolve</button>
                <button onClick={() => handleDismiss(r.id)} className="flex-1 h-8 rounded-lg bg-gray-500/10 border border-gray-500/20 text-gray-400 text-[10px] hover:bg-gray-500/20 transition-colors">Dismiss</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── AUDIT ─────────────────────────────────────────
function AuditTab() {
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

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#5C5E72]">No audit logs yet</div>
      ) : (
        logs.map(l => (
          <div key={l.id} className="glass rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">{l.action}</span>
              <span className="text-[10px] text-[#5C5E72]">{new Date(l.created_at).toLocaleString()}</span>
            </div>
            <p className="text-xs text-white">{l.admin_email}</p>
            {l.details && <p className="text-[10px] text-[#5C5E72] mt-0.5">{l.details}</p>}
          </div>
        ))
      )}
    </div>
  );
}

// ─── SETTINGS ──────────────────────────────────────
function SettingsTab({ profile, isCreator }: { profile: Profile; isCreator: boolean }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { settings: data, error } = await getSystemSettings();
      const map: Record<string, string> = {};
      if (data) {
        data.forEach(s => { if (s.value !== null && s.value !== undefined) map[s.key] = s.value; });
      }
      // Defaults are already merged in getSystemSettings, but ensure all keys exist
      if (Object.keys(map).length === 0 || error) {
        map.platform_name = 'WeHouse';
        map.listing_approval_required = 'false';
        map.default_user_role = 'user';
        map.maintenance_mode = 'false';
        map.registration_open = 'true';
        map.max_listings_per_user = '5';
      }
      setSettings(map);
      setLoading(false);
    }
    load();
  }, []);

  async function handleUpdate(key: string, value: string) {
    const { error } = await updateSystemSetting(key, value, profile.user_id);
    if (error) {
      const msg = error.message || '';
      if (msg.includes('relation') || msg.includes('does not exist')) {
        toast.error('Settings table not found. Run the SQL migration in Supabase.');
      } else if (msg.includes('violates row-level')) {
        toast.error('Permission denied. Admin RLS not configured.');
      } else {
        toast.error('Save failed: ' + msg);
      }
      console.error('[Settings Error]', error);
      return;
    }
    await logAuditAction(profile.user_id, profile.email, 'update_setting', 'setting', key, `${key} = ${value}`);
    toast.success('Setting saved');
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;

  // Settings available to all admins
  const baseSettings = [
    { key: 'platform_name', label: 'Platform Name', type: 'text' as const },
    { key: 'listing_approval_required', label: 'Require Listing Approval', type: 'select' as const, options: [['false', 'No'], ['true', 'Yes']] },
    { key: 'default_user_role', label: 'Default User Role', type: 'select' as const, options: [['user', 'User'], ['staff', 'Staff'], ['admin', 'Admin']] },
  ];

  // Creator-only settings (critical system controls)
  const creatorOnlySettings = [
    { key: 'maintenance_mode', label: 'Maintenance Mode', type: 'select' as const, options: [['false', 'Off'], ['true', 'On']] },
    { key: 'registration_open', label: 'Allow New Registrations', type: 'select' as const, options: [['true', 'Yes'], ['false', 'No']] },
    { key: 'max_listings_per_user', label: 'Max Listings Per User', type: 'select' as const, options: [['5', '5'], ['10', '10'], ['20', '20'], ['unlimited', 'Unlimited']] },
  ];

  const allSettings = isCreator ? [...baseSettings, ...creatorOnlySettings] : baseSettings;

  return (
    <div className="space-y-4">
      {/* Permission banner */}
      {!isCreator && (
        <div className="glass rounded-2xl p-3 flex items-start gap-2 border border-amber-500/10">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <p className="text-[11px] text-amber-400">
            Some settings are restricted to the creator only.
          </p>
        </div>
      )}

      {isCreator && (
        <div className="glass rounded-2xl p-3 flex items-start gap-2 border border-purple-500/10">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" className="flex-shrink-0 mt-0.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <p className="text-[11px] text-purple-400">
            Full system control enabled. You have access to all platform settings.
          </p>
        </div>
      )}

      {allSettings.map(setting => (
        <div key={setting.key} className={`glass rounded-2xl p-4 ${
          creatorOnlySettings.find(s => s.key === setting.key) ? 'border border-purple-500/10' : ''
        }`}>
          <label className="text-xs text-[#8B8DA0] font-medium mb-2 block">
            {setting.label}
            {creatorOnlySettings.find(s => s.key === setting.key) && (
              <span className="ml-1.5 text-[8px] px-1 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">CREATOR</span>
            )}
          </label>
          {setting.type === 'text' ? (
            <div className="flex gap-2">
              <input
                value={settings[setting.key] || ''}
                onChange={(e) => setSettings({ ...settings, [setting.key]: e.target.value })}
                className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 focus:border-[#3B82F6] focus:ring-[#3B82F6]/20 outline-none"
              />
              <button onClick={() => handleUpdate(setting.key, settings[setting.key] || '')} className="h-10 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors">Save</button>
            </div>
          ) : (
            <select
              value={settings[setting.key] || ''}
              onChange={(e) => { setSettings({ ...settings, [setting.key]: e.target.value }); handleUpdate(setting.key, e.target.value); }}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 focus:border-[#3B82F6] outline-none"
            >
              {setting.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── WORKER APPLICATIONS TAB ───────────────────────

function WorkerApplicationsTab({ profile }: { profile: Profile }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'verified' | 'suspended' | 'rejected'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { workers: data } = await getAllWorkers();
    setWorkers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleStatus(userId: string, status: 'verified' | 'suspended' | 'rejected') {
    const { error } = await updateWorkerStatus(userId, status);
    if (error) {
      toast.error('Save failed: ' + (error.message || 'Unknown error'));
      console.error('[Worker Status Error]', JSON.stringify(error));
      return;
    }
    await logAuditAction(profile.user_id, profile.email, `worker_${status}`, 'worker', userId, `Worker ${status}`);
    toast.success(`Worker ${status}`);
    load();
  }

  const filtered = filter === 'all' ? workers : workers.filter(w => parseWorkerStatus(w) === filter);

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {(['all', 'pending', 'verified', 'suspended', 'rejected'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-shrink-0 h-8 px-3 rounded-lg text-[10px] font-medium capitalize transition-colors ${
              filter === f ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] border border-[#232330] text-[#5C5E72] hover:text-white'
            }`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#5C5E72]">No worker applications</div>
      ) : (
        filtered.map(w => (
          <div key={w.user_id} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {w.avatar_url ? <img src={w.avatar_url} alt="" className="w-full h-full object-cover rounded-xl" /> : (w.full_name || w.username || 'W').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate">{w.full_name || w.username || '...'}</span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${
                    parseWorkerStatus(w) === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    parseWorkerStatus(w) === 'verified' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    parseWorkerStatus(w) === 'suspended' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                    'bg-gray-500/10 text-gray-400 border-gray-500/20'
                  }`}>{parseWorkerStatus(w)}</span>
                </div>
                <div className="text-[10px] text-[#5C5E72]">{WORKER_OCCUPATION_LABELS[w.worker_occupation] || w.worker_occupation} · {w.city || 'No location'}</div>
              </div>
            </div>
            {w.worker_bio && <p className="text-[10px] text-[#8A8B9C] mb-3 italic">{w.worker_bio}</p>}
            <div className="flex gap-2">
              <button onClick={() => handleStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors">Approve</button>
              <button onClick={() => handleStatus(w.user_id, 'suspended')} className="flex-1 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] hover:bg-amber-500/20 transition-colors">Suspend</button>
              <button onClick={() => handleStatus(w.user_id, 'rejected')} className="flex-1 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">Reject</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}


// ─── ANNOUNCEMENTS TAB ─────────────────────────────

export function AnnouncementsTab({ profile, scope }: { profile: Profile; scope: 'all' | { state: string; lga: string } }) {
  const [users, setUsers] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [sendToAll, setSendToAll] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { ask, dialogProps } = useConfirm();

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(users);
      return;
    }
    const q = search.toLowerCase();
    setFiltered(users.filter((u) => (u.username || '').toLowerCase().includes(q)));
  }, [search, users]);

  async function loadUsers() {
    const { users: data } = await getAllUsers();
    let list = (data || []).filter((u: any) => !u.deleted && u.user_id !== profile.user_id);

    // Scope filter for admin
    if (scope !== 'all' && typeof scope === 'object') {
      list = list.filter((u: any) => u.state === scope.state && u.city === scope.lga);
    }

    setUsers(list);
    setFiltered(list);
  }

  async function handleSend() {
    if (!message.trim()) {
      toast.error('Type a message');
      return;
    }

    const ok = await ask({
      title: sendToAll ? `Send to all ${users.length} users?` : 'Send this message?',
      confirmLabel: 'Send',
      variant: 'info',
    });
    if (!ok) return;

    setSending(true);
    toast.loading('Sending...', { id: 'send-announce' });

    const recipientIds = sendToAll ? [] : selectedUser ? [selectedUser] : [];
    if (!sendToAll && !selectedUser) {
      toast.error('Select a user or check Send to All');
      setSending(false);
      return;
    }

    const { error } = await sendOfficialMessage(
      profile.user_id,
      profile.role === 'creator' || profile.role === 'creator_admin' ? 'creator' : 'admin',
      profile.username || 'Admin',
      message.trim(),
      recipientIds
    );

    toast.dismiss('send-announce');
    setSending(false);

    if (error) {
      toast.error('Failed to send');
      return;
    }

    toast.success(sendToAll ? 'Sent to all users!' : 'Message sent!');
    setMessage('');
    setSelectedUser(null);
  }

  return (
    <div className="space-y-4">
      <ConfirmDialog {...dialogProps} />

      {/* Message input */}
      <div className="glass rounded-2xl p-4">
        <h3 className="text-sm font-bold text-white mb-3">Send Announcement</h3>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your announcement..."
          rows={3}
          className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none mb-3"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sendToAll}
              onChange={(e) => {
                setSendToAll(e.target.checked);
                setSelectedUser(null);
              }}
              className="w-4 h-4 rounded border-[#2A2A3A] bg-[#1A1A24] text-[#3B82F6]"
            />
            <span className="text-xs text-[#8A8B9C]">Send to all {users.length} users</span>
          </label>
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="h-9 px-4 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-30 flex items-center gap-1.5"
          >
            {sending && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {/* User list (hidden when send to all is checked) */}
      {!sendToAll && (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-[#1E1E2C]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by @username..."
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-[#5C5E72] text-center py-6">No users found</p>
            ) : (
              filtered.map((u: any) => (
                <button
                  key={u.user_id}
                  onClick={() => setSelectedUser(selectedUser === u.user_id ? null : u.user_id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[#1E1E2C]/50 transition-colors ${
                    selectedUser === u.user_id ? 'bg-[#3B82F6]/10' : 'hover:bg-[#12121A]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {(u.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">@{u.username || 'user'}</p>
                    <p className="text-[10px] text-[#5C5E72]">{u.city}{u.state ? `, ${u.state}` : ''}</p>
                  </div>
                  {selectedUser === u.user_id && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
