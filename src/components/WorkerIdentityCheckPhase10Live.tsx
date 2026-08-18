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
type Stage = 'intro' | 'loading' | 'checking' | 'failed' | 'success';
type Step = 'center_start' | 'side_one' | 'side_two' | 'center_end';
type Sample = {
  similarity: number;
  anchorSimilarity: number;
  recentSimilarity: number;
  live: number;
  real: number;
  yaw: number;
  pitch: number;
};
type RefData = {
  has_reference?: boolean;
  photo_path?: string | null;
  anchor_photo_path?: string | null;
  recent_photo_path?: string | null;
};

const MODULE = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';
// Keep the engine and its models on the same CDN. The previous GitHub Pages
// model host could hang indefinitely on mobile networks after the UI loaded.
const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/';
const LABEL: Record<Step, string> = {
  center_start: 'Look straight at the camera',
  side_one: 'Slowly turn your head to one side',
  side_two: 'Now turn to the other side',
  center_end: 'Look straight again',
};
const CENTER = 0.3;
const PITCH = 0.28;
const TURN = 0.18;
const POSE_MATCH = 0.45;
const FINAL_MATCH = 0.55;
const ANCHOR_MIN = 0.5;
const LIVE = 0.5;
const REAL = 0.5;

export default function WorkerIdentityCheckPhase10Live({ profile, status, rejectionReason, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const humanRef = useRef<any>(null);
  const anchorEmbeddingRef = useRef<number[] | null>(null);
  const recentEmbeddingRef = useRef<number[] | null>(null);
  const currentEmbeddingRef = useRef<number[] | null>(null);
  const currentPhotoRef = useRef<Blob | null>(null);
  const anchorPathRef = useRef<string | null>(null);
  const recentPathRef = useRef<string | null>(null);
  const cancelled = useRef(false);

  const [stage, setStage] = useState<Stage>('intro');
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [hint, setHint] = useState('');
  const [step, setStep] = useState(0);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [renewal, setRenewal] = useState(status === 'expired');

  useEffect(() => () => {
    cancelled.current = true;
    stopCamera();
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function currentCanvas() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 720;
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = side;
    canvas.height = side;
    if (!ctx) return null;
    ctx.drawImage(video, Math.max(0, (width - side) / 2), Math.max(0, (height - side) / 2), side, side, 0, 0, side, side);
    return canvas;
  }

  async function human() {
    if (humanRef.current) return humanRef.current;
    setStage('loading');
    setPrompt('Preparing secure face check…');
    const mod: any = await import(/* @vite-ignore */ MODULE);
    const Human = mod.default || mod.Human;
    if (!Human) throw new Error('Face-check engine could not load');
    const instance = new Human({
      debug: false,
      backend: 'webgl',
      modelBasePath: MODELS,
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
    await Promise.race([
      instance.load(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error('The secure face engine could not load. Check your connection and tap Try again.')), 20000)),
    ]);
    humanRef.current = instance;
    return instance;
  }

  async function embeddingForPath(path: string) {
    const signed = await supabase.storage.from('worker-identity-private').createSignedUrl(path, 300);
    if (signed.error || !signed.data?.signedUrl) throw new Error('A private Worker face reference could not be loaded');
    const canvas = await imageCanvas(signed.data.signedUrl);
    const result = await humanRef.current.detect(canvas);
    const face = result.face?.[0];
    if (result.face?.length !== 1 || !face?.embedding?.length) throw new Error('A private Worker face reference could not be read');
    return [...face.embedding] as number[];
  }

  async function loadBaseline() {
    const { data, error } = await supabase.rpc('get_my_worker_identity_reference');
    if (error) throw error;
    const ref = (data || {}) as RefData;
    const anchorPath = ref.anchor_photo_path || ref.photo_path || null;
    if (!ref.has_reference || !anchorPath) return false;

    const anchorEmbedding = await embeddingForPath(anchorPath);
    const recentPath = ref.recent_photo_path || anchorPath;
    let recentEmbedding = anchorEmbedding;
    if (recentPath !== anchorPath) {
      try {
        recentEmbedding = await embeddingForPath(recentPath);
      } catch {
        recentEmbedding = anchorEmbedding;
      }
    }

    anchorEmbeddingRef.current = anchorEmbedding;
    recentEmbeddingRef.current = recentEmbedding;
    anchorPathRef.current = anchorPath;
    recentPathRef.current = recentPath;
    setRenewal(true);
    return true;
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported on this device');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } },
    });
    stopCamera();
    streamRef.current = stream;
    setStage('checking');
    await frames();
    const video = videoRef.current;
    if (!video) throw new Error('Camera view could not open');
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    await videoReady(video);
  }

  async function start() {
    if (!consent) return toast.error('Confirm the privacy notice first');
    if (busy) return;
    cancelled.current = false;
    setBusy(true);
    setFailure('');
    setHint('');
    setStep(0);
    try {
      await human();
      const existing = await loadBaseline();
      await openCamera();
      await captureCurrentReference(existing);
      await challenge(existing);
    } catch (error: any) {
      stopCamera();
      setFailure(error?.name === 'NotAllowedError' ? 'Allow camera access to continue.' : error?.message || 'Face check could not start.');
      setStage('failed');
    } finally {
      setBusy(false);
    }
  }

  async function captureCurrentReference(existing: boolean) {
    setPrompt(existing ? 'Center your face so WeHouse can update your trusted appearance' : 'Center your face in the oval');
    setHint('Good lighting. Keep the phone steady.');
    const began = Date.now();

    while (Date.now() - began < 18000 && !cancelled.current) {
      const canvas = currentCanvas();
      if (!canvas) {
        await sleep(180);
        continue;
      }
      const result = await humanRef.current.detect(canvas);
      const face = result.face?.[0];
      if (result.face?.length !== 1) {
        setHint('Keep only your face in the frame.');
        await sleep(220);
        continue;
      }
      const yaw = Math.abs(Number(face?.rotation?.angle?.yaw ?? 99));
      const pitch = Math.abs(Number(face?.rotation?.angle?.pitch ?? 99));
      if (!face?.embedding?.length || yaw > CENTER || pitch > PITCH || Number(face.score || 0) < 0.7) {
        setHint('Face forward and move into brighter light.');
        await sleep(220);
        continue;
      }

      const embedding = [...face.embedding] as number[];
      if (existing) {
        const anchor = anchorEmbeddingRef.current;
        const recent = recentEmbeddingRef.current || anchor;
        if (!anchor) throw new Error('Original Worker identity reference is missing');
        const anchorSimilarity = Number(humanRef.current.match.similarity(anchor, embedding));
        const recentSimilarity = recent ? Number(humanRef.current.match.similarity(recent, embedding)) : anchorSimilarity;
        if (anchorSimilarity < ANCHOR_MIN || Math.max(anchorSimilarity, recentSimilarity) < FINAL_MATCH) {
          setHint('Your face is not close enough to the trusted Worker identity yet. Face forward, improve the light and try again.');
          await sleep(260);
          continue;
        }
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Could not prepare your private Worker face reference');
      currentEmbeddingRef.current = embedding;
      currentPhotoRef.current = blob;
      if (!existing) {
        anchorEmbeddingRef.current = embedding;
        recentEmbeddingRef.current = embedding;
        anchorPathRef.current = null;
        recentPathRef.current = null;
        setRenewal(false);
      }
      setHint(existing ? 'Appearance confirmed. Follow the movement prompts.' : 'Face captured. Follow the movement prompts.');
      await sleep(400);
      return;
    }
    throw new Error('We could not get a clear centered face. Improve the lighting and try again.');
  }

  async function sample(existing: boolean): Promise<Sample> {
    const video = videoRef.current;
    const engine = humanRef.current;
    const current = currentEmbeddingRef.current;
    if (!video || !engine || !current) throw new Error('Face reference is not ready');

    const canvas = currentCanvas();
    if (!canvas) throw new Error('Camera frame is not ready');
    const result = await engine.detect(canvas);
    const face = result.face?.[0];
    if (result.face?.length !== 1) throw new Error('Keep only your face in the frame');
    if (!face?.embedding?.length || !face.rotation) throw new Error('Keep your full face visible');

    const currentSimilarity = Number(engine.match.similarity(current, face.embedding));
    const anchor = anchorEmbeddingRef.current || current;
    const recent = recentEmbeddingRef.current || anchor;
    const anchorSimilarity = Number(engine.match.similarity(anchor, face.embedding));
    const recentSimilarity = Number(engine.match.similarity(recent, face.embedding));
    const identitySimilarity = existing ? Math.max(anchorSimilarity, recentSimilarity) : currentSimilarity;

    return {
      similarity: Math.min(currentSimilarity, identitySimilarity),
      anchorSimilarity,
      recentSimilarity,
      live: Number(face.live ?? 0),
      real: Number(face.real ?? 0),
      yaw: Number(face.rotation.angle.yaw ?? 0),
      pitch: Number(face.rotation.angle.pitch ?? 0),
    };
  }

  async function challenge(existing: boolean) {
    const steps: Step[] = ['center_start', 'side_one', 'side_two', 'center_end'];
    const all: Sample[] = [];
    const security: Sample[] = [];
    let current = 0;
    let stable = 0;
    let sideSign = 0;
    const began = Date.now();

    while (current < steps.length && !cancelled.current) {
      if (Date.now() - began > 42000) throw new Error('The face check timed out. Follow each movement slowly and try again.');
      const currentStep = steps[current];
      setPrompt(LABEL[currentStep]);
      setStep(current);
      let value: Sample;
      try {
        value = await sample(existing);
      } catch {
        stable = 0;
        setHint('Keep your full face inside the oval.');
        await sleep(210);
        continue;
      }

      if (value.similarity < POSE_MATCH) {
        stable = 0;
        setHint('Keep the same face clearly visible.');
        await sleep(210);
        continue;
      }

      const absYaw = Math.abs(value.yaw);
      const absPitch = Math.abs(value.pitch);
      let correct = false;
      if (currentStep === 'center_start' || currentStep === 'center_end') correct = absYaw <= CENTER && absPitch <= PITCH;
      if (currentStep === 'side_one') correct = absYaw >= TURN;
      if (currentStep === 'side_two') correct = absYaw >= TURN && sideSign !== 0 && Math.sign(value.yaw) === -sideSign;

      if (!correct) {
        stable = 0;
        setHint(currentStep.includes('center') ? 'Face forward and hold still.' : 'Turn a little farther, slowly.');
        await sleep(180);
        continue;
      }

      stable += 1;
      all.push(value);
      if (currentStep === 'center_start' || currentStep === 'center_end') security.push(value);
      if (stable >= 1) {
        if (currentStep === 'side_one') sideSign = Math.sign(value.yaw) || 1;
        current += 1;
        stable = 0;
        setHint(current < steps.length ? 'Good. Next movement…' : 'Checking…');
        await sleep(350);
      }
      await sleep(180);
    }

    if (cancelled.current) return;
    if (all.length < 4 || security.length < 2) throw new Error('We could not collect enough clear face frames. Try again.');

    const identityScores = all.map((value) => existing ? Math.max(value.anchorSimilarity, value.recentSimilarity) : value.similarity);
    const match = median(identityScores);
    const anchorSimilarity = median(security.map((value) => value.anchorSimilarity));
    const recentSimilarity = median(security.map((value) => value.recentSimilarity));
    const live = median(security.map((value) => value.live));
    const real = median(security.map((value) => value.real));

    if (match < FINAL_MATCH) throw new Error('Your live face did not match the trusted Worker identity closely enough.');
    if (existing && anchorSimilarity < ANCHOR_MIN) throw new Error('Your appearance changed more than expected from the original Worker identity. WeHouse review is required.');
    if (live < LIVE || real < REAL) throw new Error('We could not confirm a live, real face. Use brighter light, remove screen glare and try again.');

    await save(match, live, real, anchorSimilarity, recentSimilarity, existing);
  }

  async function save(match: number, live: number, real: number, anchorSimilarity: number, recentSimilarity: number, existing: boolean) {
    const photo = currentPhotoRef.current;
    if (!photo) throw new Error('Private Worker face is missing');

    const path = `${profile.user_id}/${existing ? 'identity-reference' : 'identity-enrollment'}-${Date.now()}.jpg`;
    const upload = await supabase.storage.from('worker-identity-private').upload(path, photo, { contentType: 'image/jpeg', upsert: false });
    if (upload.error) throw upload.error;

    const { error } = await supabase.rpc('complete_my_worker_identity_check', {
      p_photo_path: path,
      p_face_match_score: match,
      p_liveness_score: live,
      p_anti_spoof_score: real,
      p_challenge_result: {
        center_start: true,
        side_one: true,
        side_two: true,
        center_end: true,
        automatic: true,
        recorded_video: false,
        renewal: existing,
        original_face_anchor: existing,
        adaptive_recent_reference: existing,
        anchor_similarity: Number(anchorSimilarity.toFixed(6)),
        recent_similarity: Number(recentSimilarity.toFixed(6)),
      },
      p_consent: true,
    });

    if (error) {
      await supabase.storage.from('worker-identity-private').remove([path]);
      throw error;
    }

    const previousRecent = recentPathRef.current;
    const anchorPath = anchorPathRef.current;
    if (existing && previousRecent && previousRecent !== anchorPath && previousRecent !== path) {
      void supabase.storage.from('worker-identity-private').remove([previousRecent]);
    }

    stopCamera();
    setPrompt('Identity confirmed');
    setHint(existing ? 'Your trusted recent appearance has been refreshed securely.' : 'Your Worker verification is saved securely.');
    setStage('success');
    toast.success(existing ? 'Identity re-check complete' : 'Private face check complete');
    await onSaved();
  }

  function retry() {
    stopCamera();
    anchorEmbeddingRef.current = null;
    recentEmbeddingRef.current = null;
    currentEmbeddingRef.current = null;
    currentPhotoRef.current = null;
    anchorPathRef.current = null;
    recentPathRef.current = null;
    setFailure('');
    setPrompt('');
    setHint('');
    setStep(0);
    setStage('intro');
  }

  if (status === 'passed') {
    return (
      <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.04] p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/12 text-emerald-300">✓</span>
          <div>
            <p className="text-xs font-semibold text-emerald-300">Worker identity confirmed</p>
            <p className="mt-1 text-[9px] text-[#747B8B]">The original identity stays protected while successful re-checks keep a trusted recent appearance. No liveness video was stored.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-white/[.07] bg-[#0F131B] shadow-2xl shadow-black/20">
      <div className="border-b border-white/[.055] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-violet-300"><FaceIcon /></div>
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">PRIVATE IDENTITY CHECK</p>
            <h3 className="mt-1 text-lg font-bold">{renewal ? 'Confirm it is still you' : 'Confirm your Worker identity'}</h3>
            <p className="mt-1 text-[10px] leading-5 text-[#747C8E]">
              {renewal
                ? 'WeHouse checks both your original identity and your latest trusted appearance. Successful re-checks safely adapt to changes such as beard growth, haircut, glasses or ageing.'
                : 'One guided camera session creates your permanent private identity anchor and checks that you are live.'}
            </p>
          </div>
        </div>
      </div>

      {(stage === 'checking' || stage === 'loading') && (
        <div className="p-4 sm:p-5">
          <div className="relative mx-auto aspect-[3/4] max-h-[62dvh] w-full max-w-sm overflow-hidden rounded-[32px] bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_42%_38%_at_50%_43%,transparent_0%,transparent_66%,rgba(0,0,0,.66)_67%,rgba(0,0,0,.86)_100%)]" />
            <div className="pointer-events-none absolute left-1/2 top-[43%] h-[52%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-violet-300/80 shadow-[0_0_30px_rgba(167,139,250,.22)]" />
            <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-black/45 p-3 text-center backdrop-blur-xl">
              <p className="text-sm font-semibold">{prompt || 'Preparing camera…'}</p>
              <p className="mt-1 text-[9px] text-white/65">{hint || 'Keep your face inside the oval.'}</p>
            </div>
          </div>
          <div className="mx-auto mt-4 flex max-w-sm gap-2">{[0, 1, 2, 3].map((index) => <div key={index} className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-emerald-400' : index === step ? 'bg-violet-400' : 'bg-white/[.08]'}`} />)}</div>
          <p className="mt-2 text-center text-[8px] uppercase tracking-[.15em] text-[#616879]">{stage === 'loading' ? 'Loading secure camera check' : `Movement ${step + 1} of 4`}</p>
        </div>
      )}

      {stage === 'intro' && (
        <div className="space-y-4 p-4 sm:p-5">
          {rejectionReason && <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[9px] text-amber-100">{rejectionReason}</div>}
          <div className="grid gap-2 sm:grid-cols-3">
            <Info icon="◉" title="Center your face" text="Good light, one person only." />
            <Info icon="↔" title="Follow the turns" text="Move slowly when prompted." />
            <Info icon="⟳" title="Adapts safely" text="Keeps the original and latest trusted look." />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[.06] bg-black/10 p-3">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
            <span className="text-[9px] leading-5 text-[#818899]">I agree to a private automated face, liveness and anti-spoof check for Worker account protection. My original enrollment remains protected and a successful re-check may refresh my private recent appearance reference.</span>
          </label>
          <button onClick={() => void start()} disabled={!consent || busy} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:bg-white/[.06] disabled:text-[#62697A]">{busy ? 'Starting…' : renewal ? 'Start identity re-check' : 'Start face check'}</button>
          <p className="text-center text-[8px] text-[#555D6D]">Front camera only. Uploaded photos cannot replace the liveness check.</p>
        </div>
      )}

      {stage === 'failed' && (
        <div className="space-y-4 p-5 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-500/10 text-xl text-red-300">!</div>
          <h4 className="text-base font-bold">We could not complete the check</h4>
          <p className="mx-auto max-w-sm text-[10px] leading-5 text-[#858C9D]">{failure}</p>
          <button onClick={retry} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold">Try again</button>
        </div>
      )}

      {stage === 'success' && (
        <div className="space-y-3 p-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/12 text-2xl text-emerald-300">✓</div>
          <h4 className="text-lg font-bold">Identity confirmed</h4>
          <p className="text-[10px] text-[#7B8394]">{renewal ? 'Your original identity remains protected and your latest trusted appearance is now updated.' : 'The result is saved. WeHouse is unlocking the next step.'}</p>
        </div>
      )}
    </section>
  );
}

async function imageCanvas(url: string) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Private identity image could not load'));
  });
  const width = image.naturalWidth || 720;
  const height = image.naturalHeight || 720;
  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = side;
  canvas.height = side;
  if (!ctx) throw new Error('Image could not be prepared');
  ctx.drawImage(image, Math.max(0, (width - side) / 2), Math.max(0, (height - side) / 2), side, side, 0, 0, side, side);
  return canvas;
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function frames() { return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function videoReady(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    const timer = window.setTimeout(() => { off(); reject(new Error('Camera took too long to start')); }, 8000);
    const ready = () => { if (video.videoWidth > 0) { off(); resolve(); } };
    const off = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
    };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
  });
}
function Info({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="rounded-2xl border border-white/[.055] bg-white/[.018] p-3"><span className="text-lg text-violet-300">{icon}</span><p className="mt-2 text-[10px] font-semibold">{title}</p><p className="mt-1 text-[8px] leading-4 text-[#6C7485]">{text}</p></div>;
}
function FaceIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M8 21H6a3 3 0 0 1-3-3v-2M16 21h2a3 3 0 0 0 3-3v-2" /><circle cx="9" cy="10" r="1" /><circle cx="15" cy="10" r="1" /><path d="M8.5 15c2.2 1.6 4.8 1.6 7 0" /></svg>;
}
