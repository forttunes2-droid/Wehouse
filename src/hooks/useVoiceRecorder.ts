import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceDraft = { file: File; url: string; duration: number };

export default function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const cancelRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const draftRef = useRef<VoiceDraft | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setLevel(0);
  }, []);

  const discard = useCallback(() => {
    if (draftRef.current) URL.revokeObjectURL(draftRef.current.url);
    draftRef.current = null;
    setDraft(null);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Voice recording is not supported by this browser");
    }
    discard();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 96_000,
    });
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const meter = () => {
      analyser.getByteFrequencyData(samples);
      setLevel(Math.min(1, samples.reduce((sum, value) => sum + value, 0) / samples.length / 92));
      animationRef.current = requestAnimationFrame(meter);
    };
    meter();
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelRef.current = false;
    startedRef.current = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const duration = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
      if (!cancelRef.current && chunksRef.current.length) {
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        const file = new File([blob], `voice-${Date.now()}-${duration}s.${extension}`, { type });
        const next = { file, url: URL.createObjectURL(blob), duration };
        draftRef.current = next;
        setDraft(next);
      }
      chunksRef.current = [];
      setRecording(false);
      setSeconds(0);
      stopTracks();
      void context.close();
    };
    recorder.start(200);
    setSeconds(0);
    setRecording(true);
  }, [discard, stopTracks]);

  const finish = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else stopTracks();
  }, [stopTracks]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(
      () => setSeconds(Math.max(0, Math.floor((Date.now() - startedRef.current) / 1000))),
      250,
    );
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    cancelRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopTracks();
    if (draftRef.current) URL.revokeObjectURL(draftRef.current.url);
  }, [stopTracks]);

  return { recording, seconds, level, draft, start, finish, cancel, discard };
}
