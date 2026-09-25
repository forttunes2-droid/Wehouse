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
    <div ref={dialogRoot} tabIndex={-1} data-media-index={index} data-media-count={items.length}
      className="fixed inset-0 z-[100200] isolate flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-black text-white outline-none"
      onKeyDown={event => {
        if (event.defaultPrevented || !dialogRoot.current || !isTopDialog(dialogRoot.current) || (event.target as HTMLElement).closest("button,input,select,textarea")) return;
        if (event.key === "ArrowLeft") { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
        if (event.key === "ArrowRight") { event.preventDefault(); setIndex(value => Math.min(maxIndex, value + 1)); }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[.08] px-4 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] bg-black">
        <div className="flex min-w-0 items-center gap-2.5">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-white/55">
                {subtitle}
              </p>
            ) : kind === "video" && duration > 0 ? (
              <p className="mt-0.5 font-mono text-xs text-white/55">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </p>
            ) : items.length > 1 ? (
              <p className="mt-0.5 text-xs text-white/55">
                {index + 1} / {items.length}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[.08] text-xl"
          aria-label="Close media preview"
        >
          ×
        </button>
      </header>
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
            <p className="text-sm font-semibold">
              This media could not be loaded
            </p>
            <p className="mt-2 text-sm text-white/55">
              Close the viewer and try again.
            </p>
          </div>
        ) : kind === "video" ? (
          <VideoPlayer
            key={`${index}:${src}`}
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
          <ZoomablePhoto key={`${index}:${src}`} src={src} title={title}
            onReady={() => setReady(true)} onError={() => setFailed(true)}
            onPrevious={previous} onNext={next}
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
