import { useInboxRefresh } from "./useInboxRefresh";
import { useActorInboxCounts } from "./useActorInboxCounts";
import { withTimeout } from "@/lib/withTimeout";
import { useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getMySupportConversations } from "@/lib/supabase/support";
import { getMyHotelConversations } from "@/lib/supabase/hotel-chat";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { activityIsCurrent, visibleUnreadActivityCount } from "@/lib/activityFeed";
import {
  getCanonicalActivity,
  subscribeToCanonicalActivity,
} from "@/lib/supabase/activity";

export function usePartnerInboxSummary(userId: string) {
  const { chatUnread, activityUnread, updateCounts } = useActorInboxCounts(userId);
  const load = useCallback(async (isCurrent: () => boolean) => {
    if (!userId) return;
    const [wehouse, hotels, events, announcements] = await withTimeout(Promise.all([
      getMySupportConversations("property_partner"),
      getMyHotelConversations("property_partner"),
      getCanonicalActivity("partner", 100),
      getAnnouncementsForUser(userId, "partner"),
    ]), 15000, "Inbox summary took too long to load.");
    if (!isCurrent()) return;
    const wehouseUnread = wehouse.error ? 0 : (wehouse.conversations || []).reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
    const hotelUnread = hotels.error ? 0 : hotels.conversations.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
    if (!wehouse.error && !hotels.error) updateCounts({ chatUnread: wehouseUnread + hotelUnread });
    const eventUnread = events.error ? 0 : visibleUnreadActivityCount(events.rows, "partner");
    const announcementUnread = (announcements.messages || []).filter((delivery: any) => {
      const announcement = Array.isArray(delivery.announcements) ? delivery.announcements[0] : delivery.announcement || delivery.message;
      return !delivery.read_status && activityIsCurrent({ type: "announcement", source: "announcement", created_at: announcement?.created_at || delivery.delivered_at });
    }).length;
    // Never replace a complete Activity count with a partial result. The feed
    // reports its load error and this badge keeps the last known complete value.
    if (!events.error && !announcements.error) updateCounts({ activityUnread: eventUnread + announcementUnread });
  }, [userId, updateCounts]);

  const refresh = useInboxRefresh(load, Boolean(userId));

  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToCanonicalActivity(
      userId,
      `partner-inbox-summary:${userId}`,
      () => void refresh(),
    )
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_messages" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_recipients", filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return { chatUnread, activityUnread, totalUnread: chatUnread + activityUnread, refresh };
}
