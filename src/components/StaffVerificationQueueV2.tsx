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
type TestAttempt = { percent?: number | null; passed?: boolean | null; submitted_at?: string | null };
type IdentityCheck = {
  status?: string | null;
  face_match_score?: number | null;
  liveness_score?: number | null;
  anti_spoof_score?: number | null;
  challenge_version?: string | null;
  captured_at?: string | null;
  attempt_count?: number | null;
};

export default function StaffVerificationQueueV2() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [selected, setSelected] = useState<Worker | null>(null);
  const [verification, setVerification] = useState<ReviewEvidence | null>(null);
  const [identity, setIdentity] = useState<IdentityCheck | null>(null);
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

  useEffect(() => { void load(); }, []);

  const shown = useMemo(
    () => rows.filter((worker) => !search.trim() || [worker.full_name, worker.username, worker.worker_occupation, worker.state, worker.local_government, worker.city].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  async function open(worker: Worker) {
    setSelected(worker);
    setReason('');
    setNotes('');
    const [verificationResult, identityResult, testResult, historyResult] = await Promise.all([
      supabase.from('worker_verifications').select('certificate_path,verification_video_url,years_of_experience,status').eq('worker_id', worker.user_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc('get_staff_worker_identity_check', { p_worker_id: worker.user_id }),
      supabase.from('worker_test_attempts').select('percent,passed,submitted_at').eq('worker_id', worker.user_id).eq('passed', true).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('worker_verification_reviews').select('*').eq('worker_id', worker.user_id).order('created_at', { ascending: false }).limit(12),
    ]);
    if (identityResult.error) toast.error(identityResult.error.message);
    setVerification(verificationResult.data || null);
    setIdentity((identityResult.data || null) as IdentityCheck | null);
    setTest(testResult.data || null);
    setHistory(historyResult.data || []);
  }

  async function act(status: 'verified' | 'rejected') {
    if (!selected) return;
    if (status === 'verified' && identity?.status !== 'passed') return toast.error('The automated private face check must pass first');
    if (status === 'verified' && !test?.passed) return toast.error('The Worker readiness check must be passed before approval');
    if (status === 'verified' && !verification?.verification_video_url) return toast.error('A work demonstration video is required before approval');
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

    toast.success(status === 'verified' ? 'Worker reviewed and made live' : 'Professional review rejected');
    setSelected(null);
    setVerification(null);
    setIdentity(null);
    setTest(null);
    setHistory([]);
    void load();
  }

  if (selected) {
    const identityPassed = identity?.status === 'passed';
    const professionalReady = Boolean(test?.passed && verification?.verification_video_url);
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-[10px] font-semibold text-violet-400">← Back to Worker reviews</button>

        <section className="rounded-3xl border border-white/[.06] bg-[#10141D] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE WORKER REVIEW</p>
              <h2 className="mt-2 text-lg font-bold">{selected.full_name || selected.username || 'Worker'}</h2>
              <p className="mt-1 text-[10px] text-[#747A8B]">{selected.worker_occupation || 'Occupation not set'} · {[selected.local_government || selected.city, selected.state].filter(Boolean).join(', ')}</p>
            </div>
            <Status value={selected.worker_status} />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Automated private face check</p>
                  <p className="mt-1 text-[9px] leading-relaxed text-[#73798A]">WeHouse already compared the Worker’s private live selfie with the live camera session and detected the required head movements automatically. No government ID and no liveness video is provided to Staff.</p>
                </div>
                <IdentityBadge passed={identityPassed} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <Metric label="Face match" value={score(identity?.face_match_score)} />
                <Metric label="Liveness" value={score(identity?.liveness_score)} />
                <Metric label="Anti-spoof" value={score(identity?.anti_spoof_score)} />
                <Metric label="Attempts" value={String(identity?.attempt_count ?? 0)} />
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-[#666D7E]">{identityPassed ? `Passed${identity?.captured_at ? ` · ${new Date(identity.captured_at).toLocaleString()}` : ''}` : 'This Worker should not be in the final queue until the automatic face check passes.'}</p>
            </section>

            <section className="rounded-2xl border border-white/[.06] bg-black/10 p-4">
              <p className="text-xs font-semibold">Professional work</p>
              <p className="mt-1 text-[9px] leading-relaxed text-[#73798A]">This is the human review: check readiness, service experience and real work evidence. Payment is not a trust signal.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Info label="Readiness" value={test?.passed ? `Passed${test?.percent != null ? ` · ${test.percent}%` : ''}` : 'Not passed'} />
                <Info label="Experience" value={selected.worker_experience || verification?.years_of_experience || 'Not supplied'} />
                <Info label="Service" value={selected.worker_occupation || 'Not supplied'} />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Evidence label="Certificate · optional" path={verification?.certificate_path || selected.worker_cert_url} bucket="worker-certificates" />
                <Evidence label="Work demonstration · required" path={verification?.verification_video_url || selected.worker_video_url} bucket="worker-verification-videos" />
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-white/[.06] bg-[#0D1118] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs font-semibold">Final WeHouse review</p><p className="mt-1 text-[9px] text-[#73798A]">Approval publishes the Worker as WeHouse Reviewed. WeHouse Trusted is earned later from marketplace performance.</p></div>
              <div className="flex gap-2"><Check good={identityPassed}>Face check</Check><Check good={professionalReady}>Professional</Check></div>
            </div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Professional review notes (optional)" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs outline-none focus:border-violet-500/40" />
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required only when rejecting" className="mt-3 h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs outline-none focus:border-violet-500/40" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void act('verified')} disabled={saving || !identityPassed || !professionalReady}>Approve & publish</Button>
              <Button danger onClick={() => void act('rejected')} disabled={saving}>Reject with reason</Button>
            </div>
          </section>
        </section>

        {history.length > 0 && <section><h3 className="mb-3 text-sm font-bold">Review history</h3><div className="space-y-2">{history.map((item) => <div key={item.id} className="rounded-xl border border-white/[.06] bg-[#10141D] p-3"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold capitalize">{String(item.action || 'review').replace(/_/g, ' ')}</p><p className="text-[9px] text-[#555C6D]">{new Date(item.created_at).toLocaleString()}</p></div>{(item.rejection_reason || item.notes) && <p className="mt-2 text-[10px] leading-relaxed text-[#858A99]">{item.rejection_reason || item.notes}</p>}</div>)}</div></section>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-bold">Worker reviews</h2><p className="mt-1 text-[10px] text-[#707687]">Only Workers who already passed the automated private face check and completed their work-verification requirements should reach this professional review queue. Payment alone never enters the queue.</p></div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Worker reviews" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151E] px-4 text-xs outline-none focus:border-violet-500/35" />
      {loading ? <Empty text="Loading Worker reviews…" /> : shown.length === 0 ? <Empty text="No Worker verification is waiting for review." /> : <div className="space-y-2">{shown.map((worker) => <button key={worker.user_id} onClick={() => void open(worker)} className="flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-[#10141D] p-4 text-left hover:border-violet-500/25"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{worker.full_name || worker.username || 'Worker'}</p><p className="mt-1 truncate text-[10px] text-[#666D7E]">{worker.worker_occupation || 'Occupation not set'} · {[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}</p></div><Status value={worker.worker_status} /></button>)}</div>}
    </div>
  );
}

function Evidence({ label, path, bucket }: { label: string; path?: string | null; bucket: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    if (!path) { setUrl(''); return; }
    if (path.startsWith('http')) { setUrl(path); return; }
    void supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => { if (active) setUrl(data?.signedUrl || ''); });
    return () => { active = false; };
  }, [path, bucket]);
  return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[9px] font-semibold">{label}</p>{url ? <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-violet-400">Open evidence →</a> : <p className="mt-2 text-[10px] text-[#606778]">Not supplied</p>}</div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.05] bg-black/10 p-3"><p className="text-[8px] uppercase text-[#62697A]">{label}</p><p className="mt-1 text-[10px] font-semibold text-[#A6ACB9]">{value}</p></div>; }
function Info({ label, value }: { label: string; value: any }) { return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[8px] uppercase text-[#62697A]">{label}</p><p className="mt-1 text-[10px] text-[#A4A9B8]">{String(value)}</p></div>; }
function IdentityBadge({ passed }: { passed: boolean }) { return <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${passed ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{passed ? 'PASSED' : 'NOT PASSED'}</span>; }
function Status({ value }: { value: string }) { return <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] capitalize text-violet-300">{String(value || 'pending').replace(/_/g, ' ')}</span>; }
function Check({ good, children }: { good: boolean; children: React.ReactNode }) { return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${good ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{good ? '✓ ' : '• '}{children}</span>; }
function Button({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2.5 text-[10px] font-semibold disabled:opacity-35 ${danger ? 'bg-red-500/15 text-red-300' : 'bg-violet-500 text-white'}`}>{children}</button>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">{text}</div>; }
function score(value?: number | null) { return value == null ? '—' : `${Math.round(Number(value) * 100)}%`; }
