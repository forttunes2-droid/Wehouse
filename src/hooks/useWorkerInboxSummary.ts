import { useInboxRefresh } from "./useInboxRefresh";
import { withTimeout } from "@/lib/withTimeout";
import { useActorInboxCounts } from "./useActorInboxCounts";
import { useCallback, useEffect } from "react";
import { activityIsCurrent, visibleUnreadActivityCount } from "@/lib/activityFeed";
import {
  getCanonicalActivity,
  subscribeToCanonicalActivity,
} from "@/lib/supabase/activity";
import { supabase } from "@/lib/supabase";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { getMySupportConversations } from "@/lib/supabase/support";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";

export function useWorkerInboxSummary(userId: string) {
  const { chatUnread, activityUnread, updateCounts } = useActorInboxCounts(userId);

  const load = useCallback(async (isCurrent: () => boolean) => {
    if (!userId) return;
    const [jobs, support, events, announcements] = await withTimeout(Promise.all([
      getCommunicationBookingConversations(userId),
      getMySupportConversations("worker"),
      getCanonicalActivity("worker", 100),
      getAnnouncementsForUser(userId, "worker"),
    ]), 15000, "Inbox summary took too long to load.");
    if (!isCurrent()) return;

    if (!jobs.error && !support.error) {
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
      updateCounts({ chatUnread: jobThreads + supportThreads });
    }

    const eventUnread = events.error ? 0 : visibleUnreadActivityCount(events.rows, "worker");
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
    // Keep the last complete count if either source failed; zero is not evidence
    // that a failed Activity read is empty.
    if (!events.error && !announcements.error)
      updateCounts({ activityUnread: eventUnread + announcementUnread });
  }, [userId, updateCounts]);

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
