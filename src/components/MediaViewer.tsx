import { useEffect, useRef, useState } from "react";
import { isolateDialog, isTopDialog } from "@/lib/dialogIsolation";
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
  const dialogRoot = useRef<HTMLDivElement>(null);
  const {
    title = "Media preview",
    subtitle,
    avatarUrl,
    onClose,
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
  const [ready, setReady] = useState(kind === "video");
  const [failed, setFailed] = useState(!src);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setIndex(Math.min(Math.max(requestedIndex, 0), maxIndex));
  }, [requestedIndex, maxIndex]);

  useEffect(() => {
    const root = dialogRoot.current;
    if (!root) return;
    const release = isolateDialog(root);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!isTopDialog(root) || event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (items.length > 1 && event.key === "ArrowLeft") {
        setIndex((value) => Math.max(0, value - 1));
      }
      if (items.length > 1 && event.key === "ArrowRight") {
        setIndex((value) => Math.min(items.length - 1, value + 1));
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      release();
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [items.length, onClose]);

  useEffect(() => {
    setReady(kind === "video");
    setFailed(!src);
    setCurrentTime(0);
    setDuration(0);
  }, [kind, src]);

  return createPortal(
    <div ref={dialogRoot} tabIndex={-1}
      className="fixed inset-0 z-[100200] isolate flex h-[100svh] flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[.08] px-4 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] backdrop-blur-xl">
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
              <p className="mt-0.5 truncate text-[9px] text-white/55">
                {subtitle}
              </p>
            ) : kind === "video" && duration > 0 ? (
              <p className="mt-0.5 font-mono text-[9px] text-white/55">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </p>
            ) : items.length > 1 ? (
              <p className="mt-0.5 text-[9px] text-white/55">
                {index + 1} / {items.length}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[.08] text-xl"
          aria-label="Close media preview"
        >
          ×
        </button>
      </header>
      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
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
            <p className="mt-2 text-[10px] text-white/55">
              Close the viewer and try again.
            </p>
          </div>
        ) : kind === "video" ? (
          <VideoPlayer
            src={src}
            autoPlay
            onTime={setCurrentTime}
            onDuration={(value) => {
              setDuration(value);
              setReady(true);
            }}
            onPlaybackError={() => setFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <img
            src={src}
            alt={title}
            decoding="async"
            onLoad={() => setReady(true)}
            onError={() => setFailed(true)}
            className={`max-h-full max-w-full object-contain transition-opacity ${ready ? "opacity-100" : "opacity-0"}`}
          />
        )}
        {items.length > 1 && index > 0 ? (
          <button
            type="button"
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-black/55 text-2xl"
            aria-label="Previous media"
          >
            ‹
          </button>
        ) : null}
        {items.length > 1 && index < items.length - 1 ? (
          <button
            type="button"
            onClick={() =>
              setIndex((value) => Math.min(items.length - 1, value + 1))
            }
            className="absolute right-3 grid h-11 w-11 place-items-center rounded-full bg-black/55 text-2xl"
            aria-label="Next media"
          >
            ›
          </button>
        ) : null}
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
