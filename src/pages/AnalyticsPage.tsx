import { useState, useEffect } from 'react';
import type { Profile } from '@/types';
import { supabase } from '@/lib/supabase';
import { Toaster } from 'sonner';

type AnTab = 'overview' | 'activity' | 'reports';

interface AnalyticsData {
  totalRevenue: number;
  activeUsers: number;
  totalBookings: number;
  totalListings: number;
  totalWorkers: number;
  totalPartners: number;
  pendingVerifications: number;
  pendingInspections: number;
  loading: boolean;
}

export default function AnalyticsPage({ profile }: { profile: Profile | null }) {
  const [activeTab, setActiveTab] = useState<AnTab>('overview');
  const [data, setData] = useState<AnalyticsData>({
    totalRevenue: 0,
    activeUsers: 0,
    totalBookings: 0,
    totalListings: 0,
    totalWorkers: 0,
    totalPartners: 0,
    pendingVerifications: 0,
    pendingInspections: 0,
    loading: true,
  });

  const role = profile?.role || '';
  const isCreator = role === 'creator';
  const isAdmin = role === 'admin';

  // Determine tabs based on role
  const getTabs = () => {
    if (isCreator) {
      return [
        { id: 'overview' as AnTab, label: 'Overview' },
        { id: 'activity' as AnTab, label: 'Activity' },
        { id: 'reports' as AnTab, label: 'Reports' },
      ];
    }
    if (isAdmin) {
      return [
        { id: 'overview' as AnTab, label: 'Overview' },
        { id: 'activity' as AnTab, label: 'Activity' },
        { id: 'reports' as AnTab, label: 'Reports' },
      ];
    }
    // Staff — only activity relevant to their modules
    return [
      { id: 'overview' as AnTab, label: 'Overview' },
      { id: 'activity' as AnTab, label: 'Activity' },
    ];
  };

  const tabs = getTabs();

  useEffect(() => {
    async function loadStats() {
      const promises: any[] = [];

      // Active Users — count non-deleted users (all roles see this)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'user')
          .is('deleted_at', null)
      );

      // Total Listings (all roles see this)
      promises.push(
        supabase
          .from('listings')
          .select('*', { count: 'exact', head: true })
          .is('deleted_at', null)
      );

      // Total Bookings (all roles see this)
      promises.push(
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
      );

      // Total Workers (all roles see this)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'worker')
          .is('deleted_at', null)
      );

      // Total Partners (all roles see this)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'property_partner')
          .is('deleted_at', null)
      );

      // Pending Verifications (workers pending approval)
      promises.push(
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'worker')
          .eq('worker_status', 'pending')
          .is('deleted_at', null)
      );

      // Revenue — ONLY for creator
      if (isCreator) {
        promises.push(
          supabase
            .from('transactions')
            .select('amount')
            .eq('status', 'completed')
        );
      }

      const results = await Promise.all(promises);

      const activeUsers = results[0].count || 0;
      const totalListings = results[1].count || 0;
      const totalBookings = results[2].count || 0;
      const totalWorkers = results[3].count || 0;
      const totalPartners = results[4].count || 0;
      const pendingVerifications = results[5].count || 0;

      // Revenue only for creator (last result)
      let totalRevenue = 0;
      if (isCreator && results[6]?.data) {
        totalRevenue = results[6].data.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
      }

      setData({
        totalRevenue,
        activeUsers,
        totalBookings,
        totalListings,
        totalWorkers,
        totalPartners,
        pendingVerifications,
        pendingInspections: 0, // TODO: from inspections table
        loading: false,
      });
    }

    loadStats();
  }, [isCreator]);

  const formatCurrency = (n: number) =>
    n >= 1000000
      ? `N${(n / 1000000).toFixed(1)}M`
      : n >= 1000
        ? `N${(n / 1000).toFixed(1)}K`
        : `N${n.toLocaleString()}`;

  // Render different cards based on role
  const renderCards = () => {
    if (isCreator) {
      // Creator sees: Revenue, Users, Bookings, Listings, Workers, Partners, Pending Verifications
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Total Revenue</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-16 h-5 bg-white/[0.06] rounded animate-pulse" /> : formatCurrency(data.totalRevenue)}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.activeUsers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Bookings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalBookings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalListings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Workers</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalWorkers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Partners</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalPartners.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06] col-span-2">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending Verifications</p>
            <p className="text-xl font-bold text-amber-400 mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.pendingVerifications.toLocaleString()}
            </p>
          </div>
        </div>
      );
    }

    if (isAdmin) {
      // Admin sees: Users, Bookings, Listings, Workers, Partners, Pending Verifications — NO Revenue
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.activeUsers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Bookings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalBookings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalListings.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Workers</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalWorkers.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Partners</p>
            <p className="text-xl font-bold text-white mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalPartners.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending Verifications</p>
            <p className="text-xl font-bold text-amber-400 mt-1">
              {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.pendingVerifications.toLocaleString()}
            </p>
          </div>
        </div>
      );
    }

    // Staff — only show metrics relevant to their assigned modules
    // No revenue, no sensitive financial data
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
          <p className="text-xl font-bold text-white mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.activeUsers.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
          <p className="text-xl font-bold text-white mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalListings.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Workers</p>
          <p className="text-xl font-bold text-white mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.totalWorkers.toLocaleString()}
          </p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Pending Verifications</p>
          <p className="text-xl font-bold text-amber-400 mt-1">
            {data.loading ? <span className="inline-block w-12 h-5 bg-white/[0.06] rounded animate-pulse" /> : data.pendingVerifications.toLocaleString()}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-0">
        <h1 className="text-lg font-bold text-white mb-3">
          {isCreator ? 'Platform Analytics' : isAdmin ? 'Platform Overview' : 'Analytics'}
        </h1>
        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-3">
          {tabs.map(tab => (
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
        {renderCards()}

        <div className="text-center py-8">
          <p className="text-[11px] text-[#5C5E72]">
            {isCreator ? 'Full platform financial data' : isAdmin ? 'Platform management metrics' : 'Metrics for your assigned modules'}
          </p>
        </div>
      </div>
    </div>
  );
}
