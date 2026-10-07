import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import type { ActivityDestination } from "@/lib/activityFeed";
import { getMyHotelBookingTarget } from "@/lib/supabase/hotels";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import PartnerHotelOperations from "@/components/PartnerHotelOperations";
import SupportEntryCard from "@/components/SupportEntryCard";
import HotelBookingChat from "@/components/HotelBookingChat";
import InboxActivityEntry from "@/components/InboxActivityEntry";
import ActivityHeader from "@/components/ActivityHeader";
import Notifications from "@/pages/Notifications";
import {
  getMyHotelConversations,
  type HotelConversation,
} from "@/lib/supabase/hotel-chat";
import { useOperationsInboxSummary } from "@/hooks/useOperationsInboxSummary";
import type { Profile } from "@/types";

type Hotel = {
  hotel_id: number;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  images: string[] | null;
  access_role: "manager" | "front_desk";
  capabilities: string[];
  room_type_count?: number;
  total_room_count?: number;
  starting_rate?: number | null;
};

export default function HotelTeamDashboard({
  profile,
  onLogout,
  onNavigate,
  inboxOpenRequest = 0,
}: {
  inboxOpenRequest?: number;
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
}) {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selected, setSelected] = useState<Hotel | null>(null);
  const [initialBookingId, setInitialBookingId] = useState<string>();
  const [hotelError, setHotelError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"hotels" | "inbox">("hotels");
  const [showActivity, setShowActivity] = useState(false);
  const closeActivity = useRecordScreenBack(() => setShowActivity(false), showActivity);
  const [conversations, setConversations] = useState<HotelConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<HotelConversation | null>(null);

  const messageHotelIds = useMemo(
    () =>
      new Set(
        hotels
          .filter((hotel) => hotel.capabilities?.includes("stay.message"))
          .map((hotel) => hotel.hotel_id),
      ),
    [hotels],
  );
  // Own account-support messages must not vanish when assigned hotels change.
  // Guest data remains filtered by hotel capabilities below and on the server.
  const hasInbox = Boolean(profile.user_id);
  const [supportUnread, setSupportUnread] = useState(0);
  useEffect(() => {
    if (!inboxOpenRequest) return;
    setSelected(null); setActiveConversation(null); setShowActivity(false); setTab("inbox");
  }, [inboxOpenRequest]);
  const activity = useOperationsInboxSummary(
    hasInbox ? profile.user_id : "",
    "hotel",
    null,
  );
  const visibleConversations = useMemo(
    () =>
      conversations.filter((row) => messageHotelIds.has(Number(row.hotel_id))),
    [conversations, messageHotelIds],
  );

  const loadConversations = useCallback(async () => {
    const result = await getMyHotelConversations("hotel");
    if (!result.error) setConversations(result.conversations);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc("get_my_hotel_operations");
      if (!active) return;
      setHotelError(Boolean(error));
      if (error) toast.error("Assigned hotels could not be loaded. Please try again.");
      setHotels((Array.isArray(data) ? data : []) as Hotel[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !hasInbox) {
      setConversations([]);
      return;
    }
    void loadConversations();
    const channel = supabase
      .channel(`hotel-team-inbox:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hotel_booking_messages" },
        () => void loadConversations(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hasInbox, loadConversations, loading, profile.user_id]);

  useEffect(() => {
    if (!loading && !hasInbox && tab === "inbox") setTab("hotels");
  }, [hasInbox, loading, tab]);

  const chatUnread = visibleConversations.reduce(
    (sum, row) => sum + Number(row.unread_count || 0),
    0,
  );

  async function openActivityDestination(page: string, id?: string, destination?: ActivityDestination) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (
      ["conversation", "conversations", "message", "messages", "chat"].includes(
        route,
      )
    ) {
      const thread = visibleConversations.find(
        (row) =>
          String(row.conversation_id) === String(id || ""),
      );
      if (thread) {
        setActiveConversation(thread);
        return;
      }
    }
    if (route === "hotel_booking" && id) {
      try {
        const target = await getMyHotelBookingTarget(id);
        if (destination?.hotelId && destination.hotelId !== String(target.hotel_id)) throw new Error("Mismatched hotel");
        const hotel = hotels.find(row => row.hotel_id === target.hotel_id && row.capabilities.includes("stay.read"));
        if (!hotel) throw new Error("Unavailable hotel");
        setInitialBookingId(String(target.booking_id)); setSelected(hotel); return;
      } catch { toast.error("This stay is unavailable or outside your current hotel permissions."); return; }
    }
    if (route === "hotel_detail") {
      const hotel = hotels.find(row => String(row.hotel_id) === String(id || ""));
      if (hotel) { setInitialBookingId(undefined); setSelected(hotel); return; }
    }
    toast.error("This update is outside your assigned hotel work.");
  }

  if (selected)
    return (
      <div className="min-h-dvh bg-[var(--wh-bg)] px-4 py-5 text-[var(--wh-text)] sm:px-6">

        <div className="mx-auto max-w-6xl">
          <PartnerHotelOperations
            hotel={selected}
            accessRole={selected.access_role}
            profile={profile}
            initialBookingId={initialBookingId}
            onBack={() => { setSelected(null); setInitialBookingId(undefined); }}
          />
        </div>
      </div>
    );

  if (activeConversation)
    return (
      <HotelBookingChat
        bookingId={activeConversation.booking_id}
        conversationId={activeConversation.conversation_id}
        profile={profile}
        title={activeConversation.guest_name || "Guest"}
        subtitle={[
          activeConversation.hotel_name,
          activeConversation.room_name,
          activeConversation.check_in && activeConversation.check_out
            ? `${activeConversation.check_in} – ${activeConversation.check_out}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        readOnly={!['confirmed', 'checked_in'].includes(activeConversation.booking_status)}
        onClose={() => setActiveConversation(null)}
        onUpdated={loadConversations}
      />
    );

  return (
    <WorkspaceFrameV2
      label="WEHOUSE · HOTEL TEAM"
      title={tab === "hotels" ? "Hotels" : "Inbox"}
      items={[{ id: "hotels", label: "Hotels" }, ...(hasInbox ? [{ id: "inbox", label: "Inbox", badge: chatUnread + supportUnread + activity.activityUnread }] : [])]}
      active={tab}
      setActive={id => { setShowActivity(false); setTab(id as "hotels" | "inbox"); }}
      onAccount={() => onNavigate?.("profile")}
      onLogout={onLogout}
      immersive={showActivity}
    >
      {hotelError ? <p role="alert" className="py-4 text-sm text-amber-200">Assigned hotels are unavailable. Refresh this page to try again.</p> : null}
      {showActivity ? (
        <section>
          <ActivityHeader onBack={closeActivity} />
          <Notifications
            profile={profile}
            scope="hotel"
            embedded
            onUnreadChange={activity.refresh}
            onNavigate={openActivityDestination}
          />
        </section>
      ) : tab === "inbox" && hasInbox ? (
        <section>
          <InboxActivityEntry
            unread={activity.activityUnread}
            detail="Stay and hotel-operation updates"
            onOpen={() => setShowActivity(true)}
          />
          <SupportEntryCard profile={profile} compact hideWhenEmpty onUnreadChange={setSupportUnread} />
          <div className="mb-3 mt-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Guest messages</h2>
              <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                Current paid stays for hotels you may message.
              </p>
            </div>
            {chatUnread > 0 ? (
              <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">
                {chatUnread} new
              </span>
            ) : null}
          </div>
          <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
            {visibleConversations.map((row) => (
              <button
                key={row.conversation_id}
                type="button"
                onClick={() => setActiveConversation(row)}
                className="flex w-full items-center gap-3 py-4 text-left"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-200">
                  {(row.guest_name || "G").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">
                    {row.guest_name || "Guest"}
                  </p>
                  <p
                    className={`mt-1 truncate text-[10px] ${
                      row.unread_count ? "text-white" : "text-[var(--wh-text-muted)]"
                    }`}
                  >
                    {row.last_message || "Stay conversation ready"}
                  </p>
                  <p className="mt-1 truncate text-[8px] text-[var(--wh-text-muted)]">
                    {row.hotel_name} · {row.room_name}
                  </p>
                </div>
                {row.unread_count > 0 ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">
                    {row.unread_count}
                  </span>
                ) : null}
              </button>
            ))}
            {!visibleConversations.length ? (
              <p className="py-12 text-center text-[10px] text-[var(--wh-text-muted)]">
                No guest conversations yet.
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="space-y-5">
          <header className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                Hotel access
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight">Your hotels</h2>
              <p className="mt-1 text-xs text-[var(--wh-text-muted)]">
                Each hotel keeps its own role, permissions and operating data.
              </p>
            </div>
            {!loading ? (
              <span className="shrink-0 rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--wh-text-muted)]">
                {hotels.length} {hotels.length === 1 ? "hotel" : "hotels"}
              </span>
            ) : null}
          </header>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading assigned hotels" role="status">
              {[0, 1].map((item) => (
                <div
                  key={item}
                  className="overflow-hidden rounded-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]"
                >
                  <div className="h-32 animate-pulse bg-[var(--wh-elevated)]" />
                  <div className="space-y-3 p-5">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--wh-elevated)]" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--wh-elevated)]" />
                    <div className="h-8 w-full animate-pulse rounded-xl bg-[var(--wh-elevated)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : hotels.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-6 py-14 text-center">
              <p className="text-sm font-semibold">No active hotel assignment</p>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-[var(--wh-text-muted)]">
                Hotels appear here only while your hotel access is active.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {hotels.map((hotel) => {
                const roleLabel =
                  hotel.access_role === "manager" ? "Manager" : "Front desk";
                const capabilityLabels = [
                  hotel.capabilities.includes("stay.read") ? "Reservations" : null,
                  hotel.capabilities.includes("stay.message") ? "Guest messages" : null,
                  hotel.capabilities.includes("room.mark_ready") ? "Room readiness" : null,
                  hotel.capabilities.includes("hotel.inventory.manage") ? "Availability" : null,
                  hotel.capabilities.includes("hotel.rate.manage") ? "Rates" : null,
                ].filter(Boolean) as string[];
                const location = [hotel.city, hotel.state].filter(Boolean).join(", ");
                return (
                  <button
                    key={hotel.hotel_id}
                    type="button"
                    onClick={() => {
                      setInitialBookingId(undefined);
                      setSelected(hotel);
                    }}
                    className="group overflow-hidden rounded-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] text-left shadow-[0_14px_45px_rgba(0,0,0,.14)] transition duration-200 hover:-translate-y-0.5 hover:border-violet-400/30 hover:shadow-[0_18px_55px_rgba(0,0,0,.2)] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                  >
                    <div className="relative h-32 overflow-hidden bg-[var(--wh-elevated)]">
                      {hotel.images?.[0] ? (
                        <img
                          src={hotel.images[0]}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-[var(--wh-text-muted)]">
                          No hotel image
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
                      <span className="absolute bottom-3 left-4 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-md">
                        {roleLabel}
                      </span>
                    </div>

                    <div className="p-5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-bold">{hotel.name}</h3>
                          {location ? (
                            <p className="mt-1 truncate text-xs text-[var(--wh-text-muted)]">
                              {location}
                            </p>
                          ) : null}
                        </div>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--wh-border-subtle)] text-lg text-[var(--wh-text-muted)] transition group-hover:border-violet-400/30 group-hover:text-violet-200">
                          →
                        </span>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-2">
                        <div className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]/50 px-3 py-2.5">
                          <p className="text-[9px] uppercase tracking-wide text-[var(--wh-text-muted)]">Rooms</p>
                          <p className="mt-1 text-sm font-bold">{hotel.total_room_count ?? 0}</p>
                        </div>
                        <div className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]/50 px-3 py-2.5">
                          <p className="text-[9px] uppercase tracking-wide text-[var(--wh-text-muted)]">Room types</p>
                          <p className="mt-1 text-sm font-bold">{hotel.room_type_count ?? 0}</p>
                        </div>
                      </div>

                      {capabilityLabels.length ? (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {capabilityLabels.slice(0, 4).map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-[var(--wh-border-subtle)] px-2 py-1 text-[9px] text-[var(--wh-text-muted)]"
                            >
                              {label}
                            </span>
                          ))}
                          {capabilityLabels.length > 4 ? (
                            <span className="rounded-full border border-[var(--wh-border-subtle)] px-2 py-1 text-[9px] text-[var(--wh-text-muted)]">
                              +{capabilityLabels.length - 4}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-5 flex items-center justify-between border-t border-[var(--wh-border-subtle)] pt-4">
                        <span className="text-[10px] font-medium text-[var(--wh-text-muted)]">
                          {hotel.status || "Status unavailable"}
                        </span>
                        <span className="text-xs font-semibold text-violet-200">Open hotel</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )      )}
    </WorkspaceFrameV2>
  );
}
