import { useCallback, useEffect, useState } from "react";
import SupportEntryCard from "@/components/SupportEntryCard";
import Notifications from "@/pages/Notifications";
import InboxTabs from "@/components/InboxTabs";
import type { Profile } from "@/types";
import { supabase } from "@/lib/supabase";
import { getMyHotelConversations, type HotelConversation } from "@/lib/supabase/hotel-chat";
import HotelBookingChat from "@/components/HotelBookingChat";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string) => void;
  chatUnread?: number;
  activityUnread?: number;
};

export default function CommunicationInbox({
  profile,
  onNavigate = () => {},
  chatUnread = 0,
  activityUnread = 0,
}: Props) {
  const [view, setView] = useState<"chats" | "activity">("chats");
  const [hotelChats, setHotelChats] = useState<HotelConversation[]>([]);
  const [activeHotel, setActiveHotel] = useState<HotelConversation | null>(null);
  const loadHotels = useCallback(async () => {
    const result = await getMyHotelConversations();
    if (!result.error) setHotelChats(result.conversations);
  }, []);
  useEffect(() => {
    void loadHotels();
    const channel = supabase.channel(`partner-hotel-inbox:${profile.user_id}`).on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void loadHotels()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadHotels, profile.user_id]);
  if (activeHotel) return <HotelBookingChat bookingId={activeHotel.booking_id} conversationId={activeHotel.conversation_id} profile={profile} title={activeHotel.guest_name || "Guest"} subtitle={`${activeHotel.hotel_name} · ${activeHotel.booking_code || "Paid stay"}`} onClose={() => setActiveHotel(null)} onUpdated={loadHotels} />;
  return (
    <div className="space-y-4">
      <InboxTabs value={view} onChange={setView} chatCount={chatUnread} activityCount={activityUnread} />
      {view === "activity" ? (
        <Notifications
          profile={profile}
          scope="property_partner"
          embedded
          onNavigate={onNavigate}
        />
      ) : (
        <div className="space-y-3">
          {hotelChats.length > 0 && <section className="overflow-hidden border-y border-white/[.06]">{hotelChats.map((thread, index) => <div key={thread.conversation_id} className={index ? "border-t border-white/[.05]" : ""}><button type="button" onClick={() => setActiveHotel(thread)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-500/10 font-bold text-amber-200">H</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{thread.guest_name || "Guest"}</p><span className="text-[7px] font-semibold text-amber-200">HOTEL</span></div><p className={`mt-1 truncate text-[11px] ${thread.unread_count ? "text-white" : "text-[#777C8D]"}`}>{thread.last_message || "Paid stay conversation"}</p><p className="mt-0.5 truncate text-[9px] text-[#5F6474]">{thread.hotel_name} · {thread.booking_code}</p></div>{thread.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}</button></div>)}</section>}
          <section className="overflow-hidden border-y border-white/[.06]">
            <SupportEntryCard profile={profile} compact />
          </section>
          <p className="px-1 text-[9px] leading-relaxed text-[#555A69]">
            Guest–hotel chats and contextual conversations with WeHouse stay
            together here. Official updates appear in Activity.
          </p>
        </div>
      )}
    </div>
  );
}
