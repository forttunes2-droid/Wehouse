import { useState } from 'react';
import type { Profile } from '@/types';

type CreatorTab = 'users' | 'listings' | 'workers' | 'analytics' | 'settings';

interface CreatorDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

export default function CreatorDashboard({ profile, onLogout }: CreatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<CreatorTab>('users');

  const tabs: { id: CreatorTab; label: string; icon: string }[] = [
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'listings', label: 'Listings', icon: '🏠' },
    { id: 'workers', label: 'Workers', icon: '🔧' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      {/* Header */}
      <header className="bg-[#0F1724] text-white px-5 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#C8A45A] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1724" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold">Creator Dashboard</div>
              <div className="text-[10px] text-white/50">@{profile.username}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-white/50 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-[#e5e2dd] overflow-x-auto">
        <div className="max-w-lg mx-auto flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[60px] py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#C8A45A] text-[#C8A45A]'
                  : 'border-transparent text-[#8B8680] hover:text-[#0F1724]'
              }`}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-lg mx-auto px-5 py-6">
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'listings' && <ListingsTab />}
        {activeTab === 'workers' && <WorkersTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'settings' && <SettingsTab profile={profile} />}
      </main>
    </div>
  );
}

// ─── USERS TAB ─────────────────────────────────────
function UsersTab() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-3">All Users</h3>
        <div className="text-xs text-[#8B8680] py-8 text-center">
          User management coming soon...
        </div>
      </div>
    </div>
  );
}

// ─── LISTINGS TAB ──────────────────────────────────
function ListingsTab() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Property Listings</h3>
        <div className="text-xs text-[#8B8680] py-8 text-center">
          Listing management coming soon...
        </div>
      </div>
    </div>
  );
}

// ─── WORKERS TAB ───────────────────────────────────
function WorkersTab() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Verified Workers</h3>
        <div className="text-xs text-[#8B8680] py-8 text-center">
          Worker management coming soon...
        </div>
      </div>
    </div>
  );
}

// ─── ANALYTICS TAB ─────────────────────────────────
function AnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Analytics</h3>
        <div className="text-xs text-[#8B8680] py-8 text-center">
          Analytics dashboard coming soon...
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS TAB ──────────────────────────────────
function SettingsTab({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-4">Creator Settings</h3>

        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-[#f0eeea]">
            <span className="text-xs text-[#8B8680]">User ID</span>
            <span className="text-xs font-medium text-[#0F1724]">{profile.user_id}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-[#f0eeea]">
            <span className="text-xs text-[#8B8680]">Username</span>
            <span className="text-xs font-medium text-[#0F1724]">@{profile.username}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-[#f0eeea]">
            <span className="text-xs text-[#8B8680]">Email</span>
            <span className="text-xs font-medium text-[#0F1724]">{profile.email}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-[#f0eeea]">
            <span className="text-xs text-[#8B8680]">Role</span>
            <span className="text-xs font-medium text-[#C8A45A] capitalize">{profile.role.replace('_', ' ')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
