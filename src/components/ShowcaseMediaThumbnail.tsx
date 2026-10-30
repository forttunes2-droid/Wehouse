import { useEffect, useRef, useState } from 'react';
import { ImageOff, Play } from 'lucide-react';
type Props = { src?: string; mediaType: 'image' | 'video'; alt: string; className?: string };

export default function ShowcaseMediaThumbnail(props: Props) {
  // A reused tile must never display the previous worker/property's poster.
  return <Thumbnail key={`${props.mediaType}:${props.src || ''}`} {...props} />;
}
function Thumbnail({ src, mediaType, alt, className = 'h-full w-full object-cover' }: Props) {
  // Opening the post owns the video request. Extracting frames while scrolling
  // can download megabytes per tile, even with preload="metadata".
  if (mediaType === 'video') return <span data-media-thumbnail data-media-state="ready" className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden bg-[var(--wh-elevated)] px-4 text-[var(--wh-text-secondary)]"><span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"><Play size={24} /></span><span className="text-center text-xs font-medium">Open video</span></span>;
  return <PhotoThumbnail src={src} alt={alt} className={className} />;
}
function PhotoThumbnail({ src, alt, className }: Omit<Props, 'mediaType'>) {
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
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
    // Showcase rows arrive before Storage has returned their signed URLs.
    // An absent URL is still loading, not a broken video.
    if (!nearViewport || !src || ready) return;
    const timer = window.setTimeout(() => setFailed(true), 12000);
    return () => window.clearTimeout(timer);
  }, [src, nearViewport, ready]);
  const loaded = () => { setReady(true); setFailed(false); };
  return <span ref={root} data-media-thumbnail data-media-state={failed && !ready ? 'unavailable' : ready ? 'ready' : 'loading'} className="relative block h-full w-full overflow-hidden bg-[var(--wh-elevated)]">
    {!ready && !failed && <span aria-hidden="true" className="absolute inset-0 bg-[var(--wh-interactive)] motion-safe:animate-pulse" />}
    {src && <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={loaded} onError={() => setFailed(true)} className={`${className} ${ready ? '' : 'opacity-0'}`} />}
    {failed && !ready && <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-xs leading-4 text-[var(--wh-text-secondary)]"><ImageOff size={20} aria-hidden="true" /><span>Photo unavailable</span></span>}
  </span>;
}
