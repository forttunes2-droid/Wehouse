/** Coalesce events without overlapping reads or publishing an old workspace's result. */
export function createRefreshScheduler(
  load: (isCurrent: () => boolean) => Promise<void>,
  isVisible: () => boolean,
  delayMs = 250,
) {
  let disposed = false;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const request = () => {
    if (disposed) return;
    pending = true;
    if (!isVisible() || running || timer !== undefined) return;
    // Do not restart this timer on every event: a busy inbox must still update.
    timer = setTimeout(() => void run(), delayMs);
  };

  const run = async () => {
    timer = undefined;
    if (disposed || !isVisible()) return;
    running = true;
    pending = false;
    try {
      await load(() => !disposed);
    } catch {
      // Preserve the last known counts. A later event/focus/poll retries;
      // failures must not start a tight retry loop or an unhandled rejection.
    } finally {
      running = false;
      if (pending) request();
    }
  };

  return {
    request,
    dispose() {
      disposed = true;
      pending = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
