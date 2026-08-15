import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import WorkerReadinessTest from '@/components/WorkerReadinessTest';
import { supabase } from '@/lib/supabase';
import { verifyPaymentWithRetry } from '@/lib/supabase/payment-verify';
import type { Profile } from '@/types';

type Props = { profile: Profile; onBack: () => void };
type Activation = {
  worker_status: string;
  live: boolean;
  profile_complete: boolean;
  payment_status: string | null;
  gold_badge: boolean;
  test_passed: boolean;
  evidence_saved: boolean;
  submitted: boolean;
  rejection_reason: string | null;
};

const EMPTY: Activation = {
  worker_status: 'pending', live: false, profile_complete: false, payment_status: null,
  gold_badge: false, test_passed: false, evidence_saved: false, submitted: false, rejection_reason: null,
};
const PAYMENT_REF_KEY = 'wh_worker_verification_payment_ref';

export default function WorkerVerificationPhase4V3({ profile, onBack }: Props) {
  const certificateInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [activation, setActivation] = useState<Activation>(EMPTY);
  const [fee, setFee] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [certificatePath, setCertificatePath] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [videoPreview, setVideoPreview] = useState('');

  async function refresh() {
    const [{ data, error }, feeResult] = await Promise.all([
      supabase.rpc('get_my_worker_activation'),
      supabase.rpc('get_setting_v2', { p_key: 'worker_verification_fee' }),
    ]);
    if (error) toast.error(error.message);
    else setActivation({ ...EMPTY, ...(data || {}) } as Activation);
    const feeData: any = feeResult.data;
    setFee(Number(Array.isArray(feeData) ? feeData[0]?.value : feeData?.value ?? feeData ?? 0));
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [profile.user_id]);
  useEffect(() => () => { if (videoPreview) URL.revokeObjectURL(videoPreview); }, [videoPreview]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let reference = '';
      try { reference = localStorage.getItem(PAYMENT_REF_KEY) || ''; } catch {}
      if (!reference) return;
      const result = await verifyPaymentWithRetry(reference, { purpose: 'worker_verification' });
      if (cancelled) return;
      if (result.success) {
        try { localStorage.removeItem(PAYMENT_REF_KEY); } catch {}
        toast.success('Payment confirmed.');
        await refresh();
      } else if (result.error && !result.error.includes('Max retries')) {
        toast.info('Payment is not confirmed yet.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function openProfessionalProfile() {
    try {
      sessionStorage.setItem('wh_worker_setup_return', 'verification');
      localStorage.setItem('wh_navpage', 'worker_setup');
      window.history.replaceState({ page: 'worker_setup' }, '', '#worker_setup');
    } catch {}
    window.location.reload();
  }

  async function pay() {
    if (fee <= 0) return toast.error('Verification fee is not configured');
    setBusy(true);
    try {
      const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_worker_verification_payment');
      if (bootstrapError || !bootstrap?.success) throw new Error(bootstrap?.error || bootstrapError?.message || 'Payment initialization failed');
      const reference = String(bootstrap.reference || '');
      if (!reference) throw new Error('Payment reference was not created');
      const { data, error } = await supabase.functions.invoke('worker-verification-payment-init', { body: { reference } });
      if (error) throw error;
      if (data?.already_paid) {
        try { localStorage.removeItem(PAYMENT_REF_KEY); } catch {}
        await refresh();
        return;
      }
      if (!data?.success || !data?.authorization_url) throw new Error(data?.error || 'Paystack could not initialize payment');
      try { localStorage.setItem(PAYMENT_REF_KEY, reference); } catch {}
      window.location.assign(String(data.authorization_url));
    } catch (error: any) {
      toast.error(error?.message || 'Payment could not be started');
      setBusy(false);
    }
  }

  async function upload(file: File, bucket: 'worker-certificates' | 'worker-verification-videos', kind: string) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${profile.user_id}/${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw error;
    return path;
  }

  async function chooseCertificate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('Certificate must be under 10MB');
    try { setCertificatePath(await upload(file, 'worker-certificates', 'certificate')); toast.success('Certificate added'); }
    catch (error: any) { toast.error(error?.message || 'Certificate upload failed'); }
  }

  async function chooseVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast.error('Choose a video file');
    if (file.size > 50 * 1024 * 1024) return toast.error('Skill video must be under 50MB');
    try {
      const path = await upload(file, 'worker-verification-videos', 'skill-video');
      setVideoPath(path);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoPreview(URL.createObjectURL(file));
      toast.success('Work video added');
    } catch (error: any) { toast.error(error?.message || 'Video upload failed'); }
  }

  async function saveEvidence() {
    if (!videoPath) return toast.error('Add a short work video');
    setBusy(true);
    const { error } = await supabase.rpc('save_my_worker_professional_evidence', { p_certificate_path: certificatePath || null, p_video_path: videoPath });
    setBusy(false);
    if (error) return toast.error(error.message);
    await refresh();
  }

  async function submitReview() {
    setBusy(true);
    const { error } = await supabase.rpc('submit_my_worker_verification');
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Sent to WeHouse review');
    await refresh();
  }

  if (loading) return <Screen><div className="grid min-h-[60dvh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div></Screen>;

  const verificationDone = activation.gold_badge && activation.test_passed && activation.evidence_saved;
  const underReview = activation.worker_status === 'profile_under_review' || activation.submitted;
  const live = activation.live || activation.worker_status === 'verified';

  return (
    <Screen>
      <Toaster position="top-center" richColors theme="dark" />
      <header className="border-b border-white/[.06] bg-[#0A0A0F] px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07] bg-white/[.03] text-[#9BA0AF]">←</button>
          <div className="min-w-0 flex-1"><p className="text-[9px] font-bold tracking-[.18em] text-violet-300">WORKER SETUP</p><h1 className="mt-1 text-lg font-bold">Work verification</h1></div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4 sm:px-5">
        <Progress profileDone={activation.profile_complete} verificationDone={verificationDone} reviewDone={live} />
        {activation.rejection_reason && <Notice title="Review feedback" text={activation.rejection_reason} />}

        {live ? (
          <ActionCard eyebrow="READY" title="Your services are live" text="Customers can now find your professional profile."><Primary label="Back to dashboard" onClick={onBack} /></ActionCard>
        ) : underReview ? (
          <ActionCard eyebrow="REVIEW" title="WeHouse is reviewing your work" text="Your profile stays private until the review is complete."><StatusLine text="No action needed right now" /><Secondary label="Back to dashboard" onClick={onBack} /></ActionCard>
        ) : !activation.profile_complete ? (
          <ActionCard eyebrow="1 · WORK PROFILE" title="Complete your work profile" text="Add your service, experience and work location."><Primary label="Complete work profile" onClick={openProfessionalProfile} /></ActionCard>
        ) : !activation.gold_badge ? (
          <ActionCard eyebrow="2 · WORK VERIFICATION" title="Pay the verification fee" text="This covers the verification process. Payment does not approve or publish your profile."><div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/10 px-4 py-3"><span className="text-[10px] text-[#717888]">Fee</span><span className="text-xl font-bold">₦{fee.toLocaleString()}</span></div><Primary label={busy ? 'Opening Paystack…' : 'Continue to Paystack'} disabled={busy || fee <= 0} onClick={() => void pay()} /></ActionCard>
        ) : !activation.test_passed ? (
          <ActionCard eyebrow="2 · WORK VERIFICATION" title="Complete the skill check" text="A short WeHouse readiness check before your work evidence."><StatusLine text="Payment confirmed" good /><WorkerReadinessTest onPassed={refresh} /></ActionCard>
        ) : !activation.evidence_saved ? (
          <ActionCard eyebrow="2 · WORK VERIFICATION" title="Show us your work" text="Add one short work video for private review. A certificate is optional."><StatusLine text="Payment and skill check complete" good /><Upload label={certificatePath ? 'Certificate added' : 'Certificate · optional'} done={!!certificatePath} onClick={() => certificateInput.current?.click()} /><input ref={certificateInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={chooseCertificate} /><Upload label={videoPath ? 'Work video added' : 'Work video · required'} done={!!videoPath} onClick={() => videoInput.current?.click()} /><input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={chooseVideo} />{videoPreview && <video src={videoPreview} controls playsInline className="max-h-64 w-full rounded-2xl bg-black object-contain" />}<Primary label={busy ? 'Saving…' : 'Save work evidence'} disabled={busy || !videoPath} onClick={() => void saveEvidence()} /></ActionCard>
        ) : (
          <ActionCard eyebrow="3 · WEHOUSE REVIEW" title="Ready for review" text="Your profile, payment, skill check and work video are complete."><Primary label={busy ? 'Submitting…' : 'Submit to WeHouse'} disabled={busy} onClick={() => void submitReview()} /></ActionCard>
        )}
      </main>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) { return <div className="min-h-[100dvh] bg-[#0A0A0F] pb-8 text-white">{children}</div>; }
function ActionCard({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children: React.ReactNode }) { return <section className="space-y-3 rounded-2xl border border-white/[.07] bg-[#11151D] p-4 sm:p-5"><div><p className="text-[8px] font-bold tracking-[.16em] text-violet-300">{eyebrow}</p><h2 className="mt-1 text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">{text}</p></div>{children}</section>; }
function Primary({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) { return <button type="button" onClick={onClick} disabled={disabled} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">{label}</button>; }
function Secondary({ label, onClick }: { label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold text-[#C7CAD3]">{label}</button>; }
function Upload({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-xs ${done ? 'border-emerald-500/20 bg-emerald-500/[.05] text-emerald-300' : 'border-white/[.08] bg-black/10 text-[#A2A7B3]'}`}><span>{label}</span><span>{done ? '✓' : '+'}</span></button>; }
function Notice({ title, text }: { title: string; text: string }) { return <section className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3"><p className="text-xs font-semibold text-red-200">{title}</p><p className="mt-1 text-[10px] text-red-100/70">{text}</p></section>; }
function StatusLine({ text, good = false }: { text: string; good?: boolean }) { return <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[9px] ${good ? 'border-emerald-500/15 bg-emerald-500/[.05] text-emerald-300' : 'border-white/[.06] bg-black/10 text-[#737A8A]'}`}><span className={`h-2 w-2 rounded-full ${good ? 'bg-emerald-400' : 'bg-violet-400'}`} />{text}</div>; }
function Progress({ profileDone, verificationDone, reviewDone }: { profileDone: boolean; verificationDone: boolean; reviewDone: boolean }) {
  const stages = [
    { label: 'Work profile', done: profileDone },
    { label: 'Work verification', done: verificationDone },
    { label: 'WeHouse review', done: reviewDone },
  ];
  return <section className="rounded-2xl border border-white/[.06] bg-[#0F131A] p-3"><div className="grid grid-cols-3 gap-2">{stages.map((stage, index) => { const active = !stage.done && stages.slice(0, index).every((item) => item.done); return <div key={stage.label} className={`rounded-xl border px-2 py-3 text-center ${stage.done ? 'border-emerald-500/15 bg-emerald-500/[.05]' : active ? 'border-violet-500/20 bg-violet-500/[.06]' : 'border-white/[.05] bg-black/10'}`}><span className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${stage.done ? 'bg-emerald-500 text-[#04120A]' : active ? 'bg-violet-500 text-white' : 'bg-white/[.05] text-[#656C7B]'}`}>{stage.done ? '✓' : index + 1}</span><p className={`mt-2 text-[8px] font-medium leading-tight ${stage.done ? 'text-emerald-300' : active ? 'text-violet-200' : 'text-[#676E7E]'}`}>{stage.label}</p></div>; })}</div></section>;
}
