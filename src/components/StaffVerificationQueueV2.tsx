import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Worker = any;
type ReviewEvidence = { certificate_path?: string | null; verification_video_url?: string | null; years_of_experience?: number | null; status?: string | null };
type TestAttempt = { percent?: number | null; passed?: boolean | null; submitted_at?: string | null };
type IdentityCheck = {
  status: 'not_started' | 'pending_review' | 'passed' | 'failed';
  photo_path?: string | null;
  liveness_path?: string | null;
  challenge_version?: string | null;
  captured_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  attempt_count?: number;
};

export default function StaffVerificationQueueV2() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [selected, setSelected] = useState<Worker | null>(null);
  const [verification, setVerification] = useState<ReviewEvidence | null>(null);
  const [identity, setIdentity] = useState<IdentityCheck | null>(null);
  const [identityPhotoUrl, setIdentityPhotoUrl] = useState('');
  const [identityVideoUrl, setIdentityVideoUrl] = useState('');
  const [test, setTest] = useState<TestAttempt | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [identityReason, setIdentityReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_staff_worker_reviews', { p_status: 'profile_under_review' });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const shown = useMemo(
    () => rows.filter((worker) => !search.trim() || [worker.full_name, worker.username, worker.email, worker.worker_occupation, worker.state, worker.local_government, worker.city].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  async function signed(bucket: string, path?: string | null) {
    if (!path) return '';
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl || '';
  }

  async function loadIdentity(workerId: string) {
    const { data, error } = await supabase.rpc('get_staff_worker_identity_check', { p_worker_id: workerId });
    if (error) {
      toast.error(error.message);
      setIdentity(null);
      setIdentityPhotoUrl('');
      setIdentityVideoUrl('');
      return;
    }
    const value = (data || null) as IdentityCheck | null;
    setIdentity(value);
    const [photo, video] = await Promise.all([
      signed('worker-identity-private', value?.photo_path),
      signed('worker-identity-private', value?.liveness_path),
    ]);
    setIdentityPhotoUrl(photo);
    setIdentityVideoUrl(video);
  }

  async function open(worker: Worker) {
    setSelected(worker);
    setReason('');
    setIdentityReason('');
    setNotes('');
    const [verificationResult, testResult, historyResult] = await Promise.all([
      supabase.from('worker_verifications').select('certificate_path,verification_video_url,years_of_experience,status').eq('worker_id', worker.user_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('worker_test_attempts').select('percent,passed,submitted_at').eq('worker_id', worker.user_id).eq('passed', true).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('worker_verification_reviews').select('*').eq('worker_id', worker.user_id).order('created_at', { ascending: false }).limit(12),
    ]);
    setVerification(verificationResult.data || null);
    setTest(testResult.data || null);
    setHistory(historyResult.data || []);
    await loadIdentity(worker.user_id);
  }

  async function reviewIdentity(decision: 'pass' | 'fail') {
    if (!selected) return;
    if (decision === 'fail' && !identityReason.trim()) return toast.error('Enter why the private identity check failed');
    setIdentitySaving(true);
    const { error } = await supabase.rpc('review_my_staff_worker_identity_check', {
      p_worker_id: selected.user_id,
      p_decision: decision,
      p_reason: decision === 'fail' ? identityReason.trim() : null,
    });
    setIdentitySaving(false);
    if (error) return toast.error(error.message);
    if (decision === 'fail') {
      toast.success('Identity check returned to the Worker for retry');
      setSelected(null);
      setIdentity(null);
      setIdentityPhotoUrl('');
      setIdentityVideoUrl('');
      void load();
      return;
    }
    toast.success('Identity & liveness check passed');
    setIdentityReason('');
    await loadIdentity(selected.user_id);
  }

  async function act(status: 'verified' | 'rejected') {
    if (!selected) return;
    if (status === 'verified' && identity?.status !== 'passed') return toast.error('Pass the private identity & liveness check first');
    if (status === 'verified' && !verification?.verification_video_url) return toast.error('A work demonstration video is required before approval');
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

    toast.success(status === 'verified' ? 'Worker reviewed and made live' : 'Professional review rejected');
    setSelected(null);
    setVerification(null);
    setIdentity(null);
    setIdentityPhotoUrl('');
    setIdentityVideoUrl('');
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
                <div><p className="text-xs font-semibold">Identity & liveness</p><p className="mt-1 text-[9px] leading-relaxed text-[#73798A]">Private WeHouse evidence only. No government ID. Confirm the same person appears in the enrollment photo and completes the head-turn challenge naturally.</p></div>
                <IdentityBadge status={identity?.status || 'not_started'} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="overflow-hidden rounded-xl border border-white/[.06] bg-black/20">
                  {identityPhotoUrl ? <img src={identityPhotoUrl} alt="Private Worker enrollment" className="aspect-square w-full object-cover" /> : <Missing text="No private photo" />}
                  <p className="px-2 py-2 text-[8px] text-[#62697A]">PRIVATE PHOTO · NOT PUBLIC</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-white/[.06] bg-black/20">
                  {identityVideoUrl ? <video src={identityVideoUrl} controls playsInline className="aspect-square w-full bg-black object-contain" /> : <Missing text="No liveness video" />}
                  <p className="px-2 py-2 text-[8px] text-[#62697A]">CENTER → LEFT → RIGHT → CENTER</p>
                </div>
              </div>

              {identity?.status === 'pending_review' && (
                <div className="mt-3 space-y-2">
                  <input value={identityReason} onChange={(event) => setIdentityReason(event.target.value)} placeholder="Reason only if failing identity check" className="h-10 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-[10px] outline-none focus:border-violet-500/40" />
                  <div className="flex gap-2">
                    <Button onClick={() => void reviewIdentity('pass')} disabled={identitySaving || !identityPhotoUrl || !identityVideoUrl}>Pass identity check</Button>
                    <Button danger onClick={() => void reviewIdentity('fail')} disabled={identitySaving}>Fail & retry</Button>
                  </div>
                </div>
              )}
              {identity?.status === 'failed' && <p className="mt-3 rounded-xl bg-red-500/[.06] p-3 text-[9px] text-red-200">{identity.rejection_reason || 'Worker must repeat the private identity check.'}</p>}
            </section>

            <section className="rounded-2xl border border-white/[.06] bg-black/10 p-4">
              <p className="text-xs font-semibold">Professional work</p>
              <p className="mt-1 text-[9px] leading-relaxed text-[#73798A]">Review readiness, experience and actual work evidence. Payment is not a trust signal.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Info label="Readiness" value={test?.passed ? `Passed${test?.percent != null ? ` · ${test.percent}%` : ''}` : 'Not passed'} />
                <Info label="Experience" value={selected.worker_experience || verification?.years_of_experience || 'Not supplied'} />
                <Info label="Service" value={selected.worker_occupation || 'Not supplied'} />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Evidence label="Certificate · optional" path={verification?.certificate_path || selected.worker_cert_url} bucket="worker-certificates" />
                <Evidence label="Work video · required" path={verification?.verification_video_url || selected.worker_video_url} bucket="worker-verification-videos" />
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-white/[.06] bg-[#0D1118] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs font-semibold">Final WeHouse review</p><p className="mt-1 text-[9px] text-[#73798A]">Approval publishes the Worker as WeHouse Reviewed. WeHouse Trusted is earned later from marketplace performance.</p></div>
              <div className="flex gap-2"><Check good={identityPassed}>Identity</Check><Check good={professionalReady}>Professional</Check></div>
            </div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Review notes (optional)" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs outline-none focus:border-violet-500/40" />
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required only when rejecting" className="mt-3 h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs outline-none focus:border-violet-500/40" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void act('verified')} disabled={saving || !identityPassed || !professionalReady}>Approve & publish</Button>
              <Button danger onClick={() => void act('rejected')} disabled={saving}>Reject with reason</Button>
            </div>
          </section>
        </section>

        {history.length > 0 && (
          <section><h3 className="mb-3 text-sm font-bold">Review history</h3><div className="space-y-2">{history.map((item) => <div key={item.id} className="rounded-xl border border-white/[.06] bg-[#10141D] p-3"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold capitalize">{String(item.action || 'review').replace(/_/g, ' ')}</p><p className="text-[9px] text-[#555C6D]">{new Date(item.created_at).toLocaleString()}</p></div>{(item.rejection_reason || item.notes) && <p className="mt-2 text-[10px] leading-relaxed text-[#858A99]">{item.rejection_reason || item.notes}</p>}</div>)}</div></section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-bold">Worker reviews</h2><p className="mt-1 text-[10px] text-[#707687]">Workers appear here only after completing and submitting their verification requirements. Payment alone never enters this queue.</p></div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Worker reviews" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151E] px-4 text-xs outline-none focus:border-violet-500/35" />
      {loading ? <Empty text="Loading Worker reviews…" /> : shown.length === 0 ? <Empty text="No Worker verification is waiting for review." /> : <div className="space-y-2">{shown.map((worker) => <button key={worker.user_id} onClick={() => void open(worker)} className="flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-[#10141D] p-4 text-left hover:border-violet-500/25"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{worker.full_name || worker.username || 'Worker'}</p><p className="mt-1 truncate text-[10px] text-[#666D7E]">{worker.worker_occupation || 'Occupation not set'} · {[worker.local_government || worker.city, worker.state].filter(Boolean).join(', ')}</p></div><Status value={worker.worker_status} /></button>)}</div>}
    </div>
  );
}

function Evidence({ label, path, bucket }: { label: string; path?: string | null; bucket: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!path) return; if (path.startsWith('http')) return void setUrl(path); void supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl || null)); }, [path, bucket]);
  return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[9px] font-semibold">{label}</p>{url ? <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-violet-400">Open evidence →</a> : <p className="mt-2 text-[10px] text-[#606778]">Not supplied</p>}</div>;
}
function Info({ label, value }: { label: string; value: any }) { return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[8px] uppercase text-[#62697A]">{label}</p><p className="mt-1 text-[10px] text-[#A4A9B8]">{String(value)}</p></div>; }
function IdentityBadge({ status }: { status: string }) { const cls = status === 'passed' ? 'bg-emerald-500/10 text-emerald-300' : status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'; return <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${cls}`}>{status.replace(/_/g, ' ')}</span>; }
function Status({ value }: { value: string }) { return <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] capitalize text-violet-300">{String(value || 'pending').replace(/_/g, ' ')}</span>; }
function Check({ good, children }: { good: boolean; children: React.ReactNode }) { return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${good ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{good ? '✓' : '•'} {children}</span>; }
function Button({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2.5 text-[10px] font-semibold disabled:opacity-35 ${danger ? 'bg-red-500/15 text-red-300' : 'bg-violet-500 text-white'}`}>{children}</button>; }
function Missing({ text }: { text: string }) { return <div className="grid aspect-square place-items-center px-3 text-center text-[9px] text-[#5F6677]">{text}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">{text}</div>; }
