import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import UserProfileModal from '@/components/UserProfileModal';
import { AnnouncementsTab } from '@/components/AnnouncementsTab';
import StaffListTab from './StaffListTab';
import type { Profile } from '@/types';

type AdminTab = 'overview' | 'operations' | 'issues' | 'announcements';
type Operation = 'people' | 'staff' | 'listings' | 'workers' | 'bookings';
type Issue = 'reports' | 'support';
type PersonFilter = 'user' | 'property_partner';
type Props = { profile: Profile; onLogout: () => void; onNavigate?: (page: string) => void; onGoToChat?: (convId?: string) => void };

const TOP: Array<{ id: AdminTab; label: string; note: string }> = [
  { id: 'overview', label: 'Overview', note: 'Branch health and work that needs attention' },
  { id: 'operations', label: 'Operations', note: 'People, team, properties, workers and service bookings' },
  { id: 'issues', label: 'Issues', note: 'Listing reports and support conversations' },
  { id: 'announcements', label: 'Announcements', note: 'Branch communication' },
];

const OPERATIONS: Array<{ id: Operation; label: string; note: string }> = [
  { id: 'people', label: 'People', note: 'Regular users and Property Partners in this branch' },
  { id: 'staff', label: 'Staff', note: 'Staff assigned to this branch and their operational module' },
  { id: 'listings', label: 'Listings', note: 'Property listing approval and monitoring' },
  { id: 'workers', label: 'Workers', note: 'Worker accounts, verification status and evidence review' },
  { id: 'bookings', label: 'Service bookings', note: 'Worker-service bookings in this branch' },
];

export default function AdminDashboard({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [operation, setOperation] = useState<Operation>('people');
  const [issue, setIssue] = useState<Issue>('reports');
  const [stats, setStats] = useState<any>({ users: 0, workers: 0, partners: 0, staff: 0, listings: 0, pending_verifications: 0 });
  const [viewing, setViewing] = useState<Profile | null>(null);
  const branchReady = Boolean(profile.assigned_state && profile.assigned_lga);
  const current = TOP.find(item => item.id === tab)!;

  async function loadStats() {
    if (!branchReady) return;
    const { data, error } = await supabase.rpc('admin_get_my_branch_stats');
    if (error) return toast.error(error.message);
    setStats(data || {});
  }

  useEffect(() => { void loadStats(); }, [branchReady, profile.assigned_state, profile.assigned_lga]);

  function openOperation(next: Operation) {
    setOperation(next);
    setTab('operations');
  }

  return (
    <div className="min-h-[100dvh] bg-[#080A0F] pb-24 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#080A0F]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:pt-5 lg:px-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[.24em] text-indigo-400">WEHOUSE ADMIN · {profile.assigned_lga || 'UNASSIGNED'}</p>
              <h1 className="mt-1 text-lg font-bold sm:text-xl">{current.label}</h1>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#717487]">{current.note}{branchReady ? ` · ${profile.assigned_lga}, ${profile.assigned_state}` : ' · Branch assignment required'}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {onNavigate && <button onClick={() => onNavigate('profile')} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-[#A1A4B4]">Account</button>}
              <button onClick={onLogout} className="rounded-xl border border-red-500/15 bg-red-500/[0.05] px-3 py-2 text-[10px] text-red-300">Log out</button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto pb-3 scrollbar-hide">
            <div className="flex min-w-max gap-1">
              {TOP.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-xl px-3.5 py-2 text-[10px] font-semibold ${tab === item.id ? 'bg-indigo-500 text-white' : 'text-[#777A8C] hover:bg-white/[0.04] hover:text-white'}`}>{item.label}</button>)}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        {!branchReady ? <BranchMissing /> : <>
          {tab === 'overview' && <Overview stats={stats} profile={profile} openOperation={openOperation} openIssues={() => setTab('issues')} />}
          {tab === 'operations' && <Operations profile={profile} active={operation} setActive={setOperation} onView={setViewing} onRefreshStats={loadStats} />}
          {tab === 'issues' && <Issues active={issue} setActive={setIssue} onGoToChat={onGoToChat} />}
          {tab === 'announcements' && <AnnouncementsTab profile={profile} scope={{ state: profile.assigned_state!, lga: profile.assigned_lga! }} />}
        </>}
      </main>

      {viewing && <UserProfileModal user={viewing} adminProfile={profile} onClose={() => setViewing(null)} onPromote={() => { setViewing(null); openOperation('staff'); void loadStats(); }} onNavigate={onNavigate} onGoToChat={onGoToChat} />}
    </div>
  );
}

function Overview({ stats, profile, openOperation, openIssues }: { stats: any; profile: Profile; openOperation: (t: Operation) => void; openIssues: () => void }) {
  const cards: Array<[string, number, Operation, string]> = [
    ['Users', stats.users || 0, 'people', 'Regular users'],
    ['Property Partners', stats.partners || 0, 'people', 'Property owners'],
    ['Staff', stats.staff || 0, 'staff', 'Branch team'],
    ['Listings', stats.listings || 0, 'listings', 'Property inventory'],
    ['Workers', stats.workers || 0, 'workers', `${stats.pending_verifications || 0} awaiting review`],
  ];
  return <div className="space-y-5">
    <section className="rounded-3xl border border-indigo-500/15 bg-gradient-to-br from-indigo-500/[0.13] via-[#111522] to-[#0D1018] p-5 sm:p-6 lg:p-8">
      <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-[9px] font-semibold text-indigo-300">BRANCH AUTHORITY</span>
      <h2 className="mt-4 max-w-3xl text-2xl font-bold lg:text-3xl">{profile.assigned_lga}, {profile.assigned_state}</h2>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#9295A7]">This dashboard only manages the assigned branch. Platform-wide finance, global configuration and Creator controls are intentionally kept out.</p>
    </section>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map(([label, value, target, note]) => <button key={label} onClick={() => openOperation(target)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-indigo-500/25"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[9px] text-[#626678]">{note}</p></button>)}
    </section>
    <button onClick={openIssues} className="w-full rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-indigo-500/25"><p className="text-sm font-semibold">Issues</p><p className="mt-1 text-[10px] text-[#727587]">Open listing reports and branch support conversations.</p></button>
  </div>;
}

function Operations({ profile, active, setActive, onView, onRefreshStats }: { profile: Profile; active: Operation; setActive: (t: Operation) => void; onView: (p: Profile) => void; onRefreshStats: () => Promise<void> }) {
  const current = OPERATIONS.find(item => item.id === active)!;
  return <div className="space-y-5">
    <div><h2 className="text-lg font-bold">Branch operations</h2><p className="mt-1 text-[10px] text-[#707386]">Each operational responsibility has one clear home.</p></div>
    <div className="overflow-x-auto scrollbar-hide"><div className="flex min-w-max gap-1 rounded-2xl border border-white/[0.05] bg-[#0D1017] p-1">{OPERATIONS.map(item => <button key={item.id} onClick={() => setActive(item.id)} className={`rounded-xl px-3 py-2 text-[10px] font-semibold ${active === item.id ? 'bg-indigo-500 text-white' : 'text-[#777A8C] hover:text-white'}`}>{item.label}</button>)}</div></div>
    <div className="rounded-2xl border border-indigo-500/10 bg-indigo-500/[0.03] p-3"><p className="text-xs font-semibold">{current.label}</p><p className="mt-1 text-[9px] text-[#6E7183]">{current.note}</p></div>
    {active === 'people' && <People onView={onView} />}
    {active === 'staff' && <StaffListTab profile={profile} />}
    {active === 'listings' && <Listings onChanged={onRefreshStats} />}
    {active === 'workers' && <Workers onChanged={onRefreshStats} />}
    {active === 'bookings' && <Bookings />}
  </div>;
}

function People({ onView }: { onView: (p: Profile) => void }) {
  const [role, setRole] = useState<PersonFilter>('user');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { void load(); }, [role]);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: role });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  const filtered = useMemo(() => rows.filter(row => !search.trim() || [row.full_name, row.username, row.email, row.user_id].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())), [rows, search]);
  return <Section title="People" note="Workers are managed only in Workers; Staff are managed only in Staff.">
    <div className="flex flex-wrap gap-2">{([['user', 'Users'], ['property_partner', 'Property Partners']] as const).map(([id, label]) => <Chip key={id} active={role === id} onClick={() => setRole(id)}>{label}</Chip>)}</div>
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this branch" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-xs outline-none focus:border-indigo-500/40" />
    {loading ? <Loading /> : filtered.length === 0 ? <Empty title="No matching accounts" text="Nothing in this branch matches the current filter." /> : <Grid>{filtered.map(person => <button key={person.user_id} onClick={() => onView(person)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-indigo-500/25"><div className="flex items-center gap-3"><Avatar text={person.full_name || person.username || person.email} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.full_name || person.username || 'WeHouse account'}</p><p className="truncate text-[10px] text-[#6D7082]">{person.email}</p><p className="mt-1 text-[9px] capitalize text-[#535667]">{person.role?.replace(/_/g, ' ')}</p></div></div></button>)}</Grid>}
  </Section>;
}

function Listings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending_approval');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { requestAuth } = useAdminAuth();
  useEffect(() => { void load(); }, [filter]);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_my_branch_listings', { p_status: filter });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  function review(id: string, decision: 'approve' | 'reject') {
    requestAuth(async () => {
      if (decision === 'reject' && !reason.trim()) return toast.error('Enter a rejection reason');
      const { error } = await supabase.rpc('admin_review_my_branch_listing', { p_listing_id: id, p_decision: decision, p_reason: decision === 'reject' ? reason.trim() : null });
      if (error) return toast.error(error.message);
      toast.success(decision === 'approve' ? 'Listing approved' : 'Listing rejected');
      setRejectId(null); setReason(''); await load(); await onChanged();
    });
  }
  return <Section title="Listings" note="Review and monitor listings inside this branch only." right={<Select value={filter} onChange={setFilter} options={[['pending_approval', 'Pending'], ['available', 'Live'], ['rejected', 'Rejected'], ['all', 'All']]} />}>
    {loading ? <Loading /> : rows.length === 0 ? <Empty title="No listings" text="There are no listings for the selected status." /> : <Grid>{rows.map(row => <Card key={row.id}><Top title={row.title || 'Property'} sub={`${[row.city, row.state].filter(Boolean).join(', ')} · ${money(row.price)}`} status={row.status} />{row.status === 'pending_approval' && (rejectId === row.id ? <div className="mt-4 space-y-2"><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejection" className="w-full rounded-xl border border-white/[0.08] bg-[#171A23] p-3 text-xs" /><div className="flex gap-2"><Button secondary onClick={() => { setRejectId(null); setReason(''); }}>Cancel</Button><Button danger onClick={() => review(row.id, 'reject')}>Confirm rejection</Button></div></div> : <div className="mt-4 flex gap-2"><Button onClick={() => review(row.id, 'approve')}>Approve</Button><Button danger onClick={() => setRejectId(row.id)}>Reject</Button></div>)}</Card>)}</Grid>}
  </Section>;
}

function Workers({ onChanged }: { onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const { requestAuth } = useAdminAuth();
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: 'worker' });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  const shown = filter === 'all' ? rows : rows.filter(worker => worker.worker_status === filter);
  function review(id: string, decision: 'approve' | 'reject') {
    requestAuth(async () => {
      if (decision === 'reject' && !reason.trim()) return toast.error('Enter a rejection reason');
      const { error } = await supabase.rpc('admin_review_my_branch_worker', { p_worker_id: id, p_decision: decision, p_reason: decision === 'reject' ? reason.trim() : null });
      if (error) return toast.error(error.message);
      toast.success(decision === 'approve' ? 'Worker verified' : 'Worker rejected');
      setSelected(null); setReason(''); await load(); await onChanged();
    });
  }
  if (selected) return <Section title="Worker review" note="Worker identity, service details and submitted verification evidence."><button onClick={() => { setSelected(null); setReason(''); }} className="text-[10px] font-semibold text-indigo-400">← Back to workers</button><Card><Top title={selected.full_name || selected.username || 'Worker'} sub={`${selected.worker_occupation || 'Occupation not set'} · ${[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}`} status={selected.worker_status} /><div className="mt-4 grid gap-3 md:grid-cols-2">{selected.worker_gov_id_url ? <Evidence title="Government ID" url={selected.worker_gov_id_url} /> : <Missing label="Government ID" />}{selected.worker_video_url ? <Video title="Skill video" url={selected.worker_video_url} /> : <Missing label="Skill video" />}</div>{selected.worker_status === 'profile_under_review' && <div className="mt-4 space-y-2"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Rejection reason if rejecting" className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs" /><div className="flex gap-2"><Button onClick={() => review(selected.user_id, 'approve')}>Verify worker</Button><Button danger onClick={() => review(selected.user_id, 'reject')}>Reject</Button></div></div>}</Card></Section>;
  return <Section title="Workers" note="All worker account status and verification work lives here.">
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{[['all', 'All'], ['pending', 'Pending'], ['verification_paid', 'Verification paid'], ['profile_under_review', 'Under review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([id, label]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>{label}</Chip>)}</div>
    {loading ? <Loading /> : shown.length === 0 ? <Empty title="No workers" text="No workers match this status." /> : <Grid>{shown.map(worker => <button key={worker.user_id} onClick={() => setSelected(worker)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-indigo-500/25"><Top title={worker.full_name || worker.username || 'Worker'} sub={`${worker.worker_occupation || 'Occupation not set'} · ${[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}`} status={worker.worker_status} /><p className="mt-3 text-[9px] font-semibold text-indigo-400">OPEN WORKER →</p></button>)}</Grid>}
  </Section>;
}

function Bookings() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => { const { data, error } = await supabase.rpc('admin_get_my_branch_worker_bookings'); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); })(); }, []);
  return <Section title="Service bookings" note="Branch oversight for worker-service bookings. Booking execution remains with the customer and worker.">
    {loading ? <Loading /> : rows.length === 0 ? <Empty title="No service bookings" text="There are no worker-service bookings in this branch." /> : <div className="space-y-3">{rows.map(row => <Card key={row.id}><Top title={row.service_name || row.service || 'Service booking'} sub={`${row.booking_code || row.id} · ${dateText(row.created_at)}`} status={row.status || 'pending'} right={row.agreed_amount ? money(row.agreed_amount) : undefined} /></Card>)}</div>}
  </Section>;
}

function Issues({ active, setActive, onGoToChat }: { active: Issue; setActive: (t: Issue) => void; onGoToChat?: (id?: string) => void }) {
  return <div className="space-y-5"><div><h2 className="text-lg font-bold">Issues</h2><p className="mt-1 text-[10px] text-[#707386]">Branch problems are handled here instead of being mixed into operations.</p></div><div className="inline-flex rounded-xl border border-white/[0.06] bg-[#0D1017] p-1"><button onClick={() => setActive('reports')} className={`rounded-lg px-4 py-2 text-[10px] font-semibold ${active === 'reports' ? 'bg-indigo-500 text-white' : 'text-[#777A8C]'}`}>Reports</button><button onClick={() => setActive('support')} className={`rounded-lg px-4 py-2 text-[10px] font-semibold ${active === 'support' ? 'bg-indigo-500 text-white' : 'text-[#777A8C]'}`}>Support</button></div>{active === 'reports' ? <Reports /> : <Support onGoToChat={onGoToChat} />}</div>;
}

function Reports() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_reports'); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  useEffect(() => { void load(); }, []);
  async function act(id: string, action: 'resolved' | 'dismissed') { const { error } = await supabase.rpc('admin_resolve_my_branch_report', { p_report_id: id, p_action: action }); if (error) return toast.error(error.message); toast.success(action === 'resolved' ? 'Report resolved' : 'Report dismissed'); void load(); }
  return <Section title="Listing reports" note="Moderation reports linked to listings in this branch.">{loading ? <Loading /> : rows.length === 0 ? <Empty title="No reports" text="No listing reports require attention." /> : <div className="space-y-3">{rows.map(row => <Card key={row.id}><Top title={row.reason || 'Listing report'} sub={`${row.listing_id || 'Unknown listing'} · ${dateText(row.created_at)}`} status={row.status || 'pending'} />{row.status === 'pending' && <div className="mt-4 flex gap-2"><Button onClick={() => void act(row.id, 'resolved')}>Resolve</Button><Button secondary onClick={() => void act(row.id, 'dismissed')}>Dismiss</Button></div>}</Card>)}</div>}</Section>;
}

function Support({ onGoToChat }: { onGoToChat?: (id?: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => { const { data, error } = await supabase.rpc('admin_support_inbox'); if (error) toast.error(error.message); setRows(data || []); setLoading(false); })(); }, []);
  return <Section title="Support" note="Support conversations belonging to this branch.">{loading ? <Loading /> : rows.length === 0 ? <Empty title="No support conversations" text="There are no branch support conversations." /> : <div className="space-y-3">{rows.map(row => <button key={row.id} onClick={() => onGoToChat?.(row.id)} className="w-full rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-indigo-500/25"><Top title={row.subject || row.user_name || 'Support conversation'} sub={`${row.user_email || row.participant_a || ''}${row.last_message ? ` · ${row.last_message}` : ''}`} status={row.status || 'open'} /><p className="mt-3 text-[9px] font-semibold text-indigo-400">OPEN CONVERSATION →</p></button>)}</div>}</Section>;
}

function BranchMissing() { return <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.05] p-8 text-center"><p className="text-sm font-semibold text-amber-300">Branch assignment required</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#777B8D]">Creator must assign this Admin to a state and LGA before branch operations become available.</p></div>; }
function Section({ title, note, right, children }: { title: string; note: string; right?: React.ReactNode; children: React.ReactNode }) { return <div className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-base font-bold">{title}</h3><p className="mt-1 text-[10px] text-[#707386]">{note}</p></div>{right}</div>{children}</div>; }
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>; }
function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">{children}</div>; }
function Top({ title, sub, status, right }: { title: string; sub: string; status: string; right?: string }) { return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#707386]">{sub}</p></div><div className="shrink-0 text-right">{right && <p className="mb-1 text-sm font-bold">{right}</p>}<Badge value={status} /></div></div>; }
function Badge({ value }: { value: string }) { const text = String(value || 'unknown').toLowerCase(); const good = ['available', 'active', 'approved', 'completed', 'resolved', 'verified', 'paid'].some(x => text.includes(x)); const bad = ['rejected', 'suspended', 'failed', 'cancelled'].some(x => text.includes(x)); return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{text.replace(/_/g, ' ')}</span>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-semibold ${active ? 'bg-indigo-500 text-white' : 'border border-white/[0.06] bg-[#10131B] text-[#777A8C]'}`}>{children}</button>; }
function Button({ children, onClick, danger, secondary }: { children: React.ReactNode; onClick: () => void; danger?: boolean; secondary?: boolean }) { return <button onClick={onClick} className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger ? 'border border-red-500/20 bg-red-500/10 text-red-300' : secondary ? 'border border-white/[0.08] bg-white/[0.04] text-[#A7A9B6]' : 'bg-indigo-500 text-white'}`}>{children}</button>; }
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[][] }) { return <select value={value} onChange={e => onChange(e.target.value)} className="h-10 rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-[10px] text-white outline-none">{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>; }
function Avatar({ text }: { text: string }) { return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold">{(text || 'W')[0].toUpperCase()}</div>; }
function Evidence({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6E7183]">{title}</p><img src={url} alt={title} className="max-h-60 w-full rounded-xl bg-[#161922] object-contain" /></div>; }
function Video({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6E7183]">{title}</p><video src={url} controls className="max-h-60 w-full rounded-xl bg-[#161922]" /></div>; }
function Missing({ label }: { label: string }) { return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-[10px] text-red-300">No {label} uploaded</div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#66697B]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>; }
function money(value: any) { return `₦${Number(value || 0).toLocaleString('en-NG')}`; }
function dateText(value: any) { if (!value) return 'Date unavailable'; try { return new Date(value).toLocaleDateString(); } catch { return String(value); } }
