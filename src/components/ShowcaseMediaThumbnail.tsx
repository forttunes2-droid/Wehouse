import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

type Props = {
  src?: string;
  mediaType: "image" | "video";
  alt: string;
  className?: string;
};

export default function ShowcaseMediaThumbnail({
  src,
  mediaType,
  alt,
  className = "h-full w-full object-cover",
}: Props) {
  const [ready, setReady] = useState(false);
  const [poster, setPoster] = useState("");
  const [failed, setFailed] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => { setReady(false); setPoster(""); setFailed(false); }, [src]);
  useEffect(() => {
    if (!nearViewport || ready) return;
    const timer = window.setTimeout(() => setFailed(true), 12000);
    return () => window.clearTimeout(timer);
  }, [nearViewport, ready, src]);
  useEffect(() => {
    const node = root.current;
    if (!node || nearViewport) return;
    if (!("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nearViewport]);

  if (mediaType === "image") return src && !failed ? <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className="grid h-full w-full place-items-center bg-[#161A23] px-2 text-center text-xs text-[#A7ADBA]">Photo</span>;

  return (
    <span ref={root} className="relative block h-full w-full overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,.18),transparent_48%),#111522]">
      {!ready && !failed ? (
        <span className="absolute inset-0 motion-safe:animate-pulse bg-gradient-to-br from-white/[.035] via-violet-500/[.08] to-white/[.025]" />
      ) : null}
      {poster ? <img src={poster} alt={alt} className={className} /> : src && nearViewport ? (
        <video
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          aria-hidden="true"
          onLoadedMetadata={(event) => {
            if (event.currentTarget.duration > 0) {
              event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2);
            }
          }}
          onLoadedData={() => { setReady(true); setFailed(false); }}
          onSeeked={(event) => {
            const video = event.currentTarget;
            setReady(true); setFailed(false);
            if (!video.videoWidth || !video.videoHeight) return;
            try {
              const canvas = document.createElement("canvas");
              canvas.width = Math.min(480, video.videoWidth);
              canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
              canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
              setPoster(canvas.toDataURL("image/jpeg", 0.75));
            } catch { /* Keep the decoded video frame if the source does not permit a canvas. */ }
            video.pause();
          }}
          onError={() => setFailed(true)}
          className={`${className} transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
      {failed && !ready && <span className="absolute inset-x-1 top-2 text-center text-xs text-white/70">Video · tap to play</span>}
      <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-xs text-white" aria-hidden="true"><Play size={14} fill="currentColor" /></span>
    </span>
  );
}
