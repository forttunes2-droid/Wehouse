import { useCallback, useEffect, useState } from "react";
import {
  activityIsCurrent,
  isOrdinaryMessageEvent,
  isTransientActivityEvent,
  longestActivityCutoff,
} from "@/lib/activityFeed";
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

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [support, events, announcements] = await Promise.all([
      queue
        ? getSupportInbox(queue)
        : Promise.resolve({ conversations: [], error: null }),
      supabase
        .from("notifications")
        .select(
          "type,title,source_type,destination_route,created_at,read,workspace_scope",
        )
        .eq("recipient_id", userId)
        .eq("workspace_scope", activityScope)
        .gte("created_at", longestActivityCutoff()),
      getAnnouncementsForUser(userId),
    ]);

    if (!support.error) {
      setMessageUnread(
        (support.conversations || []).reduce(
          (total: number, row: any) => total + Number(row.unread_count || 0),
          0,
        ),
      );
    }

    const currentEvents = (events.data || []).filter(
      (row) =>
        !isTransientActivityEvent(row) &&
        !isOrdinaryMessageEvent(row) &&
        activityIsCurrent({ ...row, source: "event" }),
    );
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

    if (!events.error || !announcements.error) {
      const unreadEvents = currentEvents.filter((row) => !row.read);
      const unreadAnnouncements = currentAnnouncements.filter(
        (delivery: any) => !delivery.read_status,
      );
      setActivityUnread(unreadEvents.length + unreadAnnouncements.length);

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

  useEffect(() => {
    if (!userId) return;
    void refresh();
    const channel = supabase
      .channel(`operations-inbox-summary:${activityScope}:${userId}`)
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
  }, [activityScope, queue, refresh, userId]);

  return {
    messageUnread,
    activityUnread,
    totalUnread: messageUnread + activityUnread,
    latestActivity,
    refresh,
  };
}
