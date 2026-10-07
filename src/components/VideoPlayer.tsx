import { useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";

type Props = {
  src: string;
  className?: string;
  containerClassName?: string;
  autoPlay?: boolean;
  paused?: boolean;
  muted?: boolean;
  durationHint?: number;
  onDuration?: (seconds: number) => void;
  onTime?: (seconds: number) => void;
  onPlaybackError?: () => void;
  controlsPositionClassName?: string;
};

export default function VideoPlayer({
  src,
  className = "aspect-video w-full bg-black object-contain",
  containerClassName = "bg-black",
  autoPlay = false,
  paused = false,
  muted = false,
  durationHint = 0,
  onDuration,
  onTime,
  onPlaybackError,
  controlsPositionClassName = "bottom-0",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const surfaceTap = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointerTapHandledUntil = useRef(0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationHint || durationFromSource(src));
  // Mobile browsers normally allow autoplay only when muted. Showcase should
  // begin reliably, then the viewer can explicitly unmute it.
  const [silent, setSilent] = useState(muted || autoPlay);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(0);
    setDuration(durationHint || durationFromSource(src));
    setFailed(false);
    setSilent(muted || autoPlay);
  }, [autoPlay, durationHint, muted, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoPlay || paused) return;
    video.muted = true;
    void video.play().catch(() => {
      // Do not call this a playback failure merely because a browser requires
      // one user gesture. The visible play control remains available.
      setPlaying(false);
    });
  }, [autoPlay, src, paused]);

  useEffect(() => {
    const video = videoRef.current;
    if (paused) video?.pause();
    const hide = () => { if (document.hidden) video?.pause(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); video?.pause(); };
  }, [paused, src]);

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play().catch(() => setFailed(true));
    } else {
      video.pause();
    }
  }

  function updateDuration(video: HTMLVideoElement) {
    const next =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : durationHint || durationFromSource(src);
    if (next > 0) {
      setDuration(next);
      onDuration?.(next);
    }
  }

  function readMetadata(video: HTMLVideoElement) {
    updateDuration(video);
    if (Number.isFinite(video.duration) && video.duration > 0) return;
    const restore = () => {
      video.removeEventListener("durationchange", restore);
      updateDuration(video);
      video.currentTime = 0;
    };
    video.addEventListener("durationchange", restore);
    try {
      video.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      video.removeEventListener("durationchange", restore);
    }
  }

  async function openFullscreen() {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) return document.exitFullscreen();
    await video.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <div className={`relative overflow-hidden rounded-[inherit] ${containerClassName}`}>
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay && !paused}
        muted={silent}
        playsInline
        preload="metadata"
        controls={false}
        onLoadedMetadata={(event) => readMetadata(event.currentTarget)}
        onDurationChange={(event) => updateDuration(event.currentTarget)}
        onCanPlay={(event) => {
          if (!autoPlay || paused) return;
          event.currentTarget.muted = true;
          void event.currentTarget.play().catch(() => undefined);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          setCurrent(event.currentTarget.currentTime);
          onTime?.(event.currentTarget.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => {
          setFailed(true);
          onPlaybackError?.();
        }}
        className={className}
      />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-[#0D1016] px-6 text-center">
          <div className="max-w-xs">
            <p className="text-xs font-semibold text-white">Video unavailable here</p>
            <p className="mt-1 text-xs leading-4 text-[#858B9A]">WeHouse could not play this video in the current viewer. Try again or open it in your device player.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => { setFailed(false); videoRef.current?.load(); }} className="min-h-10 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold text-white">Try again</button>
              <a href={src} target="_blank" rel="noreferrer" className="flex min-h-10 items-center rounded-xl border border-white/10 px-3 text-[10px] font-semibold text-white">Open video</a>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onPointerDown={event => {
            surfaceTap.current = event.isPrimary && event.button === 0
              ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
          }}
          onPointerMove={event => {
            const tap = surfaceTap.current;
            if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) surfaceTap.current = null;
          }}
          onPointerCancel={() => { surfaceTap.current = null; }}
          onPointerUp={event => {
            const tap = surfaceTap.current; surfaceTap.current = null;
            if (!tap || tap.id !== event.pointerId || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) return;
            // A valid tap should work immediately after a gallery swipe, even
            // when the browser suppresses that touch's compatibility click.
            // Captured swipes, drags and multi-touch never reach this path.
            pointerTapHandledUntil.current = Date.now() + 700;
            void toggle();
          }}
          onClick={event => {
            if (event.detail === 0 || Date.now() > pointerTapHandledUntil.current) void toggle();
          }}
          data-media-toggle
          className="group absolute inset-0 z-10 grid place-items-center bg-black/5 transition-colors hover:bg-black/10"
          aria-label={playing ? "Pause video" : "Play video"}
        >
          {!playing ? (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-black/70 text-white shadow-[0_10px_35px_rgba(0,0,0,.35)] backdrop-blur-md transition-transform duration-200 group-active:scale-95"><Play size={22} fill="currentColor" /></span>
          ) : null}
        </button>
      )}
      {!failed ? (
        <div className={`absolute inset-x-0 ${controlsPositionClassName} z-20 flex items-center gap-2 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-8`}>
          <button type="button" onClick={() => void toggle()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-sm transition active:scale-95" aria-label={playing ? "Pause video" : "Play video"}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
          <span className="w-9 shrink-0 font-mono text-xs text-white/75">{formatDuration(current)}</span>
          <input type="range" min={0} max={Math.max(duration, .1)} step=".1" value={Math.min(current, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = value; setCurrent(value); }} className="h-11 min-w-0 flex-1 accent-violet-400" aria-label="Video position" />
          <span className="w-9 shrink-0 text-right font-mono text-xs text-white/75">{formatDuration(duration)}</span>
          <button type="button" onClick={() => { const next = !silent; setSilent(next); if (videoRef.current) videoRef.current.muted = next; }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-sm" aria-label={silent ? "Unmute video" : "Mute video"}>{silent ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
          <button type="button" onClick={() => void openFullscreen()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-sm" aria-label="View video full screen"><Maximize2 size={17} /></button>
        </div>
      ) : null}
    </div>
  );
}

function durationFromSource(value: string) {
  const match = decodeURIComponent(value).match(/(?:access|video)[-_][^/?]*?[-_](\d+)s(?:\.|-|\?|$)/i);
  return match ? Number(match[1]) : 0;
}

function formatDuration(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
