import { matchesInboxCategory, type InboxCategory } from "@/lib/inboxCategories";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
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
import PropertyHostBookingChat from "@/components/PropertyHostBookingChat";
import { getMyPropertyHostConversations, type PropertyHostConversation } from "@/lib/supabase/property-host-chat";
import ChatCore from "@/pages/ChatCore";
import Notifications from "@/pages/Notifications";
import InboxActivityEntry from "@/components/InboxActivityEntry";
import SecureInboxLock from "@/components/SecureInboxLock";
import useSecureInboxAccess from "@/hooks/useSecureInboxAccess";
import { createRefreshScheduler } from "@/lib/refreshScheduler";

type Props = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  conversationId?: string | null;
  peerUserId?: string | null;
  onConversationClose?: () => void;
  chatUnreadCount?: number;
  activityUnreadCount?: number;
  onActivityUnreadChange?: (count: number) => void;
  conversationOnly?: boolean;
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
  | { kind: "host"; id: string; time: string; row: PropertyHostConversation }
  | { kind: "support"; id: string; time: string; row: SupportThread };

type ActiveTarget = {
  conversationId: string;
  peerUserId?: string | null;
  kind?: "roommate" | "worker" | "hotel" | "host";
  bookingId?: string;
  hotelConversation?: HotelConversation;
  hostConversation?: PropertyHostConversation;
} | null;

type ThreadView = {
  title: string;
  avatar?: string | null;
  fallback: string;
  preview: string;
  context: string;
  time: string;
  unread: number;
  tone: "violet" | "amber" | "emerald" | "blue";
};

type InboxListSnapshot = {
  conversations: Conversation[];
  bookingConversations: BookingConversation[];
  hotelConversations: HotelConversation[];
  hostConversations: PropertyHostConversation[];
  supportThreads: SupportThread[];
  people: Record<string, Person>;
};
const inboxListCache = new Map<string, InboxListSnapshot>();

export default function Chat({
  profile,
  onNavigate,
  conversationId,
  peerUserId,
  onConversationClose,
  activityUnreadCount = 0,
  onActivityUnreadChange,
  conversationOnly = false,
}: Props) {
  const cachedInbox = inboxListCache.get(profile.user_id);
  const [conversations, setConversations] = useState<Conversation[]>(
    () => cachedInbox?.conversations || [],
  );
  const [bookingConversations, setBookingConversations] = useState<
    BookingConversation[]
  >(() => cachedInbox?.bookingConversations || []);
  const [hotelConversations, setHotelConversations] = useState<
    HotelConversation[]
  >(() => cachedInbox?.hotelConversations || []);
  const [hostConversations, setHostConversations] = useState<PropertyHostConversation[]>(
    () => cachedInbox?.hostConversations || [],
  );
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>(
    () => cachedInbox?.supportThreads || [],
  );
  const [people, setPeople] = useState<Record<string, Person>>(
    () => cachedInbox?.people || {},
  );
  const [loading, setLoading] = useState(!conversationId && !cachedInbox);
  const loadVersion = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<InboxCategory>("all");
  const [activeTarget, setActiveTarget] = useState<ActiveTarget>(null);
  const [view, setView] = useState<"messages" | "activity">("messages");
  const {
    status: inboxSecurityStatus,
    refresh: refreshInboxSecurity,
  } = useSecureInboxAccess(profile.user_id);

  const otherId = useCallback(
    (row: Conversation) =>
      row.participant_a === profile.user_id
        ? row.participant_b
        : row.participant_a,
    [profile.user_id],
  );

  const load = useCallback(
    async (quiet = false) => {
      const request = ++loadVersion.current;
      if (!quiet) setLoading(true);
      setLoadError("");

      const previous = inboxListCache.get(profile.user_id);
      const next: InboxListSnapshot = {
        conversations: previous?.conversations || [],
        bookingConversations: previous?.bookingConversations || [],
        hotelConversations: previous?.hotelConversations || [],
        hostConversations: previous?.hostConversations || [],
        supportThreads: previous?.supportThreads || [],
        people: previous?.people || {},
      };
      let finished = 0;
      let failed = 0;

      const publish = () => {
        if (request !== loadVersion.current) return;
        finished += 1;
        setConversations(next.conversations);
        setBookingConversations(next.bookingConversations);
        setHotelConversations(next.hotelConversations);
        setHostConversations(next.hostConversations);
        setSupportThreads(next.supportThreads);
        setPeople(next.people);
        inboxListCache.set(profile.user_id, { ...next });
        // Paint the first available source immediately. Remaining sources
        // reconcile in place instead of blocking the whole Inbox.
        if (!quiet && finished === 1) setLoading(false);
        if (finished === 6) {
          setLoading(false);
          setLoadError(
            failed
              ? "Some messages could not be refreshed. Showing what is available."
              : "",
          );
        }
      };

      const tasks = [
        (async () => {
          try {
            const result = await withTimeout(
              getConversations(profile.user_id),
              8000,
              "Roommate messages took too long to refresh.",
            );
            if (result.error) failed += 1;
            else
              next.conversations = (result.conversations || []).filter(
                (row) => row.conversation_type === "roommate",
              );
          } catch {
            failed += 1;
          } finally {
            publish();
          }
        })(),
        (async () => {
          try {
            const result = await withTimeout(
              getRoommateConversationPeople(),
              8000,
              "Conversation profiles took too long to refresh.",
            );
            if (result.error) failed += 1;
            else next.people = result.people || {};
          } catch {
            failed += 1;
          } finally {
            publish();
          }
        })(),
        (async () => {
          try {
            const result = await withTimeout(
              getCommunicationBookingConversations(profile.user_id, "personal"),
              8000,
              "Service messages took too long to refresh.",
            );
            if (result.error) failed += 1;
            else
              next.bookingConversations =
                (result.conversations || []) as BookingConversation[];
          } catch {
            failed += 1;
          } finally {
            publish();
          }
        })(),
        (async () => {
          try {
            const result = await withTimeout(
              getMyHotelConversations(),
              8000,
              "Hotel messages took too long to refresh.",
            );
            if (result.error) failed += 1;
            else next.hotelConversations = result.conversations || [];
          } catch {
            failed += 1;
          } finally {
            publish();
          }
        })(),
        (async () => {
          try {
            const result = await withTimeout(
              getMyPropertyHostConversations(),
              8000,
              "Property host messages took too long to refresh.",
            );
            if (result.error) failed += 1;
            else next.hostConversations = result.conversations || [];
          } catch {
            failed += 1;
          } finally {
            publish();
          }
        })(),
        (async () => {
          try {
            const result = await withTimeout(
              getMySupportConversations(),
              8000,
              "WeHouse messages took too long to refresh.",
            );
            if (result.error) failed += 1;
            else next.supportThreads = result.conversations || [];
          } catch {
            failed += 1;
          } finally {
            publish();
          }
        })(),
      ];

      await Promise.allSettled(tasks);
    },
    [profile.user_id],
  );

  useEffect(() => {
    if (
      inboxSecurityStatus?.state !== "ready" ||
      conversationId ||
      activeTarget ||
      view !== "messages"
    )
      return;

    const scheduler = createRefreshScheduler(
      async () => {
        await load(true);
      },
      () => document.visibilityState === "visible",
      180,
    );
    scheduler.request();

    const channel = supabase
      .channel(`inbox-list:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        scheduler.request,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "booking_messages" },
        scheduler.request,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "property_host_messages" },
        scheduler.request,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hotel_booking_messages" },
        scheduler.request,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        scheduler.request,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") scheduler.request();
      });

    const reconcile = () => {
      if (document.visibilityState === "visible") scheduler.request();
    };
    window.addEventListener("wehouse:unread-changed", scheduler.request);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);

    return () => {
      loadVersion.current += 1;
      scheduler.dispose();
      window.removeEventListener("wehouse:unread-changed", scheduler.request);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      void supabase.removeChannel(channel);
    };
  }, [
    activeTarget,
    conversationId,
    inboxSecurityStatus?.state,
    load,
    profile.user_id,
    view,
  ]);

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
      ...hostConversations.map((row) => ({
        kind: "host" as const,
        id: `host:${row.conversation_id}`,
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
      (a, b) =>
        new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime(),
    );
  }, [
    bookingConversations,
    conversations,
    hotelConversations,
    hostConversations,
    supportThreads,
  ]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter(thread => matchesInboxCategory(thread.kind, category) &&
      (!needle || threadSearchText(thread, people, otherId).includes(needle)));
  }, [category, otherId, people, query, threads]);


  const target =
    activeTarget || (conversationId ? { conversationId, peerUserId } : null);

  if (inboxSecurityStatus?.state !== "ready") {
    return (
      <SecureInboxLock
        status={inboxSecurityStatus}
        onReady={() => void refreshInboxSecurity()}
      />
    );
  }

  if (target?.kind === "host" && target.hostConversation) {
    return <PropertyHostBookingChat conversation={target.hostConversation} profile={profile} onClose={() => { setActiveTarget(null); void load(true); }} onUpdated={() => void load(true)} />;
  }

  if (target) {
    return (
      <ChatCore
        key={`${profile.user_id}:${target.conversationId}`}
        profile={profile}
        onNavigate={onNavigate}
        conversationId={target.conversationId}
        peerUserId={target.peerUserId}
        initialKind={target.kind === "host" ? undefined : target.kind}
        initialBookingId={target.bookingId}
        initialHotelConversation={target.hotelConversation}
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

  function openThreadByDestination(id?: string) {
    if (!id) return false;
    const value = String(id);
    const support = supportThreads.find(
      (thread) =>
        String(thread.conversation_id) === value ||
        String(thread.context_id || "") === value,
    );
    if (support) {
      setView("messages");
      window.dispatchEvent(
        new CustomEvent("openSupportChat", {
          detail: {
            conversationId: support.conversation_id,
            contextType: support.context_type,
            contextId: support.context_id,
          },
        }),
      );
      return true;
    }
    const roommate = conversations.find((row) => String(row.id) === value);
    if (roommate) {
      setView("messages");
      setActiveTarget({
        conversationId: roommate.id,
        peerUserId: otherId(roommate),
        kind: "roommate",
      });
      return true;
    }
    const booking = bookingConversations.find(
      (row) =>
        String(row.conversation_id) === value || String(row.booking_id) === value,
    );
    if (booking) {
      setView("messages");
      setActiveTarget({
        conversationId: booking.conversation_id,
        bookingId: booking.booking_id,
        kind: "worker",
      });
      return true;
    }
    const hotel = hotelConversations.find(
      (row) =>
        String(row.conversation_id) === value || String(row.booking_id) === value,
    );
    if (hotel) {
      setView("messages");
      setActiveTarget({
        conversationId: hotel.conversation_id,
        kind: "hotel",
        hotelConversation: hotel,
      });
      return true;
    }
    const host = hostConversations.find(
      (row) => String(row.conversation_id) === value || String(row.reservation_id) === value,
    );
    if (host) {
      setView("messages");
      setActiveTarget({
        conversationId: host.conversation_id,
        kind: "host",
        hostConversation: host,
      });
      return true;
    }
    return false;
  }

  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (
      ["conversation", "conversations", "message", "messages", "chat"].includes(
        route,
      ) &&
      openThreadByDestination(id)
    )
      return;
    onNavigate(page, id);
  }

  if (view === "activity") {
    return (
      <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
        <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <button
              type="button"
              onClick={() => setView("messages")}
              aria-label="Back to Inbox messages"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg text-[#A1A6B5] active:bg-white/[.05]"
            >
              ←
            </button>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-violet-300">
                Inbox
              </p>
              <h1 className="text-xl font-bold">Activity</h1>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-3 sm:px-5 lg:px-8">
          <Notifications
            profile={profile}
            scope="personal"
            embedded
            onNavigate={openActivityDestination}
            onUnreadChange={onActivityUnreadChange}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <h1 className="text-xl font-bold">{conversationOnly ? "Conversation" : "Inbox"}</h1>
          {!conversationOnly && <InboxActivityEntry compact unread={activityUnreadCount} onOpen={() => setView("activity")} />}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-3 sm:px-5 lg:px-8">
        <section className="pt-4">
          <h2 className="sr-only">Messages</h2>
          <label className="flex h-12 items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] px-3 focus-within:border-violet-500/45">
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#858B9B]"
            />
          </label>

          <div role="group" aria-label="Message categories" className="mt-3 flex gap-1 overflow-x-auto">
            {([['all', 'All'], ['people', 'Roommates'], ['bookings', 'Bookings'], ['wehouse', 'WeHouse']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}
                className={`min-h-11 shrink-0 rounded-full px-3 text-[13px] font-semibold ${category === value ? 'bg-violet-500/20 text-violet-200' : 'text-[#A1A7B5] hover:bg-white/[.04]'}`}>
                {label}
              </button>
            ))}
          </div>

          {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-[#C1BBCB]"><p>{loadError}</p><button type="button" onClick={() => void load()} className="min-h-11 font-semibold text-violet-300">Try again</button></div>}
          {loading ? (
            <p className="py-12 text-center text-sm text-[#A1A7B5]" role="status">Loading messages…</p>
          ) : visible.length === 0 && !loadError ? (
            <div className="border-b border-dashed border-white/[.08] py-14 text-center">
              <p className="text-sm font-semibold">
                {query.trim() ? "No matching messages" : "No messages yet"}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#606676]">
                {query.trim()
                  ? "Try a person, hotel, service or WeHouse conversation name."
                  : category === "wehouse" ? "Your conversations with the WeHouse team appear here."
                  : category === "people" ? "Your roommate conversations appear here."
                  : category === "bookings" ? "Conversations about your hotel stays and service jobs appear here."
                  : "Your conversations appear here, with the newest first."}
              </p>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-white/[.055] border-y border-white/[.06]">
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
                    setActiveTarget(
                      thread.kind === "roommate"
                        ? {
                            conversationId: thread.row.id,
                            peerUserId: otherId(thread.row),
                            kind: "roommate",
                          }
                        : thread.kind === "worker"
                          ? {
                              conversationId: thread.row.conversation_id,
                              bookingId: thread.row.booking_id,
                              kind: "worker",
                            }
                          : thread.kind === "hotel"
                            ? {
                                conversationId: thread.row.conversation_id,
                                kind: "hotel",
                                hotelConversation: thread.row,
                              }
                            : {
                                conversationId: thread.row.conversation_id,
                                kind: "host",
                                hostConversation: thread.row,
                              },
                    );
                  }}
                />
              ))}
            </div>
          )}
        </section>
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
    violet: "bg-violet-500/[.12] text-violet-200",
    amber: "bg-violet-500/[.12] text-violet-200",
    emerald: "bg-violet-500/[.12] text-violet-200",
    blue: "bg-violet-500/[.12] text-violet-200",
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[4.5rem] w-full items-center gap-3 py-3 text-left active:bg-white/[.025]"
    >
      <Avatar
        src={view.avatar}
        fallback={view.fallback}
        className={tone[view.tone]}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-[14px] ${
              view.unread
                ? "font-bold text-white"
                : "font-semibold text-[#E6E8ED]"
            }`}
          >
            {view.title}
          </p>
          {view.time ? (
            <span
              className={`shrink-0 text-[11px] ${
                view.unread ? "text-violet-300" : "text-[#8A90A0]"
              }`}
            >
              {view.time}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-[13px] ${
              view.unread
                ? "font-medium text-[#DADDE5]"
                : "text-[#7D8392]"
            }`}
          >
            {view.preview}
          </p>
          {view.unread > 0 ? (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-violet-500 px-1.5 text-[8px] font-bold text-white">
              {view.unread > 99 ? "99+" : view.unread}
            </span>
          ) : null}
        </div>
      </div>
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
      preview: cleanEncryptedPreview(
        thread.row.last_message || "Start the conversation",
      ),
      context: "Matched",
      time: formatListTime(thread.time),
      unread,
      tone: "violet",
    };
  }
  if (thread.kind === "worker") {
    return {
      title: thread.row.other_person_name || "Service Worker",
      avatar: thread.row.other_person_avatar,
      fallback: (thread.row.other_person_name || "S").slice(0, 1),
      preview: cleanEncryptedPreview(
        thread.row.last_message ||
          thread.row.service_type ||
          "Service conversation",
      ),
      context: thread.row.service_type || "WeHouse Services",
      time: formatListTime(
        thread.row.last_message_time || thread.row.updated_at,
      ),
      unread: Number(thread.row.unread_count || 0),
      tone: "emerald",
    };
  }
  if (thread.kind === "hotel") {
    return {
      title: thread.row.other_party_label || thread.row.hotel_name || "Hotel",
      avatar: thread.row.hotel_image,
      fallback: "H",
      preview: thread.row.last_message || "Stay conversation",
      context: [
        thread.row.room_name,
        stayDates(thread.row.check_in, thread.row.check_out),
      ]
        .filter(Boolean)
        .join(" · "),
      time: formatListTime(
        thread.row.last_message_time || thread.row.updated_at,
      ),
      unread: Number(thread.row.unread_count || 0),
      tone: "amber",
    };
  }
  if (thread.kind === "host") {
    const mediaPreview = thread.row.last_attachment_types?.[0] === "video" ? "Video" : thread.row.last_attachment_types?.[0] === "image" ? "Photo" : "Booking conversation";
    return {
      title: thread.row.other_person_name || "Property host",
      avatar: thread.row.other_person_avatar,
      fallback: (thread.row.other_person_name || "H").slice(0,1),
      preview: thread.row.last_message || mediaPreview,
      context: [thread.row.listing_title, thread.row.stay_type === "short_let" ? "Short Let" : "Long Let"].filter(Boolean).join(" · "),
      time: formatListTime(thread.row.last_message_time || thread.row.updated_at),
      unread: Number(thread.row.unread_count || 0),
      tone: "violet",
    };
  }
  const presentation = conversationPresentation(thread.row);
  return {
    title: presentation.title,
    avatar: null,
    fallback: "W",
    preview: thread.row.last_message || presentation.operator,
    context: presentation.meta || "WeHouse conversation",
    time: formatListTime(
      thread.row.last_message_time || thread.row.created_at,
    ),
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
  if (thread.kind === "host") {
    return [thread.row.other_person_name,thread.row.listing_title,thread.row.last_message]
      .filter(Boolean).join(" ").toLowerCase();
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
      className={`grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full text-lg font-semibold ${className}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
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
  return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

function formatListTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
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
