import { useState } from 'react';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

type AnTab = 'revenue' | 'activity' | 'reports';

const TABS: { id: AnTab; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'activity', label: 'Activity' },
  { id: 'reports', label: 'Reports' },
];

export default function AnalyticsPage({ profile }: { profile: Profile | null }) {
  const [activeTab, setActiveTab] = useState<AnTab>('revenue');

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
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Total Revenue</p>
            <p className="text-xl font-bold text-white mt-1">N0</p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Active Users</p>
            <p className="text-xl font-bold text-white mt-1">0</p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Bookings</p>
            <p className="text-xl font-bold text-white mt-1">0</p>
          </div>
          <div className="glass rounded-2xl p-4 border border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Listings</p>
            <p className="text-xl font-bold text-white mt-1">0</p>
          </div>
        </div>

        <div className="text-center py-8">
          <p className="text-[11px] text-[#5C5E72]">Detailed analytics coming soon</p>
        </div>
      </div>
    </div>
  );
}
