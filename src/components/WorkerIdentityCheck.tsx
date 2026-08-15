import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  status?: string | null;
  rejectionReason?: string | null;
  onSaved: () => Promise<void> | void;
};

type Stage = 'intro' | 'camera' | 'ready' | 'recording' | 'review';

const CHALLENGE = [
  { label: 'Look straight at the camera', ms: 1700 },
  { label: 'Slowly turn your head left', ms: 1800 },
  { label: 'Slowly turn your head right', ms: 1800 },
  { label: 'Return to the centre', ms: 1700 },
];

export default function WorkerIdentityCheck({ profile, status, rejectionReason, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timersRef = useRef<number[]>([]);

  const [stage, setStage] = useState<Stage>('intro');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [liveness, setLiveness] = useState<Blob | null>(null);
  const [livenessUrl, setLivenessUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const failed = status === 'failed';
  const pending = status === 'pending_review';
  const passed = status === 'passed';

  useEffect(() => () => cleanup(), []);
  useEffect(() => {
    if (!videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
  }, [stage]);

  const canRecord = useMemo(() => Boolean(photo && streamRef.current), [photo]);

  function cleanup() {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (livenessUrl) URL.revokeObjectURL(livenessUrl);
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Camera verification is not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      setStage('camera');
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (error: any) {
      toast.error(error?.name === 'NotAllowedError' ? 'Allow camera access to continue' : 'Could not open the front camera');
    }
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return toast.error('Camera is still starting');
    const canvas = document.createElement('canvas');
    const side = Math.min(video.videoWidth || 720, video.videoHeight || 720);
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return toast.error('Could not capture photo');
    const sx = Math.max(0, ((video.videoWidth || side) - side) / 2);
    const sy = Math.max(0, ((video.videoHeight || side) - side) / 2);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return toast.error('Could not capture photo');
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(blob);
    setPhotoUrl(URL.createObjectURL(blob));
    setStage('ready');
  }

  function supportedVideoType() {
    if (typeof MediaRecorder === 'undefined') return '';
    return ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function recordLiveness() {
    const stream = streamRef.current;
    if (!stream || !photo) return;
    if (typeof MediaRecorder === 'undefined') return toast.error('Video verification is not supported in this browser');

    const mimeType = supportedVideoType();
    try {
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'video/webm' });
        if (livenessUrl) URL.revokeObjectURL(livenessUrl);
        setLiveness(blob);
        setLivenessUrl(URL.createObjectURL(blob));
        setPrompt('');
        setStage('review');
      };

      setStage('recording');
      recorder.start(250);
      let elapsed = 0;
      CHALLENGE.forEach((step, index) => {
        const timer = window.setTimeout(() => setPrompt(step.label), elapsed);
        timersRef.current.push(timer);
        elapsed += step.ms;
        if (index === CHALLENGE.length - 1) {
          const stopTimer = window.setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop();
          }, elapsed);
          timersRef.current.push(stopTimer);
        }
      });
    } catch {
      toast.error('Could not record the liveness check');
      setStage('ready');
    }
  }

  function retake() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (livenessUrl) URL.revokeObjectURL(livenessUrl);
    setPhoto(null);
    setPhotoUrl('');
    setLiveness(null);
    setLivenessUrl('');
    setPrompt('');
    setStage('camera');
  }

  async function submit() {
    if (!consent) return toast.error('Confirm the private identity-check consent');
    if (!photo || !liveness) return toast.error('Complete both the private photo and liveness challenge');
    setBusy(true);
    const now = Date.now();
    const photoPath = `${profile.user_id}/enrollment-${now}.jpg`;
    const videoExt = liveness.type.includes('mp4') ? 'mp4' : 'webm';
    const livenessPath = `${profile.user_id}/liveness-${now}.${videoExt}`;

    try {
      const photoUpload = await supabase.storage.from('worker-identity-private').upload(photoPath, photo, { contentType: 'image/jpeg', upsert: false });
      if (photoUpload.error) throw photoUpload.error;
      const videoUpload = await supabase.storage.from('worker-identity-private').upload(livenessPath, liveness, { contentType: liveness.type || 'video/webm', upsert: false });
      if (videoUpload.error) {
        await supabase.storage.from('worker-identity-private').remove([photoPath]);
        throw videoUpload.error;
      }
      const { error } = await supabase.rpc('save_my_worker_identity_capture', {
        p_photo_path: photoPath,
        p_liveness_path: livenessPath,
        p_consent: true,
      });
      if (error) {
        await supabase.storage.from('worker-identity-private').remove([photoPath, livenessPath]);
        throw error;
      }
      toast.success('Private face and liveness check saved');
      cleanup();
      await onSaved();
    } catch (error: any) {
      toast.error(error?.message || 'Identity check could not be saved');
    } finally {
      setBusy(false);
    }
  }

  if (passed) return <StatusCard tone="good" title="Identity & liveness passed" text="Your private WeHouse face check has been approved. The media is not shown publicly." />;
  if (pending) return <StatusCard tone="pending" title="Identity check captured" text="Your private selfie and liveness challenge are ready for Verification Staff review." />;

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#10141D]">
      <div className="border-b border-white/[.05] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">PRIVATE IDENTITY CHECK</p>
            <h3 className="mt-1 text-base font-bold">Confirm it is really you</h3>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#747B8B]">No NIN or government document. WeHouse privately compares your account photo with a short live head-turn challenge during review.</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/[.04] px-2 py-1 text-[8px] text-[#7D8392]">NOT PUBLIC</span>
        </div>
        {failed && rejectionReason && <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.05] p-3 text-[9px] text-red-200">Previous check needs a retry: {rejectionReason}</div>}
      </div>

      {stage === 'intro' ? (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2">
            <MiniStep n="1" label="Private photo" />
            <MiniStep n="2" label="Turn left & right" />
            <MiniStep n="3" label="Staff review" />
          </div>
          <p className="text-[9px] leading-relaxed text-[#656C7D]">Use your front camera in good light. Remove sunglasses or anything covering most of your face.</p>
          <button onClick={() => void openCamera()} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold text-white">Start private face check</button>
        </div>
      ) : (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-[28px] border border-white/[.08] bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
            <div className="pointer-events-none absolute inset-[12%] rounded-[42%] border border-white/35" />
            {stage === 'recording' && <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/70 px-3 py-3 text-center text-xs font-semibold text-white backdrop-blur">{prompt || 'Get ready…'}</div>}
            {stage === 'ready' && photoUrl && <img src={photoUrl} alt="Private enrollment preview" className="absolute bottom-3 right-3 h-16 w-16 rounded-2xl border-2 border-white/60 object-cover" />}
          </div>

          {stage === 'camera' && <button onClick={() => void capturePhoto()} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold">Capture private photo</button>}
          {stage === 'ready' && <button disabled={!canRecord} onClick={() => void recordLiveness()} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">Start head-turn check</button>}
          {stage === 'recording' && <p className="text-center text-[9px] text-[#72798A]">Follow the instruction slowly. Recording stops automatically.</p>}

          {stage === 'review' && (
            <div className="space-y-3">
              <video src={livenessUrl} controls playsInline className="max-h-56 w-full rounded-2xl bg-black object-contain" />
              <label className="flex items-start gap-3 rounded-xl border border-white/[.07] bg-black/10 p-3">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
                <span className="text-[9px] leading-relaxed text-[#7A8190]">I agree to WeHouse using this private photo and liveness capture only for Worker identity/trust verification. It will not appear on my public profile.</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={retake} disabled={busy} className="h-11 rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#A8ADBA]">Retake</button>
                <button onClick={() => void submit()} disabled={busy || !consent} className="h-11 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save private check'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MiniStep({ n, label }: { n: string; label: string }) {
  return <div className="rounded-xl border border-white/[.06] bg-black/10 p-3 text-center"><span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-violet-500/10 text-[9px] font-bold text-violet-300">{n}</span><p className="mt-2 text-[8px] text-[#747B8B]">{label}</p></div>;
}

function StatusCard({ tone, title, text }: { tone: 'good' | 'pending'; title: string; text: string }) {
  return <section className={`rounded-2xl border p-4 ${tone === 'good' ? 'border-emerald-500/15 bg-emerald-500/[.04]' : 'border-violet-500/15 bg-violet-500/[.04]'}`}><p className={`text-xs font-semibold ${tone === 'good' ? 'text-emerald-300' : 'text-violet-300'}`}>{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#747B8B]">{text}</p></section>;
}
