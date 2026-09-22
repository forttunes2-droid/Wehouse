import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import type { ActivityDestination } from "@/lib/activityFeed";
import { getMyHotelBookingTarget } from "@/lib/supabase/hotels";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import PartnerHotelOperations from "@/components/PartnerHotelOperations";
import HotelBookingChat from "@/components/HotelBookingChat";
import InboxActivityEntry from "@/components/InboxActivityEntry";
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
};

export default function HotelTeamDashboard({
  profile,
  onLogout,
  onNavigate,
}: {
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
  const hasInbox = hotels.length > 0;
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
      <div className="min-h-dvh bg-[#0A0A0F] px-4 py-5 text-white sm:px-6">

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
      items={[{ id: "hotels", label: "Hotels" }, ...(hasInbox ? [{ id: "inbox", label: "Inbox", badge: chatUnread + activity.activityUnread }] : [])]}
      active={tab}
      setActive={id => { setShowActivity(false); setTab(id as "hotels" | "inbox"); }}
      onAccount={() => onNavigate?.("profile")}
      onLogout={onLogout}
      immersive={showActivity}
    >
      {hotelError ? <p role="alert" className="py-4 text-sm text-amber-200">Assigned hotels are unavailable. Refresh this page to try again.</p> : null}
      {showActivity ? (
        <section>
          <header className="mb-4 flex items-center gap-3 border-b border-white/[.06] pb-3">
            <button
              type="button"
              onClick={closeActivity}
              className="grid h-9 w-9 place-items-center text-[#A1A6B5]"
              aria-label="Back to Inbox"
            >
              ←
            </button>
            <div>
              <h2 className="text-sm font-semibold">Activity</h2>
              <p className="mt-1 text-[9px] text-[#707687]">
                Stay and hotel-operation updates.
              </p>
            </div>
          </header>
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
          <div className="mb-3 mt-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Guest messages</h2>
              <p className="mt-1 text-[9px] text-[#707687]">
                Current paid stays for hotels you may message.
              </p>
            </div>
            {chatUnread > 0 ? (
              <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">
                {chatUnread} new
              </span>
            ) : null}
          </div>
          <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
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
                      row.unread_count ? "text-white" : "text-[#73798A]"
                    }`}
                  >
                    {row.last_message || "Stay conversation ready"}
                  </p>
                  <p className="mt-1 truncate text-[8px] text-[#565D6E]">
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
              <p className="py-12 text-center text-[10px] text-[#6D7485]">
                No guest conversations yet.
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Assigned hotels</h2>
          {loading ? (
            <div
              className="min-h-40"
              role="status"
              aria-label="Loading assigned hotels"
            />
          ) : hotels.length === 0 ? (
            <div className="border-y border-dashed border-white/[.08] py-10 text-center text-xs text-[#687080]">
              No active hotel assignment is available.
            </div>
          ) : (
            <div className="divide-y divide-white/[.07] border-y border-white/[.07]">
              {hotels.map((hotel) => (
                <button
                  key={hotel.hotel_id}
                  onClick={() => { setInitialBookingId(undefined); setSelected(hotel); }}
                  className="flex w-full items-center gap-4 py-4 text-left"
                >
                  <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">
                    {hotel.images?.[0] ? (
                      <img
                        src={hotel.images[0]}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[8px] text-[#697080]">
                        No photo
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{hotel.name}</p>
                    <p className="mt-1 text-[9px] text-[#6D7485]">
                      {[hotel.city, hotel.state].filter(Boolean).join(", ")}
                    </p>
                    <p className="mt-2 text-[8px] font-semibold uppercase tracking-wide text-violet-300">
                      {hotel.access_role === "manager" ? "Manager" : "Front desk"}
                    </p>
                  </div>
                  <span aria-hidden="true" className="text-[#686F80]">›</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </WorkspaceFrameV2>
  );
}
