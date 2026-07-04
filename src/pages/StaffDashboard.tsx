import { useState, useEffect } from 'react';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import { supabase, getInspectionRequestsForFieldOfficer } from '@/lib/supabase';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import SettingsTab from './SettingsTab';
import type { Profile, StaffPermission, SupportTicket, Payout, CommissionRule } from '@/types';
import { STAFF_PERMISSION_LABELS, TICKET_TYPE_LABELS, TICKET_STATUS_COLORS, TICKET_PRIORITY_COLORS } from '@/types';
import type { TicketStatus } from '@/types';
import { Toaster, toast } from 'sonner';

interface StaffDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onGoToChat: (convId?: string) => void;
  onNavigate?: (page: string) => void;
}

type StaffTab = 'overview' | 'operations' | 'finance' | 'support' | 'verification' | 'field_officer' | 'settings';

export default function StaffDashboard({ profile, onGoToChat, onNavigate }: StaffDashboardProps) {
  const { permissions, loading: permsLoading, hasPermission } = useStaffPermissions(profile.user_id);
  const TAB_KEY = 'wh_staff_tab';
  const [activeTab, setActiveTab] = useState<StaffTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      // Only restore if the saved tab is valid for this staff's permissions
      if (saved && (
        saved === 'overview' || saved === 'settings' ||
        (saved === 'operations' && hasPermission('operations')) ||
        (saved === 'finance' && hasPermission('finance')) ||
        (saved === 'support' && hasPermission('support')) ||
        (saved === 'verification' && hasPermission('verification')) ||
        (saved === 'field_officer' && hasPermission('field_officer'))
      )) {
        return saved as StaffTab;
      }
    } catch { /* ignore */ }
    return 'overview';
  });

  const handleSetTab = (tab: StaffTab) => {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  };

  // Determine available tabs based on permissions
  const availableTabs: StaffTab[] = ['overview'];
  if (hasPermission('operations')) availableTabs.push('operations');
  if (hasPermission('finance')) availableTabs.push('finance');
  if (hasPermission('support')) availableTabs.push('support');
  if (hasPermission('verification')) availableTabs.push('verification');
  if (hasPermission('field_officer')) availableTabs.push('field_officer');
  availableTabs.push('settings'); // Settings available to all staff

  if (permsLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Home button */}
            <button
              onClick={() => onNavigate?.('home')}
              className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white transition-colors"
              title="Go to Home"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-white">
                {permissions.length > 0
                  ? permissions.map(p => STAFF_PERMISSION_LABELS[p]).join(' + ')
                  : 'Staff'}
              </h1>
              <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Module Navigation */}
      <nav className="flex gap-1 px-5 py-3 border-b border-white/[0.04] overflow-x-auto scrollbar-hide">
        {availableTabs.map(tab => (
          <button
            key={tab}
            onClick={() => handleSetTab(tab)}
            className={`flex-shrink-0 h-9 px-4 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap ${
              activeTab === tab
                ? 'bg-[#3B82F6] text-white'
                : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            {tab === 'overview' ? 'Overview' : tab === 'settings' ? 'Settings' : STAFF_PERMISSION_LABELS[tab as StaffPermission]}
          </button>
        ))}
      </nav>

      {/* Module Content */}
      <main className="px-5 py-4">
        {activeTab === 'overview' && <OverviewModule profile={profile} permissions={permissions} onGoToChat={onGoToChat} />}
        {activeTab === 'operations' && <OperationsModule profile={profile} />}
        {activeTab === 'finance' && <FinanceModule />}
        {activeTab === 'support' && <SupportModule profile={profile} />}
        {activeTab === 'verification' && <VerificationModule onGoToChat={onGoToChat} />}
        {activeTab === 'field_officer' && <FieldOfficerModule profile={profile} />}
        {activeTab === 'settings' && <SettingsTab profile={profile} onUpdate={(_p) => {}} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW MODULE
// ═══════════════════════════════════════════════════════════════

function OverviewModule({ profile, permissions }: { profile: Profile; permissions: StaffPermission[]; onGoToChat?: (convId?: string) => void }) {
  const [stats, setStats] = useState({ tickets: 0, inspections: 0, listings: 0, workers: 0, messages: 0 });
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const promises = [];
      if (permissions.includes('support')) promises.push(supabase.from('support_tickets').select('*', { count: 'exact', head: true }).eq('status', 'open'));
      if (permissions.includes('field_officer')) promises.push(supabase.from('inspections').select('*', { count: 'exact', head: true }).eq('field_officer_id', profile.user_id).eq('status', 'scheduled'));
      if (permissions.includes('operations')) promises.push(supabase.from('listings').select('*', { count: 'exact', head: true }).is('deleted_at', null));
      if (permissions.includes('verification')) promises.push(supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending'));
      promises.push(supabase.from('conversations').select('*', { count: 'exact', head: true }));

      const results = await Promise.all(promises);
      let idx = 0;
      const s = { tickets: 0, inspections: 0, listings: 0, workers: 0, messages: results[results.length - 1]?.count || 0 };
      if (permissions.includes('support')) s.tickets = results[idx++]?.count || 0;
      if (permissions.includes('field_officer')) s.inspections = results[idx++]?.count || 0;
      if (permissions.includes('operations')) s.listings = results[idx++]?.count || 0;
      if (permissions.includes('verification')) s.workers = results[idx++]?.count || 0;
      setStats(s);

      // Load recent activity
      const { data: acts } = await supabase
        .from('staff_activity_log')
        .select('*')
        .eq('staff_id', profile.user_id)
        .order('created_at', { ascending: false })
        .limit(10);
      setActivities(acts || []);
    }
    load();
  }, [profile.user_id, permissions]);

  return (
    <div className="space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        {permissions.includes('support') && stats.tickets > 0 && (
          <div className="rounded-2xl bg-red-500/5 border border-red-500/10 p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{stats.tickets}</p>
            <p className="text-[10px] text-[#5C5E72]">Open Tickets</p>
          </div>
        )}
        {permissions.includes('field_officer') && stats.inspections > 0 && (
          <div className="rounded-2xl bg-amber-500/5 border border-amber-500/10 p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{stats.inspections}</p>
            <p className="text-[10px] text-[#5C5E72]">Pending Inspections</p>
          </div>
        )}
        {permissions.includes('operations') && (
          <div className="rounded-2xl bg-blue-500/5 border border-blue-500/10 p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{stats.listings}</p>
            <p className="text-[10px] text-[#5C5E72]">Listings</p>
          </div>
        )}
        {permissions.includes('verification') && (
          <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/10 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{stats.workers}</p>
            <p className="text-[10px] text-[#5C5E72]">Pending Workers</p>
          </div>
        )}
      </div>

      {/* My Modules */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">My Modules</h3>
        <div className="grid grid-cols-2 gap-3">
          {permissions.map(perm => (
            <div key={perm} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
              <p className="text-sm font-semibold text-white">{STAFF_PERMISSION_LABELS[perm]}</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">Active permission</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Recent Activity</h3>
        {activities.length === 0 ? (
          <div className="text-center py-6 text-[#5C5E72] text-sm">No recent activity</div>
        ) : (
          activities.map(a => (
            <div key={a.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                <p className="text-[11px] text-white flex-1">{a.action}</p>
                <span className="text-[9px] text-[#5C5E72]">{new Date(a.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OPERATIONS MODULE
// ═══════════════════════════════════════════════════════════════

function OperationsModule({ profile }: { profile: Profile }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    loadListings();
  }, [statusFilter]);

  async function loadListings() {
    setLoading(true);
    let query = supabase.from('listings').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data } = await query.limit(50);
    setListings(data || []);
    setLoading(false);
  }

  async function approveListing(id: string) {
    const { error } = await supabase.from('listings').update({ status: 'available', approved_by: profile.user_id, approved_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error('Failed: ' + error.message);
    else { toast.success('Listing approved'); loadListings(); }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Property Management</h3>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] px-2">
          <option value="all">All</option>
          <option value="available">Available</option>
          <option value="reserved">Reserved</option>
          <option value="pending_approval">Pending</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No listings found</div>
      ) : (
        listings.map(l => (
          <div key={l.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{l.title}</p>
                <p className="text-[10px] text-[#5C5E72]">{l.city}, {l.state} &middot; {l.bedrooms} bed &middot; N{l.price?.toLocaleString()}</p>
              </div>
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                l.status === 'available' ? 'bg-emerald-500/10 text-emerald-400' :
                l.status === 'reserved' ? 'bg-amber-500/10 text-amber-400' :
                l.status === 'pending_approval' ? 'bg-blue-500/10 text-blue-400' :
                'bg-gray-500/10 text-gray-400'
              }`}>{l.status}</span>
            </div>
            {l.status === 'pending_approval' && (
              <div className="mt-3">
                {rejectingId === l.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection..."
                      rows={2}
                      className="w-full rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 placeholder:text-[#5C5E72] outline-none focus:border-red-500 resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="flex-1 h-8 rounded-lg bg-[#1A1A24] text-[#5C5E72] text-[11px]">Cancel</button>
                      <button
                        onClick={() => {
                          if (!rejectReason.trim()) return;
                          supabase.from('listings').update({ status: 'rejected', rejection_reason: rejectReason }).eq('id', l.id).then(() => {
                            toast.success('Rejected'); setRejectingId(null); setRejectReason(''); loadListings();
                          });
                        }}
                        className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold"
                      >
                        Confirm Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => approveListing(l.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Approve</button>
                    <button onClick={() => setRejectingId(l.id)} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold">Reject</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FINANCE MODULE
// ═══════════════════════════════════════════════════════════════

function FinanceModule() {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'payouts' | 'rules'>('overview');
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [_loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from('payouts').select('*, property_owners(full_name)').order('created_at', { ascending: false }).limit(20),
        supabase.from('commission_rules').select('*').eq('is_active', true).order('rule_type'),
      ]);
      setPayouts(p || []);
      setRules(r || []);
      setLoading(false);
    }
    load();
  }, []);

  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(['overview', 'payouts', 'rules'] as const).map(t => (
          <button key={t} onClick={() => setActiveSubTab(t)} className={`flex-1 h-8 rounded-lg text-[11px] font-semibold ${activeSubTab === t ? 'bg-emerald-500 text-white' : 'text-[#5C5E72]'}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeSubTab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/10 p-4 text-center">
              <p className="text-xl font-bold text-emerald-400">N{totalPaid.toLocaleString()}</p>
              <p className="text-[9px] text-[#5C5E72]">Total Paid Out</p>
            </div>
            <div className="rounded-2xl bg-amber-500/5 border border-amber-500/10 p-4 text-center">
              <p className="text-xl font-bold text-amber-400">N{totalPending.toLocaleString()}</p>
              <p className="text-[9px] text-[#5C5E72]">Pending Payouts</p>
            </div>
          </div>
          <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-sm font-semibold text-white mb-2">Commission Rules ({rules.length})</p>
            {rules.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <span className="text-[11px] text-[#8A8B9C]">{r.name}</span>
                <span className="text-[11px] text-emerald-400">{r.percentage ? `${r.percentage}%` : `N${r.flat_amount?.toLocaleString()}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSubTab === 'payouts' && (
        <div className="space-y-3">
          {payouts.length === 0 ? (
            <div className="text-center py-10 text-[#5C5E72] text-sm">No payouts yet</div>
          ) : payouts.map(p => (
            <div key={p.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{(p as any).property_owners?.full_name || 'Unknown'}</p>
                  <p className="text-[10px] text-[#5C5E72]">{p.period_start} to {p.period_end}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-white">N{p.amount.toLocaleString()}</p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                    p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' :
                    p.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>{p.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeSubTab === 'rules' && (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="text-center py-10 text-[#5C5E72] text-sm">No commission rules set</div>
          ) : rules.map(r => (
            <div key={r.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
              <p className="text-sm font-semibold text-white">{r.name}</p>
              <p className="text-[10px] text-[#5C5E72]">{r.description}</p>
              <div className="flex gap-4 mt-2 text-[10px] text-[#5C5E72]">
                <span>Type: {r.rule_type}</span>
                <span>{r.percentage ? `${r.percentage}%` : `N${r.flat_amount}`}</span>
                <span>Min: N{r.min_amount}</span>
                <span>Max: N{r.max_amount}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT MODULE
// ═══════════════════════════════════════════════════════════════

function SupportModule({ profile }: { profile: Profile }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');

  useEffect(() => {
    loadTickets();
  }, [statusFilter]);

  async function loadTickets() {
    setLoading(true);
    let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data } = await query.limit(30);
    setTickets(data || []);
    setLoading(false);
  }

  async function assignTicket(ticketId: string) {
    const { error } = await supabase.from('support_tickets').update({ assigned_to: profile.user_id, status: 'in_progress' }).eq('id', ticketId);
    if (error) toast.error('Failed: ' + error.message);
    else { toast.success('Ticket assigned to you'); loadTickets(); }
  }

  async function resolveTicket(ticketId: string) {
    if (!resolveNotes.trim()) { toast.error('Enter resolution notes'); return; }
    const { error } = await supabase.from('support_tickets').update({
      status: 'resolved', resolution_notes: resolveNotes, resolved_at: new Date().toISOString(), resolved_by: profile.user_id
    }).eq('id', ticketId);
    if (error) toast.error('Failed: ' + error.message);
    else { toast.success('Ticket resolved'); setResolvingId(null); setResolveNotes(''); loadTickets(); }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Support Tickets ({tickets.length})</h3>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | 'all')} className="h-8 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] px-2">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      {tickets.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No tickets</div>
      ) : (
        tickets.map(t => (
          <div key={t.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{t.subject}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${TICKET_STATUS_COLORS[t.status]}`}>{t.status}</span>
                </div>
                <p className="text-[10px] text-[#5C5E72] mt-1">{t.ticket_code} &middot; {TICKET_TYPE_LABELS[t.type]} &middot; <span className={TICKET_PRIORITY_COLORS[t.priority]}>{t.priority}</span></p>
                <p className="text-[11px] text-[#8A8B9C] mt-2">{t.description}</p>
                <p className="text-[9px] text-[#5C5E72] mt-1">{t.customer_email} &middot; {new Date(t.created_at).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="mt-3">
              {resolvingId === t.id ? (
                <div className="space-y-2">
                  <textarea
                    value={resolveNotes}
                    onChange={e => setResolveNotes(e.target.value)}
                    placeholder="How was this resolved?"
                    rows={2}
                    className="w-full rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6] resize-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setResolvingId(null); setResolveNotes(''); }} className="flex-1 h-8 rounded-lg bg-[#1A1A24] text-[#5C5E72] text-[11px]">Cancel</button>
                    <button onClick={() => resolveTicket(t.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Submit</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {t.status === 'open' && (
                    <button onClick={() => assignTicket(t.id)} className="flex-1 h-8 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[11px] font-semibold">Assign to Me</button>
                  )}
                  {t.status === 'in_progress' && t.assigned_to === profile.user_id && (
                    <button onClick={() => setResolvingId(t.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Resolve</button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VERIFICATION MODULE
// ═══════════════════════════════════════════════════════════════

function VerificationModule({ onGoToChat }: { onGoToChat?: (convId: string) => void }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'verified' | 'suspended' | 'all'>('pending');

  useEffect(() => {
    loadWorkers();
  }, [filter]);

  async function loadWorkers() {
    setLoading(true);
    let query = supabase.from('profiles').select('*').eq('role', 'worker');
    if (filter !== 'all') query = query.eq('worker_status', filter);
    const { data } = await query.order('created_at', { ascending: false });
    setWorkers(data || []);
    setLoading(false);
  }

  async function updateStatus(userId: string, status: 'verified' | 'suspended' | 'rejected') {
    const { error } = await supabase.from('profiles').update({ worker_status: status, worker_verified: status === 'verified' }).eq('user_id', userId);
    if (error) toast.error('Failed: ' + error.message);
    else { toast.success(`Worker ${status}`); loadWorkers(); }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(['pending', 'verified', 'suspended', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`flex-1 h-8 rounded-lg text-[11px] font-semibold ${filter === f ? 'bg-[#3B82F6] text-white' : 'text-[#5C5E72]'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {workers.length === 0 ? (
        <div className="text-center py-10 text-[#5C5E72] text-sm">No {filter} workers</div>
      ) : (
        workers.map(w => (
          <div key={w.user_id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1A1A24] flex items-center justify-center text-sm font-bold text-[#5C5E72]">
                {(w.full_name || w.username || w.email)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{w.full_name || w.username || 'Unnamed'}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${
                    w.worker_status === 'verified' ? 'bg-emerald-500/10 text-emerald-400' :
                    w.worker_status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>{w.worker_status}</span>
                </div>
                <p className="text-[10px] text-[#5C5E72]">{w.worker_occupation || 'No occupation'} &middot; {w.city || 'No location'}</p>
                {w.worker_bio && <p className="text-[10px] text-[#8A8B9C] mt-1">{w.worker_bio}</p>}
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={async () => {
                  const { data: conv } = await supabase.rpc('start_worker_verification_chat', { p_worker_id: w.user_id });
                  if (conv && onGoToChat) onGoToChat(conv.id);
                }}
                className="flex-1 h-8 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20 text-[11px] font-semibold"
              >
                Message Worker
              </button>
              {w.worker_status !== 'verified' && (
                <button onClick={() => updateStatus(w.user_id, 'verified')} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Verify</button>
              )}
              {w.worker_status !== 'suspended' && (
                <button onClick={() => updateStatus(w.user_id, 'suspended')} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold">Suspend</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FIELD OFFICER MODULE
// ═══════════════════════════════════════════════════════════════

function FieldOfficerModule({ profile }: { profile: Profile }) {
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [report, setReport] = useState('');
  const [condition, setCondition] = useState<'excellent' | 'good' | 'fair' | 'poor'>('good');
  // Post listing form state
  const [showPostForm, setShowPostForm] = useState(false);
  const [postSaving, setPostSaving] = useState(false);
  const [postImages, setPostImages] = useState<string[]>([]);
  const [uploadingPostImage, setUploadingPostImage] = useState(false);
  const [postForm, setPostForm] = useState({
    title: '', description: '', price: '', address: '', state: '', city: '',
    bedrooms: '1', bathrooms: '1', propertyType: 'apartment', contactPhone: '',
  });

  useEffect(() => {
    loadInspections();
  }, []);

  async function loadInspections() {
    setLoading(true);
    const { inspections: data } = await getInspectionRequestsForFieldOfficer(profile.user_id);
    setInspections(data || []);
    setLoading(false);
  }

  async function startInspection(id: string, source?: string) {
    // Try user_inspection_requests first, then inspection_requests
    const table = source === 'partner' ? 'inspection_requests' : 'user_inspection_requests';
    const { error } = await supabase.from(table).update({
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Inspection started');
    loadInspections();
  }

  async function completeInspection(id: string, source?: string) {
    if (!report.trim()) { toast.error('Enter a report'); return; }
    const table = source === 'partner' ? 'inspection_requests' : 'user_inspection_requests';
    // Different tables have different column names
    const updates: Record<string, any> = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (table === 'inspection_requests') {
      // inspection_requests uses 'notes' column (no 'report' or 'condition')
      updates.notes = `Condition: ${condition}\n\nReport: ${report}`;
    } else {
      // user_inspection_requests has 'report' and 'condition' columns
      updates.report = report;
      updates.condition = condition;
    }
    const { error } = await supabase.from(table).update(updates).eq('id', id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Inspection completed');
    setCompletingId(null);
    setReport('');
    loadInspections();
  }

  async function submitPostListing() {
    if (!postForm.title.trim() || !postForm.price || !postForm.address || !postForm.state || !postForm.city) {
      toast.error('Title, price, address, state and city are required'); return;
    }
    setPostSaving(true);
    const { error } = await supabase.from('listings').insert({
      title: postForm.title.trim(),
      description: postForm.description.trim() || null,
      price: parseInt(postForm.price) || 0,
      currency: 'NGN',
      state: postForm.state,
      city: postForm.city,
      address: postForm.address.trim(),
      bedrooms: parseInt(postForm.bedrooms) || 1,
      bathrooms: parseInt(postForm.bathrooms) || 1,
      property_type: 'apartment',
      sub_type: postForm.propertyType as any,
      images: postImages,
      contact_phone: postForm.contactPhone.trim() || null,
      status: 'pending_approval',
      submitted_by_role: 'staff',
      owner_id: profile.user_id,
      availability_status: 'available',
      listing_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setPostSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Property submitted for approval');
    setShowPostForm(false);
    setPostForm({ title: '', description: '', price: '', address: '', state: '', city: '', bedrooms: '1', bathrooms: '1', propertyType: 'apartment', contactPhone: '' });
    setPostImages([]);
  }

  async function uploadPostImage(file: File) {
    setUploadingPostImage(true);
    const path = `field_officer/${profile.user_id}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('listing-images').upload(path, file, { contentType: file.type });
    if (error) { toast.error('Upload failed'); setUploadingPostImage(false); return; }
    const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
    setPostImages(prev => [...prev, data.publicUrl]);
    setUploadingPostImage(false);
    toast.success('Image uploaded');
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Inspection Checklist */}
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <h4 className="text-sm font-semibold text-white mb-3">Inspection Checklist</h4>
        {[
          'Verify property photos match actual location',
          'Check amenities are as listed',
          'Confirm price with landlord',
          'Document property condition',
          'Take geotagged photos',
          'Verify security of the area',
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
            <div className="w-5 h-5 rounded border-2 border-[#232330]" />
            <span className="text-[11px] text-[#8A8B9C]">{item}</span>
          </div>
        ))}
      </div>

      {/* Post Listing Button */}
      <button
        onClick={() => setShowPostForm(true)}
        className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        Post a Property
      </button>

      {/* Post Listing Form Modal */}
      {showPostForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowPostForm(false)}>
          <div className="bg-[#12121A] rounded-t-2xl sm:rounded-2xl border border-[#2A2A3A] w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-[#12121A] border-b border-[#2A2A3A] px-5 py-3 flex items-center justify-between z-10">
              <p className="text-sm font-semibold text-white">Post Property</p>
              <button onClick={() => setShowPostForm(false)} className="w-7 h-7 rounded-full bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-[11px] text-[#5C5E72]">Fill in the property details. It will be reviewed before going public.</p>

              {/* Title */}
              <div>
                <label className="text-[11px] text-[#8A8B9C] mb-1 block">Property Title *</label>
                <input value={postForm.title} onChange={e => setPostForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. 3 Bedroom Apartment in Lekki"
                  className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] text-[#8A8B9C] mb-1 block">Description</label>
                <textarea value={postForm.description} onChange={e => setPostForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the property..."
                  rows={3}
                  className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 py-2 outline-none focus:border-[#3B82F6] resize-none" />
              </div>

              {/* Price + Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">Price (NGN) *</label>
                  <input value={postForm.price} onChange={e => setPostForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="e.g. 500000" type="text" inputMode="numeric"
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
                </div>
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">Type</label>
                  <select value={postForm.propertyType} onChange={e => setPostForm(f => ({ ...f, propertyType: e.target.value }))}
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                    <option value="short_let">Short Let</option>
                    <option value="long_stay">Long Stay</option>
                  </select>
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="text-[11px] text-[#8A8B9C] mb-1 block">Address *</label>
                <input value={postForm.address} onChange={e => setPostForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. 15 Admiralty Way, Lekki Phase 1"
                  className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
              </div>

              {/* State + City */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">State *</label>
                  <select value={postForm.state} onChange={e => setPostForm(f => ({ ...f, state: e.target.value, city: '' }))}
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                    <option value="">Select</option>
                    {NIGERIA_STATES.map(s => <option key={s.state} value={s.state}>{s.state}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">City *</label>
                  <select value={postForm.city} onChange={e => setPostForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                    <option value="">Select</option>
                    {getCitiesForState(postForm.state).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Bedrooms + Bathrooms */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">Beds</label>
                  <select value={postForm.bedrooms} onChange={e => setPostForm(f => ({ ...f, bedrooms: e.target.value }))}
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">Baths</label>
                  <select value={postForm.bathrooms} onChange={e => setPostForm(f => ({ ...f, bathrooms: e.target.value }))}
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#8A8B9C] mb-1 block">Phone</label>
                  <input value={postForm.contactPhone} onChange={e => setPostForm(f => ({ ...f, contactPhone: e.target.value }))}
                    placeholder="+234..."
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
                </div>
              </div>

              {/* Image Upload */}
              <div>
                <label className="text-[11px] text-[#8A8B9C] mb-1 block">Property Images</label>
                <div className="flex flex-wrap gap-2">
                  {postImages.map((img, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => setPostImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-0 right-0 w-5 h-5 bg-red-500 rounded-bl-lg flex items-center justify-center text-white text-[9px]">&times;</button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-[#232330] flex items-center justify-center cursor-pointer hover:border-[#3B82F6] transition-colors">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPostImage(f); e.currentTarget.value = ''; }} />
                  </label>
                  {uploadingPostImage && <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
                </div>
              </div>

              {/* Submit */}
              <button onClick={submitPostListing} disabled={postSaving}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                {postSaving ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspections List */}
      <h4 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">My Inspections ({inspections.length})</h4>
      {inspections.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-[#5C5E72]">No inspections assigned</p>
          <p className="text-[10px] text-[#5C5E72] mt-1">Inspections assigned by the creator will appear here</p>
        </div>
      ) : (
        inspections.map(ins => (
          <div key={ins.id} className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{ins.listings?.title || 'Property Inspection'}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${
                    ins.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                    ins.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' :
                    ins.status === 'scheduled' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>{ins.status}</span>
                </div>
                <p className="text-[10px] text-[#5C5E72]">{ins.listings?.address || ins.address || 'No address'}, {ins.listings?.city || ins.city || ''}</p>
                <p className="text-[9px] text-[#5C5E72]">Code: {ins.inspection_code || ins.id?.slice(0, 8)} &middot; Scheduled: {ins.scheduled_date ? new Date(ins.scheduled_date).toLocaleDateString() : 'Not set'}</p>
                {ins.contact_name && <p className="text-[9px] text-[#5C5E72]">Contact: {ins.contact_name} {ins.contact_phone && `· ${ins.contact_phone}`}</p>}
              </div>
            </div>

            {/* Complete Form */}
            {completingId === ins.id ? (
              <div className="mt-3 space-y-2">
                <textarea
                  value={report}
                  onChange={e => setReport(e.target.value)}
                  placeholder="Describe what you found during the inspection..."
                  rows={3}
                  className="w-full rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6] resize-none"
                />
                <select
                  value={condition}
                  onChange={e => setCondition(e.target.value as any)}
                  className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 outline-none focus:border-[#3B82F6]"
                >
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={() => { setCompletingId(null); setReport(''); }} className="flex-1 h-8 rounded-lg bg-[#1A1A24] text-[#5C5E72] text-[11px]">Cancel</button>
                  <button onClick={() => completeInspection(ins.id, ins._source)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Submit Report</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-3">
                {ins.status === 'scheduled' && (
                  <button onClick={() => startInspection(ins.id, ins._source)} className="flex-1 h-8 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[11px] font-semibold">Start</button>
                )}
                {ins.status === 'in_progress' && (
                  <button onClick={() => setCompletingId(ins.id)} className="flex-1 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">Complete</button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── LOADING SPINNER ───────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
