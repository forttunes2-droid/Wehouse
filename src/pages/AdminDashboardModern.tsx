import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import UserProfileModal from '@/components/UserProfileModal';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import WorkerReviewIdentityStatus from '@/components/WorkerReviewIdentityStatus';
import StaffListTab from './StaffListTab';
import type { Profile } from '@/types';

type Tab = 'overview' | 'operations' | 'communications' | 'reports';
type Operation = 'people' | 'staff' | 'properties' | 'workers' | 'bookings';
type PersonRole = 'user' | 'property_partner';
type Props = { profile: Profile; onLogout: () => void; onNavigate?: (page: string) => void; onGoToChat?: (id?: string) => void };

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'operations', label: 'Operations' },
  { id: 'communications', label: 'Communications' },
  { id: 'reports', label: 'Reports' },
];

const OPS: Array<{ id: Operation; label: string; note: string }> = [
  { id: 'people', label: 'People', note: 'Regular Users and Property Partners in this branch.' },
  { id: 'staff', label: 'Staff', note: 'Branch Staff, appointment capacity, modules and trust.' },
  { id: 'properties', label: 'Properties', note: 'Property requests, inspections, preparation and publication.' },
  { id: 'workers', label: 'Workers', note: 'Worker accounts and WeHouse professional review.' },
  { id: 'bookings', label: 'Service Bookings', note: 'Worker-service bookings in this branch.' },
];

export default function AdminDashboardModern({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [operation, setOperation] = useState<Operation>('people');
  const [stats, setStats] = useState<any>({ users: 0, workers: 0, partners: 0, staff: 0, listings: 0, pending_verifications: 0 });
  const [viewing, setViewing] = useState<Profile | null>(null);
  const branchReady = Boolean(profile.assigned_state && profile.assigned_lga);

  async function loadStats() {
    if (!branchReady) return;
    const { data, error } = await supabase.rpc('admin_get_my_branch_stats');
    if (error) return void toast.error(error.message);
    setStats(data || {});
  }

  useEffect(() => { void loadStats(); }, [branchReady, profile.assigned_state, profile.assigned_lga]);

  function openOperation(next: Operation) {
    setOperation(next);
    setTab('operations');
  }

  const description = !branchReady
    ? 'Branch assignment required before Admin operations can begin.'
    : tab === 'overview'
      ? `Branch health and priority work · ${profile.assigned_lga}, ${profile.assigned_state}`
      : tab === 'operations'
        ? `People, Staff, properties, Workers and bookings · ${profile.assigned_lga}, ${profile.assigned_state}`
        : tab === 'communications'
          ? `Branch inbox and announcements · ${profile.assigned_lga}, ${profile.assigned_state}`
          : `Listing reports and moderation · ${profile.assigned_lga}, ${profile.assigned_state}`;

  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label={`WEHOUSE · ADMIN · ${profile.assigned_lga || 'UNASSIGNED'}`}
        title={NAV.find((item) => item.id === tab)?.label || 'Admin'}
        description={description}
        items={NAV}
        active={tab}
        setActive={(id) => setTab(id as Tab)}
        onAccount={onNavigate ? () => onNavigate('profile') : undefined}
        onLogout={onLogout}
      >
        {!branchReady ? <Empty title="Branch assignment required" text="Creator must assign this Admin to a State and LGA before branch operations are available." /> : (
          <>
            {tab === 'overview' && <Overview stats={stats} profile={profile} openOperation={openOperation} openCommunications={() => setTab('communications')} openReports={() => setTab('reports')} />}
            {tab === 'operations' && <Operations profile={profile} active={operation} setActive={setOperation} onView={setViewing} onRefresh={loadStats} />}
            {tab === 'communications' && <CommunicationsWorkspace profile={profile} scope={{ state: profile.assigned_state!, lga: profile.assigned_lga! }} />}
            {tab === 'reports' && <Reports />}
          </>
        )}
      </WorkspaceFrameV2>
      {viewing && <UserProfileModal user={viewing} adminProfile={profile} onClose={() => setViewing(null)} onPromote={() => { setViewing(null); openOperation('staff'); void loadStats(); }} onNavigate={onNavigate} onGoToChat={onGoToChat} />}
    </>
  );
}

function Overview({ stats, profile, openOperation, openCommunications, openReports }: { stats: any; profile: Profile; openOperation: (tab: Operation) => void; openCommunications: () => void; openReports: () => void }) {
  const cards: Array<[string, number, Operation, string]> = [
    ['Users', stats.users || 0, 'people', 'Regular Users'],
    ['Property Partners', stats.partners || 0, 'people', 'Property owners'],
    ['Staff', stats.staff || 0, 'staff', 'Branch Staff'],
    ['Properties', stats.listings || 0, 'properties', 'Published branch inventory'],
    ['Workers', stats.workers || 0, 'workers', `${stats.pending_verifications || 0} awaiting review`],
  ];
  return <div className="space-y-5"><section className="rounded-3xl border border-indigo-500/15 bg-gradient-to-br from-indigo-500/[0.13] via-[#111522] to-[#0D1018] p-5 sm:p-6 lg:p-8"><span className="rounded-full bg-indigo-500/10 px-3 py-1 text-[9px] font-semibold text-indigo-300">BRANCH AUTHORITY</span><h2 className="mt-4 text-2xl font-bold lg:text-3xl">{profile.assigned_lga}, {profile.assigned_state}</h2><p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#9295A7]">Admin authority stays inside this branch. Staff appointments are subject to the Creator's configured capacity and trust rules.</p></section><section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{cards.map(([label, value, target, note]) => <button key={label} onClick={() => openOperation(target)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-indigo-500/25"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[9px] text-[#626678]">{note}</p></button>)}</section><section className="grid gap-3 md:grid-cols-2"><button onClick={openCommunications} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left"><p className="text-sm font-semibold">Communications</p><p className="mt-1 text-[10px] text-[#727587]">Branch conversations and announcements.</p></button><button onClick={openReports} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left"><p className="text-sm font-semibold">Reports & moderation</p><p className="mt-1 text-[10px] text-[#727587]">Listing reports requiring a moderation decision.</p></button></section></div>;
}

function Operations({ profile, active, setActive, onView, onRefresh }: { profile: Profile; active: Operation; setActive: (tab: Operation) => void; onView: (profile: Profile) => void; onRefresh: () => Promise<void> | void }) {
  const current = OPS.find((item) => item.id === active)!;
  return <div className="space-y-5"><div><h2 className="text-lg font-bold">Branch operations</h2><p className="mt-1 text-[10px] text-[#707386]">Each responsibility has one clear home.</p></div><div className="flex flex-wrap gap-2">{OPS.map((item) => <Chip key={item.id} active={active === item.id} onClick={() => setActive(item.id)}>{item.label}</Chip>)}</div><div className="rounded-2xl border border-indigo-500/10 bg-indigo-500/[0.03] p-3"><p className="text-xs font-semibold">{current.label}</p><p className="mt-1 text-[9px] text-[#6E7183]">{current.note}</p></div>{active === 'people' && <People onView={onView} />}{active === 'staff' && <StaffListTab profile={profile} />}{active === 'properties' && <PropertyPipelineWorkspace profile={profile} />}{active === 'workers' && <Workers onChanged={onRefresh} />}{active === 'bookings' && <Bookings />}</div>;
}

function People({ onView }: { onView: (profile: Profile) => void }) {
  const [role, setRole] = useState<PersonRole>('user');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { void load(); }, [role]);
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: role }); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  const shown = useMemo(() => rows.filter((row) => !search.trim() || [row.full_name, row.username, row.email, row.user_id].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())), [rows, search]);
  return <Section title="People" note="Regular Users and Property Partners in this branch. Staff and Workers stay in their own workspaces."><div className="flex gap-2">{([['user', 'Users'], ['property_partner', 'Property Partners']] as const).map(([id, label]) => <Chip key={id} active={role === id} onClick={() => setRole(id)}>{label}</Chip>)}</div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this branch" className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-xs" />{loading ? <Loading /> : shown.length === 0 ? <Empty title="No matching accounts" text="Nothing in this branch matches the filter." /> : <Grid>{shown.slice(0, 60).map((person) => <button key={person.user_id} onClick={() => onView(person)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left"><div className="flex gap-3"><Avatar text={person.full_name || person.username || person.email} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.full_name || person.username || 'WeHouse account'}</p><p className="truncate text-[10px] text-[#6D7082]">{person.email}</p><p className="mt-1 text-[9px] capitalize text-[#535667]">{person.role?.replace(/_/g, ' ')}</p></div></div></button>)}</Grid>}</Section>;
}

function Workers({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const { requestAuth } = useAdminAuth();
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: 'worker' }); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  useEffect(() => { void load(); }, []);
  const shown = filter === 'all' ? rows : rows.filter((worker) => worker.worker_status === filter);
  function review(id: string, decision: 'approve' | 'reject') { requestAuth(async () => { if (decision === 'reject' && !reason.trim()) return toast.error('Enter a rejection reason'); const { error } = await supabase.rpc('admin_review_my_branch_worker', { p_worker_id: id, p_decision: decision, p_reason: decision === 'reject' ? reason.trim() : null }); if (error) return toast.error(error.message); toast.success(decision === 'approve' ? 'Worker approved' : 'Worker rejected'); setSelected(null); setReason(''); await load(); await onChanged(); }); }
  if (selected) return <Section title="Worker professional review" note="Review WeHouse professional checks and work evidence. Government/external identity verification is not part of this process."><button onClick={() => { setSelected(null); setReason(''); }} className="text-[10px] font-semibold text-indigo-400">← Back to Workers</button><Card><Top title={selected.full_name || selected.username || 'Worker'} sub={`${selected.worker_occupation || 'Occupation not set'} · ${[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}`} status={selected.worker_status} /><div className="mt-4 grid gap-3 md:grid-cols-2"><WorkerReviewIdentityStatus workerId={selected.user_id} />{selected.worker_video_url ? <Video title="Skill demonstration" url={selected.worker_video_url} /> : <Missing label="skill demonstration" />}</div>{selected.worker_status === 'profile_under_review' && <div className="mt-4 space-y-2"><p className="text-[9px] leading-relaxed text-[#6D7284]">Approval remains blocked until the required WeHouse professional checks and work evidence are complete.</p><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required only when rejecting" className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs" /><div className="flex gap-2"><Button onClick={() => review(selected.user_id, 'approve')}>Approve Worker</Button><Button danger onClick={() => review(selected.user_id, 'reject')}>Reject</Button></div></div>}</Card></Section>;
  return <Section title="Workers" note="Worker status and professional review work lives here."><div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{[['all', 'All'], ['verification_paid', 'Payment confirmed'], ['profile_under_review', 'Under review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([id, label]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>{label}</Chip>)}</div>{loading ? <Loading /> : shown.length === 0 ? <Empty title="No Workers" text="No Workers match this status." /> : <Grid>{shown.map((worker) => <button key={worker.user_id} onClick={() => setSelected(worker)} className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left"><Top title={worker.full_name || worker.username || 'Worker'} sub={`${worker.worker_occupation || 'Occupation not set'} · ${[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}`} status={worker.worker_status} /><p className="mt-3 text-[9px] font-semibold text-indigo-400">OPEN WORKER →</p></button>)}</Grid>}</Section>;
}

function Bookings() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => { const { data, error } = await supabase.rpc('admin_get_my_branch_worker_bookings'); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); })(); }, []);
  return <Section title="Service bookings" note="Branch oversight for Worker-service bookings.">{loading ? <Loading /> : rows.length === 0 ? <Empty title="No service bookings" text="There are no Worker-service bookings in this branch." /> : <div className="space-y-3">{rows.map((row) => <Card key={row.id}><Top title={row.service_name || row.service || 'Service booking'} sub={`${row.booking_code || row.id} · ${dateText(row.created_at)}`} status={row.status || 'pending'} right={row.agreed_amount ? money(row.agreed_amount) : undefined} /></Card>)}</div>}</Section>;
}

function Reports() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_reports'); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  useEffect(() => { void load(); }, []);
  async function act(id: string, action: 'resolved' | 'dismissed') { const { error } = await supabase.rpc('admin_resolve_my_branch_report', { p_report_id: id, p_action: action }); if (error) return toast.error(error.message); toast.success(action === 'resolved' ? 'Report resolved' : 'Report dismissed'); void load(); }
  return <Section title="Reports & moderation" note="Listing reports only. Support conversations stay in Communications.">{loading ? <Loading /> : rows.length === 0 ? <Empty title="No reports" text="No listing reports are waiting for moderation." /> : <div className="space-y-3">{rows.map((row) => <Card key={row.id}><Top title={row.reason || 'Listing report'} sub={`${row.listing_id || 'Listing'} · ${dateText(row.created_at)}`} status={row.status || 'pending'} />{row.status === 'pending' && <div className="mt-3 flex gap-2"><Button onClick={() => void act(row.id, 'resolved')}>Resolve</Button><Button muted onClick={() => void act(row.id, 'dismissed')}>Dismiss</Button></div>}</Card>)}</div>}</Section>;
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) { return <div className="space-y-5"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] text-[#707386]">{note}</p></div>{children}</div>; }
function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">{children}</div>; }
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-semibold ${active ? 'bg-indigo-500 text-white' : 'border border-white/[0.06] bg-[#10131B] text-[#777A8C]'}`}>{children}</button>; }
function Avatar({ text }: { text: string }) { return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold">{(text || 'W')[0].toUpperCase()}</div>; }
function Top({ title, sub, status, right }: { title: string; sub: string; status: string; right?: string }) { return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 line-clamp-2 text-[10px] text-[#707386]">{sub}</p></div><div className="shrink-0 text-right">{right && <p className="mb-1 text-sm font-bold">{right}</p>}<span className="rounded-full bg-white/[0.05] px-2 py-1 text-[8px] capitalize text-[#A2A7B5]">{String(status || 'pending').replace(/_/g, ' ')}</span></div></div>; }
function Button({ children, onClick, muted, danger }: { children: React.ReactNode; onClick: () => void; muted?: boolean; danger?: boolean }) { return <button onClick={onClick} className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger ? 'bg-red-500/10 text-red-300' : muted ? 'border border-white/[0.08] text-[#A4A9B6]' : 'bg-indigo-500 text-white'}`}>{children}</button>; }
function Video({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6E7183]">{title}</p><video src={url} controls className="max-h-60 w-full rounded-xl bg-[#161922]" /></div>; }
function Missing({ label }: { label: string }) { return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-red-500/20 text-[10px] text-red-300">No {label} uploaded</div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] px-6 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mt-2 text-[10px] text-[#66697B]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>; }
function money(value: any) { return `₦${Number(value || 0).toLocaleString('en-NG')}`; }
function dateText(value: any) { if (!value) return 'Date unavailable'; try { return new Date(value).toLocaleString(); } catch { return String(value); } }
