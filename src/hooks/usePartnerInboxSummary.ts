import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getMySupportConversations } from "@/lib/supabase/support";
import { getMyHotelConversations } from "@/lib/supabase/hotel-chat";
import { getAnnouncementsForUser } from "@/lib/supabase/announcements";
import { activityIsCurrent, currentActivityRows, longestActivityCutoff } from "@/lib/activityFeed";

export function usePartnerInboxSummary(userId: string) {
  const [chatUnread, setChatUnread] = useState(0);
  const [activityUnread, setActivityUnread] = useState(0);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const [wehouse, hotels, events, announcements] = await Promise.all([
      getMySupportConversations(),
      getMyHotelConversations(),
      supabase.from("notifications").select("type,title,message,source_type,destination_route,created_at,read").eq("recipient_id", userId).eq("workspace_scope", "partner").eq("read", false).gte("created_at", longestActivityCutoff()),
      getAnnouncementsForUser(userId),
    ]);
    const wehouseUnread = wehouse.error ? 0 : (wehouse.conversations || []).filter((row) => Number(row.unread_count || 0) > 0).length;
    const hotelUnread = hotels.error ? 0 : hotels.conversations.filter((row) => Number(row.unread_count || 0) > 0).length;
    setChatUnread(wehouseUnread + hotelUnread);
    const eventUnread = currentActivityRows(
      (events.data || []).map((row) => ({ ...row, source: "event" as const })),
    ).length;
    const announcementUnread = (announcements.messages || []).filter((delivery: any) => {
      const announcement = Array.isArray(delivery.announcements) ? delivery.announcements[0] : delivery.announcement || delivery.message;
      return !delivery.read_status && activityIsCurrent({ type: "announcement", source: "announcement", created_at: announcement?.created_at || delivery.delivered_at });
    }).length;
    if (!events.error || !announcements.error) setActivityUnread(eventUnread + announcementUnread);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase.channel(`partner-inbox-summary:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_messages" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_recipients", filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return { chatUnread, activityUnread, totalUnread: chatUnread + activityUnread, refresh };
}
