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
  test_percent: number | null;
  test_attempts_24h: number;
  evidence_saved: boolean;
  submitted: boolean;
  review_status: string | null;
  rejection_reason: string | null;
};

const EMPTY: Activation = {
  worker_status: 'pending',
  live: false,
  profile_complete: false,
  payment_status: null,
  gold_badge: false,
  test_passed: false,
  test_percent: null,
  test_attempts_24h: 0,
  evidence_saved: false,
  submitted: false,
  review_status: null,
  rejection_reason: null,
};

const PAYMENT_REF_KEY = 'wh_worker_verification_payment_ref';

export default function WorkerVerificationPhase4({ profile, onBack }: Props) {
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
    setFee(Number(feeResult.data || 0));
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [profile.user_id]);

  useEffect(
    () => () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    },
    [videoPreview],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let reference = '';
      try {
        reference = localStorage.getItem(PAYMENT_REF_KEY) || '';
      } catch {}
      if (!reference) return;
      const result = await verifyPaymentWithRetry(reference, { purpose: 'worker_verification' });
      if (cancelled) return;
      if (result.success) {
        try {
          localStorage.removeItem(PAYMENT_REF_KEY);
        } catch {}
        toast.success('Payment confirmed. Your Gold Tick is active.');
        await refresh();
      } else if (result.error && !result.error.includes('Max retries')) {
        toast.info('Payment has not been confirmed yet. You can retry from this page.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pay() {
    if (fee <= 0) return toast.error('Verification fee is not configured');
    setBusy(true);
    try {
      const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_worker_verification_payment');
      if (bootstrapError || !bootstrap?.success) {
        throw new Error(bootstrap?.error || bootstrapError?.message || 'Payment initialization failed');
      }
      const reference = String(bootstrap.reference || '');
      if (!reference) throw new Error('Payment reference was not created');

      const { data, error } = await supabase.functions.invoke('worker-verification-payment-init', { body: { reference } });
      if (error) throw error;
      if (data?.already_paid) {
        try {
          localStorage.removeItem(PAYMENT_REF_KEY);
        } catch {}
        toast.success('Payment already confirmed.');
        await refresh();
        return;
      }
      if (!data?.success || !data?.authorization_url) {
        throw new Error(data?.error || 'Paystack could not initialize payment');
      }
      try {
        localStorage.setItem(PAYMENT_REF_KEY, reference);
      } catch {}
      window.location.assign(String(data.authorization_url));
    } catch (error: any) {
      toast.error(error?.message || 'Payment could not be started');
      setBusy(false);
    }
  }

  async function upload(file: File, bucket: 'worker-certificates' | 'worker-verification-videos', kind: string) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${profile.user_id}/${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function chooseCertificate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('Certificate must be under 10MB');
    try {
      setCertificatePath(await upload(file, 'worker-certificates', 'certificate'));
      toast.success('Certificate uploaded');
    } catch (error: any) {
      toast.error(error?.message || 'Certificate upload failed');
    }
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
      toast.success('Skill video uploaded');
    } catch (error: any) {
      toast.error(error?.message || 'Video upload failed');
    }
  }

  async function saveEvidence() {
    if (!videoPath) return toast.error('A skill demonstration video is required');
    setBusy(true);
    const { error } = await supabase.rpc('save_my_worker_professional_evidence', {
      p_certificate_path: certificatePath || null,
      p_video_path: videoPath,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Professional evidence saved');
    await refresh();
  }

  async function submitReview() {
    setBusy(true);
    const { error } = await supabase.rpc('submit_my_worker_verification');
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Submitted for WeHouse professional review');
    await refresh();
  }

  if (loading) return <Screen><State title="Checking verification" text="Loading your Worker progress…" /></Screen>;

  const underReview = activation.worker_status === 'profile_under_review' || activation.submitted;
  const live = activation.live || activation.worker_status === 'verified';

  return (
    <Screen>
      <Toaster position="top-center" richColors theme="dark" />
      <Header onBack={onBack} gold={activation.gold_badge} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:px-5">
        <Progress activation={activation} />

        {activation.rejection_reason && (
          <Panel>
            <State title="Review feedback" text={activation.rejection_reason} />
          </Panel>
        )}

        {live ? (
          <Panel>
            <State good title="Your Worker profile is live" text="WeHouse approved your professional checks. You can appear in Local Services while your account remains active and in good standing." />
            <Button label="Back to Worker dashboard" onClick={onBack} />
          </Panel>
        ) : underReview ? (
          <Panel>
            <State good title="WeHouse professional review" text="Your professional checks have been submitted. Your profile stays private until an authorized WeHouse reviewer approves it." />
            <div className="rounded-2xl border border-white/[.06] bg-black/10 p-4 text-[10px] leading-relaxed text-[#777E8E]">
              WeHouse verification is based on your professional profile, readiness test, work evidence and internal review. We do not ask for government ID in this flow.
            </div>
            <Button label="Back to Worker dashboard" onClick={onBack} />
          </Panel>
        ) : !activation.profile_complete ? (
          <Panel>
            <State title="Professional profile first" text="Complete your service, specialty, experience, price and service coverage from Professional Profile before paying." />
            <Button label="Back to Worker dashboard" onClick={onBack} />
          </Panel>
        ) : !activation.gold_badge ? (
          <Panel>
            <State title="Verification payment" text="A confirmed Paystack payment gives the Gold Tick. It confirms payment only; it does not make your profile public." />
            <div className="rounded-2xl border border-white/[.07] bg-black/15 p-5 text-center">
              <p className="text-[9px] uppercase tracking-[.15em] text-[#6E7483]">Verification fee</p>
              <p className="mt-2 text-3xl font-bold">₦{fee.toLocaleString()}</p>
            </div>
            <Primary label={busy ? 'Opening Paystack…' : 'Pay securely with Paystack'} disabled={busy || fee <= 0} onClick={() => void pay()} />
          </Panel>
        ) : !activation.test_passed ? (
          <Panel>
            <State title="WeHouse readiness check" text="Show that you understand safe work, customer conduct, privacy and WeHouse rules." />
            <WorkerReadinessTest onPassed={refresh} />
          </Panel>
        ) : !activation.evidence_saved ? (
          <Panel>
            <State good title="Readiness check passed" text={`Now show your work with a skill demonstration video${activation.test_percent != null ? ` · readiness score ${activation.test_percent}%` : ''}. A professional certificate is optional.`} />
            <Upload label={certificatePath ? 'Certificate uploaded' : 'Professional certificate · optional'} done={!!certificatePath} onClick={() => certificateInput.current?.click()} />
            <input ref={certificateInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={chooseCertificate} />
            <Upload label={videoPath ? 'Skill video uploaded' : 'Skill demonstration video · required'} done={!!videoPath} onClick={() => videoInput.current?.click()} />
            <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={chooseVideo} />
            {videoPreview && <video src={videoPreview} controls playsInline className="max-h-72 w-full rounded-2xl bg-black object-contain" />}
            <p className="text-[10px] leading-relaxed text-[#777E8E]">This skill video is private review evidence. After approval, you can separately post public Work Status videos and permanent Portfolio work from your Showcase tab.</p>
            <Primary label={busy ? 'Saving…' : 'Save professional evidence'} disabled={busy || !videoPath} onClick={() => void saveEvidence()} />
          </Panel>
        ) : (
          <Panel>
            <State good title="Ready for WeHouse review" text="Your professional setup, payment, readiness check and work evidence are complete. Submit them together for final professional review." />
            <div className="rounded-2xl border border-violet-500/15 bg-violet-500/[.05] p-4 text-[10px] leading-relaxed text-violet-100/75">
              WeHouse Verified means we reviewed your professional readiness and work evidence. It is not government identity verification.
            </div>
            <Primary label={busy ? 'Submitting…' : 'Submit for final review'} disabled={busy} onClick={() => void submitReview()} />
          </Panel>
        )}
      </main>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#0A0A0F] pb-8 text-white">{children}</div>;
}

function Header({ onBack, gold }: { onBack: () => void; gold: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0A0A0F]/95 px-4 py-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <button onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07] bg-white/[.03]">←</button>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold tracking-[.2em] text-violet-300">WEHOUSE VERIFICATION</p>
          <h1 className="mt-1 text-lg font-bold">Professional verification</h1>
        </div>
        {gold && <span className="rounded-full border border-amber-400/20 bg-amber-400/[.08] px-2.5 py-1 text-[9px] font-bold text-amber-300">GOLD TICK</span>}
      </div>
    </header>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="space-y-4 rounded-3xl border border-white/[.07] bg-[#11151D] p-4 sm:p-5">{children}</section>;
}

function State({ title, text, good = false }: { title: string; text: string; good?: boolean }) {
  return (
    <div>
      <p className={`text-sm font-semibold ${good ? 'text-emerald-300' : 'text-white'}`}>{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#777E8E]">{text}</p>
    </div>
  );
}

function Primary({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">{label}</button>;
}

function Button({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="h-11 w-full rounded-2xl border border-white/[.08] text-xs font-semibold">{label}</button>;
}

function Upload({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 text-left text-xs ${done ? 'border-emerald-500/20 bg-emerald-500/[.05] text-emerald-300' : 'border-white/[.08] bg-black/10 text-[#A2A7B3]'}`}
    >
      <span>{label}</span>
      <span>{done ? '✓' : '＋'}</span>
    </button>
  );
}

function Progress({ activation: a }: { activation: Activation }) {
  const skillDone = a.test_passed && a.evidence_saved;
  const steps = [
    ['Profile', a.profile_complete],
    ['Gold Tick', a.gold_badge],
    ['Skill Check', skillDone],
    ['Review', a.live],
  ] as const;
  return (
    <section className="rounded-3xl border border-white/[.07] bg-[#0F131A] p-4">
      <div className="grid grid-cols-4 gap-2">
        {steps.map(([label, done], index) => (
          <div key={label} className="min-w-0 text-center">
            <div className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-[9px] font-bold ${done ? 'bg-emerald-500 text-[#04100B]' : 'border border-white/[.1] bg-white/[.03] text-[#697080]'}`}>
              {done ? '✓' : index + 1}
            </div>
            <p className={`mt-1 truncate text-[8px] ${done ? 'text-emerald-300' : 'text-[#626979]'}`}>{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
