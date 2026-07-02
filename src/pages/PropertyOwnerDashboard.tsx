import { useState, useEffect } from 'react';
import type { Profile, PropertyOwner, OwnerContract, Payout } from '@/types';

interface PropertyOwnerDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

export default function PropertyOwnerDashboard({ profile }: PropertyOwnerDashboardProps) {
  const [owner, _setOwner] = useState<PropertyOwner | null>(null);
  const [properties, _setProperties] = useState<any[]>([]);
  const [contracts, _setContracts] = useState<OwnerContract[]>([]);
  const [payouts, _setPayouts] = useState<Payout[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'properties' | 'contracts' | 'payouts'>('overview');
  const [_loading, _setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Find property owner record linked to this user (if any)
      // In production, property owners are separate from app users
      // This is a simplified version for the private dashboard
      _setLoading(false);
    }
    load();
  }, [profile.user_id]);

  // For demo: show placeholder data structure
  const totalPayouts = payouts.reduce((s, p) => s + (p.status === 'paid' ? p.amount : 0), 0);

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Property Owner</h1>
            <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Private</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.04]">
        {(['overview', 'properties', 'contracts', 'payouts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 h-9 rounded-xl text-[11px] font-semibold transition-all ${
              activeTab === tab ? 'bg-violet-500 text-white' : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <main className="px-5 py-4 space-y-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Owner Info Card */}
            <div className="rounded-2xl bg-violet-500/5 border border-violet-500/10 p-5">
              <p className="text-[10px] text-violet-400 uppercase tracking-wider mb-1">Owner Profile</p>
              <p className="text-xl font-bold text-white">{profile.full_name || profile.username || 'Owner'}</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">{profile.email} &middot; {profile.phone || 'No phone'}</p>
              <p className="text-[10px] text-[#5C5E72]">{profile.city}, {profile.state}</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
                <p className="text-2xl font-bold text-white">{properties.length}</p>
                <p className="text-[9px] text-[#5C5E72] mt-1">Properties</p>
              </div>
              <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
                <p className="text-2xl font-bold text-emerald-400">N{totalPayouts.toLocaleString()}</p>
                <p className="text-[9px] text-[#5C5E72] mt-1">Total Payouts</p>
              </div>
              <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
                <p className="text-2xl font-bold text-white">{contracts.length}</p>
                <p className="text-[9px] text-[#5C5E72] mt-1">Contracts</p>
              </div>
              <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
                <p className="text-2xl font-bold text-amber-400">{payouts.filter(p => p.status === 'pending').length}</p>
                <p className="text-[9px] text-[#5C5E72] mt-1">Pending</p>
              </div>
            </div>

            {/* Bank Details */}
            <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
              <h4 className="text-sm font-semibold text-white">Bank Details</h4>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between"><span className="text-[#5C5E72]">Bank</span><span className="text-[#8A8B9C]">{owner?.bank_name || 'Not set'}</span></div>
                <div className="flex justify-between"><span className="text-[#5C5E72]">Account Number</span><span className="text-[#8A8B9C]">{owner?.bank_account_number || 'Not set'}</span></div>
                <div className="flex justify-between"><span className="text-[#5C5E72]">Account Name</span><span className="text-[#8A8B9C]">{owner?.bank_account_name || 'Not set'}</span></div>
                <div className="flex justify-between"><span className="text-[#5C5E72]">Commission Rate</span><span className="text-emerald-400">{owner?.commission_rate || 10}%</span></div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'properties' && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">My Properties</h4>
            {properties.length === 0 ? (
              <div className="text-center py-10 text-[#5C5E72] text-sm">No properties linked yet</div>
            ) : properties.map(p => (
              <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
                <p className="text-sm font-semibold text-white">{p.listings?.title || 'Property'}</p>
                <p className="text-[10px] text-[#5C5E72]">{p.listings?.city}, {p.listings?.state}</p>
                <p className="text-[10px] text-[#5C5E72]">Monthly rent: N{p.monthly_rent?.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'contracts' && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Contracts</h4>
            {contracts.length === 0 ? (
              <div className="text-center py-10 text-[#5C5E72] text-sm">No contracts on file</div>
            ) : contracts.map(c => (
              <div key={c.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
                <p className="text-sm font-semibold text-white">{c.contract_code}</p>
                <p className="text-[10px] text-[#5C5E72]">{c.contract_type} &middot; {c.status} &middot; {c.commission_rate}% commission</p>
                <p className="text-[10px] text-[#5C5E72]">{c.start_date} {c.end_date ? `to ${c.end_date}` : 'ongoing'}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'payouts' && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Payout History</h4>
            {payouts.length === 0 ? (
              <div className="text-center py-10 text-[#5C5E72] text-sm">No payouts yet</div>
            ) : payouts.map(p => (
              <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{p.payout_code}</p>
                    <p className="text-[10px] text-[#5C5E72]">{p.period_start} to {p.period_end}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-400">N{p.amount.toLocaleString()}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>{p.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
