import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Worker = any;

type ReviewEvidence = {
  certificate_path?: string | null;
  verification_video_url?: string | null;
  years_of_experience?: number | null;
  status?: string | null;
};

type TestAttempt = {
  percent?: number | null;
  passed?: boolean | null;
  submitted_at?: string | null;
};

export default function StaffVerificationQueueV2() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [selected, setSelected] = useState<Worker | null>(null);
  const [verification, setVerification] = useState<ReviewEvidence | null>(null);
  const [test, setTest] = useState<TestAttempt | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_staff_worker_reviews', { p_status: 'profile_under_review' });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(
    () => rows.filter((worker) => !search.trim() || [worker.full_name, worker.username, worker.email, worker.worker_occupation, worker.state, worker.local_government, worker.city].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  async function open(worker: Worker) {
    setSelected(worker);
    setReason('');
    setNotes('');
    const [verificationResult, testResult, historyResult] = await Promise.all([
      supabase
        .from('worker_verifications')
        .select('certificate_path,verification_video_url,years_of_experience,status')
        .eq('worker_id', worker.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('worker_test_attempts')
        .select('percent,passed,submitted_at')
        .eq('worker_id', worker.user_id)
        .eq('passed', true)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('worker_verification_reviews')
        .select('*')
        .eq('worker_id', worker.user_id)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);
    setVerification(verificationResult.data || null);
    setTest(testResult.data || null);
    setHistory(historyResult.data || []);
  }

  async function act(status: 'verified' | 'rejected') {
    if (!selected) return;
    if (status === 'verified' && !verification?.verification_video_url) return toast.error('A skill demonstration video is required before approval');
    if (status === 'verified' && !test?.passed) return toast.error('The Worker readiness check must be passed before approval');
    if (status === 'rejected' && !reason.trim()) return toast.error('Enter the rejection reason');

    setSaving(true);
    const { error } = await supabase.rpc('review_my_staff_worker_v2', {
      p_worker_id: selected.user_id,
      p_status: status,
      p_reason: status === 'rejected' ? reason.trim() : null,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);

    toast.success(status === 'verified' ? 'Worker approved and made live' : 'Professional review rejected');
    setSelected(null);
    setVerification(null);
    setTest(null);
    setHistory([]);
    void load();
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-[10px] font-semibold text-violet-400">← Back to Worker reviews</button>

        <section className="rounded-3xl border border-white/[.06] bg-[#10141D] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE PROFESSIONAL REVIEW</p>
              <h2 className="mt-2 text-lg font-bold">{selected.full_name || selected.username || 'Worker'}</h2>
              <p className="mt-1 text-[10px] text-[#747A8B]">{selected.worker_occupation || 'Occupation not set'} · {[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}</p>
            </div>
            <Status value={selected.worker_status} />
          </div>

          <section className="mt-4 rounded-2xl border border-white/[.06] bg-black/10 p-4">
            <p className="text-xs font-semibold">What you are reviewing</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#73798A]">
              Review the Worker’s professional profile, readiness result, skill demonstration and any optional certificate. WeHouse does not ask Verification Staff to inspect government ID.
            </p>
          </section>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Info label="Readiness result" value={test?.passed ? `Passed${test?.percent != null ? ` · ${test.percent}%` : ''}` : 'Not passed'} />
            <Info label="Experience" value={selected.worker_experience || verification?.years_of_experience || 'Not supplied'} />
            <Info label="Service category" value={selected.worker_occupation || 'Not supplied'} />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Evidence label="Professional certificate · optional" path={verification?.certificate_path || selected.worker_cert_url} bucket="worker-certificates" />
            <Evidence label="Skill demonstration video · required" path={verification?.verification_video_url || selected.worker_video_url} bucket="worker-verification-videos" />
          </div>

          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Professional review notes (optional)" className="mt-4 w-full rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs outline-none focus:border-violet-500/40" />
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required only when rejecting" className="mt-3 h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs outline-none focus:border-violet-500/40" />

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void act('verified')} disabled={saving || !test?.passed || !verification?.verification_video_url}>Approve professional</Button>
            <Button danger onClick={() => void act('rejected')} disabled={saving}>Reject with reason</Button>
          </div>
          {(!test?.passed || !verification?.verification_video_url) && (
            <p className="mt-2 text-[9px] text-[#6D7485]">Approval stays locked until the Worker has passed the readiness check and supplied the required skill demonstration video.</p>
          )}
        </section>

        {history.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-bold">Professional review history</h3>
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/[.06] bg-[#10141D] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold capitalize">{String(item.action || 'review').replace(/_/g, ' ')}</p>
                    <p className="text-[9px] text-[#555C6D]">{new Date(item.created_at).toLocaleString()}</p>
                  </div>
                  {(item.rejection_reason || item.notes) && <p className="mt-2 text-[10px] leading-relaxed text-[#858A99]">{item.rejection_reason || item.notes}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Worker reviews</h2>
        <p className="mt-1 text-[10px] text-[#707687]">Only Workers who finished their professional checks and manually submitted for review appear here. Payment alone never enters this queue.</p>
      </div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search submitted Worker reviews" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151E] px-4 text-xs outline-none focus:border-violet-500/35" />
      {loading ? (
        <Empty text="Loading Worker reviews…" />
      ) : shown.length === 0 ? (
        <Empty text="No submitted Worker verification is waiting for professional review." />
      ) : (
        <div className="space-y-2">
          {shown.map((worker) => (
            <button key={worker.user_id} onClick={() => void open(worker)} className="flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-[#10141D] p-4 text-left hover:border-violet-500/25">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{worker.full_name || worker.username || 'Worker'}</p>
                <p className="mt-1 truncate text-[10px] text-[#666D7E]">{worker.worker_occupation || 'Occupation not set'} · {[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}</p>
              </div>
              <Status value={worker.worker_status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Evidence({ label, path, bucket }: { label: string; path?: string | null; bucket: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    if (path.startsWith('http')) return void setUrl(path);
    void supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl || null));
  }, [path, bucket]);
  return (
    <div className="rounded-xl border border-white/[.06] bg-black/10 p-3">
      <p className="text-[9px] font-semibold">{label}</p>
      {url ? <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-violet-400">Open evidence →</a> : <p className="mt-2 text-[10px] text-[#606778]">Not supplied</p>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[9px] uppercase text-[#62697A]">{label}</p><p className="mt-1 text-[10px] text-[#A4A9B8]">{String(value)}</p></div>;
}

function Status({ value }: { value: string }) {
  return <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] capitalize text-violet-300">{String(value || 'pending').replace(/_/g, ' ')}</span>;
}

function Button({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2.5 text-[10px] font-semibold disabled:opacity-35 ${danger ? 'bg-red-500/15 text-red-300' : 'bg-violet-500 text-white'}`}>{children}</button>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">{text}</div>;
}
