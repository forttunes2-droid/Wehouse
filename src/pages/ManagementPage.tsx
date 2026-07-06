import { useState } from 'react';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

type MgmtTab = 'users' | 'workers' | 'partners' | 'listings' | 'hotels' | 'staff';

const TABS: { id: MgmtTab; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'workers', label: 'Workers' },
  { id: 'partners', label: 'Partners' },
  { id: 'listings', label: 'Listings' },
  { id: 'hotels', label: 'Hotels' },
  { id: 'staff', label: 'Staff' },
];

export default function ManagementPage({ profile, onNavigate }: { profile: Profile | null; onNavigate: (p: string) => void }) {
  const [activeTab, setActiveTab] = useState<MgmtTab>('users');

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-0">
        <h1 className="text-lg font-bold text-white mb-3">Management</h1>
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

      <div className="px-4 py-8">
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">Management — {activeTab}</p>
          <p className="text-[11px] text-[#5C5E72]/60 mt-1">Full management panel coming soon</p>
        </div>
      </div>
    </div>
  );
}
