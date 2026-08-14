import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import UserProfileModal from '@/components/UserProfileModal';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import WorkerReviewIdentityStatus from '@/components/WorkerReviewIdentityStatus';
import StaffListTab from './StaffListTab';
import CreatorSettingsTab from './CreatorSettingsTab';
import AnalyticsPage from './AnalyticsPage';
import DomainSettingsPanel from '@/components/DomainSettingsPanel';
import ServiceCategoryManager from '@/components/ServiceCategoryManager';
import PropertyTypeManager from '@/components/PropertyTypeManager';
import type { Profile } from '@/types';

type Tab = 'overview' | 'operations' | 'communications' | 'finance' | 'analytics' | 'settings';
type Operation = 'people' | 'team' | 'properties' | 'workers' | 'bookings' | 'issues';
type PersonRole = 'user' | 'property_partner';
type Props = { profile: Profile; onLogout: () => void; onGoToNewListing?: () => void; onNavigate?: (page: string) => void; onGoToChat?: (id?: string) => void };

const TABS: Array<{ id: Tab; label: string; note: string }> = [
  { id: 'overview', label: 'Overview', note: 'Platform status and priority work' },
  { id: 'operations', label: 'Operations', note: 'People, team, properties, workers, bookings and moderation' },
  { id: 'communications', label: 'Communications', note: 'Support inbox and official announcements' },
  { id: 'finance', label: 'Finance', note: 'Withdrawals, commissions and financial rules' },
  { id: 'analytics', label: 'Analytics', note: 'Platform performance and reporting' },
  { id: 'settings', label: 'Settings', note: 'Global platform and marketplace configuration' },
];

const OPERATIONS: Array<{ id: Operation; label: string; note: string }> = [
  { id: 'people', label: 'People', note: 'Regular users and Property Partners' },
  { id: 'team', label: 'Team', note: 'Admins, Staff, branch placement and Staff modules' },
  { id: 'properties', label: 'Properties', note: 'Property Partner request → inspection → preparation → publication' },
  { id: 'workers', label: 'Workers', note: 'Worker accounts, status and professional verification review' },
  { id: 'bookings', label: 'Bookings', note: 'Worker, apartment and hotel booking records' },
  { id: 'issues', label: 'Issues', note: 'Listing reports and moderation work' },
];

export default function CreatorDashboard({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const { clearAuth } = useCreatorAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [operation, setOperation] = useState<Operation>('people');
  const [viewing, setViewing] = useState<Profile | null>(null);
  const current = TABS.find(item => item.id === tab)!;

  function logout() { clearAuth(); onLogout(); }
  function openOperation(next: Operation) { setOperation(next); setTab('operations'); }

  return <div className="min-h-[100dvh] bg-[#070910] pb-24 text-white">
    <Toaster position="top-center" richColors />
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#080A12]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-[1500px] px-4 pt-4 sm:pt-5 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[9px] font-bold tracking-[.25em] text-violet-400">WEHOUSE CREATOR</p>
            <h1 className="mt-1 text-lg font-bold sm:text-xl">{current.label}</h1>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#74798B]">{current.note}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            {onNavigate && <button onClick={() => onNavigate('profile')} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-[#A3A6B5]">Account</button>}
            <button onClick={logout} className="rounded-xl border border-red-500/15 bg-red-500/[0.06] px-3 py-2 text-[10px] text-red-300">Log out</button>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto pb-3 scrollbar-hide"><div className="flex min-w-max gap-1">{TABS.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-xl px-3.5 py-2 text-[10px] font-semibold ${tab === item.id ? 'bg-violet-500 text-white' : 'text-[#74798B] hover:bg-white/[0.04] hover:text-white'}`}>{item.label}</button>)}</div></div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] px-4 py-6 lg:px-8 lg:py-8">
      {tab === 'overview' && <Overview openOperation={openOperation} openCommunications={() => setTab('communications')} openFinance={() => setTab('finance')} openAnalytics={() => setTab('analytics')} />}
      {tab === 'operations' && <Operations profile={profile} active={operation} setActive={setOperation} onView={setViewing} />}
      {tab === 'communications' && <CommunicationsWorkspace profile={profile} scope="all" onOpenConversation={onGoToChat} />}
      {tab === 'finance' && <Finance />}
      {tab === 'analytics' && <AnalyticsPage profile={profile} />}
      {tab === 'settings' && <Settings profile={profile} />}
    </main>

    {viewing && <UserProfileModal user={viewing} adminProfile={profile} onClose={() => setViewing(null)} onNavigate={onNavigate} onGoToChat={onGoToChat} />}
  </div>;
}

function Overview({ openOperation, openCommunications, openFinance, openAnalytics }: { openOperation: (tab: Operation) => void; openCommunications: () => void; openFinance: () => void; openAnalytics: () => void }) {
  const [stats, setStats] = useState<any>({ users: 0, workers: 0, partners: 0, staff: 0, listings: 0, pending_verifications: 0, hotels: 0, pendingWithdrawals: 0, pendingInspections: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => {
    const [base, hotels, withdrawals, inspections] = await Promise.all([
      supabase.rpc('admin_get_my_branch_stats'),
      supabase.from('hotels').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('withdrawals').select('*', { count: 'exact', head: true }).in('status', ['pending', 'processing']),
      supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).in('status', ['pending', 'scheduled', 'in_progress']),
    ]);
    if (base.error) toast.error(base.error.message);
    setStats({ ...((base.data || {}) as any), hotels: hotels.count || 0, pendingWithdrawals: withdrawals.count || 0, pendingInspections: inspections.count || 0 });
    setLoading(false);
  })(); }, []);
  if (loading) return <Loading />;
  const cards: Array<[string, number, () => void, string]> = [
    ['Users', stats.users, () => openOperation('people'), 'Customer accounts'],
    ['Property Partners', stats.partners, () => openOperation('people'), 'Property owners'],
    ['Team', stats.staff, () => openOperation('team'), 'Admins and operational Staff'],
    ['Workers', stats.workers, () => openOperation('workers'), `${stats.pending_verifications || 0} awaiting review`],
    ['Published apartments', stats.listings, () => openOperation('properties'), 'Public apartment inventory'],
    ['Published hotels', stats.hotels, () => openOperation('properties'), 'Public hotel inventory'],
    ['Property inspections', stats.pendingInspections, () => openOperation('properties'), 'Awaiting or active field work'],
    ['Withdrawals', stats.pendingWithdrawals, openFinance, 'Requests requiring finance review'],
  ];
  return <div className="space-y-6">
    <section className="overflow-hidden rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.14] via-[#14111F] to-[#0E1118] p-5 sm:p-6 lg:p-8">
      <span className="rounded-full bg-violet-500/10 px-3 py-1 text-[9px] font-semibold text-violet-300">PLATFORM OVERVIEW</span>
      <h2 className="mt-4 max-w-3xl text-2xl font-bold sm:text-3xl lg:text-4xl">Platform status and priority work</h2>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[#9498A9]">Review the areas that need attention across users, properties, workers, bookings and finance.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap"><button onClick={() => openOperation('properties')} className="rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold">Properties</button><button onClick={openCommunications} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold">Communications</button><button onClick={openFinance} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold">Finance</button><button onClick={openAnalytics} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold">Analytics</button></div>
    </section>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{cards.map(([label, value, action, note]) => <button key={label} onClick={action} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><p className="text-2xl font-bold">{value || 0}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[9px] text-[#616678]">{note}</p></button>)}</section>
  </div>;
}

function Operations({ profile, active, setActive, onView }: { profile: Profile; active: Operation; setActive: (tab: Operation) => void; onView: (p: Profile) => void }) {
  const current = OPERATIONS.find(item => item.id === active)!;
  return <div className="space-y-5">
    <div><h2 className="text-lg font-bold">Platform operations</h2><p className="mt-1 text-[10px] text-[#707386]">Manage each operational area from its dedicated section.</p></div>
    <div className="overflow-x-auto scrollbar-hide"><div className="flex min-w-max gap-1 rounded-2xl border border-white/[0.05] bg-[#0D1017] p-1">{OPERATIONS.map(item => <button key={item.id} onClick={() => setActive(item.id)} className={`rounded-xl px-3 py-2 text-[10px] font-semibold ${active === item.id ? 'bg-violet-500 text-white' : 'text-[#777A8C] hover:text-white'}`}>{item.label}</button>)}</div></div>
    <div className="rounded-2xl border border-violet-500/10 bg-violet-500/[0.03] p-3"><p className="text-xs font-semibold">{current.label}</p><p className="mt-1 text-[9px] text-[#6E7183]">{current.note}</p></div>
    {active === 'people' && <People onView={onView} />}
    {active === 'team' && <StaffListTab profile={profile} />}
    {active === 'properties' && <PropertyPipelineWorkspace profile={profile} />}
    {active === 'workers' && <Workers />}
    {active === 'bookings' && <Bookings />}
    {active === 'issues' && <Issues />}
  </div>;
}

function People({ onView }: { onView: (p: Profile) => void }) {
  const [role, setRole] = useState<PersonRole>('user');
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
  const shown = useMemo(() => rows.filter(row => !search.trim() || [row.full_name, row.username, row.email, row.user_id].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())), [rows, search]);
  return <Section title="People" note="Users and Property Partners are managed here. Workers and team members remain in their own sections.">
    <div className="flex flex-wrap gap-2">{([['user', 'Users'], ['property_partner', 'Property Partners']] as const).map(([id, label]) => <Chip key={id} active={role === id} onClick={() => setRole(id)}>{label}</Chip>)}</div>
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search platform accounts" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-xs outline-none focus:border-violet-500/40" />
    {loading ? <Loading /> : shown.length === 0 ? <Empty title="No matching accounts" text="No accounts match this filter." /> : <Grid>{shown.map(person => <button key={person.user_id} onClick={() => onView(person)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><div className="flex items-center gap-3"><Avatar text={person.full_name || person.username || person.email} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.full_name || person.username || 'WeHouse account'}</p><p className="truncate text-[10px] text-[#6D7082]">{person.email}</p><p className="mt-1 text-[9px] capitalize text-[#535667]">{person.role?.replace(/_/g, ' ')} · {[person.local_government || person.city, person.state].filter(Boolean).join(', ') || 'Location not set'}</p></div></div></button>)}</Grid>}
  </Section>;
}

function Workers() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: 'worker' }); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  useEffect(() => { void load(); }, []);
  const shown = filter === 'all' ? rows : rows.filter(worker => worker.worker_status === filter);
  async function review(id: string, decision: 'approve' | 'reject') { if (decision === 'reject' && !reason.trim()) return toast.error('Enter a rejection reason'); const { error } = await supabase.rpc('admin_review_my_branch_worker', { p_worker_id: id, p_decision: decision, p_reason: decision === 'reject' ? reason.trim() : null }); if (error) return toast.error(error.message); toast.success(decision === 'approve' ? 'Worker verified' : 'Worker rejected'); setSelected(null); setReason(''); void load(); }
  if (selected) return <Section title="Worker" note="Service information, professional evidence and external identity status."><button onClick={() => { setSelected(null); setReason(''); }} className="text-[10px] font-semibold text-violet-400">← Back to workers</button><Card><Top title={selected.full_name || selected.username || 'Worker'} sub={`${selected.worker_occupation || 'Occupation not set'} · ${[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}`} status={selected.worker_status} /><div className="mt-4 grid gap-3 md:grid-cols-2"><WorkerReviewIdentityStatus workerId={selected.user_id}/>{selected.worker_video_url ? <Video title="Skill video" url={selected.worker_video_url} /> : <Missing label="Skill video" />}</div>{selected.worker_status === 'profile_under_review' && <div className="mt-4 space-y-2"><p className="text-[9px] leading-relaxed text-[#6D7284]">Approval is enforced by the server and remains blocked until the external identity result is verified.</p><Field value={reason} set={setReason} placeholder="Rejection reason if rejecting" /><div className="flex gap-2"><Btn onClick={() => void review(selected.user_id, 'approve')}>Verify worker</Btn><Btn danger onClick={() => void review(selected.user_id, 'reject')}>Reject</Btn></div></div>}</Card></Section>;
  return <Section title="Workers" note="Worker accounts, public availability and verification review are managed here."><div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{[['all', 'All'], ['pending', 'Pending'], ['verification_paid', 'Verification paid'], ['profile_under_review', 'Under review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([id, label]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>{label}</Chip>)}</div>{loading ? <Loading /> : shown.length === 0 ? <Empty title="No workers" text="No workers match this status." /> : <Grid>{shown.map(worker => <button key={worker.user_id} onClick={() => setSelected(worker)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><Top title={worker.full_name || worker.username || 'Worker'} sub={`${worker.worker_occupation || 'Occupation not set'} · ${[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}`} status={worker.worker_status} /><p className="mt-3 text-[9px] font-semibold text-violet-400">OPEN WORKER →</p></button>)}</Grid>}</Section>;
}

function Bookings() {
  const [view, setView] = useState<'worker' | 'apartments' | 'hotels'>('worker');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void load(); }, [view]);
  async function load() {
    setLoading(true); let data: any[] = []; let error: any = null;
    if (view === 'worker') { const result = await supabase.rpc('admin_get_my_branch_worker_bookings'); data = Array.isArray(result.data) ? result.data : []; error = result.error; }
    else if (view === 'apartments') { const result = await supabase.from('reservations').select('*').order('created_at', { ascending: false }).limit(100); data = result.data || []; error = result.error; }
    else { const result = await supabase.from('hotel_bookings').select('*,hotels(name,city,state),hotel_rooms(room_type)').order('created_at', { ascending: false }).limit(100); data = result.data || []; error = result.error; }
    if (error) toast.error(error.message); setRows(data); setLoading(false);
  }
  return <Section title="Bookings" note="Review worker-service, apartment and hotel booking records." right={<Segment value={view} set={v => setView(v as any)} items={[['worker', 'Worker services'], ['apartments', 'Apartments'], ['hotels', 'Hotels']]} />}>{loading ? <Loading /> : rows.length === 0 ? <Empty title="No bookings" text="No records were found for this booking type." /> : <div className="space-y-3">{rows.map(row => <Card key={row.id || row.booking_id}><Top title={view === 'worker' ? (row.service_type || row.booking_code || 'Worker booking') : view === 'hotels' ? (row.hotels?.name || 'Hotel booking') : (row.reservation_code || row.listing_id || 'Apartment reservation')} sub={dateText(row.created_at)} status={row.status || 'recorded'} right={money(row.negotiated_amount || row.agreed_amount || row.total_price || row.amount || 0)} /></Card>)}</div>}</Section>;
}

function Issues() {
  return <Section title="Issues" note="Review moderation and exception cases that require action."><Reports /></Section>;
}

function Reports() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_reports'); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  useEffect(() => { void load(); }, []);
  async function act(id: string, action: 'resolved' | 'dismissed') { const { error } = await supabase.rpc('admin_resolve_my_branch_report', { p_report_id: id, p_action: action }); if (error) return toast.error(error.message); toast.success(action === 'resolved' ? 'Report resolved' : 'Report dismissed'); void load(); }
  return loading ? <Loading /> : rows.length === 0 ? <Empty title="No reports" text="No listing reports are recorded." /> : <div className="space-y-3">{rows.map(row => <Card key={row.id}><Top title={row.reason || 'Listing report'} sub={`${row.listing_id || 'Unknown listing'} · ${dateText(row.created_at)}`} status={row.status || 'pending'} />{row.status === 'pending' && <div className="mt-4 flex gap-2"><Btn onClick={() => void act(row.id, 'resolved')}>Resolve</Btn><Btn muted onClick={() => void act(row.id, 'dismissed')}>Dismiss</Btn></div>}</Card>)}</div>;
}

function Finance() {
  const [view, setView] = useState<'withdrawals' | 'commissions'>('withdrawals');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void load(); }, [view]);
  async function load() {
    setLoading(true);
    const query = view === 'withdrawals' ? supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(100) : supabase.from('commission_ledger').select('*').order('created_at', { ascending: false }).limit(100);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows(data || []); setLoading(false);
  }
  const total = rows.reduce((sum, row) => sum + Number(view === 'withdrawals' ? row.amount : row.commission_amount || 0), 0);
  return <Section title="Finance" note="Review financial records and manage the rules used by settlements." right={<Segment value={view} set={v => setView(v as any)} items={[['withdrawals', 'Withdrawals'], ['commissions', 'Commissions']]} />}>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.8fr)]">
      <div className="space-y-4"><Stats items={[['Records', rows.length], ['Value', money(total)]]} />{loading ? <Loading /> : rows.length === 0 ? <Empty title="No finance records" text="No records are available." /> : <div className="space-y-2">{rows.map(row => <Card key={row.id}><Top title={view === 'withdrawals' ? (row.snapshot_bank_account_name || 'Withdrawal') : (row.booking_type || 'Commission')} sub={dateText(row.created_at)} status={row.status || 'recorded'} right={money(view === 'withdrawals' ? row.amount : row.commission_amount)} /></Card>)}</div>}</div>
      <div className="space-y-4"><DomainSettingsPanel title="Financial rules" description="Commission and withdrawal rules used by worker and Property Partner settlements." settings={[
        { key: 'worker_commission_rate', label: 'Worker commission (%)', description: 'WeHouse commission retained from completed worker jobs.', type: 'number', defaultValue: '10' },
        { key: 'commission_apartment', label: 'Apartment partner commission (%)', description: 'WeHouse commission on eligible apartment rent paid to Property Partners.', type: 'number', defaultValue: '10' },
        { key: 'commission_hotel', label: 'Hotel partner commission (%)', description: 'WeHouse commission on eligible hotel payments paid to Property Partners.', type: 'number', defaultValue: '10' },
        { key: 'wallet_minimum_withdrawal', label: 'Worker minimum withdrawal (₦)', description: 'Minimum available worker balance required before a withdrawal request.', type: 'number', defaultValue: '1000' },
        { key: 'min_withdrawal', label: 'Property Partner minimum withdrawal (₦)', description: 'Minimum available Property Partner balance required before withdrawal.', type: 'number', defaultValue: '5000' },
      ]} /></div>
    </div>
  </Section>;
}

function Settings({ profile }: { profile: Profile }) {
  return <div className="space-y-7">
    <CreatorSettingsTab profile={profile} />
    <section className="space-y-4"><div><h2 className="text-base font-bold">Marketplace configuration</h2><p className="mt-1 text-[10px] text-[#686C7E]">Manage the service and property choices available across WeHouse.</p></div><div className="grid gap-5 xl:grid-cols-2"><Card><h3 className="mb-3 text-sm font-semibold">Worker service categories</h3><ServiceCategoryManager profile={profile} /></Card><Card><h3 className="mb-3 text-sm font-semibold">Property types</h3><PropertyTypeManager profile={profile} /></Card></div></section>
  </div>;
}

function Section({ title, note, right, children }: { title: string; note: string; right?: React.ReactNode; children: React.ReactNode }) { return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] text-[#707386]">{note}</p></div>{right}</div>{children}</div>; }
function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">{children}</div>; }
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>; }
function Stats({ items }: { items: Array<[string, string | number]> }) { return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{items.map(([label, value]) => <Card key={label}><p className="text-[9px] text-[#666A7C]">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></Card>)}</div>; }
function Top({ title, sub, status, right }: { title: string; sub: string; status: string; right?: string }) { return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#707386]">{sub}</p></div><div className="shrink-0 text-right">{right && <p className="mb-1 text-sm font-bold">{right}</p>}<Badge value={status} /></div></div>; }
function Badge({ value }: { value: string }) { const text = String(value || 'unknown').toLowerCase(); const good = ['available', 'active', 'approved', 'completed', 'resolved', 'verified', 'paid'].some(x => text.includes(x)); const bad = ['rejected', 'suspended', 'failed', 'cancelled'].some(x => text.includes(x)); return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{text.replace(/_/g, ' ')}</span>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-semibold ${active ? 'bg-violet-500 text-white' : 'border border-white/[0.06] bg-[#10131B] text-[#777A8C]'}`}>{children}</button>; }
function Segment({ value, set, items }: { value: string; set: (v: string) => void; items: string[][] }) { return <div className="max-w-full overflow-x-auto scrollbar-hide"><div className="flex min-w-max rounded-xl border border-white/[0.06] bg-[#0C0F17] p-1">{items.map(([id, label]) => <button key={id} onClick={() => set(id)} className={`rounded-lg px-3 py-2 text-[9px] font-semibold ${value === id ? 'bg-violet-500 text-white' : 'text-[#777A8C]'}`}>{label}</button>)}</div></div>; }
function Btn({ children, onClick, muted, danger }: { children: React.ReactNode; onClick: () => void; muted?: boolean; danger?: boolean }) { return <button onClick={onClick} className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger ? 'border border-red-500/20 bg-red-500/10 text-red-300' : muted ? 'border border-white/[0.08] bg-white/[0.04] text-[#A7A9B6]' : 'bg-violet-500 text-white'}`}>{children}</button>; }
function Field({ value, set, placeholder, type = 'text' }: { value: string; set: (v: string) => void; placeholder: string; type?: string }) { return <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder} type={type} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40" />; }
function Avatar({ text }: { text: string }) { return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold">{(text || 'W')[0].toUpperCase()}</div>; }
function Video({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6E7183]">{title}</p><video src={url} controls className="max-h-60 w-full rounded-xl bg-[#161922]" /></div>; }
function Missing({ label }: { label: string }) { return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-[10px] text-red-300">No {label} uploaded</div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#66697B]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function money(value: any) { return `₦${Number(value || 0).toLocaleString('en-NG')}`; }
function dateText(value: any) { if (!value) return 'Date unavailable'; try { return new Date(value).toLocaleString(); } catch { return String(value); } }
