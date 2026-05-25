import { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers, getUserCount, updateUserRole, deleteUser,
  getAllListingsAdmin, approveListing, deleteListing, getReports,
  resolveReport, dismissReport, getAuditLogs, getSystemSettings,
  updateSystemSetting, logAuditAction,
} from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Profile, Listing } from '@/types';
import { Toaster, toast } from 'sonner';

type AdminTab = 'overview' | 'users' | 'listings' | 'reports' | 'audit' | 'settings';

interface CreatorDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

export default function CreatorDashboard({ profile, onLogout }: CreatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'listings', label: 'Listings' },
    { id: 'reports', label: 'Reports' },
    { id: 'audit', label: 'Audit Log' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#0F1724] text-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#C8A45A] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1724" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold">Creator Dashboard</div>
              <div className="text-[10px] text-white/50">@{profile.username}</div>
            </div>
          </div>
          <button onClick={onLogout} className="text-xs text-white/50 hover:text-white">Logout</button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-white border-b border-[#e5e2dd] overflow-x-auto">
        <div className="flex max-w-lg mx-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-[70px] py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#C8A45A] text-[#C8A45A]'
                  : 'border-transparent text-[#8B8680]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-lg mx-auto px-5 py-4 pb-24">
        {activeTab === 'overview' && <OverviewTab profile={profile} />}
        {activeTab === 'users' && <UsersTab profile={profile} />}
        {activeTab === 'listings' && <ListingsAdminTab profile={profile} />}
        {activeTab === 'reports' && <ReportsTab profile={profile} />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'settings' && <SettingsTab profile={profile} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ profile }: { profile: Profile }) {
  const [stats, setStats] = useState({ users: 0, listings: 0, reports: 0, today: 0 });

  useEffect(() => {
    async function load() {
      const { total, today } = await getUserCount();
      const { listings } = await getAllListingsAdmin();
      const { reports } = await getReports();
      setStats({ users: total, listings: listings?.length || 0, reports: reports?.filter(r => r.status === 'pending').length || 0, today });
    }
    load();
  }, []);

  const cards = [
    { label: 'Total Users', value: stats.users, color: 'bg-[#0F1724]' },
    { label: 'Listings', value: stats.listings, color: 'bg-[#C8A45A]' },
    { label: 'Pending Reports', value: stats.reports, color: stats.reports > 0 ? 'bg-red-500' : 'bg-green-500' },
    { label: 'New Today', value: stats.today, color: 'bg-blue-500' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className={`${c.color} text-white rounded-2xl p-4`}>
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-[10px] opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Creator Info</h3>
        <div className="space-y-2">
          {[{ l: 'User ID', v: profile.user_id }, { l: 'Username', v: `@${profile.username}` }, { l: 'Email', v: profile.email }, { l: 'Role', v: profile.role }].map(i => (
            <div key={i.l} className="flex justify-between py-2 border-b border-[#f0eeea] last:border-0">
              <span className="text-xs text-[#8B8680]">{i.l}</span>
              <span className="text-xs font-medium text-[#0F1724]">{i.v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════
function UsersTab({ profile }: { profile: Profile }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { users: data } = await getAllUsers();
    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRole(userId: string, newRole: string) {
    await updateUserRole(userId, newRole);
    await logAuditAction(profile.user_id, profile.email, 'update_role', 'user', userId, `Changed role to ${newRole}`);
    toast.success('Role updated');
    load();
  }

  async function handleDelete(userId: string) {
    if (!confirm('Delete this user?')) return;
    await deleteUser(userId);
    await logAuditAction(profile.user_id, profile.email, 'delete_user', 'user', userId, 'User deleted');
    toast.success('User deleted');
    load();
  }

  const filtered = users.filter(u =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="h-10 rounded-xl text-sm" />

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-[#8B8680]">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</div>
          {filtered.map(u => (
            <div key={u.id} className="bg-white rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#0F1724] flex items-center justify-center text-[#C8A45A] text-xs font-bold">{(u.username || 'U').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">@{u.username || '...'}</div>
                  <div className="text-[10px] text-[#8B8680] truncate">{u.email}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <select value={u.role} onChange={(e) => handleRole(u.user_id, e.target.value)} className="flex-1 h-7 rounded-lg border border-[#e5e2dd] text-[10px] px-2 bg-white">
                  <option value="user">User</option>
                  <option value="student">Student</option>
                  <option value="landlord">Landlord</option>
                  <option value="agent">Agent</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                  <option value="creator_admin">Creator</option>
                </select>
                <button onClick={() => handleDelete(u.user_id)} className="h-7 px-2 rounded-lg border border-red-200 text-red-500 text-[10px]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// LISTINGS ADMIN TAB
// ═══════════════════════════════════════════════════
function ListingsAdminTab({ profile }: { profile: Profile }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { listings: data } = await getAllListingsAdmin();
    setListings(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id: string) {
    await approveListing(id);
    await logAuditAction(profile.user_id, profile.email, 'approve_listing', 'listing', id, 'Listing approved');
    toast.success('Listing approved');
    load();
  }

  async function handleDeleteL(id: string) {
    if (!confirm('Remove this listing?')) return;
    await deleteListing(id);
    await logAuditAction(profile.user_id, profile.email, 'delete_listing', 'listing', id, 'Listing removed');
    toast.success('Listing removed');
    load();
  }

  const filtered = filter === 'all' ? listings : listings.filter(l => l.availability_status === filter);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto">
        {['all', 'available', 'reserved', 'occupied', 'hidden'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 h-8 rounded-lg text-[10px] font-medium capitalize whitespace-nowrap ${filter === f ? 'bg-[#0F1724] text-white' : 'bg-white border border-[#e5e2dd] text-[#8B8680]'}`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(l => (
            <div key={l.id} className="bg-white rounded-xl p-3">
              <div className="flex gap-3">
                <img src={l.images?.[0] || 'https://placehold.co/80x80/e5e2dd/8B8680?text=No+Image'} alt="" className="w-16 h-16 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{l.title}</div>
                  <div className="text-[10px] text-[#C8A45A] font-bold">₦{l.price.toLocaleString()}</div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${l.availability_status === 'available' ? 'bg-green-100 text-green-700' : l.availability_status === 'occupied' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'}`}>{l.availability_status}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                {l.availability_status !== 'available' && (
                  <button onClick={() => handleApprove(l.id)} className="flex-1 h-7 rounded-lg bg-green-500 text-white text-[10px] font-medium">Approve</button>
                )}
                <button onClick={() => handleDeleteL(l.id)} className="flex-1 h-7 rounded-lg bg-red-500 text-white text-[10px] font-medium">Remove</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-10 text-xs text-[#8B8680]">No listings</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════════════════
function ReportsTab({ profile }: { profile: Profile }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { reports: data } = await getReports();
    setReports(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleResolve(id: string) {
    await resolveReport(id, profile.user_id);
    await logAuditAction(profile.user_id, profile.email, 'resolve_report', 'report', id, 'Report resolved');
    toast.success('Report resolved');
    load();
  }

  async function handleDismiss(id: string) {
    await dismissReport(id, profile.user_id);
    await logAuditAction(profile.user_id, profile.email, 'dismiss_report', 'report', id, 'Report dismissed');
    toast.success('Report dismissed');
    load();
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" /></div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#8B8680]">No reports</div>
      ) : (
        reports.map(r => (
          <div key={r.id} className="bg-white rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${r.status === 'pending' ? 'bg-amber-100 text-amber-700' : r.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
              <span className="text-[10px] text-[#8B8680]">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
            <p className="text-xs text-[#0F1724] font-medium mb-1">{r.reason}</p>
            <p className="text-[10px] text-[#8B8680] mb-3">Listing: {r.listing_id}</p>
            {r.status === 'pending' && (
              <div className="flex gap-2">
                <button onClick={() => handleResolve(r.id)} className="flex-1 h-8 rounded-lg bg-green-500 text-white text-[10px] font-medium">Resolve</button>
                <button onClick={() => handleDismiss(r.id)} className="flex-1 h-8 rounded-lg bg-gray-500 text-white text-[10px] font-medium">Dismiss</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// AUDIT TAB
// ═══════════════════════════════════════════════════
function AuditTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { logs: data } = await getAuditLogs();
      setLogs(data || []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-xs text-[#8B8680]">No audit logs</div>
      ) : (
        logs.map(l => (
          <div key={l.id} className="bg-white rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#0F1724] text-white">{l.action}</span>
              <span className="text-[10px] text-[#8B8680]">{new Date(l.created_at).toLocaleString()}</span>
            </div>
            <p className="text-xs text-[#0F1724]">{l.admin_email}</p>
            {l.details && <p className="text-[10px] text-[#8B8680]">{l.details}</p>}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════
function SettingsTab({ profile }: { profile: Profile }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { settings: data } = await getSystemSettings();
      const map: Record<string, string> = {};
      data?.forEach(s => { if (s.value) map[s.key] = s.value; });
      setSettings(map);
      setLoading(false);
    }
    load();
  }, []);

  async function handleUpdate(key: string, value: string) {
    await updateSystemSetting(key, value, profile.user_id);
    await logAuditAction(profile.user_id, profile.email, 'update_setting', 'setting', key, `Updated ${key} to ${value}`);
    toast.success('Setting updated');
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[#0F1724]">Platform Settings</h3>

        <div>
          <Label className="text-[10px] text-[#8B8680] mb-1 block">Platform Name</Label>
          <div className="flex gap-2">
            <Input value={settings['platform_name'] || 'WeHouse'} onChange={(e) => setSettings({ ...settings, platform_name: e.target.value })} className="h-10 rounded-xl text-sm flex-1" />
            <Button onClick={() => handleUpdate('platform_name', settings['platform_name'] || 'WeHouse')} className="h-10 px-4 rounded-xl bg-[#0F1724] text-white text-xs">Save</Button>
          </div>
        </div>

        <div>
          <Label className="text-[10px] text-[#8B8680] mb-1 block">Listing Approval Required</Label>
          <select
            value={settings['listing_approval_required'] || 'false'}
            onChange={(e) => { setSettings({ ...settings, listing_approval_required: e.target.value }); handleUpdate('listing_approval_required', e.target.value); }}
            className="w-full h-10 rounded-xl border border-[#e5e2dd] px-3 text-sm bg-white"
          >
            <option value="false">No — Listings go live immediately</option>
            <option value="true">Yes — Require approval before publishing</option>
          </select>
        </div>

        <div>
          <Label className="text-[10px] text-[#8B8680] mb-1 block">Default User Role</Label>
          <select
            value={settings['default_user_role'] || 'user'}
            onChange={(e) => { setSettings({ ...settings, default_user_role: e.target.value }); handleUpdate('default_user_role', e.target.value); }}
            className="w-full h-10 rounded-xl border border-[#e5e2dd] px-3 text-sm bg-white"
          >
            <option value="user">User</option>
            <option value="student">Student</option>
            <option value="landlord">Landlord</option>
          </select>
        </div>

        <div>
          <Label className="text-[10px] text-[#8B8680] mb-1 block">Maintenance Mode</Label>
          <select
            value={settings['maintenance_mode'] || 'false'}
            onChange={(e) => { setSettings({ ...settings, maintenance_mode: e.target.value }); handleUpdate('maintenance_mode', e.target.value); }}
            className="w-full h-10 rounded-xl border border-[#e5e2dd] px-3 text-sm bg-white"
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── LISTING FORM MODAL (kept from before) ────────
// (already defined above or imported)
// ═══════════════════════════════════════════════════
// RE-ADD MISSING: ListingFormModal + ListingsTab for creator's own listings
// ═══════════════════════════════════════════════════


