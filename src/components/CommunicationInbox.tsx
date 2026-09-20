import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Notifications from "@/pages/Notifications";
import type { Profile } from "@/types";
import { supabase } from "@/lib/supabase";
import { getMyHotelConversations, type HotelConversation } from "@/lib/supabase/hotel-chat";
import { conversationPresentation, getMySupportConversations, type SupportThread } from "@/lib/supabase/support";
import HotelBookingChat from "@/components/HotelBookingChat";
import { withTimeout } from "@/lib/withTimeout";
import InboxActivityEntry from "@/components/InboxActivityEntry";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string) => void;
  chatUnread?: number;
  activityUnread?: number;
};
type InboxItem =
  | { kind: "hotel"; id: string; time: string; thread: HotelConversation }
  | { kind: "support"; id: string; time: string; thread: SupportThread };

export default function CommunicationInbox({ profile, onNavigate = () => {}, chatUnread = 0, activityUnread = 0 }: Props) {
  const [showActivity, setShowActivity] = useState(false);
  const [query, setQuery] = useState("");
  const [hotelChats, setHotelChats] = useState<HotelConversation[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const generation = useRef(0);
  const [filter, setFilter] = useState<"all" | "hotel" | "support">("all");
  const [activeHotel, setActiveHotel] = useState<HotelConversation | null>(null);

  const loadMessages = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [hotelResult, supportResult] = await withTimeout(Promise.all([getMyHotelConversations("property_partner"), getMySupportConversations("property_partner")]), 15000, "Inbox took too long");
      if (request !== generation.current) return;
      if (!hotelResult.error) setHotelChats(hotelResult.conversations);
      if (!supportResult.error) setSupportThreads(supportResult.conversations || []);
      setLoadError(Boolean(hotelResult.error || supportResult.error));
    } catch { if (request === generation.current) setLoadError(true); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void loadMessages();
    const channel = supabase
      .channel(`partner-inbox:${profile.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void loadMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_messages" }, () => void loadMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_conversations" }, () => void loadMessages())
      .subscribe();
    return () => { generation.current++; void supabase.removeChannel(channel); };
  }, [loadMessages, profile.user_id]);

  const items = useMemo<InboxItem[]>(() => [
    ...hotelChats.map((thread) => ({ kind: "hotel" as const, id: `hotel:${thread.conversation_id}`, time: thread.last_message_time || thread.updated_at, thread })),
    ...supportThreads.map((thread) => ({ kind: "support" as const, id: `support:${thread.conversation_id}`, time: thread.last_message_time || thread.created_at, thread })),
  ].filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false;
    const value = query.trim().toLowerCase();
    if (!value) return true;
    const source = item.kind === "hotel"
      ? [item.thread.guest_name, item.thread.hotel_name, item.thread.room_name, item.thread.last_message]
      : (() => { const presentation = conversationPresentation(item.thread, "operations"); return [presentation.title, presentation.meta, item.thread.last_message]; })();
    return source.filter(Boolean).join(" ").toLowerCase().includes(value);
  }).sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()), [filter, hotelChats, query, supportThreads]);

  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (["conversation", "conversations", "message", "messages", "chat"].includes(route)) {
      const hotel = hotelChats.find((thread) => String(thread.conversation_id) === String(id || "") || String(thread.booking_id) === String(id || ""));
      if (hotel) { setShowActivity(false); setActiveHotel(hotel); return; }
    }
    onNavigate(page, id);
  }

  function openSupport(thread: SupportThread) {
    window.dispatchEvent(new CustomEvent("openSupportChat", { detail: { conversationId: thread.conversation_id, contextType: thread.context_type, contextId: thread.context_id } }));
  }

  if (activeHotel) {
    return <HotelBookingChat bookingId={activeHotel.booking_id} conversationId={activeHotel.conversation_id} profile={profile} title={activeHotel.guest_name || "Guest"} subtitle={stayContext(activeHotel)} readOnly={!['confirmed','checked_in'].includes(activeHotel.booking_status)} onClose={() => setActiveHotel(null)} onUpdated={loadMessages} />;
  }

  if (showActivity) {
    return (
      <div className="min-h-[65dvh]">
        <header className="mb-4 flex items-center gap-3 border-b border-white/[.06] pb-3">
          <button type="button" onClick={() => setShowActivity(false)} aria-label="Back to Inbox" className="grid h-9 w-9 place-items-center rounded-full text-[#A1A6B5] active:bg-white/[.05]">←</button>
          <div><h2 className="text-sm font-semibold">Activity</h2><p className="mt-1 text-[9px] text-[#6F7586]">Property, booking, payment and account updates.</p></div>
        </header>
        <Notifications profile={profile} scope="partner" embedded onNavigate={openActivityDestination} />
      </div>
    );
  }

  return (
    <div className="min-h-[65dvh]">
      <InboxActivityEntry unread={activityUnread} detail="Property, booking, payment and official updates" onOpen={() => setShowActivity(true)} />
      <section className="pt-1">
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold">Messages</h2></div>
          {chatUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{chatUnread > 99 ? "99+" : chatUnread} new</span> : null}
        </div>
        <label className="flex h-11 items-center gap-3 border-b border-white/[.08] px-1 focus-within:border-violet-500/45">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[#626879]" />
        </label>
        <div className="flex gap-4 border-b border-white/[.06]">{([['all', 'All'], ['hotel', 'Guests'], ['support', 'WeHouse']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-11 border-b-2 text-xs font-semibold ${filter === value ? 'border-violet-400 text-violet-300' : 'border-transparent text-[#8B91A0]'}`}>{label}</button>)}</div>
        {loadError && <div role="alert" className="py-3 text-xs text-amber-200">Some conversations could not be loaded. <button className="min-h-11 px-2 font-semibold text-violet-300" onClick={() => void loadMessages()}>Try again</button></div>}
        {loading ? <p role="status" className="py-6 text-sm text-[#A1A1AA]">Loading your conversations…</p> : !items.length && !loadError ? (
          <div className="border-b border-dashed border-white/[.07] py-12 text-center"><p className="text-xs font-semibold">{query.trim() ? "No matching messages" : "No messages yet"}</p><p className="mt-2 text-[9px] text-[#666C7C]">Guest stay and WeHouse conversations will appear here.</p></div>
        ) : (
          <div className="divide-y divide-white/[.055] border-b border-white/[.06]">
            {items.map((item) => item.kind === "hotel" ? <HotelRow key={item.id} thread={item.thread} onOpen={() => setActiveHotel(item.thread)} /> : <SupportRow key={item.id} thread={item.thread} onOpen={() => openSupport(item.thread)} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function HotelRow({ thread, onOpen }: { thread: HotelConversation; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left active:bg-white/[.025]">
    <div aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-white/[.08] bg-[#171A22] font-semibold text-violet-200">{(thread.guest_name || 'G')[0].toUpperCase()}</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{thread.guest_name || "Guest"}</p><span className="text-[7px] font-semibold text-amber-200">GUEST</span></div><p className={`mt-1 truncate text-[10px] ${thread.unread_count ? "text-white" : "text-[#777C8D]"}`}>{thread.last_message || "Stay conversation"}</p><p className="mt-0.5 truncate text-[8px] text-[#5F6474]">{stayContext(thread)}</p></div>
    {thread.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}
  </button>;
}

function SupportRow({ thread, onOpen }: { thread: SupportThread; onOpen: () => void }) {
  const presentation = conversationPresentation(thread, "operations");
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left active:bg-white/[.025]">
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/12 text-[11px] font-bold text-violet-300">W</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{presentation.title}</p><span className="text-[7px] font-semibold text-violet-300">WEHOUSE</span></div><p className={`mt-1 truncate text-[10px] ${thread.unread_count ? "text-white" : "text-[#777C8D]"}`}>{thread.last_message || presentation.operator}</p><p className="mt-0.5 truncate text-[8px] text-[#5F6474]">{presentation.meta || "Property and account support"}</p></div>
    {thread.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}
  </button>;
}

function stayContext(thread: HotelConversation) {
  const dates = [formatDate(thread.check_in), formatDate(thread.check_out)].filter(Boolean).join(" – ");
  return [thread.hotel_name, thread.room_name, dates].filter(Boolean).join(" · ");
}
function formatDate(value?: string | null) {
  if (!value) return ""; const date = new Date(`${value}T12:00:00`); if (Number.isNaN(date.getTime())) return value; return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[#747A8B]"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
