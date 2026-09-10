import { useEffect, useRef, useState } from "react";

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
  const [nearViewport, setNearViewport] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => setReady(false), [src]);
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

  if (mediaType === "image")
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        loading="lazy"
        decoding="async"
      />
    );

  return (
    <span ref={root} className="relative block h-full w-full overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,.18),transparent_48%),#111522]">
      {!ready ? (
        <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/[.035] via-violet-500/[.08] to-white/[.025]" />
      ) : null}
      {src && nearViewport ? (
        <video
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          onLoadedData={() => setReady(true)}
          className={`${className} transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/50 pl-0.5 text-sm text-white shadow-lg backdrop-blur-sm">
          ▶
        </span>
      </span>
    </span>
  );
}
