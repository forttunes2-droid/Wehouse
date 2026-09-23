import { useEffect, useRef } from 'react';

/** Isolate a portalled dialog without changing routes or granting capabilities. */
export function useDialogInteraction(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== root && !node.contains(root));
    const previous = siblings.map(node => ({ node, inert: node.inert }));
    previous.forEach(({ node }) => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    const focusables = () => [...root.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(node => !node.closest('[hidden],[inert]') && node.getClientRects().length > 0);
    const focus = requestAnimationFrame(() => (focusables()[0] || root).focus({ preventScroll: true }));
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
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
      previous.forEach(({ node, inert }) => { node.inert = inert; });
      document.body.style.overflow = overflow;
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
