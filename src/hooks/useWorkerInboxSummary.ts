import { useInboxRefresh } from "./useInboxRefresh";
import { useCallback, useEffect, useState } from "react";
import { activityIsCurrent } from "@/lib/activityFeed";
import {
  getCanonicalActivitySummary,
  subscribeToCanonicalActivity,
} from "@/lib/supabase/activity";
import { supabase } from "@/lib/supabase";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { getMySupportConversations } from "@/lib/supabase/support";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";

export function useWorkerInboxSummary(userId: string) {
  const [chatUnread, setChatUnread] = useState(0);
  const [activityUnread, setActivityUnread] = useState(0);

  const load = useCallback(async (isCurrent: () => boolean) => {
    if (!userId) return;
    const [jobs, support, events, announcements] = await Promise.all([
      getCommunicationBookingConversations(userId),
      getMySupportConversations("worker"),
      getCanonicalActivitySummary("worker"),
      getAnnouncementsForUser(userId, "worker"),
    ]);
    if (!isCurrent()) return;

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

    const eventUnread = events.error ? 0 : events.summary.unread;
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

  const refresh = useInboxRefresh(load, Boolean(userId));

  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToCanonicalActivity(
      userId,
      `worker-inbox-summary:${userId}`,
      () => void refresh(),
    )
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
          table: "announcement_recipients",
          filter: `user_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
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
