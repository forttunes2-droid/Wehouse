import { useEffect, useState } from "react";
import { isTopDialog } from "@/lib/dialogIsolation";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useVisualViewportFrame } from "@/hooks/useVisualViewportFrame";
import MediaPagingActions from "@/components/MediaPagingActions";
import { useMediaSwipe } from "@/hooks/useMediaSwipe";
import ZoomablePhoto from "@/components/ZoomablePhoto";
import { createPortal } from "react-dom";
import VideoPlayer from "@/components/VideoPlayer";

type MediaKind = "image" | "video";
type MediaViewerItem = { url: string; kind: MediaKind };

type MediaViewerSharedProps = {
  title?: string;
  subtitle?: string;
  avatarUrl?: string | null;
  onClose: () => void;
  variant?: "photo" | "gallery";
};

type MediaViewerProps = MediaViewerSharedProps &
  (
    | {
        src: string;
        kind: MediaKind;
        items?: never;
        initialIndex?: never;
      }
    | {
        items: MediaViewerItem[];
        initialIndex?: number;
        src?: never;
        kind?: never;
      }
  );

export default function MediaViewer(props: MediaViewerProps) {
  const dismiss = useRecordScreenBack(props.onClose);
  const dialogRoot = useDialogInteraction(dismiss);
  useVisualViewportFrame(dialogRoot);
  const {
    title = "Media preview",
    subtitle,
    avatarUrl,
    variant = "gallery",
  } = props;
  const items: MediaViewerItem[] =
    props.items !== undefined
      ? props.items
      : [{ url: props.src, kind: props.kind }];
  const requestedIndex =
    props.items !== undefined ? props.initialIndex ?? 0 : 0;
  const maxIndex = Math.max(0, items.length - 1);
  const [index, setIndex] = useState(
    Math.min(Math.max(requestedIndex, 0), maxIndex),
  );
  const current = items[index] || items[0] || { url: "", kind: "image" as const };
  const src = current.url;
  const kind = current.kind;
  const previous = index > 0 ? () => setIndex(value => Math.max(0, value - 1)) : undefined;
  const next = index < maxIndex ? () => setIndex(value => Math.min(maxIndex, value + 1)) : undefined;
  const paging = useMediaSwipe({ identity: `${index}:${src}`, onPrevious: previous, onNext: next });
  const [ready, setReady] = useState(kind === "video");
  const [failed, setFailed] = useState(!src);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setIndex(Math.min(Math.max(requestedIndex, 0), maxIndex));
  }, [requestedIndex, maxIndex]);

  useEffect(() => {
    setReady(kind === "video");
    setFailed(!src);
    setCurrentTime(0);
    setDuration(0);
  }, [kind, src]);

  return createPortal(
    <div
      ref={dialogRoot}
      tabIndex={-1}
      data-media-index={index}
      data-media-count={items.length}
      data-media-variant={variant}
      className="fixed inset-0 z-[100200] isolate flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-black text-white outline-none"
      onKeyDown={event => {
        if (event.defaultPrevented || !dialogRoot.current || !isTopDialog(dialogRoot.current) || (event.target as HTMLElement).closest("button,input,select,textarea")) return;
        if (event.key === "Escape") { event.preventDefault(); dismiss(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
        if (event.key === "ArrowRight") { event.preventDefault(); setIndex(value => Math.min(maxIndex, value + 1)); }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-3 top-[max(.75rem,env(safe-area-inset-top))] z-20 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-black/45 text-2xl leading-none text-white shadow-lg backdrop-blur-md transition active:scale-95"
        aria-label="Close media viewer"
      >
        <span aria-hidden="true">×</span>
      </button>

      {variant === "gallery" ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 pb-8 pt-[max(.75rem,env(safe-area-inset-top))]">
          <div className="pr-14">
            <div className="flex min-w-0 items-center gap-2.5">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{title}</p>
                {subtitle ? (
                  <p className="mt-0.5 truncate text-xs text-white/60">{subtitle}</p>
                ) : kind === "video" && duration > 0 ? (
                  <p className="mt-0.5 font-mono text-xs text-white/60">{formatDuration(currentTime)} / {formatDuration(duration)}</p>
                ) : items.length > 1 ? (
                  <p className="mt-0.5 text-xs text-white/60">{index + 1} / {items.length}</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <main {...paging} data-media-stage className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden bg-black" style={{ touchAction: "pan-y pinch-zoom" }}>
        {!ready && !failed ? (
          <div
            className="absolute h-8 w-8 animate-spin rounded-full border-2 border-violet-400 border-t-transparent"
            role="status"
            aria-label="Loading media"
          />
        ) : null}
        {failed ? (
          <div className="px-6 text-center">
            <p className="text-sm font-semibold">This media could not be loaded</p>
            <p className="mt-2 text-sm text-white/55">Close the viewer and try again.</p>
          </div>
        ) : kind === "video" ? (
          <VideoPlayer
            key={String(index) + ":" + src}
            src={src}
            autoPlay
            onTime={setCurrentTime}
            onDuration={(value) => {
              setDuration(value);
              setReady(true);
            }}
            onPlaybackError={() => setFailed(true)}
            containerClassName="h-full w-full bg-black"
            className="h-full w-full object-contain"
          />
        ) : (
          <ZoomablePhoto
            key={String(index) + ":" + src}
            src={src}
            title={title}
            onReady={() => setReady(true)}
            onError={() => setFailed(true)}
            onPrevious={previous}
            onNext={next}
          />
        )}
        {items.length > 1 && <MediaPagingActions onPrevious={previous} onNext={next} />}
      </main>
      <div className="h-[env(safe-area-inset-bottom)] shrink-0 bg-black" />
    </div>,
    document.body,
  );
}

function formatDuration(value: number) {
  const safe = Math.max(0, Math.floor(value));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
