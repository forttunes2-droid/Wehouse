import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { boundedCamera, fittedImage, mediaSwipe, restingCamera, zoomAt, type ImageBounds, type ImageCamera } from '@/lib/mediaViewport';

type Props = { src: string; title: string; onReady: () => void; onError: () => void; onPrevious?: () => void; onNext?: () => void };
/** Pinch/pan belongs to the image, not to the Account page behind it. */
export default function ZoomablePhoto({ src, title, onReady, onError, onPrevious, onNext }: Props) {
  const stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const camera = useRef<ImageCamera>(restingCamera());
  const bounds = useRef<ImageBounds>({ width: 0, height: 0, imageWidth: 0, imageHeight: 0 });
  const [scale, setScale] = useState(1);
  const move = useRef<(value: ImageCamera) => void>(() => undefined);
  const callbacks = useRef({ onPrevious, onNext }); callbacks.current = { onPrevious, onNext };
  useEffect(() => {
    const node = stage.current, img = image.current;
    if (!node || !img) return;
    let frame = 0, disposed = false;
    const points = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; camera: ImageCamera; zoomed: boolean } | null = null;
    let pinch: { distance: number; x: number; y: number; camera: ImageCamera } | null = null;
    let multiple = false, moved = false, lastTap = 0;
    const paint = () => {
      frame = 0;
      if (disposed) return;
      const c = camera.current;
      img.style.transform = `translate3d(${c.x}px,${c.y}px,0) scale(${c.scale})`;
      node.dataset.imageScale = String(c.scale);
      node.dataset.imageX = String(c.x); node.dataset.imageY = String(c.y);
      setScale(c.scale);
    };
    move.current = value => {
      camera.current = boundedCamera(value, bounds.current);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const measure = () => {
      const width = node.clientWidth, height = node.clientHeight;
      const fit = fittedImage(width, height, img.naturalWidth, img.naturalHeight);
      bounds.current = { width, height, imageWidth: fit.width, imageHeight: fit.height };
      img.style.width = `${fit.width}px`; img.style.height = `${fit.height}px`;
      move.current(camera.current);
    };
    const location = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      return { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 };
    };
    const startPinch = () => {
      const [a, b] = [...points.values()];
      if (a && b) pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, camera: { ...camera.current } };
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      const point = location(event); points.set(event.pointerId, point); node.setPointerCapture(event.pointerId);
      if (points.size === 1) { start = { ...point, camera: { ...camera.current }, zoomed: camera.current.scale > 1.01 }; multiple = false; moved = false; }
      else { multiple = true; lastTap = 0; startPinch(); }
    };
    const drag = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      event.preventDefault(); const point = location(event); points.set(event.pointerId, point);
      if (points.size >= 2 && pinch) {
        const [a, b] = [...points.values()];
        const next = Math.max(1, Math.min(4, pinch.camera.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
        move.current({ scale: next, x: (a.x + b.x) / 2 - (pinch.x - pinch.camera.x) * next / pinch.camera.scale, y: (a.y + b.y) / 2 - (pinch.y - pinch.camera.y) * next / pinch.camera.scale });
      } else if (start) {
        const dx = point.x - start.x, dy = point.y - start.y;
        moved ||= Math.hypot(dx, dy) > 8;
        if (start.zoomed) move.current({ ...start.camera, x: start.camera.x + dx, y: start.camera.y + dy });
      }
    };
    const finish = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      const point = location(event); points.delete(event.pointerId);
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      if (event.type === 'pointercancel') { start = null; pinch = null; multiple = true; lastTap = 0; return; }
      if (points.size) {
        const remaining = [...points.values()][0];
        start = { ...remaining, camera: { ...camera.current }, zoomed: camera.current.scale > 1.01 }; pinch = null; return;
      }
      if (start) {
        const direction = mediaSwipe(point.x - start.x, point.y - start.y, start.zoomed, multiple);
        if (direction) { lastTap = 0; (direction > 0 ? callbacks.current.onNext : callbacks.current.onPrevious)?.(); }
        else if (!moved && !multiple && event.pointerType !== 'mouse') {
          if (Date.now() - lastTap < 300) { move.current(camera.current.scale > 1.01 ? restingCamera() : zoomAt(camera.current, 2, point, bounds.current)); lastTap = 0; }
          else lastTap = Date.now();
        }
      }
      start = null; pinch = null;
    };
    const doubleClick = (event: MouseEvent) => {
      event.preventDefault(); const box = node.getBoundingClientRect();
      move.current(camera.current.scale > 1.01 ? restingCamera() : zoomAt(camera.current, 2, { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }, bounds.current));
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault(); const box = node.getBoundingClientRect();
        move.current(zoomAt(camera.current, camera.current.scale * Math.exp(-event.deltaY * .01), { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }, bounds.current));
      } else if (camera.current.scale > 1.01) { event.preventDefault(); move.current({ ...camera.current, x: camera.current.x - event.deltaX, y: camera.current.y - event.deltaY }); }
    };
    const observer = new ResizeObserver(measure); observer.observe(node); img.addEventListener('load', measure); measure();
    node.addEventListener('pointerdown', down); node.addEventListener('pointermove', drag);
    node.addEventListener('pointerup', finish); node.addEventListener('pointercancel', finish);
    node.addEventListener('dblclick', doubleClick); node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      disposed = true; observer.disconnect(); cancelAnimationFrame(frame); points.clear(); move.current = () => undefined;
      img.removeEventListener('load', measure); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', drag);
      node.removeEventListener('pointerup', finish); node.removeEventListener('pointercancel', finish); node.removeEventListener('dblclick', doubleClick); node.removeEventListener('wheel', wheel);
    };
  }, []);
  return <div className="relative flex h-full w-full min-h-0 flex-col bg-black">
    <div ref={stage} data-photo-stage className="relative grid min-h-0 flex-1 touch-none select-none place-items-center overflow-hidden overscroll-none" style={{ touchAction: 'none' }}>
      <img ref={image} src={src} alt={title} draggable={false} decoding="async" onLoad={onReady} onError={onError} className="pointer-events-none max-w-none select-none object-contain" style={{ willChange: 'transform' }} />
    </div>
    <div className="flex min-h-14 shrink-0 items-center justify-center gap-2 bg-black px-3 text-white">
      <button type="button" aria-label="Zoom out" disabled={scale <= 1.01} onClick={() => move.current(zoomAt(camera.current, camera.current.scale / 1.5, { x: 0, y: 0 }, bounds.current))} className="grid h-11 w-11 place-items-center rounded-full disabled:opacity-30"><Minus size={20} /></button>
      <span className="min-w-14 text-center text-sm tabular-nums" aria-label="Image zoom">{Math.round(scale * 100)}%</span>
      <button type="button" aria-label="Zoom in" disabled={scale >= 3.99} onClick={() => move.current(zoomAt(camera.current, camera.current.scale * 1.5, { x: 0, y: 0 }, bounds.current))} className="grid h-11 w-11 place-items-center rounded-full disabled:opacity-30"><Plus size={20} /></button>
      <button type="button" aria-label="Reset image zoom" disabled={scale <= 1.01} onClick={() => move.current(restingCamera())} className="ml-2 grid h-11 w-11 place-items-center rounded-full disabled:opacity-30"><RotateCcw size={18} /></button>
    </div>
  </div>;
}
