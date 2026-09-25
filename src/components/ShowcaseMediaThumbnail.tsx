import { useEffect, useRef, useState } from 'react';
import { ImageOff, Play } from 'lucide-react';
type Props = { src?: string; mediaType: 'image' | 'video'; alt: string; className?: string };

export default function ShowcaseMediaThumbnail(props: Props) {
  // A reused tile must never display the previous worker/property's poster.
  return <Thumbnail key={`${props.mediaType}:${props.src || ''}`} {...props} />;
}
function Thumbnail({ src, mediaType, alt, className = 'h-full w-full object-cover' }: Props) {
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(!src), [poster, setPoster] = useState('');
  const [nearViewport, setNearViewport] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node || nearViewport) return;
    if (!('IntersectionObserver' in window)) { setNearViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNearViewport(true); observer.disconnect(); } }, { rootMargin: '240px' });
    observer.observe(node); return () => observer.disconnect();
  }, [nearViewport]);
  useEffect(() => {
    if (!src || !nearViewport || ready) return;
    const timer = window.setTimeout(() => setFailed(true), 12000);
    return () => window.clearTimeout(timer);
  }, [src, nearViewport, ready]);
  const loaded = () => { setReady(true); setFailed(false); };
  return <span ref={root} data-media-thumbnail data-media-state={failed && !ready ? 'unavailable' : ready ? 'ready' : 'loading'} className="relative block h-full w-full overflow-hidden bg-[#161A23]">
    {!ready && !failed && <span aria-hidden="true" className="absolute inset-0 bg-white/[.04] motion-safe:animate-pulse" />}
    {src && mediaType === 'image' && <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={loaded} onError={() => setFailed(true)} className={`${className} ${ready ? '' : 'opacity-0'}`} />}
    {mediaType === 'video' && (poster ? <img src={poster} alt={alt} className={className} onError={() => { setPoster(''); setFailed(true); setReady(false); }} /> : src && nearViewport ? <video src={src} muted playsInline preload="metadata" crossOrigin="anonymous" aria-hidden="true" className={`${className} ${ready ? '' : 'opacity-0'}`}
      onLoadedMetadata={event => { const video = event.currentTarget; if (video.duration > 0) video.currentTime = Math.min(.1, video.duration / 2); }}
      onLoadedData={event => { if (event.currentTarget.videoWidth > 0) loaded(); }}
      onSeeked={event => {
        const video = event.currentTarget; if (!video.videoWidth || !video.videoHeight) return;
        loaded(); video.pause();
        try { const canvas = document.createElement('canvas'); canvas.width = Math.min(480, video.videoWidth); canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth)); const context = canvas.getContext('2d'); if (context) { context.drawImage(video, 0, 0, canvas.width, canvas.height); setPoster(canvas.toDataURL('image/jpeg', .75)); } } catch { /* Keep the decoded frame when canvas access is unavailable. */ }
      }} onError={() => setFailed(true)} /> : null)}
    {failed && !ready && <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-xs leading-4 text-[#A7ADBA]">{mediaType === 'image' ? <ImageOff size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}<span>{mediaType === 'image' ? 'Photo unavailable' : src ? 'Preview unavailable · open video' : 'Video unavailable'}</span></span>}
    {mediaType === 'video' && ready && <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white"><Play size={14} fill="currentColor" /></span>}
  </span>;
}
