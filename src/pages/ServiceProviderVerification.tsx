import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import VideoPlayer from '@/components/VideoPlayer';
import WorkerVerificationPhase9 from '@/pages/WorkerVerificationPhase9';
import { useRpcRead } from '@/hooks/useRpcRead';

type Props = {
  profile: Profile;
  onBack: () => void;
  onEditProfile: () => void;
};

type Activation = {
  worker_status?: string;
  reviewed?: boolean;
  profile_complete?: boolean;
  identity_required?: boolean;
  evidence_saved?: boolean;
  submitted?: boolean;
  rejection_reason?: string | null;
};

type UploadState = {
  name: string;
  phase: 'uploading' | 'complete' | 'error';
  message?: string;
} | null;

export default function ServiceProviderVerification(props: Props) {
  const { data: activation, loading, error, refresh } = useRpcRead<Activation>('get_my_worker_activation', props.profile.user_id);

  if (loading)
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#0A0A0F] text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );

  if (error || !activation)
    return (
      <SimpleShell onBack={props.onBack}>
        <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4 text-[11px] leading-5 text-amber-100/80">
          {error || 'Service Provider onboarding could not be loaded.'}
          <button type="button" onClick={() => void refresh()} className="mt-4 h-11 w-full rounded-xl border border-white/[.08] font-semibold text-white">Try again</button>
        </section>
      </SimpleShell>
    );

  // The existing face/liveness experience remains available for the day the
  // approved policy turns the server gate on. Until then WeHouse does not ask
  // for or collect biometric evidence just because the code exists.
  if (activation.identity_required === true)
    return <WorkerVerificationPhase9 {...props} />;

  return (
    <EvidenceOnlyVerification
      {...props}
      activation={activation}
      onRefresh={refresh}
    />
  );
}

function EvidenceOnlyVerification({
  profile,
  onBack,
  onEditProfile,
  activation,
  onRefresh,
}: Props & {
  activation: Activation;
  onRefresh: () => Promise<void>;
}) {
  const videoInput = useRef<HTMLInputElement>(null);
  const certificateInput = useRef<HTMLInputElement>(null);
  const [videoPath, setVideoPath] = useState('');
  const [certificatePath, setCertificatePath] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const reviewed = activation.reviewed || activation.worker_status === 'verified';
  const reviewing =
    activation.worker_status === 'profile_under_review' ||
    Boolean(activation.submitted);

  async function upload(
    file: File,
    bucket: 'worker-certificates' | 'worker-verification-videos',
    kind: string,
  ) {
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${profile.user_id}/${kind}-${Date.now()}.${ext}`;
    const result = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type || undefined });
    if (result.error) throw result.error;
    return path;
  }

  async function chooseVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast.error('Choose a video file');
    if (file.size > 50 * 1024 * 1024) return toast.error('Work video must be under 50MB');
    setUploadState({ name: file.name, phase: 'uploading' });
    try {
      const path = await upload(file, 'worker-verification-videos', 'skill-video');
      setVideoPath(path);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
      setUploadState({ name: file.name, phase: 'complete' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Video upload failed';
      setUploadState({ name: file.name, phase: 'error', message });
      toast.error(message);
    }
  }

  async function chooseCertificate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('Certificate must be under 10MB');
    setUploadState({ name: file.name, phase: 'uploading' });
    try {
      setCertificatePath(await upload(file, 'worker-certificates', 'certificate'));
      setUploadState({ name: file.name, phase: 'complete' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Certificate upload failed';
      setUploadState({ name: file.name, phase: 'error', message });
      toast.error(message);
    }
  }

  async function saveEvidence() {
    if (!videoPath) return toast.error('Add a short work demonstration video');
    setBusy(true);
    const result = await supabase.rpc('save_my_worker_professional_evidence', {
      p_certificate_path: certificatePath || null,
      p_video_path: videoPath,
    });
    setBusy(false);
    if (result.error) return toast.error(result.error.message);
    toast.success('Professional evidence saved');
    await onRefresh();
  }

  async function submit() {
    setBusy(true);
    const result = await supabase.rpc('submit_my_worker_verification');
    setBusy(false);
    if (result.error) return toast.error(result.error.message);
    toast.success('Sent to WeHouse review');
    await onRefresh();
  }

  return (
    <SimpleShell onBack={onBack}>


      <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.045] p-4">
        <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE SERVICES</p>
        <h2 className="mt-1 text-base font-semibold">Service Provider onboarding is free</h2>
        <p className="mt-2 text-[10px] leading-5 text-[#8490A3]">
          Complete your professional profile, add a short work video and submit it to WeHouse for review.
        </p>
      </section>

      {!activation.profile_complete ? (
        <Card title="Complete your Service Provider profile" text="Add your service, experience, price and service area first.">
          <PrimaryButton label="Continue profile setup" onClick={onEditProfile} />
        </Card>
      ) : reviewed ? (
        <Card title="WeHouse review complete" text="Your professional profile and work evidence have been reviewed.">
          <PrimaryButton label="Back to Service Provider workspace" onClick={onBack} />
        </Card>
      ) : reviewing ? (
        <Card title="Review in progress" text="WeHouse is reviewing the professional evidence you submitted.">
          <div className="rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-2.5 text-[9px] text-[#8990A0]">Your profile remains private until the review is completed.</div>
          <PrimaryButton label="Back to Service Provider workspace" onClick={onBack} secondary />
        </Card>
      ) : !activation.evidence_saved ? (
        <Card title="Show your real work" text="Upload one short skill or completed-work video for private WeHouse review. A certificate is optional.">
          {uploadState ? <UploadStatus state={uploadState} /> : null}
          <UploadButton label={certificatePath ? 'Certificate added' : 'Certificate · optional'} done={Boolean(certificatePath)} onClick={() => certificateInput.current?.click()} />
          <input ref={certificateInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={chooseCertificate} />
          <UploadButton label={videoPath ? 'Work video added' : 'Work demonstration · required'} done={Boolean(videoPath)} onClick={() => videoInput.current?.click()} />
          <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={chooseVideo} />
          {preview ? <VideoPlayer src={preview} className="max-h-64 w-full rounded-2xl bg-black object-contain" /> : null}
          <PrimaryButton label={busy ? 'Saving…' : 'Save work evidence'} onClick={() => void saveEvidence()} disabled={busy || !videoPath} />
        </Card>
      ) : (
        <Card title="Ready for WeHouse review" text="Your professional evidence is ready. No onboarding or verification payment is required.">
          {activation.rejection_reason ? <div className="rounded-xl border border-red-500/15 bg-red-500/[.05] px-3 py-2.5 text-[9px] text-red-200">{activation.rejection_reason}</div> : null}
          <PrimaryButton label={busy ? 'Submitting…' : 'Submit to WeHouse'} onClick={() => void submit()} disabled={busy} />
        </Card>
      )}
    </SimpleShell>
  );
}

function SimpleShell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-8 text-white">
      <header className="border-b border-white/[.06] px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07]" aria-label="Back">←</button>
          <div>
            <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">WEHOUSE · SERVICES</p>
            <h1 className="mt-1 text-lg font-bold">Service Provider review</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4">{children}</main>
    </div>
  );
}

function Card({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">{text}</p>
      </div>
      {children}
    </section>
  );
}

function PrimaryButton({ label, onClick, disabled = false, secondary = false }: { label: string; onClick: () => void; disabled?: boolean; secondary?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`h-12 w-full rounded-xl text-xs font-semibold disabled:opacity-40 ${secondary ? 'border border-white/[.08]' : 'bg-violet-500'}`}>{label}</button>;
}

function UploadButton({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex h-12 w-full items-center justify-between rounded-xl border px-4 text-xs ${done ? 'border-emerald-500/20 text-emerald-300' : 'border-white/[.08] text-[#A2A7B3]'}`}><span>{label}</span><span>{done ? '✓' : '+'}</span></button>;
}

function UploadStatus({ state }: { state: NonNullable<UploadState> }) {
  return <div className={`rounded-xl border px-3 py-2.5 text-[9px] ${state.phase === 'error' ? 'border-red-500/15 bg-red-500/[.05] text-red-200' : state.phase === 'complete' ? 'border-emerald-500/15 bg-emerald-500/[.05] text-emerald-200' : 'border-violet-500/15 bg-violet-500/[.05] text-violet-200'}`}>{state.phase === 'uploading' ? `Uploading ${state.name}…` : state.phase === 'complete' ? `${state.name} uploaded` : state.message || 'Upload failed'}</div>;
}
