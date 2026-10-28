import { buildNavigationHash } from "@/lib/navigationRoute";
import {sharePublicReference} from './publicReferenceShare';

const ORIGIN = "https://wehouse.com.ng";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A published activity uses the same Services sharing path. Only a public
// reference is shared; dates, price, attendance and payment are never implied.
export type SharedWorker = { id: string; kind?: 'experience' };

export function workerReference(id: unknown, kind?: unknown): SharedWorker | null {
  if (typeof id !== "string") return null;
  const value = id.trim();
  if (kind !== undefined && kind !== 'experience') return null;
  return ID_PATTERN.test(value) ? kind === 'experience' ? { id: value, kind } : { id: value } : null;
}

export function workerShareUrl(worker: SharedWorker): string {
  const ref = workerReference(worker.id,worker.kind);
  if (!ref) throw new Error("This Service or activity cannot be shared.");
  return `${ORIGIN}/${buildNavigationHash("worker_discovery", ref.kind==='experience'?{experienceId:ref.id}:{id:ref.id})}`;
}

export function workerShareMessage(worker: SharedWorker, note = ""): string {
  const cleanNote = note.trim();
  return `${cleanNote ? `${cleanNote}\n\n` : ""}${workerShareUrl(worker)}`;
}

export function parseWorkerShareMessage(content: string): { worker: SharedWorker; text: string } | null {
  if (content.length > 16_000) return null;
  const lines = content.trimEnd().split("\n");
  const finalLine = lines.at(-1)?.trim() || "";
  try {
    const url = new URL(finalLine);
    if (url.origin !== ORIGIN || url.pathname !== "/" || url.search || url.username || url.password || url.port) return null;
    if(url.hash.split('?').length!==2)return null;
    const route = new URLSearchParams(url.hash.slice(1).split("?")[1] || "");
    const routeName = url.hash.slice(1).split("?")[0];
    const params=[...route.keys()];
    if(params.length!==1||route.getAll(params[0]).length!==1)return null;
    const worker = routeName === "worker_discovery"
      ? params[0]==='experienceId'?workerReference(route.get('experienceId'),'experience'):params[0]==='id'?workerReference(route.get('id')):null : null;
    return worker ? { worker, text: lines.slice(0, -1).join("\n").trimEnd() } : null;
  } catch { return null; }
}
export function workerMessagePreview(content: string): string {
  const shared = parseWorkerShareMessage(content);
  return shared ? shared.text || (shared.worker.kind==='experience'?"Shared an activity":"Recommended a Worker profile") : content;
}

const drafts = new Map<string, { worker: SharedWorker; expires: number }>();
const key = (userId: string, conversationId: string) => JSON.stringify([userId, conversationId]);
export function queueWorkerShare(userId: string, conversationId: string, worker: SharedWorker, now = Date.now()): void {
  const ref = workerReference(worker.id,worker.kind);
  if (!userId || !conversationId || !ref) throw new Error("Choose an available connection and Worker profile.");
  for (const [id, draft] of drafts) if (draft.expires <= now) drafts.delete(id);
  if (drafts.size >= 20) drafts.delete(drafts.keys().next().value!);
  drafts.set(key(userId, conversationId), { worker: ref, expires: now + 15 * 60_000 });
}
export function pendingWorkerShare(userId: string, conversationId: string, now = Date.now()): SharedWorker | null {
  const draft = drafts.get(key(userId, conversationId));
  if (!draft || draft.expires <= now) { drafts.delete(key(userId, conversationId)); return null; }
  return { ...draft.worker };
}
export function clearWorkerShare(userId: string, conversationId: string): void { drafts.delete(key(userId, conversationId)); }

export async function shareServiceExternally(item: SharedWorker, title: string): Promise<'shared'|'copied'|'cancelled'> {
  return sharePublicReference(workerShareUrl(item),title);
}
