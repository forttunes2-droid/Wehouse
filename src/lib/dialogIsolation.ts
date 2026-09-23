/** One owner for page isolation across profiles, messages, media and dialogs.
 * Capturing `inert`/overflow independently in each component leaves the app
 * locked when nested dialogs unmount in parent-first order (workspace switch).
 * These locks change interaction only; they never grant data access.
 */
type Layer = { root: HTMLElement; order: number };
type Isolation = {
  layers: Set<Layer>;
  original: Map<HTMLElement, boolean>;
  overflow: string;
  nextOrder: number;
  observer: MutationObserver;
};
const documents = new WeakMap<Document, Isolation>();

function topLayer(state: Isolation): Layer | undefined {
  return [...state.layers].filter(layer => layer.root.isConnected).sort((a, b) => {
    if (a.root.contains(b.root)) return -1;
    if (b.root.contains(a.root)) return 1;
    const view = a.root.ownerDocument.defaultView;
    const az = Number.parseInt(view?.getComputedStyle(a.root).zIndex || '0') || 0;
    const bz = Number.parseInt(view?.getComputedStyle(b.root).zIndex || '0') || 0;
    return az - bz || a.order - b.order;
  }).at(-1);
}

function reconcile(doc: Document, state: Isolation) {
  const top = topLayer(state);
  if (!top) return;
  for (const child of doc.body.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (!state.original.has(child)) state.original.set(child, child.inert);
    child.inert = child !== top.root && !child.contains(top.root);
  }
  doc.body.style.overflow = 'hidden';
}

export function isTopDialog(root: HTMLElement): boolean {
  const state = documents.get(root.ownerDocument);
  return Boolean(state && topLayer(state)?.root === root);
}

/** Release is idempotent and correct for every unmount order and StrictMode. */
export function isolateDialog(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  let state = documents.get(doc);
  if (!state) {
    const observer = new MutationObserver(() => {
      const current = documents.get(doc);
      if (current) reconcile(doc, current);
    });
    state = { layers: new Set(), original: new Map(), overflow: doc.body.style.overflow, nextOrder: 0, observer };
    documents.set(doc, state);
    observer.observe(doc.body, { childList: true });
  }
  const layer: Layer = { root, order: ++state.nextOrder };
  state.layers.add(layer);
  reconcile(doc, state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.layers.delete(layer);
    if (state.layers.size) {
      reconcile(doc, state);
      return;
    }
    state.observer.disconnect();
    for (const [node, inert] of state.original) node.inert = inert;
    doc.body.style.overflow = state.overflow;
    documents.delete(doc);
  };
}
