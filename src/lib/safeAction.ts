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
