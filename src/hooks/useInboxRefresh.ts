import { useCallback, useEffect, useRef } from "react";
import { createRefreshScheduler } from "@/lib/refreshScheduler";

export function useInboxRefresh(
  load: (isCurrent: () => boolean) => Promise<void>,
  enabled: boolean,
) {
  const schedulerRef = useRef<ReturnType<typeof createRefreshScheduler> | null>(null);
  const refresh = useCallback(() => schedulerRef.current?.request(), []);

  useEffect(() => {
    if (!enabled) return;
    const scheduler = createRefreshScheduler(
      load,
      () => document.visibilityState === "visible",
    );
    schedulerRef.current = scheduler;
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduler.request();
    };
    scheduler.request();
    window.addEventListener("focus", onVisible);
    window.addEventListener("wehouse:unread-changed", scheduler.request);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(scheduler.request, 60_000);
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("wehouse:unread-changed", scheduler.request);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  return refresh;
}
