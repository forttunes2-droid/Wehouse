import { useLayoutEffect, type RefObject } from 'react';

/** Keep an opaque media layer over the *visible* viewport when browser chrome,
 * keyboard or pre-existing page zoom changes it. Page zoom is never disabled. */
export function useVisualViewportFrame(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      Object.assign(node.style, {
        top: `${viewport?.offsetTop || 0}px`, left: `${viewport?.offsetLeft || 0}px`,
        width: `${viewport?.width || window.innerWidth}px`, height: `${viewport?.height || window.innerHeight}px`,
        right: 'auto', bottom: 'auto',
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);
}
