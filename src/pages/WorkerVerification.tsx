import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@/types';
import { supabase } from '@/lib/supabase';
import { initializePaystackPopup } from '@/lib/supabase/paystack';
import WorkerReadinessTest from '@/components/WorkerReadinessTest';
import { Toaster, toast } from 'sonner';

interface WorkerVerificationProps {
  profile: Profile;
  onBack: () => void;
}

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
  identity_status: string;
  identity_provider: string | null;
  identity_checked_at: string | null;
  rejection_reason: string | null;
};

const EMPTY_ACTIVATION: Activation = {
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
  identity_status: 'not_started',
  identity_provider: null,
  identity_checked_at: null,
  rejection_reason: null,
};

export default function WorkerVerification({ profile, onBack }: WorkerVerificationProps) {
  const certificateInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const selfieInput = useRef<HTMLInputElement>(null);

  const [activation, setActivation] = useState<Activation>(EMPTY_ACTIVATION);
  const [loading, setLoading] = useState(true);
  const [fee, setFee] = useState(0);
  const [paying, setPaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [certificatePath, setCertificatePath] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [videoPreview, setVideoPreview] = useState('');
  const [vNin, setVNin] = useState('');
  const [selfie, setSelfie] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);

  async function refresh() {
    const [{ data, error }, feeResult] = await Promise.all([
      supabase.rpc('get_my_worker_activation'),
      supabase.rpc('get_setting_v2', { p_key: 'worker_verification_fee' }),
    ]);
    if (error) toast.error(error.message);
    else setActivation({ ...EMPTY_ACTIVATION, ...(data || {}) } as Activation);
    setFee(feeResult.data ? Number(feeResult.data) : 0);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [profile.user_id]);

  useEffect(() => () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
  }, [videoPreview]);

  async function pay() {
    if (fee <= 0) return toast.error('Verification fee is not configured');
    setPaying(true);
    const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_worker_verification_payment');
    if (bootstrapError || !bootstrap?.success) {
      setPaying(false);
      return toast.error(bootstrap?.error || bootstrapError?.message || 'Payment initialization failed');
    }

    const { data: publicKey } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_public_key' });
    if (!publicKey) {
      setPaying(false);
      return toast.error('Payment system is not configured');
    }

    initializePaystackPopup({
      publicKey,
      email: profile.email,
      amountKobo: Number(bootstrap.amount) * 100,
      reference: bootstrap.reference,
      metadata: {
        payment_type: 'worker_verification',
        expected_amount: Number(bootstrap.amount),
        worker_id: profile.user_id,
      },
      onSuccess: () => {
        setPaying(false);
        toast.success('Payment confirmed. Your verification Gold Tick is active.');
        void refresh();
      },
      onCancel: () => {
        setPaying(false);
        toast.info('Payment was not completed');
      },
    });
  }

  async function uploadEvidence(file: File, bucket: 'worker-certificates' | 'worker-verification-videos', kind: string) {
    const extension = (file.name.split('.').pop() || (bucket === 'worker-verification-videos' ? 'mp4' : 'bin')).toLowerCase();
    const path = `${profile.user_id}/${kind}-${Date.now()}.${extension}`;
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
      setCertificatePath(await uploadEvidence(file, 'worker-certificates', 'certificate'));
      toast.success('Professional certificate uploaded');
    } catch (error: any) {
      toast.error(error?.message || 'Certificate upload failed');
    }
  }

  async function chooseVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return toast.error('Skill video must be under 50MB');
    if (!file.type.startsWith('video/')) return toast.error('Choose a video file');
    try {
      const path = await uploadEvidence(file, 'worker-verification-videos', 'skill-video');
      setVideoPath(path);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoPreview(URL.createObjectURL(file));
      toast.success('Skill demonstration video uploaded');
    } catch (error: any) {
      toast.error(error?.message || 'Video upload failed');
    }
  }

  async function saveEvidence() {
    if (!videoPath) return toast.error('Skill demonstration video is required');
    setSaving(true);
    const { error } = await supabase.rpc('save_my_worker_professional_evidence', {
      p_certificate_path: certificatePath || null,
      p_video_path: videoPath,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Professional evidence saved');
    await refresh();
  }

  function readDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read selfie'));
      reader.readAsDataURL(file);
    });
  }

  async function verifyIdentity() {
    if (!vNin.trim()) return toast.error('Enter your virtual NIN (vNIN)');
    if (!selfie) return toast.error('Take or choose a clear selfie');
    if (!consent) return toast.error('Consent is required for the external identity check');
    if (selfie.size > 5 * 1024 * 1024) return toast.error('Selfie must be under 5MB');

    setIdentityBusy(true);
    try {
      const selfieImage = await readDataUrl(selfie);
      const { data, error } = await supabase.functions.invoke('worker-identity-verify', {
        body: {
          vnin: vNin.trim(),
          selfieImage,
          isSubjectConsent: true,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'External identity verification could not be completed');
      if (data?.verified) toast.success('External government identity verified');
      else toast.error(data?.reason || 'Identity verification did not pass');
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || 'Identity verification failed');
    } finally {
      setIdentityBusy(false);
    }
  }

  async function submitForReview() {
    setSaving(true);
    const { error } = await supabase.rpc('submit_my_worker_verification');
    setSaving(false);
    if (error) return toast.error(error.message || 'Submission failed');
    toast.success('Professional verification submitted to WeHouse review');
    await refresh();
  }

  if (loading) {
    return <State title="Loading Worker verification…" text="Checking your activation progress." />;
  }

  const identityVerified = activation.identity_status === 'verified';
  const underReview = activation.worker_status === 'profile_under_review' || activation.submitted;
  const live = activation.live || activation.worker_status === 'verified';

  return (
    <div className="min-h-[100dvh] bg-[#080A0F] pb-24 text-white">
      <Toaster position="top-center" richColors theme="dark" />
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#080A0F]/95 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.07] bg-white/[.03] text-[#A4A8B5]" aria-label="Back">←</button>
          <div className="min-w-0">
            <p className="text-[9px] font-bold tracking-[.2em] text-cyan-300">WORKER ACTIVATION</p>
            <h1 className="mt-1 text-lg font-bold">Verification</h1>
            <p className="mt-0.5 text-[10px] text-[#6D7383]">One path from private Worker account to public professional.</p>
          </div>
          {activation.gold_badge && <span className="ml-auto shrink-0 rounded-full border border-amber-400/20 bg-amber-400/[.08] px-2.5 py-1 text-[9px] font-bold text-amber-300">GOLD TICK</span>}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-5">
        <Progress activation={activation} />

        {live ? (
          <Panel>
            <Status good title="Worker profile is live" text="Your professional profile is approved and can appear in Local Services while your account is active." />
            <Secondary label="Back to Worker dashboard" onClick={onBack} />
          </Panel>
        ) : underReview ? (
          <Panel>
            <Status good title="WeHouse professional review" text="Your payment, Worker test, professional evidence and external identity gate are complete. Your profile remains private until this final review is approved." />
            <Secondary label="Back to Worker dashboard" onClick={onBack} />
          </Panel>
        ) : !activation.profile_complete ? (
          <Panel>
            <Status title="Complete your professional profile first" text="Add your service, experience, price and coverage from the Profile tab. Verification begins after your professional profile is complete." />
            <Secondary label="Back to Profile" onClick={onBack} />
          </Panel>
        ) : !activation.gold_badge ? (
          <Panel>
            <Status title="Pay the verification fee" text="A successful Paystack verification payment gives your Worker account the Gold Tick. The Gold Tick confirms payment only; it does not make you public." />
            <div className="rounded-2xl border border-white/[.06] bg-black/10 p-5 text-center">
              <p className="text-[9px] uppercase tracking-wide text-[#686F80]">Verification fee</p>
              <p className="mt-2 text-3xl font-bold">₦{fee.toLocaleString()}</p>
            </div>
            <Primary label={paying ? 'Opening Paystack…' : 'Pay securely with Paystack'} onClick={() => void pay()} disabled={paying || fee <= 0} />
          </Panel>
        ) : !activation.test_passed ? (
          <WorkerReadinessTest onPassed={refresh} />
        ) : !activation.evidence_saved ? (
          <Panel>
            <Status good title="Worker test passed" text={`Your readiness gate is complete${activation.test_percent != null ? ` at ${activation.test_percent}%` : ''}. Now show what you can actually do.`} />
            <div className="space-y-3">
              <UploadButton label={certificatePath ? 'Certificate uploaded' : 'Professional certificate (optional)'} complete={Boolean(certificatePath)} onClick={() => certificateInput.current?.click()} />
              <input ref={certificateInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={chooseCertificate} />
              <UploadButton label={videoPath ? 'Skill video uploaded' : 'Skill demonstration video · required'} complete={Boolean(videoPath)} onClick={() => videoInput.current?.click()} />
              <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={chooseVideo} />
              {videoPreview && <video src={videoPreview} controls playsInline className="max-h-72 w-full rounded-2xl bg-black object-contain" />}
            </div>
            <p className="text-[10px] leading-relaxed text-[#717889]">This is professional evidence for review. It is separate from the Work Stories and Portfolio you can publish after your Worker profile goes live.</p>
            <Primary label={saving ? 'Saving evidence…' : 'Save professional evidence'} onClick={() => void saveEvidence()} disabled={saving || !videoPath} />
          </Panel>
        ) : !identityVerified ? (
          <Panel>
            <Status title="External government identity check" text="Government identity is checked by Youverify. WeHouse Staff do not inspect your government ID. WeHouse keeps the provider result/reference, not an uploaded ID document." />
            <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[.04] p-4 text-[10px] leading-relaxed text-[#8C94A4]">
              Generate a virtual NIN for Youverify using the NIMC vNIN flow. Youverify's enterprise/short code is <span className="font-bold text-cyan-200">471335</span>. Your vNIN and selfie are sent to the external provider for this check and are not uploaded to WeHouse Storage.
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#8B91A0]">Virtual NIN (vNIN)</span>
              <input value={vNin} onChange={(event) => setVNin(event.target.value)} autoCapitalize="characters" autoComplete="off" placeholder="Enter vNIN" className="h-12 w-full rounded-xl border border-white/[.08] bg-[#151921] px-3 text-sm outline-none focus:border-cyan-500/30" />
            </label>
            <UploadButton label={selfie ? 'Selfie selected' : 'Take or choose a clear selfie'} complete={Boolean(selfie)} onClick={() => selfieInput.current?.click()} />
            <input ref={selfieInput} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={(event) => setSelfie(event.target.files?.[0] || null)} />
            <button type="button" onClick={() => setConsent((value) => !value)} className="flex w-full items-start gap-3 rounded-2xl border border-white/[.07] bg-black/10 p-4 text-left">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-xs ${consent ? 'border-cyan-500 bg-cyan-500 text-[#041014]' : 'border-white/15'}`}>{consent ? '✓' : ''}</span>
              <span className="text-[11px] leading-relaxed text-[#959BA9]">I consent to Youverify checking this government identity information and comparing my selfie for Worker verification.</span>
            </button>
            {activation.identity_status !== 'not_started' && activation.identity_status !== 'ready_for_external' && (
              <Status danger={activation.identity_status === 'failed'} title={`Identity status: ${activation.identity_status.replace(/_/g, ' ')}`} text="If the provider could not verify the identity, check the vNIN/selfie and try again or use the supported recovery path." />
            )}
            <Primary label={identityBusy ? 'Checking with Youverify…' : 'Verify identity with Youverify'} onClick={() => void verifyIdentity()} disabled={identityBusy || !vNin.trim() || !selfie || !consent} />
          </Panel>
        ) : (
          <Panel>
            <Status good title="External identity verified" text="The identity provider gate is complete. Submit your professional evidence to WeHouse for the final approval decision." />
            <div className="grid gap-2 sm:grid-cols-2">
              <Info label="Provider" value={activation.identity_provider || 'Youverify'} />
              <Info label="Checked" value={activation.identity_checked_at ? new Date(activation.identity_checked_at).toLocaleString() : 'Verified'} />
            </div>
            {activation.rejection_reason && <Status danger title="Previous review feedback" text={activation.rejection_reason} />}
            <Primary label={saving ? 'Submitting…' : 'Submit for final WeHouse review'} onClick={() => void submitForReview()} disabled={saving} />
          </Panel>
        )}
      </main>
    </div>
  );
}

function Progress({ activation }: { activation: Activation }) {
  const steps = [
    ['Professional profile', activation.profile_complete],
    ['Paystack Gold Tick', activation.gold_badge],
    ['Worker test', activation.test_passed],
    ['Professional evidence', activation.evidence_saved],
    ['External identity', activation.identity_status === 'verified'],
    ['WeHouse review', activation.live],
  ] as const;
  return (
    <section className="rounded-3xl border border-white/[.06] bg-[#0F131B] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><p className="text-[9px] font-bold tracking-[.18em] text-[#656D7D]">ACTIVATION PATH</p><p className="mt-1 text-xs text-[#A6ABB7]">One status path. No duplicate verification dashboards.</p></div>
        <span className="text-xs font-bold text-cyan-300">{steps.filter(([, done]) => done).length}/{steps.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(([label, done], index) => (
          <div key={label} className={`rounded-xl border p-3 ${done ? 'border-emerald-500/15 bg-emerald-500/[.05]' : 'border-white/[.06] bg-black/10'}`}>
            <div className="flex items-center gap-2"><span className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold ${done ? 'bg-emerald-500 text-[#03110A]' : 'bg-white/[.06] text-[#697181]'}`}>{done ? '✓' : index + 1}</span><span className={`text-[10px] font-semibold ${done ? 'text-emerald-200' : 'text-[#89909F]'}`}>{label}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="space-y-4 rounded-3xl border border-white/[.06] bg-[#10141C] p-4 sm:p-5">{children}</section>;
}
function Status({ title, text, good = false, danger = false }: { title: string; text: string; good?: boolean; danger?: boolean }) {
  const cls = danger ? 'border-red-500/20 bg-red-500/[.05]' : good ? 'border-emerald-500/20 bg-emerald-500/[.05]' : 'border-cyan-500/15 bg-cyan-500/[.04]';
  return <div className={`rounded-2xl border p-4 ${cls}`}><p className="text-sm font-semibold">{title}</p><p className="mt-1.5 text-[10px] leading-relaxed text-[#858C9B]">{text}</p></div>;
}
function UploadButton({ label, complete, onClick }: { label: string; complete: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-xs ${complete ? 'border-emerald-500/20 bg-emerald-500/[.05] text-emerald-200' : 'border-white/[.08] bg-[#151921] text-[#A9AFBB]'}`}><span>{label}</span><span>{complete ? '✓' : '＋'}</span></button>;
}
function Primary({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="h-12 w-full rounded-2xl bg-cyan-500 text-xs font-semibold text-[#041014] disabled:opacity-40">{label}</button>;
}
function Secondary({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="h-12 w-full rounded-2xl border border-white/[.08] bg-white/[.025] text-xs font-semibold text-[#B2B7C2]">{label}</button>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3"><p className="text-[9px] uppercase tracking-wide text-[#626A79]">{label}</p><p className="mt-1.5 break-words text-[11px] font-semibold text-[#CDD1DA]">{value}</p></div>;
}
function State({ title, text }: { title: string; text: string }) {
  return <div className="grid min-h-[70dvh] place-items-center bg-[#080A0F] px-5 text-center text-white"><div><p className="text-sm font-semibold">{title}</p><p className="mt-2 text-[10px] text-[#707787]">{text}</p></div></div>;
}
