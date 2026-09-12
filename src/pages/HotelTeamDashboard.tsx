import { useCallback, useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import { supabase } from "@/lib/supabase";
import AccountShell from "@/components/AccountShell";
import PartnerHotelOperations from "@/components/PartnerHotelOperations";
import HotelBookingChat from "@/components/HotelBookingChat";
import InboxActivityEntry from "@/components/InboxActivityEntry";
import Notifications from "@/pages/Notifications";
import { getMyHotelConversations, type HotelConversation } from "@/lib/supabase/hotel-chat";
import { useOperationsInboxSummary } from "@/hooks/useOperationsInboxSummary";
import type { Profile } from "@/types";

type Hotel = {
  hotel_id: number;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  images: string[] | null;
  access_role: "manager" | "staff";
  capabilities?: string[];
};

export default function HotelTeamDashboard({ profile }: { profile: Profile; onLogout: () => void; onNavigate?: (page: string, id?: string) => void }) {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selected, setSelected] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"hotels" | "inbox">("hotels");
  const [showActivity, setShowActivity] = useState(false);
  const [conversations, setConversations] = useState<HotelConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<HotelConversation | null>(null);

  const messageHotelIds = useMemo(() => new Set(hotels.filter((hotel) => hotel.capabilities?.includes("stay.message")).map((hotel) => hotel.hotel_id)), [hotels]);
  const hasInbox = messageHotelIds.size > 0;
  const activity = useOperationsInboxSummary(hasInbox ? profile.user_id : "", "hotel_staff", null);
  const visibleConversations = useMemo(() => conversations.filter((row) => messageHotelIds.has(Number(row.hotel_id))), [conversations, messageHotelIds]);

  const loadConversations = useCallback(async () => {
    const result = await getMyHotelConversations();
    if (!result.error) setConversations(result.conversations);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc("get_my_hotel_operations");
      if (!active) return;
      if (error) toast.error(error.message);
      setHotels((Array.isArray(data) ? data : []) as Hotel[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading || !hasInbox) { setConversations([]); return; }
    void loadConversations();
    const channel = supabase.channel(`hotel-team-inbox:${profile.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hotel_booking_messages" }, () => void loadConversations())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hasInbox, loadConversations, loading, profile.user_id]);

  useEffect(() => { if (!loading && !hasInbox && tab === "inbox") setTab("hotels"); }, [hasInbox, loading, tab]);

  const chatUnread = visibleConversations.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (["conversation", "conversations", "message", "messages", "chat"].includes(route) || /booking|reservation/.test(route)) {
      const thread = visibleConversations.find((row) => String(row.conversation_id) === String(id || "") || String(row.booking_id) === String(id || ""));
      if (thread) { setShowActivity(false); return setActiveConversation(thread); }
    }
    if (/hotel/.test(route)) {
      const hotel = hotels.find((row) => String(row.hotel_id) === String(id || ""));
      if (hotel) { setShowActivity(false); return setSelected(hotel); }
    }
    toast.error("This update is outside your assigned hotel work.");
  }

  if (selected) return (
    <div className="min-h-dvh bg-[#0A0A0F] px-4 py-5 text-white sm:px-6">
      <Toaster position="top-center" richColors />
      <div className="mx-auto max-w-6xl"><PartnerHotelOperations hotel={selected} accessRole={selected.access_role} capabilities={selected.capabilities || []} profile={profile} onBack={() => setSelected(null)} /></div>
    </div>
  );
  if (activeConversation) return <HotelBookingChat bookingId={activeConversation.booking_id} conversationId={activeConversation.conversation_id} profile={profile} title={activeConversation.guest_name || "Guest"} subtitle={[activeConversation.hotel_name, activeConversation.room_name, activeConversation.check_in && activeConversation.check_out ? `${activeConversation.check_in} – ${activeConversation.check_out}` : ""].filter(Boolean).join(" · ")} readOnly={!['confirmed','checked_in'].includes(activeConversation.booking_status)} onClose={() => setActiveConversation(null)} onUpdated={loadConversations} />;

  return (
    <AccountShell profile={profile} title={tab === "hotels" ? "Hotels" : showActivity ? "Activity" : "Inbox"}>
      <Toaster position="top-center" richColors />
      {hasInbox && !showActivity ? (
        <div className="mb-5 grid grid-cols-2 border-b border-white/[.07]">
          {([['hotels', 'Hotels'], ['inbox', 'Inbox']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`relative min-h-12 text-xs font-semibold ${tab === id ? "text-white" : "text-[#747A8B]"}`}>{label}{id === "inbox" && chatUnread + activity.activityUnread > 0 ? <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px]">{chatUnread + activity.activityUnread > 99 ? "99+" : chatUnread + activity.activityUnread}</span> : null}{tab === id ? <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-violet-400" /> : null}</button>)}
        </div>
      ) : null}

      {showActivity ? (
        <section>
          <header className="mb-4 flex items-center gap-3 border-b border-white/[.06] pb-3"><button type="button" onClick={() => setShowActivity(false)} className="grid h-9 w-9 place-items-center rounded-full text-[#A1A6B5]">←</button><div><h2 className="text-sm font-semibold">Activity</h2><p className="mt-1 text-[9px] text-[#707687]">Stay and hotel-operation updates.</p></div></header>
          <Notifications profile={profile} scope="hotel_staff" embedded onUnreadChange={activity.refresh} onNavigate={openActivityDestination} />
        </section>
      ) : tab === "inbox" && hasInbox ? (
        <section>
          <InboxActivityEntry unread={activity.activityUnread} detail="Stay and hotel-operation updates" onOpen={() => setShowActivity(true)} />
          <div className="mb-3 mt-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Guest messages</h2><p className="mt-1 text-[9px] text-[#707687]">Current paid stays for hotels you may message.</p></div>{chatUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{chatUnread} new</span> : null}</div>
          <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
            {visibleConversations.map((row) => <button key={row.conversation_id} type="button" onClick={() => setActiveConversation(row)} className="flex w-full items-center gap-3 py-4 text-left"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-200">{(row.guest_name || "G").slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.guest_name || "Guest"}</p><p className={`mt-1 truncate text-[10px] ${row.unread_count ? "text-white" : "text-[#73798A]"}`}>{row.last_message || "Paid stay conversation"}</p><p className="mt-1 truncate text-[8px] text-[#565D6E]">{row.hotel_name} · {row.room_name}</p></div>{row.unread_count > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{row.unread_count}</span> : null}</button>)}
            {!visibleConversations.length ? <p className="py-12 text-center text-[10px] text-[#6D7485]">No guest conversations yet.</p> : null}
          </div>
        </section>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Assigned hotels</h2>
          {loading ? <div className="min-h-40" role="status" aria-label="Loading assigned hotels" /> : hotels.length === 0 ? <div className="border-y border-dashed border-white/[.08] py-10 text-center text-xs text-[#687080]">No active hotel assignment is available.</div> : (
            <div className="divide-y divide-white/[.07] border-y border-white/[.07]">{hotels.map((hotel) => <button key={hotel.hotel_id} onClick={() => setSelected(hotel)} className="flex w-full items-center gap-4 py-4 text-left"><div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">{hotel.images?.[0] ? <img src={hotel.images[0]} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[8px] text-[#697080]">No photo</div>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{hotel.name}</p><p className="mt-1 text-[9px] text-[#6D7485]">{[hotel.city, hotel.state].filter(Boolean).join(", ")}</p><p className="mt-2 text-[8px] font-semibold uppercase tracking-wide text-violet-300">{hotel.access_role === "manager" ? "Manager" : "Front desk"}</p></div><span aria-hidden="true" className="text-[#686F80]">›</span></button>)}</div>
          )}
        </section>
      )}
    </AccountShell>
  );
}
