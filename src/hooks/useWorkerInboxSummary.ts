import { useCallback, useEffect, useState } from "react";
import {
  activityIsCurrent,
  currentActivityRows,
  longestActivityCutoff,
} from "@/lib/activityFeed";
import { supabase } from "@/lib/supabase";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { getMySupportConversations } from "@/lib/supabase/support";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";

export function useWorkerInboxSummary(userId: string) {
  const [chatUnread, setChatUnread] = useState(0);
  const [activityUnread, setActivityUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [jobs, support, events, announcements] = await Promise.all([
      getCommunicationBookingConversations(userId),
      getMySupportConversations(),
      supabase
        .from("notifications")
        .select(
          "type,title,message,source_type,destination_route,created_at,read",
        )
        .eq("recipient_id", userId)
        .eq("workspace_scope", "worker")
        .eq("read", false)
        .gte("created_at", longestActivityCutoff()),
      getAnnouncementsForUser(userId),
    ]);

    if (!jobs.error || !support.error) {
      const jobThreads = jobs.error
        ? 0
        : (jobs.conversations || []).filter(
            (row: { unread_count?: number | null }) =>
              Number(row.unread_count || 0) > 0,
          ).length;
      const supportThreads = support.error
        ? 0
        : (support.conversations || []).filter(
            (row: { unread_count?: number | null }) =>
              Number(row.unread_count || 0) > 0,
          ).length;
      setChatUnread(jobThreads + supportThreads);
    }

    const eventUnread = events.error
      ? 0
      : currentActivityRows(
          (events.data || []).map((row) => ({
            ...row,
            source: "event" as const,
          })),
        ).length;
    const announcementUnread = announcements.error
      ? 0
      : (announcements.messages || []).filter((delivery: any) => {
          const announcement = Array.isArray(delivery.announcements)
            ? delivery.announcements[0]
            : delivery.announcement || delivery.message;
          return (
            !delivery.read_status &&
            activityIsCurrent({
              type: "announcement",
              source: "announcement",
              created_at:
                announcement?.created_at || delivery.delivered_at,
            })
          );
        }).length;
    if (!events.error || !announcements.error)
      setActivityUnread(eventUnread + announcementUnread);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    const channel = supabase
      .channel(`worker-inbox-summary:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "booking_messages" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        () => void refresh(),
      )
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
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onUnreadChanged = () => void refresh();
    window.addEventListener("focus", onVisible);
    window.addEventListener("wehouse:unread-changed", onUnreadChanged);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("wehouse:unread-changed", onUnreadChanged);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return {
    chatUnread,
    activityUnread,
    totalUnread: chatUnread + activityUnread,
    refresh,
  };
}
