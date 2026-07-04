import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import SettingsTab from './SettingsTab';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (c?: string) => void;
}

type PartnerTab = 'overview' | 'properties' | 'bookings' | 'occupancy' | 'earnings' | 'inspections' | 'chat' | 'settings';

const TAB_CONFIG: { key: PartnerTab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { key: 'properties', label: 'My Properties', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z' },
  { key: 'bookings', label: 'Bookings', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { key: 'occupancy', label: 'Occupancy', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { key: 'earnings', label: 'Earnings', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'inspections', label: 'Inspections', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { key: 'chat', label: 'Support', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
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
      .eq('status', 'available')
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
    const propertyIds = (props || []).map((p: any) => p.listing_id).filter(Boolean);
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
            {activeTab === 'overview' && <OverviewTab stats={stats} profile={profile} onSetTab={setActiveTab} onGoToChat={onGoToChat} inspections={inspections} />}
            {activeTab === 'properties' && <PropertiesTab properties={properties} />}
            {activeTab === 'bookings' && <BookingsTab bookings={bookings} properties={properties} />}
            {activeTab === 'occupancy' && <OccupancyTab properties={properties} bookings={bookings} />}
            {activeTab === 'earnings' && <EarningsTab bookings={bookings} />}
            {activeTab === 'inspections' && <InspectionsTab inspections={inspections} profile={profile} onGoToChat={onGoToChat} />}
            {activeTab === 'chat' && <ChatTab profile={profile} onGoToChat={onGoToChat} />}
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
        <QuickCard icon="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" title="Chat Support" subtitle="Message WeHouse" color="from-emerald-500 to-emerald-700" onClick={() => onGoToChat ? onGoToChat() : onSetTab('chat')} />
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
      <p className="text-xs font-semibold text-white">{properties.length} Property{properties.length !== 1 ? 'ies' : 'y'}</p>
      {properties.map(p => (
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
  const wehouseCommission = Math.round(totalRevenue * 0.1); // 10% commission
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
        <div className="flex justify-between text-xs"><span className="text-[#5C5E72]">WeHouse Commission (10%)</span><span className="text-amber-400">-N{wehouseCommission.toLocaleString()}</span></div>
        <div className="border-t border-white/[0.04] pt-2 flex justify-between text-xs"><span className="text-white font-semibold">Your Earnings</span><span className="text-emerald-400 font-bold">N{netEarnings.toLocaleString()}</span></div>
      </div>

      {/* Payment Flow */}
      <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3">
        <p className="text-[10px] text-blue-400 leading-relaxed">
          <strong>How payments work:</strong> Customer pays WeHouse &rarr; Held in escrow &rarr; Stay completes &rarr; 10% commission deducted &rarr; Balance enters your wallet &rarr; Automatic withdrawal to your bank account.
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
            <p className="text-xs text-emerald-400">+N{(b.amount * 0.9)?.toLocaleString()}</p>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INSPECTIONS TAB — Partner requests inspection (cannot create listings)
// ═══════════════════════════════════════════════════════════════

function InspectionsTab({ inspections, profile, onGoToChat: _onGoToChat }: { inspections: any[]; profile: Profile; onGoToChat?: (c?: string) => void }) {
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ property_address: '', property_city: '', property_state: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  async function submitRequest() {
    if (!requestForm.property_address || !requestForm.property_city) {
      toast.error('Address and city are required'); return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('inspection_requests').insert({
      owner_id: profile.user_id,
      owner_name: profile.full_name || profile.username,
      owner_email: profile.email,
      owner_phone: profile.phone,
      property_address: requestForm.property_address,
      property_city: requestForm.property_city,
      property_state: requestForm.property_state,
      notes: requestForm.notes,
      status: 'pending',
      request_code: 'INS' + Date.now().toString(36).toUpperCase(),
      created_at: new Date().toISOString(),
    });
    setSubmitting(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Inspection request submitted');
    setShowRequestForm(false);
    setRequestForm({ property_address: '', property_city: '', property_state: '', notes: '' });
  }

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
          <p className="text-sm font-semibold text-white">Request New Inspection</p>
          <p className="text-[10px] text-[#5C5E72]">WeHouse will inspect your property before listing it publicly.</p>
          <input value={requestForm.property_address} onChange={e => setRequestForm(f => ({ ...f, property_address: e.target.value }))}
            placeholder="Property address" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
          <div className="grid grid-cols-2 gap-2">
            <input value={requestForm.property_city} onChange={e => setRequestForm(f => ({ ...f, property_city: e.target.value }))}
              placeholder="City" className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
            <input value={requestForm.property_state} onChange={e => setRequestForm(f => ({ ...f, property_state: e.target.value }))}
              placeholder="State" className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 outline-none focus:border-violet-500" />
          </div>
          <textarea value={requestForm.notes} onChange={e => setRequestForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Additional notes (optional)" rows={2}
            className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 outline-none focus:border-violet-500 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => setShowRequestForm(false)} className="flex-1 h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs">Cancel</button>
            <button onClick={submitRequest} disabled={submitting} className="flex-1 h-10 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-xs font-semibold disabled:opacity-40">{submitting ? 'Submitting...' : 'Submit Request'}</button>
          </div>
        </div>
      )}

      {/* Inspection History */}
      <p className="text-xs font-semibold text-white">Inspection History ({inspections.length})</p>
      {inspections.length === 0 ? (
        <p className="text-[11px] text-[#5C5E72] text-center py-4">No inspection requests yet</p>
      ) : (
        inspections.map(ins => (
          <div key={ins.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white truncate">{ins.property_address}</p>
              <span className={`text-[8px] px-2 py-1 rounded-full ${ins.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : ins.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' : ins.status === 'scheduled' ? 'bg-amber-500/10 text-amber-400' : 'bg-gray-500/10 text-gray-400'}`}>{ins.status}</span>
            </div>
            <p className="text-[10px] text-[#5C5E72]">{ins.property_city}{ins.property_state ? `, ${ins.property_state}` : ''}</p>
            <p className="text-[9px] text-[#5C5E72] mt-1">Code: {ins.request_code}</p>
            {ins.status === 'completed' && (
              <p className="text-[10px] text-emerald-400 mt-2">Inspection complete. WeHouse will create the listing.</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHAT SUPPORT TAB
// ═══════════════════════════════════════════════════════════════

function ChatTab({ profile: _profile, onGoToChat }: { profile: Profile; onGoToChat?: (c?: string) => void }) {
  return (
    <div className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
      </div>
      <p className="text-sm font-semibold text-white">Chat with WeHouse Support</p>
      <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">Have questions about your properties, bookings, or payouts? Message our support team.</p>
      <button onClick={() => onGoToChat?.()} className="h-11 px-8 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-700 text-white font-semibold hover:opacity-90 transition-opacity">
        Open Chat
      </button>
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
