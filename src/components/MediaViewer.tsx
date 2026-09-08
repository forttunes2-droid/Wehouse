import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type MediaViewerProps = {
  src: string;
  kind: 'image' | 'video';
  title?: string;
  onClose: () => void;
};

export default function MediaViewer({ src, kind, title = 'Media preview', onClose }: MediaViewerProps) {
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100200] isolate flex h-[100dvh] flex-col bg-[#050608] text-white" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[.08] px-4 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {kind === 'video' && duration > 0 ? <p className="mt-0.5 font-mono text-[9px] text-white/55">{formatDuration(currentTime)} / {formatDuration(duration)}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[.08] text-xl" aria-label="Close media preview">×</button>
      </header>
      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {!ready ? <div className="absolute h-8 w-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" role="status" aria-label="Loading media"/> : null}
        {kind === 'video'
          ? <video src={src} controls autoPlay playsInline preload="metadata" onLoadedMetadata={(event) => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); setReady(true); }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onEnded={() => setCurrentTime(0)} className={`max-h-full max-w-full object-contain transition-opacity ${ready ? 'opacity-100' : 'opacity-0'}`}/>
          : <img src={src} alt={title} decoding="async" onLoad={() => setReady(true)} className={`max-h-full max-w-full object-contain transition-opacity ${ready ? 'opacity-100' : 'opacity-0'}`}/>
        }
      </main>
      <div className="h-[env(safe-area-inset-bottom)] shrink-0 bg-black"/>
    </div>,
    document.body,
  );
}

function formatDuration(value: number) {
  const safe = Math.max(0, Math.floor(value));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
