import { useState, useEffect } from 'react';
import type { Profile } from '@/types';
import { supabase } from '@/lib/supabase';
import { Toaster } from 'sonner';

type AnTab = 'revenue' | 'activity' | 'reports';

const TABS: { id: AnTab; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'activity', label: 'Activity' },
  { id: 'reports', label: 'Reports' },
];

interface AnalyticsData {
  totalRevenue: number;
  activeUsers: number;
  totalBookings: number;
  totalListings: number;
  loading: boolean;
}

export default function AnalyticsPage({ profile }: { profile: Profile | null }) {
  const [activeTab, setActiveTab] = useState<AnTab>('revenue');
  const [data, setData] = useState<AnalyticsData>({
    totalRevenue: 0,
    activeUsers: 0,
    totalBookings: 0,
    totalListings: 0,
    loading: true,
  });

  const role = profile?.role || '';
  const isStaff = role === 'staff';

  useEffect(() => {
    async function loadStats() {
      // Revenue — from transactions
      const { data: txns } = await supabase
        .from('transactions')
        .select('amount')
        .eq('status', 'completed');
      const totalRevenue = (txns || []).reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

      // Active Users — count non-deleted users
      const { count: activeUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'user')
        .is('deleted_at', null);

      // Total Bookings
      const { count: totalBookings } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true });

      // Total Listings
      const { count: totalListings } = await supabase
        .from('listings')
        .select('*', { count: 'exact', head: true })
        .is('deleted_at', null);

      setData({
        totalRevenue,
        activeUsers: activeUsers || 0,
        totalBookings: totalBookings || 0,
        totalListings: totalListings || 0,
        loading: false,
      });
    }

    loadStats();
  }, []);

  const formatCurrency = (n: number) =>
    n >= 1000000
      ? `N${(n / 1000000).toFixed(1)}M`
      : n >= 1000
        ? `N${(n / 1000).toFixed(1)}K`
        : `N${n.toLocaleString()}`;

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-0">
        <h1 className="text-lg font-bold text-white mb-3">Analytics</h1>
        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-3">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 h-8 px-3 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.id ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] text-[#5C5E72] hover:text-white'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 py-8 space-y-4">
        {/* Summary Cards — live database data */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Total Revenue</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? (
                <span className="inline-block w-16 h-5 bg-white/[0.06] rounded animate-pulse" />
              ) : (
                formatCurrency(data.totalRevenue)
              )}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? (
                <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" />
              ) : (
                data.activeUsers.toLocaleString()
              )}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Bookings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? (
                <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" />
              ) : (
                data.totalBookings.toLocaleString()
              )}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? (
                <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" />
              ) : (
                data.totalListings.toLocaleString()
              )}
            </p>
          </div>
        </div>

        <div className="text-center py-8">
          <p className="text-[11px] text-[#5C5E72]">
            {isStaff ? 'Analytics for your assigned modules' : 'Detailed breakdowns by tab above'}
          </p>
        </div>
      </div>
    </div>
  );
}
