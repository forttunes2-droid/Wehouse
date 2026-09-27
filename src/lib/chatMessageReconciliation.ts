/** Client-only delivery state. Never treats a pending message as server-confirmed. */
export type MessageSyncState = {
  id: string; created_at: string; attachments?: string[]; attachment_types?: string[];
  delivery_state?: 'sending' | 'failed'; client_confirmed_at?: number;
  media_loading?: boolean; media_error?: boolean;
};
/** An older snapshot cannot erase a local send, or an acknowledgement received
 * after that snapshot began. Server rows remain authoritative for existing IDs. */
export function reconcileChatMessages<T extends MessageSyncState>(current: T[], incoming: T[], startedAt = Date.now()): T[] {
  const previous = new Map(current.map(row => [row.id, row]));
  const result = new Map<string, T>();
  for (const row of incoming) {
    const old = previous.get(row.id);
    result.set(row.id, row.media_loading && old?.attachments?.length
      ? { ...row, attachments: old.attachments, attachment_types: old.attachment_types }
      : row);
  }
  for (const row of current) {
    if (!result.has(row.id) && (row.delivery_state || (row.client_confirmed_at || 0) >= startedAt)) result.set(row.id, row);
  }
  return [...result.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
export function acknowledgeChatMessage<T extends MessageSyncState>(current: T[], pendingId: string, serverId: string, now = Date.now()): T[] {
  const local = current.find(row => row.id === pendingId);
  const server = current.find(row => row.id === serverId);
  const rest = current.filter(row => row.id !== pendingId && row.id !== serverId);
  if (server) rest.push(server);
  else if (local) rest.push({ ...local, id: serverId, delivery_state: undefined, client_confirmed_at: now });
  return rest.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
