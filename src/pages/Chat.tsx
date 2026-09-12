import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getConversations,
  getRoommateConversationPeople,
} from "@/lib/supabase/chat";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";
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

type ThreadView = {
  title: string;
  avatar?: string | null;
  fallback: string;
  kind: string;
  preview: string;
  context: string;
  time: string;
  unread: number;
  tone: "violet" | "amber" | "emerald" | "blue";
};

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

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      const [roommateResult, peopleResult, bookingResult, hotelResult, supportResult] =
        await Promise.all([
          getConversations(profile.user_id),
          getRoommateConversationPeople(),
          getCommunicationBookingConversations(profile.user_id),
          getMyHotelConversations(),
          getMySupportConversations(),
        ]);
      setConversations(
        (roommateResult.conversations || []).filter(
          (row) => row.conversation_type === "roommate",
        ),
      );
      setPeople(peopleResult.people || {});
      setBookingConversations(
        (bookingResult.conversations || []) as BookingConversation[],
      );
      setHotelConversations(hotelResult.conversations || []);
      setSupportThreads(supportResult.conversations || []);
      if (!quiet) setLoading(false);
    },
    [profile.user_id],
  );

  useEffect(() => {
    if (conversationId || activeTarget) return;
    void load();
    const channel = supabase
      .channel(`inbox-list:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "booking_messages" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hotel_booking_messages" },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        () => void load(true),
      )
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
    return next.sort(
      (a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime(),
    );
  }, [bookingConversations, conversations, hotelConversations, supportThreads]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) =>
      threadSearchText(thread, people, otherId).includes(needle),
    );
  }, [otherId, people, query, threads]);

  const target = activeTarget ||
    (conversationId ? { conversationId, peerUserId } : null);
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
          className="mb-2 flex w-full items-center gap-3 border-b border-white/[.06] py-3.5 text-left active:bg-white/[.025]"
          aria-label="Open Activity"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-500/15 text-violet-200">
            <ActivityIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Activity</span>
            <span className="mt-1 block truncate text-[10px] text-[#777C8D]">
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

        <label className="flex h-12 items-center gap-3 border-b border-white/[.08] px-1 focus-within:border-violet-500/45">
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
            <p className="text-sm font-semibold">
              {query.trim() ? "No matching messages" : "No messages yet"}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#606676]">
              {query.trim()
                ? "Try a person, hotel, service or WeHouse case name."
                : "Messages appear after a roommate match, service booking, paid hotel stay or WeHouse help request."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[.055] border-b border-white/[.06]">
            {visible.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                people={people}
                me={profile.user_id}
                onOpen={() => {
                  if (thread.kind === "support") {
                    window.dispatchEvent(
                      new CustomEvent("openSupportChat", {
                        detail: {
                          conversationId: thread.row.conversation_id,
                          contextType: thread.row.context_type,
                          contextId: thread.row.context_id,
                        },
                      }),
                    );
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
  const tone: Record<ThreadView["tone"], string> = {
    violet: "bg-violet-500/14 text-violet-200",
    amber: "bg-amber-500/12 text-amber-200",
    emerald: "bg-emerald-500/12 text-emerald-200",
    blue: "bg-cyan-500/10 text-cyan-200",
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[5.35rem] w-full items-center gap-3 py-3.5 text-left active:bg-white/[.025]"
    >
      <Avatar
        src={view.avatar}
        fallback={view.fallback}
        className={tone[view.tone]}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={`min-w-0 flex-1 truncate text-[14px] ${view.unread ? "font-bold text-white" : "font-semibold text-[#E6E8ED]"}`}>
            {view.title}
          </p>
          {view.time ? (
            <span className={`shrink-0 text-[8px] ${view.unread ? "text-violet-300" : "text-[#5D6373]"}`}>
              {view.time}
            </span>
          ) : null}
        </div>
        <p className={`mt-1 truncate text-[11px] ${view.unread ? "font-medium text-[#DADDE5]" : "text-[#777D8D]"}`}>
          {view.preview}
        </p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2">
          <span className={`shrink-0 text-[7px] font-bold uppercase tracking-[.12em] ${
            view.tone === "amber"
              ? "text-amber-300"
              : view.tone === "emerald"
                ? "text-emerald-300"
                : view.tone === "blue"
                  ? "text-cyan-300"
                  : "text-violet-300"
          }`}>
            {view.kind}
          </span>
          {view.context ? (
            <>
              <span className="text-[7px] text-[#3F4553]">·</span>
              <span className="min-w-0 truncate text-[8px] text-[#5F6575]">
                {view.context}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {view.unread > 0 ? (
        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-violet-500 px-1.5 text-[8px] font-bold">
          {view.unread > 99 ? "99+" : view.unread}
        </span>
      ) : null}
    </button>
  );
}

function threadPresentation(
  thread: Thread,
  people: Record<string, Person>,
  me: string,
): ThreadView {
  if (thread.kind === "roommate") {
    const peerId =
      thread.row.participant_a === me
        ? thread.row.participant_b
        : thread.row.participant_a;
    const peer = people[peerId];
    const unread =
      Number(
        thread.row.participant_a === me
          ? thread.row.unread_a
          : thread.row.unread_b,
      ) || 0;
    return {
      title: peer?.name || peer?.username || "Roommate",
      avatar: peer?.avatar || null,
      fallback: (peer?.name || peer?.username || "R").slice(0, 1),
      kind: "Roommate",
      preview: cleanEncryptedPreview(thread.row.last_message || "Start the conversation"),
      context: "Matched roommate",
      time: formatListTime(thread.time),
      unread,
      tone: "violet",
    };
  }
  if (thread.kind === "worker") {
    return {
      title: thread.row.other_person_name || "WeHouse service worker",
      avatar: thread.row.other_person_avatar,
      fallback: (thread.row.other_person_name || "S").slice(0, 1),
      kind: "Service",
      preview: cleanEncryptedPreview(
        thread.row.last_message || thread.row.service_type || "Service conversation",
      ),
      context: [thread.row.service_type, statusLabel(thread.row.booking_status)]
        .filter(Boolean)
        .join(" · "),
      time: formatListTime(thread.row.last_message_time || thread.row.updated_at),
      unread: Number(thread.row.unread_count || 0),
      tone: "emerald",
    };
  }
  if (thread.kind === "hotel") {
    return {
      title: thread.row.other_party_label || thread.row.hotel_name || "Hotel",
      avatar: thread.row.hotel_image,
      fallback: "H",
      kind: "Hotel",
      preview: thread.row.last_message || "Stay conversation ready",
      context: [
        thread.row.room_name,
        stayDates(thread.row.check_in, thread.row.check_out),
      ]
        .filter(Boolean)
        .join(" · "),
      time: formatListTime(thread.row.last_message_time || thread.row.updated_at),
      unread: Number(thread.row.unread_count || 0),
      tone: "amber",
    };
  }
  const presentation = conversationPresentation(thread.row);
  return {
    title: presentation.title,
    avatar: null,
    fallback: "W",
    kind: "WeHouse",
    preview: thread.row.last_message || presentation.operator,
    context: presentation.meta || "Support case",
    time: formatListTime(thread.row.last_message_time || thread.row.created_at),
    unread: Number(thread.row.unread_count || 0),
    tone: "blue",
  };
}

function threadSearchText(
  thread: Thread,
  people: Record<string, Person>,
  otherId: (row: Conversation) => string,
) {
  if (thread.kind === "roommate") {
    const peer = people[otherId(thread.row)];
    return [peer?.name, peer?.username, thread.row.last_message]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  if (thread.kind === "worker") {
    return [
      thread.row.other_person_name,
      thread.row.service_type,
      thread.row.last_message,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  if (thread.kind === "hotel") {
    return [
      thread.row.hotel_name,
      thread.row.room_name,
      thread.row.other_party_label,
      thread.row.last_message,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  const presentation = conversationPresentation(thread.row);
  return [
    presentation.title,
    presentation.operator,
    presentation.meta,
    thread.row.subject,
    thread.row.last_message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function cleanEncryptedPreview(value: string) {
  return value
    .replace(/^\[?Encrypted message\]?$/i, "Encrypted message")
    .replace(/^\[?encrypted\]?$/i, "Encrypted message");
}

function Avatar({
  src,
  fallback,
  className,
}: {
  src?: string | null;
  fallback: string;
  className: string;
}) {
  return (
    <span
      className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold ${className}`}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        fallback.toUpperCase()
      )}
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

function formatListTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    booking_requested: "Requested",
    negotiating: "Agreeing details",
    waiting_payment: "Waiting payment",
    confirmed: "Paid",
    in_progress: "In progress",
    completed_pending_approval: "Review work",
    approved_released: "Completed",
    disputed: "WeHouse review",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };
  return labels[String(value || "")] ||
    String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="shrink-0 text-[#747A8B]"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}
