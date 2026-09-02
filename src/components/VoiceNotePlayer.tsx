import { useRef, useState } from "react";

export default function VoiceNotePlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationFromName(url));
  const [speed, setSpeed] = useState(1);
  const toggle = () => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  const changeSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  };
  return (
    <div className="mb-1 flex min-w-[220px] items-center gap-2 rounded-2xl bg-black/15 px-2.5 py-2">
      <audio ref={ref} src={url} preload="metadata" onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setTotal(value); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setCurrent(0); }} />
      <button type="button" onClick={toggle} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-[11px]" aria-label={playing ? "Pause voice note" : "Play voice note"}>{playing ? "Ⅱ" : "▶"}</button>
      <div className="min-w-0 flex-1">
        <div className="pointer-events-none mb-1 flex h-3 items-center gap-px" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <span key={index} className="flex-1 rounded-full bg-white/25" style={{ height: `${3 + ((index * 5) % 9)}px`, opacity: index / 28 <= (total ? current / total : 0) ? 1 : .35 }} />)}</div>
        <input aria-label="Voice note position" type="range" min={0} max={Math.max(total, .1)} step=".1" value={Math.min(current, total || 0)} onChange={(event) => { const value = Number(event.target.value); if (ref.current) ref.current.currentTime = value; setCurrent(value); }} className="h-1 w-full cursor-pointer accent-white" />
        <p className="mt-1 text-[8px] text-white/70">{format(current)} / {format(total)}</p>
      </div>
      <button type="button" onClick={changeSpeed} className="rounded-lg bg-white/10 px-2 py-1.5 text-[8px] font-semibold" aria-label={`Playback speed ${speed} times`}>{speed}×</button>
    </div>
  );
}

function durationFromName(value: string) {
  const match = decodeURIComponent(value).match(/voice-\d+-(\d+)s\./i);
  return match ? Number(match[1]) : 0;
}

function format(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
