import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import './message-attachments.css';

export default function VoiceNotePlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationFromName(url));
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(false);
  useEffect(() => {
    generation.current += 1; setPlaying(false); setCurrent(0); setTotal(durationFromName(url)); setError(false);
    return () => { generation.current += 1; };
  }, [url]);
  const toggle = async () => {
    const audio = ref.current, request = generation.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try {
      if (error) audio.load();
      setError(false); audio.playbackRate = speed;
      await audio.play();
    } catch {
      if (generation.current === request) { setPlaying(false); setError(true); }
    }
  };
  const changeSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next); if (ref.current) ref.current.playbackRate = next;
  };
  return <div className="wh-attachment-surface wh-voice-note">
    <audio ref={ref} src={url} preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) setTotal(duration); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)} onEnded={event => { event.currentTarget.currentTime = 0; setPlaying(false); setCurrent(0); }} onError={() => { setPlaying(false); setError(true); }} />
    <div className="wh-voice-controls">
      <button type="button" onClick={() => void toggle()} className="wh-voice-play" aria-label={playing ? 'Pause voice note' : error ? 'Retry voice note' : 'Play voice note'}>{playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}</button>
      <div className="wh-voice-track"><input aria-label="Voice note position" type="range" min={0} max={Math.max(total, .1)} step=".1" disabled={!total || error} value={Math.min(current, total || 0)} onChange={event => { const next = Number(event.target.value); if (ref.current && total > 0) ref.current.currentTime = next; setCurrent(next); }} /><p>{format(current)} / {format(total)}</p></div>
      <button type="button" onClick={changeSpeed} className="wh-voice-speed" aria-label={`Playback speed ${speed} times`}>{speed}×</button>
    </div>
    {error && <p role="status" className="wh-voice-error">Voice note unavailable. Tap to retry.</p>}
  </div>;
}
function durationFromName(value: string) {
  try { const match = decodeURIComponent(value).match(/voice-\d+-(\d+)s\./i); return match ? Number(match[1]) : 0; }
  catch { return 0; }
}
function format(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
