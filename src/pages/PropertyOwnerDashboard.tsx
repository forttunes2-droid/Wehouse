import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
// NOTE: All financial rates (commission, fees) come from Creator Platform Settings
// Do NOT hardcode percentages. Use get_setting_v2() to load from platform_settings.
import SettingsTab from './SettingsTab';
import PartnerSupportChat from '@/components/PartnerSupportChat';
import { getPartnerConversations, createPartnerSupportConversation } from '@/lib/supabase/partner-support';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (c?: string) => void;
}

// Property Partner tabs per Constitution: Overview, My Properties, Inspection Requests, Bookings, Occupancy, Wallet, Withdraw, Earnings, Contracts, Messages, Support, Profile, Settings
type PartnerTab = 'overview' | 'properties' | 'inspections' | 'bookings' | 'occupancy' | 'wallet' | 'withdraw' | 'earnings' | 'contracts' | 'messages' | 'support' | 'profile' | 'settings';

const TAB_CONFIG: { key: PartnerTab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { key: 'properties', label: 'My Properties', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z' },
  { key: 'inspections', label: 'Inspections', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { key: 'bookings', label: 'Bookings', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { key: 'occupancy', label: 'Occupancy', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { key: 'wallet', label: 'Wallet', icon: 'M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM1 10h22' },
  { key: 'withdraw', label: 'Withdraw', icon: 'M12 19l7-7-7-7M5 12h14' },
  { key: 'earnings', label: 'Earnings', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'contracts', label: 'Contracts', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'messages', label: 'Messages', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { key: 'support', label: 'Support', icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 9v4m0 4h.01' },
  { key: 'profile', label: 'Profile', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' },
  { key: 'settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function PropertyOwnerDashboard({ profile, onLogout: _onLogout, onNavigate: _onNavigate, onGoToChat }: Props) {
  const [activeTab, setActiveTab] = useState<PartnerTab>('overview');
  const [properties, setProperties] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalProperties: 0, totalBookings: 0, occupancyRate: 0, totalEarnings: 0, pendingInspections: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    // Load properties WEHOUSE created for this partner (view only)
    const { data: props } = await supabase
      .from('listings')
      .select('*')
      .or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`)
      .eq('availability_status', 'available')
      .order('created_at', { ascending: false });
    setProperties(props || []);

    // Load inspection requests this partner made
    const { data: insps } = await supabase
      .from('inspection_requests')
      .select('*')
      .eq('owner_id', profile.user_id)
      .order('created_at', { ascending: false });
    setInspections(insps || []);

    // Load bookings for partner's properties
    const propertyIds = (props || []).map((p: any) => p.id).filter(Boolean);
    if (propertyIds.length > 0) {
      const { data: bks } = await supabase
        .from('reservations')
        .select('*')
        .in('listing_id', propertyIds)
        .order('created_at', { ascending: false });
      setBookings(bks || []);
    }

    // Stats
    const totalProps = props?.length || 0;
    const totalBks = bookings.length;
    const occupancy = totalProps > 0 ? Math.round((totalBks / totalProps) * 100) : 0;
    const earnings = bookings.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
    const pendingInsps = insps?.filter((i: any) => i.status === 'pending').length || 0;

    setStats({ totalProperties: totalProps, totalBookings: totalBks, occupancyRate: occupancy, totalEarnings: earnings, pendingInspections: pendingInsps });
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      {/* ═══ HEADER ═══ */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#0A0A0F] to-[#16213e]" />
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }} />
        <div className="relative px-5 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <span className="text-white font-bold text-sm">{(profile.username || profile.email || 'P')[0].toUpperCase()}</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-white">Property Partner</h1>
                <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
              </div>
            </div>
            <button onClick={_onLogout} className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#5C5E72] hover:text-red-400 hover:border-red-500/20 transition-all" title="Logout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="Properties" value={stats.totalProperties} />
            <StatCard label="Bookings" value={stats.totalBookings} />
            <StatCard label="Occupancy" value={`${stats.occupancyRate}%`} />
            <StatCard label="Earnings" value={`N${(stats.totalEarnings / 1000).toFixed(0)}k`} />
          </div>
        </div>
      </header>

      {/* ═══ PROMINENT REQUEST INSPECTION — Always Visible ═══ */}
      <div className="px-4 py-3">
        <button
          onClick={() => setActiveTab('inspections')}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-violet-500/20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Request Property Inspection
        </button>
      </div>

      {/* ═══ TAB NAV ═══ */}
      <nav className="sticky top-0 z-40 bg-[#0A0A0F]/80 backdrop-blur-xl border-b border-white/[0.04] px-3 py-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {TAB_CONFIG.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap ${activeTab === t.key ? 'bg-gradient-to-r from-violet-500 to-violet-700 text-white shadow-lg shadow-violet-500/25' : 'text-[#5C5E72] hover:text-white hover:bg-white/[0.05]'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ═══ TAB CONTENT ═══ */}
      <main className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {/* Constitution tabs: Overview, My Properties, Inspection Requests, Bookings, Occupancy, Wallet, Withdraw, Earnings, Contracts, Messages, Support, Profile, Settings */}
            {activeTab === 'overview' && <OverviewTab stats={stats} profile={profile} onSetTab={setActiveTab} onGoToChat={onGoToChat} inspections={inspections} />}
            {activeTab === 'properties' && <PropertiesTab properties={properties} />}
            {activeTab === 'inspections' && <InspectionsTab inspections={inspections} profile={profile} onConversationCreated={loadAll} />}
            {activeTab === 'bookings' && <BookingsTab bookings={bookings} properties={properties} />}
            {activeTab === 'occupancy' && <OccupancyTab properties={properties} bookings={bookings} />}
            {activeTab === 'wallet' && <WalletTab profile={profile} />}
            {activeTab === 'withdraw' && <WithdrawTab profile={profile} />}
            {activeTab === 'earnings' && <EarningsTab bookings={bookings} />}
            {activeTab === 'contracts' && <ContractsTab profile={profile} />}
            {activeTab === 'messages' && <MessagesTab profile={profile} />}
            {activeTab === 'support' && <SupportTab profile={profile} />}
            {activeTab === 'profile' && <ProfileTab profile={profile} onLogout={_onLogout} />}
            {activeTab === 'settings' && <SettingsTab profile={profile} onUpdate={() => {}} />}
          </>
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-[9px] text-[#5C5E72] mt-0.5">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ stats, profile, onSetTab, onGoToChat, inspections }: {
  stats: any; profile: Profile; onSetTab: (t: PartnerTab) => void; onGoToChat?: (_c?: string) => void; inspections: any[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#5C5E72]">Welcome, <span className="text-white font-medium">{profile.full_name || profile.username || 'Partner'}</span>. Here&apos;s your portfolio.</p>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <QuickCard icon="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" title="My Properties" subtitle={`${stats.totalProperties} approved`} color="from-violet-500 to-violet-700" onClick={() => onSetTab('properties')} />
        <QuickCard icon="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" title="Bookings" subtitle={`${stats.totalBookings} total`} color="from-blue-500 to-blue-700" onClick={() => onSetTab('bookings')} />
        <QuickCard icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" title="Request Inspection" subtitle="For new properties" color="from-amber-500 to-amber-700" onClick={() => onSetTab('inspections')} />
        <QuickCard icon="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" title="Chat Support" subtitle="Message WeHouse" color="from-emerald-500 to-emerald-700" onClick={() => onGoToChat ? onGoToChat() : onSetTab('messages')} />
      </div>

      {/* Pending Inspections Alert */}
      {inspections.filter((i: any) => i.status === 'pending').length > 0 && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Inspection Pending</p>
            <p className="text-[10px] text-[#5C5E72]">Your property inspection request is being processed.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickCard({ icon, title, subtitle, color, onClick }: { icon: string; title: string; subtitle: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 text-left hover:border-white/[0.12] transition-all active:scale-[0.98]">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-3 shadow-lg`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </div>
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="text-[10px] text-[#5C5E72] mt-0.5">{subtitle}</p>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROPERTIES TAB — VIEW ONLY (WeHouse creates listings)
// ═══════════════════════════════════════════════════════════════

function PropertiesTab({ properties }: { properties: any[] }) {
  const [stateFilter, setStateFilter] = useState('all');

  const uniqueStates = Array.from(new Set(properties.map(p => p.state).filter(Boolean))).sort();
  const filtered = stateFilter === 'all' ? properties : properties.filter(p => p.state === stateFilter);

  if (properties.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        </div>
        <p className="text-sm font-semibold text-white mb-1">No Properties Yet</p>
        <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">Request a property inspection. Once WeHouse inspects and approves your property, it will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white">{filtered.length} Property{filtered.length !== 1 ? 'ies' : 'y'}</p>
        {/* State filter dropdown */}
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
          className="h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-[10px] px-2 outline-none focus:border-[#3B82F6]">
          <option value="all">All States</option>
          {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {filtered.map(p => (
        <div key={p.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
          {p.images?.[0] && (
            <div className="h-32 bg-[#1A1A24] relative">
              <img src={p.images[0]} alt="" className="w-full h-full object-cover" />
              <div className="absolute top-2 right-2">
                <span className="text-[9px] px-2 py-1 rounded-full bg-emerald-500/90 text-white font-medium">{p.sub_type === 'short_let' ? 'Short Let' : 'Long Stay'}</span>
              </div>
            </div>
          )}
          <div className="p-4">
            <p className="text-sm font-semibold text-white">{p.title}</p>
            <p className="text-[10px] text-[#5C5E72]">{p.city}, {p.state} &middot; {p.bedrooms} bed &middot; {p.bathrooms} bath</p>
            <div className="flex items-center justify-between mt-2">
              <p className="text-sm font-bold text-white">N{p.price?.toLocaleString()}<span className="text-[10px] text-[#5C5E72] font-normal">/{p.sub_type === 'short_let' ? 'day' : 'year'}</span></p>
              {p.security_deposit && (
                <p className="text-[10px] text-amber-400">Deposit: N{p.security_deposit?.toLocaleString()}</p>
              )}
            </div>
            {p.sub_type === 'short_let' && (
              <div className="mt-2 pt-2 border-t border-white/[0.04] flex gap-3">
                {p.weekly_price && <span className="text-[10px] text-[#5C5E72]">Weekly: N{p.weekly_price?.toLocaleString()}</span>}
                {p.monthly_price && <span className="text-[10px] text-[#5C5E72]">Monthly: N{p.monthly_price?.toLocaleString()}</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BOOKINGS TAB
// ═══════════════════════════════════════════════════════════════

function BookingsTab({ bookings, properties }: { bookings: any[]; properties: any[] }) {
  if (bookings.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
        </div>
        <p className="text-sm text-[#5C5E72]">No bookings yet</p>
        <p className="text-[10px] text-[#5C5E72] mt-1">Bookings will appear when customers reserve your properties.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-white">{bookings.length} Booking{bookings.length !== 1 ? 's' : ''}</p>
      {bookings.map(b => {
        const prop = properties.find((p: any) => p.listing_id === b.listing_id);
        return (
          <div key={b.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white truncate">{prop?.title || 'Property'}</p>
              <span className={`text-[8px] px-2 py-1 rounded-full ${b.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-400' : b.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>{b.status}</span>
            </div>
            <p className="text-[10px] text-[#5C5E72] mt-1">{b.check_in} to {b.check_out}</p>
            <p className="text-xs text-white font-bold mt-2">N{b.amount?.toLocaleString()}</p>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OCCUPANCY TAB
// ═══════════════════════════════════════════════════════════════

function OccupancyTab({ properties, bookings }: { properties: any[]; bookings: any[] }) {
  if (properties.length === 0) return <EmptyState icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" title="No properties to track" />;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-white">Occupancy Overview</p>
      {properties.map(p => {
        const propBookings = bookings.filter((b: any) => b.listing_id === p.listing_id && b.status === 'confirmed');
        const isOccupied = propBookings.length > 0;
        return (
          <div key={p.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">{p.title}</p>
              <span className={`text-[8px] px-2 py-1 rounded-full ${isOccupied ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-500/10 text-gray-400'}`}>{isOccupied ? 'Occupied' : 'Vacant'}</span>
            </div>
            <p className="text-[10px] text-[#5C5E72]">{p.city}, {p.state}</p>
            {isOccupied && (
              <p className="text-[10px] text-[#5C5E72] mt-1">{propBookings.length} active booking{propBookings.length !== 1 ? 's' : ''}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EARNINGS TAB
// ═══════════════════════════════════════════════════════════════

function EarningsTab({ bookings }: { bookings: any[] }) {
  const confirmedBookings = bookings.filter((b: any) => b.status === 'confirmed');
  const totalRevenue = confirmedBookings.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
  // Commission per Constitution: by LISTING TYPE, not partner
  // Apartment → Apartment Commission, Hotel → Hotel Commission
  const [commissionRate, setCommissionRate] = useState(10);
  useEffect(() => {
    (async () => {
      try {
        // Use apartment_commission for apartment listings, hotel_commission for hotel listings
        const { data } = await supabase.rpc('get_setting_v2', { p_key: 'commission_apartment' });
        const rate = data ? parseFloat(data) : 0;
        if (rate > 0 && rate < 100) setCommissionRate(rate);
      } catch (_) { /* use default */ }
    })();
  }, []);
  const wehouseCommission = Math.round(totalRevenue * (commissionRate / 100));
  const netEarnings = totalRevenue - wehouseCommission;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <p className="text-[10px] text-[#5C5E72]">Total Revenue</p>
          <p className="text-lg font-bold text-white">N{totalRevenue.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
          <p className="text-[10px] text-[#5C5E72]">Net Earnings</p>
          <p className="text-lg font-bold text-emerald-400">N{netEarnings.toLocaleString()}</p>
        </div>
      </div>

      {/* Commission Breakdown */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
        <p className="text-xs font-semibold text-white">Commission Breakdown</p>
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">Gross Revenue</span><span className="text-white">N{totalRevenue.toLocaleString()}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">WeHouse Commission ({commissionRate}%)</span><span className="text-amber-400">-N{wehouseCommission.toLocaleString()}</span></div>
        <div className="border-t border-white/[0.04] pt-2 flex justify-between text-xs"><span className="text-white font-semibold">Your Earnings</span><span className="text-emerald-400 font-bold">N{netEarnings.toLocaleString()}</span></div>
      </div>

      {/* Payment Flow */}
      <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3">
        <p className="text-[10px] text-blue-400 leading-relaxed">
          <strong>How payments work:</strong> Customer pays WeHouse &rarr; Held in escrow &rarr; Stay completes &rarr; {commissionRate}% commission deducted &rarr; Balance enters your wallet &rarr; Automatic withdrawal to your bank account.
        </p>
      </div>

      {/* Transaction History */}
      <p className="text-xs font-semibold text-white">Recent Transactions</p>
      {confirmedBookings.length === 0 ? (
        <p className="text-[11px] text-[#5C5E72] text-center py-4">No confirmed bookings yet</p>
      ) : (
        confirmedBookings.slice(0, 10).map(b => (
          <div key={b.id} className="flex items-center justify-between py-2 border-b border-white/[0.04]">
            <div>
              <p className="text-xs text-white">Booking #{b.id?.slice(0, 8)}</p>
              <p className="text-[9px] text-[#5C5E72]">{b.check_in} &rarr; {b.check_out}</p>
            </div>
            <p className="text-xs text-emerald-400">+N{(b.amount * (1 - commissionRate / 100))?.toLocaleString()}</p>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INSPECTIONS TAB — Partner requests inspection + auto-creates support conversation
// ═══════════════════════════════════════════════════════════════

function InspectionsTab({ inspections, profile, onConversationCreated }: { inspections: any[]; profile: Profile; onConversationCreated?: () => void }) {
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [requestForm, setRequestForm] = useState({
    property_name: '',
    property_address: '',
    property_city: '',
    property_state: '',
    property_type: 'house',
    bedrooms: '',
    bathrooms: '',
    expected_rent: '',
    description: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);

  async function submitRequest() {
    if (!requestForm.property_address || !requestForm.property_city) {
      toast.error('Address and city are required'); return;
    }
    setSubmitting(true);

    try {
      // 1. Create inspection request
      const { error: inspectionError } = await supabase.from('inspection_requests').insert({
        owner_id: profile.user_id,
        owner_email: profile.email,
        owner_phone: profile.phone,
        property_address: requestForm.property_address,
        property_city: requestForm.property_city,
        property_state: requestForm.property_state,
        property_name: requestForm.property_name || requestForm.property_address,
        property_type: requestForm.property_type,
        bedrooms: requestForm.bedrooms ? parseInt(requestForm.bedrooms) : null,
        bathrooms: requestForm.bathrooms ? parseInt(requestForm.bathrooms) : null,
        expected_rent: requestForm.expected_rent ? parseFloat(requestForm.expected_rent) : null,
        description: requestForm.description,
        notes: requestForm.notes,
        status: 'pending',
        request_code: 'WHIR-' + Math.floor(10000 + Math.random() * 90000),
        created_at: new Date().toISOString(),
      }).select().single();

      if (inspectionError) {
        toast.error('Failed: ' + inspectionError.message);
        setSubmitting(false);
        return;
      }

      // 2. Auto-create partner support conversation
      const { error: convError } = await createPartnerSupportConversation(
        profile.user_id,
        `Inspection Request: ${requestForm.property_name || requestForm.property_address}`,
        requestForm.property_name || requestForm.property_address,
        requestForm.property_address,
        requestForm.property_city,
        requestForm.property_state,
        requestForm.property_type,
        'long_stay'
      );

      if (convError) {
        console.warn('Support conversation creation failed:', convError);
      }

      toast.success('Inspection request submitted. WeHouse will contact you shortly.');
      setShowRequestForm(false);
      setRequestForm({
        property_name: '', property_address: '', property_city: '', property_state: '',
        property_type: 'house', bedrooms: '', bathrooms: '', expected_rent: '', description: '', notes: ''
      });
      onConversationCreated?.();
    } catch (e: any) {
      toast.error('Error: ' + e.message);
    }

    setSubmitting(false);
  }

  const statusConfig: Record<string, { color: string; label: string; icon: string }> = {
    pending: { color: 'bg-amber-500/10 text-amber-400', label: 'Pending', icon: 'M12 8v4l3 3' },
    scheduled: { color: 'bg-blue-500/10 text-blue-400', label: 'Scheduled', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    in_progress: { color: 'bg-violet-500/10 text-violet-400', label: 'In Progress', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    completed: { color: 'bg-emerald-500/10 text-emerald-400', label: 'Completed', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    approved: { color: 'bg-emerald-500/10 text-emerald-400', label: 'Approved', icon: 'M5 13l4 4L19 7' },
    rejected: { color: 'bg-red-500/10 text-red-400', label: 'Rejected', icon: 'M6 18L18 6M6 6l12 12' },
  };

  return (
    <div className="space-y-4">
      {/* Request New Inspection */}
      {!showRequestForm ? (
        <button onClick={() => setShowRequestForm(true)} className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Request Property Inspection
        </button>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Request New Inspection</p>
            <button onClick={() => setShowRequestForm(false)} className="text-[#5C5E72] hover:text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="text-[10px] text-[#5C5E72]">Fill in your property details. WeHouse will inspect and approve it before listing.</p>

          <div className="space-y-3">
            <input value={requestForm.property_name} onChange={e => setRequestForm(f => ({ ...f, property_name: e.target.value }))}
              placeholder="Property name (e.g. Sunset Apartments)" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            <input value={requestForm.property_address} onChange={e => setRequestForm(f => ({ ...f, property_address: e.target.value }))}
              placeholder="Full property address *" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            <div className="grid grid-cols-2 gap-2">
              <input value={requestForm.property_city} onChange={e => setRequestForm(f => ({ ...f, property_city: e.target.value }))}
                placeholder="City *" className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
              <input value={requestForm.property_state} onChange={e => setRequestForm(f => ({ ...f, property_state: e.target.value }))}
                placeholder="State" className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={requestForm.property_type} onChange={e => setRequestForm(f => ({ ...f, property_type: e.target.value }))}
                className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-2 outline-none focus:border-violet-500">
                <option value="house">House</option>
                <option value="apartment">Apartment</option>
                <option value="self_contain">Self Contain</option>
                <option value="mini_flat">Mini Flat</option>
                <option value="duplex">Duplex</option>
                <option value="bungalow">Bungalow</option>
                <option value="mansion">Mansion</option>
              </select>
              <input type="number" value={requestForm.bedrooms} onChange={e => setRequestForm(f => ({ ...f, bedrooms: e.target.value }))}
                placeholder="Beds" className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
              <input type="number" value={requestForm.bathrooms} onChange={e => setRequestForm(f => ({ ...f, bathrooms: e.target.value }))}
                placeholder="Baths" className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            </div>
            <input type="number" value={requestForm.expected_rent} onChange={e => setRequestForm(f => ({ ...f, expected_rent: e.target.value }))}
              placeholder="Expected rent (N/year)" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            <textarea value={requestForm.description} onChange={e => setRequestForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Property description (e.g. fenced compound, parking space, water supply)" rows={2}
              className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 outline-none focus:border-violet-500 resize-none" />
            <textarea value={requestForm.notes} onChange={e => setRequestForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional notes for the inspector (optional)" rows={2}
              className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 outline-none focus:border-violet-500 resize-none" />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setShowRequestForm(false)} className="flex-1 h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium">Cancel</button>
            <button onClick={submitRequest} disabled={submitting} className="flex-1 h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">{submitting ? 'Submitting...' : 'Submit Request'}</button>
          </div>
        </div>
      )}

      {/* Inspection History — FULL DETAILS */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white">Inspection History</p>
        <span className="text-[10px] text-[#5C5E72]">{inspections.length} request{inspections.length !== 1 ? 's' : ''}</span>
      </div>

      {inspections.length === 0 ? (
        <div className="text-center py-10">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <p className="text-sm font-semibold text-white mb-1">No Inspections Yet</p>
          <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">Request a property inspection above. WeHouse will visit, verify, and list your property.</p>
        </div>
      ) : (
        inspections.map(ins => {
          const cfg = statusConfig[ins.status] || statusConfig.pending;
          const isExpanded = expandedId === ins.id;
          return (
            <div key={ins.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
              {/* Header — Always visible */}
              <button onClick={() => setExpandedId(isExpanded ? null : ins.id)} className="w-full p-4 text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{ins.property_name || ins.property_address}</p>
                    <p className="text-[10px] text-[#5C5E72] mt-0.5">{ins.property_address}</p>
                    <p className="text-[9px] text-[#5C5E72]">{ins.property_city}{ins.property_state ? `, ${ins.property_state}` : ''}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[8px] px-2 py-1 rounded-full ${cfg.color} font-medium`}>{cfg.label}</span>
                    <span className="text-[8px] text-[#5C5E72]">{ins.request_code}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[9px] text-[#5C5E72]">Requested {new Date(ins.created_at).toLocaleDateString()}</p>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
                </div>
              </button>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-white/[0.04] pt-3 space-y-3">
                  {/* Property Details Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {ins.property_type && (
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <p className="text-[9px] text-[#5C5E72]">Property Type</p>
                        <p className="text-[11px] text-white capitalize">{ins.property_type.replace(/_/g, ' ')}</p>
                      </div>
                    )}
                    {(ins.bedrooms || ins.bathrooms) && (
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <p className="text-[9px] text-[#5C5E72]">Rooms</p>
                        <p className="text-[11px] text-white">{ins.bedrooms || '-'} bed &middot; {ins.bathrooms || '-'} bath</p>
                      </div>
                    )}
                    {ins.expected_rent && (
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <p className="text-[9px] text-[#5C5E72]">Expected Rent</p>
                        <p className="text-[11px] text-white">N{Number(ins.expected_rent).toLocaleString()}/year</p>
                      </div>
                    )}
                    {ins.scheduled_date && (
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <p className="text-[9px] text-[#5C5E72]">Scheduled Date</p>
                        <p className="text-[11px] text-white">{new Date(ins.scheduled_date).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>

                  {/* Assigned Field Officer */}
                  {ins.assigned_to && (
                    <div className="rounded-lg bg-violet-500/5 border border-violet-500/10 p-3">
                      <p className="text-[9px] text-violet-400 font-medium mb-1">Assigned Field Officer</p>
                      <p className="text-[11px] text-white">{ins.assigned_officer_name || ins.assigned_to}</p>
                    </div>
                  )}

                  {/* Description */}
                  {ins.description && (
                    <div>
                      <p className="text-[9px] text-[#5C5E72] mb-1">Description</p>
                      <p className="text-[11px] text-white leading-relaxed">{ins.description}</p>
                    </div>
                  )}

                  {/* Notes */}
                  {ins.notes && (
                    <div>
                      <p className="text-[9px] text-[#5C5E72] mb-1">Inspector Notes</p>
                      <p className="text-[11px] text-white/80 leading-relaxed">{ins.notes}</p>
                    </div>
                  )}

                  {/* Rejection Reason */}
                  {ins.rejection_reason && (
                    <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3">
                      <p className="text-[9px] text-red-400 font-medium mb-1">Rejection Reason</p>
                      <p className="text-[11px] text-red-300">{ins.rejection_reason}</p>
                    </div>
                  )}

                  {/* Photo URLs */}
                  {ins.photo_urls && ins.photo_urls.length > 0 && (
                    <div>
                      <p className="text-[9px] text-[#5C5E72] mb-2">Inspection Photos ({ins.photo_urls.length})</p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {ins.photo_urls.map((url: string, i: number) => (
                          <img key={i} src={url} alt={`Inspection ${i + 1}`} className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="space-y-2 pt-1">
                    <p className="text-[9px] text-[#5C5E72] font-medium">Timeline</p>
                    <div className="space-y-1.5">
                      <TimelineItem label="Request submitted" date={ins.created_at} color="emerald" />
                      {ins.scheduled_date && <TimelineItem label="Inspection scheduled" date={ins.scheduled_date} color="blue" />}
                      {ins.completed_at && <TimelineItem label="Inspection completed" date={ins.completed_at} color="violet" />}
                      {ins.updated_at !== ins.created_at && <TimelineItem label="Last updated" date={ins.updated_at} color="amber" />}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// Timeline item for inspection detail view
function TimelineItem({ label, date, color }: { label: string; date: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    violet: 'bg-violet-500',
    amber: 'bg-amber-500',
  };
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full ${colorMap[color] || 'bg-[#5C5E72]'} flex-shrink-0`} />
      <p className="text-[10px] text-[#5C5E72]">{label}</p>
      <p className="text-[9px] text-[#5C5E72] ml-auto">{new Date(date).toLocaleDateString()}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHAT SUPPORT TAB — Partner Support Conversations
// ═══════════════════════════════════════════════════════════════

function MessagesTab({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChat, setActiveChat] = useState<string | null>(null);

  useEffect(() => { loadConversations(); }, [profile.user_id]);

  async function loadConversations() {
    setLoading(true);
    const { conversations: convs } = await getPartnerConversations(profile.user_id);
    setConversations(convs || []);
    setLoading(false);
  }

  // Open chat view
  if (activeChat) {
    return (
      <PartnerSupportChat
        conversationId={activeChat}
        profile={profile}
        senderRole="partner"
        onClose={() => { setActiveChat(null); loadConversations(); }}
      />
    );
  }

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-sm font-semibold text-white">Support Conversations</p>
        <p className="text-[10px] text-[#5C5E72] mt-0.5">Track your property inspections and communicate with WeHouse staff. New conversations are created automatically when you submit an inspection request.</p>
      </div>

      {/* Conversations List */}
      {conversations.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-700/20 flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          </div>
          <p className="text-sm font-semibold text-white">No Support Conversations</p>
          <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">Request a property inspection to start a support conversation with WeHouse.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map(conv => {
            const statusColors: Record<string, string> = {
              open: 'bg-amber-500/10 text-amber-400',
              assigned: 'bg-blue-500/10 text-blue-400',
              in_progress: 'bg-violet-500/10 text-violet-400',
              resolved: 'bg-emerald-500/10 text-emerald-400',
              closed: 'bg-gray-500/10 text-gray-400',
            };
            return (
              <button
                key={conv.conversation_id}
                onClick={() => setActiveChat(conv.conversation_id)}
                className="w-full text-left rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 hover:border-violet-500/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold text-white truncate">{conv.subject}</p>
                  <div className="flex items-center gap-2">
                    {conv.unread_count > 0 && (
                      <span className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-[9px] text-white font-bold">{conv.unread_count}</span>
                    )}
                    <span className={`text-[8px] px-2 py-0.5 rounded-full ${statusColors[conv.status] || ''}`}>{conv.status}</span>
                  </div>
                </div>
                <p className="text-[10px] text-[#5C5E72]">{conv.property_address}</p>
                {conv.last_message && (
                  <p className="text-[10px] text-[#8A8B9C] mt-1.5 truncate">{conv.last_message}</p>
                )}
                {conv.assigned_staff_name && (
                  <p className="text-[9px] text-violet-400 mt-1">Assigned: {conv.assigned_staff_name}</p>
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

function WalletTab({ profile }: { profile: Profile }) {
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    // Wallet balances
    const { data: w } = await supabase.from('wallets').select('*').eq('user_id', profile.user_id).maybeSingle();
    setWallet(w);
    // Transaction history
    const { data: tx } = await supabase.from('wallet_transactions').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(20);
    setTransactions(tx || []);
    // Withdrawal history
    const { data: wd } = await supabase.from('withdrawal_requests').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false }).limit(20);
    setWithdrawals(wd || []);
    setLoading(false);
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  // Per Constitution Part 5: Wallet contains Available Balance, Pending Balance, Total Earnings
  const availableBalance = wallet?.balance || 0;
  const pendingBalance = wallet?.pending_balance || 0;
  const totalEarnings = wallet?.total_earnings || 0;

  return (
    <div className="space-y-4">
      {/* Balance Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 p-4">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Available</p>
          <p className="text-xl font-bold text-white mt-1">₦{availableBalance.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72] mt-0.5">Can withdraw</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-4">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending</p>
          <p className="text-xl font-bold text-white mt-1">₦{pendingBalance.toLocaleString()}</p>
          <p className="text-[9px] text-[#5C5E72] mt-0.5">Processing</p>
        </div>
      </div>
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-4">
        <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Total Earnings</p>
        <p className="text-2xl font-bold text-white mt-1">₦{totalEarnings.toLocaleString()}</p>
      </div>

      {/* Transaction History */}
      <div>
        <h4 className="text-xs font-semibold text-white mb-2">Transaction History</h4>
        {transactions.length === 0 ? (
          <p className="text-[10px] text-[#5C5E72] py-4 text-center">No transactions yet</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx: any) => (
              <div key={tx.id} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-white capitalize">{tx.type?.replace(/_/g, ' ')}</p>
                  <p className="text-[9px] text-[#5C5E72]">{new Date(tx.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs font-bold ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tx.amount > 0 ? '+' : ''}₦{Math.abs(tx.amount).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawal History */}
      {withdrawals.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white mb-2">Withdrawal History</h4>
          <div className="space-y-2">
            {withdrawals.map((wd: any) => (
              <div key={wd.id} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-white">Withdrawal</p>
                  <p className="text-[9px] text-[#5C5E72]">{wd.bank_name} • {new Date(wd.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-red-400">-₦{wd.amount.toLocaleString()}</span>
                  <p className={`text-[9px] capitalize ${wd.status === 'completed' ? 'text-emerald-400' : wd.status === 'processing' ? 'text-amber-400' : 'text-[#5C5E72]'}`}>{wd.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WITHDRAW TAB
// ═══════════════════════════════════════════════════════════════

function WithdrawTab({ profile }: { profile: Profile }) {
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [wallet, setWallet] = useState<any>(null);

  useEffect(() => {
    supabase.from('wallets').select('*').eq('user_id', profile.user_id).maybeSingle().then(({ data }) => setWallet(data));
  }, [profile.user_id]);

  async function handleWithdraw() {
    const amt = parseFloat(amount);
    if (!amt || amt < 1000) { toast.error('Minimum withdrawal is ₦1,000'); return; }
    if (!bankName || !accountNumber || !accountName) { toast.error('Please fill all bank details'); return; }

    // CRITICAL: Verify available balance per Constitution Part 5
    if (amt > available) { toast.error(`Insufficient balance. Available: ₦${available.toLocaleString()}`); return; }

    setProcessing(true);

    // 1. Deduct from wallet immediately
    const { error: walletErr } = await supabase.rpc('deduct_wallet_balance', {
      p_user_id: profile.user_id,
      p_amount: amt,
    });

    if (walletErr) {
      toast.error('Failed to process withdrawal: ' + walletErr.message);
      setProcessing(false);
      return;
    }

    // 2. Record withdrawal request
    await supabase.from('withdrawal_requests').insert({
      user_id: profile.user_id,
      amount: amt,
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
      status: 'processing', // processing → paystack will handle transfer
    });

    // 3. Record transaction
    await supabase.from('transactions').insert({
      user_id: profile.user_id,
      type: 'withdrawal',
      amount: amt,
      status: 'completed',
      description: `Wallet withdrawal to ${bankName} (${accountNumber})`,
    });

    // 4. Refresh wallet
    const { data: updatedWallet } = await supabase.from('wallets').select('*').eq('user_id', profile.user_id).maybeSingle();
    setWallet(updatedWallet);

    toast.success(`₦${amt.toLocaleString()} withdrawal processed`);
    setAmount('');
    setProcessing(false);
  }

  const available = wallet?.balance || 0;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 p-4">
        <p className="text-[10px] text-[#5C5E72]">Available Balance</p>
        <p className="text-2xl font-bold text-white mt-1">₦{available.toLocaleString()}</p>
      </div>
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
        <h4 className="text-xs font-semibold text-white">Withdraw Funds</h4>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (₦)" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-xs px-3 outline-none focus:border-violet-500" />
        <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank Name" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-xs px-3 outline-none focus:border-violet-500" />
        <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account Number" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-xs px-3 outline-none focus:border-violet-500" />
        <input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Account Name" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-xs px-3 outline-none focus:border-violet-500" />
        <button onClick={handleWithdraw} disabled={processing} className="w-full h-10 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-50 transition-colors">
          {processing ? 'Processing...' : 'Request Withdrawal'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONTRACTS TAB
// ═══════════════════════════════════════════════════════════════

function ContractsTab({ profile }: { profile: Profile }) {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('partner_contracts').select('*').eq('partner_id', profile.user_id).order('created_at', { ascending: false });
    setContracts(data || []);
    setLoading(false);
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Contracts</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">Your property management agreements.</p>
      </div>
      {contracts.length === 0 ? (
        <EmptyState icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" title="No contracts yet" />
      ) : (
        <div className="space-y-2">
          {contracts.map((c: any) => (
            <div key={c.id} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-3">
              <p className="text-xs font-semibold text-white">{c.title || 'Contract'}</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">{c.description}</p>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-2 inline-block ${
                c.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                c.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT TAB
// ═══════════════════════════════════════════════════════════════

function SupportTab({ profile }: { profile: Profile }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('support_tickets').select('*').eq('user_id', profile.user_id).order('created_at', { ascending: false });
    setTickets(data || []);
    setLoading(false);
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-4">
        <h3 className="text-sm font-semibold text-white">Support</h3>
        <p className="text-[10px] text-[#5C5E72] mt-1">Get help with your properties and account.</p>
      </div>
      {tickets.length === 0 ? (
        <EmptyState icon="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 9v4m0 4h.01" title="No support tickets" />
      ) : (
        <div className="space-y-2">
          {tickets.map((t: any) => (
            <div key={t.id} className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-3">
              <p className="text-xs font-semibold text-white">{t.subject}</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">{t.message}</p>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-2 inline-block ${
                t.status === 'open' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                t.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                'bg-[#1A1A24] text-[#5C5E72] border border-[#232330]'
              }`}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════

function ProfileTab({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 border border-violet-500/20 p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-bold text-lg">{(profile.username || profile.email || 'P')[0].toUpperCase()}</span>
        </div>
        <h3 className="text-base font-bold text-white">@{profile.username || 'Unknown'}</h3>
        <p className="text-[11px] text-[#5C5E72] mt-1">{profile.email}</p>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 mt-2 inline-block">Property Partner</span>
      </div>

      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
        <InfoRow label="Full Name" value={profile.full_name || 'Not set'} />
        <InfoRow label="Phone" value={profile.phone || 'Not set'} />
        <InfoRow label="Location" value={profile.city || profile.state || 'Not set'} />
        <InfoRow label="Joined" value={profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'} />
      </div>

      <button
        onClick={onLogout}
        className="w-full h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors"
      >
        Logout
      </button>
    </div>
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

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </div>
      <p className="text-sm text-[#5C5E72]">{title}</p>
    </div>
  );
}
