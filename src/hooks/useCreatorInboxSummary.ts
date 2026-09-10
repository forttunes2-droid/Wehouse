import { useCallback, useEffect, useState } from "react";
import {
  activityIsCurrent,
  currentActivityRows,
  longestActivityCutoff,
} from "@/lib/activityFeed";
import { supabase } from "@/lib/supabase";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { getSupportInbox } from "@/lib/supabase/support";

export function useCreatorInboxSummary(
  userId: string,
  activityScope: "creator" | "admin",
) {
  const [messageUnread, setMessageUnread] = useState(0);
  const [activityUnread, setActivityUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [support, events, announcements] = await Promise.all([
      getSupportInbox("all"),
      supabase
        .from("notifications")
        .select("type,title,message,source_type,destination_route,created_at,read")
        .eq("recipient_id", userId)
        .eq("read", false)
        .eq("workspace_scope", activityScope)
        .gte("created_at", longestActivityCutoff()),
      getAnnouncementsForUser(userId),
    ]);

    if (!support.error) {
      setMessageUnread(
        (support.conversations || []).filter(
          (row: any) => Number(row.unread_count || 0) > 0,
        ).length,
      );
    }
    if (!events.error || !announcements.error) {
      const eventUnread = currentActivityRows(
        (events.data || []).map((row) => ({ ...row, source: "event" as const })),
      ).length;
      const announcementUnread = (announcements.messages || []).filter(
        (delivery: any) => {
          const announcement = Array.isArray(delivery.announcements)
            ? delivery.announcements[0]
            : delivery.announcement || delivery.message;
          return (
            !delivery.read_status &&
            activityIsCurrent({
              type: "announcement",
              source: "announcement",
              created_at: announcement?.created_at || delivery.delivered_at,
            })
          );
        },
      ).length;
      setActivityUnread(eventUnread + announcementUnread);
    }
  }, [activityScope, userId]);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    const channel = supabase
      .channel(`creator-inbox-summary:${activityScope}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcement_recipients",
          filter: `user_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        () => void refresh(),
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [activityScope, refresh, userId]);

  return {
    messageUnread,
    activityUnread,
    totalUnread: messageUnread + activityUnread,
    setMessageUnread,
    setActivityUnread,
    refresh,
  };
}
