import { useEffect, useRef } from 'react';
import { isolateDialog, isTopDialog } from '@/lib/dialogIsolation';

/** Isolate a portalled dialog without changing routes or granting capabilities. */
export function useDialogInteraction(onDismiss: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = isolateDialog(root);
    const focusables = () => [...root.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(node => !node.closest('[hidden],[inert]') && node.getClientRects().length > 0);
    const focus = requestAnimationFrame(() => { if (isTopDialog(root)) (focusables()[0] || root).focus({ preventScroll: true }); });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopDialog(root)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = focusables();
      if (!nodes.length) { event.preventDefault(); root.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(focus);
      root.removeEventListener('keydown', keydown);
      release();
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
  }, [enabled]);
  return ref;
}
