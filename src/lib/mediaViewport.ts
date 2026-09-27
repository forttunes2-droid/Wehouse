/** Image-local geometry. Never changes page zoom, a route or access rights. */
export type ImageCamera = { scale: number; x: number; y: number };
export type ImageBounds = { width: number; height: number; imageWidth: number; imageHeight: number };
export const restingCamera = (): ImageCamera => ({ scale: 1, x: 0, y: 0 });
export function fittedImage(width: number, height: number, naturalWidth: number, naturalHeight: number) {
  if (![width, height, naturalWidth, naturalHeight].every(n => Number.isFinite(n) && n > 0)) return { width: 0, height: 0 };
  const ratio = Math.min(width / naturalWidth, height / naturalHeight);
  return { width: naturalWidth * ratio, height: naturalHeight * ratio };
}
export function boundedCamera(camera: ImageCamera, bounds: ImageBounds): ImageCamera {
  const scale = Math.max(1, Math.min(4, Number.isFinite(camera.scale) ? camera.scale : 1));
  const dx = Math.max(0, (bounds.imageWidth * scale - bounds.width) / 2);
  const dy = Math.max(0, (bounds.imageHeight * scale - bounds.height) / 2);
  return { scale, x: Math.max(-dx, Math.min(dx, Number.isFinite(camera.x) ? camera.x : 0)) || 0, y: Math.max(-dy, Math.min(dy, Number.isFinite(camera.y) ? camera.y : 0)) || 0 };
}
export function zoomAt(camera: ImageCamera, scale: number, point: { x: number; y: number }, bounds: ImageBounds): ImageCamera {
  const next = Math.max(1, Math.min(4, scale));
  return boundedCamera({ scale: next, x: point.x - (point.x - camera.x) * next / camera.scale, y: point.y - (point.y - camera.y) * next / camera.scale }, bounds);
}
export function mediaSwipe(dx: number, dy: number, zoomed: boolean, multitouch: boolean): -1 | 0 | 1 {
  if (zoomed || multitouch || Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 1.4) return 0;
  return dx < 0 ? 1 : -1;
}
