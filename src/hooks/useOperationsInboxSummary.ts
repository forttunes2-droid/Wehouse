import { useInboxRefresh } from "./useInboxRefresh";
import { useCallback, useEffect, useState } from "react";
import { activityIsCurrent, currentActivityRows, visibleUnreadActivityCount } from "@/lib/activityFeed";
import {
  getCanonicalActivity,
  subscribeToCanonicalActivity,
} from "@/lib/supabase/activity";
import { supabase } from "@/lib/supabase";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { getSupportInbox } from "@/lib/supabase/support";

type LatestActivity = { title: string; createdAt: string } | null;
export function useOperationsInboxSummary(
  userId: string,
  activityScope = "staff",
  queue: "support" | "operations" | "field_operations" | null = null,
) {
  const [messageUnread, setMessageUnread] = useState(0);
  const [activityUnread, setActivityUnread] = useState(0);
  const [latestActivity, setLatestActivity] = useState<LatestActivity>(null);

  const load = useCallback(async (isCurrent: () => boolean) => {
    if (!userId) return;
    const [support, events, announcements] = await Promise.all([
      queue
        ? getSupportInbox(queue)
        : Promise.resolve({ conversations: [], error: null }),
      getCanonicalActivity(activityScope, 100),
      getAnnouncementsForUser(userId, activityScope),
    ]);
    if (!isCurrent()) return;

    if (!support.error) {
      setMessageUnread(
        (support.conversations || []).filter(
          (row: any) => Number(row.unread_count || 0) > 0,
        ).length,
      );
    }

    const activityFeed = events;
    const currentEvents = activityFeed.error
      ? []
      : currentActivityRows(activityFeed.rows.filter((row) => row.workspace && row.workspace.length > 0)).map((row) => ({ ...row, source: "event" as const }));
    const currentAnnouncements = (announcements.messages || []).filter(
      (delivery: any) => {
        const announcement = Array.isArray(delivery.announcements)
          ? delivery.announcements[0]
          : delivery.announcement || delivery.message;
        return activityIsCurrent({
          type: "announcement",
          source: "announcement",
          created_at: announcement?.created_at || delivery.delivered_at,
        });
      },
    );

    if (!activityFeed.error || !announcements.error) {
      const eventUnread = activityFeed.error ? 0 : visibleUnreadActivityCount(activityFeed.rows, activityScope);
      const unreadAnnouncements = currentAnnouncements.filter(
        (delivery: any) => !delivery.read_status,
      );
      setActivityUnread(eventUnread + unreadAnnouncements.length);

      const latest = [
        ...currentEvents.map((row) => ({
          title: row.title,
          createdAt: row.created_at,
        })),
        ...currentAnnouncements.map((delivery: any) => {
          const announcement = Array.isArray(delivery.announcements)
            ? delivery.announcements[0]
            : delivery.announcement || delivery.message;
          return {
            title: announcement?.title || "WeHouse update",
            createdAt: announcement?.created_at || delivery.delivered_at,
          };
        }),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      setLatestActivity(latest || null);
    }
  }, [activityScope, queue, userId]);

  const refresh = useInboxRefresh(load, Boolean(userId));

  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToCanonicalActivity(
      userId,
      `operations-inbox-summary:${activityScope}:${userId}`,
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activityScope, queue, refresh, userId]);

  return {
    messageUnread,
    activityUnread,
    totalUnread: messageUnread + activityUnread,
    latestActivity,
    refresh,
  };
}
