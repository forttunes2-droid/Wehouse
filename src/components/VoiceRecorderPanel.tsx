import type { VoiceDraft } from "@/hooks/useVoiceRecorder";
import { useRef, useState } from "react";

type Props = {
  recording: boolean;
  seconds: number;
  level: number;
  draft: VoiceDraft | null;
  onCancel: () => void;
  onFinish: () => void;
  onDiscard: () => void;
  onUse: (file: File) => void;
};

export default function VoiceRecorderPanel({ recording, seconds, level, draft, onCancel, onFinish, onDiscard, onUse }: Props) {
  if (!recording && !draft) return null;
  return (
    <div className="mb-2 rounded-2xl border border-white/[.07] bg-[#171A23] p-3">
      {recording ? (
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" />
          <span className="w-10 font-mono text-[10px] text-red-200">{formatDuration(seconds)}</span>
          <div className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1" aria-label="Recording level">
            {Array.from({ length: 18 }, (_, index) => {
              const active = level * 18 > index;
              return <span key={index} className={`w-1 rounded-full transition-all ${active ? "bg-violet-400" : "bg-white/10"}`} style={{ height: `${8 + ((index * 7) % 18)}px` }} />;
            })}
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg px-2 py-2 text-[9px] font-semibold text-[#A7ACBA]">Cancel</button>
          <button type="button" onClick={onFinish} className="rounded-lg bg-white px-3 py-2 text-[9px] font-semibold text-black">Finish</button>
        </div>
      ) : draft ? (
        <div className="flex items-center gap-3">
          <DraftPlayback draft={draft} />
          <button type="button" onClick={onDiscard} className="rounded-lg px-2 py-2 text-[9px] font-semibold text-[#A7ACBA]">Delete</button>
          <button type="button" onClick={() => onUse(draft.file)} className="rounded-lg bg-violet-500 px-3 py-2 text-[9px] font-semibold">Use voice note</button>
        </div>
      ) : null}
    </div>
  );
}

function DraftPlayback({ draft }: { draft: VoiceDraft }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const toggle = () => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <audio ref={ref} src={draft.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setCurrent(0); }} />
      <button type="button" onClick={toggle} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[10px]" aria-label={playing ? "Pause voice preview" : "Play voice preview"}>{playing ? "Ⅱ" : "▶"}</button>
      <input type="range" aria-label="Voice preview position" min={0} max={Math.max(draft.duration, 0.1)} step="0.1" value={Math.min(current, draft.duration)} onChange={(event) => { const value = Number(event.target.value); if (ref.current) ref.current.currentTime = value; setCurrent(value); }} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-violet-400" />
      <span className="w-8 text-right font-mono text-[8px] text-[#858A9A]">{formatDuration(current)}</span>
    </div>
  );
}

function formatDuration(value: number) {
  const safe = Math.max(0, Math.floor(value));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
