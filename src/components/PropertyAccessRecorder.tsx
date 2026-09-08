import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import VideoPlayer from "@/components/VideoPlayer";

type Props = {
  code: string;
  expiresAt: string;
  recordedFile: File | null;
  onRecorded: (file: File | null) => void;
};

export const MIN_PROPERTY_ACCESS_SECONDS = 20;

export function propertyAccessDuration(file: File | null) {
  if (!file) return 0;
  const match = file.name.match(/property-access-\d+-(\d+)s\./i);
  return match ? Number(match[1]) : 0;
}

export default function PropertyAccessRecorder({
  code,
  expiresAt,
  recordedFile,
  onRecorded,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null),
    streamRef = useRef<MediaStream | null>(null),
    recorderRef = useRef<MediaRecorder | null>(null),
    chunksRef = useRef<Blob[]>([]),
    timerRef = useRef<number | null>(null),
    startedAtRef = useRef(0),
    elapsedRef = useRef(0);
  const [open, setOpen] = useState(false),
    [ready, setReady] = useState(false),
    [recording, setRecording] = useState(false),
    [finalizing, setFinalizing] = useState(false),
    [seconds, setSeconds] = useState(0),
    [recordedDuration, setRecordedDuration] = useState(0),
    [preview, setPreview] = useState("");
  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  useEffect(() => {
    if (!recordedFile) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(recordedFile);
    setPreview(url);
    const storedDuration = propertyAccessDuration(recordedFile);
    if (storedDuration) setRecordedDuration(storedDuration);
    return () => URL.revokeObjectURL(url);
  }, [recordedFile]);
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  async function launch() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      return toast.error("Live recording is not supported by this browser");
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
    } catch (error) {
      setOpen(false);
      toast.error(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Allow camera and microphone access"
          : "The live camera could not be opened",
      );
    }
  }
  function close() {
    if (recording) return toast.error("Stop the recording before closing");
    stopTracks();
    setOpen(false);
  }
  function start() {
    const stream = streamRef.current;
    if (!stream) return;
    const probe = document.createElement("video");
    const mimeType = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/webm;codecs=vp8,opus",
      "video/mp4",
      "video/webm",
    ].find(
      (type) =>
        MediaRecorder.isTypeSupported(type) && probe.canPlayType(type) !== "",
    );
    const recorder = new MediaRecorder(
      stream,
      mimeType
        ? {
            mimeType,
            videoBitsPerSecond: 2_500_000,
            audioBitsPerSecond: 96_000,
          }
        : undefined,
    );
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const actualDuration = Math.max(
        1,
        Math.round((performance.now() - startedAtRef.current) / 1000),
      );
      const type = recorder.mimeType || mimeType || "video/webm",
        extension = type.includes("mp4") ? "mp4" : "webm",
        blob = new Blob(chunksRef.current, { type });
      if (blob.size)
        onRecorded(
          new File([blob], `property-access-${Date.now()}-${actualDuration}s.${extension}`, {
            type,
          }),
        );
      stopTracks();
      setRecording(false);
      setFinalizing(false);
      setRecordedDuration(actualDuration);
      setOpen(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
    recorder.onerror = () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      setRecording(false);
      setFinalizing(false);
      stopTracks();
      toast.error("The recording could not be completed. Please try again.");
    };
    recorderRef.current = recorder;
    recorder.start(500);
    startedAtRef.current = performance.now();
    elapsedRef.current = 0;
    setSeconds(0);
    setRecording(true);
    timerRef.current = window.setInterval(
      () => {
        const elapsed = Math.min(
          120,
          Math.floor((performance.now() - startedAtRef.current) / 1000),
        );
        elapsedRef.current = elapsed;
        setSeconds(elapsed);
        if (elapsed >= 120 && recorderRef.current?.state === "recording") {
          setFinalizing(true);
          recorderRef.current.stop();
        }
      },
      250,
    );
  }
  function stop() {
    if (elapsedRef.current < MIN_PROPERTY_ACCESS_SECONDS)
      return toast.error(
        `Continue the entrance-to-interior walkthrough for at least ${MIN_PROPERTY_ACCESS_SECONDS} seconds`,
      );
    if (recorderRef.current?.state === "recording") {
      setFinalizing(true);
      recorderRef.current.stop();
    }
  }
  return (
    <section className="rounded-2xl border border-violet-500/20 bg-violet-500/[.045] p-4 md:col-span-2">
      <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
        Private property access recording *
      </p>
      <h3 className="mt-2 text-sm font-semibold">
        One continuous entrance-to-interior walkthrough
      </h3>
      <p className="mt-2 text-[10px] leading-5 text-[#858A9A]">
        Write the code on paper. Start outside, show it clearly, open the
        entrance and walk through the property without stopping. The video stays
        private for WeHouse review.
      </p>
      <div className="mt-3 rounded-2xl border border-white/[.08] bg-black/20 p-4 text-center">
        <p className="text-[8px] uppercase tracking-[.16em] text-[#6C7181]">
          One-use code
        </p>
        <p className="mt-2 text-2xl font-black tracking-[.2em]">{code}</p>
        <p className="mt-2 text-[8px] text-[#676C7C]">
          Expires {new Date(expiresAt).toLocaleString()}
        </p>
      </div>
      {!recordedFile ? (
        <button
          type="button"
          onClick={() => void launch()}
          className="mt-3 h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold"
        >
          Start guided recording
        </button>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-500/15 bg-emerald-500/[.05]">
          <VideoPlayer
            src={preview}
            durationHint={recordedDuration || propertyAccessDuration(recordedFile)}
            onDuration={setRecordedDuration}
            onPlaybackError={() => {
              toast.error("This recording cannot play on this device. Please retake it.");
            }}
          />
          <div className="flex items-center justify-between gap-3 p-3">
            <div>
              <p className="text-[10px] font-semibold text-emerald-300">
                Access walkthrough ready
              </p>
              <p className="mt-1 text-[8px] text-[#747A89]">
                {formatDuration(recordedDuration)} ·{" "}
                {(recordedFile.size / 1048576).toFixed(1)} MB · video + audio
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRecorded(null)}
              className="rounded-lg border border-white/[.08] px-3 py-2 text-[9px]"
            >
              Retake
            </button>
          </div>
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-[150] overflow-hidden bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="Guided property access recording"
        >
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/90 to-transparent px-4 pb-20 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="flex justify-between gap-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-200">
                  Private access evidence
                </p>
                <p className="mt-1 text-xs font-semibold">
                  {recording
                    ? "Keep recording as you enter"
                    : "Stand outside the entrance"}
                </p>
              </div>
              {!recording && (
                <button
                  type="button"
                  onClick={close}
                  className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-xl"
                  aria-label="Close camera"
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-3 inline-flex rounded-xl bg-black/65 px-3 py-2 text-sm">
              <span className="text-white/65">Show code&nbsp;</span>
              <strong className="tracking-[.18em]">{code}</strong>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-24 text-center">
            <p className="mx-auto max-w-sm text-[10px] leading-5 text-white/80">
              1. Show code at entrance · 2. Open and enter · 3. Walk through
              continuously
            </p>
            {recording && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                <span className="font-mono text-xs font-bold text-red-200">
                  REC {formatDuration(seconds)}
                </span>
                <span className="text-[9px] text-white/65">Camera + microphone</span>
              </div>
            )}
            <button
              type="button"
              disabled={!ready || finalizing}
              onClick={recording ? stop : start}
              aria-label={
                recording ? "Stop and use recording" : "Start recording"
              }
              className={`mx-auto mt-4 grid h-20 w-20 place-items-center rounded-full border-4 border-white disabled:opacity-40 ${recording ? "bg-white" : "bg-red-500"}`}
            >
              <span
                className={
                  recording
                    ? "h-7 w-7 rounded-md bg-red-500"
                    : "h-14 w-14 rounded-full border-2 border-black/15"
                }
              />
            </button>
            <p className="mt-3 text-[9px] text-white/60">
              {finalizing
                ? "Finishing your recording…"
                : !ready
                ? "Opening camera…"
                : recording && seconds < MIN_PROPERTY_ACCESS_SECONDS
                  ? `Record at least ${MIN_PROPERTY_ACCESS_SECONDS} seconds`
                  : "Tap once—do not pause during the walkthrough"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function formatDuration(value: number) {
  const safe = Math.max(0, Math.floor(value));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
