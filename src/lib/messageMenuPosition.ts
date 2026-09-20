export type MessageMenuAnchor = { top: number; bottom: number; left: number; right: number };

export function messageMenuPosition(anchor: MessageMenuAnchor | null, width: number, height: number,
  viewport: { width: number; height: number; top: number }) {
  const margin = 12;
  const minTop = viewport.top + margin;
  const maxTop = Math.max(minTop, viewport.top + viewport.height - height - margin);
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.max(margin, Math.min(anchor ? anchor.right - width : (viewport.width - width) / 2, maxLeft));
  let top = anchor ? anchor.top - height - 8 : minTop;
  if (anchor && top < minTop && anchor.bottom + 8 + height <= viewport.top + viewport.height - margin)
    top = anchor.bottom + 8;
  return { top: Math.max(minTop, Math.min(top, maxTop)), left };
}
