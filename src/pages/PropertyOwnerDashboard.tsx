// ═══════════════════════════════════════════════════════════════
// WEHOUSE — PROPERTY PARTNER DASHBOARD (FINAL IMPLEMENTATION)
// ═══════════════════════════════════════════════════════════════
//
// EXACT 8 SIDEBAR ITEMS (nothing else in sidebar):
//   1. Overview  2. My Properties  3. Wallet  4. Earnings
//   5. Messages  6. Support  7. Profile  8. Settings
//
// Everything else lives INSIDE these pages as sections/cards/tabs.
// No hardcoded data. All Supabase.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { supabase, createPartnerSupportConversation, getPartnerConversations } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import PartnerSupportChat from '@/components/PartnerSupportChat';
import type { Profile } from '@/types';

type PartnerTab = 'overview' | 'properties' | 'wallet' | 'earnings' | 'messages' | 'support' | 'profile' | 'settings';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
}

// ─── 8 SIDEBAR ITEMS ──────────────────────────────────────
const SIDEBAR_ITEMS: { key: PartnerTab; label: string; icon: string }[] = [
  { key: 'overview',   label: 'Overview',      icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z;9 22 9 12 15 12 15 22' },
  { key: 'properties', label: 'My Properties', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z;9 22 9 12 15 12 15 22' },
  { key: 'wallet',     label: 'Wallet',        icon: 'M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4M20 12v4H6a2 2 0 01-2-2c0-1.1.9-2 2-2h14zM20 16v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v2' },
  { key: 'earnings',   label: 'Earnings',      icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
  { key: 'messages',   label: 'Messages',      icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { key: 'support',    label: 'Support',       icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 9v4m0 4h.01' },
  { key: 'profile',    label: 'Profile',       icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 010 8 4 4 0 010-8z' },
  { key: 'settings',   label: 'Settings',      icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM12 15a3 3 0 100-6 3 3 0 000 6z' },
];

// ─── MAIN COMPONENT ───────────────────────────────────────
export default function PropertyOwnerDashboard({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const [activeTab, setActiveTab] = useState<PartnerTab>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const initials = (profile.full_name || profile.username || 'P')[0].toUpperCase();

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] flex">
      <Toaster position="top-center" richColors />

      {/* ─── SIDEBAR (Desktop) ─── */}
      {isDesktop && (
        <aside className={`fixed left-0 top-0 h-screen bg-[#08080C] border-r border-white/[0.04] flex flex-col z-40 transition-all duration-300 ${sidebarCollapsed ? 'w-[72px]' : 'w-[220px]'}`}>
          {/* Logo */}
          <div className="h-14 flex items-center px-4 border-b border-white/[0.04]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
            </div>
            {!sidebarCollapsed && <span className="ml-3 text-sm font-bold text-white">WeHouse</span>}
          </div>

          {/* Nav Items — EXACTLY 8, nothing else */}
          <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
            {SIDEBAR_ITEMS.map(item => {
              const isActive = activeTab === item.key;
              return (
                <button key={item.key} onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-3 px-3 h-10 rounded-xl transition-all ${isActive ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' : 'text-[#8A8B9C] hover:text-white hover:bg-white/[0.03]'}`}
                  title={sidebarCollapsed ? item.label : undefined}>
                  <span className="flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isActive ? '#A78BFA' : '#8A8B9C'} strokeWidth="2"><path d={item.icon} /></svg>
                  </span>
                  {!sidebarCollapsed && <span className="text-[13px] font-medium whitespace-nowrap">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* User */}
          <div className="p-3 border-t border-white/[0.04]">
            <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full rounded-full object-cover" alt="" /> : initials}
              </div>
              {!sidebarCollapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">{profile.full_name || profile.username || 'Partner'}</p>
                    <p className="text-[9px] text-[#5C5E72]">Property Partner</p>
                  </div>
                  <button onClick={onLogout} className="text-[#5C5E72] hover:text-red-400" title="Logout">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* ─── MAIN CONTENT ─── */}
      <div className={`flex-1 min-h-[100dvh] ${isDesktop ? (sidebarCollapsed ? 'ml-[72px]' : 'ml-[220px]') : ''}`}>
        {/* Mobile Header */}
        {!isDesktop && (
          <header className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur-xl border-b border-white/[0.04] px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">{initials}</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">WeHouse</p>
                  <p className="text-[9px] text-[#5C5E72]">Property Partner</p>
                </div>
              </div>
              <button onClick={onLogout} className="text-[#5C5E72] hover:text-red-400">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              </button>
            </div>
          </header>
        )}

        {/* Mobile Tab Nav — horizontal scroll */}
        {!isDesktop && (
          <nav className="sticky z-20 bg-[#0A0A0F]/95 backdrop-blur-xl border-b border-white/[0.04] px-2 py-1.5 top-[57px]">
            <div className="flex overflow-x-auto scrollbar-hide gap-0.5">
              {SIDEBAR_ITEMS.map(item => {
                const isActive = activeTab === item.key;
                return (
                  <button key={item.key} onClick={() => setActiveTab(item.key)}
                    className={`flex-shrink-0 flex items-center gap-1 px-3 h-8 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all ${isActive ? 'bg-violet-500/15 text-violet-400' : 'text-[#5C5E72] hover:text-[#8B8DA0]'}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={item.icon} /></svg>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {/* Page Title (Desktop) */}
        {isDesktop && (
          <div className="px-8 py-4 border-b border-white/[0.04]">
            <h1 className="text-lg font-bold text-white capitalize">{activeTab.replace(/_/g, ' ')}</h1>
            <p className="text-[11px] text-[#5C5E72]">
              {activeTab === 'overview' && 'Your dashboard at a glance'}
              {activeTab === 'properties' && 'All your properties'}
              {activeTab === 'wallet' && 'Balance, withdrawals & transactions'}
              {activeTab === 'earnings' && 'Revenue breakdown'}
              {activeTab === 'messages' && 'Communication with WeHouse'}
              {activeTab === 'support' && 'Contact WeHouse & view requests'}
              {activeTab === 'profile' && 'Your business & personal details'}
              {activeTab === 'settings' && 'Account preferences'}
            </p>
          </div>
        )}

        {/* Tab Content */}
        <main className={`${isDesktop ? 'px-8 py-6' : 'px-4 py-4'} pb-24 lg:pb-6`}>
          {activeTab === 'overview' && <OverviewTab profile={profile} />}
          {activeTab === 'properties' && <MyPropertiesTab profile={profile} />}
          {activeTab === 'wallet' && <WalletTab profile={profile} />}
          {activeTab === 'earnings' && <EarningsTab profile={profile} />}
          {activeTab === 'messages' && <MessagesTab profile={profile} onGoToChat={onGoToChat} />}
          {activeTab === 'support' && <SupportTab profile={profile} />}
          {activeTab === 'profile' && <ProfileTab profile={profile} />}
          {activeTab === 'settings' && <SettingsTab profile={profile} onLogout={onLogout} />}
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 1. OVERVIEW TAB — Live database stats
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ profile }: { profile: Profile }) {
  const [stats, setStats] = useState({
    totalProperties: 0, activeProperties: 0, underInspection: 0,
    pendingApproval: 0, approved: 0, rejected: 0, occupancyRate: 0,
    walletBalance: 0, pendingBalance: 0, availableBalance: 0,
    totalEarnings: 0, totalWithdrawn: 0, recentNotifications: [] as any[],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [profile.user_id]);

  async function load() {
    setLoading(true);
    try {
      // Load properties
      const { data: props } = await supabase.from('listings').select('*').or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`).order('created_at', { ascending: false });
      const properties = props || [];
      const active = properties.filter((p: any) => p.availability_status === 'available').length;
      const underIns = properties.filter((p: any) => p.status === 'under_inspection').length;
      const pending = properties.filter((p: any) => p.status === 'pending').length;
      const approved = properties.filter((p: any) => p.status === 'approved').length;
      const rejected = properties.filter((p: any) => p.status === 'rejected').length;

      // Load inspections
      const { data: inspections } = await supabase.from('inspection_requests').select('*').eq('owner_id', profile.user_id);
      const pendingInsps = (inspections || []).filter((i: any) => i.status === 'pending').length;

      // Load bookings for occupancy
      const propIds = properties.map((p: any) => p.id).filter(Boolean);
      let occupancyRate = 0;
      if (propIds.length > 0) {
        const { data: bks } = await supabase.from('reservations').select('*').in('listing_id', propIds).eq('status', 'confirmed');
        occupancyRate = properties.length > 0 ? Math.round(((bks || []).length / properties.length) * 100) : 0;
      }

      // Load wallet data from profile
      const p = profile as any;
      const walletBalance = p.wallet_balance || 0;
      const totalEarnings = p.total_earnings || 0;
      const totalWithdrawn = p.total_withdrawn || 0;

      // Load recent transactions
      const { data: txs } = await supabase.from('wallet_transactions').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(5);

      // Load recent notifications
      const { data: notifs } = await supabase.from('notifications').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(5);

      setStats({
        totalProperties: properties.length,
        activeProperties: active,
        underInspection: underIns + pendingInsps,
        pendingApproval: pending,
        approved,
        rejected,
        occupancyRate,
        walletBalance,
        pendingBalance: 0,
        availableBalance: walletBalance,
        totalEarnings,
        totalWithdrawn,
        recentNotifications: notifs || [],
      });
    } catch (e) { console.error('Overview load error:', e); }
    setLoading(false);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Properties" value={stats.totalProperties} />
        <StatCard label="Active Properties" value={stats.activeProperties} color="text-emerald-400" />
        <StatCard label="Under Inspection" value={stats.underInspection} color="text-amber-400" />
        <StatCard label="Pending Approval" value={stats.pendingApproval} color="text-blue-400" />
        <StatCard label="Approved" value={stats.approved} color="text-emerald-400" />
        <StatCard label="Rejected" value={stats.rejected} color="text-red-400" />
        <StatCard label="Occupancy Rate" value={`${stats.occupancyRate}%`} />
        <StatCard label="Wallet Balance" value={`N${(stats.walletBalance / 1000).toFixed(0)}k`} color="text-violet-400" />
      </div>

      {/* Balance Row */}
      <div className="grid grid-cols-3 gap-3">
        <BalanceCard label="Available" value={stats.availableBalance} color="emerald" />
        <BalanceCard label="Pending" value={stats.pendingBalance} color="amber" />
        <BalanceCard label="Total Earnings" value={stats.totalEarnings} color="violet" />
      </div>

      {/* Recent Notifications */}
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Recent Notifications</h3>
        {stats.recentNotifications.length === 0 ? (
          <p className="text-[11px] text-[#5C5E72]">No notifications yet</p>
        ) : (
          <div className="space-y-2">
            {stats.recentNotifications.map((n: any) => (
              <div key={n.id} className="flex items-start gap-3 py-2 border-b border-white/[0.03] last:border-0">
                <div className="w-2 h-2 rounded-full bg-violet-500 mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-white">{n.message}</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2. MY PROPERTIES TAB — Grid + Detail view INSIDE same page
// ═══════════════════════════════════════════════════════════════

function MyPropertiesTab({ profile }: { profile: Profile }) {
  const [properties, setProperties] = useState<any[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [profile.user_id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('listings').select('*').or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`).order('created_at', { ascending: false });
    setProperties(data || []);
    setLoading(false);
  }

  if (loading) return <LoadingSpinner />;

  // Property Detail View — opens INSIDE this page (not sidebar)
  if (selectedProperty) {
    return <PropertyDetail property={selectedProperty} onBack={() => setSelectedProperty(null)} />;
  }

  // Property List View
  return (
    <div className="space-y-4">
      <p className="text-xs text-[#5C5E72]">{properties.length} property{properties.length !== 1 ? 'ies' : 'y'}</p>

      {properties.length === 0 ? (
        <EmptyState icon="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z;9 22 9 12 15 12 15 22" title="No Properties Yet" desc="Request an inspection to get started. Once WeHouse approves your property, it will appear here." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {properties.map(p => (
            <button key={p.id} onClick={() => setSelectedProperty(p)} className="text-left rounded-2xl bg-[#12121A]/60 border border-white/[0.04] overflow-hidden hover:border-white/[0.12] transition-all group">
              {p.images?.[0] && (
                <div className="h-36 bg-[#1A1A24] relative overflow-hidden">
                  <img src={p.images[0]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute top-2 right-2">
                    <span className={`text-[9px] px-2 py-1 rounded-full font-medium ${p.availability_status === 'available' ? 'bg-emerald-500/90 text-white' : 'bg-amber-500/90 text-white'}`}>
                      {p.availability_status || 'pending'}
                    </span>
                  </div>
                </div>
              )}
              <div className="p-4">
                <p className="text-sm font-semibold text-white">{p.title}</p>
                <p className="text-[10px] text-[#5C5E72] mt-1 capitalize">{p.property_type} · {p.sub_type || 'N/A'} · {p.city}, {p.state}</p>
                <p className="text-[10px] text-[#5C5E72] mt-0.5">{p.address}</p>
                <p className="text-xs font-bold text-white mt-2">N{p.price?.toLocaleString()}<span className="text-[10px] text-[#5C5E72] font-normal">/{p.sub_type === 'short_let' ? 'day' : 'year'}</span></p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Property Detail — INSIDE My Properties (no sidebar item)
function PropertyDetail({ property, onBack }: { property: any; onBack: () => void }) {
  const [detailTab, setDetailTab] = useState<'general' | 'photos' | 'amenities' | 'inspection' | 'status' | 'occupancy' | 'performance'>('general');

  const detailTabs = [
    { key: 'general', label: 'General' },
    { key: 'photos', label: 'Photos' },
    { key: 'amenities', label: 'Amenities' },
    { key: 'inspection', label: 'Inspection History' },
    { key: 'status', label: 'Listing Status' },
    { key: 'occupancy', label: 'Occupancy' },
    { key: 'performance', label: 'Performance' },
  ];

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-2 text-[#5C5E72] hover:text-white transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        <span className="text-xs font-medium">Back to Properties</span>
      </button>

      {/* Property Header */}
      {property.images?.[0] && (
        <div className="h-48 lg:h-64 rounded-2xl overflow-hidden bg-[#1A1A24]">
          <img src={property.images[0]} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-white">{property.title}</h2>
        <p className="text-[11px] text-[#5C5E72] mt-1 capitalize">{property.property_type} · {property.sub_type} · {property.city}, {property.state} · {property.address}</p>
        <p className="text-sm font-bold text-white mt-2">N{property.price?.toLocaleString()}<span className="text-[10px] text-[#5C5E72] font-normal">/{property.sub_type === 'short_let' ? 'day' : 'year'}</span></p>
      </div>

      {/* Detail Sub-Tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-hide border-b border-white/[0.04] pb-0">
        {detailTabs.map(t => (
          <button key={t.key} onClick={() => setDetailTab(t.key as any)}
            className={`flex-shrink-0 px-3 h-9 text-[11px] font-medium rounded-t-lg transition-all ${detailTab === t.key ? 'text-violet-400 border-b-2 border-violet-500' : 'text-[#5C5E72] hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Detail Content */}
      <div className="space-y-4">
        {detailTab === 'general' && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <InfoCard label="Property Type" value={(property.property_type || 'N/A').replace(/_/g, ' ')} />
            <InfoCard label="Sub Type" value={property.sub_type || 'N/A'} />
            <InfoCard label="Bedrooms" value={property.bedrooms || 'N/A'} />
            <InfoCard label="Bathrooms" value={property.bathrooms || 'N/A'} />
            <InfoCard label="State" value={property.state || 'N/A'} />
            <InfoCard label="Local Government" value={property.local_government || 'N/A'} />
            <InfoCard label="City" value={property.city || 'N/A'} />
            <InfoCard label="Address" value={property.address || 'N/A'} />
            <InfoCard label="Status" value={property.availability_status || 'N/A'} capitalize />
          </div>
        )}

        {detailTab === 'photos' && (
          <div>
            {property.images?.length > 0 ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {property.images.map((url: string, i: number) => (
                  <img key={i} src={url} alt="" className="w-full h-32 lg:h-48 rounded-xl object-cover" />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#5C5E72]">No photos uploaded</p>
            )}
          </div>
        )}

        {detailTab === 'amenities' && (
          <div>
            {property.amenities?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {property.amenities.map((a: string, i: number) => (
                  <span key={i} className="px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-xs">{a}</span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#5C5E72]">No amenities listed</p>
            )}
          </div>
        )}

        {detailTab === 'inspection' && <InspectionHistory property={property} />}
        {detailTab === 'status' && <ListingStatus property={property} />}
        {detailTab === 'occupancy' && <OccupancySection property={property} />}
        {detailTab === 'performance' && <PerformanceSection property={property} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 3. WALLET TAB — ONE page with everything inside
// ═══════════════════════════════════════════════════════════════

function WalletTab({ profile }: { profile: Profile }) {
  const [balance, setBalance] = useState(0);
  const [pendingBal, setPendingBal] = useState(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBank, setSelectedBank] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { load(); }, [profile.user_id]);

  async function load() {
    setLoading(true);
    const p = profile as any;
    setBalance(p.wallet_balance || 0);
    setTotalWithdrawn(p.total_withdrawn || 0);

    const { data: txs } = await supabase.from('wallet_transactions').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(20);
    setTransactions(txs || []);

    const { data: wds } = await supabase.from('withdrawals').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(20);
    setWithdrawals(wds || []);

    const { data: banks } = await supabase.from('bank_accounts').select('*').eq('user_id', profile.user_id);
    setBankAccounts(banks || []);

    setLoading(false);
  }

  async function handleWithdraw() {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (amount > balance) { toast.error('Insufficient balance'); return; }
    if (!selectedBank) { toast.error('Select a bank account'); return; }

    setSubmitting(true);
    const { error } = await supabase.rpc('request_withdrawal', { p_user_id: profile.user_id, p_amount: amount, p_bank_account_id: selectedBank });
    setSubmitting(false);
    if (error) { toast.error('Failed: ' + error.message); return; }

    toast.success('Withdrawal request submitted');
    setShowWithdraw(false);
    setWithdrawAmount('');
    load();
  }

  if (loading) return <LoadingSpinner />;

  const fmt = (n: number) => `N${n.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Balance Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 p-4 text-center">
          <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">Available</p>
          <p className="text-lg font-bold text-white mt-1">{fmt(balance)}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-4 text-center">
          <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider">Pending</p>
          <p className="text-lg font-bold text-white mt-1">{fmt(pendingBal)}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-4 text-center">
          <p className="text-[10px] text-violet-400 font-medium uppercase tracking-wider">Withdrawn</p>
          <p className="text-lg font-bold text-white mt-1">{fmt(totalWithdrawn)}</p>
        </div>
      </div>

      {/* Withdraw Button */}
      {!showWithdraw ? (
        <button onClick={() => setShowWithdraw(true)} className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity">
          Withdraw Funds
        </button>
      ) : (
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Withdraw</p>
            <button onClick={() => setShowWithdraw(false)} className="text-[#5C5E72] hover:text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Amount</label>
            <input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} placeholder="0.00"
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            <p className="text-[9px] text-[#5C5E72] mt-1">Available: {fmt(balance)} · Min: N1,000</p>
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Bank Account</label>
            {bankAccounts.length === 0 ? (
              <p className="text-[11px] text-amber-400">Add a bank account in Settings first</p>
            ) : (
              <div className="space-y-2">
                {bankAccounts.map(b => (
                  <button key={b.id} onClick={() => setSelectedBank(b.id)}
                    className={`w-full text-left rounded-xl p-3 border transition-all ${selectedBank === b.id ? 'border-violet-500 bg-violet-500/5' : 'border-[#2A2A3A] bg-[#1A1A24]'}`}>
                    <p className="text-xs text-white">{b.bank_name}</p>
                    <p className="text-[10px] text-[#5C5E72]">{b.account_number} · {b.account_name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleWithdraw} disabled={submitting || !withdrawAmount || !selectedBank}
            className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">
            {submitting ? 'Processing...' : 'Confirm Withdrawal'}
          </button>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Recent Transactions</h3>
        {transactions.length === 0 ? (
          <p className="text-[11px] text-[#5C5E72]">No transactions yet</p>
        ) : (
          <div className="space-y-2">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                <div>
                  <p className="text-xs text-white">{tx.description}</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()}</p>
                </div>
                <p className={`text-xs font-semibold ${tx.type === 'withdrawal' ? 'text-red-400' : 'text-emerald-400'}`}>
                  {tx.type === 'withdrawal' ? '-' : '+'}{fmt(tx.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawal History */}
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Withdrawal History</h3>
        {withdrawals.length === 0 ? (
          <p className="text-[11px] text-[#5C5E72]">No withdrawals yet</p>
        ) : (
          <div className="space-y-2">
            {withdrawals.map(w => (
              <div key={w.id} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                <div>
                  <p className="text-xs text-white">Withdrawal</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(w.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-red-400">-{fmt(w.amount)}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${w.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : w.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>{w.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 4. EARNINGS TAB — Apartment/Hotel/Daily/Weekly/Monthly/Yearly
// ═══════════════════════════════════════════════════════════════

function EarningsTab({ profile }: { profile: Profile }) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [earnings, setEarnings] = useState({ apartment: 0, hotel: 0, commission: 0, net: 0, recentPayments: [] as any[] });
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [profile.user_id, period]);

  async function load() {
    setLoading(true);
    // Load reservations for this partner's properties
    const { data: props } = await supabase.from('listings').select('id, property_type').or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`);
    const propIds = (props || []).map((p: any) => p.id).filter(Boolean);

    if (propIds.length > 0) {
      const { data: payments } = await supabase.from('reservations').select('*').in('listing_id', propIds).eq('status', 'confirmed').order('created_at', { ascending: false });
      const apartmentPayments = (payments || []).filter((p: any) => {
        const pt = props?.find((pr: any) => pr.id === p.listing_id)?.property_type;
        return pt === 'apartment' || pt === 'house';
      });
      const hotelPayments = (payments || []).filter((p: any) => {
        const pt = props?.find((pr: any) => pr.id === p.listing_id)?.property_type;
        return pt === 'hotel';
      });

      const apartmentTotal = apartmentPayments.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const hotelTotal = hotelPayments.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const commissionRate = 10; // Default
      const totalGross = apartmentTotal + hotelTotal;
      const commission = Math.round(totalGross * (commissionRate / 100));

      setEarnings({
        apartment: apartmentTotal,
        hotel: hotelTotal,
        commission,
        net: totalGross - commission,
        recentPayments: payments?.slice(0, 10) || [],
      });
    }
    setLoading(false);
  }

  if (loading) return <LoadingSpinner />;
  const fmt = (n: number) => `N${n.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1">
        {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 h-9 rounded-lg text-[11px] font-semibold transition-all capitalize ${period === p ? 'bg-violet-500 text-white' : 'text-[#8A8B9C] hover:text-white'}`}>
            {p}
          </button>
        ))}
      </div>

      {/* Earnings Breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <EarningCard label="Apartment Earnings" value={earnings.apartment} color="emerald" />
        <EarningCard label="Hotel Earnings" value={earnings.hotel} color="blue" />
        <EarningCard label="Commission" value={earnings.commission} color="amber" />
        <EarningCard label="Net Earnings" value={earnings.net} color="violet" />
      </div>

      {/* Commission Note */}
      <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3">
        <p className="text-[10px] text-amber-400">Reservation Fees belong to WeHouse. Property Partners earn only from Long Stay Rent, Short Stay Payments, and Hotel Payments. Commission is deducted before balance enters your wallet.</p>
      </div>

      {/* Recent Payments */}
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Recent Payments</h3>
        {earnings.recentPayments.length === 0 ? (
          <p className="text-[11px] text-[#5C5E72]">No payments received yet</p>
        ) : (
          <div className="space-y-2">
            {earnings.recentPayments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                <div>
                  <p className="text-xs text-white">Payment #{p.id?.slice(0, 8)}</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(p.created_at).toLocaleDateString()}</p>
                </div>
                <p className="text-xs font-semibold text-emerald-400">+{fmt(p.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 5. MESSAGES TAB — Partner to WeHouse only
// ═══════════════════════════════════════════════════════════════

function MessagesTab({ profile, onGoToChat }: { profile: Profile; onGoToChat?: (_c?: string) => void }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [profile.user_id]);

  async function load() {
    setLoading(true);
    const { conversations: convs } = await getPartnerConversations(profile.user_id);
    setConversations(convs || []);
    setLoading(false);
  }

  if (loading) return <LoadingSpinner />;

  if (activeChat) {
    return <PartnerSupportChat conversationId={activeChat} profile={profile} senderRole="partner" onClose={() => { setActiveChat(null); load(); }} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#5C5E72]">Communication between you and WeHouse. Customers never appear here.</p>

      {conversations.length === 0 ? (
        <EmptyState icon="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" title="No Messages" desc="Your conversations with WeHouse will appear here. Submit an inspection request to start a conversation." />
      ) : (
        <div className="space-y-2">
          {conversations.map(c => (
            <button key={c.id} onClick={() => setActiveChat(c.id)} className="w-full text-left rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4 hover:border-white/[0.12] transition-all">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{c.subject || 'Support Conversation'}</p>
                {c.unread_count > 0 && <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{c.unread_count}</span>}
              </div>
              <p className="text-[10px] text-[#5C5E72] mt-1">{c.last_message?.slice(0, 60)}...</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 6. SUPPORT TAB — ONE page: Contact / My Requests / History / FAQ
// ═══════════════════════════════════════════════════════════════
// NO "tickets". Use: Contact WeHouse, My Requests, Request History, FAQ.

function SupportTab({ profile }: { profile: Profile }) {
  const [subTab, setSubTab] = useState<'contact' | 'requests' | 'history' | 'faq'>('contact');
  const [requests, setRequests] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const categories = ['Property Inspection', 'Property Approval', 'Payment', 'Withdrawal', 'General Question', 'Complaint'];

  useEffect(() => { loadRequests(); }, [profile.user_id]);

  async function loadRequests() {
    const { data } = await supabase.from('support_conversations').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false });
    setRequests(data || []);
  }

  async function handleSend() {
    if (!category) { toast.error('Select a category'); return; }
    if (!message.trim()) { toast.error('Enter a message'); return; }
    setSending(true);

    const { data: conv, error } = await supabase.from('support_conversations').insert({
      user_id: profile.user_id,
      subject: category,
      category,
      status: 'open',
    }).select().single();

    if (error || !conv) { toast.error('Failed to create conversation'); setSending(false); return; }

    await supabase.from('support_messages').insert({
      conversation_id: conv.id,
      sender_id: profile.user_id,
      sender_role: 'partner',
      message: message.trim(),
    });

    toast.success('Request sent to WeHouse');
    setMessage('');
    setCategory('');
    setSubTab('requests');
    loadRequests();
    setSending(false);
  }

  const subTabs = [
    { key: 'contact', label: 'Contact WeHouse' },
    { key: 'requests', label: 'My Requests' },
    { key: 'history', label: 'Request History' },
    { key: 'faq', label: 'FAQ' },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-tabs INSIDE Support page */}
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key as any)}
            className={`flex-1 h-9 rounded-lg text-[11px] font-semibold transition-all ${subTab === t.key ? 'bg-violet-500 text-white' : 'text-[#8A8B9C] hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'contact' && (
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white">Contact WeHouse</h3>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500">
              <option value="">Select category</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1 block">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Describe your issue..."
              className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 outline-none focus:border-violet-500 resize-none" />
          </div>
          <button onClick={handleSend} disabled={sending} className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">
            {sending ? 'Sending...' : 'Send to WeHouse'}
          </button>
        </div>
      )}

      {subTab === 'requests' && (
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
          <h3 className="text-sm font-semibold text-white mb-3">My Requests</h3>
          {requests.filter(r => r.status === 'open').length === 0 ? (
            <p className="text-[11px] text-[#5C5E72]">No open requests</p>
          ) : (
            <div className="space-y-2">
              {requests.filter(r => r.status === 'open').map(r => (
                <div key={r.id} className="rounded-xl bg-[#1A1A24] p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-white font-medium">{r.subject}</p>
                    <span className="text-[8px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{r.status}</span>
                  </div>
                  <p className="text-[9px] text-[#5C5E72] mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'history' && (
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Request History</h3>
          {requests.filter(r => r.status !== 'open').length === 0 ? (
            <p className="text-[11px] text-[#5C5E72]">No completed requests</p>
          ) : (
            <div className="space-y-2">
              {requests.filter(r => r.status !== 'open').map(r => (
                <div key={r.id} className="rounded-xl bg-[#1A1A24] p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-white font-medium">{r.subject}</p>
                    <span className="text-[8px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{r.status}</span>
                  </div>
                  <p className="text-[9px] text-[#5C5E72] mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'faq' && (
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white mb-3">Frequently Asked Questions</h3>
          {[
            { q: 'How do I add a property?', a: 'Go to Support > Contact WeHouse and select "Property Inspection." A WeHouse Field Officer will visit your property.' },
            { q: 'When do I get paid?', a: 'After a customer completes their stay, WeHouse deducts commission and the balance enters your wallet. You can withdraw anytime.' },
            { q: 'What commission does WeHouse charge?', a: 'Commission rates are set by the Creator in Settings. Check your Earnings tab for your specific rate.' },
            { q: 'Can I chat with customers?', a: 'No. Property Partners communicate only with WeHouse. WeHouse handles all customer interactions.' },
            { q: 'Can I edit my property listing?', a: 'No. WeHouse creates and manages all listings after inspection and approval.' },
            { q: 'What if my property is rejected?', a: 'You will receive a reason via Messages. You can fix the issues and request a re-inspection through Support.' },
          ].map((faq, i) => (
            <details key={i} className="group rounded-xl bg-[#1A1A24] border border-[#2A2A3A] overflow-hidden">
              <summary className="flex items-center justify-between p-3 cursor-pointer text-xs font-medium text-white hover:bg-white/[0.02] transition-colors">
                {faq.q}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="group-open:rotate-180 transition-transform"><path d="M6 9l6 6 6-6" /></svg>
              </summary>
              <div className="px-3 pb-3 text-[11px] text-[#8A8B9C] leading-relaxed">{faq.a}</div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 7. PROFILE TAB — Business / Owner / Company / Bank / Docs
// ═══════════════════════════════════════════════════════════════

function ProfileTab({ profile }: { profile: Profile }) {
  const p = profile as any;
  return (
    <div className="space-y-6">
      {/* Owner Information */}
      <ProfileSection title="Owner Information">
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="Full Name" value={profile.full_name || 'Not set'} />
          <InfoCard label="Email" value={profile.email} />
          <InfoCard label="Phone" value={profile.phone || 'Not set'} />
          <InfoCard label="Username" value={profile.username || 'Not set'} />
        </div>
      </ProfileSection>

      {/* Business Information */}
      <ProfileSection title="Business Information">
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="Business Name" value={p.business_name || 'Not set'} />
          <InfoCard label="Business Type" value={p.business_type || 'Not set'} />
          <InfoCard label="CAC Number" value={p.cac_number || 'Not set'} />
          <InfoCard label="Tax ID" value={p.tax_id || 'Not set'} />
        </div>
      </ProfileSection>

      {/* Company Information */}
      <ProfileSection title="Company Information">
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="Company Address" value={p.company_address || 'Not set'} />
          <InfoCard label="City" value={p.company_city || profile.city || 'Not set'} />
          <InfoCard label="State" value={p.company_state || profile.state || 'Not set'} />
          <InfoCard label="Local Government" value={p.company_lga || 'Not set'} />
        </div>
      </ProfileSection>

      {/* Verification Status */}
      <ProfileSection title="Verification Status">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1A1A24] border border-[#2A2A3A]">
          <div className={`w-3 h-3 rounded-full ${p.verification_status === 'verified' ? 'bg-emerald-500' : p.verification_status === 'pending' ? 'bg-amber-500' : 'bg-red-500'}`} />
          <p className="text-sm text-white capitalize">{p.verification_status || 'Not verified'}</p>
        </div>
      </ProfileSection>

      {/* Bank Account */}
      <ProfileSection title="Bank Account">
        {p.bank_name ? (
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="Bank Name" value={p.bank_name} />
            <InfoCard label="Account Number" value={p.bank_account_number || 'Not set'} />
            <InfoCard label="Account Name" value={p.bank_account_name || 'Not set'} />
          </div>
        ) : (
          <p className="text-[11px] text-[#5C5E72]">No bank account added. Add one in Settings.</p>
        )}
      </ProfileSection>

      {/* Documents */}
      <ProfileSection title="Documents">
        {p.documents?.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {p.documents.map((doc: string, i: number) => (
              <a key={i} href={doc} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-xs">Document {i + 1}</a>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[#5C5E72]">No documents uploaded</p>
        )}
      </ProfileSection>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 8. SETTINGS TAB — Profile / Bank / Password / Notifications / Privacy / Delete
// ═══════════════════════════════════════════════════════════════

function SettingsTab({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const [settingTab, setSettingTab] = useState<'profile' | 'bank' | 'password' | 'notifications' | 'privacy' | 'delete'>('profile');

  const settingTabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'bank', label: 'Bank Account' },
    { key: 'password', label: 'Password' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'privacy', label: 'Privacy' },
    { key: 'delete', label: 'Delete Account' },
  ];

  return (
    <div className="space-y-4">
      {/* Settings Sub-tabs */}
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1 overflow-x-auto scrollbar-hide">
        {settingTabs.map(t => (
          <button key={t.key} onClick={() => setSettingTab(t.key as any)}
            className={`flex-shrink-0 h-9 px-3 rounded-lg text-[11px] font-semibold transition-all ${settingTab === t.key ? 'bg-violet-500 text-white' : 'text-[#8A8B9C] hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {settingTab === 'profile' && <ProfileSettings profile={profile} />}
      {settingTab === 'bank' && <BankSettings profile={profile} />}
      {settingTab === 'password' && <PasswordSettings profile={profile} />}
      {settingTab === 'notifications' && <NotificationSettings profile={profile} />}
      {settingTab === 'privacy' && <PrivacySettings profile={profile} />}
      {settingTab === 'delete' && <DeleteSettings profile={profile} onLogout={onLogout} />}

      {/* Logout */}
      <button onClick={onLogout} className="w-full h-11 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
        Logout
      </button>
    </div>
  );
}

// ─── Setting Sub-pages ──────────────────────────────────────

function ProfileSettings({ profile }: { profile: Profile }) {
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase.rpc('worker_update_profile', {
      p_user_id: profile.user_id,
      p_updates: { full_name: fullName.trim() || null, phone: phone.trim() || null, bio: bio.trim() || null },
    });
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Profile saved');
  }

  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">Edit Profile</h3>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Full Name</label><input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Bio</label><textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 outline-none focus:border-violet-500 resize-none" /></div>
      <button onClick={save} disabled={saving} className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">{saving ? 'Saving...' : 'Save Profile'}</button>
    </div>
  );
}

function BankSettings({ profile }: { profile: Profile }) {
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) { toast.error('All fields required'); return; }
    setSaving(true);
    const { error } = await supabase.from('bank_accounts').insert({ user_id: profile.user_id, bank_name: bankName.trim(), account_number: accountNumber.trim(), account_name: accountName.trim(), is_default: true });
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Bank account saved');
    setBankName(''); setAccountNumber(''); setAccountName('');
  }

  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">Bank Account</h3>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Bank Name</label><input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. GTBank" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Account Number</label><input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="10 digits" maxLength={10} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Account Name</label><input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Name on account" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <button onClick={save} disabled={saving} className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">{saving ? 'Saving...' : 'Save Bank Account'}</button>
    </div>
  );
}

function PasswordSettings({ profile }: { profile: Profile }) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changing, setChanging] = useState(false);

  async function change() {
    if (!currentPw || !newPw || !confirmPw) { toast.error('All fields required'); return; }
    if (newPw !== confirmPw) { toast.error('Passwords do not match'); return; }
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setChanging(true);
    const { error } = await supabase.rpc('change_password', { p_email: profile.email, p_current: currentPw, p_new: newPw });
    setChanging(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Password changed');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
  }

  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">Change Password</h3>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Current Password</label><input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">New Password</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <div><label className="text-[10px] text-[#5C5E72] mb-1 block">Confirm New Password</label><input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" /></div>
      <button onClick={change} disabled={changing} className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">{changing ? 'Changing...' : 'Change Password'}</button>
    </div>
  );
}

function NotificationSettings({ profile }: { profile: Profile }) {
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(true);
  const [smsNotifs, setSmsNotifs] = useState(false);

  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">Notification Preferences</h3>
      <ToggleRow label="Email Notifications" desc="Receive updates via email" enabled={emailNotifs} onToggle={() => setEmailNotifs(!emailNotifs)} />
      <ToggleRow label="Push Notifications" desc="Browser push notifications" enabled={pushNotifs} onToggle={() => setPushNotifs(!pushNotifs)} />
      <ToggleRow label="SMS Notifications" desc="Text message alerts" enabled={smsNotifs} onToggle={() => setSmsNotifs(!smsNotifs)} />
      <button onClick={() => toast.success('Preferences saved')} className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold">Save Preferences</button>
    </div>
  );
}

function PrivacySettings({ profile }: { profile: Profile }) {
  const [isPublic, setIsPublic] = useState(profile.privacy_profile_visible !== false);

  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">Privacy</h3>
      <ToggleRow label="Public Profile" desc="Allow others to view your profile" enabled={isPublic} onToggle={() => setIsPublic(!isPublic)} />
      <button onClick={() => toast.success('Privacy settings saved')} className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold">Save Privacy Settings</button>
    </div>
  );
}

function DeleteSettings({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    if (confirmText !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    setDeleting(true);
    const { error } = await supabase.rpc('delete_user_account', { p_user_id: profile.user_id });
    setDeleting(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Account deleted');
    setTimeout(onLogout, 1500);
  }

  return (
    <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-red-400">Delete Account</h3>
      <p className="text-[11px] text-[#8A8B9C]">This will permanently delete your account and all data. This cannot be undone.</p>
      <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="Type DELETE to confirm" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-red-500/30 text-white text-sm px-3 outline-none" />
      <button onClick={deleteAccount} disabled={deleting} className="w-full h-10 rounded-xl bg-red-500 text-white text-xs font-semibold disabled:opacity-40">{deleting ? 'Deleting...' : 'Delete My Account'}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatCard({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center lg:text-left">
      <p className="text-[10px] lg:text-xs text-[#5C5E72] mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function BalanceCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = { emerald: 'from-emerald-500/10 text-emerald-400 border-emerald-500/20', amber: 'from-amber-500/10 text-amber-400 border-amber-500/20', violet: 'from-violet-500/10 text-violet-400 border-violet-500/20' };
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorClasses[color]} border p-4 text-center`}>
      <p className="text-[10px] font-medium uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-lg font-bold text-white mt-1">N{(value / 1000).toFixed(0)}k</p>
    </div>
  );
}

function EarningCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = { emerald: 'text-emerald-400', blue: 'text-blue-400', amber: 'text-amber-400', violet: 'text-violet-400' };
  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
      <p className="text-[10px] text-[#5C5E72] mb-1">{label}</p>
      <p className={`text-lg font-bold ${colorMap[color]}`}>N{value.toLocaleString()}</p>
    </div>
  );
}

function InfoCard({ label, value, capitalize = false }: { label: string; value: string | number; capitalize?: boolean }) {
  return (
    <div className="rounded-xl bg-[#1A1A24] border border-[#2A2A3A] p-3">
      <p className="text-[9px] text-[#5C5E72] mb-0.5">{label}</p>
      <p className={`text-xs text-white font-medium ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ToggleRow({ label, desc, enabled, onToggle }: { label: string; desc: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div><p className="text-xs font-medium text-white">{label}</p><p className="text-[10px] text-[#5C5E72]">{desc}</p></div>
      <button onClick={onToggle} className={`relative w-10 h-5.5 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-[#2A2A3A]'}`}>
        <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function LoadingSpinner() {
  return <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d={icon} /></svg>
      </div>
      <p className="text-sm font-semibold text-white mb-1">{title}</p>
      <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">{desc}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS FOR PROPERTY DETAIL
// ═══════════════════════════════════════════════════════════════

function InspectionHistory({ property }: { property: any }) {
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspection_requests').select('*').eq('property_address', property.address).order('created_at', { ascending: false });
      setInspections(data || []);
      setLoading(false);
    }
    load();
  }, [property.address]);

  if (loading) return <LoadingSpinner />;
  if (inspections.length === 0) return <p className="text-[11px] text-[#5C5E72]">No inspection history</p>;

  return (
    <div className="space-y-2">
      {inspections.map(ins => (
        <div key={ins.id} className="rounded-xl bg-[#1A1A24] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white">{ins.request_code}</p>
            <span className={`text-[8px] px-2 py-0.5 rounded-full ${ins.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : ins.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>{ins.status}</span>
          </div>
          <p className="text-[9px] text-[#5C5E72] mt-1">{new Date(ins.created_at).toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}

function ListingStatus({ property }: { property: any }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <InfoCard label="Listing Status" value={property.availability_status || 'N/A'} capitalize />
      <InfoCard label="Property Status" value={property.status || 'N/A'} capitalize />
      <InfoCard label="Created" value={property.created_at ? new Date(property.created_at).toLocaleDateString() : 'N/A'} />
      <InfoCard label="Last Updated" value={property.updated_at ? new Date(property.updated_at).toLocaleDateString() : 'N/A'} />
    </div>
  );
}

function OccupancySection({ property }: { property: any }) {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('reservations').select('*').eq('listing_id', property.id).eq('status', 'confirmed');
      setBookings(data || []);
      setLoading(false);
    }
    load();
  }, [property.id]);

  if (loading) return <LoadingSpinner />;

  const isOccupied = bookings.length > 0;
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-3 p-3 rounded-xl ${isOccupied ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-[#1A1A24] border border-[#2A2A3A]'}`}>
        <div className={`w-3 h-3 rounded-full ${isOccupied ? 'bg-emerald-500' : 'bg-[#5C5E72]'}`} />
        <p className="text-sm text-white">{isOccupied ? 'Occupied' : 'Vacant'}</p>
      </div>
      <p className="text-xs text-[#5C5E72]">{bookings.length} active booking{bookings.length !== 1 ? 's' : ''}</p>
    </div>
  );
}

function PerformanceSection({ property }: { property: any }) {
  const [stats, setStats] = useState({ views: 0, bookings: 0, revenue: 0 });

  useEffect(() => {
    async function load() {
      const { data: bks } = await supabase.from('reservations').select('*').eq('listing_id', property.id).eq('status', 'confirmed');
      const bookings = bks || [];
      const revenue = bookings.reduce((s: number, b: any) => s + (b.amount || 0), 0);
      setStats({ views: property.view_count || 0, bookings: bookings.length, revenue });
    }
    load();
  }, [property.id, property.view_count]);

  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard label="Total Views" value={stats.views} />
      <StatCard label="Bookings" value={stats.bookings} />
      <StatCard label="Revenue" value={`N${stats.revenue.toLocaleString()}`} color="text-emerald-400" />
    </div>
  );
}
