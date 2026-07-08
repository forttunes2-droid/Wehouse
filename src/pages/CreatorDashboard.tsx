import { useState, useEffect, useCallback, useRef } from 'react';
import {
  supabase,
  getAllUsers, getCreatorDashboardStats, updateUserRole, restoreUser, suspendUser, freezeUser, banUser, reactivateUser,
  getAllListingsAdmin, deleteListing, getReports,
  resolveReport, dismissReport, logAuditAction, getAllWorkers, updateWorkerStatus, parseWorkerStatus,
  sendAnnouncement, deleteAnnouncement, getAnnouncementsSentBy, getAllAnnouncements,
  getFilteredRecipientCount, checkAnnouncementTables, toggleMaintenanceExempt,
  getHotels, createHotel, updateHotel, deleteHotel, createHotelRoom, deleteHotelRoom, uploadHotelImage, getHotelBookingsForHotel, updateBookingStatus, getHotelRooms,
  getNotifications, getUnreadNotificationCount, markNotificationsRead,
} from '@/lib/supabase';
import { getCommissionSummary } from '@/lib/paystack-marketplace';
import { WORKER_OCCUPATION_LABELS, WORKER_STATUS_LABELS, WORKER_STATUS_COLORS, ROLE_LABELS } from '@/types';
// Creator is identified by role='creator' in the database
const checkIsCreator = (profile: Profile): boolean => profile.role === 'creator';

import { validateRoleTransition, canSendAnnouncements } from '@/hooks/useAuth';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { Input } from '@/components/ui/input';
import type { Profile, Listing, AnnouncementTargetType, Hotel, HotelRoom, HotelBooking } from '@/types';
import { HOTEL_AMENITIES, ROOM_TYPES, BED_TYPES } from '@/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import StaffListTab from './StaffListTab';
import BookingsTab from './BookingsTab';
import VerificationTab from './VerificationTab';
import SettingsTab from './SettingsTab';
import CreatorSettingsTab from './CreatorSettingsTab';
import PartnersTab from './PartnersTab';
import { AnnouncementsTab } from '@/components/AnnouncementsTab';
import { Toaster, toast } from 'sonner';

// Admin/Creator tabs per Constitution
// Admin: Overview, Users, Workers, Property Partners, Staff, Listings, Bookings, Reports, Support, Verification
// Creator adds: Settings (Platform + Finance)
type AdminTab = 'overview' | 'users' | 'workers' | 'partners' | 'staff' | 'listings' | 'bookings' | 'reports' | 'support' | 'verification' | 'announcements' | 'settings';

interface CreatorDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
  onNavigate?: (page: string) => void;
}

// ─── ROLE CONFIG ───────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  creator_admin: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  property_partner: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
};

export default function CreatorDashboard({ profile, onLogout: _onLogout, onGoToNewListing, onNavigate }: CreatorDashboardProps) {
  const { clearAuth } = useCreatorAuth();

  // Wrapped logout: clears creator auth session too
  const handleLogout = useCallback(() => {
    clearAuth();
    _onLogout();
  }, [_onLogout, clearAuth]);
  // Persist dashboard sub-tab across refreshes
  const DASHBOARD_TAB_KEY = checkIsCreator(profile) ? 'wh_creator_tab' : 'wh_admin_tab';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const saved = localStorage.getItem(DASHBOARD_TAB_KEY);
      return saved && ['overview','users','workers','partners','staff','listings','bookings','reports','support','verification','announcements','settings'].includes(saved) ? saved as AdminTab : 'overview';
    } catch { return 'overview'; }
  });
  // Users view mode: 'manage'=full controls, 'view'=read-only list, 'today'=today's signups only
  const [usersViewMode, setUsersViewMode] = useState<'manage' | 'view' | 'today'>('manage');

  // Save tab change to localStorage
  const handleSetTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem(DASHBOARD_TAB_KEY, tab);
  }, [DASHBOARD_TAB_KEY]);
  const isCreatorAccount = checkIsCreator(profile);

  const goToUsers = useCallback((mode: 'manage' | 'view' | 'today') => {
    setUsersViewMode(mode);
    handleSetTab('users');
  }, [handleSetTab]);

  // Admin/Creator tabs per Constitution
  // Admin: Overview, Users, Workers, Partners, Staff, Listings, Bookings, Reports, Support, Verification
  // Creator adds: Settings (Platform + Finance)
  const tabs = [
    { id: 'overview' as AdminTab, label: 'Overview', icon: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'users' as AdminTab, label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'workers' as AdminTab, label: 'Workers', icon: 'M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z' },
    { id: 'partners' as AdminTab, label: 'Partners', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'staff' as AdminTab, label: 'Staff', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11V7a3 3 0 0 1 6 0v4' },
    { id: 'listings' as AdminTab, label: 'Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'bookings' as AdminTab, label: 'Bookings', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z' },
    { id: 'reports' as AdminTab, label: 'Reports', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
    { id: 'support' as AdminTab, label: 'Support', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
    { id: 'verification' as AdminTab, label: 'Verification', icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 1 4.1-.252 3.42 3.42 0 0 0 3.388-3.388 3.42 3.42 0 0 1 2.567-1.932 3.42 3.42 0 0 0 2.568-1.932M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0' },
    { id: 'announcements' as AdminTab, label: 'Announcements', icon: 'M11 5.882V19.24a1.76 1.76 0 0 1-3.417.592l-3.083-6.167A1.76 1.76 0 0 0 3 12.76H2a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1a1.76 1.76 0 0 0 1.5-.905l3.083-6.166A1.76 1.76 0 0 1 11 1.647V5.882zM15 8a5 5 0 0 1 0 8M18.5 5a9 9 0 0 1 0 14' },
    ...(isCreatorAccount ? [{ id: 'settings' as AdminTab, label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }] : []),
  ];

  return (
    <div className="min-h-[100dvh] bg-transparent pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Creator Header — Differentiated from user profile */}
      <header className="bg-gradient-to-b from-[#1A1029] via-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onNavigate && (
              <button
                onClick={() => onNavigate('home')}
                className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
            )}
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
          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            <NotificationBell userId={profile.user_id} />
            <button onClick={handleLogout} className="text-[10px] text-[#5C5E72] hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10">
              Logout
            </button>
          </div>
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
        {activeTab === 'workers' && <WorkerApplicationsTab profile={profile} />}
        {activeTab === 'partners' && <PartnersTab />}
        {activeTab === 'staff' && <StaffListTab />}
        {activeTab === 'listings' && <ListingsTab profile={profile} />}
        {activeTab === 'bookings' && <BookingsTab />}
        {activeTab === 'reports' && <ReportsTab profile={profile} />}
        {activeTab === 'support' && <SupportInboxTab profile={profile} />}
        {activeTab === 'verification' && <VerificationTab />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope="all" />}
        {activeTab === 'settings' && (isCreatorAccount ? <CreatorSettingsTab profile={profile} /> : <SettingsTab profile={profile} onUpdate={() => {}} />)}

      </main>
    </div>
  );
}

// ─── OVERVIEW ──────────────────────────────────────
function OverviewTab({ profile, isCreator, onGoToNewListing, onGoToUsers, onGoToUsersView, onGoToUsersToday, onGoToTab }: { profile: Profile; isCreator: boolean; onGoToNewListing?: () => void; onGoToUsers?: () => void; onGoToUsersView?: () => void; onGoToUsersToday?: () => void; onGoToTab?: (tab: AdminTab) => void }) {
  const [stats, setStats] = useState({
    totalUsers: 0, totalWorkers: 0, totalPartners: 0, totalStaff: 0, totalAdmins: 0,
    totalListings: 0, pendingInspections: 0, pendingVerifications: 0,
    activeWorkerBookings: 0, totalRevenue: 0, pendingPayouts: 0, escrowBalance: 0, todaySignups: 0,
  });
  const [commission, setCommission] = useState({
    total_collected: 0, total_settled: 0, total_pending: 0, total_payments: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      const [{ stats: s, error }, comm] = await Promise.all([
        getCreatorDashboardStats(),
        isCreator ? getCommissionSummary('month') : Promise.resolve({ total_collected: 0, total_settled: 0, total_pending: 0, total_payments: 0 }),
      ]);
      if (error) {
        setLoadError('Database error: ' + (error.message || 'Cannot load stats. Make sure admin SQL functions are installed.'));
      }
      setStats(s);
      setCommission(comm);
      setLoading(false);
    }
    load();
  }, [isCreator]);

  // Top row: Critical counts
  const topStats = [
    { label: 'Total Users', value: stats.totalUsers, color: 'from-purple-500 to-[#7C3AED]', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', onClick: onGoToUsersView },
    { label: 'Workers', value: stats.totalWorkers, color: 'from-pink-500 to-[#EC4899]', icon: 'M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z', onClick: () => onGoToTab?.('workers') },
    { label: 'Partners', value: stats.totalPartners, color: 'from-violet-500 to-[#8B5CF6]', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10', onClick: () => onGoToTab?.('partners') },
    { label: 'Listings', value: stats.totalListings, color: 'from-[#10B981] to-[#059669]', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', onClick: () => onGoToTab?.('listings') },
  ];

  // Middle row: Operations
  const opStats = [
    { label: 'Pending Inspections', value: stats.pendingInspections, color: 'from-amber-500 to-[#F59E0B]', alert: stats.pendingInspections > 0, onClick: () => onGoToTab?.('verification') },
    { label: 'Pending Verifications', value: stats.pendingVerifications, color: 'from-[#3B82F6] to-[#2563EB]', alert: stats.pendingVerifications > 0, onClick: () => onGoToTab?.('workers') },
    { label: 'Active Bookings', value: stats.activeWorkerBookings, color: 'from-emerald-500 to-[#10B981]', onClick: () => onGoToTab?.('support') },
    { label: 'New Today', value: stats.todaySignups, color: 'from-cyan-500 to-[#06B6D4]', onClick: onGoToUsersToday },
  ];

  // Bottom row: Financials (Creator only)
  const finStats = [
    { label: 'Total Revenue', value: `₦${stats.totalRevenue.toLocaleString()}`, color: 'from-green-500 to-[#22C55E]' },
    { label: 'Pending Payouts', value: `₦${stats.pendingPayouts.toLocaleString()}`, color: 'from-orange-500 to-[#F97316]', alert: stats.pendingPayouts > 0 },
    { label: 'Escrow Balance', value: `₦${stats.escrowBalance.toLocaleString()}`, color: 'from-indigo-500 to-[#6366F1]' },
    { label: 'Staff', value: stats.totalStaff, color: 'from-[#8B5CF6] to-[#7C3AED]', onClick: () => onGoToTab?.('staff') },
  ];

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
          <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          Loading platform stats...
        </div>
      )}

      {loadError && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
          <p className="text-[11px] text-red-400 font-medium">{loadError}</p>
          <p className="text-[9px] text-[#5C5E72] mt-1">Run the SQL setup in Supabase to fix this.</p>
        </div>
      )}

      {/* ═══ ROW 1: Platform Scale ═══ */}
      <div>
        <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">Platform</p>
        <div className="grid grid-cols-2 gap-2">
          {topStats.map(c => (
            <button
              key={c.label}
              onClick={c.onClick}
              className={`bg-gradient-to-br ${c.color} rounded-2xl p-3.5 relative overflow-hidden text-left transition-transform active:scale-[0.97] hover:opacity-90`}
            >
              <svg className="absolute top-2.5 right-2.5 w-7 h-7 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={c.icon} /></svg>
              <div className="text-xl font-bold text-white relative z-10">{c.value}</div>
              <div className="text-[9px] text-white/70 relative z-10">{c.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ═══ ROW 2: Operations ═══ */}
      <div>
        <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">Operations</p>
        <div className="grid grid-cols-4 gap-2">
          {opStats.map(c => (
            <button
              key={c.label}
              onClick={c.onClick}
              className={`rounded-xl p-2.5 text-center transition-transform active:scale-[0.97] hover:opacity-90 ${c.alert ? 'bg-red-500/10 border border-red-500/20' : 'bg-[#12121A] border border-[#1E1E2C]'}`}
            >
              <div className={`text-sm font-bold ${c.alert ? 'text-red-400' : 'text-white'}`}>{c.value}</div>
              <div className={`text-[8px] mt-0.5 ${c.alert ? 'text-red-400/70' : 'text-[#5C5E72]'}`}>{c.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ═══ ROW 3: Financials (Creator Only) ═══ */}
      {isCreator && (
        <div>
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">Finance</p>
          <div className="grid grid-cols-4 gap-2">
            {finStats.map(c => (
              <button
                key={c.label}
                onClick={c.onClick}
                className={`rounded-xl p-2.5 text-center transition-transform active:scale-[0.97] hover:opacity-90 ${c.alert ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-[#12121A] border border-[#1E1E2C]'}`}
              >
                <div className={`text-[11px] font-bold ${c.alert ? 'text-orange-400' : 'text-emerald-400'}`}>{c.value}</div>
                <div className={`text-[8px] mt-0.5 ${c.alert ? 'text-orange-400/70' : 'text-[#5C5E72]'}`}>{c.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ ROW 4: Commission Summary (Creator Only) ═══ */}
      {isCreator && (
        <div>
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">Commission Ledger (This Month)</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Collected', value: `₦${Number(commission.total_collected || 0).toLocaleString()}`, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
              { label: 'Pending', value: `₦${Number(commission.total_pending || 0).toLocaleString()}`, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
              { label: 'Settled', value: `₦${Number(commission.total_settled || 0).toLocaleString()}`, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
              { label: 'Payments', value: commission.total_payments || 0, color: 'text-white', bg: 'bg-[#12121A] border-[#1E1E2C]' },
            ].map(c => (
              <div key={c.label} className={`rounded-xl p-2.5 text-center ${c.bg} border`}>
                <div className={`text-[11px] font-bold ${c.color}`}>{c.value}</div>
                <div className="text-[8px] text-[#5C5E72] mt-0.5">{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            {[
              'Full platform control — view everything',
              'Create and remove Admins',
              'Promote User → Staff, Staff → Admin',
              'Demote Admin → Staff',
              'Suspend anyone except Creator',
              'Manage inspections, bookings, finances',
              'Configure platform settings',
            ].map(tool => (
              <div key={tool} className="flex items-center gap-2 text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                {tool}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── USERS ─────────────────────────────────────────
function UsersTab({ profile, viewMode = 'manage' }: { profile: Profile; viewMode?: 'manage' | 'view' | 'today' }) {
  const { ask, dialogProps } = useConfirm();
  const { requestAuth } = useCreatorAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('');

  // Wrapper: require creator auth before executing critical actions
  // If not authenticated, shows modal; after password, action runs automatically
  const withAuth = (action: () => void | Promise<void>) => {
    requestAuth(action);
  };

  const isManage = viewMode === 'manage';
  const isToday = viewMode === 'today';

  const load = useCallback(async () => {
    setLoading(true);
    const { users: data, error } = await getAllUsers();
    if (error) {
      console.error('[Creator] getAllUsers error:', error);
      toast.error('Failed to load users: ' + error.message);
    }
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

  const searchedUsers = displayUsers
    .filter(u => !userRoleFilter || u.role === userRoleFilter)
    .filter(u =>
      !search ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.username?.toLowerCase().includes(search.toLowerCase())
    );

  async function handleRole(userId: string, newRole: string) {
    withAuth(async () => {
      const target = users.find(u => u.user_id === userId);
      if (!target) { toast.error('User not found'); return; }

      // Cannot change own role
      if (userId === profile.user_id) { toast.error('You cannot change your own role'); return; }

      // Platform owner always has creator rights regardless of DB role
      const isOwner = checkIsCreator(profile);
      const changerRole = isOwner ? 'creator' : profile.role === 'admin' ? 'admin' : 'staff';

      // Validate using the permission matrix (pass 'creator' if platform owner)
      const validation = validateRoleTransition(changerRole, target.role, newRole);
      if (!validation.allowed) {
        toast.error(validation.reason || 'Role change not allowed');
        return;
      }
      const { error } = await updateUserRole(
        userId, newRole, target.role,
        profile.user_id, profile.email,
        target.email, changerRole
      );
      if (error) { toast.error(error.message || 'Failed'); return; }

      await logAuditAction(profile.user_id, profile.email, 'update_role', 'user', userId, `Changed role from ${target.role} to ${newRole}`);
      const oldLabel = ROLE_LABELS[target.role as keyof typeof ROLE_LABELS] || target.role;
      const newLabel = ROLE_LABELS[newRole as keyof typeof ROLE_LABELS] || newRole;
      toast.success(`Role changed: ${oldLabel} → ${newLabel}`);
      load();
    });
  }

  async function handleSuspend(userId: string) {
    withAuth(async () => {
      const target = users.find(u => u.user_id === userId);
      if (!target) { toast.error('User not found'); return; }
      if (checkIsCreator(target)) { toast.error('Creator account cannot be suspended'); return; }
      if (userId === profile.user_id) { toast.error('You cannot suspend your own account'); return; }
      const ok = await ask({ title: 'Suspend this user?', confirmLabel: 'Suspend', variant: 'danger' });
      if (!ok) return;
      const { error } = await suspendUser(userId);
      if (error) { toast.error('Failed: ' + error.message); return; }
      await logAuditAction(profile.user_id, profile.email, 'suspend_user', 'user', userId, 'User suspended');
      toast.success('User suspended');
      load();
    });
  }

  async function handleFreeze(userId: string) {
    withAuth(async () => {
      const target = users.find(u => u.user_id === userId);
      if (!target) { toast.error('User not found'); return; }
      if (checkIsCreator(target)) { toast.error('Creator account cannot be frozen'); return; }
      const ok = await ask({ title: 'Freeze this account? User cannot login until unfrozen.', confirmLabel: 'Freeze', variant: 'danger' });
      if (!ok) return;
      const { error } = await freezeUser(userId);
      if (error) { toast.error('Failed: ' + error.message); return; }
      await logAuditAction(profile.user_id, profile.email, 'freeze_user', 'user', userId, 'User frozen');
      toast.success('Account frozen');
      load();
    });
  }

  async function handleBan(userId: string) {
    withAuth(async () => {
      const target = users.find(u => u.user_id === userId);
      if (!target) { toast.error('User not found'); return; }
      if (checkIsCreator(target)) { toast.error('Creator account cannot be banned'); return; }
      if (userId === profile.user_id) { toast.error('You cannot ban your own account'); return; }
      const ok = await ask({ title: 'Ban this user permanently? They can restore via support.', confirmLabel: 'Ban', variant: 'danger' });
      if (!ok) return;
      const { error } = await banUser(userId);
      if (error) { toast.error('Failed: ' + error.message); return; }
      await logAuditAction(profile.user_id, profile.email, 'ban_user', 'user', userId, 'User banned');
      toast.success('User banned');
      load();
    });
  }

  async function handleReactivate(userId: string) {
    withAuth(async () => {
      const ok = await ask({ title: 'Reactivate this user?', confirmLabel: 'Reactivate', variant: 'info' });
      if (!ok) return;
      const { error } = await reactivateUser(userId);
      if (error) { toast.error('Failed: ' + error.message); return; }
      await logAuditAction(profile.user_id, profile.email, 'reactivate_user', 'user', userId, 'User reactivated');
      toast.success('User reactivated');
      load();
    });
  }

  async function handleRestore(userId: string) {
    withAuth(async () => {
      const restoreOk = await ask({ title: 'Restore this user?', confirmLabel: 'Restore', variant: 'info' });
      if (!restoreOk) return;
      const { error } = await restoreUser(userId);
      if (error) { toast.error('Restore failed: ' + error.message); return; }
      await logAuditAction(profile.user_id, profile.email, 'restore_user', 'user', userId, 'User restored');
      toast.success('User restored');
      load();
    });
  }

  async function handleExemptToggle(userId: string, currentExempt: boolean) {
    // Exempt toggle is a minor action — no auth required
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

      {/* Role filter buttons */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          { key: '', label: 'All' },
          { key: 'user', label: 'Users' },
          { key: 'staff', label: 'Staff' },
          { key: 'admin', label: 'Admins' },
          { key: 'worker', label: 'Workers' },
          { key: 'property_partner', label: 'Partners' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setUserRoleFilter(f.key)}
            className={`h-7 px-3 rounded-lg text-[10px] font-medium transition-all ${
              userRoleFilter === f.key
                ? 'bg-[#3B82F6] text-white'
                : 'bg-[#1A1A24] border border-[#232330] text-[#8A8B9C] hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20" />

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">
            {searchedUsers.length} of {users.length} total{isToday ? " joined today" : " users"}{isManage ? '' : ' — view only'}
            {users.length <= 5 && <span className="text-amber-400 ml-1">(only {users.length} accounts in database)</span>}
          </div>
          {searchedUsers.map(u => {
            const roleBadge = ROLE_COLORS[u.role] || ROLE_COLORS.user;
            const isCreatorAccount = checkIsCreator(u);
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
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {/* Status badge */}
                    {u.deleted && (
                      <span className="h-6 px-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] flex items-center font-bold">BANNED</span>
                    )}
                    {u.worker_status === 'suspended' && !u.deleted && (
                      <span className="h-6 px-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] flex items-center font-bold">SUSPENDED</span>
                    )}

                    {/* Change Role — ONLY for user/staff/admin (never creator, worker, partner) */}
                    {(u.role === 'user' || u.role === 'staff' || u.role === 'admin') && !isDeleted && (
                      <select
                        value={u.role}
                        onChange={(e) => handleRole(u.user_id, e.target.value)}
                        className="h-7 rounded-lg bg-[#1A1A24] border border-[#232330] text-[10px] px-2 text-white"
                      >
                        <option value="user">{ROLE_LABELS.user}</option>
                        <option value="staff">{ROLE_LABELS.staff}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                      </select>
                    )}

                    {/* Action buttons */}
                    {isDeleted ? (
                      <>
                        <button
                          onClick={() => handleReactivate(u.user_id)}
                          className="h-7 px-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors"
                        >
                          Reactivate
                        </button>
                        <button
                          onClick={() => handleRestore(u.user_id)}
                          className="h-7 px-2.5 rounded-lg bg-[#1A1A24] border border-[#232330] text-[#5C5E72] text-[10px] hover:text-white transition-colors"
                        >
                          Restore
                        </button>
                      </>
                    ) : isCreatorAccount ? (
                      <div className="h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] px-2 flex items-center font-medium">
                        Creator — protected
                      </div>
                    ) : (
                      <>
                        {/* Suspend */}
                        <button
                          onClick={() => handleSuspend(u.user_id)}
                          disabled={u.user_id === profile.user_id}
                          className="h-7 px-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] hover:bg-amber-500/20 transition-colors disabled:opacity-30"
                          title="Temporarily suspend account"
                        >
                          Suspend
                        </button>
                        {/* Freeze */}
                        <button
                          onClick={() => handleFreeze(u.user_id)}
                          className="h-7 px-2.5 rounded-lg bg-[#1A1A24] border border-[#232330] text-[#5C5E72] text-[10px] hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
                          title="Freeze account (block login)"
                        >
                          Freeze
                        </button>
                        {/* Ban */}
                        <button
                          onClick={() => handleBan(u.user_id)}
                          disabled={u.user_id === profile.user_id}
                          className="h-7 px-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors disabled:opacity-30"
                          title="Ban permanently (user can restore)"
                        >
                          Ban
                        </button>
                        {/* Maintenance Exempt */}
                        <button
                          onClick={() => handleExemptToggle(u.user_id, !!u.maintenance_exempt)}
                          className={`h-7 px-2 rounded-lg border text-[10px] font-medium transition-colors ${
                            u.maintenance_exempt
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                              : 'bg-[#1A1A24] border-[#232330] text-[#5C5E72] hover:text-amber-400'
                          }`}
                          title="Maintenance exemption"
                        >
                          {u.maintenance_exempt ? 'Exempt' : 'Exmpt'}
                        </button>
                      </>
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

// ─── SETTINGS ──────────────────────────────────────
// ─── WORKER APPLICATIONS TAB ───────────────────────

function WorkerApplicationsTab({ profile }: { profile: Profile }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'verification_paid' | 'verified' | 'declined' | 'suspended' | 'rejected'>('all');
  const [viewingWorker, setViewingWorker] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { workers: data } = await getAllWorkers();
    setWorkers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleStatus(userId: string, status: string) {
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

  const truncateBio = (bio: string, maxLen = 100) => {
    if (!bio || bio.length <= maxLen) return bio;
    return bio.slice(0, maxLen).trim() + '...';
  };

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {(['all', 'pending', 'verification_paid', 'verified', 'declined', 'suspended', 'rejected'] as const).map(f => {
          const label = f === 'all' ? 'All' : WORKER_STATUS_LABELS[f] || f;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-shrink-0 h-8 px-3 rounded-lg text-[10px] font-medium transition-colors ${
                filter === f ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] border border-[#232330] text-[#5C5E72] hover:text-white'
              }`}>{label}</button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#5C5E72]">No worker applications</div>
      ) : (
        filtered.map(w => {
          const status = parseWorkerStatus(w);
          const statusLabel = WORKER_STATUS_LABELS[status] || status;
          const statusColor = WORKER_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-400 border-gray-500/20';
          return (
            <div key={w.user_id} className="glass rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {w.avatar_url ? <img src={w.avatar_url} alt="" className="w-full h-full object-cover rounded-xl" /> : (w.full_name || w.username || 'W').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">{w.full_name || w.username || '...'}</span>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor}`}>{statusLabel}</span>
                  </div>
                  <div className="text-[10px] text-[#5C5E72]">{WORKER_OCCUPATION_LABELS[w.worker_occupation] || w.worker_occupation} · {w.city || 'No location'}</div>
                </div>
              </div>

              {/* View Profile — ALWAYS visible for every worker */}
              <div className="mb-3">
                {w.worker_bio ? (
                  <p className="text-[10px] text-[#8A8B9C] italic leading-relaxed">
                    {truncateBio(w.worker_bio)}
                    <button onClick={() => setViewingWorker(w)} className="ml-1 text-[#3B82F6] not-italic hover:text-[#60A5FA] transition-colors">
                      View Full Profile
                    </button>
                  </p>
                ) : (
                  <button onClick={() => setViewingWorker(w)} className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
                    View Profile
                  </button>
                )}
              </div>

              <div className="flex gap-2 flex-wrap">
                {/* pending: hasn't started verification */}
                {status === 'pending' && (
                  <>
                    <span className="text-[9px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">Awaiting verification</span>
                  </>
                )}
                {/* verification_paid: completed verification, ready for review */}
                {status === 'verification_paid' && (
                  <>
                    <button onClick={() => handleStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors">Approve</button>
                    <button onClick={() => handleStatus(w.user_id, 'declined')} className="flex-1 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">Decline</button>
                  </>
                )}
                {/* verified: approved, public */}
                {status === 'verified' && (
                  <>
                    <button onClick={() => handleStatus(w.user_id, 'suspended')} className="flex-1 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] hover:bg-amber-500/20 transition-colors">Suspend</button>
                  </>
                )}
                {/* declined: review declined, can resubmit */}
                {status === 'declined' && (
                  <>
                    <span className="text-[9px] text-red-400 bg-red-500/10 px-2 py-1 rounded-full border border-red-500/20">Can resubmit</span>
                    <button onClick={() => handleStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors">Approve Anyway</button>
                  </>
                )}
                {/* suspended: was public, suspended */}
                {status === 'suspended' && (
                  <>
                    <button onClick={() => handleStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] hover:bg-green-500/20 transition-colors">Reinstate</button>
                    <button onClick={() => handleStatus(w.user_id, 'rejected')} className="flex-1 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">Reject</button>
                  </>
                )}
                {/* rejected: permanently rejected */}
                {status === 'rejected' && (
                  <>
                    <button onClick={() => handleStatus(w.user_id, 'verification_paid')} className="flex-1 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] hover:bg-blue-500/20 transition-colors">Allow Re-submit</button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* ═══ Worker Profile Modal ═══ */}
      {viewingWorker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setViewingWorker(null)}>
          <div className="bg-[#12121A] rounded-t-2xl sm:rounded-2xl border border-[#2A2A3A] w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="sticky top-0 bg-[#12121A] border-b border-[#2A2A3A] px-5 py-3 flex items-center justify-between z-10">
              <p className="text-sm font-semibold text-white">Worker Profile</p>
              <button onClick={() => setViewingWorker(null)} className="w-7 h-7 rounded-full bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Avatar & Name */}
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                  {viewingWorker.avatar_url ? <img src={viewingWorker.avatar_url} alt="" className="w-full h-full object-cover rounded-xl" /> : (viewingWorker.full_name || viewingWorker.username || 'W').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{viewingWorker.full_name || viewingWorker.username || 'Unknown'}</p>
                  <p className="text-[10px] text-[#5C5E72]">@{viewingWorker.username || 'no-username'}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${WORKER_STATUS_COLORS[parseWorkerStatus(viewingWorker)] || ''}`}>
                      {WORKER_STATUS_LABELS[parseWorkerStatus(viewingWorker)] || 'Unknown'}
                    </span>
                    <span className="text-[8px] text-[#5C5E72]">{WORKER_OCCUPATION_LABELS[viewingWorker.worker_occupation] || viewingWorker.worker_occupation}</span>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="rounded-xl bg-[#1A1A24] p-3 space-y-2">
                <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Contact</p>
                <div className="space-y-1">
                  {viewingWorker.email && (
                    <div className="flex items-center gap-2 text-xs text-white">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                      {viewingWorker.email}
                    </div>
                  )}
                  {viewingWorker.phone && (
                    <div className="flex items-center gap-2 text-xs text-white">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      {viewingWorker.phone}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-[#8A8B9C]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    {viewingWorker.city ? `${viewingWorker.city}, ${viewingWorker.state || 'Nigeria'}` : (viewingWorker.state || 'Location not set')}
                  </div>
                </div>
              </div>

              {/* Full Bio */}
              {viewingWorker.worker_bio && (
                <div className="rounded-xl bg-[#1A1A24] p-3">
                  <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-1">About</p>
                  <p className="text-xs text-white leading-relaxed whitespace-pre-wrap">{viewingWorker.worker_bio}</p>
                </div>
              )}

              {/* Verification Media */}
              {(viewingWorker.id_card_url || viewingWorker.verification_video_url) && (
                <div className="rounded-xl bg-[#1A1A24] p-3 space-y-2">
                  <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Verification</p>
                  {viewingWorker.id_card_url && (
                    <div>
                      <p className="text-[10px] text-[#5C5E72] mb-1">ID Card</p>
                      <img src={viewingWorker.id_card_url} alt="ID Card" className="w-full h-32 object-contain rounded-lg bg-black" />
                    </div>
                  )}
                  {viewingWorker.verification_video_url && (
                    <div>
                      <p className="text-[10px] text-[#5C5E72] mb-1">Video</p>
                      <video src={viewingWorker.verification_video_url} controls className="w-full h-40 rounded-lg bg-black" />
                    </div>
                  )}
                </div>
              )}

              {/* Dates */}
              <div className="text-[10px] text-[#5C5E72]">
                Joined: {viewingWorker.created_at ? new Date(viewingWorker.created_at).toLocaleDateString() : 'Unknown'}
              </div>

              {/* Close */}
              <button onClick={() => setViewingWorker(null)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-xs text-white hover:bg-[#2A2A3A] transition-colors">
                Close
              </button>
            </div>
          </div>
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





// ═════════════════════════════════════════════════════════════════
// SUPPORT INBOX TAB — Proper messaging inbox
// ═════════════════════════════════════════════════════════════════

function SupportInboxTab({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    // Real-time subscription for new messages
    const sub = supabase
      .channel('support_inbox_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        if (selectedConv) {
          // Refresh current conversation messages
          supabase.rpc('get_conversation_messages', { p_conversation_id: selectedConv.id }).then(({ data }) => {
            if (data) setMessages(data);
          });
        }
        // Refresh conversation list
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: convs, error: err } = await supabase.rpc('admin_get_all_support_inbox');
      if (err) throw err;

      // Filter by viewer role: 
      // - Creator/Admin sees ALL conversations
      // - Staff with support permission sees only partner chats
      // - Staff with verification permission sees only worker verification chats
      // - Others see nothing
      let filtered = convs || [];
      if (profile.role === 'staff') {
        // Check staff permissions
        const { data: perms } = await supabase
          .from('staff_permissions')
          .select('permission')
          .eq('staff_id', profile.user_id)
          .eq('is_active', true);
        const hasSupport = (perms || []).some((p: any) => p.permission === 'support');
        const hasVerification = (perms || []).some((p: any) => p.permission === 'verification');
        
        if (hasSupport && !hasVerification) {
          filtered = filtered.filter((c: any) => c.conversation_type === 'partner_support' || c.conversation_type === 'partner_inspection');
        } else if (hasVerification && !hasSupport) {
          filtered = filtered.filter((c: any) => c.conversation_type === 'worker_verification');
        }
        // If staff has both support+verification, they see both types
        // If staff has neither, they see nothing
      }

      // Look up partner/worker profiles separately (avoid SQL JOIN crash)
      const participantIds = filtered.map((c: any) => c.participant_a).filter(Boolean);
      if (participantIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, username, full_name, email, phone')
          .in('user_id', participantIds);
        const profileMap: Record<string, any> = {};
        for (const p of (profiles || [])) profileMap[p.user_id] = p;
        for (const c of filtered) {
          const p = profileMap[c.participant_a];
          if (p) {
            c.partner_name = p.full_name || p.username;
            c.partner_email = p.email;
            c.partner_phone = p.phone;
          }
        }
      }

      setConversations(filtered);
    } catch (err: any) {
      console.error('[SupportInbox] error:', err);
      setError('Failed to load: ' + (err.message || 'Unknown error'));
    }
    setLoading(false);
  }

  async function openConversation(conv: any) {
    setSelectedConv(conv);
    setMsgLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('get_conversation_messages', {
      p_conversation_id: conv.id,
    });
    if (err) {
      console.error('[Messages] error:', err);
      toast.error('Failed to load messages: ' + err.message);
      setError('Failed to load messages: ' + err.message);
    }
    setMessages(data || []);
    setMsgLoading(false);
  }

  async function sendReply() {
    if (!replyText.trim() || !selectedConv) return;
    setSending(true);
    const { error: err } = await supabase.rpc('send_support_message', {
      p_conversation_id: selectedConv.id,
      p_sender_id: profile.user_id,
      p_content: replyText.trim(),
    });
    if (err) {
      toast.error('Failed to send: ' + err.message);
      console.error('[SendReply] error:', err);
      setSending(false);
      return;
    }
    setReplyText('');
    setSending(false);
    // Refresh messages
    const { data } = await supabase.rpc('get_conversation_messages', {
      p_conversation_id: selectedConv.id,
    });
    setMessages(data || []);
    load();
  }

  const typeLabels: Record<string, { label: string; color: string; dot: string }> = {
    partner_inspection: { label: 'Inspection', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20', dot: 'bg-violet-400' },
    partner_support: { label: 'Partner', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-400' },
    general_support: { label: 'General', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400' },
    worker_verification: { label: 'Worker Review', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-400' },
  };

  // ─── CHAT VIEW ───────────────────────────────────────────
  if (selectedConv) {
    return (
      <div className="flex flex-col h-[calc(100vh-140px)]">
        {/* Chat header */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#232330]">
          <button
            onClick={() => { setSelectedConv(null); setMessages([]); setError(null); }}
            className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] flex items-center justify-center text-[#8A8B9C] hover:text-white flex-shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {(selectedConv.participant_a || 'P').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate">
                {selectedConv.partner_name || selectedConv.participant_a || 'Unknown'}
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${typeLabels[selectedConv.conversation_type]?.color || ''}`}>
                {typeLabels[selectedConv.conversation_type]?.label || 'Chat'}
              </span>
            </div>
            <p className="text-[10px] text-[#5C5E72]">{selectedConv.partner_email || ''} {selectedConv.partner_phone ? '· ' + selectedConv.partner_phone : ''}</p>
          </div>
          <button onClick={() => openConversation(selectedConv)} className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] flex items-center justify-center text-[#8A8B9C] hover:text-white flex-shrink-0" title="Refresh messages">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="my-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 text-center">
            {error}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 py-3 pr-1">
          {msgLoading ? (
            <div className="text-center py-10">
              <svg className="w-6 h-6 animate-spin mx-auto text-[#5C5E72] mb-2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              <p className="text-xs text-[#5C5E72]">Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </div>
              <p className="text-xs text-[#5C5E72]">No messages yet</p>
              <p className="text-[10px] text-[#5C5E72]/60 mt-1">Partner hasn't sent any messages</p>
            </div>
          ) : (
            messages.map((msg: any) => {
              const isMe = msg.sender_id === profile.user_id;
              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                    isMe
                      ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white rounded-br-md'
                      : 'bg-[#1A1A24] text-white rounded-bl-md border border-white/[0.06]'
                  }`}>
                    {msg.file_url && (
                      <div className="mb-2">
                        {msg.file_type?.startsWith('image/') ? (
                          <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className="block">
                            <img src={msg.file_url} alt={msg.file_name || 'Image'} className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
                          </a>
                        ) : (
                          <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${isMe ? 'bg-white/10' : 'bg-[#12121A]'}`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                            <span className="truncate max-w-[120px]">{msg.file_name || 'Attachment'}</span>
                          </a>
                        )}
                      </div>
                    )}
                    {msg.content && <p>{msg.content}</p>}
                    <div className={`text-[9px] mt-1.5 ${isMe ? 'text-white/50' : 'text-[#5C5E72]'}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply input */}
        <div className="flex items-center gap-2 pt-3 border-t border-[#232330]">
          <input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendReply()}
            placeholder="Type your reply..."
            className="flex-1 h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-[#3B82F6]"
          />
          <button
            onClick={sendReply}
            disabled={!replyText.trim() || sending}
            className="w-11 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-opacity flex-shrink-0"
          >
            {sending ? (
              <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ─── INBOX LIST VIEW ────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#232330] mb-3">
        <div>
          <h3 className="text-lg font-bold text-white">Messages</h3>
          <p className="text-[11px] text-[#5C5E72]">{conversations.length} conversations</p>
        </div>
        <button
          onClick={load}
          className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] flex items-center justify-center text-[#8A8B9C] hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 text-center">
          {error}
          <button onClick={load} className="block mx-auto mt-1 text-[10px] text-[#3B82F6]">Retry</button>
        </div>
      )}

      {/* Conversations list — simple inbox */}
      {loading ? (
        <div className="text-center py-12">
          <svg className="w-6 h-6 animate-spin mx-auto text-[#5C5E72] mb-2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
          </svg>
          <p className="text-xs text-[#5C5E72]">Loading conversations...</p>
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </div>
          <p className="text-sm text-[#8A8B9C]">No messages yet</p>
          <p className="text-[11px] text-[#5C5E72]/60 mt-1 max-w-[200px] mx-auto">Partner messages will appear here</p>
        </div>
      ) : (
        <div className="space-y-0">
          {conversations.map((conv: any) => {
            const typeInfo = typeLabels[conv.conversation_type] || { label: 'Chat', color: 'text-gray-400 bg-gray-500/10 border-gray-500/20', dot: 'bg-gray-400' };
            const isUnread = conv.unread_b > 0;
            return (
              <div
                key={conv.id}
                onClick={() => openConversation(conv)}
                className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all ${
                  isUnread ? 'bg-[#3B82F6]/5' : 'hover:bg-[#1A1A24]/50'
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white font-bold text-sm">
                    {(conv.partner_name || conv.participant_a || 'P').charAt(0).toUpperCase()}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#12121A] ${typeInfo.dot}`} />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate ${isUnread ? 'font-bold text-white' : 'font-medium text-white'}`}>
                      {conv.partner_name || conv.participant_a || 'Unknown'}
                    </span>
                    <span className="text-[9px] text-[#5C5E72] flex-shrink-0 ml-2">
                      {conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'New'}
                    </span>
                  </div>
                  {conv.partner_email && (
                    <p className="text-[10px] text-[#5C5E72] truncate">{conv.partner_email}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <p className={`text-xs truncate ${isUnread ? 'text-white font-medium' : 'text-[#5C5E72]'}`}>
                      {conv.last_message || 'No messages yet'}
                    </p>
                  </div>
                </div>
                {/* Unread badge */}
                {isUnread && (
                  <div className="w-5 h-5 rounded-full bg-[#3B82F6] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {conv.unread_b}
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






// ═════════════════════════════════════════════════════════════════
// NOTIFICATION BELL COMPONENT
// ═════════════════════════════════════════════════════════════════

function NotificationBell({ userId }: { userId: string }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    loadCount();
    loadNotifications();

    // Real-time subscription
    const sub = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => { loadCount(); loadNotifications(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [userId]);

  async function loadCount() {
    const { count: c } = await getUnreadNotificationCount(userId);
    setCount(c || 0);
  }

  async function loadNotifications() {
    const { notifications: data } = await getNotifications(userId, 20);
    setNotifications(data || []);
  }

  async function handleMarkRead() {
    await markNotificationsRead(userId);
    setCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 w-80 max-h-[400px] overflow-y-auto bg-[#1A1A24] border border-[#2A2A3A] rounded-2xl shadow-2xl z-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#232330]">
              <span className="text-xs font-semibold text-white">Notifications</span>
              {count > 0 && (
                <button onClick={handleMarkRead} className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA]">
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-[#5C5E72]">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3 border-b border-[#232330] last:border-0 ${!n.is_read ? 'bg-[#3B82F6]/5' : ''}`}>
                  <p className="text-[11px] font-medium text-white">{n.title}</p>
                  <p className="text-[10px] text-[#8A8B9C] mt-0.5">{n.body}</p>
                  <p className="text-[9px] text-[#5C5E72] mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
