import { useCallback, useEffect, useMemo, useState } from "react";
import Notifications from "@/pages/Notifications";
import type { Profile } from "@/types";
import { supabase } from "@/lib/supabase";
import {
  getMyHotelConversations,
  type HotelConversation,
} from "@/lib/supabase/hotel-chat";
import {
  conversationPresentation,
  getMySupportConversations,
  type SupportThread,
} from "@/lib/supabase/support";
import HotelBookingChat from "@/components/HotelBookingChat";
import { ListingMediaImage } from "@/components/ListingCandidateMedia";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string) => void;
  chatUnread?: number;
  activityUnread?: number;
};

type InboxView = "activity" | "messages";
type InboxItem =
  | { kind: "hotel"; id: string; time: string; thread: HotelConversation }
  | { kind: "support"; id: string; time: string; thread: SupportThread };

export default function CommunicationInbox({
  profile,
  onNavigate = () => {},
  chatUnread = 0,
  activityUnread = 0,
}: Props) {
  const [view, setView] = useState<InboxView>(chatUnread > 0 ? "messages" : "activity");
  const [query, setQuery] = useState("");
  const [hotelChats, setHotelChats] = useState<HotelConversation[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [activeHotel, setActiveHotel] = useState<HotelConversation | null>(null);

  const loadMessages = useCallback(async () => {
    const [hotelResult, supportResult] = await Promise.all([
      getMyHotelConversations(),
      getMySupportConversations(),
    ]);
    if (!hotelResult.error) setHotelChats(hotelResult.conversations);
    if (!supportResult.error) setSupportThreads(supportResult.conversations || []);
  }, []);

  useEffect(() => {
    void loadMessages();
    const channel = supabase
      .channel(`partner-inbox:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hotel_booking_messages" },
        () => void loadMessages(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        () => void loadMessages(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_conversations" },
        () => void loadMessages(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMessages, profile.user_id]);

  const items = useMemo<InboxItem[]>(
    () => [
      ...hotelChats.map((thread) => ({
        kind: "hotel" as const,
        id: `hotel:${thread.conversation_id}`,
        time: thread.last_message_time || thread.updated_at,
        thread,
      })),
      ...supportThreads.map((thread) => ({
        kind: "support" as const,
        id: `support:${thread.conversation_id}`,
        time: thread.last_message_time || thread.created_at,
        thread,
      })),
    ]
      .filter((item) => {
        const value = query.trim().toLowerCase();
        if (!value) return true;
        const text = item.kind === "hotel"
          ? [item.thread.guest_name, item.thread.hotel_name, item.thread.room_name, item.thread.last_message]
          : (() => {
              const presentation = conversationPresentation(item.thread, "operations");
              return [presentation.title, presentation.meta, item.thread.last_message];
            })();
        return text.filter(Boolean).join(" ").toLowerCase().includes(value);
      })
      .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()),
    [hotelChats, query, supportThreads],
  );

  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (["conversation", "conversations", "message", "messages", "chat"].includes(route)) {
      const hotel = hotelChats.find(
        (thread) => String(thread.conversation_id) === String(id || "") || String(thread.booking_id) === String(id || ""),
      );
      if (hotel) {
        setView("messages");
        setActiveHotel(hotel);
        return;
      }
    }
    onNavigate(page, id);
  }

  function openSupport(thread: SupportThread) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          conversationId: thread.conversation_id,
          contextType: thread.context_type,
          contextId: thread.context_id,
        },
      }),
    );
  }

  if (activeHotel) {
    return (
      <HotelBookingChat
        bookingId={activeHotel.booking_id}
        conversationId={activeHotel.conversation_id}
        profile={profile}
        title={activeHotel.guest_name || "Guest"}
        subtitle={stayContext(activeHotel)}
        readOnly={!['confirmed','checked_in'].includes(activeHotel.booking_status)}
        onClose={() => setActiveHotel(null)}
        onUpdated={loadMessages}
      />
    );
  }

  return (
    <div className="min-h-[65dvh]">
      <nav className="sticky top-0 z-10 -mx-1 mb-5 flex border-b border-white/[.07] bg-[#0A0A0F]/95 px-1 backdrop-blur-xl" aria-label="Inbox sections">
        <InboxSwitch
          label="Activity"
          active={view === "activity"}
          count={activityUnread}
          onClick={() => setView("activity")}
        />
        <InboxSwitch
          label="Messages"
          active={view === "messages"}
          count={chatUnread}
          onClick={() => setView("messages")}
        />
      </nav>

      {view === "activity" ? (
        <section>
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Activity</h2>
            <p className="mt-1 text-[9px] text-[#6F7586]">Property, booking, payment and account updates that affect your work.</p>
          </div>
          <Notifications
            profile={profile}
            scope="partner"
            embedded
            onNavigate={openActivityDestination}
          />
        </section>
      ) : (
        <section>
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Messages</h2>
            <p className="mt-1 text-[9px] text-[#6F7586]">Guest stays and WeHouse operational conversations.</p>
          </div>
          <label className="flex h-11 items-center gap-3 border-b border-white/[.08] px-1 focus-within:border-violet-500/45">
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages"
              className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[#626879]"
            />
          </label>
          {!items.length ? (
            <div className="border-b border-dashed border-white/[.07] py-12 text-center">
              <p className="text-xs font-semibold">{query.trim() ? "No matching messages" : "No messages yet"}</p>
              <p className="mt-2 text-[9px] text-[#666C7C]">Guest stay and WeHouse conversations will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[.055] border-b border-white/[.06]">
              {items.map((item) =>
                item.kind === "hotel" ? (
                  <HotelRow key={item.id} thread={item.thread} onOpen={() => setActiveHotel(item.thread)} />
                ) : (
                  <SupportRow key={item.id} thread={item.thread} onOpen={() => openSupport(item.thread)} />
                ),
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function InboxSwitch({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`relative min-h-12 flex-1 text-xs font-semibold ${active ? "text-white" : "text-[#747A8B]"}`}>
      <span>{label}</span>
      {count > 0 ? <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] text-white">{count > 99 ? "99+" : count}</span> : null}
      {active ? <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-violet-400" /> : null}
    </button>
  );
}

function HotelRow({ thread, onOpen }: { thread: HotelConversation; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left active:bg-white/[.025]">
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-white/[.08] bg-[#171A22]">
        {thread.hotel_image ? <ListingMediaImage reference={thread.hotel_image} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center font-bold text-violet-200">H</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{thread.guest_name || "Guest"}</p><span className="text-[7px] font-semibold text-amber-200">GUEST</span></div>
        <p className={`mt-1 truncate text-[10px] ${thread.unread_count ? "text-white" : "text-[#777C8D]"}`}>{thread.last_message || "Stay conversation"}</p>
        <p className="mt-0.5 truncate text-[8px] text-[#5F6474]">{stayContext(thread)}</p>
      </div>
      {thread.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}
    </button>
  );
}

function SupportRow({ thread, onOpen }: { thread: SupportThread; onOpen: () => void }) {
  const presentation = conversationPresentation(thread, "operations");
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left active:bg-white/[.025]">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/12 text-[11px] font-bold text-violet-300">W</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{presentation.title}</p><span className="text-[7px] font-semibold text-violet-300">WEHOUSE</span></div>
        <p className={`mt-1 truncate text-[10px] ${thread.unread_count ? "text-white" : "text-[#777C8D]"}`}>{thread.last_message || presentation.operator}</p>
        <p className="mt-0.5 truncate text-[8px] text-[#5F6474]">{presentation.meta || "Property and account support"}</p>
      </div>
      {thread.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}
    </button>
  );
}

function stayContext(thread: HotelConversation) {
  const dates = [formatDate(thread.check_in), formatDate(thread.check_out)].filter(Boolean).join(" – ");
  return [thread.hotel_name, thread.room_name, dates].filter(Boolean).join(" · ");
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[#747A8B]"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
