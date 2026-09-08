import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  durationHint?: number;
  onDuration?: (seconds: number) => void;
  onTime?: (seconds: number) => void;
  onPlaybackError?: () => void;
};

export default function VideoPlayer({
  src,
  className = "aspect-video w-full bg-black object-contain",
  autoPlay = false,
  muted = false,
  durationHint = 0,
  onDuration,
  onTime,
  onPlaybackError,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationHint || durationFromSource(src));
  const [silent, setSilent] = useState(muted);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(0);
    setDuration(durationHint || durationFromSource(src));
    setFailed(false);
  }, [durationHint, src]);

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) await video.play().catch(() => setFailed(true));
    else video.pause();
  }

  function updateDuration(video: HTMLVideoElement) {
    const next = Number.isFinite(video.duration) && video.duration > 0
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
    <div className="relative overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        muted={silent}
        playsInline
        preload="metadata"
        controls={false}
        onLoadedMetadata={(event) => readMetadata(event.currentTarget)}
        onDurationChange={(event) => updateDuration(event.currentTarget)}
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
          <div>
            <p className="text-xs font-semibold text-white">Video cannot play on this device</p>
            <p className="mt-1 text-[9px] leading-4 text-[#858B9A]">Record or upload MP4 (H.264) or WebM (VP8), then try again.</p>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void toggle()} className="absolute inset-0 grid place-items-center" aria-label={playing ? "Pause video" : "Play video"}>
          {!playing && <span className="grid h-14 w-14 place-items-center rounded-full bg-black/65 text-lg text-white backdrop-blur">▶</span>}
        </button>
      )}
      {!failed && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-8">
          <button type="button" onClick={() => void toggle()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[10px]" aria-label={playing ? "Pause video" : "Play video"}>{playing ? "Ⅱ" : "▶"}</button>
          <span className="w-9 shrink-0 font-mono text-[8px] text-white/75">{formatDuration(current)}</span>
          <input type="range" min={0} max={Math.max(duration, .1)} step=".1" value={Math.min(current, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = value; setCurrent(value); }} className="h-1 min-w-0 flex-1 accent-violet-400" aria-label="Video position" />
          <span className="w-9 shrink-0 text-right font-mono text-[8px] text-white/75">{formatDuration(duration)}</span>
          <button type="button" onClick={() => { const next = !silent; setSilent(next); if (videoRef.current) videoRef.current.muted = next; }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[10px]" aria-label={silent ? "Unmute video" : "Mute video"}>{silent ? "⌁" : "◖"}</button>
          <button type="button" onClick={() => void openFullscreen()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[10px]" aria-label="View video full screen">⛶</button>
        </div>
      )}
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
