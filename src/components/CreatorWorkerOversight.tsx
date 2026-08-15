import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Worker = any;
type Checks = {
  payment_confirmed?: boolean;
  identity_status?: string;
  identity_captured?: boolean;
  identity_passed?: boolean;
  readiness_passed?: boolean;
  readiness_percent?: number | null;
  evidence_saved?: boolean;
  submitted?: boolean;
  review_status?: string | null;
};

export default function CreatorWorkerOversight() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [selected, setSelected] = useState<Worker | null>(null);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: 'worker' });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function open(worker: Worker) {
    setSelected(worker);
    setChecks(null);
    setLoadingChecks(true);
    const { data, error } = await supabase.rpc('admin_get_worker_review_trust_status', { p_worker_id: worker.user_id });
    if (error) toast.error(error.message);
    else setChecks((data || null) as Checks | null);
    setLoadingChecks(false);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((worker) => {
      if (filter !== 'all' && worker.worker_status !== filter) return false;
      if (!q) return true;
      return [worker.full_name, worker.username, worker.email, worker.worker_occupation, worker.worker_status, worker.state, worker.local_government, worker.city].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-[10px] font-semibold text-violet-400">← Back to Worker oversight</button>
        <section className="rounded-3xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">WORKER OVERSIGHT</p><h2 className="mt-2 text-lg font-bold">{selected.full_name || selected.username || 'Worker'}</h2><p className="mt-1 text-[10px] text-[#707687]">{selected.worker_occupation || 'Occupation not set'} · {[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ') || 'Location not set'}</p></div>
            <Status value={selected.worker_status || 'pending'} />
          </div>

          <div className="mt-4 rounded-2xl border border-violet-500/10 bg-violet-500/[.03] p-3 text-[9px] leading-relaxed text-[#878D9C]">Creator can monitor the Worker lifecycle here. Routine identity/professional approval belongs to trusted Verification Staff, so this screen deliberately has no normal Approve/Reject button.</div>

          {loadingChecks ? <Loading /> : (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Check label="Private identity" value={checks?.identity_passed ? 'Passed' : checks?.identity_captured ? 'Captured' : 'Not complete'} good={!!checks?.identity_passed} />
              <Check label="Payment" value={checks?.payment_confirmed ? 'Confirmed' : 'Not confirmed'} good={!!checks?.payment_confirmed} />
              <Check label="Readiness" value={checks?.readiness_passed ? `Passed${checks?.readiness_percent != null ? ` · ${checks.readiness_percent}%` : ''}` : 'Not passed'} good={!!checks?.readiness_passed} />
              <Check label="Work evidence" value={checks?.evidence_saved ? 'Saved' : 'Missing'} good={!!checks?.evidence_saved} />
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Info label="Public" value={selected.worker_status === 'verified' && selected.worker_verified ? 'Yes' : 'No'} />
            <Info label="Available" value={selected.available ? 'Yes' : 'No'} />
            <Info label="Rating" value={Number(selected.rating || 0) ? Number(selected.rating).toFixed(1) : 'New'} />
            <Info label="Reviews" value={Number(selected.review_count || 0)} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-bold">Worker oversight</h2><p className="mt-1 text-[10px] text-[#707687]">Monitor Worker lifecycle and verification progress. Verification Staff own routine review decisions.</p></div>
      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_auto]">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Worker, service or location" className="h-11 rounded-xl border border-white/[.08] bg-[#141720] px-3 text-xs outline-none focus:border-violet-500/40" />
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">{[['all','All'],['pending','Pending'],['verification_paid','Verification'],['profile_under_review','Under review'],['verified','Reviewed/live'],['rejected','Needs changes'],['suspended','Suspended']].map(([id,label]) => <button key={id} onClick={() => setFilter(id)} className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-semibold ${filter === id ? 'bg-violet-500 text-white' : 'border border-white/[.06] text-[#777D8D]'}`}>{label}</button>)}</div>
      </div>
      {loading ? <Loading /> : shown.length === 0 ? <Empty /> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{shown.map((worker) => <button key={worker.user_id} onClick={() => void open(worker)} className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{worker.full_name || worker.username || 'Worker'}</p><p className="mt-1 truncate text-[9px] text-[#686F7F]">{worker.worker_occupation || 'Service not set'} · {[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ') || 'Location not set'}</p></div><Status value={worker.worker_status || 'pending'} /></div><p className="mt-3 text-[9px] font-semibold text-violet-400">VIEW OVERSIGHT →</p></button>)}</div>}
    </div>
  );
}

function Check({ label, value, good }: { label: string; value: string; good: boolean }) { return <div className={`rounded-xl border p-3 ${good ? 'border-emerald-500/12 bg-emerald-500/[.035]' : 'border-white/[.06] bg-black/10'}`}><p className="text-[8px] uppercase text-[#62697A]">{label}</p><p className={`mt-1 text-[10px] font-semibold ${good ? 'text-emerald-300' : 'text-[#A0A6B4]'}`}>{value}</p></div>; }
function Info({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[8px] uppercase text-[#62697A]">{label}</p><p className="mt-1 text-[10px] font-semibold text-[#A0A6B4]">{value}</p></div>; }
function Status({ value }: { value: string }) { const v = String(value); const good = v === 'verified'; const bad = ['rejected','suspended'].includes(v); return <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${good ? 'bg-emerald-500/10 text-emerald-300' : bad ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{v.replace(/_/g,' ')}</span>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function Empty() { return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">No Workers match this view.</div>; }
