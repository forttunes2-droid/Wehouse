import { useEffect, useRef, useState } from "react";
import { ListingMediaImage, useListingMediaUrl } from "./ListingCandidateMedia";
import VideoPlayer from "./VideoPlayer";

type Props = {
  images: string[];
  videos?: string[];
  title: string;
  children?: React.ReactNode;
};

export default function PropertyMediaCarousel({
  images,
  videos = [],
  title,
  children,
}: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const fullscreenRailRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const items = [
    ...images.map((reference) => ({ reference, kind: "image" as const })),
    ...videos.map((reference) => ({ reference, kind: "video" as const })),
  ];

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const previousBodyBackground = document.body.style.background;
    const previousRootBackground = document.documentElement.style.background;
    document.body.style.overflow = "hidden";
    document.body.style.background = "#000";
    document.documentElement.style.background = "#000";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousRootBackground;
    };
  }, [fullscreen]);

  function moveTo(index: number) {
    if (!items.length) return;
    const normalized = (index + items.length) % items.length;
    railRef.current?.scrollTo({
      left: normalized * (railRef.current.clientWidth || 1),
      behavior: "smooth",
    });
    setActiveIndex(normalized);
  }

  function updateIndex() {
    const rail = railRef.current;
    if (!rail || !rail.clientWidth) return;
    setActiveIndex(
      Math.min(
        items.length - 1,
        Math.max(0, Math.round(rail.scrollLeft / rail.clientWidth)),
      ),
    );
  }

  function openFullscreen() {
    setFullscreen(true);
    window.requestAnimationFrame(() =>
      fullscreenRailRef.current?.scrollTo({
        left: activeIndex * (fullscreenRailRef.current.clientWidth || 1),
      }),
    );
  }

  function moveFullscreenTo(index: number) {
    fullscreenRailRef.current?.scrollTo({
      left: index * (fullscreenRailRef.current.clientWidth || 1),
      behavior: "smooth",
    });
    setActiveIndex(index);
  }

  return (
    <>
      <section className="relative w-full overflow-hidden bg-[#11141C]">
        <div
          ref={railRef}
          onScroll={updateIndex}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth scrollbar-hide"
          aria-label={`${title} media`}
        >
          {items.map((item, index) => (
            <button
              key={`${item.reference}-${index}`}
              type="button"
              onClick={openFullscreen}
              className="w-full min-w-full flex-none shrink-0 snap-center"
              aria-label={`View ${item.kind} ${index + 1} of ${items.length} full screen`}
            >
              {item.kind === "video" ? (
                <div className="relative aspect-[4/3] w-full bg-black sm:aspect-[16/9]">
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#141824] to-black">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10 pl-1 text-xl backdrop-blur">
                      ▶
                    </span>
                  </div>
                </div>
              ) : (
                <ListingMediaImage
                  reference={item.reference}
                  alt={`${title} · photo ${index + 1}`}
                  loading={index === 0 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                  draggable={false}
                  className="aspect-[4/3] w-full select-none object-cover sm:aspect-[16/9]"
                />
              )}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/20" />
        {children}
        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => moveTo(activeIndex - 1)}
              className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl backdrop-blur sm:grid"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => moveTo(activeIndex + 1)}
              className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl backdrop-blur sm:grid"
            >
              ›
            </button>
            <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[9px] backdrop-blur">
              {activeIndex + 1} / {items.length}
            </span>
            <div className="absolute bottom-4 right-4 flex gap-1.5">
              {items.map((item, index) => (
                <button
                  key={`${item.reference}-dot-${index}`}
                  type="button"
                  onClick={() => moveTo(index)}
                  aria-label={`Go to ${item.kind} ${index + 1}`}
                  className={`h-2 rounded-full transition-all ${index === activeIndex ? "w-5 bg-white" : "w-2 bg-white/45"}`}
                />
              ))}
            </div>
          </>
        )}
      </section>
      {fullscreen && (
        <div
          className="fixed inset-0 z-[100200] flex h-[100svh] flex-col bg-black"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} media viewer`}
        >
          <header className="flex min-h-14 shrink-0 items-center justify-between px-4 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]">
            <span className="text-xs text-white/70">
              {activeIndex + 1} of {items.length} · {items[activeIndex]?.kind}
            </span>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-xl"
              aria-label="Close media viewer"
            >
              ×
            </button>
          </header>
          <div
            ref={fullscreenRailRef}
            onScroll={(event) => {
              const rail = event.currentTarget;
              if (rail.clientWidth)
                setActiveIndex(
                  Math.min(
                    items.length - 1,
                    Math.max(0, Math.round(rail.scrollLeft / rail.clientWidth)),
                  ),
                );
            }}
            className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-black scrollbar-hide"
          >
            {items.map((item, index) => (
              <div
                key={`${item.reference}-full-${index}`}
                className="relative flex h-full w-full min-w-full flex-none shrink-0 snap-center items-center justify-center overflow-hidden bg-black"
              >
                {item.kind === "video" ? (
                  <ResolvedVideo
                    reference={item.reference}
                    active={index === activeIndex}
                  />
                ) : (
                  <ListingMediaImage
                    reference={item.reference}
                    alt={`${title} · photo ${index + 1}`}
                    className="relative block max-h-full w-full object-contain"
                  />
                )}
              </div>
            ))}
          </div>
          {items.length > 1 && (
            <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 scrollbar-hide">
              {items.map((item, index) => (
                <button
                  key={`${item.reference}-thumb-${index}`}
                  type="button"
                  onClick={() => moveFullscreenTo(index)}
                  aria-label={`Open ${item.kind} ${index + 1}`}
                  className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-xl border-2 ${index === activeIndex ? "border-violet-400" : "border-transparent opacity-60"}`}
                >
                  {item.kind === "video" ? (
                    <span className="absolute inset-0 grid place-items-center bg-[#171B24] text-xs">
                      ▶
                    </span>
                  ) : (
                    <ListingMediaImage
                      reference={item.reference}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
          {items.length === 1 ? (
            <div className="h-[env(safe-area-inset-bottom)] shrink-0" />
          ) : null}
        </div>
      )}
    </>
  );
}

function ResolvedVideo({
  reference,
  active,
}: {
  reference: string;
  active: boolean;
}) {
  const url = useListingMediaUrl(reference);
  if (!url)
    return (
      <div
        className="h-full w-full animate-pulse bg-white/[.04]"
        role="status"
        aria-label="Loading video"
      />
    );
  return (
    <div className="w-full max-w-5xl">
      <VideoPlayer
        src={url}
        autoPlay={active}
        className="max-h-[78dvh] w-full bg-black object-contain"
      />
    </div>
  );
}
