import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

interface FinanceDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

interface RevenueStats {
  totalReservations: number;
  totalReservationValue: number;
  totalHotels: number;
  totalHotelBookings: number;
  totalHotelRevenue: number;
  verifiedWorkers: number;
  pendingWorkers: number;
  totalUsers: number;
}

export default function FinanceDashboard({ profile }: FinanceDashboardProps) {
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'reservations' | 'hotels' | 'workers'>('overview');

  useEffect(() => {
    async function loadStats() {
      const [
        { count: resCount },
        { data: resData },
        { count: hotelCount },
        { count: bookingCount },
        { data: bookingData },
        { count: verifiedWorkers },
        { count: pendingWorkers },
        { count: totalUsers },
      ] = await Promise.all([
        supabase.from('reservations').select('*', { count: 'exact', head: true }),
        supabase.from('reservations').select('amount'),
        supabase.from('hotels').select('*', { count: 'exact', head: true }),
        supabase.from('hotel_bookings').select('*', { count: 'exact', head: true }),
        supabase.from('hotel_bookings').select('total_price'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'verified'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
      ]);

      const totalResValue = (resData || []).reduce((sum, r) => sum + (r.amount || 0), 0);
      const totalHotelRev = (bookingData || []).reduce((sum, b) => sum + (b.total_price || 0), 0);

      setStats({
        totalReservations: resCount || 0,
        totalReservationValue: totalResValue,
        totalHotels: hotelCount || 0,
        totalHotelBookings: bookingCount || 0,
        totalHotelRevenue: totalHotelRev,
        verifiedWorkers: verifiedWorkers || 0,
        pendingWorkers: pendingWorkers || 0,
        totalUsers: totalUsers || 0,
      });
      setLoading(false);
    }
    loadStats();
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <h1 className="text-lg font-bold text-white">Finance</h1>
        <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.04]">
        {(['overview', 'reservations', 'hotels', 'workers'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 h-9 rounded-xl text-[11px] font-semibold transition-all ${
              activeTab === tab ? 'bg-emerald-500 text-white' : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <main className="px-5 py-4 space-y-4">
        {loading || !stats ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'overview' && <FinanceOverview stats={stats} />}
            {activeTab === 'reservations' && <ReservationFinanceTab />}
            {activeTab === 'hotels' && <HotelFinanceTab />}
            {activeTab === 'workers' && <WorkerFinanceTab />}
          </>
        )}
      </main>
    </div>
  );
}

// ─── FINANCE OVERVIEW ──────────────────────────────
function FinanceOverview({ stats }: { stats: RevenueStats }) {
  const totalRevenue = stats.totalReservationValue + stats.totalHotelRevenue;

  return (
    <div className="space-y-4">
      {/* Total Revenue Card */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 p-5 text-center">
        <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1">Total Revenue</p>
        <p className="text-3xl font-extrabold text-white">N{totalRevenue.toLocaleString()}</p>
        <p className="text-[10px] text-[#5C5E72] mt-1">From reservations + hotel bookings</p>
      </div>

      {/* Revenue Breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <RevenueCard label="Reservations" value={stats.totalReservationValue} count={stats.totalReservations} color="emerald" />
        <RevenueCard label="Hotels" value={stats.totalHotelRevenue} count={stats.totalHotelBookings} color="blue" />
      </div>

      {/* Metrics */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Business Metrics</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Total Users" value={stats.totalUsers} />
          <MetricCard label="Verified Workers" value={stats.verifiedWorkers} />
          <MetricCard label="Hotels Listed" value={stats.totalHotels} />
          <MetricCard label="Pending Workers" value={stats.pendingWorkers} />
        </div>
      </div>
    </div>
  );
}

function RevenueCard({ label, value, count, color }: { label: string; value: number; count: number; color: string }) {
  return (
    <div className={`rounded-2xl bg-${color}-500/5 border border-${color}-500/10 p-4`}>
      <p className="text-[10px] text-[#5C5E72] uppercase">{label}</p>
      <p className="text-xl font-bold text-white mt-1">N{value.toLocaleString()}</p>
      <p className="text-[9px] text-[#5C5E72] mt-1">{count} transactions</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
      <p className="text-lg font-bold text-white">{value.toLocaleString()}</p>
      <p className="text-[9px] text-[#5C5E72] mt-1">{label}</p>
    </div>
  );
}

// ─── RESERVATION FINANCE ───────────────────────────
function ReservationFinanceTab() {
  const [reservations, setReservations] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reservations')
        .select('*, listings(title, price)')
        .order('created_at', { ascending: false })
        .limit(50);
      setReservations(data || []);
    }
    load();
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Recent Reservations</h3>
      {reservations.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No reservations yet</div>
      ) : (
        reservations.map(r => (
          <div key={r.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{r.listings?.title || 'Unknown'}</p>
                <p className="text-[10px] text-[#5C5E72]">{r.status} &middot; {new Date(r.created_at).toLocaleDateString()}</p>
              </div>
              <p className="text-sm font-bold text-emerald-400">N{(r.amount || 0).toLocaleString()}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── HOTEL FINANCE ─────────────────────────────────
function HotelFinanceTab() {
  const [bookings, setBookings] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('hotel_bookings')
        .select('*, hotels(name)')
        .order('created_at', { ascending: false })
        .limit(50);
      setBookings(data || []);
    }
    load();
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Recent Hotel Bookings</h3>
      {bookings.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No bookings yet</div>
      ) : (
        bookings.map(b => (
          <div key={b.booking_id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{b.hotels?.name || 'Unknown Hotel'}</p>
                <p className="text-[10px] text-[#5C5E72]">{b.status} &middot; {b.total_nights} nights</p>
              </div>
              <p className="text-sm font-bold text-blue-400">N{b.total_price?.toLocaleString()}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── WORKER FINANCE ────────────────────────────────
function WorkerFinanceTab() {
  const [workers, setWorkers] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'worker')
        .order('created_at', { ascending: false });
      setWorkers(data || []);
    }
    load();
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Worker Overview</h3>
      {workers.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No workers yet</div>
      ) : (
        workers.map(w => (
          <div key={w.user_id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1A1A24] flex items-center justify-center text-sm font-bold text-[#5C5E72]">
              {(w.full_name || w.username || w.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{w.full_name || w.username || 'Unnamed'}</p>
              <p className="text-[10px] text-[#5C5E72]">{w.worker_occupation || 'No occupation'}</p>
            </div>
            <span className={`text-[9px] px-2 py-0.5 rounded-full ${
              w.worker_status === 'verified' ? 'bg-emerald-500/10 text-emerald-400' :
              w.worker_status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
              'bg-red-500/10 text-red-400'
            }`}>
              {w.worker_status}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
