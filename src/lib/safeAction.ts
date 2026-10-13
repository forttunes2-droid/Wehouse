const inFlight = new Map<string, Promise<unknown>>();

export const OFFLINE_MESSAGE = "No connection. Your action was not sent. Check your network and try again.";

export function isNetworkFailure(error: unknown): boolean {
  const text = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|aborted/.test(text);
}

// Runs one user action at a time per key. A second tap while the first is still running joins it
// instead of sending a duplicate. Offline and network failures give one clear message, never a false success.
export async function runSafeAction<T>(key: string, action: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(OFFLINE_MESSAGE);
  const task = (async () => {
    try {
      return await action();
    } catch (error) {
      if (isNetworkFailure(error)) throw new Error(OFFLINE_MESSAGE);
      throw error;
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

const KEY_STORE = "wh:request-keys";

function readKeys(): Record<string, { id: string; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) || "{}");
  } catch {
    return {};
  }
}

// One UUID per intended action. A retry after a timeout or reload reuses it, so the server
// returns the first result instead of creating a second booking. Release it once the action succeeded.
export function requestKeyFor(signature: string): string {
  const keys = readKeys();
  const now = Date.now();
  for (const k of Object.keys(keys)) if (now - keys[k].at > 24 * 3600 * 1000) delete keys[k];
  if (!keys[signature]) keys[signature] = { id: crypto.randomUUID(), at: now };
  try {
    localStorage.setItem(KEY_STORE, JSON.stringify(keys));
  } catch {
    /* Private mode: the key still works for this attempt. */
  }
  return keys[signature].id;
}

export function releaseRequestKey(signature: string) {
  const keys = readKeys();
  delete keys[signature];
  try {
    localStorage.setItem(KEY_STORE, JSON.stringify(keys));
  } catch {
    /* Nothing to clean up. */
  }
}
