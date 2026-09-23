import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  onOpen: (anchor: DOMRect) => void;
  onTap?: (anchor: DOMRect) => void;
  onReply?: () => void;
  replyDirection?: "left" | "right";
};

const INTERACTIVE = "button,a,input,textarea,select,audio,video,[contenteditable=true]";
/** Opt in only the visual message surface. A media tile is still a button for
 * keyboard/tap navigation; audio controls, retries and draft removal are not. */
function blocksGesture(target: EventTarget) {
  const control = (target as HTMLElement).closest(INTERACTIVE);
  return Boolean(control && control.getAttribute?.("data-message-swipe-surface") !== "true");
}
const THRESHOLD = 54;
type Gesture = { id: number; x: number; y: number; direction: number; axis: "pending" | "horizontal" | "vertical"; distance: number };

/** Reply moves inward from the rendered message side. All chat types share this
 * gesture; no caller needs a second, conflicting touch handler. An explicit
 * direction is available for a surface that does not use start/end alignment. */
export default function MessagePress({ children, className = "", onOpen, onTap, onReply, replyDirection }: Props) {
  const timer = useRef<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const opened = useRef(false);
  const dragged = useRef(false);
  const [translate, setTranslate] = useState(0);

  function cancelTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    opened.current = false;
    dragged.current = false;
    if (blocksGesture(event.target)) return;
    const element = event.currentTarget;
    cancelTimer();
    opened.current = false;
    dragged.current = false;
    setTranslate(0);
    // Start/end is already the common layout contract used by roommate,
    // service and hotel messages. Read physical alignment, not profile roles.
    const endAligned = window.getComputedStyle(element).justifyContent === "flex-end";
    const direction = replyDirection ? (replyDirection === "left" ? -1 : 1) : (endAligned ? -1 : 1);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, direction, axis: "pending", distance: 0 };
    timer.current = window.setTimeout(() => {
      if (!gesture.current || gesture.current.axis !== "pending") return;
      opened.current = true;
      timer.current = null;
      navigator.vibrate?.(18);
      onOpen(element.getBoundingClientRect());
    }, 420);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || opened.current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.axis === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 8) return;
      cancelTimer();
      dragged.current = true;
      current.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      // Capturing on pointerdown retargets the eventual click away from a
      // property/photo button. Capture only after an actual horizontal drag.
      if (current.axis === "horizontal" && onReply) event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    // Once vertical scrolling starts it cannot turn into a reply gesture.
    if (current.axis !== "horizontal" || !onReply) return;
    if (event.cancelable) event.preventDefault();
    const inward = Math.max(0, dx * current.direction);
    current.distance = Math.min(72, inward * 0.72);
    setTranslate(current.direction * current.distance);
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    cancelTimer();
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && !opened.current && current.axis === "horizontal" && current.distance >= THRESHOLD && onReply) {
      opened.current = true;
      navigator.vibrate?.(12);
      onReply();
    }
    setTranslate(0);
  }

  return (
    <div
      className={`relative min-w-0 select-none ${className}`}
      style={{ touchAction: "pan-y pinch-zoom", overscrollBehaviorX: "contain", overflowX: "clip", overflowY: "visible", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
      data-reply-gesture="inward"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => {
        // Touch starts with implicit capture on the image/button. Moving capture
        // to this wrapper emits a bubbling loss from that child, not cancellation.
        if (event.target === event.currentTarget) finish(event, true);
      }}
      onContextMenu={(event) => {
        if (blocksGesture(event.target)) return;
        event.preventDefault();
        cancelTimer();
        if (opened.current) return;
        opened.current = true;
        onOpen(event.currentTarget.getBoundingClientRect());
      }}
      onClick={(event) => {
        if (opened.current || dragged.current || !onTap || (event.target as HTMLElement).closest(INTERACTIVE)) return;
        onTap(event.currentTarget.getBoundingClientRect());
      }}
      onClickCapture={(event) => {
        if (!opened.current && !dragged.current) return;
        event.preventDefault();
        event.stopPropagation();
        opened.current = false;
        dragged.current = false;
      }}
    >
      {onReply && translate !== 0 ? (
        <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${translate > 0 ? "left-1" : "right-1"} grid h-8 w-8 place-items-center rounded-full bg-violet-500/20 text-sm text-violet-200 ${Math.abs(translate) >= THRESHOLD ? "opacity-100" : "opacity-45"}`}>
          ↩
        </span>
      ) : null}
      <div style={{ transform: `translateX(${translate}px)`, justifyContent: "inherit" }} className="flex w-full min-w-0 items-center transition-transform duration-75 motion-reduce:transition-none">
        {children}
      </div>
    </div>
  );
}
