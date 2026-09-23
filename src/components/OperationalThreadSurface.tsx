import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Dismiss = (afterClose?: () => void) => void;

/** A conversation is its own screen, not another tall card inside the Inbox.
 * Portal placement also keeps animated workspace ancestors out of positioning.
 */
export default function OperationalThreadSurface({
  conversationId, onClose, children,
}: {
  conversationId: string;
  onClose: () => void;
  children: (dismiss: Dismiss) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const lifecycle = useRef(0);
  const [viewport, setViewport] = useState(() => ({
    top: window.visualViewport?.offsetTop || 0,
    height: window.visualViewport?.height || window.innerHeight,
  }));
  const dismiss = useCallback<Dismiss>((after) => {
    afterClose.current = after;
    if (window.history.state?.whOperationalThread === conversationId) {
      window.history.back();
    } else {
      close.current();
      afterClose.current?.();
      afterClose.current = undefined;
    }
  }, [conversationId]);

  useEffect(() => {
    const generation = ++lifecycle.current;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById("root");
    const priorInert = app?.inert || false;
    const priorOverflow = document.body.style.overflow;
    if (app) app.inert = true;
    document.body.style.overflow = "hidden";
    const previousState = { ...(window.history.state || {}) };
    delete previousState.whOperationalThread;
    if (window.history.state?.whOperationalThread !== conversationId) {
      window.history.pushState({ ...previousState, whOperationalThread: conversationId }, "");
    }
    const pop = (event: PopStateEvent) => {
      if (event.state?.whOperationalThread === conversationId) return;
      // This Back closes a nested conversation, not the workspace beneath it.
      event.stopImmediatePropagation();
      close.current();
      afterClose.current?.();
      afterClose.current = undefined;
    };
    const updateViewport = () => setViewport({
      top: window.visualViewport?.offsetTop || 0,
      height: window.visualViewport?.height || window.innerHeight,
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
      if (event.key !== "Tab") return;
      const elements = Array.from(root.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ) || []).filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); root.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
        event.preventDefault(); first.focus();
      }
    };
    // Focus the screen, not the composer: opening a thread must not summon the keyboard.
    root.current?.focus({ preventScroll: true });
    window.addEventListener("popstate", pop, true);
    window.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    root.current?.addEventListener("keydown", keydown);
    const element = root.current;
    return () => {
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      element?.removeEventListener("keydown", keydown);
      document.body.style.overflow = priorOverflow;
      if (app) app.inert = priorInert;
      if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
      // StrictMode's cleanup/setup replay must not push a second history entry.
      queueMicrotask(() => {
        if (lifecycle.current === generation && window.history.state?.whOperationalThread === conversationId)
          window.history.replaceState(previousState, "");
      });
    };
  }, [conversationId, dismiss]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-[#0E1219]" data-wehouse-screen="conversation">
      <div ref={root} role="dialog" aria-modal="true" aria-label="WeHouse conversation"
        tabIndex={-1} className="absolute inset-x-0 bg-[#0E1219] text-white outline-none"
        style={{ top: viewport.top, height: viewport.height }}>
        <ThreadContents render={children} onDismiss={dismiss} />
      </div>
    </div>, document.body,
  );
}

function ThreadContents({ render, onDismiss }: {
  render: (dismiss: Dismiss) => ReactNode;
  onDismiss: Dismiss;
}) {
  return <>{render(onDismiss)}</>;
}
