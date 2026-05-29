import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, getAllListingsAdmin, deleteListing,
  updateUserRole, logAuditAction,
} from '@/lib/supabase';
import { AnnouncementsTab } from './CreatorDashboard';
import type { Profile } from '@/types';
import { ROLE_LABELS } from '@/types';
import { Input } from '@/components/ui/input';
import { Toaster, toast } from 'sonner';

type HosTab = 'overview' | 'staff' | 'listings' | 'announcements';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

// ─── ROLE COLORS ───────────────────────────────────
const roleColors: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  state_admin: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  assistant_state_admin: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
};

export default function HeadOfStaffDashboard({ profile, onLogout, onNavigate }: Props) {
  const TAB_KEY = 'wh_hos_tab';
  const [activeTab, setActiveTab] = useState<HosTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved && ['overview','staff','listings','announcements'].includes(saved) ? saved as HosTab : 'overview';
    } catch { return 'overview'; }
  });

  const handleSetTab = useCallback((tab: HosTab) => {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  }, []);

  const [stats, setStats] = useState({ staff: 0, listings: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const scope = {
    state: profile.assigned_state || profile.state || '',
    lga: profile.assigned_lga || profile.city || '',
  };

  useEffect(() => {
    async function load() {
      const [{ users }, { listings }] = await Promise.all([
        getAllUsers(), getAllListingsAdmin()
      ]);
      const inLga = (item: any) => item.state === scope.state && item.city === scope.lga && !item.deleted;
      const scopedStaff = (users || []).filter((u: any) => inLga(u) && u.role === 'staff');
      const scopedListings = (listings || []).filter(inLga);
      setStats({ staff: scopedStaff.length, listings: scopedListings.length });
    }
    if (scope.state && scope.lga) load();
  }, [scope.state, scope.lga, refreshKey]);

  const tabs = [
    { id: 'overview' as HosTab, label: 'Overview', icon: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'staff' as HosTab, label: 'Staff', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { id: 'listings' as HosTab, label: 'Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10' },
    { id: 'announcements' as HosTab, label: 'Announce', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-6">
      <Toaster position="top-center" toastOptions={{ style: { background: '#1A1A24', color: '#fff', border: '1px solid #232330' } }} />

      {/* Header */}
      <header className="bg-gradient-to-r from-[#3B82F6] to-[#2563EB] px-5 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-white">Head of Staff Dashboard</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-[#3B82F6] bg-white/10 border-white/20">{ROLE_LABELS[profile.role as keyof typeof ROLE_LABELS] || profile.role}</span>
            </div>
            <p className="text-xs text-white/60">{scope.state} · {scope.lga}</p>
          </div>
          <div className="flex items-center gap-2">
            {onNavigate && (
              <button onClick={() => onNavigate('home')} className="h-8 px-3 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                Home
              </button>
            )}
            <button onClick={onLogout} className="h-8 px-3 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors">Logout</button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          {[
            { label: 'Staff in LGA', value: stats.staff },
            { label: 'Listings', value: stats.listings },
          ].map(s => (
            <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-[10px] text-white/60">{s.label}</div>
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
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium whitespace-nowrap rounded-lg transition-all ${
                  isActive ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-[#5C5E72] hover:text-[#8B8DA0]'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={tab.icon} /></svg>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pt-4">
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="glass rounded-2xl p-4 border border-[#3B82F6]/10">
              <p className="text-xs text-[#8A8B9C]">
                Managing {stats.staff} staff and {stats.listings} listings in {scope.state} · {scope.lga}
              </p>
              <p className="text-[10px] text-[#3B82F6]/70 mt-1">
                As Head of Staff, you manage staff and listings in your LGA. You cannot manage users or hotels.
              </p>
            </div>
          </div>
        )}
        {activeTab === 'staff' && <StaffTab scope={scope} profile={profile} refresh={refresh} />}
        {activeTab === 'listings' && <ListingsTab scope={scope} refresh={refresh} />}
        {activeTab === 'announcements' && <AnnouncementsTab profile={profile} scope={{ state: scope.state, lga: scope.lga }} />}
      </div>
    </div>
  );
}

// ─── STAFF TAB ─────────────────────────────────────
// Head of Staff can only see and manage staff in their LGA
function StaffTab({ scope, profile, refresh }: { scope: { state: string; lga: string }; profile: Profile; refresh: () => void }) {
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, [scope.state, scope.lga]);

  async function load() {
    setLoading(true);
    const { users } = await getAllUsers();
    // Only show staff in this LGA
    const filtered = (users || []).filter((u: any) => {
      const isStaffRole = u.role === 'staff' || u.role === 'user';
      const matchesState = u.state === scope.state;
      const matchesLga = u.city === scope.lga;
      return isStaffRole && matchesState && matchesLga && !u.deleted;
    });
    setStaff(filtered);
    setLoading(false);
  }

  async function handleRole(userId: string, newRole: string) {
    const target = staff.find(u => u.user_id === userId);
    if (!target) return;
    if (userId === profile.user_id) { toast.error('Cannot change own role'); return; }
    // Head of Staff can only toggle between user and staff
    if (newRole !== 'user' && newRole !== 'staff') {
      toast.error('You can only assign User or Staff roles');
      return;
    }
    const { error } = await updateUserRole(userId, newRole, target.role, profile.user_id, profile.email, target.email);
    if (error) { toast.error(error.message || 'Failed'); return; }
    await logAuditAction(profile.user_id, profile.email, 'update_role', 'user', userId, `Changed role from ${target.role} to ${newRole}`);
    const oldLabel = ROLE_LABELS[target.role as keyof typeof ROLE_LABELS] || target.role;
    const newLabel = ROLE_LABELS[newRole as keyof typeof ROLE_LABELS] || newRole;
    toast.success(`Role changed: ${oldLabel} → ${newLabel}`);
    load();
    refresh();
  }

  const filtered = staff.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff..." className="h-10 rounded-xl bg-[#1A1A24] border-[#232330] text-white" />
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No staff in this LGA</p> : filtered.map(u => (
            <div key={u.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">{(u.username || 'U').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">@{u.username || 'unknown'}</p>
                  <p className="text-[10px] text-[#5C5E72] truncate">{u.email}</p>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full border ${roleColors[u.role] || roleColors.user}`}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}</span>
              </div>
              {/* Role toggle */}
              <div className="mt-2 flex gap-2">
                <select
                  value={u.role}
                  onChange={(e) => handleRole(u.user_id, e.target.value)}
                  className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[10px] px-2 outline-none"
                >
                  <option value="user">{ROLE_LABELS.user}</option>
                  <option value="staff">{ROLE_LABELS.staff}</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LISTINGS TAB ──────────────────────────────────
function ListingsTab({ scope, refresh }: { scope: { state: string; lga: string }; refresh: () => void }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [scope.state, scope.lga]);

  async function load() {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    const filtered = (data || []).filter((l: any) => l.state === scope.state && l.city === scope.lga);
    setListings(filtered);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const { error } = await deleteListing(id);
    if (error) { toast.error('Failed'); return; }
    toast.success('Deleted');
    load();
    refresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {listings.length === 0 ? <p className="text-xs text-[#5C5E72] text-center py-6">No listings in your LGA</p> : listings.map(l => (
        <div key={l.id} className="glass rounded-xl p-3 flex items-center gap-3">
          <img src={l.images?.[0] || 'https://placehold.co/100x100/1A1A24/5C5E72?text=No+Image'} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{l.title}</p>
            <p className="text-[10px] text-[#5C5E72]">{l.city} · ₦{l.price?.toLocaleString()}/year</p>
          </div>
          <button onClick={() => handleDelete(l.id)} className="h-7 px-2 rounded-lg bg-red-500/10 text-red-400 text-[10px] hover:bg-red-500/20">Delete</button>
        </div>
      ))}
    </div>
  );
}
