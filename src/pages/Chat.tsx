import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getConversations,
  getRoommateConversationPeople,
} from "@/lib/supabase/chat";
import {
  getCommunicationBookingConversations,
} from "@/lib/supabase/worker-bookings";
import {
  conversationPresentation,
  getMySupportConversations,
  type SupportThread,
} from "@/lib/supabase/support";
import {
  getMyHotelConversations,
  type HotelConversation,
} from "@/lib/supabase/hotel-chat";
import type { Conversation, Profile } from "@/types";
import ChatCore from "@/pages/ChatCore";

type Props = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  conversationId?: string | null;
  peerUserId?: string | null;
  onConversationClose?: () => void;
  chatUnreadCount?: number;
  activityUnreadCount?: number;
  onActivityUnreadChange?: (count: number) => void;
};

type BookingConversation = {
  conversation_id: string;
  booking_id: string;
  booking_status: string;
  service_type: string;
  other_person_name: string;
  other_person_avatar: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number;
  updated_at: string;
};

type Person = {
  name?: string | null;
  avatar?: string | null;
  username?: string | null;
};

type Thread =
  | { kind: "roommate"; id: string; time: string; row: Conversation }
  | { kind: "worker"; id: string; time: string; row: BookingConversation }
  | { kind: "hotel"; id: string; time: string; row: HotelConversation }
  | { kind: "support"; id: string; time: string; row: SupportThread };

type ActiveTarget = { conversationId: string; peerUserId?: string | null } | null;

export default function Chat({
  profile,
  onNavigate,
  conversationId,
  peerUserId,
  onConversationClose,
  activityUnreadCount = 0,
}: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bookingConversations, setBookingConversations] = useState<BookingConversation[]>([]);
  const [hotelConversations, setHotelConversations] = useState<HotelConversation[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [loading, setLoading] = useState(!conversationId);
  const [query, setQuery] = useState("");
  const [activeTarget, setActiveTarget] = useState<ActiveTarget>(null);

  const otherId = useCallback(
    (row: Conversation) =>
      row.participant_a === profile.user_id ? row.participant_b : row.participant_a,
    [profile.user_id],
  );

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [roommateResult, peopleResult, bookingResult, hotelResult, supportResult] = await Promise.all([
      getConversations(profile.user_id),
      getRoommateConversationPeople(),
      getCommunicationBookingConversations(profile.user_id),
      getMyHotelConversations(),
      getMySupportConversations(),
    ]);
    setConversations((roommateResult.conversations || []).filter((row) => row.conversation_type === "roommate"));
    setPeople(peopleResult.people || {});
    setBookingConversations((bookingResult.conversations || []) as BookingConversation[]);
    setHotelConversations(hotelResult.conversations || []);
    setSupportThreads(supportResult.conversations || []);
    if (!quiet) setLoading(false);
  }, [profile.user_id]);

  useEffect(() => {
    if (conversationId || activeTarget) return;
    void load();
    const channel = supabase
      .channel(`inbox-list:${profile.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_messages" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_support_messages" }, () => void load(true))
      .subscribe();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [activeTarget, conversationId, load, profile.user_id]);

  const threads = useMemo<Thread[]>(() => {
    const next: Thread[] = [
      ...conversations.map((row) => ({
        kind: "roommate" as const,
        id: `roommate:${row.id}`,
        time: row.last_message_at || row.created_at,
        row,
      })),
      ...bookingConversations.map((row) => ({
        kind: "worker" as const,
        id: `worker:${row.conversation_id}`,
        time: row.last_message_time || row.updated_at,
        row,
      })),
      ...hotelConversations.map((row) => ({
        kind: "hotel" as const,
        id: `hotel:${row.conversation_id}`,
        time: row.last_message_time || row.updated_at,
        row,
      })),
      ...supportThreads.map((row) => ({
        kind: "support" as const,
        id: `support:${row.conversation_id}`,
        time: row.last_message_time || row.created_at,
        row,
      })),
    ];
    return next.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
  }, [bookingConversations, conversations, hotelConversations, supportThreads]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) => threadSearchText(thread, people, otherId).includes(needle));
  }, [otherId, people, query, threads]);

  const target = activeTarget || (conversationId ? { conversationId, peerUserId } : null);
  if (target) {
    return (
      <ChatCore
        profile={profile}
        onNavigate={onNavigate}
        conversationId={target.conversationId}
        peerUserId={target.peerUserId}
        onConversationClose={() => {
          if (activeTarget) {
            setActiveTarget(null);
            void load(true);
          } else {
            onConversationClose?.();
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-xl font-bold">Inbox</h1>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-3 sm:px-5 lg:px-8">
        <button
          type="button"
          onClick={() => onNavigate("activity")}
          className="mb-3 flex w-full items-center gap-3 border-b border-white/[.06] py-3 text-left active:bg-white/[.025]"
          aria-label="Open Activity"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/15 text-violet-200">
            <ActivityIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">Activity</span>
            <span className="mt-0.5 block truncate text-[10px] text-[#777C8D]">
              Updates, followed-search matches and actions for you
            </span>
          </span>
          {activityUnreadCount > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">
              {activityUnreadCount > 99 ? "99+" : activityUnreadCount}
            </span>
          ) : (
            <span className="text-lg text-[#666C7A]">›</span>
          )}
        </button>

        <label className="flex h-11 items-center gap-3 border-b border-white/[.08] px-1 focus-within:border-violet-500/45">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages"
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#626879]"
          />
        </label>

        {loading ? (
          <div className="min-h-48" role="status" aria-label="Loading messages" />
        ) : visible.length === 0 ? (
          <div className="border-b border-dashed border-white/[.08] py-14 text-center">
            <p className="text-sm font-semibold">{query.trim() ? "No matching messages" : "No messages yet"}</p>
            <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#606676]">
              {query.trim() ? "Try a person, hotel, service or WeHouse case name." : "Messages appear after a roommate match, service booking, paid hotel stay or WeHouse help request."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[.06] border-b border-white/[.06]">
            {visible.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                people={people}
                me={profile.user_id}
                onOpen={() => {
                  if (thread.kind === "support") {
                    window.dispatchEvent(new CustomEvent("openSupportChat", {
                      detail: {
                        conversationId: thread.row.conversation_id,
                        contextType: thread.row.context_type,
                        contextId: thread.row.context_id,
                      },
                    }));
                    return;
                  }
                  setActiveTarget({
                    conversationId:
                      thread.kind === "roommate"
                        ? thread.row.id
                        : thread.row.conversation_id,
                    peerUserId:
                      thread.kind === "roommate" ? otherId(thread.row) : null,
                  });
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ThreadRow({
  thread,
  people,
  me,
  onOpen,
}: {
  thread: Thread;
  people: Record<string, Person>;
  me: string;
  onOpen: () => void;
}) {
  const view = threadPresentation(thread, people, me);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left active:bg-white/[.025]">
      <Avatar src={view.avatar} fallback={view.title} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{view.title}</p>
          <span className="shrink-0 text-[7px] font-semibold uppercase tracking-wide text-violet-300">{view.kind}</span>
        </div>
        <p className={`mt-1 truncate text-[10px] ${view.unread ? "font-medium text-white" : "text-[#777C8D]"}`}>{view.preview}</p>
        {view.context ? <p className="mt-1 truncate text-[8px] text-[#5F6474]">{view.context}</p> : null}
      </div>
      {view.unread > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{view.unread > 99 ? "99+" : view.unread}</span> : null}
    </button>
  );
}

function threadPresentation(thread: Thread, people: Record<string, Person>, me: string) {
  if (thread.kind === "roommate") {
    const peerId = thread.row.participant_a === me ? thread.row.participant_b : thread.row.participant_a;
    const peer = people[peerId];
    const unread = Number(thread.row.participant_a === me ? thread.row.unread_a : thread.row.unread_b) || 0;
    return {
      title: peer?.name || peer?.username || "Roommate",
      avatar: peer?.avatar || null,
      kind: "Roommate",
      preview: thread.row.last_message || "Roommate conversation",
      context: "Matched roommate",
      unread,
    };
  }
  if (thread.kind === "worker") {
    return {
      title: thread.row.other_person_name || "WeHouse service worker",
      avatar: thread.row.other_person_avatar,
      kind: "Service",
      preview: thread.row.last_message || "Service conversation",
      context: [thread.row.service_type, statusLabel(thread.row.booking_status)].filter(Boolean).join(" · "),
      unread: Number(thread.row.unread_count || 0),
    };
  }
  if (thread.kind === "hotel") {
    return {
      title: thread.row.other_party_label || thread.row.hotel_name || "Hotel",
      avatar: thread.row.hotel_image,
      kind: "Hotel",
      preview: thread.row.last_message || "Stay conversation",
      context: [thread.row.room_name, stayDates(thread.row.check_in, thread.row.check_out)].filter(Boolean).join(" · "),
      unread: Number(thread.row.unread_count || 0),
    };
  }
  const presentation = conversationPresentation(thread.row);
  return {
    title: presentation.title,
    avatar: null,
    kind: "WeHouse",
    preview: thread.row.last_message || presentation.operator,
    context: presentation.meta || "WeHouse support",
    unread: Number(thread.row.unread_count || 0),
  };
}

function threadSearchText(thread: Thread, people: Record<string, Person>, otherId: (row: Conversation) => string) {
  if (thread.kind === "roommate") {
    const peer = people[otherId(thread.row)];
    return [peer?.name, peer?.username, thread.row.last_message].filter(Boolean).join(" ").toLowerCase();
  }
  if (thread.kind === "worker") {
    return [thread.row.other_person_name, thread.row.service_type, thread.row.last_message].filter(Boolean).join(" ").toLowerCase();
  }
  if (thread.kind === "hotel") {
    return [thread.row.hotel_name, thread.row.room_name, thread.row.other_party_label, thread.row.last_message].filter(Boolean).join(" ").toLowerCase();
  }
  const presentation = conversationPresentation(thread.row);
  return [presentation.title, presentation.operator, presentation.meta, thread.row.subject, thread.row.last_message].filter(Boolean).join(" ").toLowerCase();
}

function Avatar({ src, fallback }: { src?: string | null; fallback: string }) {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/12 text-xs font-bold text-violet-200">
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : fallback.slice(0, 1).toUpperCase()}
    </span>
  );
}

function stayDates(checkIn?: string | null, checkOut?: string | null) {
  const left = compactDate(checkIn);
  const right = compactDate(checkOut);
  return left && right ? `${left} – ${right}` : left || right;
}
function compactDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function statusLabel(value?: string | null) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[#747A8B]"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
function ActivityIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>;
}
