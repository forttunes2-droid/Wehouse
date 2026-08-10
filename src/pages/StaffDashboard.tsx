import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import type { Profile, StaffPermission } from '@/types';
import { WORKER_STATUS_LABELS } from '@/types';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onGoToChat?: (id?: string) => void;
  onNavigate?: (page: string) => void;
};

type ModuleKey = 'operations' | 'finance' | 'support' | 'verification' | 'field_officer';
type ModuleInfo = { title: string; eyebrow: string; description: string };

const MODULE_INFO: Record<ModuleKey, ModuleInfo> = {
  operations: {
    title: 'Property Operations',
    eyebrow: 'OPERATIONS',
    description: 'Review property listings and keep the branch listing pipeline accurate.',
  },
  finance: {
    title: 'Finance',
    eyebrow: 'FINANCE',
    description: 'Monitor canonical withdrawals and commission records for the assigned branch.',
  },
  support: {
    title: 'Support',
    eyebrow: 'SUPPORT',
    description: 'Handle support cases from people in the assigned branch.',
  },
  verification: {
    title: 'Worker Verification',
    eyebrow: 'VERIFICATION',
    description: 'Review paid worker verification submissions before workers become public.',
  },
  field_officer: {
    title: 'Field Work',
    eyebrow: 'FIELD OFFICER',
    description: 'Complete assigned property inspections and prepare inspected properties for listing review.',
  },
};

const STAFF_MODULES = new Set<StaffPermission>(['operations', 'finance', 'support', 'verification', 'field_officer']);

export default function StaffDashboard({ profile, onLogout }: Props) {
  const { permissions, loading } = useStaffPermissions(profile.user_id);
  const assigned = useMemo(
    () => permissions.filter((permission): permission is ModuleKey => STAFF_MODULES.has(permission) && permission in MODULE_INFO),
    [permissions],
  );

  if (loading) return <PageLoading />;

  if (assigned.length === 0) {
    return (
      <StaffShell profile={profile} onLogout={onLogout} info={{ title: 'Staff Workspace', eyebrow: 'WEHOUSE STAFF', description: 'No operational module has been assigned yet.' }}>
        <Empty title="No module assigned" text="An Admin or the Creator must assign your staff responsibility before operational tools appear." />
      </StaffShell>
    );
  }

  if (assigned.length > 1) {
    return (
      <StaffShell profile={profile} onLogout={onLogout} info={{ title: 'Staff Workspace', eyebrow: 'WEHOUSE STAFF', description: 'This account has conflicting staff assignments.' }}>
        <Empty title="Assignment needs correction" text="A WeHouse staff account uses one operational module at a time. Ask an Admin or the Creator to correct the assignment." />
      </StaffShell>
    );
  }

  const module = assigned[0];
  return (
    <StaffShell profile={profile} onLogout={onLogout} info={MODULE_INFO[module]}>
      {module === 'operations' && <OperationsModule />}
      {module === 'finance' && <FinanceModule />}
      {module === 'support' && <SupportModule />}
      {module === 'verification' && <VerificationModule />}
      {module === 'field_officer' && <FieldOfficerModule profile={profile} />}
    </StaffShell>
  );
}

function StaffShell({ profile, onLogout, info, children }: { profile: Profile; onLogout: () => void; info: ModuleInfo; children: React.ReactNode }) {
  const branch = [profile.assigned_lga, profile.assigned_state].filter(Boolean).join(', ');
  return (
    <div className="min-h-[100dvh] bg-[#070A10] text-white">
      <Toaster position="top-center" richColors />
      <header className="border-b border-white/[0.06] bg-[#0B0F17]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-5 lg:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[9px] font-bold tracking-[.24em] text-blue-400">{info.eyebrow}</p>
              <h1 className="mt-2 text-xl font-bold lg:text-2xl">{info.title}</h1>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#7D8294]">{info.description}</p>
              <p className="mt-2 truncate text-[9px] text-[#555B6C]">{branch || 'Branch assignment required'} · {profile.full_name || profile.username || profile.email}</p>
            </div>
            <button onClick={onLogout} className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-[#A2A5B4] hover:border-red-500/20 hover:text-red-300">Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}

function OperationsModule() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending_approval');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_staff_operations_listings', { p_status: filter });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [filter]);

  async function review(id: string, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) return toast.error('Add a rejection reason');
    const { error } = await supabase.rpc('review_my_staff_listing', {
      p_listing_id: id,
      p_decision: decision,
      p_reason: decision === 'reject' ? reason.trim() : null,
    });
    if (error) return toast.error(error.message);
    toast.success(decision === 'approve' ? 'Listing approved' : 'Listing rejected');
    setRejectId(null);
    setReason('');
    void load();
  }

  return (
    <Workspace
      stats={[
        ['In this view', rows.length],
        ['Pending review', rows.filter(row => row.status === 'pending_approval').length],
      ]}
      toolbar={<Select value={filter} onChange={setFilter} items={[['pending_approval', 'Pending approval'], ['available', 'Live'], ['rejected', 'Rejected'], ['all', 'All']]} />}
    >
      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty title="Queue clear" text="No listings match this queue in your assigned branch." />
      ) : (
        <Grid>
          {rows.map(row => (
            <Card key={row.id}>
              <Top title={row.title || 'Property'} sub={`${[row.city, row.state].filter(Boolean).join(', ')} · ${money(row.price)}`} status={row.status} />
              {row.status === 'pending_approval' && (
                rejectId === row.id ? (
                  <div className="mt-4 space-y-2">
                    <Textarea value={reason} onChange={setReason} placeholder="Reason for rejection" />
                    <div className="flex gap-2"><Button muted onClick={() => { setRejectId(null); setReason(''); }}>Cancel</Button><Button danger onClick={() => void review(row.id, 'reject')}>Reject listing</Button></div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-2"><Button onClick={() => void review(row.id, 'approve')}>Approve</Button><Button danger onClick={() => setRejectId(row.id)}>Reject</Button></div>
                )
              )}
            </Card>
          ))}
        </Grid>
      )}
    </Workspace>
  );
}

function FinanceModule() {
  const [data, setData] = useState<any>({ withdrawals: [], commissions: [] });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'withdrawals' | 'commissions'>('withdrawals');

  useEffect(() => {
    void (async () => {
      const { data: result, error } = await supabase.rpc('get_my_staff_finance_queue');
      if (error) toast.error(error.message);
      setData(result || { withdrawals: [], commissions: [] });
      setLoading(false);
    })();
  }, []);

  const withdrawals = data.withdrawals || [];
  const commissions = data.commissions || [];
  const rows = view === 'withdrawals' ? withdrawals : commissions;
  const withdrawalValue = withdrawals.reduce((total: number, row: any) => total + Number(row.amount || 0), 0);
  const commissionValue = commissions.reduce((total: number, row: any) => total + Number(row.commission_amount || 0), 0);

  return (
    <Workspace
      stats={[
        ['Withdrawals', withdrawals.length],
        ['Withdrawal value', money(withdrawalValue)],
        ['Commission records', commissions.length],
        ['Commission value', money(commissionValue)],
      ]}
      toolbar={<Segment value={view} onChange={value => setView(value as 'withdrawals' | 'commissions')} items={[['withdrawals', 'Withdrawals'], ['commissions', 'Commission']]} />}
    >
      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty title="No finance records" text="No canonical finance records are currently available in this branch queue." />
      ) : (
        <div className="space-y-3">
          {rows.map((row: any) => {
            const title = view === 'withdrawals' ? (row.snapshot_bank_account_name || row.bank_account_name || 'Withdrawal') : (row.booking_type || 'Commission');
            const amount = view === 'withdrawals' ? row.amount : row.commission_amount;
            const reference = row.reference_id || row.paystack_reference || row.id;
            return (
              <Card key={row.id}>
                <Top title={title} sub={`${new Date(row.created_at).toLocaleString()} · ${reference}`} status={row.status || 'recorded'} right={money(amount)} />
                {view === 'withdrawals' && <div className="mt-3 grid grid-cols-2 gap-2"><Info label="Bank" value={row.snapshot_bank_name || row.bank_name || '—'} /><Info label="Account" value={row.snapshot_bank_account_number || row.bank_account_number || '—'} /></div>}
              </Card>
            );
          })}
        </div>
      )}
    </Workspace>
  );
}

function SupportModule() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_staff_support_tickets', { p_status: filter });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [filter]);

  async function send(id: string, resolve: boolean) {
    if (!reply.trim()) return toast.error('Write a response');
    const { error } = await supabase.rpc('reply_my_staff_support_ticket', { p_ticket_id: id, p_reply: reply.trim(), p_resolve: resolve });
    if (error) return toast.error(error.message);
    toast.success(resolve ? 'Reply sent and ticket resolved' : 'Reply saved');
    setActive(null);
    setReply('');
    void load();
  }

  return (
    <Workspace
      stats={[
        ['Cases', rows.length],
        ['Open', rows.filter(row => row.status === 'open').length],
        ['In progress', rows.filter(row => row.status === 'in_progress').length],
      ]}
      toolbar={<Select value={filter} onChange={setFilter} items={[['all', 'All cases'], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']]} />}
    >
      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty title="Inbox clear" text="No support cases match this view in your assigned branch." />
      ) : (
        <div className="space-y-3">
          {rows.map(ticket => (
            <Card key={ticket.id}>
              <Top title={ticket.subject || ticket.user_email || 'Support case'} sub={ticket.message || ticket.description || 'No message'} status={ticket.status} />
              {ticket.reply && <div className="mt-3 rounded-xl border border-blue-500/10 bg-blue-500/[0.05] p-3 text-[10px] text-blue-200">Latest WeHouse reply: {ticket.reply}</div>}
              {ticket.status !== 'resolved' && (active === ticket.id ? (
                <div className="mt-4 space-y-2">
                  <Textarea value={reply} onChange={setReply} placeholder="Write the WeHouse response" />
                  <div className="flex gap-2"><Button muted onClick={() => { setActive(null); setReply(''); }}>Cancel</Button><Button muted onClick={() => void send(ticket.id, false)}>Save response</Button><Button onClick={() => void send(ticket.id, true)}>Reply & resolve</Button></div>
                </div>
              ) : <div className="mt-4"><Button onClick={() => setActive(ticket.id)}>Respond</Button></div>)}
            </Card>
          ))}
        </div>
      )}
    </Workspace>
  );
}

function VerificationModule() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('verification_paid');
  const [selected, setSelected] = useState<any | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_staff_worker_reviews', { p_status: filter });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [filter]);

  async function review(workerId: string, status: 'profile_under_review' | 'verified' | 'rejected' | 'suspended') {
    const { error } = await supabase.rpc('review_my_staff_worker', { p_worker_id: workerId, p_status: status });
    if (error) return toast.error(error.message);
    toast.success('Worker review updated');
    setSelected(null);
    void load();
  }

  if (selected) {
    return (
      <div className="space-y-5">
        <button onClick={() => setSelected(null)} className="text-[10px] font-semibold text-blue-400">← Back to review queue</button>
        <Card>
          <Top title={selected.full_name || selected.username || 'Worker'} sub={`${selected.worker_occupation || 'Occupation not supplied'} · ${[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}`} status={WORKER_STATUS_LABELS[selected.worker_status] || selected.worker_status} />
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {selected.worker_gov_id_url ? <Evidence title="Government ID" url={selected.worker_gov_id_url} /> : <Missing label="Government ID" />}
            {selected.worker_video_url ? <VideoEvidence title="Skill evidence" url={selected.worker_video_url} /> : <Missing label="Skill video" />}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.worker_status === 'verification_paid' && <Button muted onClick={() => void review(selected.user_id, 'profile_under_review')}>Start review</Button>}
            {['verification_paid', 'profile_under_review'].includes(selected.worker_status) && <Button onClick={() => void review(selected.user_id, 'verified')}>Verify worker</Button>}
            {['verification_paid', 'profile_under_review'].includes(selected.worker_status) && <Button danger onClick={() => void review(selected.user_id, 'rejected')}>Reject</Button>}
            {selected.worker_status === 'verified' && <Button danger onClick={() => void review(selected.user_id, 'suspended')}>Suspend</Button>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <Workspace stats={[['In this stage', rows.length]]} toolbar={<Select value={filter} onChange={setFilter} items={[['verification_paid', 'Awaiting review'], ['profile_under_review', 'Under review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['all', 'All']]} />}>
      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty title="Review queue clear" text="No worker applications match this stage in your assigned branch." />
      ) : (
        <Grid>
          {rows.map(worker => (
            <button key={worker.user_id} onClick={() => setSelected(worker)} className="rounded-2xl border border-white/[0.06] bg-[#10141D] p-4 text-left hover:border-blue-500/30">
              <Top title={worker.full_name || worker.username || 'Worker'} sub={`${worker.worker_occupation || 'Occupation not supplied'} · ${[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}`} status={WORKER_STATUS_LABELS[worker.worker_status] || worker.worker_status} />
              <p className="mt-3 text-[9px] font-semibold text-blue-400">OPEN EVIDENCE →</p>
            </button>
          ))}
        </Grid>
      )}
    </Workspace>
  );
}

function FieldOfficerModule({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [report, setReport] = useState('');
  const [condition, setCondition] = useState('good');
  const [postId, setPostId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', price: '', description: '', bedrooms: '1', bathrooms: '1' });

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_inspections', { p_field_officer_id: profile.user_id });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [profile.user_id]);

  async function move(id: string, next: string) {
    const args: Record<string, unknown> = { p_inspection_id: id, p_new_status: next, p_source: 'user' };
    if (next === 'completed') {
      if (!report.trim()) return toast.error('Inspection report is required');
      args.p_report = report.trim();
      args.p_condition = condition;
    }
    const { error } = await supabase.rpc('update_inspection_status', args);
    if (error) return toast.error(error.message);
    toast.success(next === 'completed' ? 'Inspection completed' : 'Inspection started');
    setCompleteId(null);
    setReport('');
    void load();
  }

  function prepare(row: any) {
    setPostId(row.id);
    setForm({
      title: `${row.property_type || 'Property'} in ${row.property_city || ''}`.trim(),
      price: String(row.expected_rent || ''),
      description: row.notes || '',
      bedrooms: String(row.bedrooms || 1),
      bathrooms: String(row.bathrooms || 1),
    });
  }

  async function publish(row: any) {
    if (!form.title.trim() || Number(form.price) <= 0) return toast.error('Title and valid price are required');
    const { error } = await supabase.rpc('post_property_from_inspection', {
      p_data: {
        inspection_id: row.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        state: row.property_state,
        city: row.property_city,
        address: row.property_address,
        bedrooms: Number(form.bedrooms) || 1,
        bathrooms: Number(form.bathrooms) || 1,
        property_type: row.property_type || 'apartment',
        images: row.photo_urls || [],
        videos: [],
      },
    });
    if (error) return toast.error(error.message);
    toast.success('Listing prepared and sent to Operations');
    setPostId(null);
    void load();
  }

  return (
    <Workspace stats={[
      ['Assigned', rows.length],
      ['Scheduled', rows.filter(row => row.status === 'scheduled').length],
      ['In progress', rows.filter(row => row.status === 'in_progress').length],
      ['Completed', rows.filter(row => ['completed', 'approved'].includes(row.status)).length],
    ]}>
      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty title="No field work assigned" text="New property inspections assigned directly to you will appear here." />
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <Card key={row.id}>
              <Top title={row.property_address || 'Property inspection'} sub={`${[row.property_city, row.property_state].filter(Boolean).join(', ')} · ${row.request_code || ''}`} status={row.status} />
              {row.photo_urls?.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{row.photo_urls.map((url: string) => <img key={url} src={url} alt="Property evidence" className="h-24 w-28 rounded-xl object-cover" />)}</div>}
              {row.status === 'scheduled' && <div className="mt-4"><Button onClick={() => void move(row.id, 'in_progress')}>Start inspection</Button></div>}
              {row.status === 'in_progress' && (completeId === row.id ? (
                <div className="mt-4 space-y-2">
                  <Textarea value={report} onChange={setReport} placeholder="Inspection report" />
                  <Select value={condition} onChange={setCondition} items={[['excellent', 'Excellent'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor']]} />
                  <div className="flex gap-2"><Button muted onClick={() => setCompleteId(null)}>Cancel</Button><Button onClick={() => void move(row.id, 'completed')}>Complete inspection</Button></div>
                </div>
              ) : <div className="mt-4"><Button onClick={() => setCompleteId(row.id)}>Complete inspection</Button></div>)}
              {['completed', 'approved'].includes(row.status) && !row.draft_listing_id && (postId === row.id ? (
                <div className="mt-4 grid gap-2">
                  <Input value={form.title} onChange={value => setForm({ ...form, title: value })} placeholder="Listing title" />
                  <Input value={form.price} onChange={value => setForm({ ...form, price: value })} placeholder="Rent / price" type="number" />
                  <Textarea value={form.description} onChange={value => setForm({ ...form, description: value })} placeholder="Listing description" />
                  <div className="grid grid-cols-2 gap-2"><Input value={form.bedrooms} onChange={value => setForm({ ...form, bedrooms: value })} placeholder="Bedrooms" type="number" /><Input value={form.bathrooms} onChange={value => setForm({ ...form, bathrooms: value })} placeholder="Bathrooms" type="number" /></div>
                  <div className="flex gap-2"><Button muted onClick={() => setPostId(null)}>Cancel</Button><Button onClick={() => void publish(row)}>Send to Operations</Button></div>
                </div>
              ) : <div className="mt-4"><Button onClick={() => prepare(row)}>Prepare listing</Button></div>)}
              {row.draft_listing_id && <div className="mt-4 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.05] p-3 text-[10px] text-emerald-300">Listing has been prepared and handed to Operations.</div>}
            </Card>
          ))}
        </div>
      )}
    </Workspace>
  );
}

function Workspace({ stats = [], toolbar, children }: { stats?: Array<[string, string | number]>; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-5">{(stats.length > 0 || toolbar) && <div className="flex flex-wrap items-end justify-between gap-3"><div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">{stats.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.06] bg-[#10141D] p-3"><p className="text-[9px] text-[#64697B]">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}</div>{toolbar}</div>}{children}</div>;
}
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>; }
function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-white/[0.06] bg-[#10141D] p-4">{children}</div>; }
function Top({ title, sub, status, right }: { title: string; sub: string; status: string; right?: string }) { return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-[#707587]">{sub}</p></div><div className="shrink-0 text-right">{right && <p className="mb-1 text-sm font-bold">{right}</p>}<Badge value={status} /></div></div>; }
function Button({ children, onClick, muted, danger }: { children: React.ReactNode; onClick: () => void; muted?: boolean; danger?: boolean }) { return <button onClick={onClick} className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold transition ${danger ? 'border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/15' : muted ? 'border border-white/[0.08] bg-white/[0.04] text-[#A4A7B5] hover:bg-white/[0.07]' : 'bg-blue-500 text-white hover:bg-blue-400'}`}>{children}</button>; }
function Select({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: string[][] }) { return <select value={value} onChange={event => onChange(event.target.value)} className="h-10 rounded-xl border border-white/[0.08] bg-[#121722] px-3 text-[10px] text-white outline-none">{items.map(([itemValue, label]) => <option key={itemValue} value={itemValue}>{label}</option>)}</select>; }
function Segment({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: string[][] }) { return <div className="flex rounded-xl border border-white/[0.06] bg-[#0C1018] p-1">{items.map(([itemValue, label]) => <button key={itemValue} onClick={() => onChange(itemValue)} className={`rounded-lg px-3 py-2 text-[9px] font-semibold ${value === itemValue ? 'bg-blue-500 text-white' : 'text-[#74798B]'}`}>{label}</button>)}</div>; }
function Input({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (value: string) => void; placeholder: string; type?: string }) { return <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} type={type} className="h-10 rounded-xl border border-white/[0.08] bg-[#151A24] px-3 text-xs text-white outline-none" />; }
function Textarea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-white/[0.08] bg-[#151A24] p-3 text-xs text-white outline-none" />; }
function Badge({ value }: { value: string }) { const normalized = String(value || 'unknown').toLowerCase(); const good = ['available', 'approved', 'completed', 'resolved', 'verified', 'paid'].some(item => normalized.includes(item)); const bad = ['rejected', 'suspended', 'failed', 'cancelled'].some(item => normalized.includes(item)); return <span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{String(value || 'unknown').replace(/_/g, ' ')}</span>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[0.025] p-2"><p className="text-[8px] text-[#5F6475]">{label}</p><p className="mt-1 truncate text-[10px] text-[#B9BCC7]">{value}</p></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-16 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#666B7D]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-44 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>; }
function PageLoading() { return <div className="grid min-h-screen place-items-center bg-[#070A10]"><Loading /></div>; }
function Missing({ label }: { label: string }) { return <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-[10px] text-red-300">No {label} uploaded</div>; }
function Evidence({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6B7081]">{title}</p><img src={url} alt={title} className="max-h-64 w-full rounded-2xl bg-[#0C1018] object-contain" /></div>; }
function VideoEvidence({ title, url }: { title: string; url: string }) { return <div><p className="mb-2 text-[9px] text-[#6B7081]">{title}</p><video src={url} controls className="max-h-64 w-full rounded-2xl bg-[#0C1018]" /></div>; }
function money(value: unknown) { return `₦${Number(value || 0).toLocaleString('en-NG')}`; }
