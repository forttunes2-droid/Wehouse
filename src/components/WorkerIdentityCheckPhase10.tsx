import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = { profile: Profile; status?: string | null; rejectionReason?: string | null; onSaved: () => Promise<void> | void };
type Stage = 'intro' | 'loading' | 'checking' | 'failed' | 'success';
type ChallengeStep = 'center_start' | 'side_one' | 'side_two' | 'center_end';
type Sample = { similarity: number; live: number; real: number; yaw: number; pitch: number };
type IdentityReference = { has_reference?: boolean; photo_path?: string | null; captured_at?: string | null; status?: string | null };

const HUMAN_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';
const HUMAN_MODEL_URL = 'https://vladmandic.github.io/human-models/models/';
const CENTER_YAW_MAX = 0.2;
const CENTER_PITCH_MAX = 0.28;
const TURN_YAW_MIN = 0.27;
const POSE_MATCH_MIN = 0.45;
const FINAL_MATCH_MIN = 0.55;
const LIVE_MIN = 0.5;
const REAL_MIN = 0.5;
const STABLE_FRAMES = 2;
const CHECK_TIMEOUT_MS = 42000;

const STEP_LABELS: Record<ChallengeStep, string> = {
  center_start: 'Look straight at the camera',
  side_one: 'Slowly turn your head to one side',
  side_two: 'Now turn your head to the other side',
  center_end: 'Look straight again',
};

export default function WorkerIdentityCheckPhase10({ profile, status, rejectionReason, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const humanRef = useRef<any>(null);
  const referenceEmbeddingRef = useRef<number[] | null>(null);
  const referenceBlobRef = useRef<Blob | null>(null);
  const referencePathRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const [stage, setStage] = useState<Stage>('intro');
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [hint, setHint] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [failure, setFailure] = useState('');
  const [renewal, setRenewal] = useState(status === 'expired');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; stopCamera(); };
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function ensureHuman() {
    if (humanRef.current) return humanRef.current;
    setStage('loading');
    setPrompt('Preparing secure face check…');
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
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
    });
    await human.load();
    humanRef.current = human;
    return human;
  }

  async function loadExistingReference() {
    const { data, error } = await supabase.rpc('get_my_worker_identity_reference');
    if (error) throw error;
    const ref = (data || {}) as IdentityReference;
    if (!ref.has_reference || !ref.photo_path) return false;
    const signed = await supabase.storage.from('worker-identity-private').createSignedUrl(ref.photo_path, 300);
    if (signed.error || !signed.data?.signedUrl) throw new Error('Your enrolled Worker face could not be loaded. Try again.');
    const canvas = await canvasFromImageUrl(signed.data.signedUrl);
    const human = humanRef.current;
    const result = await human.detect(canvas);
    if (result.face?.length !== 1 || !result.face[0]?.embedding?.length) throw new Error('Your enrolled Worker face could not be read. Contact WeHouse Support if this continues.');
    referenceEmbeddingRef.current = [...result.face[0].embedding];
    referenceBlobRef.current = null;
    referencePathRef.current = ref.photo_path;
    setRenewal(true);
    return true;
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported in this browser');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } },
    });
    stopCamera();
    streamRef.current = stream;
    setStage('checking');
    await twoFrames();
    const video = videoRef.current;
    if (!video) throw new Error('Camera view could not open');
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    await waitForVideo(video);
  }

  async function begin() {
    if (!consent) return toast.error('Confirm the privacy notice first');
    if (busy) return;
    setBusy(true); setFailure(''); setHint(''); setStepIndex(0);
    try {
      await ensureHuman();
      const hasBaseline = await loadExistingReference();
      await openCamera();
      if (!hasBaseline) await captureEnrollmentReference();
      await runChallenge();
    } catch (error: any) {
      stopCamera();
      setFailure(error?.name === 'NotAllowedError' ? 'Allow camera access to continue.' : error?.message || 'Face check could not start.');
      setStage('failed');
    } finally { setBusy(false); }
  }

  async function captureEnrollmentReference() {
    setPrompt('Center your face in the oval');
    setHint('Keep the phone steady and use good lighting.');
    const started = Date.now();
    while (!cancelledRef.current && Date.now() - started < 18000) {
      const canvas = canvasFromVideo();
      if (!canvas) { await sleep(180); continue; }
      const result = await humanRef.current.detect(canvas);
      if (result.face?.length !== 1) { setHint('Keep only your face in the frame.'); await sleep(220); continue; }
      const face = result.face[0];
      const yaw = Math.abs(Number(face.rotation?.angle?.yaw ?? 99));
      const pitch = Math.abs(Number(face.rotation?.angle?.pitch ?? 99));
      if (!face.embedding?.length || yaw > CENTER_YAW_MAX || pitch > CENTER_PITCH_MAX || Number(face.score || 0) < 0.7) {
        setHint('Face forward and move into brighter light.'); await sleep(220); continue;
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Could not prepare your private Worker selfie');
      referenceEmbeddingRef.current = [...face.embedding];
      referenceBlobRef.current = blob;
      referencePathRef.current = null;
      setRenewal(false);
      setHint('Face captured. Follow the movement prompts.');
      await sleep(450);
      return;
    }
    throw new Error('We could not get a clear centered face. Improve the lighting and try again.');
  }

  async function readSample(): Promise<Sample> {
    const human = humanRef.current; const video = videoRef.current; const reference = referenceEmbeddingRef.current;
    if (!human || !video || !reference) throw new Error('Face reference is not ready');
    const result = await human.detect(video);
    if (result.face?.length !== 1) throw new Error('Keep only your face in the frame');
    const face = result.face[0];
    if (!face.embedding?.length || !face.rotation) throw new Error('Keep your full face visible');
    return {
      similarity: Number(human.match.similarity(reference, face.embedding)),
      live: Number(face.live ?? 0),
      real: Number(face.real ?? 0),
      yaw: Number(face.rotation.angle.yaw ?? 0),
      pitch: Number(face.rotation.angle.pitch ?? 0),
    };
  }

  async function runChallenge() {
    const steps: ChallengeStep[] = ['center_start', 'side_one', 'side_two', 'center_end'];
    const poseSamples: Sample[] = [];
    const securitySamples: Sample[] = [];
    let sideSign = 0; let current = 0; let stable = 0; let lastProgress = Date.now(); const started = Date.now();
    while (!cancelledRef.current && current < steps.length) {
      if (Date.now() - started > CHECK_TIMEOUT_MS) throw new Error('The face check timed out. Try again and follow each movement slowly.');
      const step = steps[current]; setPrompt(STEP_LABELS[step]); setStepIndex(current);
      let sample: Sample;
      try { sample = await readSample(); }
      catch { stable = 0; setHint('Keep your face inside the oval.'); await sleep(220); continue; }
      if (sample.similarity < POSE_MATCH_MIN) { stable = 0; setHint('Keep the same face clearly visible.'); await sleep(220); continue; }
      const absYaw = Math.abs(sample.yaw); const absPitch = Math.abs(sample.pitch); let correct = false;
      if (step === 'center_start' || step === 'center_end') correct = absYaw <= CENTER_YAW_MAX && absPitch <= CENTER_PITCH_MAX;
      if (step === 'side_one') correct = absYaw >= TURN_YAW_MIN;
      if (step === 'side_two') correct = absYaw >= TURN_YAW_MIN && sideSign !== 0 && Math.sign(sample.yaw) === -sideSign;
      if (!correct) { stable = 0; setHint(step.includes('center') ? 'Face forward and hold still.' : 'Turn a little farther, slowly.'); await sleep(180); continue; }
      stable += 1; poseSamples.push(sample); if (step === 'center_start' || step === 'center_end') securitySamples.push(sample);
      if (stable >= STABLE_FRAMES) {
        if (step === 'side_one') sideSign = Math.sign(sample.yaw) || 1;
        current += 1; stable = 0; lastProgress = Date.now(); setStepIndex(Math.min(current, steps.length - 1)); setHint(current < steps.length ? 'Good. Next movement…' : 'Checking…'); await sleep(380);
      } else if (Date.now() - lastProgress > 8000) setHint('Move slowly and keep your whole face visible.');
      await sleep(180);
    }
    if (cancelledRef.current) return;
    if (poseSamples.length < 6 || securitySamples.length < 4) throw new Error('We could not collect enough clear face frames. Try again.');
    const faceScore = median(poseSamples.map((sample) => sample.similarity));
    const liveScore = median(securitySamples.map((sample) => sample.live));
    const realScore = median(securitySamples.map((sample) => sample.real));
    if (faceScore < FINAL_MATCH_MIN) throw new Error('Your live face did not match the enrolled Worker closely enough.');
    if (liveScore < LIVE_MIN || realScore < REAL_MIN) throw new Error('We could not confirm a live, real face. Use brighter light, remove screen glare and try again.');
    await savePassedCheck(faceScore, liveScore, realScore);
  }

  async function savePassedCheck(faceMatchScore: number, livenessScore: number, antiSpoofScore: number) {
    let path = referencePathRef.current; let uploadedNow = false;
    if (!path) {
      const photo = referenceBlobRef.current;
      if (!photo) throw new Error('Private Worker face is missing');
      path = `${profile.user_id}/identity-enrollment-${Date.now()}.jpg`;
      const upload = await supabase.storage.from('worker-identity-private').upload(path, photo, { contentType: 'image/jpeg', upsert: false });
      if (upload.error) throw upload.error;
      uploadedNow = true;
    }
    const { error } = await supabase.rpc('complete_my_worker_identity_check', {
      p_photo_path: path,
      p_face_match_score: faceMatchScore,
      p_liveness_score: livenessScore,
      p_anti_spoof_score: antiSpoofScore,
      p_challenge_result: { center_start: true, side_one: true, side_two: true, center_end: true, automatic: true, recorded_video: false, renewal, original_face_reference: renewal },
      p_consent: true,
    });
    if (error) { if (uploadedNow) await supabase.storage.from('worker-identity-private').remove([path]); throw error; }
    stopCamera(); setPrompt('Identity confirmed'); setHint('Your Worker verification is saved securely.'); setStage('success'); toast.success(renewal ? 'Identity re-check complete' : 'Private face check complete');
    await onSaved();
  }

  function retry() {
    stopCamera(); referenceEmbeddingRef.current = null; referenceBlobRef.current = null; referencePathRef.current = null;
    setFailure(''); setPrompt(''); setHint(''); setStepIndex(0); setStage('intro');
  }

  const alreadyPassed = status === 'passed';
  if (alreadyPassed) return <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.04] p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/12 text-lg text-emerald-300">✓</span><div><p className="text-xs font-semibold text-emerald-300">Worker identity confirmed</p><p className="mt-1 text-[9px] leading-relaxed text-[#747B8B]">The live check passed. No liveness video was stored.</p></div></div></section>;

  return <section className="overflow-hidden rounded-3xl border border-white/[.07] bg-[#0F131B] shadow-2xl shadow-black/20">
    <div className="border-b border-white/[.055] p-4 sm:p-5"><div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-violet-300"><FaceIcon /></div><div className="min-w-0 flex-1"><p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">PRIVATE IDENTITY CHECK</p><h3 className="mt-1 text-lg font-bold">{renewal ? 'Confirm it is still you' : 'Confirm your Worker identity'}</h3><p className="mt-1 text-[10px] leading-5 text-[#747C8E]">{renewal ? 'We compare this live check with your original enrolled Worker face.' : 'One guided camera session creates your private Worker face reference and verifies that you are live.'}</p></div></div></div>

    {(stage === 'checking' || stage === 'loading') && <div className="p-4 sm:p-5">
      <div className="relative mx-auto aspect-[3/4] max-h-[62dvh] w-full max-w-sm overflow-hidden rounded-[32px] bg-black">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_42%_38%_at_50%_43%,transparent_0%,transparent_66%,rgba(0,0,0,.66)_67%,rgba(0,0,0,.86)_100%)]" />
        <div className="pointer-events-none absolute left-1/2 top-[43%] h-[52%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-violet-300/80 shadow-[0_0_30px_rgba(167,139,250,.22)]" />
        <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-black/45 p-3 text-center backdrop-blur-xl"><p className="text-sm font-semibold">{prompt || 'Preparing camera…'}</p><p className="mt-1 text-[9px] text-white/65">{hint || 'Keep your full face inside the oval.'}</p></div>
      </div>
      <div className="mx-auto mt-4 flex max-w-sm items-center gap-2">{[0,1,2,3].map((index) => <div key={index} className={`h-1.5 flex-1 rounded-full ${index < stepIndex ? 'bg-emerald-400' : index === stepIndex ? 'bg-violet-400' : 'bg-white/[.08]'}`} />)}</div>
      <p className="mt-2 text-center text-[8px] uppercase tracking-[.15em] text-[#616879]">{stage === 'loading' ? 'Loading secure camera check' : `Movement ${Math.min(stepIndex + 1, 4)} of 4`}</p>
    </div>}

    {stage === 'intro' && <div className="space-y-4 p-4 sm:p-5">
      {rejectionReason && <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[9px] leading-5 text-amber-100">{rejectionReason}</div>}
      <div className="grid gap-2 sm:grid-cols-3"><Info icon="◉" title="Center your face" text="Good light, one person only."/><Info icon="↔" title="Follow the turns" text="Move your head slowly when prompted."/><Info icon="⌁" title="Nothing public" text="No liveness video is posted or saved."/></div>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[.06] bg-black/10 p-3"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500"/><span className="text-[9px] leading-5 text-[#818899]">I agree to a private automated face, liveness and anti-spoof check for Worker account protection. The enrollment selfie stays private.</span></label>
      <button onClick={() => void begin()} disabled={!consent || busy} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white disabled:bg-white/[.06] disabled:text-[#62697A]">{busy ? 'Starting…' : renewal ? 'Start identity re-check' : 'Start face check'}</button>
      <p className="text-center text-[8px] leading-4 text-[#555D6D]">Use the front camera. This flow does not accept uploaded photos as a liveness substitute.</p>
    </div>}

    {stage === 'failed' && <div className="space-y-4 p-5 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-500/10 text-xl text-red-300">!</div><div><h4 className="text-base font-bold">We could not complete the check</h4><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#858C9D]">{failure}</p></div><button onClick={retry} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold">Try again</button></div>}
    {stage === 'success' && <div className="space-y-3 p-6 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/12 text-2xl text-emerald-300">✓</div><h4 className="text-lg font-bold">Identity confirmed</h4><p className="text-[10px] text-[#7B8394]">Your result is saved. WeHouse is unlocking the next verification step.</p></div>}
  </section>;
}

function canvasFromVideoElement(video: HTMLVideoElement) {
  const width = video.videoWidth || 720; const height = video.videoHeight || 720; const side = Math.min(width, height);
  const canvas = document.createElement('canvas'); canvas.width = side; canvas.height = side; const ctx = canvas.getContext('2d'); if (!ctx) return null;
  ctx.drawImage(video, Math.max(0,(width-side)/2), Math.max(0,(height-side)/2), side, side, 0, 0, side, side); return canvas;
}
function canvasFromVideo() { return null as HTMLCanvasElement | null; }

async function canvasFromImageUrl(url: string) {
  const image = new Image(); image.crossOrigin = 'anonymous'; image.src = url; await new Promise<void>((resolve,reject) => { image.onload=()=>resolve(); image.onerror=()=>reject(new Error('Private identity image could not load')); });
  const side = Math.min(image.naturalWidth || 720, image.naturalHeight || 720); const canvas = document.createElement('canvas'); canvas.width=side; canvas.height=side; const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Image could not be prepared'); ctx.drawImage(image,Math.max(0,(image.naturalWidth-side)/2),Math.max(0,(image.naturalHeight-side)/2),side,side,0,0,side,side); return canvas;
}
function median(values: number[]) { const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b); if(!sorted.length) return 0; const middle=Math.floor(sorted.length/2); return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2; }
function sleep(ms:number){return new Promise((resolve)=>setTimeout(resolve,ms));}
function twoFrames(){return new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));}
function waitForVideo(video:HTMLVideoElement){return new Promise<void>((resolve,reject)=>{if(video.readyState>=2&&video.videoWidth>0){resolve();return}const timer=window.setTimeout(()=>{cleanup();reject(new Error('Camera took too long to start'));},8000);const ready=()=>{if(video.videoWidth>0){cleanup();resolve();}};const cleanup=()=>{window.clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('canplay',ready)};video.addEventListener('loadeddata',ready);video.addEventListener('canplay',ready);});}
function Info({icon,title,text}:{icon:string;title:string;text:string}){return <div className="rounded-2xl border border-white/[.055] bg-white/[.018] p-3"><span className="text-lg text-violet-300">{icon}</span><p className="mt-2 text-[10px] font-semibold">{title}</p><p className="mt-1 text-[8px] leading-4 text-[#6C7485]">{text}</p></div>}
function FaceIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M8 21H6a3 3 0 0 1-3-3v-2M16 21h2a3 3 0 0 0 3-3v-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 15c2.2 1.6 4.8 1.6 7 0"/></svg>}
