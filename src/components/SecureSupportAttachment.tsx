import { useEffect, useState } from 'react';
import { getSupportAttachmentUrl } from '@/lib/supabase/support';
import MediaViewer from '@/components/MediaViewer';

type Props = { path: string; type?: string; className?: string };

export default function SecureSupportAttachment({ path, type = '', className = '' }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const isImage = type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(path);
  const isVideo = type.startsWith('video/') || /\.(mp4|mov|webm)(\?|$)/i.test(path);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setUrl(null);
    void getSupportAttachmentUrl(path).then(({ url: nextUrl, error }) => {
      if (!alive) return;
      if (error || !nextUrl) setFailed(true);
      else setUrl(nextUrl);
    });
    return () => { alive = false; };
  }, [path]);

  if (failed) return <div className={`mb-2 rounded-lg bg-red-500/[.05] px-3 py-2 text-[9px] text-red-300 ${className}`}>Attachment unavailable</div>;
  if (!url) return <div className={`mb-2 rounded-lg bg-black/15 px-3 py-2 text-[9px] text-[#858A99] ${className}`}>Loading attachment…</div>;
  if (type.startsWith('audio/')) return <audio controls preload="metadata" src={url} className={`mb-2 max-w-full ${className}`}/>;

  if (isImage || isVideo) return <>
    <button type="button" onClick={() => setViewerOpen(true)} className={`mb-2 block overflow-hidden rounded-xl bg-black text-left ${className}`} aria-label={`View ${isVideo ? 'video' : 'image'} attachment`}>
      {isVideo
        ? <span className="grid aspect-video max-h-56 w-full place-items-center bg-[radial-gradient(circle_at_center,rgba(139,92,246,.22),transparent_42%),#090B10]"><span className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/45 text-sm text-white">▶</span></span>
        : <img src={url} alt="Support attachment" loading="lazy" decoding="async" className="max-h-56 w-full object-cover"/>}
    </button>
    {viewerOpen ? <MediaViewer src={url} kind={isVideo ? 'video' : 'image'} title="Support attachment" onClose={() => setViewerOpen(false)}/> : null}
  </>;

  return <a href={url} download className={`mb-2 block rounded-lg bg-black/20 px-3 py-2 text-[10px] underline ${className}`}>Download attachment</a>;
}
