import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type Props = {
  code: string;
  expiresAt: string;
  recordedFile: File | null;
  onRecorded: (file: File | null) => void;
};

export default function PropertyAccessRecorder({ code, expiresAt, recordedFile, onRecorded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast.error('Live camera recording is not supported by this browser');
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      toast.error(error instanceof Error && error.name === 'NotAllowedError' ? 'Allow camera and microphone access to record at the property' : 'The live camera could not be opened');
    }
  }

  function beginRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size) onRecorded(new File([blob], `property-access-${Date.now()}.webm`, { type }));
      stopCamera();
      setRecording(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setSeconds(0);
    setRecording(true);
    timerRef.current = window.setInterval(() => setSeconds(value => {
      if (value >= 119) recorderRef.current?.stop();
      return value + 1;
    }), 1000);
  }

  function stopRecording() {
    if (seconds < 8) return toast.error('Continue from the entrance into the property before stopping');
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  return <section className="rounded-2xl border border-violet-500/20 bg-violet-500/[.045] p-4 md:col-span-2">
    <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">Private property access recording *</p>
    <h3 className="mt-2 text-sm font-semibold">Record from outside the entrance into the property</h3>
    <p className="mt-2 text-[10px] leading-5 text-[#858A9A]">Write the code below on paper and show it clearly at the start. Continue in one recording through the entrance and into the property. This recording is private and is not used as listing media.</p>
    <div className="mt-3 rounded-2xl border border-white/[.08] bg-black/20 p-4 text-center">
      <p className="text-[8px] uppercase tracking-[.16em] text-[#6C7181]">One-use code</p>
      <p className="mt-2 text-2xl font-black tracking-[.2em]">{code}</p>
      <p className="mt-2 text-[8px] text-[#676C7C]">Expires {new Date(expiresAt).toLocaleString()}</p>
    </div>
    {!recordedFile && <>
      <div className={`relative mt-3 overflow-hidden rounded-2xl bg-black ${cameraReady ? 'block' : 'hidden'}`}><video ref={videoRef} muted autoPlay playsInline className="aspect-video w-full object-cover"/>{recording && <span className="absolute left-3 top-3 rounded-full bg-red-500 px-2.5 py-1 text-[9px] font-bold">● LIVE · {seconds}s</span>}</div>
      {!cameraReady ? <button type="button" onClick={() => void openCamera()} className="mt-3 h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold">Open live camera</button> : !recording ? <button type="button" onClick={beginRecording} className="mt-3 h-12 w-full rounded-xl bg-red-500 text-xs font-semibold">Start continuous recording</button> : <button type="button" onClick={stopRecording} className="mt-3 h-12 w-full rounded-xl bg-white text-xs font-semibold text-black">Stop and use recording</button>}
    </>}
    {recordedFile && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[.05] p-3"><div><p className="text-[10px] font-semibold text-emerald-300">Live access recording ready</p><p className="mt-1 text-[8px] text-[#747A89]">{(recordedFile.size / 1024 / 1024).toFixed(1)} MB · uploaded privately when you submit</p></div><button type="button" onClick={() => onRecorded(null)} className="rounded-lg border border-white/[.08] px-3 py-2 text-[9px]">Record again</button></div>}
  </section>;
}
