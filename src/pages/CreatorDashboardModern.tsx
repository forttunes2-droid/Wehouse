import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
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
type Operation = 'people' | 'team' | 'properties' | 'workers' | 'bookings' | 'reports';
type PersonRole = 'user' | 'property_partner';
type Props = { profile: Profile; onLogout: () => void; onGoToNewListing?: () => void; onNavigate?: (page: string) => void; onGoToChat?: (id?: string) => void };

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'operations', label: 'Operations' },
  { id: 'communications', label: 'Communications' },
  { id: 'finance', label: 'Finance' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
];

const NOTES: Record<Tab, string> = {
  overview: 'Platform health, priority work and real operational counts.',
  operations: 'Accounts, team, properties, Workers, bookings and moderation each have one clear home.',
  communications: 'Support conversations and official announcements.',
  finance: 'Platform payout requests, commission records and settlement rules — not a Creator wallet.',
  analytics: 'Platform performance and reporting.',
  settings: 'Global platform and marketplace configuration.',
};

const OPERATIONS: Array<{ id: Operation; label: string; note: string }> = [
  { id: 'people', label: 'People', note: 'Regular Users and Property Partners.' },
  { id: 'team', label: 'Team', note: 'Admins, Staff capacity, branch placement, modules and trust.' },
  { id: 'properties', label: 'Properties', note: 'Property request → inspection → preparation → publication.' },
  { id: 'workers', label: 'Workers', note: 'Worker accounts and WeHouse professional review.' },
  { id: 'bookings', label: 'Bookings', note: 'Worker-service, apartment and hotel booking records.' },
  { id: 'reports', label: 'Reports', note: 'Listing reports and moderation decisions.' },
];

export default function CreatorDashboardModern({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [operation, setOperation] = useState<Operation>('people');
  const [viewing, setViewing] = useState<Profile | null>(null);

  function openOperation(next: Operation) {
    setOperation(next);
    setTab('operations');
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label="WEHOUSE · CREATOR"
        title={NAV.find((item) => item.id === tab)?.label || 'Creator'}
        description={NOTES[tab]}
        items={NAV}
        active={tab}
        setActive={(id) => setTab(id as Tab)}
        onAccount={onNavigate ? () => onNavigate('profile') : undefined}
        onLogout={onLogout}
      >
        {tab === 'overview' && <Overview openOperation={openOperation} openCommunications={() => setTab('communications')} openFinance={() => setTab('finance')} openAnalytics={() => setTab('analytics')} />}
        {tab === 'operations' && <Operations profile={profile} active={operation} setActive={setOperation} onView={setViewing} />}
        {tab === 'communications' && <CommunicationsWorkspace profile={profile} scope="all" onOpenConversation={onGoToChat} />}
        {tab === 'finance' && <Finance />}
        {tab === 'analytics' && <AnalyticsPage profile={profile} />}
        {tab === 'settings' && <Settings profile={profile} />}
      </WorkspaceFrameV2>
      {viewing && <UserProfileModal user={viewing} adminProfile={profile} onClose={() => setViewing(null)} onNavigate={onNavigate} onGoToChat={onGoToChat} />}
    </>
  );
}

function Overview({ openOperation, openCommunications, openFinance, openAnalytics }: { openOperation: (tab: Operation) => void; openCommunications: () => void; openFinance: () => void; openAnalytics: () => void }) {
  const [stats, setStats] = useState<any>({ users: 0, workers: 0, partners: 0, listings: 0, pending_verifications: 0, hotels: 0, team: 0, pendingPayouts: 0, pendingInspections: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [base, hotels, team, payouts, inspections] = await Promise.all([
        supabase.rpc('admin_get_my_branch_stats'),
        supabase.from('hotels').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['admin', 'staff']).eq('deleted', false),
        supabase.from('withdrawals').select('*', { count: 'exact', head: true }).in('status', ['pending', 'processing']),
        supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).in('status', ['pending', 'scheduled', 'in_progress']),
      ]);
      if (base.error) toast.error(base.error.message);
      setStats({
        ...((base.data || {}) as any),
        hotels: hotels.count || 0,
        team: team.count || 0,
        pendingPayouts: payouts.count || 0,
        pendingInspections: inspections.count || 0,
      });
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;

  const cards: Array<[string, number, () => void, string]> = [
    ['Users', stats.users, () => openOperation('people'), 'Customer accounts'],
    ['Property Partners', stats.partners, () => openOperation('people'), 'Property owners'],
    ['Team', stats.team, () => openOperation('team'), 'Admins and Staff'],
    ['Workers', stats.workers, () => openOperation('workers'), `${stats.pending_verifications || 0} awaiting review`],
    ['Published apartments', stats.listings, () => openOperation('properties'), 'Public apartment inventory'],
    ['Published hotels', stats.hotels, () => openOperation('properties'), 'Public hotel inventory'],
    ['Property inspections', stats.pendingInspections, () => openOperation('properties'), 'Awaiting or active field work'],
    ['Payout requests', stats.pendingPayouts, openFinance, 'Worker/Partner requests awaiting finance handling'],
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.14] via-[#14111F] to-[#0E1118] p-5 sm:p-6 lg:p-8">
        <span className="rounded-full bg-violet-500/10 px-3 py-1 text-[9px] font-semibold text-violet-300">PLATFORM OVERVIEW</span>
        <h2 className="mt-4 max-w-3xl text-2xl font-bold sm:text-3xl lg:text-4xl">One view of what needs attention</h2>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[#9498A9]">Counts and actions lead to the single workspace that owns each responsibility.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <button onClick={() => openOperation('properties')} className="rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold">Properties</button>
          <button onClick={openCommunications} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold">Communications</button>
          <button onClick={openFinance} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold">Finance</button>
          <button onClick={openAnalytics} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold">Analytics</button>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.map(([label, value, action, note]) => (
          <button key={label} onClick={action} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left transition hover:border-violet-500/25">
            <p className="text-2xl font-bold">{value || 0}</p>
            <p className="mt-1 text-[10px] font-semibold">{label}</p>
            <p className="mt-1 text-[9px] text-[#616678]">{note}</p>
          </button>
        ))}
      </section>
    </div>
  );
}

function Operations({ profile, active, setActive, onView }: { profile: Profile; active: Operation; setActive: (tab: Operation) => void; onView: (profile: Profile) => void }) {
  const current = OPERATIONS.find((item) => item.id === active)!;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Platform operations</h2>
        <p className="mt-1 text-[10px] text-[#707386]">Each responsibility has one clear home. Labels describe the records behind them.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {OPERATIONS.map((item) => <Chip key={item.id} active={active === item.id} onClick={() => setActive(item.id)}>{item.label}</Chip>)}
      </div>
      <div className="rounded-2xl border border-violet-500/10 bg-violet-500/[0.03] p-3">
        <p className="text-xs font-semibold">{current.label}</p>
        <p className="mt-1 text-[9px] text-[#6E7183]">{current.note}</p>
      </div>
      {active === 'people' && <People onView={onView} />}
      {active === 'team' && <StaffListTab profile={profile} />}
      {active === 'properties' && <PropertyPipelineWorkspace profile={profile} />}
      {active === 'workers' && <Workers />}
      {active === 'bookings' && <Bookings />}
      {active === 'reports' && <Reports />}
    </div>
  );
}

function People({ onView }: { onView: (profile: Profile) => void }) {
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

  const shown = useMemo(() => rows.filter((row) => !search.trim() || [row.full_name, row.username, row.email, row.user_id].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())), [rows, search]);
  return (
    <Section title="People" note="Regular Users and Property Partners. Workers and Team members stay in their dedicated workspaces.">
      <div className="flex flex-wrap gap-2">{([['user', 'Users'], ['property_partner', 'Property Partners']] as const).map(([id, label]) => <Chip key={id} active={role === id} onClick={() => setRole(id)}>{label}</Chip>)}</div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-xs outline-none focus:border-violet-500/40" />
      {loading ? <Loading /> : shown.length === 0 ? <Empty title="No matching accounts" text="No accounts match this filter." /> : <Grid>{shown.slice(0, 60).map((person) => <button key={person.user_id} onClick={() => onView(person)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><div className="flex items-center gap-3"><Avatar text={person.full_name || person.username || person.email} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.full_name || person.username || 'WeHouse account'}</p><p className="truncate text-[10px] text-[#6D7082]">{person.email}</p><p className="mt-1 text-[9px] capitalize text-[#535667]">{person.role?.replace(/_/g, ' ')} · {[person.local_government || person.city, person.state].filter(Boolean).join(', ') || 'Location not set'}</p></div></div></button>)}</Grid>}
    </Section>
  );
}

function Workers() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: 'worker' });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const shown = filter === 'all' ? rows : rows.filter((worker) => worker.worker_status === filter);
  async function review(id: string, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) return toast.error('Enter a rejection reason');
    const { error } = await supabase.rpc('admin_review_my_branch_worker', { p_worker_id: id, p_decision: decision, p_reason: decision === 'reject' ? reason.trim() : null });
    if (error) return toast.error(error.message);
    toast.success(decision === 'approve' ? 'Worker approved' : 'Worker rejected');
    setSelected(null);
    setReason('');
    void load();
  }

  if (selected) {
    return (
      <Section title="Worker professional review" note="Review WeHouse professional checks and work evidence. Government/external identity verification is not part of this process.">
        <button onClick={() => { setSelected(null); setReason(''); }} className="text-[10px] font-semibold text-violet-400">← Back to Workers</button>
        <Card>
          <Top title={selected.full_name || selected.username || 'Worker'} sub={`${selected.worker_occupation || 'Occupation not set'} · ${[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}`} status={selected.worker_status} />
          <div className="mt-4 grid gap-3 md:grid-cols-2"><WorkerReviewIdentityStatus workerId={selected.user_id} />{selected.worker_video_url ? <Video title="Skill demonstration" url={selected.worker_video_url} /> : <Missing label="skill demonstration" />}</div>
          {selected.worker_status === 'profile_under_review' && <div className="mt-4 space-y-2"><p className="text-[9px] leading-relaxed text-[#6D7284]">Server approval remains blocked until the required WeHouse professional checks and work evidence are complete.</p><Field value={reason} set={setReason} placeholder="Reason required only when rejecting" /><div className="flex gap-2"><Btn onClick={() => void review(selected.user_id, 'approve')}>Approve Worker</Btn><Btn danger onClick={() => void review(selected.user_id, 'reject')}>Reject</Btn></div></div>}
        </Card>
      </Section>
    );
  }

  return (
    <Section title="Workers" note="Worker accounts, public availability and professional review.">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{[['all', 'All'], ['pending', 'Pending'], ['verification_paid', 'Payment confirmed'], ['profile_under_review', 'Under review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([id, label]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>{label}</Chip>)}</div>
      {loading ? <Loading /> : shown.length === 0 ? <Empty title="No Workers" text="No Workers match this status." /> : <Grid>{shown.map((worker) => <button key={worker.user_id} onClick={() => setSelected(worker)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><Top title={worker.full_name || worker.username || 'Worker'} sub={`${worker.worker_occupation || 'Occupation not set'} · ${[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}`} status={worker.worker_status} /><p className="mt-3 text-[9px] font-semibold text-violet-400">OPEN WORKER →</p></button>)}</Grid>}
    </Section>
  );
}

function Bookings() {
  const [view, setView] = useState<'worker' | 'apartments' | 'hotels'>('worker');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void load(); }, [view]);

  async function load() {
    setLoading(true);
    let data: any[] = [];
    let error: any = null;
    if (view === 'worker') { const result = await supabase.rpc('admin_get_my_branch_worker_bookings'); data = Array.isArray(result.data) ? result.data : []; error = result.error; }
    else if (view === 'apartments') { const result = await supabase.from('reservations').select('*').order('created_at', { ascending: false }).limit(100); data = result.data || []; error = result.error; }
    else { const result = await supabase.from('hotel_bookings').select('*,hotels(name,city,state),hotel_rooms(room_type)').order('created_at', { ascending: false }).limit(100); data = result.data || []; error = result.error; }
    if (error) toast.error(error.message);
    setRows(data);
    setLoading(false);
  }

  return <Section title="Bookings" note="Worker-service, apartment and hotel booking records." right={<Segment value={view} set={(value) => setView(value as any)} items={[['worker', 'Worker services'], ['apartments', 'Apartments'], ['hotels', 'Hotels']]} />}>{loading ? <Loading /> : rows.length === 0 ? <Empty title="No bookings" text="No records were found for this booking type." /> : <div className="space-y-3">{rows.map((row) => <Card key={row.id || row.booking_id}><Top title={view === 'worker' ? (row.service_type || row.booking_code || 'Worker booking') : view === 'hotels' ? (row.hotels?.name || 'Hotel booking') : (row.reservation_code || row.listing_id || 'Apartment reservation')} sub={dateText(row.created_at)} status={row.status || 'recorded'} right={money(row.negotiated_amount || row.agreed_amount || row.total_price || row.amount || 0)} /></Card>)}</div>}</Section>;
}

function Reports() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_my_branch_reports');
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  async function act(id: string, action: 'resolved' | 'dismissed') {
    const { error } = await supabase.rpc('admin_resolve_my_branch_report', { p_report_id: id, p_action: action });
    if (error) return toast.error(error.message);
    toast.success(action === 'resolved' ? 'Report resolved' : 'Report dismissed');
    void load();
  }

  return <Section title="Reports & moderation" note="Listing reports that require a moderation decision. Support conversations stay in Communications.">{loading ? <Loading /> : rows.length === 0 ? <Empty title="No reports" text="No listing reports are waiting for moderation." /> : <div className="space-y-3">{rows.map((row) => <Card key={row.id}><Top title={row.reason || 'Listing report'} sub={`${row.listing_id || 'Unknown listing'} · ${dateText(row.created_at)}`} status={row.status || 'pending'} />{row.status === 'pending' && <div className="mt-4 flex gap-2"><Btn onClick={() => void act(row.id, 'resolved')}>Resolve</Btn><Btn muted onClick={() => void act(row.id, 'dismissed')}>Dismiss</Btn></div>}</Card>)}</div>}</Section>;
}

function Finance() {
  const [view, setView] = useState<'payouts' | 'commissions' | 'rules'>('payouts');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void load(); }, [view]);
  async function load() {
    if (view === 'rules') {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const query = view === 'payouts'
      ? supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(100)
      : supabase.from('commission_ledger').select('*').order('created_at', { ascending: false }).limit(100);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  const total = rows.reduce((sum, row) => sum + Number(view === 'payouts' ? row.amount : row.commission_amount || 0), 0);
  return (
    <Section
      title="Platform finance"
      note="Financial oversight for settlements. Creator does not have a personal withdrawal action here."
      right={<Segment value={view} set={(value) => setView(value as any)} items={[['payouts', 'Payout requests'], ['commissions', 'Commission ledger'], ['rules', 'Settlement rules']]} />}
    >
      {view === 'rules' ? (
        <DomainSettingsPanel title="Settlement rules" description="Commission and minimum payout rules used by Worker and Property Partner settlements." settings={[
          { key: 'worker_commission_rate', label: 'Worker commission (%)', description: 'WeHouse commission retained from completed Worker jobs.', type: 'number', defaultValue: '10' },
          { key: 'commission_apartment', label: 'Apartment Partner commission (%)', description: 'WeHouse commission on eligible apartment rent paid to Property Partners.', type: 'number', defaultValue: '10' },
          { key: 'commission_hotel', label: 'Hotel Partner commission (%)', description: 'WeHouse commission on eligible hotel payments paid to Property Partners.', type: 'number', defaultValue: '10' },
          { key: 'wallet_minimum_withdrawal', label: 'Worker minimum payout (₦)', description: 'Minimum available Worker balance required before a payout request.', type: 'number', defaultValue: '1000' },
          { key: 'min_withdrawal', label: 'Property Partner minimum payout (₦)', description: 'Minimum available Property Partner balance required before a payout request.', type: 'number', defaultValue: '5000' },
        ]} />
      ) : (
        <div className="space-y-4">
          {view === 'payouts' && <div className="rounded-2xl border border-violet-500/10 bg-violet-500/[0.03] p-3 text-[10px] leading-relaxed text-[#8A90A0]">These are payout requests submitted by Workers or Property Partners. They are not Creator withdrawals.</div>}
          <Stats items={[['Records', rows.length], [view === 'payouts' ? 'Requested value' : 'Commission value', money(total)]]} />
          {loading ? <Loading /> : rows.length === 0 ? <Empty title={view === 'payouts' ? 'No payout requests' : 'No commission records'} text="No records are available for this view." /> : <div className="space-y-2">{rows.map((row) => <Card key={row.id}><Top title={view === 'payouts' ? (row.snapshot_bank_account_name || 'Payout request') : (row.booking_type || 'Commission')} sub={dateText(row.created_at)} status={row.status || 'recorded'} right={money(view === 'payouts' ? row.amount : row.commission_amount)} /></Card>)}</div>}
        </div>
      )}
    </Section>
  );
}

function Settings({ profile }: { profile: Profile }) {
  return <div className="space-y-7"><CreatorSettingsTab profile={profile} /><section className="space-y-4"><div><h2 className="text-base font-bold">Marketplace configuration</h2><p className="mt-1 text-[10px] text-[#686C7E]">Manage the service and property choices available across WeHouse.</p></div><div className="grid gap-5 xl:grid-cols-2"><Card><h3 className="mb-3 text-sm font-semibold">Worker service categories</h3><ServiceCategoryManager profile={profile} /></Card><Card><h3 className="mb-3 text-sm font-semibold">Property types</h3><PropertyTypeManager profile={profile} /></Card></div></section></div>;
}

function Section({ title, note, right, children }: { title: string; note: string; right?: React.ReactNode; children: React.ReactNode }) { return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] text-[#707386]">{note}</p></div>{right}</div>{children}</div>; }
function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">{children}</div>; }
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>; }
function Stats({ items }: { items: Array<[string, string | number]> }) { return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{items.map(([label, value]) => <Card key={label}><p className="text-[9px] text-[#666A7C]">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></Card>)}</div>; }
function Top({ title, sub, status, right }: { title: string; sub: string; status: string; right?: string }) { return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#707386]">{sub}</p></div><div className="shrink-0 text-right">{right && <p className="mb-1 text-sm font-bold">{right}</p>}<Badge value={status} /></div></div>; }
function Badge({ value }: { value: string }) { const text = String(value || 'unknown').toLowerCase(); const good = ['available', 'active', 'approved', 'completed', 'resolved', 'verified', 'paid'].some((item) => text.includes(item)); const bad = ['rejected', 'suspended', 'failed', 'cancelled'].some((item) => text.includes(item)); return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{text.replace(/_/g, ' ')}</span>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-semibold ${active ? 'bg-violet-500 text-white' : 'border border-white/[0.06] bg-[#10131B] text-[#777A8C]'}`}>{children}</button>; }
function Segment({ value, set, items }: { value: string; set: (value: string) => void; items: string[][] }) { return <div className="max-w-full overflow-x-auto scrollbar-hide"><div className="flex min-w-max rounded-xl border border-white/[0.06] bg-[#0C0F17] p-1">{items.map(([id, label]) => <button key={id} onClick={() => set(id)} className={`rounded-lg px-3 py-2 text-[9px] font-semibold ${value === id ? 'bg-violet-500 text-white' : 'text-[#777A8C]'}`}>{label}</button>)}</div></div>; }
function Btn({ children, onClick, muted, danger }: { children: React.ReactNode; onClick: () => void; muted?: boolean; danger?: boolean }) { return <button onClick={onClick} className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger ? 'border border-red-500/20 bg-red-500/10 text-red-300' : muted ? 'border border-white/[0.08] bg-white/[0.04] text-[#A7A9B6]' : 'bg-violet-500 text-white'}`}>{children}</button>; }
function Field({ value, set, placeholder }: { value: string; set: (value: string) => void; placeholder: string }) { return <input value={value} onChange={(event) => set(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40" />; }
function Avatar({ text }: { text: string }) { return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold">{(text || 'W')[0].toUpperCase()}</div>; }
function Video({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6E7183]">{title}</p><video src={url} controls className="max-h-60 w-full rounded-xl bg-[#161922]" /></div>; }
function Missing({ label }: { label: string }) { return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-[10px] text-red-300">No {label} uploaded</div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#66697B]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function money(value: any) { return `₦${Number(value || 0).toLocaleString('en-NG')}`; }
function dateText(value: any) { if (!value) return 'Date unavailable'; try { return new Date(value).toLocaleString(); } catch { return String(value); } }
