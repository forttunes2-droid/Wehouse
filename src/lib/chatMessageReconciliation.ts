type ChatRow = { id: string; created_at: string; delivery_state?: "sending" | "failed" };
/** Server history remains authoritative. Only unsent local rows survive a
 * refresh; no decrypted history is persisted or shared between accounts. */
export function reconcileChatMessages<T extends ChatRow>(current: T[], received: T[]): T[] {
  const ids = new Set(received.map(message => message.id));
  return [...received, ...current.filter(message => message.delivery_state && !ids.has(message.id))]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
/** Replace the local bubble at acknowledgement, before optional read/call work.
 * A realtime echo may already exist: keep precisely one server ID. */
export function acknowledgeChatMessage<T extends ChatRow>(current: T[], localId: string, serverId: string): T[] {
  const echoed = current.find(message => message.id === serverId);
  return current.flatMap(message => {
    if (message.id !== localId) return [message];
    return echoed ? [] : [{ ...message, id: serverId, delivery_state: undefined }];
  });
}
