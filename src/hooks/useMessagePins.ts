import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";

export type PinSurface = "roommate" | "worker" | "friend" | "hotel" | "property_host";
export const MAX_PINNED_MESSAGES = 10;

export function useMessagePins(surface: PinSurface | null, threadId: string | null | undefined, refreshKey?: unknown) {
  const [pinned, setPinned] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!surface || !threadId) return setPinned([]);
    const { data, error } = await supabase.rpc("get_message_pins", { p_surface: surface, p_thread: threadId });
    if (!error) setPinned(((data || []) as { message_id: string }[]).map((row) => row.message_id));
  }, [surface, threadId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const toggle = useCallback(async (messageId: string) => {
    if (!surface || !threadId) return;
    const next = !pinned.includes(messageId);
    if (next && pinned.length >= MAX_PINNED_MESSAGES) {
      toast.error(`You can pin up to ${MAX_PINNED_MESSAGES} messages. Unpin one first.`);
      return;
    }
    const { error } = await supabase.rpc("set_message_pin", { p_surface: surface, p_thread: threadId, p_message: messageId, p_pinned: next });
    if (error) return toast.error(error.message || "Pin could not be saved");
    setPinned((all) => (next ? [messageId, ...all] : all.filter((id) => id !== messageId)));
    toast.success(next ? "Message pinned" : "Message unpinned");
  }, [surface, threadId, pinned]);

  return { pinned, toggle, reload: load };
}
