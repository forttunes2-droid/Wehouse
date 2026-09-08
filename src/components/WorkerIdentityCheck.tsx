import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  status?: string | null;
  rejectionReason?: string | null;
  onSaved: () => Promise<void> | void;
};

type Stage = 'intro' | 'loading' | 'checking' | 'failed';
type ChallengeStep = 'center_start' | 'side_one' | 'side_two' | 'center_end';
type FaceSample = { similarity: number; live: number; real: number; yaw: number };

const HUMAN_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';
const HUMAN_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/';
const MATCH_MIN = 0.55;
const LIVE_MIN = 0.5;
const REAL_MIN = 0.5;
const CENTER_YAW_MAX = 0.18;
const TURN_YAW_MIN = 0.3;
const STABLE_FRAMES = 2;
const CHECK_TIMEOUT_MS = 30000;

const STEP_LABELS: Record<ChallengeStep, string> = {
  center_start: 'Look straight',
  side_one: 'Turn your head to one side',
  side_two: 'Turn to the other side',
  center_end: 'Look straight again',
};

export default function WorkerIdentityCheck({ profile, status, rejectionReason, onSaved }: Props) {
  const identityLabel=profile.role==='property_partner'?'Property Partner':'Worker';
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const humanRef = useRef<any>(null);
  const referenceEmbeddingRef = useRef<number[] | null>(null);
  const referencePhotoRef = useRef<Blob | null>(null);
  const referencePathRef = useRef('');
  const renewalRef = useRef(false);
  const cancelledRef = useRef(false);
  const attemptRef = useRef(0);

  const [stage, setStage] = useState<Stage>('intro');
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [failure, setFailure] = useState('');
  const [guidance, setGuidance] = useState('Keep your face inside the guide');
  const [busy, setBusy] = useState(false);

  const passed = status === 'passed';

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
  }, []);

  async function ensureHuman() {
    if (humanRef.current) return humanRef.current;
    setStage('loading');
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
      throw new Error(error?.message || 'Face check could not start');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function openFrontCamera(nextStage: Stage) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported in this browser');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
    });
    stopCamera();
    streamRef.current = stream;
    setStage(nextStage);
    await twoFrames();
    const video = videoRef.current;
    if (!video) throw new Error('Camera view could not open');
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    await waitForVideo(video);
    return video;
  }

  async function loadStoredReference() {
    if (!consent) return toast.error('Confirm the privacy notice first');
    setBusy(true);
    setStage('loading');
    try {
      await ensureHuman();
      const { data, error } = await supabase.rpc('get_my_account_identity_reference');
      if (error) throw error;
      const reference = data as { has_reference?: boolean; anchor_photo_path?: string } | null;
      if (!reference?.has_reference || !reference.anchor_photo_path) throw new Error('Your original private selfie could not be found');
      const signed = await supabase.storage.from('worker-identity-private').createSignedUrl(reference.anchor_photo_path, 90);
      if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('Private selfie could not be opened');
      const response = await fetch(signed.data.signedUrl);
      if (!response.ok) throw new Error('Private selfie could not be opened');
      const blob = await response.blob();
      const canvas = await canvasFromImageFile(new File([blob], 'identity-reference.jpg', { type: blob.type || 'image/jpeg' }));
      await acceptReferenceSelfie(canvas);
      referencePathRef.current = reference.anchor_photo_path;
      renewalRef.current = true;
      await openFrontCamera('checking');
      setStepIndex(0);
      const attempt = ++attemptRef.current;
      await runAutomaticCheck(attempt);
    } catch (error: any) {
      setStage('intro');
      toast.error(error?.message || 'Stored identity reference could not be used');
    } finally {
      setBusy(false);
    }
  }

  function canvasFromVideo() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 720;
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sx = Math.max(0, (width - side) / 2);
    const sy = Math.max(0, (height - side) / 2);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);
    return canvas;
  }

  async function acceptReferenceSelfie(canvas: HTMLCanvasElement) {
    const human = humanRef.current;
    if (!human) throw new Error('Face-check engine is not ready');
    const result = await human.detect(canvas);
    if (result.face?.length !== 1) throw new Error('Use a photo with one clear face only');
    const face = result.face[0];
    if (!face.embedding?.length) throw new Error('Your face is not clear enough. Try another photo');
    const yaw = Math.abs(Number(face.rotation?.angle?.yaw ?? 99));
    const pitch = Math.abs(Number(face.rotation?.angle?.pitch ?? 99));
    if (yaw > CENTER_YAW_MAX || pitch > 0.24) throw new Error('Use a front-facing selfie looking at the camera');
    if (Number(face.score || 0) < 0.7 || Number(face.faceScore || 0) < 0.7) throw new Error('Use a brighter, clearer selfie');

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Could not prepare the selfie');

    referencePhotoRef.current = blob;
    referenceEmbeddingRef.current = [...face.embedding];
    setFailure('');
    setPrompt('');
  }

  async function startEnrollmentCheck() {
    if (!consent) return toast.error('Confirm the privacy notice first');
    setBusy(true);
    setFailure('');
    try {
      await ensureHuman();
      await openFrontCamera('checking');
      setPrompt('Centre your face');
      speakPrompt('Centre your face and look straight at the camera');
      const started = Date.now();
      while (!cancelledRef.current && !referenceEmbeddingRef.current) {
        if (Date.now() - started > 15000)
          throw new Error('Keep your face centred in clear light');
        const canvas = canvasFromVideo();
        if (canvas) {
          try {
            await acceptReferenceSelfie(canvas);
          } catch {
            await sleep(250);
            continue;
          }
        }
      }
      setStepIndex(0);
      const attempt = ++attemptRef.current;
      await runAutomaticCheck(attempt);
    } catch (error: any) {
      stopCamera();
      setFailure(identityFailureMessage(error));
      setStage('failed');
    } finally {
      setBusy(false);
    }
  }

  async function startLiveCheck() {
    if (!referencePhotoRef.current || !referenceEmbeddingRef.current) return toast.error('Choose your private selfie first');
    setBusy(true);
    setFailure('');
    try {
      await ensureHuman();
      await openFrontCamera('checking');
      setStepIndex(0);
      const attempt = ++attemptRef.current;
      await runAutomaticCheck(attempt);
    } catch (error: any) {
      stopCamera();
      setFailure(error?.name === 'NotAllowedError' ? 'Allow camera access to complete the live check.' : error?.message || 'Live face check could not start');
      setStage('failed');
    } finally {
      setBusy(false);
    }
  }

  async function readLiveSample(): Promise<FaceSample> {
    const human = humanRef.current;
    const video = videoRef.current;
    const reference = referenceEmbeddingRef.current;
    if (!human || !video || !reference) throw new Error('Reference selfie is missing');
    const result = await human.detect(video);
    if (result.face?.length !== 1) throw new Error('Keep only your face in the frame');
    const face = result.face[0];
    if (!face.embedding?.length || !face.rotation) throw new Error('Keep your full face visible');
    const similarity = Number(human.match.similarity(reference, face.embedding));
    const live = Number(face.live ?? 0);
    const real = Number(face.real ?? 0);
    const yaw = Number(face.rotation.angle.yaw ?? 0);
    if (similarity < MATCH_MIN) throw new Error('This face does not match your private selfie');
    if (live < LIVE_MIN || real < REAL_MIN) throw new Error('We could not confirm a live face');
    return { similarity, live, real, yaw };
  }

  async function runAutomaticCheck(attempt: number) {
    const steps: ChallengeStep[] = ['center_start', 'side_one', 'side_two', 'center_end'];
    const samples: FaceSample[] = [];
    let sideSign = 0;
    let stable = 0;
    let current = 0;
    let announced = '';
    const started = Date.now();

    try {
      while (!cancelledRef.current && attempt === attemptRef.current && current < steps.length) {
        if (Date.now() - started > CHECK_TIMEOUT_MS) throw new Error('The live check timed out. Try again and follow each movement slowly');
        const step = steps[current];
        setPrompt(STEP_LABELS[step]);
        if (announced !== step) {
          speakPrompt(STEP_LABELS[step]);
          announced = step;
        }
        setStepIndex(current);
        let sample: FaceSample;
        try {
          sample = await readLiveSample();
        } catch (error) {
          stable = 0;
          setGuidance(liveGuidance(error));
          await sleep(250);
          continue;
        }

        const absYaw = Math.abs(sample.yaw);
        let correct = false;
        if (step === 'center_start' || step === 'center_end') correct = absYaw <= CENTER_YAW_MAX;
        if (step === 'side_one') correct = absYaw >= TURN_YAW_MIN;
        if (step === 'side_two') correct = absYaw >= TURN_YAW_MIN && sideSign !== 0 && Math.sign(sample.yaw) === -sideSign;

        if (correct) {
          setGuidance('Hold still — capturing');
          stable += 1;
          samples.push(sample);
          if (stable >= STABLE_FRAMES) {
            if (step === 'side_one') sideSign = Math.sign(sample.yaw) || 1;
            current += 1;
            stable = 0;
            await sleep(280);
          }
        } else {
          stable = 0;
          setGuidance(STEP_LABELS[step]);
        }
        await sleep(210);
      }

      if (cancelledRef.current || attempt !== attemptRef.current) return;
      if (!samples.length) throw new Error('Live face check could not complete');
      const minimum = (key: 'similarity' | 'live' | 'real') => Math.min(...samples.map((sample) => sample[key]));
      await savePassedCheck(minimum('similarity'), minimum('live'), minimum('real'));
    } catch (error: any) {
      stopCamera();
      setFailure(identityFailureMessage(error));
      setPrompt('');
      setStage('failed');
    }
  }

  function cancelLiveCheck() {
    attemptRef.current += 1;
    stopCamera();
    window.speechSynthesis?.cancel();
    setPrompt('');
    setGuidance('Keep your face inside the guide');
    setStage('intro');
    setBusy(false);
  }

  async function savePassedCheck(faceMatchScore: number, livenessScore: number, antiSpoofScore: number) {
    const photo = referencePhotoRef.current;
    if (!photo) throw new Error('Private selfie is missing');

    const path = renewalRef.current ? referencePathRef.current : `${profile.user_id}/identity-selfie-${Date.now()}.jpg`;
    if (!path) throw new Error('Private identity reference is missing');
    if (!renewalRef.current) {
      const upload = await supabase.storage.from('worker-identity-private').upload(path, photo, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (upload.error) throw upload.error;
    }

    const challengeResult = {
      center_start: true,
      side_one: true,
      side_two: true,
      center_end: true,
      automatic: true,
      recorded_video: false,
      anchor_similarity: faceMatchScore,
      recent_similarity: faceMatchScore,
    };

    const { error } = await supabase.rpc('complete_my_account_identity_check', {
      p_photo_path: path,
      p_face_match_score: faceMatchScore,
      p_liveness_score: livenessScore,
      p_anti_spoof_score: antiSpoofScore,
      p_challenge_result: challengeResult,
      p_consent: true,
    });

    if (error) {
      if (!renewalRef.current) await supabase.storage.from('worker-identity-private').remove([path]);
      throw error;
    }

    stopCamera();
    toast.success('Private face check complete');
    await onSaved();
  }

  if (passed) {
    return (
      <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.04] p-4">
        <p className="text-xs font-semibold text-emerald-300">Private face check complete</p>
        <p className="mt-1 text-[9px] leading-relaxed text-[#747B8B]">Your reference selfie is stored privately with your {identityLabel} identity. The live camera check was not recorded or saved as a video.</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden border-y border-white/[.07] bg-[#10141D]">
      <div className="border-b border-white/[.05] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">PRIVATE FACE CHECK</p>
            <h3 className="mt-1 text-lg font-bold">Confirm your {identityLabel} identity</h3>
          </div>
          <span className="shrink-0 rounded-full border border-white/[.07] bg-white/[.03] px-2 py-1 text-[8px] font-semibold text-[#858B99]">PRIVATE</span>
        </div>
        {rejectionReason && <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.05] p-3 text-[9px] text-red-200">{rejectionReason}</div>}
      </div>

      {(stage === 'intro' || stage === 'loading') && (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="border-b border-white/[.06] pb-4">
            <p className="text-xs font-semibold text-white">One guided live check</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#858C9B]">{status === 'due' ? 'WeHouse securely reuses your original private reference, then checks your live face and movements.' : <>The camera captures the private reference from the live session, then asks you to turn naturally. There is no separate selfie upload and no liveness video is saved.</>}</p>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-white/[.07] bg-black/10 p-3">
            <input type="checkbox" checked={consent} disabled={stage === 'loading'} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
            <span className="text-[9px] leading-relaxed text-[#808796]">I understand that my reference selfie is stored privately for {identityLabel} identity checks. The live camera check is analyzed in real time and is not recorded as a video.</span>
          </label>

          {status === 'due' ? <button onClick={() => void loadStoredReference()} disabled={!consent || busy || stage === 'loading'} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">{stage === 'loading' && busy ? 'Opening securely…' : 'Start live face check'}</button> : <button onClick={() => void startEnrollmentCheck()} disabled={!consent || busy || stage === 'loading'} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">{stage === 'loading' && busy ? 'Preparing live check…' : 'Start live face check'}</button>}
        </div>
      )}

      {stage === 'checking' && createPortal(
        <LiveCheckOverlay videoRef={videoRef} prompt={prompt || 'Look straight'} guidance={guidance} stepIndex={stepIndex} onCancel={cancelLiveCheck} />,
        document.body,
      )}

      {stage === 'failed' && (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/[.05] p-4">
            <p className="text-xs font-semibold text-red-200">We couldn’t complete the live check</p>
            <p className="mt-1 text-[9px] leading-relaxed text-red-100/70">{failure}</p>
          </div>
          <button onClick={() => void (referenceEmbeddingRef.current ? startLiveCheck() : renewalRef.current ? loadStoredReference() : startEnrollmentCheck())} disabled={busy} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">Try live check again</button>
        </div>
      )}
    </section>
  );
}

function LiveCheckOverlay({ videoRef, prompt, guidance, stepIndex, onCancel }: { videoRef: React.RefObject<HTMLVideoElement | null>; prompt: string; guidance: string; stepIndex: number; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[100060] h-[100dvh] overflow-hidden bg-black text-white">
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full scale-x-[-1] object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-transparent to-black/90" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-200">WeHouse identity</p><p className="mt-1 text-xs text-white/75">Live face check</p></div>
        <button type="button" onClick={onCancel} className="grid h-11 w-11 place-items-center rounded-full bg-black/35 text-xl backdrop-blur" aria-label="Exit live face check">×</button>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-[46%] aspect-[.76] h-[48dvh] max-h-[490px] min-h-[330px] -translate-x-1/2 -translate-y-1/2 rounded-[48%] border-2 border-white/75 shadow-[0_0_0_999px_rgba(0,0,0,.22)]" />
      <div className="absolute inset-x-0 bottom-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12 text-center">
        <p className="text-2xl font-bold tracking-tight">{prompt}</p>
        <p className="mt-2 text-[11px] text-white/70">{guidance}</p>
        <div className="mx-auto mt-5 flex max-w-sm items-center gap-2" aria-label={`Live check step ${stepIndex + 1} of 4`}>
          {[0, 1, 2, 3].map((index) => <span key={index} className={`h-1.5 flex-1 rounded-full transition-colors ${index < stepIndex ? 'bg-emerald-400' : index === stepIndex ? 'bg-white' : 'bg-white/20'}`} />)}
        </div>
        <p className="mt-4 text-[8px] text-white/45">Analyzed live. No liveness video is saved.</p>
      </div>
    </div>
  );
}

function liveGuidance(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/only your face|full face/i.test(message)) return 'Move into the guide and keep only your face visible';
  if (/does not match/i.test(message)) return 'Keep the same person in front of the camera';
  if (/live face/i.test(message)) return 'Use brighter light and keep the camera steady';
  return 'Keep your face clear and follow the instruction slowly';
}

function identityFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || '');
  if (/permission denied|row-level security|violates.*policy|function .*conversation/i.test(message)) return 'We could not securely save this check. Please try again. If it continues, message WeHouse from Inbox.';
  if (/network|fetch|load failed/i.test(message)) return 'The connection was interrupted. Check your connection and try again.';
  return message || 'Live face check failed. Try again.';
}

function speakPrompt(message: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(message);
  speech.rate = 0.92;
  speech.pitch = 1;
  window.speechSynthesis.speak(speech);
}

async function canvasFromImageFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not read that image'));
      image.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side < 320) throw new Error('Use a clearer selfie with a larger face');
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(side, 1024);
    canvas.height = Math.min(side, 1024);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare that selfie');
    const sx = Math.max(0, (image.naturalWidth - side) / 2);
    const sy = Math.max(0, (image.naturalHeight - side) / 2);
    ctx.drawImage(image, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function waitForVideo(video: HTMLVideoElement) {
  for (let i = 0; i < 30; i += 1) {
    if (video.readyState >= 2 && video.videoWidth > 0) return;
    await sleep(100);
  }
  throw new Error('Camera is taking too long to start');
}

function twoFrames() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
