import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type LatestActivity = { title: string; createdAt: string } | null;
type InboxSummary = {
  message_unread?: number;
  activity_unread?: number;
  latest_title?: string | null;
  latest_created_at?: string | null;
};

export function useOperationsInboxSummary(userId: string) {
  const [messageUnread, setMessageUnread] = useState(0);
  const [activityUnread, setActivityUnread] = useState(0);
  const [latestActivity, setLatestActivity] = useState<LatestActivity>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc("get_my_operations_inbox_summary");
    if (error) return;
    const summary = (data || {}) as InboxSummary;
    setMessageUnread(Number(summary.message_unread || 0));
    setActivityUnread(Number(summary.activity_unread || 0));
    setLatestActivity(summary.latest_title && summary.latest_created_at
      ? { title: summary.latest_title, createdAt: summary.latest_created_at }
      : null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    const channel = supabase.channel(`operations-inbox-summary:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_recipients", filter: `user_id=eq.${userId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_messages" }, () => void refresh())
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return { messageUnread, activityUnread, totalUnread: messageUnread + activityUnread, latestActivity, refresh };
}
