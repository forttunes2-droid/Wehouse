import { useRef, type PointerEvent, type MouseEvent } from "react";
import { mediaSwipe } from "@/lib/mediaViewport";

type Options = { identity: string; axis?: "horizontal" | "vertical"; enabled?: boolean; onPrevious?: () => void; onNext?: () => void };
type Gesture = { id: number; x: number; y: number; claimed: boolean; moved: boolean; identity: string };

/** Paging for video/error stages. Photo-local pinch/pan has its own owner.
 * Never steal a seek slider, a button tap, a cancelled or multi-touch gesture. */
export function useMediaSwipe({ identity, axis = "horizontal", enabled = true, onPrevious, onNext }: Options) {
  const state = useRef<{ pointers: Set<number>; gesture: Gesture | null; suppressUntil: number; blocked: boolean }>({ pointers: new Set(), gesture: null, suppressUntil: 0, blocked: false });
  const eligible = (target: HTMLElement) => !target.closest("[data-photo-stage],input,textarea,a,select,[contenteditable=true]") && (!target.closest("button") || Boolean(target.closest("[data-media-toggle]")));
  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!enabled || !eligible(event.target as HTMLElement) || (event.pointerType === "mouse" && event.button !== 0)) return;
    const current = state.current;
    // Re-entering a stage after a render must not retain a vanished pointer.
    if (event.isPrimary) { current.pointers.clear(); current.blocked = false; }
    current.pointers.add(event.pointerId);
    if (current.pointers.size !== 1 || !event.isPrimary) {
      current.gesture = null; current.blocked = true; current.suppressUntil = Date.now() + 500; return;
    }
    current.suppressUntil = 0;
    current.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, claimed: false, moved: false, identity };
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = state.current, start = current.gesture;
    if (!enabled || !start || start.identity !== identity || start.id !== event.pointerId || current.pointers.size !== 1) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    start.moved ||= Math.hypot(dx, dy) > 8;
    const along = axis === "horizontal" ? dx : dy, across = axis === "horizontal" ? dy : dx;
    if (!start.claimed && Math.abs(along) > 12 && Math.abs(along) > Math.abs(across) * 1.4) {
      start.claimed = true; event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.claimed) event.preventDefault();
  }
  function finish(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    const current = state.current, start = current.gesture;
    current.pointers.delete(event.pointerId);
    if (current.blocked) { current.suppressUntil = Date.now() + 500; return; }
    if (!start || start.id !== event.pointerId) return;
    current.gesture = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled || start.moved) current.suppressUntil = Date.now() + 500;
    if (cancelled || !enabled || start.identity !== identity || !start.claimed || current.pointers.size) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const direction = mediaSwipe(axis === "horizontal" ? dx : dy, axis === "horizontal" ? dy : dx, false, false);
    if (direction) (direction > 0 ? onNext : onPrevious)?.();
  }
  function onClickCapture(event: MouseEvent<HTMLElement>) {
    // Keyboard activation has detail=0; only suppress synthetic pointer clicks.
    if (event.detail > 0 && Date.now() < state.current.suppressUntil) { event.preventDefault(); event.stopPropagation(); }
  }
  return { onPointerDown, onPointerMove, onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false), onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true), onClickCapture };
}
