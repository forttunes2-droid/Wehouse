import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  status?: string | null;
  rejectionReason?: string | null;
  onSaved: () => Promise<void> | void;
};

type Stage = 'intro' | 'loading' | 'camera' | 'ready' | 'checking' | 'failed';
type ChallengeStep = 'center_start' | 'side_one' | 'side_two' | 'center_end';

type FaceSample = {
  similarity: number;
  live: number;
  real: number;
  yaw: number;
};

const HUMAN_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';
const HUMAN_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/';
const MATCH_MIN = 0.55;
const LIVE_MIN = 0.5;
const REAL_MIN = 0.5;
const CENTER_YAW_MAX = 0.18;
const TURN_YAW_MIN = 0.3;
const STABLE_FRAMES = 2;
const CHECK_TIMEOUT_MS = 28000;

const STEP_LABELS: Record<ChallengeStep, string> = {
  center_start: 'Look straight at the camera',
  side_one: 'Turn your head to one side',
  side_two: 'Now turn your head to the other side',
  center_end: 'Look straight at the camera again',
};

export default function WorkerIdentityCheck({ profile, status, rejectionReason, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const humanRef = useRef<any>(null);
  const enrollmentEmbeddingRef = useRef<number[] | null>(null);
  const photoRef = useRef<Blob | null>(null);
  const photoUrlRef = useRef('');
  const cancelledRef = useRef(false);

  const [stage, setStage] = useState<Stage>('intro');
  const [photoUrl, setPhotoUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const passed = status === 'passed';

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stopCamera();
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  async function ensureHuman() {
    if (humanRef.current) return humanRef.current;
    setStage('loading');
    setPrompt('Preparing secure face check…');
    try {
      const module: any = await import(/* @vite-ignore */ HUMAN_MODULE_URL);
      const Human = module.default || module.Human;
      if (!Human) throw new Error('Face-check engine could not be loaded');
      const human = new Human({
        debug: false,
        backend: 'webgl',
        modelBasePath: HUMAN_MODEL_URL,
        filter: { enabled: true, equalization: false, flip: false },
        face: {
          enabled: true,
          detector: { enabled: true, rotation: true, maxDetected: 1, minConfidence: 0.7 },
          mesh: { enabled: true },
          iris: { enabled: false },
          description: { enabled: true },
          emotion: { enabled: false },
          antispoof: { enabled: true },
          liveness: { enabled: true },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
      });
      await human.load();
      humanRef.current = human;
      return human;
    } catch (error: any) {
      setStage('intro');
      setPrompt('');
      throw new Error(error?.message || 'Automatic face check could not start');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function openCamera() {
    if (!consent) return toast.error('Confirm the private face-check consent first');
    if (!navigator.mediaDevices?.getUserMedia) return toast.error('Camera verification is not supported in this browser');
    setBusy(true);
    try {
      await ensureHuman();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      });
      stopCamera();
      streamRef.current = stream;
      setStage('camera');
      setPrompt('Place your face inside the frame');
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (error: any) {
      toast.error(error?.name === 'NotAllowedError' ? 'Allow camera access to continue' : error?.message || 'Could not open the front camera');
      setStage('intro');
    } finally {
      setBusy(false);
    }
  }

  function canvasFromVideo() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const side = Math.min(video.videoWidth || 720, video.videoHeight || 720);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sx = Math.max(0, ((video.videoWidth || side) - side) / 2);
    const sy = Math.max(0, ((video.videoHeight || side) - side) / 2);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);
    return canvas;
  }

  async function captureLiveSelfie() {
    const human = humanRef.current;
    const canvas = canvasFromVideo();
    if (!human || !canvas) return toast.error('Camera is still starting');
    setBusy(true);
    setPrompt('Checking selfie quality…');
    try {
      const result = await human.detect(canvas);
      if (result.face?.length !== 1) throw new Error('Keep only one face clearly visible');
      const face = result.face[0];
      if (!face.embedding?.length) throw new Error('Could not read your face clearly. Try better lighting');
      const yaw = Math.abs(Number(face.rotation?.angle?.yaw ?? 99));
      const pitch = Math.abs(Number(face.rotation?.angle?.pitch ?? 99));
      if (yaw > CENTER_YAW_MAX || pitch > 0.22) throw new Error('Look straight at the camera for the selfie');
      if (Number(face.score || 0) < 0.7 || Number(face.faceScore || 0) < 0.7) throw new Error('Move into better light and keep your face clear');
      if (Number(face.live ?? 0) < LIVE_MIN || Number(face.real ?? 0) < REAL_MIN) throw new Error('We could not confirm a live face. Try again in clear light');

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not capture the selfie');

      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      const url = URL.createObjectURL(blob);
      photoUrlRef.current = url;
      photoRef.current = blob;
      enrollmentEmbeddingRef.current = [...face.embedding];
      setPhotoUrl(url);
      setStage('ready');
      setPrompt('Selfie ready');
    } catch (error: any) {
      setPrompt('Place your face inside the frame');
      toast.error(error?.message || 'Selfie could not be validated');
    } finally {
      setBusy(false);
    }
  }

  async function readLiveSample(): Promise<FaceSample> {
    const human = humanRef.current;
    const video = videoRef.current;
    const reference = enrollmentEmbeddingRef.current;
    if (!human || !video || !reference) throw new Error('Retake your live selfie');
    const result = await human.detect(video);
    if (result.face?.length !== 1) throw new Error('Keep only your face in the camera');
    const face = result.face[0];
    if (!face.embedding?.length || !face.rotation) throw new Error('Keep your full face visible');
    const similarity = Number(human.match.similarity(reference, face.embedding));
    const live = Number(face.live ?? 0);
    const real = Number(face.real ?? 0);
    const yaw = Number(face.rotation.angle.yaw ?? 0);
    if (similarity < MATCH_MIN) throw new Error('The live face does not match your selfie closely enough');
    if (live < LIVE_MIN || real < REAL_MIN) throw new Error('We could not confirm a live face. Do not use a photo or another screen');
    return { similarity, live, real, yaw };
  }

  async function runAutomaticCheck() {
    if (!photoRef.current || !enrollmentEmbeddingRef.current) return toast.error('Take the live selfie first');
    setBusy(true);
    setFailure('');
    setStage('checking');
    setStepIndex(0);
    const steps: ChallengeStep[] = ['center_start', 'side_one', 'side_two', 'center_end'];
    const samples: FaceSample[] = [];
    let sideSign = 0;
    let stable = 0;
    let current = 0;
    const started = Date.now();

    try {
      while (!cancelledRef.current && current < steps.length) {
        if (Date.now() - started > CHECK_TIMEOUT_MS) throw new Error('Face check timed out. Follow each movement a little more clearly');
        const step = steps[current];
        setPrompt(STEP_LABELS[step]);
        setStepIndex(current);
        let sample: FaceSample;
        try {
          sample = await readLiveSample();
        } catch (error: any) {
          stable = 0;
          setPrompt(error?.message || STEP_LABELS[step]);
          await sleep(260);
          continue;
        }

        const absYaw = Math.abs(sample.yaw);
        let correct = false;
        if (step === 'center_start' || step === 'center_end') correct = absYaw <= CENTER_YAW_MAX;
        if (step === 'side_one') correct = absYaw >= TURN_YAW_MIN;
        if (step === 'side_two') correct = absYaw >= TURN_YAW_MIN && sideSign !== 0 && Math.sign(sample.yaw) === -sideSign;

        if (correct) {
          stable += 1;
          samples.push(sample);
          if (stable >= STABLE_FRAMES) {
            if (step === 'side_one') sideSign = Math.sign(sample.yaw) || 1;
            current += 1;
            stable = 0;
            setStepIndex(Math.min(current, steps.length - 1));
            await sleep(320);
          }
        } else {
          stable = 0;
        }
        await sleep(220);
      }

      if (cancelledRef.current) return;
      if (!samples.length) throw new Error('We could not complete the face check');
      const minimum = (key: keyof Pick<FaceSample, 'similarity' | 'live' | 'real'>) => Math.min(...samples.map((sample) => sample[key]));
      await savePassedCheck(minimum('similarity'), minimum('live'), minimum('real'));
    } catch (error: any) {
      setFailure(error?.message || 'Automatic face check failed. Try again');
      setStage('failed');
      setPrompt('');
    } finally {
      setBusy(false);
    }
  }

  async function savePassedCheck(faceMatchScore: number, livenessScore: number, antiSpoofScore: number) {
    const photo = photoRef.current;
    if (!photo) throw new Error('Live selfie is missing');
    const path = `${profile.user_id}/live-selfie-${Date.now()}.jpg`;
    const upload = await supabase.storage.from('worker-identity-private').upload(path, photo, { contentType: 'image/jpeg', upsert: false });
    if (upload.error) throw upload.error;

    const challengeResult = {
      center_start: true,
      side_one: true,
      side_two: true,
      center_end: true,
      automatic: true,
      recorded_video: false,
    };
    const { error } = await supabase.rpc('complete_my_worker_identity_check', {
      p_photo_path: path,
      p_face_match_score: faceMatchScore,
      p_liveness_score: livenessScore,
      p_anti_spoof_score: antiSpoofScore,
      p_challenge_result: challengeResult,
      p_consent: true,
    });
    if (error) {
      await supabase.storage.from('worker-identity-private').remove([path]);
      throw error;
    }

    toast.success('Automatic face check passed');
    stopCamera();
    await onSaved();
  }

  function retryCheck() {
    setFailure('');
    setPrompt('Look straight at the camera');
    setStage('ready');
  }

  function retakeSelfie() {
    enrollmentEmbeddingRef.current = null;
    photoRef.current = null;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = '';
    setPhotoUrl('');
    setFailure('');
    setPrompt('Place your face inside the frame');
    setStage('camera');
  }

  if (passed) {
    return <StatusCard title="Automatic face check passed" text="Your live selfie matched the live camera check and the required head movements were detected. No liveness video was recorded or stored." />;
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#10141D]">
      <div className="border-b border-white/[.05] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">PRIVATE FACE CHECK</p>
            <h3 className="mt-1 text-base font-bold">Confirm it is really you</h3>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#747B8B]">Take one clear live selfie. WeHouse then compares the live camera face to that selfie and automatically detects your head movement. No government ID and no liveness video.</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/[.04] px-2 py-1 text-[8px] text-[#7D8392]">NOT PUBLIC</span>
        </div>
        {rejectionReason && <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.05] p-3 text-[9px] text-red-200">Previous check needs attention: {rejectionReason}</div>}
      </div>

      {stage === 'intro' || stage === 'loading' ? (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2">
            <MiniStep n="1" label="Live selfie" />
            <MiniStep n="2" label="Automatic movement" />
            <MiniStep n="3" label="Face matched" />
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-white/[.07] bg-black/10 p-3">
            <input type="checkbox" checked={consent} disabled={stage === 'loading'} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
            <span className="text-[9px] leading-relaxed text-[#7A8190]">I agree to WeHouse using my private live selfie and on-device face-check results only for Worker verification. My selfie will not appear on my public profile.</span>
          </label>
          <button onClick={() => void openCamera()} disabled={!consent || busy || stage === 'loading'} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">{stage === 'loading' ? 'Preparing face check…' : 'Start private face check'}</button>
        </div>
      ) : (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-[28px] border border-white/[.08] bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
            <div className="pointer-events-none absolute inset-[12%] rounded-[42%] border border-white/35" />
            {photoUrl && stage !== 'camera' && <img src={photoUrl} alt="Private live selfie" className="absolute bottom-3 right-3 h-16 w-16 rounded-2xl border-2 border-white/60 object-cover" />}
            {(stage === 'checking' || prompt) && <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/75 px-3 py-3 text-center text-xs font-semibold text-white backdrop-blur">{prompt}</div>}
          </div>

          {stage === 'camera' && <button onClick={() => void captureLiveSelfie()} disabled={busy} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{busy ? 'Checking selfie…' : 'Take live selfie'}</button>}

          {stage === 'ready' && (
            <div className="space-y-2">
              <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[.04] p-3 text-[9px] text-emerald-300">Live selfie is clear. Keep the same person in front of the camera for the automatic movement check.</div>
              <button onClick={() => void runAutomaticCheck()} disabled={busy} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">Start automatic check</button>
              <button onClick={retakeSelfie} disabled={busy} className="h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#A8ADBA]">Retake selfie</button>
            </div>
          )}

          {stage === 'checking' && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1">{['Straight', 'One side', 'Other side', 'Straight'].map((label, index) => <div key={label} className={`rounded-lg px-1 py-2 text-center text-[8px] ${index < stepIndex ? 'bg-emerald-500/10 text-emerald-300' : index === stepIndex ? 'bg-violet-500/15 text-violet-200' : 'bg-white/[.03] text-[#5E6575]'}`}>{index < stepIndex ? '✓ ' : ''}{label}</div>)}</div>
              <p className="text-center text-[9px] text-[#72798A]">The camera is analyzed live. Nothing from this movement step is recorded as a video.</p>
            </div>
          )}

          {stage === 'failed' && (
            <div className="space-y-2">
              <div className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3 text-[9px] leading-relaxed text-red-200">{failure}</div>
              <button onClick={retryCheck} disabled={busy} className="h-11 w-full rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">Try live check again</button>
              <button onClick={retakeSelfie} disabled={busy} className="h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#A8ADBA]">Retake selfie</button>
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

function StatusCard({ title, text }: { title: string; text: string }) {
  return <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.04] p-4"><p className="text-xs font-semibold text-emerald-300">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#747B8B]">{text}</p></section>;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
