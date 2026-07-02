import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile, Listing } from '@/types';

interface FieldOfficerDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

export default function FieldOfficerDashboard({ profile }: FieldOfficerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'inspections' | 'listings' | 'tasks'>('inspections');
  const [pendingInspections, setPendingInspections] = useState<Listing[]>([]);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [pendingResult, myResult] = await Promise.all([
        // Listings pending inspection (pending_approval status)
        supabase
          .from('listings')
          .select('*')
          .eq('status', 'pending_approval')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        // Listings assigned to this field officer
        supabase
          .from('listings')
          .select('*')
          .eq('chat_agent_id', profile.user_id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      ]);
      setPendingInspections(pendingResult.data || []);
      setMyListings(myResult.data || []);
      setLoading(false);
    }
    load();
  }, [profile.user_id]);

  async function markInspected(listingId: string) {
    const { error } = await supabase
      .from('listings')
      .update({ status: 'available', approved_by: profile.user_id, approved_at: new Date().toISOString() })
      .eq('id', listingId);

    if (error) {
      alert('Failed: ' + error.message);
      return;
    }

    // Refresh
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'pending_approval')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setPendingInspections(data || []);
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Field Officer</h1>
            <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            {profile.city || 'No Location'}
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.04]">
        {(['inspections', 'listings', 'tasks'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 h-9 rounded-xl text-[11px] font-semibold transition-all ${
              activeTab === tab ? 'bg-amber-500 text-white' : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'inspections' && pendingInspections.length > 0 && (
              <span className="ml-1 text-[9px] bg-red-500 text-white px-1 rounded-full">{pendingInspections.length}</span>
            )}
          </button>
        ))}
      </div>

      <main className="px-5 py-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'inspections' && (
              <InspectionsTab listings={pendingInspections} onMarkInspected={markInspected} profile={profile} />
            )}
            {activeTab === 'listings' && <MyListingsTab listings={myListings} />}
            {activeTab === 'tasks' && <TasksTab profile={profile} />}
          </>
        )}
      </main>
    </div>
  );
}

// ─── INSPECTIONS TAB ───────────────────────────────
function InspectionsTab({ listings, onMarkInspected, profile }: { listings: Listing[]; onMarkInspected: (id: string) => void; profile: Profile }) {
  const [filterState, setFilterState] = useState(profile.state || '');

  const filtered = filterState
    ? listings.filter(l => l.state?.toLowerCase() === filterState.toLowerCase())
    : listings;

  return (
    <div className="space-y-4">
      {/* State Filter */}
      <div className="flex gap-2">
        <input
          type="text"
          value={filterState}
          onChange={e => setFilterState(e.target.value)}
          placeholder="Filter by state..."
          className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder:text-[#5C5E72] outline-none focus:border-amber-500"
        />
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No pending inspections</p>
            <p className="text-[10px] text-[#5C5E72] mt-1">All listings in your area have been inspected</p>
          </div>
        ) : (
          filtered.map(l => (
            <div key={l.id} className="rounded-2xl bg-[#12121A]/60 border border-amber-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white truncate">{l.title}</p>
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">PENDING</span>
                  </div>
                  <p className="text-[10px] text-[#5C5E72] mt-1">{l.address || 'No address'}</p>
                  <p className="text-[10px] text-[#5C5E72]">{l.city}, {l.state} &middot; {l.bedrooms} bed &middot; N{l.price?.toLocaleString()}</p>
                  {l.submitted_by_role && (
                    <p className="text-[9px] text-[#5C5E72] mt-1">Submitted by: {l.submitted_by_role}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onMarkInspected(l.id)}
                  className="flex-1 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold hover:bg-emerald-500/20"
                >
                  Approve
                </button>
                <button
                  onClick={() => {
                    const reason = prompt('Rejection reason:');
                    if (reason) {
                      supabase.from('listings').update({ status: 'rejected', rejection_reason: reason }).eq('id', l.id).then(() => window.location.reload());
                    }
                  }}
                  className="flex-1 h-9 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold hover:bg-red-500/20"
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── MY LISTINGS TAB ───────────────────────────────
function MyListingsTab({ listings }: { listings: Listing[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">
        Your Assigned Listings ({listings.length})
      </h3>
      {listings.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No listings assigned to you</div>
      ) : (
        listings.map(l => (
          <div key={l.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-sm font-semibold text-white">{l.title}</p>
            <p className="text-[10px] text-[#5C5E72]">{l.city}, {l.state}</p>
            <p className="text-[10px] text-[#5C5E72]">{l.bedrooms} bed &middot; N{l.price?.toLocaleString()}</p>
            <span className={`inline-block mt-2 text-[9px] px-2 py-0.5 rounded-full ${
              l.status === 'available' ? 'bg-emerald-500/10 text-emerald-400' :
              l.status === 'reserved' ? 'bg-amber-500/10 text-amber-400' :
              'bg-gray-500/10 text-gray-400'
            }`}>
              {l.status}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ─── TASKS TAB ─────────────────────────────────────
function TasksTab({ profile }: { profile: Profile }) {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      // Get recent audit logs related to this field officer
      const { data } = await supabase
        .from('admin_audit_log')
        .select('*')
        .eq('admin_id', profile.user_id)
        .order('created_at', { ascending: false })
        .limit(20);
      setTasks(data || []);
    }
    load();
  }, [profile.user_id]);

  const checklist = [
    { label: 'Verify property photos match actual location', done: false },
    { label: 'Check amenities are as listed', done: false },
    { label: 'Confirm price with landlord', done: false },
    { label: 'Document property condition', done: false },
    { label: 'Take geotagged photos', done: false },
    { label: 'Verify security of the area', done: false },
  ];

  return (
    <div className="space-y-4">
      {/* Inspection Checklist */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Inspection Checklist</h3>
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] divide-y divide-white/[0.04]">
          {checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center ${
                item.done ? 'bg-amber-500 border-amber-500' : 'border-[#232330]'
              }`}>
                {item.done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </div>
              <span className={`text-[11px] ${item.done ? 'text-white line-through' : 'text-[#8A8B9C]'}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Your Recent Activity</h3>
        {tasks.length === 0 ? (
          <div className="text-center py-6 text-[#5C5E72] text-sm">No recent activity</div>
        ) : (
          tasks.map(t => (
            <div key={t.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <p className="text-[11px] text-white flex-1">{t.action}</p>
                <span className="text-[9px] text-[#5C5E72]">{new Date(t.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
