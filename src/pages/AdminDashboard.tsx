import { useState, useEffect, useCallback } from 'react';
import {
  supabase, getAllUsers,
  getAllListingsAdmin, deleteListing, getReports,
} from '@/lib/supabase';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import UserProfileModal from '@/components/UserProfileModal';
import { AnnouncementsTab } from '@/components/AnnouncementsTab';
import BookingsTab from './BookingsTab';
import type { Profile, Listing } from '@/types';
import { ROLE_LABELS } from '@/types';
import { Toaster, toast } from 'sonner';

// Constitution: Admin Tabs: Overview, Users, Workers, Property Partners, Staff, Listings, Bookings, Reports, Support, Verification, Announcements
type AdminTab = 'overview' | 'users' | 'workers' | 'partners' | 'staff' | 'listings' | 'bookings' | 'reports' | 'support' | 'verification' | 'announcements';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

/* role badge colors — kept for future use
const roleColors: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  property_partner: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
};
*/

export default function AdminDashboard({ profile, onLogout, onNavigate }: Props) {
  const TAB_KEY = 'wh_admin_tab';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved && ['overview','users','workers','partners','staff','listings','bookings','reports','support','verification','announcements'].includes(saved) ? saved as AdminTab : 'overview';
    } catch { return 'overview'; }
  });

  const handleSetTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  }, []);

  const [stats, setStats] = useState({ totalUsers: 0, workers: 0, partners: 0, staff: 0, listings: 0, bookings: 0, reports: 0, pendingVerifications: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewingUser, setViewingUser] = useState<Profile | null>(null);
  const refresh = () => setRefreshKey(k => k + 1);

  // Admin sees ALL data nationwide (scope not restricted)

  useEffect(() => {
    async function loadStats() {
      const [userRes, listingRes, bookingsRes, reportsRes] = await Promise.all([
        getAllUsers(),
        getAllListingsAdmin(),
        supabase.from('worker_bookings').select('*', { count: 'exact', head: true }),
        getReports(),
      ]);
      const users = userRes.users || [];
      const listings = listingRes.listings || [];
      const isActive = (u: any) => !u.deleted && !u.deleted_at;

      setStats({
        totalUsers: users.filter(isActive).length,
        workers: users.filter((u: any) => isActive(u) && u.role === 'worker').length,
        partners: users.filter((u: any) => isActive(u) && u.role === 'property_partner').length,
        staff: users.filter((u: any) => isActive(u) && u.role === 'staff').length,
        listings: listings.length,
        bookings: bookingsRes.count || 0,
        reports: reportsRes.reports?.length || 0,
        pendingVerifications: users.filter((u: any) => isActive(u) && u.role === 'worker' && u.worker_status === 'pending').length,
      });
    }
    loadStats();
  }, [profile.role, profile.user_id, refreshKey]);

  // Constitution-compliant tabs
  const tabs = [
    { id: 'overview' as AdminTab, label: 'Overview' },
    { id: 'users' as AdminTab, label: 'Users' },
    { id: 'workers' as AdminTab, label: 'Workers' },
    { id: 'partners' as AdminTab, label: 'Partners' },
    { id: 'staff' as AdminTab, label: 'Staff' },
    { id: 'listings' as AdminTab, label: 'Listings' },
    { id: 'bookings' as AdminTab, label: 'Bookings' },
    { id: 'reports' as AdminTab, label: 'Reports' },
    { id: 'support' as AdminTab, label: 'Support' },
    { id: 'verification' as AdminTab, label: 'Verify' },
    { id: 'announcements' as AdminTab, label: 'Announcements' },
  ];

  return (
    <div className="min-h-[100dvh] bg-transparent pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" toastOptions={{ style: { background: '#1A1A24', color: '#fff', border: '1px solid #232330' } }} />

      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-5 pt-6 pb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-white">Admin Dashboard</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-indigo-300 bg-white/10 border-white/20">{ROLE_LABELS[profile.role as keyof typeof ROLE_LABELS] || profile.role}</span>
            </div>
            <p className="text-xs text-white/60">Admin manages operations, users, and support</p>
          </div>
          <div className="flex items-center gap-2">
            {onNavigate && (
              <button onClick={() => onNavigate('home')} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
            )}
            <button onClick={onLogout} className="h-8 px-3 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors">Logout</button>
          </div>
        </div>

        {/* Stats — Constitution compliant: Users, Workers, Partners, Staff, Listings */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Users', value: stats.totalUsers },
            { label: 'Workers', value: stats.workers },
            { label: 'Partners', value: stats.partners },
            { label: 'Staff', value: stats.staff },
          ].map(s => (
            <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center">
              <div className="text-lg font-bold text-white">{s.value}</div>
              <div className="text-[9px] text-white/60">{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="px-5 -mt-4">
        <div className="glass rounded-xl p-1 flex gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleSetTab(tab.id)}
                className={`flex-shrink-0 px-3 py-2 text-[11px] font-medium whitespace-nowrap rounded-lg transition-all ${
                  isActive ? 'bg-indigo-500/10 text-indigo-400' : 'text-[#5C5E72] hover:text-[#8B8DA0]'
                }`}
              >
                {tab.label}
                {tab.id === 'verification' && stats.pendingVerifications > 0 && (
                  <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{stats.pendingVerifications}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pt-4 pb-8">
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="glass rounded-2xl p-4 border border-indigo-500/10">
              <p className="text-xs text-[#8A8B9C]">As Admin, you manage day-to-day operations. You can view users, workers, property partners, staff, listings, bookings, reports, support tickets, and worker verifications.</p>
              {stats.pendingVerifications > 0 && (
                <button onClick={() => handleSetTab('verification')} className="mt-3 w-full h-9 rounded-xl bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
                  {stats.pendingVerifications} worker{stats.pendingVerifications !== 1 ? 's' : ''} pending verification →
                </button>
              )}
            </div>
          </div>
        )}
        {activeTab === 'users' && <UsersTabDirector profile={profile} onViewUser={setViewingUser} />}
        {activeTab === 'workers' && <WorkersTabDirector onViewUser={setViewingUser} />}
        {activeTab === 'partners' && <PartnersTabDirector onViewUser={setViewingUser} />}
        {activeTab === 'staff' && <StaffTabDirector profile={profile} />}
        {activeTab === 'listings' && <ListingsTabDirector refresh={refresh} />}
        {activeTab === 'bookings' && <BookingsTab />}
        {activeTab === 'reports' && <ReportsTabDirector />}
        {activeTab === 'support' && <SupportTabDirector />}
        {activeTab === 'verification' && <VerificationTabDirector refresh={refresh} />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope="all" />}
      </div>

      {/* User Profile Viewer */}
      <UserProfileModal user={viewingUser} onClose={() => setViewingUser(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// USERS TAB — All users except workers, partners, staff (those have own tabs)
// ═══════════════════════════════════════════════════════════
function UsersTabDirector({ profile, onViewUser }: { profile: Profile; onViewUser?: (u: Profile) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    // Only regular users (not workers, partners, staff, admin, creator)
    const regularUsers = (data || []).filter((u: any) =>
      !u.deleted && u.user_id !== profile.user_id && u.role === 'user'
    );
    setUsers(regularUsers);
    setLoading(false);
  }

  const filtered = users.filter(u =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No users found</p>}
          {filtered.map(u => (
            <div key={u.id} className="glass rounded-xl p-3 hover:border-indigo-500/20 transition-all cursor-pointer" onClick={() => onViewUser?.(u)}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xs font-bold">{(u.username || 'U').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">@{u.username || 'unknown'}</p>
                  <p className="text-[10px] text-[#5C5E72] truncate">{u.email}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WORKERS TAB
// ═══════════════════════════════════════════════════════════
function WorkersTabDirector({ onViewUser }: { onViewUser?: (u: Profile) => void }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    const w = (data || []).filter((u: any) => u.role === 'worker' && !u.deleted);
    setWorkers(w);
    setLoading(false);
  }

  const filtered = workers.filter(w => !statusFilter || w.worker_status === statusFilter);

  return (
    <div className="space-y-3">
      {/* Status filter */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {['', 'pending', 'approved_for_verification', 'verified', 'suspended'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 h-7 rounded-lg text-[10px] font-medium whitespace-nowrap ${statusFilter === s ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20' : 'bg-[#1A1A24] border border-[#232330] text-[#5C5E72]'}`}>
            {s === '' ? 'All' : s === 'approved_for_verification' ? 'Blue Tick' : s === 'approved' ? 'Approved' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No workers found</p>}
          {filtered.map(w => (
            <div key={w.id} className="glass rounded-xl p-3 hover:border-pink-500/20 transition-all cursor-pointer" onClick={() => onViewUser?.(w)}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-pink-700 flex items-center justify-center text-white text-xs font-bold">{(w.username || 'W').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-white truncate">@{w.username || 'unknown'}</p>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[w.worker_status] || 'bg-gray-500/10 text-gray-400'}`}>
                      {STATUS_LABELS[w.worker_status] || w.worker_status}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#5C5E72] truncate">{w.worker_occupation || 'No occupation'} · {w.email}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved_for_verification: 'Blue Tick',
  profile_under_review: 'Under Review',
  verified: 'Public',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400',
  approved_for_verification: 'bg-blue-500/10 text-blue-400',
  profile_under_review: 'bg-purple-500/10 text-purple-400',
  verified: 'bg-emerald-500/10 text-emerald-400',
  suspended: 'bg-red-500/10 text-red-400',
  rejected: 'bg-gray-500/10 text-gray-400',
};

// ═══════════════════════════════════════════════════════════
// PROPERTY PARTNERS TAB
// ═══════════════════════════════════════════════════════════
function PartnersTabDirector({ onViewUser }: { onViewUser?: (u: Profile) => void }) {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    const p = (data || []).filter((u: any) => u.role === 'property_partner' && !u.deleted);
    setPartners(p);
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {partners.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No property partners found</p>}
          {partners.map(p => (
            <div key={p.id} className="glass rounded-xl p-3 hover:border-violet-500/20 transition-all cursor-pointer" onClick={() => onViewUser?.(p)}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center text-white text-xs font-bold">{(p.username || 'P').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">@{p.username || 'unknown'}</p>
                  <p className="text-[10px] text-[#5C5E72] truncate">{p.email}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF TAB
// ═══════════════════════════════════════════════════════════
const MODULE_LABELS: Record<string, string> = {
  operations: 'Operations',
  finance: 'Finance',
  support: 'Support',
  verification: 'Verification',
  field_officer: 'Field Officer',
};

function StaffTabDirector({ profile }: { profile: Profile }) {
  const [staff, setStaff] = useState<any[]>([]);
  const [staffModules, setStaffModules] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    const s = (data || []).filter((u: any) => u.role === 'staff' && !u.deleted && u.user_id !== profile.user_id);
    setStaff(s);

    // Fetch all staff modules
    const { data: modulesData } = await supabase.from('staff_modules').select('*').is('revoked_at', null);
    const mods: Record<string, string[]> = {};
    (modulesData || []).forEach((m: any) => {
      if (!mods[m.staff_id]) mods[m.staff_id] = [];
      mods[m.staff_id].push(m.module);
    });
    setStaffModules(mods);
    setLoading(false);
  }

  async function assignModule(staffId: string, module: string) {
    setSaving(staffId);
    const current = staffModules[staffId] || [];
    const hasModule = current.includes(module);

    // Per Constitution: Staff can only have ONE module at a time
    if (!hasModule) {
      // Revoke ALL existing modules first
      await supabase.from('staff_modules').update({ revoked_at: new Date().toISOString() }).eq('staff_id', staffId).is('revoked_at', null);
      // Grant only the selected module
      await supabase.from('staff_modules').insert({ staff_id: staffId, module, granted_by: profile.user_id });
      setStaffModules(prev => ({ ...prev, [staffId]: [module] }));
    } else {
      // Revoking the only module
      await supabase.from('staff_modules').update({ revoked_at: new Date().toISOString() }).eq('staff_id', staffId).eq('module', module).is('revoked_at', null);
      setStaffModules(prev => ({ ...prev, [staffId]: [] }));
    }
    setSaving(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[#5C5E72]">Each staff member can have ONE module only. Select from dropdown to assign.</p>
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-3">
          {staff.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No staff members</p>}
          {staff.map(s => {
            const modules = staffModules[s.user_id] || [];
            const currentModule = modules[0] || null;
            return (
              <div key={s.user_id} className="glass rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold">{(s.username || 'S').charAt(0).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">@{s.username || 'unknown'}</p>
                    <p className="text-[10px] text-[#5C5E72] truncate">{s.email}</p>
                  </div>
                </div>
                {/* Single-select module dropdown */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-[#5C5E72] flex-shrink-0">Module:</label>
                  <select
                    value={currentModule || ''}
                    onChange={(e) => assignModule(s.user_id, e.target.value)}
                    disabled={saving === s.user_id}
                    className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-[11px] px-2 focus:border-[#3B82F6]/50 outline-none"
                  >
                    <option value="">No module assigned</option>
                    {Object.entries(MODULE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  {saving === s.user_id && <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LISTINGS TAB
// ═══════════════════════════════════════════════════════════
function ListingsTabDirector({ refresh }: { refresh: () => void }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { requestAuth } = useAdminAuth();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    setListings(data || []);
    setLoading(false);
  }

  async function doDelete(id: string) {
    const { error } = await deleteListing(id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Deleted'); load(); refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this listing?')) return;
    requestAuth(() => doDelete(id));
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#5C5E72]">{listings.length} listing{listings.length !== 1 ? 's' : ''} total</p>
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {listings.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No listings yet</p>}
          {listings.map((l: Listing) => (
            <div key={l.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1A1A24] flex items-center justify-center text-lg">🏠</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{l.title || 'Untitled'}</p>
                  <p className="text-[10px] text-[#5C5E72]">{l.property_type || 'apartment'} · N{(l.price || 0).toLocaleString()}</p>
                </div>
                <button onClick={() => handleDelete(l.id)} className="h-7 px-2 rounded-lg bg-red-500/10 text-red-400 text-[10px] border border-red-500/20">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// BOOKINGS TAB (placeholder)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════════════════════════
function ReportsTabDirector() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { reports } = await getReports();
    setReports(reports || []);
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {reports.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No reports</p>}
          {reports.map((r: any) => (
            <div key={r.id} className="glass rounded-xl p-3">
              <p className="text-xs text-white">{r.reason || 'Report'}</p>
              <p className="text-[10px] text-[#5C5E72]">{r.description || ''}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SUPPORT TAB
// ═══════════════════════════════════════════════════════════
function SupportTabDirector() {
  return (
    <div className="space-y-3">
      <div className="glass rounded-xl p-4 text-center">
        <p className="text-sm text-[#5C5E72]">Support ticket management</p>
        <p className="text-[10px] text-[#3A3A4A] mt-2">View and respond to user support requests</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// VERIFICATION TAB — Worker verification approval
// ═══════════════════════════════════════════════════════════
function VerificationTabDirector({ refresh }: { refresh: () => void }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { requestAuth } = useAdminAuth();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { users: data } = await getAllUsers();
    // Show workers: pending (need access granted), approved_for_verification (have blue tick), profile_under_review (ready for final review)
    const pending = (data || []).filter((u: any) =>
      u.role === 'worker' && ['pending', 'approved_for_verification', 'profile_under_review'].includes(u.worker_status) && !u.deleted
    );
    setWorkers(pending);
    setLoading(false);
  }

  async function doGrantAccess(userId: string) {
    const { error } = await supabase.from('profiles').update({
      worker_status: 'approved_for_verification',
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Blue tick granted — worker can now proceed with verification');
    load(); refresh();
  }

  async function doApprove(userId: string) {
    const { error } = await supabase.from('profiles').update({
      worker_status: 'verified',
      worker_verified: true,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Worker approved and published');
    load(); refresh();
  }

  async function doReject(userId: string) {
    const { error } = await supabase.from('profiles').update({
      worker_status: 'rejected',
      worker_verified: false,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Worker rejected');
    load(); refresh();
  }

  async function handleGrantAccess(userId: string) {
    requestAuth(() => doGrantAccess(userId));
  }

  async function handleApprove(userId: string) {
    requestAuth(() => doApprove(userId));
  }

  async function handleReject(userId: string) {
    if (!confirm('Reject this worker?')) return;
    requestAuth(() => doReject(userId));
  }

  return (
    <div className="space-y-3">
      {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div> : (
        <div className="space-y-2">
          {workers.length === 0 && <p className="text-center text-sm text-[#5C5E72] py-10">No workers pending verification</p>}
          {workers.map(w => (
            <div key={w.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-sm font-bold">{(w.username || 'W').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-white">@{w.username || 'unknown'}</p>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[w.worker_status]}`}>{STATUS_LABELS[w.worker_status]}</span>
                  </div>
                  <p className="text-[10px] text-[#5C5E72]">{w.worker_occupation || 'No occupation'} · {w.email}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {w.worker_status === 'pending' && (
                  <button onClick={() => handleGrantAccess(w.user_id)} className="flex-1 h-8 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-medium border border-blue-500/20 hover:bg-blue-500/20 transition-colors">Grant Access</button>
                )}
                {w.worker_status === 'approved_for_verification' && (
                  <div className="flex-1 h-8 rounded-lg bg-blue-500/5 text-blue-400/60 text-xs font-medium border border-blue-500/10 flex items-center justify-center">
                    Worker filling info...
                  </div>
                )}
                {w.worker_status === 'profile_under_review' && (
                  <>
                    <button onClick={() => handleApprove(w.user_id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">Approve & Publish</button>
                    <button onClick={() => handleReject(w.user_id)} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20 hover:bg-red-500/20 transition-colors">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
