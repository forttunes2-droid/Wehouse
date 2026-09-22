import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { bindProfileScreenHistory } from "@/lib/profileScreenHistory";

/** Detail screens stay inside the originating workspace and consume one Back.
 * Uses the existing shared layer stack so a profile/media layer remains above it. */
export function useRecordScreenBack(onBack: () => void, enabled = true) {
  const id = useId();
  const callback = useRef(onBack);
  useLayoutEffect(() => { callback.current = onBack; }, [onBack]);
  const binding = useRef<ReturnType<typeof bindProfileScreenHistory> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const layer = bindProfileScreenHistory(window, `record:${id}`, () => callback.current());
    binding.current = layer;
    return () => { layer.dispose(); if (binding.current === layer) binding.current = null; };
  }, [id, enabled]);
  return useCallback(() => binding.current ? binding.current.dismiss() : callback.current(), []);
}
