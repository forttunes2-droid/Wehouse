import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import type { ActivityDestination } from "@/lib/activityFeed";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Notifications from "@/pages/Notifications";
import type { Profile } from "@/types";
import { supabase } from "@/lib/supabase";
import { getMyHotelConversations, type HotelConversation } from "@/lib/supabase/hotel-chat";
import { conversationPresentation, getMySupportConversations, type SupportThread } from "@/lib/supabase/support";
import HotelBookingChat from "@/components/HotelBookingChat";
import { withTimeout } from "@/lib/withTimeout";
import InboxActivityEntry from "@/components/InboxActivityEntry";
import ActivityHeader from "@/components/ActivityHeader";
import PropertyHostBookingChat from "@/components/PropertyHostBookingChat";
import { getMyPropertyHostConversations, type PropertyHostConversation } from "@/lib/supabase/property-host-chat";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string, destination?: ActivityDestination) => void;
  initialActivity?: boolean;
  chatUnread?: number;
  activityUnread?: number;
  hostingOnly?: boolean;
};
type InboxItem =
  | { kind: "hotel"; id: string; time: string; thread: HotelConversation }
  | { kind: "host"; id: string; time: string; thread: PropertyHostConversation }
  | { kind: "support"; id: string; time: string; thread: SupportThread };

export default function CommunicationInbox({ profile, onNavigate = () => {}, chatUnread = 0, activityUnread = 0, initialActivity = false, hostingOnly = false }: Props) {
  const [showActivity, setShowActivity] = useState(initialActivity);
  const closeActivity = useRecordScreenBack(() => setShowActivity(false), showActivity);
  const [query, setQuery] = useState("");
  const [hotelChats, setHotelChats] = useState<HotelConversation[]>([]);
  const [hostChats, setHostChats] = useState<PropertyHostConversation[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const generation = useRef(0);
  const [filter, setFilter] = useState<"all" | "hotel" | "host" | "support">("all");
  const [activeHotel, setActiveHotel] = useState<HotelConversation | null>(null);
  const [activeHost, setActiveHost] = useState<PropertyHostConversation | null>(null);

  const loadMessages = useCallback(async () => {
    const request = ++generation.current;
    let completed = 0;
    setLoading(true);
    setLoadError(false);

    const updateResult = (kind: "hotel" | "host" | "support", result: any) => {
      if (request !== generation.current) return;
      if (kind === "hotel" && !result.error) setHotelChats(result.conversations || []);
      if (kind === "host" && !result.error) setHostChats(result.conversations || []);
      if (kind === "support" && !result.error) setSupportThreads(result.conversations || []);
      if (result.error) setLoadError(true);
      completed += 1;
      if (completed === 1 && request === generation.current) setLoading(false);
    };

    const requests: Array<["hotel" | "host" | "support", Promise<any>]> = hostingOnly
      ? [
          ["host", getMyPropertyHostConversations()] as const,
        ]
      : [
          ["hotel", getMyHotelConversations("property_partner")] as const,
          ["host", getMyPropertyHostConversations()] as const,
          ["support", getMySupportConversations("property_partner")] as const,
        ];

    await Promise.all(requests.map(async ([kind, requestPromise]) => {
      try {
        const result = await withTimeout(requestPromise, 8000, "Inbox source took too long");
        updateResult(kind, result);
      } catch {
        if (request === generation.current) setLoadError(true);
      }
    }));

    if (request === generation.current) setLoading(false);
  }, [hostingOnly]);

  useEffect(() => {
    void loadMessages();
    const refresh = () => void loadMessages();
    window.addEventListener("wehouse:unread-changed", refresh);
    const channel = supabase
      .channel(`partner-inbox:${profile.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void loadMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "property_host_messages" }, () => void loadMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_messages" }, () => void loadMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_conversations" }, () => void loadMessages())
      .subscribe();
    return () => { generation.current++; window.removeEventListener("wehouse:unread-changed", refresh); void supabase.removeChannel(channel); };
  }, [loadMessages, profile.user_id]);

  const safeUnreadCount = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

const items = useMemo<InboxItem[]>(() => [
    ...hotelChats.map((thread) => ({ kind: "hotel" as const, id: `hotel:${thread.conversation_id}`, time: thread.last_message_time || thread.updated_at, thread: { ...thread, unread_count: safeUnreadCount(thread.unread_count) } })),
    ...hostChats.map((thread) => ({ kind: "host" as const, id: `host:${thread.conversation_id}`, time: thread.last_message_time || thread.updated_at, thread: { ...thread, unread_count: safeUnreadCount(thread.unread_count) } })),
    ...supportThreads.map((thread) => ({ kind: "support" as const, id: `support:${thread.conversation_id}`, time: thread.last_message_time || thread.created_at, thread: { ...thread, unread_count: safeUnreadCount(thread.unread_count) } })),
  ].filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false;
    const value = query.trim().toLowerCase();
    if (!value) return true;
    const source = item.kind === "hotel"
      ? [item.thread.guest_name, item.thread.hotel_name, item.thread.room_name, item.thread.last_message]
      : item.kind === "host"
        ? [item.thread.other_person_name,item.thread.listing_title,item.thread.last_message]
        : (() => { const presentation = conversationPresentation(item.thread, "customer"); return [presentation.title, presentation.meta, item.thread.last_message]; })();
    return source.filter(Boolean).join(" ").toLowerCase().includes(value);
  }).sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()), [filter, hotelChats, query, supportThreads]);

  function openActivityDestination(page: string, id?: string, destination?: ActivityDestination) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (["conversation", "conversations", "message", "messages", "chat"].includes(route)) {
      const hotel = hotelChats.find((thread) => String(thread.conversation_id) === String(id || ""));
      if (hotel) { setHotelChats((current) => current.map((thread) => String(thread.conversation_id) === String(hotel.conversation_id) ? { ...thread, unread_count: 0 } : thread)); setActiveHotel(hotel); return; }
    }
    onNavigate(page, id, destination);
  }

  function openSupport(thread: SupportThread) {
    setSupportThreads((current) => current.map((item) => String(item.conversation_id) === String(thread.conversation_id) ? { ...item, unread_count: 0 } : item));
    window.dispatchEvent(new CustomEvent("openSupportChat", { detail: { conversationId: thread.conversation_id, contextType: thread.context_type, contextId: thread.context_id } }));
  }

  if (activeHost) {
    return <PropertyHostBookingChat conversation={activeHost} profile={profile} onClose={() => { setActiveHost(null); void loadMessages(); }} onUpdated={loadMessages} />;
  }

  if (activeHotel) {
    return <HotelBookingChat bookingId={activeHotel.booking_id} conversationId={activeHotel.conversation_id} profile={profile} title={activeHotel.guest_name || "Guest"} subtitle={stayContext(activeHotel)} readOnly={!['confirmed','checked_in'].includes(activeHotel.booking_status)} onClose={() => { setActiveHotel(null); void loadMessages(); }} onUpdated={loadMessages} />;
  }

  if (showActivity && !hostingOnly) {
    return (
      <div className="min-h-[65dvh]">
        <ActivityHeader onBack={closeActivity} />
        <Notifications profile={profile} scope="partner" embedded onNavigate={openActivityDestination} />
      </div>
    );
  }

  return (
    <div className="min-h-[65dvh]">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-5 lg:px-8">
      {!hostingOnly ? <InboxActivityEntry unread={activityUnread} detail="Property, booking, payment and official updates" onOpen={() => setShowActivity(true)} /> : null}
      <section className="pt-1">
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold">Messages</h2></div>
          {chatUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{chatUnread > 99 ? "99+" : chatUnread} new</span> : null}
        </div>
        <label className="flex h-11 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-1 focus-within:border-violet-500/45">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--wh-text-muted)]" />
        </label>
        {!hostingOnly ? <div className="flex gap-4 border-b border-[var(--wh-border-subtle)]">{([['all', 'All'], ['hotel', 'Hotel guests'], ['host', 'Home guests'], ['support', 'WeHouse']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-11 border-b-2 text-xs font-semibold ${filter === value ? 'border-violet-400 text-violet-300' : 'border-transparent text-[var(--wh-text-secondary)]'}`}>{label}</button>)}</div> : null}
        {loadError && <div role="alert" className="py-3 text-xs text-amber-200">Some conversations could not be loaded. <button className="min-h-11 px-2 font-semibold text-violet-300" onClick={() => void loadMessages()}>Try again</button></div>}
        {loading ? <div role="status" aria-label="Loading conversations" aria-busy="true" className="divide-y divide-[var(--wh-border-subtle)] border-b border-[var(--wh-border-subtle)]">{[0,1,2].map((item) => <div key={item} className="flex items-center gap-3 py-4"><span className="wh-skeleton h-10 w-10 shrink-0 rounded-full" /><span className="min-w-0 flex-1 space-y-2"><span className="wh-skeleton block h-3 w-2/5 rounded" /><span className="wh-skeleton block h-2.5 w-4/5 rounded" /><span className="wh-skeleton block h-2 w-1/3 rounded" /></span></div>)}</div> : !items.length && !loadError ? (
          <div className="border-b border-dashed border-[var(--wh-border-subtle)] py-12 text-center"><p className="text-xs font-semibold">{query.trim() ? "No matching messages" : "No messages yet"}</p><p className="mt-2 text-[9px] text-[var(--wh-text-muted)]">{hostingOnly ? "Guest conversations appear here when you are assigned to a Host-managed booking." : "Guest stay and WeHouse conversations will appear here."}</p></div>
        ) : (
          <div className="divide-y divide-[var(--wh-border-subtle)] border-b border-[var(--wh-border-subtle)]">
            {items.map((item) => item.kind === "hotel"
  ? <HotelRow key={item.id} thread={item.thread} onOpen={() => { setHotelChats((current) => current.map((thread) => String(thread.conversation_id) === String(item.thread.conversation_id) ? { ...thread, unread_count: 0 } : thread)); setActiveHotel(item.thread); }} />
  : item.kind === "host"
    ? <HostRow key={item.id} thread={item.thread} onOpen={() => { setHostChats((current) => current.map((thread) => String(thread.conversation_id) === String(item.thread.conversation_id) ? { ...thread, unread_count: 0 } : thread)); setActiveHost(item.thread); }} />
    : <SupportRow key={item.id} thread={item.thread} onOpen={() => openSupport(item.thread)} />)}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function HotelRow({ thread, onOpen }: { thread: HotelConversation; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left active:bg-[var(--wh-interactive)]">
    <div aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] font-semibold text-violet-200">{(thread.guest_name || 'G')[0].toUpperCase()}</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{thread.guest_name || "Guest"}</p><span className="text-[7px] font-semibold text-amber-200">GUEST</span></div><p className={`mt-1 truncate text-[10px] ${thread.unread_count ? "text-white" : "text-[var(--wh-text-muted)]"}`}>{thread.last_message || "Stay conversation"}</p><p className="mt-0.5 truncate text-[8px] text-[var(--wh-text-muted)]">{stayContext(thread)}</p></div>
    {thread.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}
  </button>;
}

function HostRow({ thread, onOpen }: { thread: PropertyHostConversation; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left active:bg-[var(--wh-interactive)]">
    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/12 text-[11px] font-bold text-violet-200">{thread.other_person_avatar?<img src={thread.other_person_avatar} alt="" className="h-full w-full object-cover"/>:(thread.other_person_name||"G")[0].toUpperCase()}</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{thread.other_person_name || "Guest"}</p><span className="text-[7px] font-semibold text-violet-300">HOME GUEST</span></div><p className={`mt-1 truncate text-[10px] ${thread.unread_count?"text-white":"text-[var(--wh-text-muted)]"}`}>{thread.last_message || "Booking conversation"}</p><p className="mt-0.5 truncate text-[8px] text-[var(--wh-text-muted)]">{thread.listing_title} · {thread.stay_type==="short_let"?"Short Let":"Long Let"}</p></div>
    {thread.unread_count>0&&<span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{thread.unread_count}</span>}
  </button>;
}

function SupportRow({ thread, onOpen }: { thread: SupportThread; onOpen: () => void }) {
  const presentation = conversationPresentation(thread, "customer");
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left active:bg-[var(--wh-interactive)]">
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/12 text-[11px] font-bold text-violet-300">W</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{presentation.title}</p><span className="text-[7px] font-semibold text-violet-300">WEHOUSE</span></div><p className={`mt-1 truncate text-[10px] ${thread.unread_count ? "text-white" : "text-[var(--wh-text-muted)]"}`}>{thread.last_message || presentation.operator}</p><p className="mt-0.5 truncate text-[8px] text-[var(--wh-text-muted)]">{presentation.meta || "Property and account support"}</p></div>
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
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[var(--wh-text-muted)]"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
