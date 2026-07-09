import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import SettingsTab from './SettingsTab';
import {
  getWorkerDashboardData,
  submitWorkerVerification,
  uploadWorkerVerificationVideo,
  getServiceCategories,
  getServiceSubcategories,
  requestWithdrawal,
  updateWalletBankDetails,
} from '@/lib/supabase';
import { WH_SUPPORT_EMAIL } from '@/config/wehouse';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile, ServiceCategory, ServiceSubcategory, WorkerVerification, Wallet, WalletTransaction, BlueBadgeSubscription } from '@/types';
import { WORKER_VERIFICATION_STATUS_COLORS } from '@/types';
import { Input } from '@/components/ui/input';
import { Toaster, toast } from 'sonner';

interface WorkerDashboardProps {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId: string) => void;
  onGoToMessages?: () => void;
}

// Worker tabs per Constitution: Overview, Bookings, Calendar, Wallet, Withdraw, Reviews, Services, Availability, Messages, Notifications, Verification Status, Profile, Settings
type WorkerTab = 'overview' | 'bookings' | 'calendar' | 'wallet' | 'withdraw' | 'reviews' | 'services' | 'availability' | 'messages' | 'notifications' | 'verification_status' | 'profile' | 'settings';

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; desc: string; icon: string }> = {
  pending: {
    color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20',
    label: 'Pending', desc: 'Request verification access to begin your profile setup.',
    icon: 'M12 8v4M12 16h.01',
  },
  approved_for_verification: {
    color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20',
    label: 'Blue Tick', desc: 'Access granted. Complete your profile and submit for review.',
    icon: 'M20 6L9 17l-5-5',
  },
  profile_under_review: {
    color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20',
    label: 'Under Review', desc: 'Your profile is being reviewed. You will be public once review is completed.',
    icon: 'M12 8v4M12 16h.01',
  },
  verified: {
    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20',
    label: 'Public', desc: 'Your profile is public. Users can find and book you.',
    icon: 'M20 6L9 17l-5-5',
  },
  suspended: {
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20',
    label: 'Suspended', desc: 'Contact WeHouse support for more information.',
    icon: 'M18 6L6 18M6 6l12 12',
  },
  rejected: {
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20',
    label: 'Rejected', desc: 'Review the feedback and re-submit your verification.',
    icon: 'M18 6L6 18M6 6l12 12',
  },
};

export default function WorkerDashboard({ profile, onGoToSetup, onLogout, onNavigate, onGoToChat }: WorkerDashboardProps) {
  const [activeTab, setActiveTab] = useState<WorkerTab>('overview');
  const status = profile.worker_status || 'pending';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  // Data states
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [verification, setVerification] = useState<WorkerVerification | null>(null);
  const [blueBadge, setBlueBadge] = useState<BlueBadgeSubscription | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  const loadDashboardData = useCallback(async () => {
    const data = await getWorkerDashboardData(profile.user_id);
    setWallet(data.wallet);
    setVerification(data.verification);
    setBlueBadge(data.blueBadge);
    setTransactions(data.transactions);
  }, [profile.user_id]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Worker verification flow: pending workers CANNOT access verification tab
  // They must be approved by admin/creator first
  const canAccessVerification = status !== 'pending';

  // Constitution tabs: Overview, Bookings, Calendar, Wallet, Withdraw, Reviews, Services, Availability, Messages, Notifications, Verification Status, Profile, Settings
  const tabs: { id: WorkerTab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'bookings', label: 'Bookings', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'calendar', label: 'Calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'wallet', label: 'Wallet', icon: 'M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM1 10h22' },
    { id: 'withdraw', label: 'Withdraw', icon: 'M12 19l7-7-7-7M5 12h14' },
    { id: 'reviews', label: 'Reviews', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
    { id: 'services', label: 'Services', icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
    { id: 'availability', label: 'Availability', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { id: 'messages', label: 'Messages', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
    { id: 'notifications', label: 'Alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    ...(canAccessVerification ? [{ id: 'verification_status' as WorkerTab, label: 'Status', icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 1 4.1-.252 3.42 3.42 0 0 0 3.388-3.388 3.42 3.42 0 0 1 2.567-1.932 3.42 3.42 0 0 0 2.568-1.932M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0' }] : []),
    { id: 'profile', label: 'Profile', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' },
    { id: 'settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate?.('home')}
              className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-sm font-bold text-white">Worker Dashboard</h1>
              <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onLogout} className="h-8 px-3 rounded-lg bg-white/[0.06] text-[10px] text-[#5C5E72] hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              Logout
            </button>
          </div>
        </div>

        {/* Status Banner */}
        <div className={`rounded-xl ${config.bg} border ${config.border} p-3`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={config.color}>
                <circle cx="12" cy="12" r="10" /><path d={config.icon} />
              </svg>
            </div>
            <div>
              <p className={`text-[11px] font-semibold ${config.color}`}>{config.label}</p>
              <p className="text-[9px] text-[#5C5E72]">{config.desc}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-[#1E1E2C] px-2 py-1">
        <div className="flex overflow-x-auto scrollbar-hide gap-0.5">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#3B82F6]/15 text-[#3B82F6]'
                    : 'text-[#5C5E72] hover:text-[#8B8DA0] hover:bg-white/[0.02]'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="px-5 py-4 max-w-lg mx-auto">
        {/* Constitution tabs: Overview, Bookings, Calendar, Wallet, Withdraw, Reviews, Services, Availability, Messages, Notifications, Verification Status, Profile, Settings */}
        {activeTab === 'overview' && (
          <OverviewTab
            profile={profile}
            wallet={wallet}
            blueBadge={blueBadge}
            onGoToSetup={onGoToSetup}
            onSetTab={setActiveTab}
          />
        )}
        {activeTab === 'verification_status' && (
          <VerificationTab
            profile={profile}
            verification={verification}
            onUpdate={loadDashboardData}
          />
        )}
        {activeTab === 'bookings' && <BookingsTab profile={profile} />}
        {activeTab === 'calendar' && <CalendarTab profile={profile} />}
        {activeTab === 'wallet' && (
          <WalletTab
            wallet={wallet}
            transactions={transactions}
            onUpdate={loadDashboardData}
          />
        )}
        {activeTab === 'withdraw' && <WithdrawTab wallet={wallet} profile={profile} onUpdate={loadDashboardData} />}
        {activeTab === 'services' && <ServicesTab profile={profile} />}
        {activeTab === 'reviews' && <ReviewsTab profile={profile} />}
        {activeTab === 'availability' && <AvailabilityTab profile={profile} />}
        {activeTab === 'messages' && <MessagesTab profile={profile} onGoToChat={onGoToChat} />}
        {activeTab === 'notifications' && <NotificationsTab userId={profile.user_id} />}
        {activeTab === 'profile' && <ProfileTab profile={profile} onGoToSetup={onGoToSetup} />}
        {activeTab === 'settings' && <SettingsTab profile={profile} onUpdate={(_p) => {}} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB (was HomeTab)
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ profile, wallet, blueBadge, onGoToSetup, onSetTab }: {
  profile: Profile;
  wallet: Wallet | null;
  blueBadge: BlueBadgeSubscription | null;
  onGoToSetup: () => void;
  onSetTab: (tab: WorkerTab) => void;
}) {
  const [stats, setStats] = useState({ views: 0, bookings: 0, rating: 0, completedJobs: 0 });
  const occupationLabel = profile.worker_occupation ? (WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation) : 'Not set';

  useEffect(() => {
    async function loadStats() {
      const { count: views } = await supabase
        .from('worker_views').select('*', { count: 'exact', head: true })
        .eq('worker_id', profile.user_id);
      // Total jobs = ALL jobs including cancelled (for history)
      const { count: totalJobs } = await supabase
        .from('worker_bookings').select('*', { count: 'exact', head: true })
        .eq('worker_id', profile.user_id);
      // Active jobs = NOT cancelled (what shows in "Jobs" stat)
      const { count: activeJobs } = await supabase
        .from('worker_bookings').select('*', { count: 'exact', head: true })
        .eq('worker_id', profile.user_id)
        .neq('status', 'cancelled');
      const { count: completed } = await supabase
        .from('worker_bookings').select('*', { count: 'exact', head: true })
        .eq('worker_id', profile.user_id)
        .eq('status', 'approved_released');
      setStats({ views: views || 0, bookings: activeJobs || 0, rating: 0, completedJobs: completed || 0 });
    }
    loadStats();
  }, [profile.user_id]);

  return (
    <div className="space-y-4">
      {/* Pending Approval Notice — only for new signups */}
      {profile.worker_status === 'pending' && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-400">Awaiting Admin Approval</p>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Your worker profile is pending review. Once approved by WeHouse admin, you will unlock the verification tab to submit your ID and skill video. After verification is approved, you will get the blue tick and appear in search results.</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stats — all tappable */}
      <div className="grid grid-cols-4 gap-2">
        <QuickStat icon="👁️" label="Views" value={stats.views} onClick={() => { /* Views has no dedicated tab, stays on home */ }} />
        <QuickStat icon="📋" label="Jobs" value={stats.bookings} onClick={() => onSetTab('bookings')} />
        <QuickStat icon="✅" label="Done" value={stats.completedJobs} onClick={() => onSetTab('bookings')} />
        <QuickStat icon="💰" label="Balance" value={`₦${(wallet?.available_balance || 0).toLocaleString()}`} onClick={() => onSetTab('wallet')} />
      </div>

      {/* Wallet Summary */}
      <div className="bg-gradient-to-br from-[#12121A] to-[#0E0E16] border border-[#1E1E2C] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-white">Wallet</h3>
          <button onClick={() => onSetTab('wallet')} className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA]">View All</button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-sm font-bold text-emerald-400">₦{(wallet?.available_balance || 0).toLocaleString()}</p>
            <p className="text-[9px] text-[#5C5E72]">Available</p>
          </div>
          <div className="text-center border-x border-[#1E1E2C]">
            <p className="text-sm font-bold text-amber-400">₦{(wallet?.pending_balance || 0).toLocaleString()}</p>
            <p className="text-[9px] text-[#5C5E72]">Pending</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white">₦{(wallet?.total_withdrawn || 0).toLocaleString()}</p>
            <p className="text-[9px] text-[#5C5E72]">Withdrawn</p>
          </div>
        </div>
      </div>

      {/* ═══ Verification Status Banner — Constitution Flow ═══ */}
      {profile.worker_status === 'verified' ? (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-400">Golden Badge — Verified</p>
            <p className="text-[10px] text-[#5C5E72]">Your profile is public and visible to customers</p>
          </div>
        </div>
      ) : profile.worker_status === 'profile_under_review' ? (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" /></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-violet-400">Under Review</p>
            <p className="text-[10px] text-[#5C5E72]">WeHouse is reviewing your application</p>
          </div>
        </div>
      ) : profile.worker_status === 'approved_for_verification' ? (
        <button
          onClick={() => onSetTab('verification_status')}
          className="w-full bg-gradient-to-r from-amber-500/10 to-amber-700/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3 hover:border-amber-500/40 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </div>
          <div className="flex-1 text-left">
            <p className="text-xs font-semibold text-amber-400">Golden Badge Active</p>
            <p className="text-[10px] text-[#5C5E72]">Click to submit your verification request</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      ) : (
        <button
          onClick={() => onSetTab('verification_status')}
          className="w-full bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-center gap-3 hover:border-blue-500/40 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="flex-1 text-left">
            <p className="text-xs font-semibold text-blue-400">Complete Verification</p>
            <p className="text-[10px] text-[#5C5E72]">Fill info, upload docs, pay fee, get verified</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      )}

      {/* Quick Actions Grid */}
      <div>
        <h3 className="text-[10px] font-semibold text-[#5C5E72] uppercase tracking-wider mb-2">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2">
          <QuickActionButton label="Edit Profile" icon="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" onClick={onGoToSetup} />
          <QuickActionButton label="My Jobs" icon="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2z" onClick={() => onSetTab('bookings')} />
          <QuickActionButton label="Verification" icon="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 1 4.1-.252 3.42 3.42 0 0 0 3.388-3.388 3.42 3.42 0 0 1 2.567-1.932 3.42 3.42 0 0 0 2.568-1.932M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0" onClick={() => onSetTab('verification_status')} />
          <QuickActionButton label="Withdraw" icon="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" onClick={() => onSetTab('wallet')} />
        </div>
      </div>

      {/* Profile Preview */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white font-bold text-sm overflow-hidden">
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : (profile.full_name || profile.username || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{profile.full_name || profile.username || 'Worker'}</p>
            <p className="text-[10px] text-[#5C5E72]">{occupationLabel} • {profile.city || 'No location'}</p>
          </div>
          <button onClick={() => onSetTab('settings')} className="text-[10px] text-[#3B82F6]">View</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VERIFICATION TAB
// ═══════════════════════════════════════════════════════════════

function VerificationTab({ profile, verification, onUpdate }: {
  profile: Profile;
  verification: WorkerVerification | null;
  onUpdate: () => void;
}) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Form state
  const [govIdType, setGovIdType] = useState<string>('nin');
  const [govIdNumber, setGovIdNumber] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Video upload state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [verificationVideoUrl, setVerificationVideoUrl] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const { categories: cats } = await getServiceCategories();
      setCategories(cats || []);
    }
    load();
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      getServiceSubcategories(selectedCategory).then(({ subcategories: subs }) => {
        setSubcategories(subs || []);
      });
    } else {
      setSubcategories([]);
    }
  }, [selectedCategory]);

  function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only MP4, MOV, or WebM videos are allowed');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast.error('Video must be under 100MB (2-3 minutes recommended)');
      return;
    }

    setVideoFile(file);
    const preview = URL.createObjectURL(file);
    setVideoPreviewUrl(preview);
  }

  function removeVideo() {
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVerificationVideoUrl(null);
    if (videoInputRef.current) videoInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!govIdNumber.trim() || !yearsExperience || !selectedCategory || !selectedSubcategory) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSubmitting(true);

    // Upload video if selected
    let uploadedVideoUrl = verificationVideoUrl;
    if (videoFile && !uploadedVideoUrl) {
      setUploadingVideo(true);
      toast.loading('Uploading verification video...', { id: 'video-upload' });
      const { url, error } = await uploadWorkerVerificationVideo(videoFile, profile.user_id);
      setUploadingVideo(false);
      toast.dismiss('video-upload');
      if (error) {
        toast.error('Video upload failed: ' + error.message);
        setSubmitting(false);
        return;
      }
      uploadedVideoUrl = url;
      setVerificationVideoUrl(url);
    }

    const { error } = await submitWorkerVerification({
      worker_id: profile.user_id,
      gov_id_type: govIdType as any,
      gov_id_number: govIdNumber.trim(),
      years_of_experience: parseInt(yearsExperience),
      service_category_id: selectedCategory,
      service_subcategory_id: selectedSubcategory,
      verification_video_url: uploadedVideoUrl,
    });
    setSubmitting(false);
    if (error) {
      toast.error('Failed to submit verification');
    } else {
      toast.success('Verification submitted successfully');
      onUpdate();
    }
  }

  // Show verification status if already submitted
  if (verification) {
    const statusColor = WORKER_VERIFICATION_STATUS_COLORS[verification.status];
    const steps = [
      { label: 'Submitted', done: true, desc: 'Your application was received' },
      { label: 'Under Review', done: verification.status !== 'pending', desc: 'Staff is reviewing your documents' },
      { label: 'Approved', done: verification.status === 'approved', desc: 'You can start receiving bookings' },
    ];

    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-white">Verification Status</h2>

        <div className={`rounded-xl ${statusColor} p-4`}>
          <p className="text-xs font-semibold capitalize">{verification.status.replace('_', ' ')}</p>
          {verification.review_notes && (
            <p className="text-[10px] mt-1 opacity-80">{verification.review_notes}</p>
          )}
        </div>

        {/* Progress Steps */}
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                step.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#1E1E2C] text-[#5C5E72]'
              }`}>
                {step.done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                ) : (
                  <span className="text-[9px]">{i + 1}</span>
                )}
              </div>
              <div>
                <p className={`text-xs font-medium ${step.done ? 'text-white' : 'text-[#5C5E72]'}`}>{step.label}</p>
                <p className="text-[10px] text-[#5C5E72]">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Submitted Info */}
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-4 space-y-2">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Submitted Information</p>
          <InfoRow label="ID Type" value={verification.gov_id_type?.toUpperCase() || '—'} />
          <InfoRow label="Experience" value={`${verification.years_of_experience} years`} />
          <InfoRow label="Service" value={verification.service_subcategory?.name || verification.service_category?.name || '—'} />
        </div>

        {/* Verification Video */}
        {verification.verification_video_url && (
          <div className="rounded-xl bg-[#12121A] border border-[#1E1E2C] p-4 space-y-2">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Skill Demonstration Video</p>
            <video
              src={verification.verification_video_url}
              className="w-full h-44 rounded-xl object-cover"
              controls
              preload="metadata"
            />
            <p className="text-[9px] text-[#5C5E72]">This video was reviewed by WeHouse admin to assess your skills.</p>
          </div>
        )}
      </div>
    );
  }

  // Show submission form
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Verify Your Account</h2>
        <p className="text-[10px] text-[#5C5E72]">Complete verification to start receiving bookings</p>
      </div>

      <div className="space-y-3">
        {/* Gov ID Type */}
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Government ID Type *</label>
          <select
            value={govIdType}
            onChange={(e) => setGovIdType(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-[#0A0A0F] border border-[#1E1E2C] text-xs text-white focus:border-[#3B82F6] focus:outline-none"
          >
            <option value="nin">National ID (NIN)</option>
            <option value="drivers_license">Driver&apos;s License</option>
            <option value="passport">International Passport</option>
            <option value="voters_card">Voter&apos;s Card</option>
          </select>
        </div>

        {/* Gov ID Number */}
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">ID Number *</label>
          <Input
            value={govIdNumber}
            onChange={(e) => setGovIdNumber(e.target.value)}
            placeholder="Enter your ID number"
            className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]"
          />
        </div>

        {/* Years of Experience */}
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Years of Experience *</label>
          <Input
            type="number"
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            placeholder="e.g. 5"
            className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]"
            min="0"
          />
        </div>

        {/* Service Category */}
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Service Category *</label>
          <select
            value={selectedCategory}
            onChange={(e) => { setSelectedCategory(e.target.value); setSelectedSubcategory(''); }}
            className="w-full h-9 px-3 rounded-lg bg-[#0A0A0F] border border-[#1E1E2C] text-xs text-white focus:border-[#3B82F6] focus:outline-none"
          >
            <option value="">Select category</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
            ))}
          </select>
        </div>

        {/* Service Subcategory */}
        {selectedCategory && (
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Specialty *</label>
            <select
              value={selectedSubcategory}
              onChange={(e) => setSelectedSubcategory(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#0A0A0F] border border-[#1E1E2C] text-xs text-white focus:border-[#3B82F6] focus:outline-none"
            >
              <option value="">Select specialty</option>
              {subcategories.map(sub => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Verification Video Upload */}
        <div className="rounded-xl bg-[#12121A] border border-[#1E1E2C] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>
            <label className="text-xs text-white font-medium">Skill Demonstration Video</label>
          </div>
          <p className="text-[10px] text-[#5C5E72]">
            Upload a 2-3 minute video showing your work. WeHouse admin reviews this to verify your skills. This is required for approval.
          </p>

          {!videoPreviewUrl ? (
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="w-full h-24 rounded-xl border-2 border-dashed border-[#2A2A3A] flex flex-col items-center justify-center text-[#5C5E72] hover:border-[#3B82F6]/50 hover:text-[#3B82F6] transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>
              <span className="text-[10px] mt-1">Tap to upload video (MP4, MOV, WebM)</span>
              <span className="text-[9px] text-[#5C5E72]">Max 100MB</span>
            </button>
          ) : (
            <div className="relative rounded-xl overflow-hidden bg-[#0A0A0F]">
              <video
                src={videoPreviewUrl}
                className="w-full h-40 object-cover"
                controls
                preload="metadata"
              />
              <button
                type="button"
                onClick={removeVideo}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/80 text-white flex items-center justify-center text-xs hover:bg-red-500 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
              {uploadingVideo && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={handleVideoSelect}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || uploadingVideo}
          className="w-full py-2.5 rounded-xl bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit Verification'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BOOKINGS TAB — WITH NEGOTIATION CONVERSATIONS
// ═══════════════════════════════════════════════════════════════

import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import { getMyBookingConversations, BOOKING_STATUS_LABELS } from '@/lib/supabase/worker-bookings';

function BookingsTab({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [activeChat, setActiveChat] = useState<{ conversationId: string; bookingId: string } | null>(null);

  useEffect(() => {
    loadConversations();
  }, [profile.user_id]);

  async function loadConversations() {
    setIsLoading(true);
    const { conversations: convs } = await getMyBookingConversations(profile.user_id);
    setConversations(convs || []);
    setIsLoading(false);
  }

  const filtered = filter === 'all'
    ? conversations
    : conversations.filter((c: any) => c.booking_status === filter);

  const filters = [
    { key: 'all', label: `All (${conversations.length})` },
    { key: 'booking_requested', label: 'New' },
    { key: 'negotiating', label: 'Negotiate' },
    { key: 'waiting_payment', label: 'Pending Pay' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'in_progress', label: 'Active' },
    { key: 'completed_pending_approval', label: 'Done' },
    { key: 'approved_released', label: 'Paid' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  // Open negotiation chat
  if (activeChat) {
    return (
      <BookingNegotiationChat
        conversationId={activeChat.conversationId}
        bookingId={activeChat.bookingId}
        profile={profile}
        isWorker={true}
        onClose={() => { setActiveChat(null); loadConversations(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">My Jobs</h2>
        <span className="text-[10px] text-[#5C5E72]">{conversations.length} total</span>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors ${
              filter === f.key ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#12121A] text-[#5C5E72] hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Conversations List */}
      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="📋" message="No jobs yet" submessage="Complete your verification to start receiving bookings. Negotiation requests will appear here." />
      ) : (
        <div className="space-y-2">
          {filtered.map(conv => {
            const statusInfo = BOOKING_STATUS_LABELS[conv.booking_status] || null;
            return (
              <button
                key={conv.conversation_id}
                onClick={() => setActiveChat({ conversationId: conv.conversation_id, bookingId: conv.booking_id })}
                className="w-full text-left bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3 hover:border-[#3B82F6]/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#5C5E72]">#{conv.booking_code}</span>
                    {conv.unread_count > 0 && (
                      <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[8px] text-white font-bold">{conv.unread_count}</span>
                    )}
                  </div>
                  {statusInfo && (
                    <span className={`text-[8px] px-2 py-0.5 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
                  )}
                </div>
                <p className="text-xs text-white font-medium">{conv.service_type}</p>
                {/* Worker sees who booked them */}
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-4 h-4 rounded-full bg-[#3B82F6]/20 flex items-center justify-center">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  </div>
                  <p className="text-[10px] text-[#8A8B9C]">
                    Booked by <span className="text-[#3B82F6] font-medium">@{conv.other_person_username || conv.other_person_name}</span>
                  </p>
                </div>
                {conv.last_message && (
                  <p className="text-[10px] text-[#8A8B9C] mt-1 truncate">{conv.last_message}</p>
                )}
                {conv.negotiated_amount > 0 && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#1E1E2C]">
                    <span className="text-xs text-emerald-400 font-medium">₦{conv.negotiated_amount?.toLocaleString()}</span>
                    <span className="text-[9px] text-[#5C5E72]">{new Date(conv.updated_at).toLocaleDateString()}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WALLET TAB
// ═══════════════════════════════════════════════════════════════

function WalletTab({ wallet, transactions, onUpdate }: {
  wallet: Wallet | null;
  transactions: WalletTransaction[];
  onUpdate: () => void;
}) {
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showBankSetup, setShowBankSetup] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [bankName, setBankName] = useState(wallet?.bank_name || '');
  const [accountNumber, setAccountNumber] = useState(wallet?.bank_account_number || '');
  const [accountName, setAccountName] = useState(wallet?.bank_account_name || '');
  const [processing, setProcessing] = useState(false);

  async function handleWithdraw() {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (!wallet) { toast.error('Wallet not found'); return; }
    if (wallet.available_balance < amount) { toast.error('Insufficient balance'); return; }

    setProcessing(true);
    const { error } = await requestWithdrawal(wallet.id, amount);
    setProcessing(false);

    if (error) {
      toast.error(error.message || 'Withdrawal failed');
    } else {
      toast.success('Withdrawal initiated');
      setShowWithdraw(false);
      setWithdrawAmount('');
      onUpdate();
    }
  }

  async function handleSaveBank() {
    if (!wallet) return;
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) {
      toast.error('All fields are required');
      return;
    }
    const { error } = await updateWalletBankDetails(wallet.id, {
      bank_name: bankName.trim(),
      bank_account_number: accountNumber.trim(),
      bank_account_name: accountName.trim(),
    });
    if (error) {
      toast.error('Failed to save bank details');
    } else {
      toast.success('Bank details saved');
      setShowBankSetup(false);
      onUpdate();
    }
  }

  return (
    <div className="space-y-4">
      {/* Balance Card */}
      <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-2xl p-5">
        <p className="text-[10px] text-emerald-400/70 mb-1">Available Balance</p>
        <p className="text-2xl font-bold text-white">₦{(wallet?.available_balance || 0).toLocaleString()}</p>
        <div className="flex gap-4 mt-3">
          <div>
            <p className="text-[9px] text-[#5C5E72]">Pending</p>
            <p className="text-xs text-amber-400">₦{(wallet?.pending_balance || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[9px] text-[#5C5E72]">Total Withdrawn</p>
            <p className="text-xs text-white">₦{(wallet?.total_withdrawn || 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setShowWithdraw(true)}
            disabled={!wallet || wallet.available_balance <= 0}
            className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-30"
          >
            Withdraw
          </button>
          <button
            onClick={() => setShowBankSetup(true)}
            className="px-4 py-2 rounded-xl bg-white/[0.06] text-[#5C5E72] text-xs hover:text-white transition-colors"
          >
            Bank
          </button>
        </div>
      </div>

      {/* Bank Details */}
      {wallet?.bank_name && (
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
          <p className="text-[10px] text-[#5C5E72] mb-1">Bank Account</p>
          <p className="text-xs text-white">{wallet.bank_name}</p>
          <p className="text-[10px] text-[#8B8DA0]">{wallet.bank_account_number} • {wallet.bank_account_name}</p>
        </div>
      )}

      {/* Transactions */}
      <div>
        <h3 className="text-xs font-semibold text-white mb-2">Recent Transactions</h3>
        {transactions.length === 0 ? (
          <p className="text-[10px] text-[#5C5E72] py-4 text-center">No transactions yet</p>
        ) : (
          <div className="space-y-1.5">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02]">
                <div>
                  <p className="text-[11px] text-white">{tx.description || tx.type}</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()}</p>
                </div>
                <p className={`text-xs font-medium ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tx.amount >= 0 ? '+' : ''}₦{tx.amount.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdraw Modal */}
      {showWithdraw && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">Withdraw Funds</h3>
            <p className="text-[10px] text-[#5C5E72]">Available: ₦{(wallet?.available_balance || 0).toLocaleString()}</p>
            <Input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Enter amount"
              className="h-10 text-sm bg-[#0A0A0F] border-[#1E1E2C]"
              min="500"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowWithdraw(false)} className="flex-1 py-2 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs">Cancel</button>
              <button onClick={handleWithdraw} disabled={processing} className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-xs font-medium disabled:opacity-50">
                {processing ? 'Processing...' : 'Withdraw'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bank Setup Modal */}
      {showBankSetup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-sm font-semibold text-white">Bank Account</h3>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank Name" className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]" />
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account Number" className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]" />
            <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account Name" className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]" />
            <div className="flex gap-2">
              <button onClick={() => setShowBankSetup(false)} className="flex-1 py-2 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs">Cancel</button>
              <button onClick={handleSaveBank} className="flex-1 py-2 rounded-xl bg-[#3B82F6] text-white text-xs font-medium">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SERVICES TAB
// ═══════════════════════════════════════════════════════════════

function ServicesTab({ profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);

  useEffect(() => {
    getServiceCategories().then(({ categories: cats }) => setCategories(cats || []));
  }, []);

  const occupationLabel = profile.worker_occupation ? (WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation) : 'Not set';

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-white">My Services</h2>

      {/* Current Service */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <p className="text-[10px] text-[#5C5E72] mb-1">Current Service</p>
        <p className="text-sm font-semibold text-white">{occupationLabel}</p>
        {profile.worker_bio && (
          <p className="text-[11px] text-[#8B8DA0] mt-2 leading-relaxed">{profile.worker_bio}</p>
        )}
      </div>

      {/* Available Categories */}
      <div>
        <p className="text-[10px] text-[#5C5E72] mb-2 uppercase tracking-wider">Available Categories</p>
        <div className="grid grid-cols-2 gap-2">
          {categories.map(cat => (
            <div key={cat.id} className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3 text-center">
              <span className="text-xl">{cat.icon}</span>
              <p className="text-[10px] text-white mt-1">{cat.name}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REVIEWS TAB
// ═══════════════════════════════════════════════════════════════

function ReviewsTab({ profile }: { profile: Profile }) {
  const [reviews, setReviews] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reviews')
        .select('*')
        .eq('reviewee_id', profile.user_id)
        .order('created_at', { ascending: false });
      setReviews(data || []);
    }
    load();
  }, [profile.user_id]);

  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Reviews</h2>
        <div className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#FBBF24" stroke="#FBBF24" strokeWidth="1"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          <span className="text-xs text-white font-medium">{avgRating}</span>
          <span className="text-[10px] text-[#5C5E72]">({reviews.length})</span>
        </div>
      </div>

      {reviews.length === 0 ? (
        <EmptyState icon="⭐" message="No reviews yet" submessage="Complete jobs to receive reviews from customers" />
      ) : (
        <div className="space-y-2">
          {reviews.map(review => (
            <div key={review.id} className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                {[1, 2, 3, 4, 5].map(star => (
                  <svg key={star} width="12" height="12" viewBox="0 0 24 24" fill={star <= review.rating ? '#FBBF24' : 'none'} stroke="#FBBF24" strokeWidth="1">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
              {review.comment && <p className="text-[11px] text-[#8B8DA0]">{review.comment}</p>}
              <p className="text-[9px] text-[#5C5E72] mt-1">{new Date(review.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES TAB
// ═══════════════════════════════════════════════════════════════

function MessagesTab({ profile, onGoToChat }: { profile: Profile; onGoToChat?: (convId: string) => void }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('conversations')
        .select('*, messages(count), last_message')
        .or(`participant_a.eq.${profile.user_id},participant_b.eq.${profile.user_id}`)
        .order('updated_at', { ascending: false });
      setConversations(data || []);
      setLoading(false);
    }
    load();
  }, [profile.user_id]);

  async function openChat(convId: string) {
    if (onGoToChat) {
      onGoToChat(convId);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;

  if (conversations.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[#5C5E72]">No messages yet</p>
        <p className="text-[10px] text-[#3C3D4D] mt-1">Messages from users who booked you will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-white mb-3">Messages</h2>
      {conversations.map(conv => (
        <button
          key={conv.id}
          onClick={() => openChat(conv.id)}
          className="w-full text-left bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3 hover:border-[#3B82F6]/20 transition-colors"
        >
          <p className="text-xs text-white font-medium">{conv.title || 'Chat'}</p>
          {conv.last_message && <p className="text-[10px] text-[#5C5E72] mt-0.5 truncate">{conv.last_message}</p>}
          <p className="text-[9px] text-[#3C3D4D] mt-1">{new Date(conv.updated_at).toLocaleDateString()}</p>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════

function ProfileTab({ profile, onGoToSetup }: { profile: Profile; onGoToSetup: () => void }) {
  const occupationLabel = profile.worker_occupation ? (WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation) : 'Not set';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Profile</h2>
        <button onClick={onGoToSetup} className="text-[10px] text-[#3B82F6]">Edit</button>
      </div>

      {/* Avatar & Name */}
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white font-bold text-lg overflow-hidden">
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : (profile.full_name || '?')[0].toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{profile.full_name || profile.username || 'Worker'}</p>
          <p className="text-[10px] text-[#5C5E72]">@{profile.username} • {occupationLabel}</p>
        </div>
      </div>

      {/* Details */}
      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4 space-y-3">
        <InfoRow label="Email" value={profile.email} />
        <InfoRow label="Phone" value={profile.phone || 'Not set'} />
        <InfoRow label="Location" value={`${profile.city || '—'}, ${profile.state || '—'}`} />
        <InfoRow label="Occupation" value={occupationLabel} />
        <InfoRow label="Status" value={profile.worker_status || 'pending'} />
        {profile.worker_bio && (
          <div className="pt-2 border-t border-[#1E1E2C]">
            <p className="text-[10px] text-[#5C5E72] mb-1">About</p>
            <p className="text-xs text-[#8B8DA0]">{profile.worker_bio}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT TAB
// ═══════════════════════════════════════════════════════════════

function SupportTab({}: {}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-white">Support</h2>

      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path d="M22 6l-10 7L2 6" /></svg>
          </div>
          <div>
            <p className="text-xs font-medium text-white">Email Support</p>
            <p className="text-[10px] text-[#5C5E72]">{WH_SUPPORT_EMAIL}</p>
          </div>
        </div>
      </div>

      <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-4">
        <p className="text-xs font-medium text-white mb-2">Common Issues</p>
        <div className="space-y-2">
          {[
            'How do I get verified?',
            'When will I receive payment?',
            'How do I update my bank details?',
            'What is the Blue Badge?',
            'How do I change my service category?',
          ].map((q, i) => (
            <div key={i} className="py-2 px-3 rounded-lg hover:bg-white/[0.02] cursor-pointer">
              <p className="text-[11px] text-[#8B8DA0]">{q}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function QuickStat({ icon, label, value, onClick }: { icon: string; label: string; value: string | number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`bg-[#12121A] border border-[#1E1E2C] rounded-xl p-2.5 text-center w-full transition-all active:scale-[0.97] hover:border-[#3B82F6]/30 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <p className="text-base">{icon}</p>
      <p className="text-[11px] font-bold text-white mt-0.5">{value}</p>
      <p className="text-[8px] text-[#5C5E72]">{label}</p>
    </button>
  );
}

function QuickActionButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3 flex items-center gap-2.5 hover:bg-white/[0.02] transition-colors active:scale-[0.98]">
      <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d={icon} /></svg>
      </div>
      <span className="text-[11px] font-medium text-white">{label}</span>
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-[#5C5E72]">{label}</span>
      <span className="text-[11px] text-white font-medium">{value}</span>
    </div>
  );
}

function EmptyState({ icon, message, submessage }: { icon: string; message: string; submessage: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-2xl mb-2">{icon}</p>
      <p className="text-sm text-[#5C5E72]">{message}</p>
      <p className="text-[10px] text-[#3C3D4D] mt-1">{submessage}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR TAB
// ═══════════════════════════════════════════════════════════════

function CalendarTab({ profile }: { profile: Profile }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('worker_bookings')
      .select('*')
      .eq('worker_id', profile.user_id)
      .order('scheduled_date', { ascending: true });
    setEvents(data || []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Schedule</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">Your upcoming jobs and availability.</p>
      </div>
      {events.length === 0 ? (
        <EmptyState icon="📅" message="No scheduled events" submessage="Your bookings will appear here." />
      ) : (
        <div className="space-y-2">
          {events.map((e: any) => (
            <div key={e.id} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
              <p className="text-xs font-semibold text-white">{e.service_type || 'Booking'}</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">
                {e.scheduled_date ? new Date(e.scheduled_date).toLocaleDateString() : 'No date'}
              </p>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-2 inline-block ${
                e.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                e.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                'bg-[#1A1A24] text-[#5C5E72] border border-[#232330]'
              }`}>{e.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WITHDRAW TAB
// ═══════════════════════════════════════════════════════════════

function WithdrawTab({ wallet, profile, onUpdate }: { wallet: Wallet | null; profile: Profile; onUpdate: () => void }) {
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState(wallet?.bank_name || '');
  const [accountNumber, setAccountNumber] = useState(wallet?.bank_account_number || '');
  const [accountName, setAccountName] = useState(wallet?.bank_account_name || '');
  const [processing, setProcessing] = useState(false);

  const available = wallet?.available_balance || 0;
  const minWithdraw = 1000;

  async function handleWithdraw() {
    const amt = parseFloat(amount);
    if (!amt || amt < minWithdraw) { toast.error(`Minimum withdrawal is ₦${minWithdraw.toLocaleString()}`); return; }
    if (amt > available) { toast.error('Insufficient balance'); return; }
    if (!bankName || !accountNumber || !accountName) { toast.error('Please fill in all bank details'); return; }

    setProcessing(true);
    try {
      // Save bank details first
      await updateWalletBankDetails(profile.user_id, { bank_name: bankName, bank_account_number: accountNumber, bank_account_name: accountName });
      // Request withdrawal
      await requestWithdrawal(profile.user_id, amt);
      toast.success('Withdrawal request submitted');
      setAmount('');
      onUpdate();
    } catch (e: any) {
      toast.error(e.message || 'Withdrawal failed');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 p-4">
        <p className="text-[10px] text-[#5C5E72]">Available Balance</p>
        <p className="text-2xl font-bold text-white mt-1">₦{available.toLocaleString()}</p>
      </div>

      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
        <h4 className="text-xs font-semibold text-white">Withdraw Funds</h4>
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Amount (₦)</label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Min ₦${minWithdraw.toLocaleString()}`} className="bg-[#1A1A24] border-[#232330] text-white" />
        </div>
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Bank Name</label>
          <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. GTBank" className="bg-[#1A1A24] border-[#232330] text-white" />
        </div>
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Account Number</label>
          <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="10-digit account number" className="bg-[#1A1A24] border-[#232330] text-white" />
        </div>
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Account Name</label>
          <Input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Full account name" className="bg-[#1A1A24] border-[#232330] text-white" />
        </div>
        <button
          onClick={handleWithdraw}
          disabled={processing || !amount || parseFloat(amount) < minWithdraw}
          className="w-full h-10 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? 'Processing...' : 'Request Withdrawal'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AVAILABILITY TAB
// ═══════════════════════════════════════════════════════════════

function AvailabilityTab({ profile }: { profile: Profile }) {
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const timeSlots = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'];

  useEffect(() => {
    loadAvailability();
  }, []);

  async function loadAvailability() {
    const { data } = await supabase
      .from('worker_availability')
      .select('*')
      .eq('worker_id', profile.user_id);
    const map: Record<string, boolean> = {};
    (data || []).forEach((a: any) => {
      map[`${a.day}-${a.time_slot}`] = a.is_available;
    });
    setAvailability(map);
  }

  async function toggleSlot(day: string, slot: string) {
    const key = `${day}-${slot}`;
    const newValue = !availability[key];
    setSaving(true);
    await supabase.from('worker_availability').upsert({
      worker_id: profile.user_id,
      day,
      time_slot: slot,
      is_available: newValue,
    }, { onConflict: 'worker_id,day,time_slot' });
    setAvailability(prev => ({ ...prev, [key]: newValue }));
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Availability</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">Set your working hours. Users can book you during available slots.</p>
      </div>

      {saving && (
        <div className="text-center">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}

      <div className="space-y-3">
        {days.map(day => (
          <div key={day} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-3">
            <p className="text-xs font-semibold text-white mb-2">{day}</p>
            <div className="flex flex-wrap gap-1.5">
              {timeSlots.map(slot => {
                const isAvail = availability[`${day}-${slot}`];
                return (
                  <button
                    key={slot}
                    onClick={() => toggleSlot(day, slot)}
                    className={`px-2 py-1 rounded-lg text-[9px] font-medium border transition-all ${
                      isAvail
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-[#1A1A24] border-[#232330] text-[#5C5E72]'
                    }`}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS TAB
// ═══════════════════════════════════════════════════════════════

function NotificationsTab({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const sub = supabase
      .channel(`worker_notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [userId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications(data || []);
    setLoading(false);
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Notifications</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">Stay updated on your bookings and account.</p>
      </div>
      {notifications.length === 0 ? (
        <EmptyState icon="🔔" message="No notifications" submessage="New alerts will appear here." />
      ) : (
        notifications.map(n => (
          <button
            key={n.id}
            onClick={() => markRead(n.id)}
            className={`w-full text-left rounded-xl p-3 border transition-all ${
              n.is_read
                ? 'bg-[#12121A]/30 border-white/[0.02]'
                : 'bg-[#12121A]/60 border-white/[0.04]'
            }`}
          >
            <p className={`text-xs ${n.is_read ? 'text-[#8A8B9C]' : 'text-white font-medium'}`}>{n.title}</p>
            <p className="text-[10px] text-[#5C5E72] mt-0.5">{n.body}</p>
            <p className="text-[9px] text-[#3C3D4D] mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
          </button>
        ))
      )}
    </div>
  );
}


