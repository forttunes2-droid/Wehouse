import { useState, useEffect, useCallback } from 'react';
import {
  supabase,
  getAllUsers, getUserCount, updateUserRole, deleteUser, restoreUser,
  getAllListingsAdmin, deleteListing, getReports,
  resolveReport, dismissReport, getAuditLogs, logAuditAction, getAllWorkers, updateWorkerStatus, parseWorkerStatus,
  sendAnnouncement, deleteAnnouncement, getAnnouncementsSentBy, getAllAnnouncements,
  getFilteredRecipientCount, checkAnnouncementTables, toggleMaintenanceExempt,
  getHotels, createHotel, updateHotel, deleteHotel, createHotelRoom, deleteHotelRoom, uploadHotelImage, getHotelBookingsForHotel, updateBookingStatus, getHotelRooms,
} from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS, ROLE_LABELS } from '@/types';
import { isCreator, validateRoleTransition, canSendAnnouncements } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import type { Profile, Listing, AnnouncementTargetType, Hotel, HotelRoom, HotelBooking } from '@/types';
import { HOTEL_AMENITIES, ROOM_TYPES, BED_TYPES } from '@/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import SettingsTab from './SettingsTab';
import { Toaster, toast } from 'sonner';

type AdminTab = 'overview' | 'users' | 'listings' | 'reports' | 'audit' | 'settings' | 'workers' | 'announcements' | 'hotels';

interface CreatorDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
}

// ─── ROLE CONFIG ───────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  creator_admin: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  state_admin: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  assistant_state_admin: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
};

export default function CreatorDashboard({ profile, onLogout, onGoToNewListing }: CreatorDashboardProps) {
  // Persist dashboard sub-tab across refreshes
  const DASHBOARD_TAB_KEY = isCreator(profile.role) ? 'wh_creator_tab' : 'wh_admin_tab';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const saved = localStorage.getItem(DASHBOARD_TAB_KEY);
      return saved && ['overview','users','listings','reports','audit','settings','workers','announcements','hotels'].includes(saved) ? saved as AdminTab : 'overview';
    } catch { return 'overview'; }
  });
  // Users view mode: 'manage'=full controls, 'view'=read-only list, 'today'=today's signups only
  const [usersViewMode, setUsersViewMode] = useState<'manage' | 'view' | 'today'>('manage');

  // Save tab change to localStorage
  const handleSetTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem(DASHBOARD_TAB_KEY, tab);
  }, [DASHBOARD_TAB_KEY]);
  const isCreatorAccount = isCreator(profile.role);

  const goToUsers = useCallback((mode: 'manage' | 'view' | 'today') => {
    setUsersViewMode(mode);
    handleSetTab('users');
  }, [handleSetTab]);

  const tabs = [
    { id: 'overview' as AdminTab, label: 'Overview', icon: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'users' as AdminTab, label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'listings' as AdminTab, label: 'Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'reports' as AdminTab, label: 'Reports', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
    { id: 'audit' as AdminTab, label: 'Audit', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
    { id: 'settings' as AdminTab, label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
    { id: 'workers' as AdminTab, label: 'Workers', icon: 'M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z' },
    { id: 'announcements' as AdminTab, label: 'Announce', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4' },
    { id: 'hotels' as AdminTab, label: 'Hotels', icon: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM2 20h20M12 11v-6M9 11v-2M15 11v-2' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-6">
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
                  <span className="flex items-center gap-1 text-[8px] font-bold px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    VERIFIED
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
                onClick={() => handleSetTab(tab.id)}
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
        {activeTab === 'overview' && <OverviewTab profile={profile} isCreator={isCreatorAccount} onGoToNewListing={onGoToNewListing} onGoToUsers={() => goToUsers('manage')} onGoToUsersView={() => goToUsers('view')} onGoToUsersToday={() => goToUsers('today')} onGoToTab={handleSetTab} />}
        {activeTab === 'users' && <UsersTab profile={profile} viewMode={usersViewMode} />}
        {activeTab === 'listings' && <ListingsTab profile={profile} />}
        {activeTab === 'reports' && <ReportsTab profile={profile} />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'settings' && <SettingsTab profile={profile} isCreator={isCreatorAccount} />}
        {activeTab === 'workers' && <WorkerApplicationsTab profile={profile} />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope="all" />}
        {activeTab === 'hotels' && <HotelsTab profile={profile} />}
      </main>
    </div>
  );
}

// ─── OVERVIEW ──────────────────────────────────────
function OverviewTab({ profile, isCreator, onGoToNewListing, onGoToUsers, onGoToUsersView, onGoToUsersToday, onGoToTab }: { profile: Profile; isCreator: boolean; onGoToNewListing?: () => void; onGoToUsers?: () => void; onGoToUsersView?: () => void; onGoToUsersToday?: () => void; onGoToTab?: (tab: AdminTab) => void }) {
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

  const statCards = [
    { label: 'Total Users', value: stats.users, color: isCreator ? 'from-purple-500 to-[#7C3AED]' : 'from-[#3B82F6] to-[#2563EB]', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', onClick: onGoToUsersView },
    { label: 'Listings', value: stats.listings, color: 'from-[#10B981] to-[#059669]', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', onClick: () => onGoToTab?.('listings') },
    { label: 'Pending Reports', value: stats.reports, color: stats.reports > 0 ? 'from-[#EF4444] to-[#DC2626]' : 'from-[#6B7280] to-[#4B5563]', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', onClick: () => onGoToTab?.('reports') },
    { label: 'New Today', value: stats.today, color: isCreator ? 'from-purple-400 to-purple-600' : 'from-[#8B5CF6] to-[#7C3AED]', icon: 'M12 5v14M5 12h14', onClick: onGoToUsersToday },
  ];

  return (
    <div className="space-y-4">
      {/* Stats Grid — clickable, navigates to respective tabs */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map(c => (
          <button
            key={c.label}
            onClick={c.onClick}
            className={`bg-gradient-to-br ${c.color} rounded-2xl p-4 relative overflow-hidden text-left transition-transform active:scale-[0.97] hover:opacity-90`}
          >
            <svg className="absolute top-3 right-3 w-8 h-8 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={c.icon} /></svg>
            <div className="text-2xl font-bold text-white relative z-10">{c.value}</div>
            <div className="text-[10px] text-white/70 relative z-10">{c.label}</div>
          </button>
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
function UsersTab({ profile, viewMode = 'manage' }: { profile: Profile; viewMode?: 'manage' | 'view' | 'today' }) {
  const { ask, dialogProps } = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const isManage = viewMode === 'manage';
  const isToday = viewMode === 'today';

  const load = useCallback(async () => {
    setLoading(true);
    const { users: data } = await getAllUsers();
    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter: today mode shows only users created since local midnight today
  // Must match getUserCount() in supabase.ts exactly
  function getLocalMidnightISO() {
    const now = new Date();
    const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return localMidnight.toISOString();
  }
  const todayStartISO = getLocalMidnightISO();
  const displayUsers = isToday
    ? users.filter(u => u.created_at >= todayStartISO)
    : users;

  const searchedUsers = displayUsers.filter(u =>
    !search ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.username?.toLowerCase().includes(search.toLowerCase())
  );

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
    const oldLabel = ROLE_LABELS[target.role as keyof typeof ROLE_LABELS] || target.role;
    const newLabel = ROLE_LABELS[newRole as keyof typeof ROLE_LABELS] || newRole;
    toast.success(`Role changed: ${oldLabel} → ${newLabel}`);
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

  async function handleExemptToggle(userId: string, currentExempt: boolean) {
    const { error } = await toggleMaintenanceExempt(userId, !currentExempt);
    if (error) { toast.error('Failed to update exemption'); return; }
    toast.success(currentExempt ? 'Removed maintenance exemption' : 'User can now login during maintenance');
    load();
  }

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />

      {/* View mode header */}
      {viewMode !== 'manage' && (
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="text-[10px] text-[#5C5E72] hover:text-white transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium">
            {isToday ? "Today's New Users" : 'All Users (View Only)'}
          </span>
        </div>
      )}

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20" />

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">
            {searchedUsers.length}{isToday ? " joined today" : " users"}{isManage ? '' : ' — view only'}
          </div>
          {searchedUsers.map(u => {
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
                        {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}
                      </span>
                      {isDeleted && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">DELETED</span>}
                    </div>
                    <div className="text-[10px] text-[#5C5E72] truncate">{u.email}</div>
                  </div>
                </div>

                {isManage && (
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
                        <option value="user">{ROLE_LABELS.user}</option>
                        <option value="staff">{ROLE_LABELS.staff}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                        <option value="assistant_state_admin">{ROLE_LABELS.assistant_state_admin}</option>
                        <option value="state_admin">{ROLE_LABELS.state_admin}</option>
                      </select>
                    )}

                    {!isDeleted && !isCreatorAccount && (
                      <button
                        onClick={() => handleExemptToggle(u.user_id, !!u.maintenance_exempt)}
                        title={u.maintenance_exempt ? 'Can login during maintenance' : 'Allow login during maintenance'}
                        className={`h-7 px-2 rounded-lg border text-[10px] font-medium transition-colors ${
                          u.maintenance_exempt
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                            : 'bg-[#1A1A24] border-[#232330] text-[#5C5E72] hover:text-amber-400 hover:border-amber-500/30'
                        }`}
                      >
                        {u.maintenance_exempt ? 'Exempt' : 'Exempt'}
                      </button>
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
                )}
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
  const [agentNames, setAgentNames] = useState<Record<string, { username: string; role: string }>>({});
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    const list = data || [];
    setListings(list);

    // Fetch agent and owner profiles
    const agentUserIds = list.map(l => l.chat_agent_id).filter(Boolean) as string[];
    const ownerAuthIds = list.map(l => l.owner_id).filter(Boolean) as string[];
    const allUserIds = [...new Set([...agentUserIds])];
    const allAuthIds = [...new Set([...ownerAuthIds])];

    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, username, role').in('user_id', allUserIds);
      const map: Record<string, { username: string; role: string }> = {};
      (profiles || []).forEach((p: any) => { map[p.user_id] = { username: p.username || 'Unknown', role: p.role }; });
      setAgentNames(map);
    }
    if (allAuthIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('auth_id, username').in('auth_id', allAuthIds);
      const map: Record<string, string> = {};
      (profiles || []).forEach((p: any) => { map[p.auth_id] = p.username || 'Unknown'; });
      setOwnerNames(map);
    }

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
        {[
          { key: 'all', label: 'All', count: listings.length },
          { key: 'available', label: 'Available', count: listings.filter(l => l.availability_status === 'available').length },
          { key: 'reserved', label: 'Reserved', count: listings.filter(l => l.availability_status === 'reserved').length },
          { key: 'closed', label: 'Closed', count: listings.filter(l => l.availability_status === 'closed').length },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={`px-3 h-8 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
              filter === f.key
                ? 'bg-[#3B82F6] text-white shadow-lg shadow-blue-500/20'
                : 'bg-[#1A1A24] border border-[#232330] text-[#5C5E72] hover:text-white hover:border-[#3B82F6]/30'
            }`}
          >
            {f.label}
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${filter === f.key ? 'bg-white/20 text-white' : 'bg-[#2A2A3A] text-[#5C5E72]'}`}>
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(l => {
            const agent = l.chat_agent_id ? agentNames[l.chat_agent_id] : null;
            const owner = l.owner_id ? ownerNames[l.owner_id] : null;
            return (
              <div key={l.id} className="glass rounded-xl p-3">
                <div className="flex gap-3">
                  <img src={l.images?.[0] || 'https://placehold.co/60x60/1A1A24/5C5E72?text=No+Image'} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{l.title}</div>
                    <div className="text-[10px] text-[#3B82F6] font-bold">₦{l.price.toLocaleString()}/year</div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${l.availability_status === 'available' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{l.availability_status}</span>
                  </div>
                </div>

                {/* Owner + Chat Agent info */}
                <div className="mt-2 space-y-1">
                  {owner && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-[#5C5E72] w-12 flex-shrink-0">Posted by</span>
                      <span className="text-[10px] text-white font-medium truncate">@{owner}</span>
                    </div>
                  )}
                  {agent ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-[#5C5E72] w-12 flex-shrink-0">Chat with</span>
                      <span className={`text-[10px] font-medium truncate ${agent.role === 'staff' ? 'text-amber-400' : 'text-[#3B82F6]'}`}>
                        @{agent.username} ({ROLE_LABELS[agent.role as keyof typeof ROLE_LABELS] || agent.role})
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-[#5C5E72] w-12 flex-shrink-0">Chat with</span>
                      <span className="text-[10px] text-red-400">No agent assigned</span>
                    </div>
                  )}
                </div>

                <button onClick={() => handleDeleteL(l.id)} className="mt-2 w-full h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">Remove</button>
              </div>
            );
          })}
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
  const canSend = canSendAnnouncements(profile.role);
  const isCreatorScope = scope === 'all';
  const isStateScope = !isCreatorScope && typeof scope === 'object';
  const isCreatorAccount = isCreator(profile.role);

  const [users, setUsers] = useState<any[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [message, setMessage] = useState('');
  const [sendMode, setSendMode] = useState<'all' | 'select'>('all');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sentMessages, setSentMessages] = useState<any[]>([]);
  const [activeView, setActiveView] = useState<'compose' | 'history'>('compose');
  const { ask, dialogProps } = useConfirm();

  // ── Role filter toggles ──
  const canIncludeWorkers = isCreator(profile.role) || profile.role === 'state_admin';
  const canIncludeStaff = isCreator(profile.role) || profile.role === 'state_admin' || profile.role === 'admin';
  const [includeWorkers, setIncludeWorkers] = useState(false);
  const [includeStaff, setIncludeStaff] = useState(false);
  // Role-specific targeting (new)
  const [targetRoleFilter, setTargetRoleFilter] = useState<string>(''); // empty = all users
  const [liveCount, setLiveCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ok: boolean; issues: string[]}>({ok: true, issues: []});

  // ── Check database tables on mount ──
  useEffect(() => {
    if (canSend) {
      checkAnnouncementTables().then((status) => {
        setDbStatus(status);
        if (!status.ok) {
          toast.error('Announcement tables not set up. Run SQL in Supabase.', { duration: 8000 });
        }
      });
      loadSentMessages();
      loadUsers();
    } else {
      loadSentMessages();
    }
  }, []);

  // Live recipient count updates when toggles change
  useEffect(() => {
    if (!canSend || sendMode === 'select') return;
    let cancelled = false;
    async function updateCount() {
      setCountLoading(true);
      const { count } = await getFilteredRecipientCount(
        includeWorkers,
        includeStaff,
        isStateScope ? scope.state : undefined,
        isStateScope ? scope.lga : undefined
      );
      if (!cancelled) {
        setLiveCount(count);
        setCountLoading(false);
      }
    }
    updateCount();
    return () => { cancelled = true; };
  }, [includeWorkers, includeStaff, sendMode, canSend, isStateScope]);

  async function loadUsers() {
    const { users: data } = await getAllUsers();
    // ONLY regular users (role='user') — no workers, staff, or admins
    let list = (data || []).filter((u: any) =>
      !u.deleted &&
      u.user_id !== profile.user_id &&
      u.role === 'user'
    );
    if (isStateScope) {
      list = list.filter((u: any) => u.state === scope.state);
    }
    setUsers(list);
    setFilteredUsers(list);
  }

  // Filter users when searching (username, state, LGA/city)
  useEffect(() => {
    if (!userSearch.trim()) {
      setFilteredUsers(users);
      return;
    }
    const q = userSearch.toLowerCase();
    setFilteredUsers(users.filter((u: any) => {
      const username = (u.username || '').toLowerCase();
      const state = (u.state || '').toLowerCase();
      const city = (u.city || '').toLowerCase();
      return username.includes(q) || state.includes(q) || city.includes(q);
    }));
  }, [userSearch, users]);

  async function loadSentMessages() {
    const isCreatorRole = isCreator(profile.role);
    const { messages } = isCreatorRole
      ? await getAllAnnouncements()
      : await getAnnouncementsSentBy(profile.user_id);
    const msgs = messages || [];
    setSentMessages(msgs);
  }

  async function handleDeleteMessage(messageId: string) {
    const ok = await ask({ title: 'Delete this message?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    toast.loading('Deleting...', { id: 'del-msg' });
    const { error } = await deleteAnnouncement(Number(messageId));
    toast.dismiss('del-msg');
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Message deleted');
    setSentMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  async function handleSend() {
    if (!message.trim()) { toast.error('Type a message'); return; }

    // Validate: if selecting users, must have selected at least one
    if (sendMode === 'select' && selectedUsers.length === 0) {
      toast.error('Select at least one user');
      return;
    }

    // Warn if broadcast mode but no regular users exist
    if (sendMode === 'all' && users.length === 0 && !includeWorkers && !includeStaff) {
      toast.error('No regular users in the system. Create a user account first.', { duration: 5000 });
      return;
    }

    const targetLabel = sendMode === 'all'
      ? (isStateScope ? `all users in ${scope.state}` : 'all users')
      : `${selectedUsers.length} selected user${selectedUsers.length > 1 ? 's' : ''}`;

    const ok = await ask({ title: `Send to ${targetLabel}?`, confirmLabel: 'Send', variant: 'info' });
    if (!ok) return;

    setSending(true);
    toast.loading('Sending...', { id: 'send-announce' });

    const senderRole = isCreator(profile.role) ? 'creator' : 'state_admin';

    // Build target type and options
    let targetType: AnnouncementTargetType;
    let options: any = {};
    
    if (sendMode === 'select') {
      targetType = 'specific_user';
      options = { recipientIds: selectedUsers };
    } else if (targetRoleFilter) {
      // Role-specific targeting (new)
      switch (targetRoleFilter) {
        case 'staff': targetType = 'staff_only'; break;
        case 'admin': targetType = 'head_of_staff_only'; break;
        case 'state_admin': targetType = 'admin_only'; break;
        case 'assistant_state_admin': targetType = 'assistant_admin_only'; break;
        default: targetType = 'all_users';
      }
      options = { scopeState: isStateScope ? scope.state : undefined, scopeLga: isStateScope ? scope.lga : undefined };
    } else if (includeWorkers && includeStaff) {
      targetType = 'all_users'; // users + workers + staff = everyone
      options = { scopeState: isStateScope ? scope.state : undefined, scopeLga: isStateScope ? scope.lga : undefined };
    } else if (includeWorkers) {
      targetType = 'all_workers';
      options = { scopeState: isStateScope ? scope.state : undefined, scopeLga: isStateScope ? scope.lga : undefined };
    } else {
      targetType = 'all_users';
      options = { scopeState: isStateScope ? scope.state : undefined, scopeLga: isStateScope ? scope.lga : undefined };
    }

    const title = message.trim().substring(0, 50) + (message.trim().length > 50 ? '...' : '');

    const { error, recipientCount } = await sendAnnouncement(
      profile.user_id, senderRole, profile.username || 'Admin', title, message.trim(), targetType, options
    );

    toast.dismiss('send-announce');
    setSending(false);

    if (error) { toast.error(error.message || 'Failed to send'); return; }

    toast.success(`Sent to ${recipientCount || 0} recipient${(recipientCount || 0) > 1 ? 's' : ''}!`);
    setMessage('');
    setSelectedUsers([]);
    setIncludeWorkers(false);
    setIncludeStaff(false);
    setTargetRoleFilter('');
    setActiveView('history');
    await loadSentMessages();
  }

  // Recipient breakdown label
  const getRecipientBreakdown = () => {
    const parts: string[] = ['Users'];
    if (includeWorkers) parts.push('Workers');
    if (includeStaff) parts.push('Staff');
    return parts.join(' + ');
  };

  return (
    <div className="space-y-4">
      <ConfirmDialog {...dialogProps} />

      {/* Navigation tabs */}
      {canSend && (
        <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1">
          <button onClick={() => setActiveView('compose')} className={`flex-1 h-8 rounded-lg text-xs font-semibold transition-all ${activeView === 'compose' ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C] hover:text-white'}`}>
            New Message
          </button>
          <button onClick={() => setActiveView('history')} className={`flex-1 h-8 rounded-lg text-xs font-semibold transition-all ${activeView === 'history' ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C] hover:text-white'}`}>
            Sent ({sentMessages.length})
          </button>
        </div>
      )}

      {/* Compose View */}
      {canSend && activeView === 'compose' && (
        <div className="glass rounded-2xl overflow-hidden">
          {/* DB Status Warning */}
          {!dbStatus.ok && (
            <div className="p-3 bg-red-500/10 border-b border-red-500/20">
              <div className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                </svg>
                <div>
                  <p className="text-[11px] text-red-400 font-medium">Database tables not configured</p>
                  <p className="text-[10px] text-red-400/70">{dbStatus.issues.join(', ')}</p>
                </div>
              </div>
            </div>
          )}
          <div className="p-4 border-b border-[#1E1E2C]">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <div>
                <p className="text-sm font-bold text-white">WeHouse Official</p>
                <p className="text-[10px] text-[#5C5E72]">
                  {isStateScope ? `Broadcast to all users in ${scope.state}` : 'Broadcast to all users on the platform'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-4">
            {/* Send mode toggle — Creator sees both, Admin sees Broadcast only */}
            <div className="flex gap-1 bg-[#1A1A24] rounded-lg p-1 mb-3">
              <button
                onClick={() => { setSendMode('all'); setSelectedUsers([]); }}
                className={`flex-1 h-8 rounded-md text-xs font-medium transition-all ${
                  sendMode === 'all' ? 'bg-[#2A2A3A] text-white' : 'text-[#5C5E72] hover:text-white'
                }`}
              >
                Broadcast
              </button>
              {isCreatorAccount && (
                <button
                  onClick={() => setSendMode('select')}
                  className={`flex-1 h-8 rounded-md text-xs font-medium transition-all ${
                    sendMode === 'select' ? 'bg-[#2A2A3A] text-white' : 'text-[#5C5E72] hover:text-white'
                  }`}
                >
                  Select Users
                </button>
              )}
            </div>

            {/* Multi-user selector — Creator only, regular users only */}
            {sendMode === 'select' && isCreatorAccount && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by @username, state, or LGA..."
                    className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
                  />
                  {selectedUsers.length > 0 && (
                    <button
                      onClick={() => setSelectedUsers([])}
                      className="h-10 px-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-medium hover:bg-red-500/20 transition-colors whitespace-nowrap"
                    >
                      Clear ({selectedUsers.length})
                    </button>
                  )}
                </div>

                {/* Selected count */}
                {selectedUsers.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] font-medium">
                      {selectedUsers.length} selected
                    </span>
                    <span className="text-[10px] text-[#5C5E72]">
                      {filteredUsers.length} total users
                    </span>
                  </div>
                )}

                <div className="max-h-[200px] overflow-y-auto rounded-xl border border-[#2A2A3A]">
                  {filteredUsers.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-xs text-[#5C5E72]">No users found</p>
                      <p className="text-[10px] text-[#5C5E72]/60 mt-0.5">Try a different search term</p>
                    </div>
                  ) : (
                    filteredUsers.map((u: any) => {
                      const isSelected = selectedUsers.includes(u.user_id);
                      return (
                        <button
                          key={u.user_id}
                          onClick={() => {
                            setSelectedUsers(prev =>
                              isSelected
                                ? prev.filter(id => id !== u.user_id)
                                : [...prev, u.user_id]
                            );
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                            isSelected ? 'bg-[#3B82F6]/10' : 'hover:bg-[#12121A]'
                          }`}
                        >
                          {/* Checkbox */}
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-[#3B82F6] border-[#3B82F6]'
                              : 'border-[#3A3A4A] bg-[#1A1A24]'
                          }`}>
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          {/* Avatar */}
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                            {(u.username || 'U').charAt(0).toUpperCase()}
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-white truncate block">@{u.username || 'user'}</span>
                            <span className="text-[9px] text-[#5C5E72] truncate block">
                              {u.state || 'No state'}{u.city ? ` · ${u.city}` : ''}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Role filter toggles — only in broadcast mode */}
            {sendMode === 'all' && (
              <div className="mb-3 space-y-2">
                <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">Recipients</p>

                {/* Show warning if no regular users exist */}
                {users.length === 0 && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-start gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                        <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                      </svg>
                      <div>
                        <p className="text-[11px] text-amber-400 font-medium">No regular users found</p>
                        <p className="text-[10px] text-amber-400/70">Announcements only reach users with role='user'. Create a test user account to verify delivery.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Base: Users always included */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/10">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                  <span className="text-xs text-green-400 flex-1">Users</span>
                  <span className="text-[9px] text-green-400/60">Always included</span>
                </div>

                {/* Role-specific targeting dropdown */}
                <div className="px-1">
                  <label className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-1.5 block">Or target specific role</label>
                  <select
                    value={targetRoleFilter}
                    onChange={(e) => setTargetRoleFilter(e.target.value)}
                    className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 outline-none focus:border-[#3B82F6]/50"
                  >
                    <option value="">All Users (default)</option>
                    <option value="staff">Staff Only</option>
                    <option value="admin">Head of Staff Only</option>
                    <option value="state_admin">Admin Only</option>
                    <option value="assistant_state_admin">Assistant Admin Only</option>
                  </select>
                  {targetRoleFilter && (
                    <p className="text-[9px] text-amber-400 mt-1">This will override the default user targeting</p>
                  )}
                </div>

                {/* Include Workers toggle */}
                {canIncludeWorkers && (
                  <button
                    onClick={() => setIncludeWorkers(!includeWorkers)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      includeWorkers
                        ? 'bg-pink-500/10 border-pink-500/30'
                        : 'bg-[#1A1A24] border-[#2A2A3A] hover:border-[#3A3A4A]'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={includeWorkers ? '#EC4899' : '#5C5E72'} strokeWidth="2"><path d="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z" /></svg>
                    <span className={`text-xs flex-1 text-left ${includeWorkers ? 'text-pink-400' : 'text-[#8A8B9C]'}`}>Include Workers</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${includeWorkers ? 'bg-pink-500' : 'bg-[#2A2A3A]'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${includeWorkers ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                )}

                {/* Include Staff toggle */}
                {canIncludeStaff && (
                  <button
                    onClick={() => setIncludeStaff(!includeStaff)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      includeStaff
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-[#1A1A24] border-[#2A2A3A] hover:border-[#3A3A4A]'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={includeStaff ? '#F59E0B' : '#5C5E72'} strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                    <span className={`text-xs flex-1 text-left ${includeStaff ? 'text-amber-400' : 'text-[#8A8B9C]'}`}>Include Staff</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${includeStaff ? 'bg-amber-500' : 'bg-[#2A2A3A]'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${includeStaff ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                )}

                {/* Live count */}
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-[#5C5E72]">
                    {countLoading ? 'Counting...' : `${liveCount.toLocaleString()} ${getRecipientBreakdown().toLowerCase()} will receive this`}
                  </span>
                  {countLoading && <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
                </div>
              </div>
            )}

            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your announcement..." rows={4} className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none mb-3" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {sendMode === 'all' ? (
                  <>
                    <span className="text-xs text-[#5C5E72]">{countLoading ? '...' : `${liveCount.toLocaleString()} recipients`}</span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">{getRecipientBreakdown()}</span>
                  </>
                ) : (
                  <span className="text-xs text-[#5C5E72]">
                    {selectedUsers.length > 0
                      ? `${selectedUsers.length} user${selectedUsers.length > 1 ? 's' : ''} selected`
                      : 'Select users above'}
                  </span>
                )}
              </div>
              <button onClick={handleSend} disabled={sending || !message.trim() || (sendMode === 'select' && selectedUsers.length === 0)} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-30 flex items-center gap-2">
                {sending && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History View */}
      {(!canSend || activeView === 'history') && (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-[#1E1E2C] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              {canSend
                ? (isCreator(profile.role) ? 'All Official Messages' : 'Your Sent Messages')
                : 'Official Messages'}
            </h3>
            <span className="text-[10px] text-[#5C5E72]">{sentMessages.length} total</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {sentMessages.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                </div>
                <p className="text-xs text-[#5C5E72]">No official messages yet</p>
              </div>
            ) : (
              sentMessages.map((m: any) => {
                const count = m.recipient_count ?? 0;
                const readCount = m.read_count ?? 0;
                const isCreatorView = isCreator(profile.role);
                return (
                  <div key={m.id} className="px-4 py-3 border-b border-[#1E1E2C]/50 hover:bg-[#12121A] transition-colors">
                    {/* Title */}
                    <h4 className="text-sm font-semibold text-white mb-1">{m.title}</h4>
                    {/* Message preview */}
                    <p className="text-xs text-[#8A8B9C] leading-relaxed line-clamp-2">{m.message}</p>
                    {/* Analytics row */}
                    <div className="flex items-center flex-wrap gap-2 mt-2">
                      {/* Sent count */}
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">
                        {count} sent
                      </span>
                      {/* Read count */}
                      {readCount > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] font-medium">
                          {readCount} read
                        </span>
                      )}
                      {/* Target type */}
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 uppercase tracking-wider">{m.target_type?.replace(/_/g, ' ')}</span>
                      {/* Timestamp */}
                      <span className="text-[9px] text-[#5C5E72]">{new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      {/* Sender info - ONLY visible to creator */}
                      {isCreatorView && (
                        <span className="text-[9px] text-amber-400/70">by {m.sender_name}</span>
                      )}
                      {/* Delete button */}
                      {canSend && (
                        <button onClick={() => handleDeleteMessage(m.id)} className="ml-auto text-[#5C5E72] hover:text-red-400 transition-colors p-0.5" title="Delete">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Read-only notice for non-senders */}
      {!canSend && (
        <div className="glass rounded-2xl p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-[#3B82F6]/10 flex items-center justify-center mx-auto mb-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          </div>
          <p className="text-xs text-[#8A8B9C]">Only the Creator and Admins can send announcements.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HOTELS MANAGEMENT TAB
// ═══════════════════════════════════════════════════════════

interface HotelRoomLite { room_id: number; price_per_night: number; room_type: string; }

export function HotelsTab({ profile }: { profile: Profile }) {
  const [hotels, setHotels] = useState<(Hotel & { hotel_rooms: HotelRoomLite[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'add' | 'edit' | 'rooms' | 'bookings'>('list');
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(null);
  const [hotelBookings, setHotelBookings] = useState<(HotelBooking & { profiles: { username: string | null; phone: string | null }; hotel_rooms: { room_type: string } })[]>([]);

  // Form states
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formState, setFormState] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formArea, setFormArea] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formAmenities, setFormAmenities] = useState<string[]>([]);
  const [formFeatured, setFormFeatured] = useState(false);
  const [formImages, setFormImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const nigerianStates = ['Abia','Abuja','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

  useEffect(() => { loadHotels(); }, []);

  async function loadHotels() {
    setLoading(true);
    // Creator sees all hotels, admin sees all hotels (same pattern as listings)
    const { hotels: data } = await getHotels({});
    setHotels(data || []);
    setLoading(false);
  }

  function resetForm() {
    setFormName(''); setFormDesc(''); setFormState(''); setFormCity(''); setFormArea('');
    setFormAddress(''); setFormAmenities([]); setFormFeatured(false); setFormImages([]);
  }

  function startAdd() { resetForm(); setView('add'); }

  function startEdit(hotel: Hotel) {
    setSelectedHotel(hotel);
    setFormName(hotel.name); setFormDesc(hotel.description || '');
    setFormState(hotel.state); setFormCity(hotel.city); setFormArea(hotel.area || '');
    setFormAddress(hotel.address || ''); setFormAmenities(hotel.amenities || []);
    setFormFeatured(hotel.featured); setFormImages(hotel.images || []);
    setView('edit');
  }

  function startRooms(hotel: Hotel) {
    setSelectedHotel(hotel);
    setView('rooms');
  }

  async function startBookings(hotel: Hotel) {
    setSelectedHotel(hotel);
    const { bookings } = await getHotelBookingsForHotel(hotel.hotel_id);
    setHotelBookings(bookings || []);
    setView('bookings');
  }

  async function handleCreate() {
    if (!formName.trim() || !formCity.trim() || !formState.trim()) {
      toast.error('Name, state and city are required'); return;
    }
    const { hotel, error } = await createHotel({
      name: formName.trim(),
      description: formDesc.trim() || null,
      state: formState,
      city: formCity.trim(),
      area: formArea.trim() || null,
      address: formAddress.trim() || null,
      images: formImages,
      amenities: formAmenities,
      owner_id: profile.user_id,
      status: 'active',
      featured: formFeatured,
    });
    if (error || !hotel) { toast.error('Failed to create hotel'); return; }
    toast.success('Hotel created!');
    resetForm();
    setView('list');
    loadHotels();
  }

  async function handleUpdate() {
    if (!selectedHotel) return;
    if (!formName.trim() || !formCity.trim() || !formState.trim()) {
      toast.error('Name, state and city are required'); return;
    }
    const { error } = await updateHotel(selectedHotel.hotel_id, {
      name: formName.trim(),
      description: formDesc.trim() || null,
      state: formState,
      city: formCity.trim(),
      area: formArea.trim() || null,
      address: formAddress.trim() || null,
      images: formImages,
      amenities: formAmenities,
      featured: formFeatured,
    });
    if (error) { toast.error('Failed to update hotel'); return; }
    toast.success('Hotel updated!');
    setView('list');
    loadHotels();
  }

  async function handleDelete(hotelId: number) {
    if (!confirm('Delete this hotel? All rooms and bookings will be lost.')) return;
    const { error } = await deleteHotel(hotelId);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Hotel deleted');
    loadHotels();
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) { toast.error('Select image files only'); return; }

    const oversized = validFiles.filter(f => f.size > 35 * 1024 * 1024);
    if (oversized.length > 0) { toast.error(`${oversized.length} file(s) exceed 35MB`); return; }

    setUploading(true);
    let uploaded = 0;

    for (const file of validFiles) {
      const { url, error } = await uploadHotelImage(file, 0);
      if (url && !error) {
        setFormImages(prev => [...prev, url]);
        uploaded++;
      }
    }

    setUploading(false);
    if (uploaded > 0) toast.success(`${uploaded} image${uploaded > 1 ? 's' : ''} added`);
    if (uploaded < validFiles.length) toast.error(`${validFiles.length - uploaded} failed`);
    e.target.value = '';
  }

  function removeImage(idx: number) {
    setFormImages(prev => prev.filter((_, i) => i !== idx));
  }

  function toggleAmenity(a: string) {
    setFormAmenities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  async function handleUpdateBookingStatus(bookingId: number, status: HotelBooking['status']) {
    const { error } = await updateBookingStatus(bookingId, status);
    if (error) { toast.error('Failed to update'); return; }
    toast.success(`Booking ${status}`);
    if (selectedHotel) startBookings(selectedHotel);
  }

  // ─── ADD / EDIT FORM ──────────────────────────────────
  if (view === 'add' || view === 'edit') {
    const isEdit = view === 'edit';
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setView('list')} className="text-[#5C5E72] hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h2 className="text-sm font-bold text-white">{isEdit ? 'Edit Hotel' : 'Add Hotel'}</h2>
        </div>

        {/* Images */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Photos ({formImages.length})</label>
          <div className="flex gap-2 flex-wrap">
            {formImages.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removeImage(i)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center text-[10px]">×</button>
              </div>
            ))}
            <label className="w-20 h-20 rounded-xl border border-dashed border-[#2A2A3A] flex flex-col items-center justify-center text-[#5C5E72] hover:border-[#3B82F6]/50 hover:text-[#3B82F6] transition-colors cursor-pointer">
              {uploading ? <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
                : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg><span className="text-[9px] mt-1">Add</span></>}
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
            </label>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Hotel Name *</label>
          <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Transcorp Hilton" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Description</label>
          <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Describe the hotel..." rows={3} className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none" />
        </div>

        {/* State */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">State *</label>
          <select value={formState} onChange={e => setFormState(e.target.value)} className="w-full h-11 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none">
            <option value="">Select state</option>
            {nigerianStates.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* City & Area */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">City *</label>
            <input type="text" value={formCity} onChange={e => setFormCity(e.target.value)} placeholder="e.g. Ikeja" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
          </div>
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Area</label>
            <input type="text" value={formArea} onChange={e => setFormArea(e.target.value)} placeholder="e.g. GRA" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Full Address</label>
          <input type="text" value={formAddress} onChange={e => setFormAddress(e.target.value)} placeholder="Street address" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
        </div>

        {/* Amenities */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Amenities</label>
          <div className="flex flex-wrap gap-1.5">
            {HOTEL_AMENITIES.map(a => (
              <button key={a} onClick={() => toggleAmenity(a)} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all ${formAmenities.includes(a) ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#3B82F6]' : 'bg-[#1A1A24] border-[#2A2A3A] text-[#5C5E72] hover:border-[#3B82F6]/30'}`}>{a}</button>
            ))}
          </div>
        </div>

        {/* Featured */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={formFeatured} onChange={e => setFormFeatured(e.target.checked)} className="w-4 h-4 rounded accent-[#3B82F6]" />
          <span className="text-xs text-white">Featured hotel (appears at top)</span>
        </label>

        <button onClick={isEdit ? handleUpdate : handleCreate} className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity">
          {isEdit ? 'Save Changes' : 'Create Hotel'}
        </button>
      </div>
    );
  }

  // ─── ROOMS MANAGEMENT ─────────────────────────────────
  if (view === 'rooms' && selectedHotel) {
    return <HotelRoomsTab hotel={selectedHotel} onBack={() => { setView('list'); loadHotels(); }} />;
  }

  // ─── BOOKINGS VIEW ────────────────────────────────────
  if (view === 'bookings' && selectedHotel) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setView('list')} className="text-[#5C5E72] hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h2 className="text-sm font-bold text-white">{selectedHotel.name} — Bookings</h2>
        </div>

        {hotelBookings.length === 0 ? (
          <p className="text-xs text-[#5C5E72] text-center py-8">No bookings yet</p>
        ) : (
          <div className="space-y-3">
            {hotelBookings.map(b => (
              <div key={b.booking_id} className="p-4 rounded-2xl bg-[#12121A] border border-[#1E1E2C]">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                    b.status === 'confirmed' ? 'bg-green-500/10 text-green-400' :
                    b.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                    b.status === 'cancelled' ? 'bg-red-500/10 text-red-400' :
                    'bg-[#3B82F6]/10 text-[#3B82F6]'
                  }`}>{b.status}</span>
                  <span className="text-[9px] text-[#5C5E72]">#{b.booking_id}</span>
                </div>
                <p className="text-xs text-white font-medium">{b.hotel_rooms?.room_type}</p>
                <p className="text-[10px] text-[#5C5E72]">{b.profiles?.username || 'Guest'} · {b.profiles?.phone || 'No phone'}</p>
                <p className="text-[10px] text-[#5C5E72]">{new Date(b.check_in).toLocaleDateString()} → {new Date(b.check_out).toLocaleDateString()} · {b.total_nights} night{b.total_nights !== 1 ? 's' : ''}</p>
                <p className="text-xs text-[#3B82F6] font-bold mt-1">₦{b.total_price.toLocaleString()}</p>
                {b.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => handleUpdateBookingStatus(b.booking_id, 'confirmed')} className="flex-1 h-8 rounded-lg bg-green-500/10 text-green-400 text-[10px] font-medium border border-green-500/20">Confirm</button>
                    <button onClick={() => handleUpdateBookingStatus(b.booking_id, 'cancelled')} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 text-[10px] font-medium border border-red-500/20">Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── LIST VIEW ────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">Hotels ({hotels.length})</h2>
        <button onClick={startAdd} className="h-9 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Add Hotel
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-32 rounded-2xl shimmer" />)}
        </div>
      ) : hotels.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">No hotels yet</p>
          <p className="text-xs text-[#5C5E72] mt-1">Add your first hotel to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hotels.map(h => (
            <div key={h.hotel_id} className="p-4 rounded-2xl bg-[#12121A] border border-[#1E1E2C]">
              <div className="flex items-start gap-3">
                <img src={h.images?.[0] || 'https://placehold.co/100x100/1A1A24/5C5E72?text=No+Image'} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white truncate">{h.name}</h3>
                    {h.featured && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">FEATURED</span>}
                  </div>
                  <p className="text-[10px] text-[#5C5E72]">{h.city}, {h.state}</p>
                  <p className="text-[10px] text-[#5C5E72]">{h.hotel_rooms?.length || 0} room type{h.hotel_rooms?.length !== 1 ? 's' : ''} · {h.review_count} review{h.review_count !== 1 ? 's' : ''}</p>
                  {h.rating > 0 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#F59E0B" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      <span className="text-[10px] text-amber-400 font-medium">{h.rating}</span>
                    </div>
                  )}
                </div>
              </div>
              {/* Actions */}
              <div className="flex gap-2 mt-3">
                <button onClick={() => startEdit(h)} className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] text-[10px] font-medium hover:border-[#3B82F6]/30 transition-colors">Edit</button>
                <button onClick={() => startRooms(h)} className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] text-[10px] font-medium hover:border-[#3B82F6]/30 transition-colors">Rooms</button>
                <button onClick={() => startBookings(h)} className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] text-[10px] font-medium hover:border-[#3B82F6]/30 transition-colors">Bookings</button>
                <button onClick={() => handleDelete(h.hotel_id)} className="h-8 px-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-medium hover:bg-red-500/20 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HOTEL ROOMS SUB-TAB
// ═══════════════════════════════════════════════════════════

function HotelRoomsTab({ hotel, onBack }: { hotel: Hotel; onBack: () => void }) {
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Form
  const [roomType, setRoomType] = useState('');
  const [roomDesc, setRoomDesc] = useState('');
  const [price, setPrice] = useState('');
  const [maxGuests, setMaxGuests] = useState('2');
  const [bedType, setBedType] = useState('');
  const [totalRooms, setTotalRooms] = useState('1');
  const [roomAmenities, setRoomAmenities] = useState<string[]>([]);

  useEffect(() => { loadRooms(); }, []);

  async function loadRooms() {
    setLoading(true);
    const { rooms: r } = await getHotelRooms(hotel.hotel_id);
    setRooms(r || []);
    setLoading(false);
  }

  async function handleAddRoom() {
    if (!roomType.trim() || !price || Number(price) <= 0) {
      toast.error('Room type and price are required'); return;
    }
    const { error } = await createHotelRoom({
      hotel_id: hotel.hotel_id,
      room_type: roomType.trim(),
      description: roomDesc.trim() || null,
      price_per_night: Number(price),
      max_guests: Number(maxGuests) || 2,
      bed_type: bedType || null,
      images: [],
      amenities: roomAmenities,
      total_rooms: Number(totalRooms) || 1,
    });
    if (error) { toast.error('Failed to add room'); return; }
    toast.success('Room added!');
    setShowAdd(false);
    setRoomType(''); setRoomDesc(''); setPrice(''); setMaxGuests('2'); setBedType(''); setTotalRooms('1'); setRoomAmenities([]);
    loadRooms();
  }

  async function handleDeleteRoom(roomId: number) {
    if (!confirm('Delete this room type?')) return;
    const { error } = await deleteHotelRoom(roomId);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Room deleted');
    loadRooms();
  }

  function toggleRoomAmenity(a: string) {
    setRoomAmenities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-[#5C5E72] hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h2 className="text-sm font-bold text-white">{hotel.name} — Rooms</h2>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="h-8 px-3 rounded-lg bg-[#3B82F6] text-white text-[10px] font-semibold hover:bg-[#2563EB] transition-colors flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Add Room
        </button>
      </div>

      {/* Add Room Form */}
      {showAdd && (
        <div className="glass rounded-2xl p-4 border border-[#2A2A3A] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Room Type *</label>
              <select value={roomType} onChange={e => setRoomType(e.target.value)} className="w-full h-10 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-[#3B82F6]">
                <option value="">Select</option>
                {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Price/Night (₦) *</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="25000" className="w-full h-10 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-[#3B82F6]" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Description</label>
            <input type="text" value={roomDesc} onChange={e => setRoomDesc(e.target.value)} placeholder="Brief description" className="w-full h-10 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-[#3B82F6]" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Max Guests</label>
              <select value={maxGuests} onChange={e => setMaxGuests(e.target.value)} className="w-full h-10 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-[#3B82F6]">
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Bed Type</label>
              <select value={bedType} onChange={e => setBedType(e.target.value)} className="w-full h-10 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-[#3B82F6]">
                <option value="">Select</option>
                {BED_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Total Rooms</label>
              <input type="number" value={totalRooms} onChange={e => setTotalRooms(e.target.value)} min={1} className="w-full h-10 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-[#3B82F6]" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Room Amenities</label>
            <div className="flex flex-wrap gap-1">
              {['TV','Mini Fridge','Bathtub','Balcony','Safe','Desk','Sofa','Kitchenette'].map(a => (
                <button key={a} onClick={() => toggleRoomAmenity(a)} className={`px-2 py-0.5 rounded-lg text-[9px] font-medium border transition-all ${roomAmenities.includes(a) ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#3B82F6]' : 'bg-[#1A1A24] border-[#2A2A3A] text-[#5C5E72]'}`}>{a}</button>
              ))}
            </div>
          </div>
          <button onClick={handleAddRoom} className="w-full h-9 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors">Add Room Type</button>
        </div>
      )}

      {/* Room List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}
        </div>
      ) : rooms.length === 0 ? (
        <p className="text-xs text-[#5C5E72] text-center py-6">No room types yet. Add one above.</p>
      ) : (
        <div className="space-y-2">
          {rooms.map(r => (
            <div key={r.room_id} className="p-3 rounded-xl bg-[#12121A] border border-[#1E1E2C] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-white">{r.room_type}</h4>
                  <span className="text-[9px] text-[#3B82F6] font-bold">₦{r.price_per_night.toLocaleString()}/night</span>
                </div>
                <p className="text-[10px] text-[#5C5E72]">{r.max_guests} guests · {r.bed_type || 'No bed specified'} · {r.total_rooms} room{r.total_rooms !== 1 ? 's' : ''}</p>
                {r.description && <p className="text-[9px] text-[#5C5E72]">{r.description}</p>}
              </div>
              <button onClick={() => handleDeleteRoom(r.room_id)} className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
