import { hotelTodayMetrics, matchesHotelReservationFilter } from "@/lib/hotelDailyWork";
import { hotelPaymentLabel, hotelRoomAvailability } from "@/lib/propertyNavigation";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { locationLabel } from "@/lib/locationPresentation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  getMyHotelOperationSnapshot,
  partnerCreateHotelRoom,
  partnerSaveHotelRatePlan,
  partnerSaveHotelVenue,
  uploadRoomImage,
} from "@/lib/supabase/hotels";
import PropertyMediaCarousel from "@/components/PropertyMediaCarousel";
import HotelBookingChat from "@/components/HotelBookingChat";
import {
  getMyHotelConversations,
  type HotelConversation,
} from "@/lib/supabase/hotel-chat";
import type {
  HotelRatePlan,
  HotelRoom,
  HotelRoomUnit,
  HotelRoomUnitStatus,
  HotelVenue,
  Profile,
} from "@/types";
import WeHouseSelect from "@/components/WeHouseSelect";
import BackButton from "@/components/BackButton";
import { invitationShareUrl } from "@/lib/resourceInvitation";
import HotelSpecialRequest from "@/components/HotelSpecialRequest";

type HotelAccessRole = "owner" | "manager" | "front_desk" | "staff";
type HotelCapability =
  | "stay.read"
  | "stay.message"
  | "stay.assign_unit"
  | "stay.check_in"
  | "stay.check_out"
  | "stay.modify_commercial"
  | "room.mark_ready"
  | "hotel.inventory.manage"
  | "hotel.rate.manage"
  | "hotel.policy.manage"
  | "hotel.team.manage";
type Props = {
  hotel: any;
  accessRole: HotelAccessRole;
  onBack: () => void;
  profile?: Profile;
  initialBookingId?: string;
};
type Room = HotelRoom & { rate_plans?: HotelRatePlan[] };
type Booking = {
  booking_id: number;
  room_id: number;
  rate_plan_id?: number | null;
  rate_plan_name?: string | null;
  check_in: string;
  check_out: string;
  guest_count: number;
  guest_name: string | null;
  booking_code: string | null;
  status: string;
  payment_status: string;
  payment_expires_at?: string | null;
  total_price: number;
  special_requests: string | null;
  assigned_room_unit_id?: number | null;
  profiles?: { username?: string | null } | null;
  hotel_rooms?: { room_type?: string | null } | null;
};
type ActiveHotelChat = {
  booking_id: number;
  conversation_id?: string | null;
  guest_name?: string | null;
  booking_status: string;
};
type Inventory = {
  room_id: number;
  inventory_date: string;
  available_quantity: number;
  rate_override: number | null;
  closed: boolean;
  note?: string | null;
};

const ROOM_AMENITIES = [
  "Air conditioning",
  "Private bathroom",
  "Free WiFi",
  "Flat-screen TV",
  "Minibar",
  "Balcony",
  "City view",
  "Pool view",
  "Work desk",
  "Room service",
];
const HOTEL_STATUS: Record<string, string> = {
  pending: "Payment hold",
  confirmed: "Stay confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  completed: "Stay completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  expired: "Hold expired",
  payment_conflict: "Payment review",
};
const HOTEL_CAPABILITY_LABELS: Record<HotelCapability, string> = {
  "stay.read": "View reservations",
  "stay.message": "Message guests",
  "stay.assign_unit": "Assign rooms",
  "stay.check_in": "Check in guests",
  "stay.check_out": "Check out guests",
  "stay.modify_commercial": "Modify booking terms",
  "room.mark_ready": "Update room readiness",
  "hotel.inventory.manage": "Manage availability",
  "hotel.rate.manage": "Manage rates and packages",
  "hotel.policy.manage": "Manage operating policy",
  "hotel.team.manage": "Manage hotel team",
};
const today = (timeZone = "Africa/Lagos") => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const money = (value: number) =>
  `₦${Number(value || 0).toLocaleString("en-NG")}`;
const words = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function PartnerHotelOperations({
  hotel,
  accessRole,
  onBack,
  profile,
  initialBookingId,
}: Props) {
  const closeRecord = useRecordScreenBack(onBack);
  const [section, setSection] = useState(initialBookingId ? "reservations" : "overview");
  const [focusedBooking, setFocusedBooking] = useState(initialBookingId);
  const loadGeneration = useRef(0);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [roomUnits, setRoomUnits] = useState<HotelRoomUnit[]>([]);
  const [venues, setVenues] = useState<HotelVenue[]>([]);
  const [hotelChats, setHotelChats] = useState<HotelConversation[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveHotelChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [liveCapabilities, setLiveCapabilities] = useState<HotelCapability[] | null>(null);
  const [reservationQuery, setReservationQuery] = useState("");
  const [reservationFilter, setReservationFilter] = useState("all");
  const [editingRoom, setEditingRoom] = useState<Room | "new" | null>(null);
  const [editingRate, setEditingRate] = useState<{
    room: Room;
    plan?: HotelRatePlan;
  } | null>(null);
  const [editingVenue, setEditingVenue] = useState<HotelVenue | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const capabilities = useMemo(() => new Set<HotelCapability>(liveCapabilities || []), [liveCapabilities]);
  const canReadStays = capabilities.has("stay.read");
  const canMessageGuests = capabilities.has("stay.message");
  const canMarkRoomsReady = capabilities.has("room.mark_ready");
  const canManageInventory = capabilities.has("hotel.inventory.manage");
  const canManageRates = capabilities.has("hotel.rate.manage");
  const canManagePolicy = capabilities.has("hotel.policy.manage");
  const canManageTeam = capabilities.has("hotel.team.manage");
  const canManageRoomFacts =
    hotel.status !== "active" && canManageInventory && canManageRates;

  const sections = [
    { id: "overview", label: "Today" },
    ...(canReadStays ? [{ id: "reservations", label: "Reservations" }] : []),
    ...(canManageRoomFacts || canManageRates ? [{ id: "rooms", label: "Rooms and packages" }] : []),
    ...(canReadStays || canManageInventory || canMarkRoomsReady ? [{ id: "availability", label: "Availability" }] : []),
    { id: "details", label: "Property details" },
    ...(canManageTeam ? [{ id: "team", label: "Team" }] : []),
  ];
  const visibleSection = sections.some(item => item.id === section) ? section : "overview";
  const load = useCallback(async (quiet = false) => {
    const generation = ++loadGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const snapshot = await getMyHotelOperationSnapshot(hotel.hotel_id, initialBookingId);
      if (generation !== loadGeneration.current) return;
      const currentCapabilities = snapshot.capabilities || [];
      setRooms(snapshot.rooms || []); setBookings(currentCapabilities.includes("stay.read") ? snapshot.bookings || [] : []);
      setInventory(snapshot.inventory || []); setRoomUnits(snapshot.room_units || []);
      setVenues(snapshot.venues || []); setLiveCapabilities(currentCapabilities); setHotelChats([]);
      setLoadError(""); setLoading(false);
      if (currentCapabilities.includes("stay.message")) {
        const chats = await getMyHotelConversations(accessRole === "owner" ? "property_partner" : "hotel");
        if (generation !== loadGeneration.current) return;
        if (chats.error) { setLoadError("Guest conversations could not be refreshed. Try again before messaging."); return; }
        setHotelChats(chats.conversations.filter(row => Number(row.hotel_id) === Number(hotel.hotel_id)));
      }
    } catch {
      if (generation !== loadGeneration.current) return;
      // Do not leave private stay/team information displayed after revoked access.
      setBookings([]); setHotelChats([]); setRoomUnits([]); setRooms([]); setVenues([]); setInventory([]);
      setLiveCapabilities([]); setActiveChat(null); setEditingRoom(null); setEditingRate(null); setEditingVenue(null);
      setLoadError("Hotel information is unavailable or your access has changed. Please try again.");
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [accessRole, hotel.hotel_id, initialBookingId]);

  useEffect(() => {
    if (!initialBookingId) return;
    setFocusedBooking(initialBookingId); setSection("reservations");
    setReservationFilter("all"); setReservationQuery("");
  }, [initialBookingId]);
  useEffect(() => {
    const reconcile = () => { if (document.visibilityState !== "hidden") void load(true); };
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => { window.removeEventListener("focus", reconcile); document.removeEventListener("visibilitychange", reconcile); };
  }, [load]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`hotel-control:${hotel.hotel_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotel_bookings",
          filter: `hotel_id=eq.${hotel.hotel_id}`,
        },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotel_room_units",
          filter: `hotel_id=eq.${hotel.hotel_id}`,
        },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotel_inventory_daily",
          filter: `hotel_id=eq.${hotel.hotel_id}`,
        },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotel_rate_plans",
          filter: `hotel_id=eq.${hotel.hotel_id}`,
        },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotel_venues",
          filter: `hotel_id=eq.${hotel.hotel_id}`,
        },
        () => void load(true),
      )
      .subscribe();
    return () => {
      loadGeneration.current++;
      void supabase.removeChannel(channel);
    };
  }, [hotel.hotel_id, load]);

  const date = today(hotel.timezone || "Africa/Lagos");
  const metrics = useMemo(() => hotelTodayMetrics(bookings, date), [bookings, date]);
  function openDailyWork(filter: string) {
    setFocusedBooking(undefined); setReservationQuery("");
    if (filter === "available") setSection("availability");
    else { setReservationFilter(filter); setSection("reservations"); }
  }
  const inventoryAsOf = Date.now();
  const dailyRooms = rooms.map(room => ({
    room,
    ...hotelRoomAvailability(room, bookings, inventory, roomUnits, date, inventoryAsOf),
  }));
  const available = dailyRooms.reduce((sum, row) => sum + row.available, 0);
  const filteredBookings = bookings.filter((row) => {
    if (focusedBooking && String(row.booking_id) !== focusedBooking) return false;
    if (!matchesHotelReservationFilter(row, reservationFilter, date)) return false;
    const query = reservationQuery.trim().toLowerCase();
    return (
      !query ||
      [
        row.guest_name,
        row.profiles?.username,
        row.booking_code,
        row.hotel_rooms?.room_type,
        row.rate_plan_name,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  });

  async function transition(
    booking: Booking,
    status: "checked_in" | "checked_out",
  ) {
    setBusy(true);
    const { error } = await supabase.rpc("partner_transition_hotel_booking", {
      p_booking_id: booking.booking_id,
      p_status: status,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(status === "checked_in" ? "Guest checked in" : "Checkout completed");
    await load(true);
  }

  function messageWeHouse() {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "hotel_operations",
          subject: `${hotel.name} operations`,
          contextType: "hotel_operations",
          contextId: String(hotel.hotel_id),
          contextSnapshot: {
            source_type: "hotel_operations",
            source_id: String(hotel.hotel_id),
            hotel_id: hotel.hotel_id,
            hotel_name: hotel.name,
            hotel_status: hotel.status,
          },
        },
      }),
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <header className="flex items-center gap-3 border-b border-white/[.07] pb-4">
        <BackButton onClick={closeRecord} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold uppercase tracking-[.16em] text-violet-300">Hotel</p>
          <h2 className="mt-1 break-words text-lg font-bold">{hotel.name}</h2>
          <p className="mt-0.5 truncate text-sm text-[#A1A7B4]">
            {locationLabel(hotel.address, hotel.city, hotel.state)} · {hotel.status === "active" ? "Live and bookable" : "Not public"}
          </p>
        </div>
        {accessRole === "owner" ? (
          <button type="button" onClick={() => messageWeHouse()} className="shrink-0 rounded-full border border-white/[.09] px-3 py-2 text-sm font-semibold text-[#B9BECA]">WeHouse support</button>
        ) : null}
      </header>

      <div className="space-y-3">
        <nav aria-label="Hotel sections" className="grid grid-cols-3 gap-2 border-b border-white/[.08]">
          {sections.filter(item => ["overview", "reservations", "availability"].includes(item.id)).map(item => <button key={item.id} type="button" aria-current={visibleSection === item.id ? "page" : undefined} onClick={() => { setSection(item.id); if (item.id !== "reservations") setFocusedBooking(undefined); }} className={`min-h-12 border-b-2 px-1 text-sm font-semibold ${visibleSection === item.id ? "border-violet-400 text-violet-300" : "border-transparent text-[#A1A7B4]"}`}>{item.label}</button>)}
        </nav>
        <WeHouseSelect value={["rooms", "details", "team"].includes(visibleSection) ? visibleSection : ""} options={[{ value: "", label: "Hotel setup" }, ...sections.filter(item => ["rooms", "details", "team"].includes(item.id)).map(item => ({ value: item.id, label: item.label }))]} onChange={value => { if (value) { setSection(value); setFocusedBooking(undefined); } }} eyebrow="Hotel setup" title="Manage your hotel" ariaLabel="Hotel setup" />
      </div>
      {visibleSection === "details" && (hotel.images?.length ? (
        <section className="-mx-4 sm:mx-0">
          <PropertyMediaCarousel images={hotel.images} title={hotel.name} />
        </section>
      ) : (
        <section className="border-y border-white/[.08] py-4 text-sm text-[#A1A7B4]">No hotel gallery is published yet</section>
      ))}

      {hotel.status !== "active" ? (
        <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.045] p-4">
          <p className="text-xs font-semibold text-amber-200">Hotel setup is still private</p>
          <p className="mt-1 text-sm leading-5 text-[#8F897F]">Add or correct room types, packages and hotel facilities here. WeHouse publishes this one hotel record after final review. An individual room reservation changes dated inventory only; it does not replace the hotel or complete publication.</p>
        </section>
      ) : null}

      {visibleSection === "details" ? <HotelStayPolicy hotel={hotel} editable={canManagePolicy} /> : null}

      {loadError && <div role="alert" className="mb-4 rounded-xl border border-amber-400/20 p-3 text-sm text-amber-100"><p>{loadError}</p><button onClick={() => void load()} className="min-h-11 font-semibold text-violet-300">Try again</button></div>}
      {loading ? (
        <div className="space-y-3 py-4" role="status" aria-label="Loading hotel operation"><span className="sr-only">Loading hotel operation…</span><div aria-hidden="true" className="h-12 rounded-xl bg-white/[.05] motion-safe:animate-pulse" /><div aria-hidden="true" className="h-20 rounded-xl bg-white/[.05] motion-safe:animate-pulse" /></div>
      ) : (
        <>
          {visibleSection === "overview" && canReadStays ? <section>
            <div className="flex items-end justify-between gap-3">
              <div><h3 className="text-sm font-semibold">Today at the hotel</h3><p className="mt-1 text-sm text-[#A1A7B4]">Arrivals, departures and rooms needing attention.</p></div>
              <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${metrics.attention ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-300"}`}>{metrics.attention ? `${metrics.attention} needs action` : "Up to date"}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[.06] bg-white/[.06] sm:grid-cols-5">
              {([
                ["Rooms available", available, "available"],
                ["Arriving", metrics.arrivals, "arrivals_today"],
                ["Staying", metrics.staying, "staying"],
                ["Leaving", metrics.departures, "departures_today"],
                ["Needs action", metrics.attention, "attention"],
              ] as const).map(([label, value, filter]) => <button type="button" key={label} onClick={() => openDailyWork(filter)} aria-label={`${label}: ${value}`} className="bg-[#0A0A0F] p-4 text-left last:col-span-2 sm:last:col-span-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"><p className="text-xl font-bold">{value}</p><p className="mt-1 text-sm text-[#A1A7B4]">{label} <span aria-hidden="true">›</span></p></button>)}
            </div>
            <TodayRooms rows={dailyRooms} />
          </section> : null}

          {visibleSection === "overview" && !canReadStays ? <p className="text-sm text-[#A1A6B5]">Use the hotel sections to manage the work assigned to you.</p> : null}

          {visibleSection === "availability" && (canReadStays || canMarkRoomsReady) ? (
            <RoomUnitBoard
              units={roomUnits}
              rooms={rooms}
              editable={canMarkRoomsReady}
              onSaved={() => load(true)}
            />
          ) : null}

          {visibleSection === "rooms" && (canManageRoomFacts || canManageRates) ? (
            <section id="rooms-and-rates" className="scroll-mt-20">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div><h3 className="text-base font-bold">Rooms and packages</h3><p className="mt-1 text-sm leading-5 text-[#A1A7B4]">Rates and packages may change for future bookings. Verified room identity, capacity and public media return through WeHouse review after publication.</p></div>
                {canManageRoomFacts ? <button type="button" onClick={() => setEditingRoom("new")} className="shrink-0 rounded-xl bg-violet-500 px-3 py-2.5 text-sm font-semibold">Add room type</button> : null}
              </div>
              <div className="divide-y divide-white/[.07] border-y border-white/[.07]">
                {rooms.map((room) => (
                  <RoomRow key={room.room_id} room={room} canEditRoom={canManageRoomFacts} canManageRates={canManageRates} onEdit={() => setEditingRoom(room)} onRate={(plan) => setEditingRate({ room, plan })} />
                ))}
                {rooms.length === 0 ? <Empty text="No room types yet. Add the first sellable room type here." /> : null}
              </div>
            </section>
          ) : null}

          {visibleSection === "availability" && canManageInventory ? (
            <section id="availability" className="scroll-mt-20">
              <div className="mb-4"><h3 className="text-base font-bold">Availability and daily pricing</h3><p className="mt-1 text-sm leading-5 text-[#A1A7B4]">Set sellable rooms for a date range. Confirmed reservations and active payment holds are deducted automatically.</p></div>
              <div className="divide-y divide-white/[.07] border-y border-white/[.07]">
                {rooms.map((room) => <AvailabilityRow key={room.room_id} room={room} inventory={inventory.find((row) => row.room_id === room.room_id && row.inventory_date === date)} onSaved={() => load(true)} />)}
                {rooms.length === 0 ? <Empty text="Add a room type before setting availability." /> : null}
              </div>
            </section>
          ) : null}

          {visibleSection === "details" && canManagePolicy ? (
            <section id="hotel-venues" className="scroll-mt-20">
              <div className="mb-4 flex items-start justify-between gap-4"><div><h3 className="text-base font-bold">Restaurants and hotel facilities</h3><p className="mt-1 text-sm leading-5 text-[#A1A7B4]">Operating hours and package access may be maintained here. Adding or removing a verified facility after publication requires WeHouse review.</p></div>{hotel.status !== "active" ? <button type="button" onClick={() => setEditingVenue("new")} className="shrink-0 rounded-xl border border-violet-500/25 px-3 py-2.5 text-sm font-semibold text-violet-200">Add place</button> : null}</div>
              {venues.length ? <div className="divide-y divide-white/[.06] border-y border-white/[.06]">{venues.map((venue) => <button type="button" key={venue.venue_id} onClick={() => setEditingVenue(venue)} className="flex w-full items-start justify-between gap-4 py-3 text-left"><span><span className="block text-xs font-semibold">{venue.name}</span><span className="mt-1 block text-sm capitalize text-[#A1A7B4]">{venue.kind}{venue.opening_hours ? ` · ${venue.opening_hours}` : ""}</span>{venue.package_notes ? <span className="mt-1 block text-sm text-emerald-300">Package access: {venue.package_notes}</span> : null}</span><span className={`rounded-full px-2 py-1 text-sm ${venue.active ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#A1A7B4]"}`}>{venue.active ? "Shown" : "Hidden"}</span></button>)}</div> : <Empty text="No named hotel places yet." />}
            </section>
          ) : null}

          {visibleSection === "reservations" && canReadStays ? (
            <section id="reservations" className="scroll-mt-20">
              <div className="mb-4"><h3 className="text-base font-bold">Reservations and guests</h3><p className="mt-1 text-sm leading-5 text-[#A1A7B4]">Manage arrivals, stays and departures.</p></div>
              {focusedBooking ? <div className="mb-3 flex items-center justify-between gap-3 text-xs"><p>{bookings.some(row => String(row.booking_id) === focusedBooking) ? "Linked reservation" : "The linked reservation is unavailable or outside your current access."}</p><button className="min-h-11 shrink-0 text-violet-300" onClick={() => setFocusedBooking(undefined)}>Show all reservations</button></div> : null}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input value={reservationQuery} onChange={(event) => setReservationQuery(event.target.value)} placeholder="Search guest, room, package or booking code" className="h-11 rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none focus:border-violet-500/35" /><WeHouseSelect value={reservationFilter} options={[{ value: "all", label: "All reservations" },{ value: "arrivals_today", label: "Arriving today" },{ value: "departures_today", label: "Leaving today" },{ value: "staying", label: "Staying now" },{ value: "attention", label: "Needs action" },{ value: "pending", label: "Payment holds" },{ value: "confirmed", label: "Confirmed stays" },{ value: "checked_in", label: "Checked in" },{ value: "checked_out", label: "Checked out" },{ value: "payment_conflict", label: "Payment review" },{ value: "cancelled", label: "Cancelled" }]} onChange={setReservationFilter} eyebrow="Reservations" title="Filter reservations" ariaLabel="Filter hotel reservations" /></div>
              <div className="mt-4 divide-y divide-white/[.06] border-y border-white/[.06]">
                {filteredBookings.map((row) => <ReservationRow key={row.booking_id} hotelName={hotel.name} hotel={hotel} row={row} busy={busy} readyRoomAvailable={roomUnits.some((unit) => unit.room_id === row.room_id && unit.status === "ready" && !unit.current_booking_id)} chat={hotelChats.find((item) => Number(item.booking_id) === Number(row.booking_id))} canMessage={canMessageGuests} canCheckIn={capabilities.has("stay.check_in") && capabilities.has("stay.assign_unit")} canCheckOut={capabilities.has("stay.check_out")} onChat={setActiveChat} transition={transition} />)}
                {filteredBookings.length === 0 ? <Empty text={bookings.length ? "No reservations match this search." : "No hotel reservations yet."} /> : null}
              </div>
            </section>
          ) : null}

          {visibleSection === "team" && canManageTeam ? <section id="hotel-team" className="scroll-mt-20"><HotelTeam hotelId={hotel.hotel_id} grantableCapabilities={[...capabilities]} /></section> : null}
        </>
      )}

      {editingRoom ? <RoomEditor hotelId={hotel.hotel_id} room={editingRoom === "new" ? undefined : editingRoom} close={() => setEditingRoom(null)} saved={async () => { setEditingRoom(null); await load(true); }} /> : null}
      {editingRate ? <RatePlanEditor room={editingRate.room} plan={editingRate.plan} close={() => setEditingRate(null)} saved={async () => { setEditingRate(null); await load(true); }} /> : null}
      {editingVenue ? <VenueEditor hotelId={hotel.hotel_id} factsLocked={hotel.status === "active"} venue={editingVenue === "new" ? undefined : editingVenue} close={() => setEditingVenue(null)} saved={async () => { setEditingVenue(null); await load(true); }} /> : null}
      {activeChat && profile ? <HotelBookingChat specialRequest={canReadStays ? bookings.find(row => row.booking_id === activeChat.booking_id)?.special_requests : undefined} hotelView bookingId={activeChat.booking_id} conversationId={activeChat.conversation_id} profile={profile} title={activeChat.guest_name || "Guest"} subtitle={`${hotel.name} · Paid stay`} readOnly={!['confirmed','checked_in'].includes(activeChat.booking_status)} onClose={() => setActiveChat(null)} onUpdated={() => void load(true)} /> : null}
    </div>
  );
}

const HOTEL_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? "30" : "00";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  return { value, label: formatHotelTime(value) };
});

function normalizedHotelTime(value: unknown, fallback: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function formatHotelTime(value: unknown) {
  const normalized = normalizedHotelTime(value, "00:00");
  const [hour, minute] = normalized.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`;
}

function zoneOffsetMilliseconds(moment: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ) - moment.getTime();
}

function hotelMoment(dateValue: string, timeValue: unknown, timeZone: string) {
  const time = normalizedHotelTime(timeValue, "00:00");
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let result = wallClockAsUtc - zoneOffsetMilliseconds(new Date(wallClockAsUtc), timeZone);
  result = wallClockAsUtc - zoneOffsetMilliseconds(new Date(result), timeZone);
  return result;
}

function HotelStayPolicy({ hotel, editable }: { hotel: any; editable: boolean }) {
  const initialCheckIn = normalizedHotelTime(hotel.check_in_time, "14:00");
  const initialCheckOut = normalizedHotelTime(hotel.check_out_time, "12:00");
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [savedValues, setSavedValues] = useState([initialCheckIn, initialCheckOut]);
  const [saving, setSaving] = useState(false);
  const dirty = checkIn !== savedValues[0] || checkOut !== savedValues[1];
  async function save() {
    setSaving(true);
    const { error } = await supabase.rpc("partner_update_hotel_stay_policy", {
      p_hotel_id: hotel.hotel_id,
      p_check_in_time: checkIn,
      p_check_out_time: checkOut,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setSavedValues([checkIn, checkOut]);
    toast.success("Hotel arrival times updated");
  }
  return (
    <section className="border-y border-white/[.07] py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Arrival and departure</h3>
          <p className="mt-1 text-sm leading-4 text-[#A1A7B4]">
            These local hotel times appear throughout booking and control when check-in becomes available.
          </p>
        </div>
        {!editable ? (
          <span className="shrink-0 text-right text-sm text-[#B9BECA]">
            From {formatHotelTime(checkIn)}<br />By {formatHotelTime(checkOut)}
          </span>
        ) : null}
      </div>
      {editable ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-lg">
          <label className="text-sm text-[#A1A7B4]">
            Check-in from
            <select value={checkIn} onChange={(event) => setCheckIn(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs text-white">
              {HOTEL_TIME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-[#A1A7B4]">
            Check-out by
            <select value={checkOut} onChange={(event) => setCheckOut(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs text-white">
              {HOTEL_TIME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {dirty ? <button type="button" disabled={saving} onClick={() => void save()} className="col-span-2 h-11 rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40">{saving ? "Saving times…" : "Save arrival times"}</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function RoomUnitBoard({ units, rooms, editable, onSaved }: { units: HotelRoomUnit[]; rooms: Room[]; editable: boolean; onSaved: () => Promise<void> }) {
  const counts = units.reduce<Record<HotelRoomUnitStatus, number>>((result, unit) => {
    result[unit.status] += 1;
    return result;
  }, { ready: 0, occupied: 0, cleaning: 0, maintenance: 0, out_of_service: 0 });
  return (
    <section id="room-board" className="scroll-mt-20">
      <div className="flex items-end justify-between gap-4">
        <div><h3 className="text-base font-bold">Physical room board</h3><p className="mt-1 text-sm leading-5 text-[#A1A7B4]">Check-in assigns a ready room. Checkout moves that room to cleaning; it cannot be sold as ready again until staff confirms it.</p></div>
        <span className="shrink-0 text-sm font-semibold text-emerald-300">{counts.ready} ready</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[.06] bg-white/[.06] sm:grid-cols-4">
        {([["Occupied", counts.occupied], ["Cleaning", counts.cleaning], ["Maintenance", counts.maintenance], ["Out of service", counts.out_of_service]] as const).map(([label, value]) => <div key={label} className="bg-[#0A0A0F] p-3"><p className="text-sm font-bold">{value}</p><p className="mt-1 text-sm text-[#A1A7B4]">{label}</p></div>)}
      </div>
      <div className="mt-3 divide-y divide-white/[.06] border-y border-white/[.06]">
        {units.map((unit) => <RoomUnitRow key={unit.unit_id} unit={unit} roomName={rooms.find((room) => room.room_id === unit.room_id)?.room_type || "Room"} editable={editable} onSaved={onSaved} />)}
        {!units.length ? <Empty text={rooms.length ? "Physical rooms are being prepared from the room counts." : "Add a room type to create its physical room board."} /> : null}
      </div>
    </section>
  );
}

function RoomUnitRow({ unit, roomName, editable, onSaved }: { unit: HotelRoomUnit; roomName: string; editable: boolean; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(unit.unit_label);
  const [floor, setFloor] = useState(unit.floor_label || "");
  const [status, setStatus] = useState<HotelRoomUnitStatus>(unit.status);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLabel(unit.unit_label); setFloor(unit.floor_label || ""); setStatus(unit.status); }, [unit]);
  const dirty = label.trim() !== unit.unit_label || floor.trim() !== (unit.floor_label || "") || status !== unit.status;
  const occupied = unit.status === "occupied";
  async function save() {
    setSaving(true);
    const { error } = await supabase.rpc("partner_update_hotel_room_unit", { p_unit_id: unit.unit_id, p_unit_label: label.trim(), p_floor_label: floor.trim() || null, p_status: status });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Room state updated");
    await onSaved();
  }
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">{unit.unit_label}</p><p className="mt-1 text-sm text-[#A1A7B4]">{roomName}{unit.floor_label ? ` · ${unit.floor_label}` : ""}</p></div><Status value={unit.status} /></div>
      {editable && !occupied ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_160px_auto]"><input aria-label="Room number or label" value={label} onChange={(event) => setLabel(event.target.value)} className="h-10 rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-sm" /><input aria-label="Floor" value={floor} onChange={(event) => setFloor(event.target.value)} placeholder="Floor (optional)" className="h-10 rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-sm" /><select value={status} onChange={(event) => setStatus(event.target.value as HotelRoomUnitStatus)} className="h-10 rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-sm"><option value="ready">Ready</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select>{dirty ? <button disabled={saving || !label.trim()} onClick={() => void save()} className="col-span-2 h-10 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40 sm:col-span-1">{saving ? "Saving…" : "Save"}</button> : null}</div> : occupied ? <p className="mt-2 text-sm text-[#A1A7B4]">Assigned to the current checked-in stay. Checkout will move it to cleaning.</p> : null}
    </div>
  );
}

function TodayRooms({ rows }: { rows: Array<{ room: Room } & ReturnType<typeof hotelRoomAvailability>> }) {
  return <div className="mt-4 divide-y divide-white/[.06] border-y border-white/[.06]">{rows.map(({ room, occupied, holds, operational, configured, available, closed, setupIncomplete, maintenance }) => (
    <div key={room.room_id} data-room-availability={room.room_id} className="flex items-center justify-between gap-3 py-3">
      <div><p className="text-xs font-semibold">{room.room_type}</p><p className="mt-1 text-sm text-[#A1A7B4]">{occupied} confirmed/staying · {holds} active hold · {operational}/{configured} operational</p></div>
      <div className="text-right"><p className="text-sm font-bold">{available} sellable</p>{closed ? <p className="text-sm text-amber-300">Sales closed today</p> : setupIncomplete ? <p className="text-sm text-amber-300">Room setup incomplete</p> : maintenance > 0 ? <p className="text-sm text-amber-300">Maintenance reduces capacity</p> : null}</div>
    </div>
  ))}{rows.length === 0 ? <Empty text="No room inventory has been added." /> : null}</div>;
}

function RoomRow({ room, canEditRoom, canManageRates, onEdit, onRate }: { room: Room; canEditRoom: boolean; canManageRates: boolean; onEdit: () => void; onRate: (plan?: HotelRatePlan) => void }) {
  const plans = room.rate_plans || [];
  return <article className="py-5"><div className="flex items-start justify-between gap-3"><div><p className="text-base font-semibold">{room.room_type}</p><p className="mt-1 text-sm text-[#777D8D]">{room.total_rooms} units · up to {room.max_guests} guests · {room.bed_type || "Bed not specified"}</p></div>{canEditRoom ? <button onClick={onEdit} className="rounded-full border border-violet-500/20 px-3 py-2 text-sm font-semibold text-violet-300">Edit room</button> : null}</div>{room.images?.length ? <div className="-mx-4 mt-4 sm:mx-0"><PropertyMediaCarousel images={room.images} title={room.room_type} /></div> : <div className="mt-4 grid aspect-[16/8] place-items-center rounded-2xl border border-dashed border-white/[.08] text-sm text-[#666D7E]">No approved room photos</div>}{room.description ? <p className="mt-4 text-sm leading-5 text-[#8C92A1]">{room.description}</p> : null}{room.amenities?.length ? <div className="mt-3 flex flex-wrap gap-2">{room.amenities.map((item) => <span key={item} className="rounded-full border border-white/[.07] px-2.5 py-1 text-sm text-[#A0A5B3]">{item}</span>)}</div> : null}<div className="mt-5"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold">Bookable packages</p><p className="mt-1 text-sm text-[#A1A7B4]">Room-only, breakfast, VIP or other clear choices.</p></div>{canManageRates ? <button type="button" onClick={() => onRate()} className="text-sm font-semibold text-violet-300">Add package</button> : null}</div><div className="mt-2 divide-y divide-white/[.055] border-y border-white/[.055]">{plans.map((plan) => <button type="button" key={plan.rate_plan_id} disabled={!canManageRates} onClick={() => onRate(plan)} className="flex w-full items-start justify-between gap-3 py-3 text-left disabled:cursor-default"><span><span className="block text-sm font-semibold">{plan.name}</span><span className="mt-1 block text-sm text-[#A1A7B4]">{mealLabel(plan.meal_plan)} · {plan.refundable ? `${plan.cancellation_hours || 0}h cancellation` : "Non-refundable"}</span>{plan.included_features?.length ? <span className="mt-1 block text-sm text-emerald-300">{plan.included_features.join(" · ")}</span> : null}</span><span className="shrink-0 text-right"><span className="block text-sm font-bold text-violet-200">{money(plan.price_per_night)}</span><span className={`mt-1 block text-sm ${plan.active ? "text-emerald-300" : "text-[#A1A7B4]"}`}>{plan.active ? "Bookable" : "Hidden"}</span></span></button>)}{plans.length === 0 ? <Empty text="No package is available for this room." /> : null}</div></div></article>;
}

function AvailabilityRow({ room, inventory, onSaved }: { room: Room; inventory?: Inventory; onSaved: () => Promise<void> }) {
  const [start, setStart] = useState(today()); const [end, setEnd] = useState(today()); const [quantity, setQuantity] = useState(String(inventory?.available_quantity ?? room.total_rooms)); const [closed, setClosed] = useState(Boolean(inventory?.closed)); const [rate, setRate] = useState(inventory?.rate_override ? String(inventory.rate_override) : ""); const [note, setNote] = useState(inventory?.note || ""); const [saving, setSaving] = useState(false);
  useEffect(() => { setQuantity(String(inventory?.available_quantity ?? room.total_rooms)); setClosed(Boolean(inventory?.closed)); setRate(inventory?.rate_override ? String(inventory.rate_override) : ""); setNote(inventory?.note || ""); }, [inventory?.available_quantity, inventory?.closed, inventory?.note, inventory?.rate_override, room.total_rooms]);
  async function save() { const available = Number(quantity); if (!Number.isInteger(available) || available < 0 || available > room.total_rooms) return toast.error(`Sellable rooms must be between 0 and ${room.total_rooms}`); if (!start || !end || end < start) return toast.error("Choose a valid date range"); if (rate && Number(rate) <= 0) return toast.error("Daily price must be positive"); setSaving(true); const { error } = await supabase.rpc("partner_set_hotel_inventory_range", { p_room_id: room.room_id, p_start_date: start, p_end_date: end, p_available_quantity: available, p_closed: closed, p_rate_override: rate ? Number(rate) : null, p_note: note.trim() || null }); setSaving(false); if (error) return toast.error(error.message); toast.success("Availability and pricing updated"); await onSaved(); }
  return <article className="py-5"><div><p className="text-sm font-semibold">{room.room_type}</p><p className="mt-1 text-sm text-[#A1A7B4]">{room.total_rooms} physical units · {inventory?.closed ? "sales closed today" : `${inventory?.available_quantity ?? room.total_rooms} offered today`}</p></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="From" value={start} set={setStart} type="date" /><Field label="To" value={end} set={setEnd} type="date" /><Field label="Rooms offered" value={quantity} set={setQuantity} type="number" /><Field label="Base daily price override" value={rate} set={setRate} type="number" placeholder="Keep package prices" /></div><label className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-white/[.07] px-3 text-sm"><input type="checkbox" checked={closed} onChange={(event) => setClosed(event.target.checked)} className="accent-violet-500" />Close room sales for this range</label><label className="mt-2 block"><span className="mb-1 block text-sm text-[#A1A7B4]">Internal note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this range changed" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none" /></label><button onClick={() => void save()} disabled={saving} className="mt-2 min-h-11 w-full rounded-xl border border-violet-500/20 text-sm font-semibold text-violet-300 disabled:opacity-40">{saving ? "Updating…" : "Save availability"}</button></article>;
}

function RoomEditor({ hotelId, room, close, saved }: { hotelId: number; room?: Room; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: room?.room_type || "", description: room?.description || "", price: room ? String(room.price_per_night) : "", guests: room ? String(room.max_guests) : "2", bed: room?.bed_type || "", quantity: room ? String(room.total_rooms) : "1" }); const [amenities, setAmenities] = useState<string[]>(room?.amenities || []); const [images, setImages] = useState<string[]>(room?.images || []); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false);
  function toggleAmenity(item: string) { setAmenities((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]); }
  async function save() { if (!form.name.trim() || Number(form.price) <= 0 || Number(form.guests) < 1 || Number(form.quantity) < 1) return toast.error("Room name, price, guests and unit count are required"); setBusy(true); try { let current = room; if (!current) { const created = await partnerCreateHotelRoom({ hotel_id: hotelId, room_type: form.name.trim(), description: form.description.trim() || null, price_per_night: Number(form.price), max_guests: Number(form.guests), bed_type: form.bed.trim() || null, total_rooms: Number(form.quantity), amenities, images }); if (created.error || !created.room) throw created.error || new Error("Room could not be created"); current = created.room as Room; } const uploaded = await Promise.all(files.map(async (file) => { const result = await uploadRoomImage(file, hotelId, current!.room_id); if (result.error || !result.url) throw result.error || new Error("Photo could not be uploaded"); return result.url; })); const nextImages = [...images, ...uploaded]; const { error } = await supabase.rpc("partner_update_hotel_room", { p_room_id: current.room_id, p_room_type: form.name.trim(), p_description: form.description.trim() || null, p_price_per_night: Number(form.price), p_max_guests: Number(form.guests), p_bed_type: form.bed.trim() || null, p_total_rooms: Number(form.quantity), p_amenities: amenities, p_images: nextImages }); if (error) throw error; toast.success(room ? "Room type updated" : "Room type added"); await saved(); } catch (error: any) { toast.error(error?.message || "Room could not be saved"); } finally { setBusy(false); } }
  return <Sheet title={room ? "Edit room type" : "Add room type"} subtitle="Room details, gallery and inventory stay together." close={close}><div className="grid gap-3 sm:grid-cols-2"><Field label="Room name" value={form.name} set={(value) => setForm({ ...form, name: value })} /><Field label="Starting nightly rate" value={form.price} set={(value) => setForm({ ...form, price: value })} type="number" /><Field label="Guest capacity" value={form.guests} set={(value) => setForm({ ...form, guests: value })} type="number" /><Field label="Physical units" value={form.quantity} set={(value) => setForm({ ...form, quantity: value })} type="number" /><Field label="Bed configuration" value={form.bed} set={(value) => setForm({ ...form, bed: value })} /><label className="sm:col-span-2"><span className="mb-1 block text-sm text-[#A1A7B4]">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="w-full resize-none rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none" /></label></div><div className="mt-4"><p className="text-sm font-semibold">Amenities</p><div className="mt-2 flex flex-wrap gap-2">{ROOM_AMENITIES.map((item) => <button type="button" key={item} onClick={() => toggleAmenity(item)} className={`rounded-full border px-2.5 py-1.5 text-sm ${amenities.includes(item) ? "border-violet-400/35 bg-violet-500/10 text-violet-200" : "border-white/[.07] text-[#858B9A]"}`}>{item}</button>)}</div></div><div className="mt-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Room gallery · {images.length + files.length}/12</p><label className="cursor-pointer text-sm font-semibold text-violet-300">Add photos<input hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files || [])].slice(0, Math.max(0, 12 - images.length)))} /></label></div>{images.length ? <div className="mt-2 grid grid-cols-3 gap-2">{images.map((src, index) => <div key={src} className="relative aspect-square overflow-hidden rounded-xl"><img src={src} alt={`Room photo ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/75" aria-label={`Remove room photo ${index + 1}`}>×</button></div>)}</div> : null}{files.length ? <div className="mt-2 space-y-1">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg bg-white/[.035] px-3 py-2 text-sm"><span className="truncate">{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-red-300">Remove</button></div>)}</div> : null}{!images.length && !files.length ? <p className="mt-2 rounded-xl border border-dashed border-white/[.08] p-4 text-center text-sm text-[#676E7E]">Select clear photos of this exact room type.</p> : null}</div><button type="button" onClick={() => void save()} disabled={busy} className="mt-5 h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{busy ? "Saving room…" : room ? "Save room type" : "Add room type"}</button></Sheet>;
}

function RatePlanEditor({ room, plan, close, saved }: { room: Room; plan?: HotelRatePlan; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: plan?.name || "", description: plan?.description || "", price: plan ? String(plan.price_per_night) : String(room.price_per_night), meal: plan?.meal_plan || "room_only", refundable: plan?.refundable || false, cancellation: plan?.cancellation_hours ? String(plan.cancellation_hours) : "24", features: (plan?.included_features || []).join(", "), active: plan?.active ?? true }); const [busy, setBusy] = useState(false);
  async function save() { if (!form.name.trim() || Number(form.price) <= 0) return toast.error("Package name and nightly price are required"); setBusy(true); const result = await partnerSaveHotelRatePlan({ rate_plan_id: plan?.rate_plan_id, hotel_id: room.hotel_id, room_id: room.room_id, name: form.name.trim(), description: form.description.trim() || null, meal_plan: form.meal as HotelRatePlan["meal_plan"], payment_timing: "pay_now", refundable: form.refundable, cancellation_hours: form.refundable ? Number(form.cancellation) : null, price_per_night: Number(form.price), included_features: words(form.features), active: form.active }); setBusy(false); if (result.error) return toast.error(result.error.message); toast.success(plan ? "Package updated" : "Package added"); await saved(); }
  return <Sheet title={plan ? "Edit room package" : "Add room package"} subtitle={`${room.room_type} · guests choose one package before dates and payment.`} close={close}><div className="grid gap-3 sm:grid-cols-2"><Field label="Package name" value={form.name} set={(value) => setForm({ ...form, name: value })} placeholder="VIP with breakfast" /><Field label="Nightly price" value={form.price} set={(value) => setForm({ ...form, price: value })} type="number" /><label><span className="mb-1 block text-sm text-[#A1A7B4]">Meal plan</span><select value={form.meal} onChange={(event) => setForm({ ...form, meal: event.target.value as HotelRatePlan["meal_plan"] })} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs"><option value="room_only">Room only</option><option value="breakfast">Breakfast included</option><option value="half_board">Breakfast + one meal</option><option value="full_board">All daily meals</option><option value="all_inclusive">All inclusive</option></select></label><label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/[.08] px-3 text-sm"><input type="checkbox" checked={form.refundable} onChange={(event) => setForm({ ...form, refundable: event.target.checked })} className="accent-violet-500" />Refundable package</label>{form.refundable ? <Field label="Cancel up to hours before arrival" value={form.cancellation} set={(value) => setForm({ ...form, cancellation: value })} type="number" /> : null}<Field label="Included features (comma separated)" value={form.features} set={(value) => setForm({ ...form, features: value })} placeholder="Airport pickup, lounge access" /><label className="sm:col-span-2"><span className="mb-1 block text-sm text-[#A1A7B4]">Package description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="w-full resize-none rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none" /></label>{plan ? <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/[.08] px-3 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="accent-violet-500" />Visible and bookable</label> : null}</div><p className="mt-3 rounded-xl bg-white/[.025] p-3 text-sm leading-4 text-[#A1A7B4]">Guests pay securely through WeHouse. Package changes apply to future bookings.</p><button type="button" onClick={() => void save()} disabled={busy} className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{busy ? "Saving package…" : "Save package"}</button></Sheet>;
}

function VenueEditor({ hotelId, venue, factsLocked, close, saved }: { hotelId: number; venue?: HotelVenue; factsLocked: boolean; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: venue?.name || "", kind: venue?.kind || "restaurant", description: venue?.description || "", hours: venue?.opening_hours || "", packageNotes: venue?.package_notes || "", active: venue?.active ?? true }); const [busy, setBusy] = useState(false);
  async function save() { if (!form.name.trim()) return toast.error("Place name is required"); setBusy(true); const result = await partnerSaveHotelVenue({ venue_id: venue?.venue_id, hotel_id: hotelId, name: form.name.trim(), kind: form.kind as HotelVenue["kind"], description: form.description.trim() || null, opening_hours: form.hours.trim() || null, package_notes: form.packageNotes.trim() || null, active: form.active }); setBusy(false); if (result.error) return toast.error(result.error.message); toast.success(venue ? "Hotel place updated" : "Hotel place added"); await saved(); }
  return <Sheet title={venue ? "Edit hotel place" : "Add hotel place"} subtitle={factsLocked ? "Verified name, type and description are locked; operating hours and package access remain editable." : "Restaurants and facilities are separate named parts of the hotel."} close={close}><div className="grid gap-3 sm:grid-cols-2"><fieldset disabled={factsLocked}><Field label="Name" value={form.name} set={(value) => setForm({ ...form, name: value })} placeholder="Jamo-Afrique Restaurant" /></fieldset><label><span className="mb-1 block text-sm text-[#A1A7B4]">Type</span><select disabled={factsLocked} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as HotelVenue["kind"] })} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs disabled:opacity-55">{["restaurant", "bar", "cafe", "spa", "lounge", "pool", "gym", "other"].map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label><Field label="Opening hours" value={form.hours} set={(value) => setForm({ ...form, hours: value })} placeholder="06:30–22:00 daily" /><Field label="Included package access" value={form.packageNotes} set={(value) => setForm({ ...form, packageNotes: value })} placeholder="Breakfast and VIP packages" /><label className="sm:col-span-2"><span className="mb-1 block text-sm text-[#A1A7B4]">Description</span><textarea disabled={factsLocked} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="w-full resize-none rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none disabled:opacity-55" /></label>{venue ? <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/[.08] px-3 text-sm"><input disabled={factsLocked} type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="accent-violet-500" />Show to guests</label> : null}</div><button type="button" onClick={() => void save()} disabled={busy} className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{busy ? "Saving…" : "Save hotel place"}</button></Sheet>;
}

function ReservationRow({ hotelName, hotel, row, busy, readyRoomAvailable, chat, canMessage, canCheckIn: hasCheckInCapability, canCheckOut: hasCheckOutCapability, onChat, transition }: { hotelName: string; hotel: any; row: Booking; busy: boolean; readyRoomAvailable: boolean; chat?: HotelConversation; canMessage: boolean; canCheckIn: boolean; canCheckOut: boolean; onChat: (chat: ActiveHotelChat) => void; transition: (row: Booking, status: "checked_in" | "checked_out") => Promise<void> }) {
  const holdExpired = row.status === "pending" && new Date(row.payment_expires_at || 0).getTime() <= Date.now();
  const effectiveStatus = holdExpired ? "expired" : row.status;
  const timeZone = hotel.timezone || "Africa/Lagos";
  const arrivalTime = hotelMoment(row.check_in, hotel.check_in_time || "14:00", timeZone);
  const departureTime = hotelMoment(row.check_out, hotel.check_out_time || "12:00", timeZone);
  const canCheckIn = hasCheckInCapability && effectiveStatus === "confirmed" && row.payment_status === "paid" && Date.now() >= arrivalTime && Date.now() < departureTime && readyRoomAvailable;
  const canCheckOut = hasCheckOutCapability && effectiveStatus === "checked_in" && row.payment_status === "paid";
  const guestChatWritable = canMessage && row.payment_status === "paid" && ["confirmed", "checked_in"].includes(row.status);
  const guestChatReadable = canMessage && Boolean(chat) && ["checked_out", "completed"].includes(row.status);
  const next = effectiveStatus === "pending"
    ? "Room is held only while secure payment is live"
    : effectiveStatus === "confirmed" && Date.now() < arrivalTime
      ? `Check-in opens ${new Date(arrivalTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
      : effectiveStatus === "confirmed" && !readyRoomAvailable
        ? "Mark a cleaned room ready before check-in"
        : canCheckIn
          ? "Guest and a ready room are eligible for check-in"
          : effectiveStatus === "checked_in"
            ? "Guest is staying; checkout is available when they depart"
            : ["completed", "checked_out"].includes(effectiveStatus)
              ? "Stay finished; the assigned room is now in cleaning"
              : effectiveStatus === "payment_conflict"
                ? "Payment was received but inventory needs WeHouse review"
                : "No guest action is available";
  return (
    <article className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.guest_name || row.profiles?.username || "Guest"}</p>
          <p className="mt-1 text-sm text-[#A1A7B4]">{hotelName} · {row.hotel_rooms?.room_type || "Room"} · {row.rate_plan_name || "Room package"}</p>
          <p className="mt-1 text-sm text-[#A1A7B4]">{row.guest_count} guest{row.guest_count === 1 ? "" : "s"} · {new Date(`${row.check_in}T00:00:00`).toLocaleDateString()} from {formatHotelTime(hotel.check_in_time || "14:00")}</p>
          <p className="mt-1 text-sm text-[#A1A7B4]">Checkout {new Date(`${row.check_out}T00:00:00`).toLocaleDateString()} by {formatHotelTime(hotel.check_out_time || "12:00")}</p>
        </div>
        <div className="shrink-0 text-right"><Status value={effectiveStatus} /><p className="mt-2 text-xs font-bold">{money(row.total_price)}</p><p className={`mt-1 text-sm ${row.payment_status === "paid" ? "text-emerald-300" : "text-amber-200"}`}>{hotelPaymentLabel(effectiveStatus, row.payment_status)}</p></div>
      </div>
      <p className="mt-3 text-sm text-[#858B9A]">{next}</p>
      <HotelSpecialRequest request={row.special_requests} hotelView />
      <div className="mt-3 flex flex-wrap gap-2">
        {guestChatWritable || guestChatReadable ? <button onClick={() => onChat({ ...(chat || { booking_id: row.booking_id }), guest_name: row.guest_name || row.profiles?.username || "Guest", booking_status: row.status })} className="h-10 flex-1 rounded-xl border border-violet-500/20 bg-violet-500/[.07] px-3 text-sm font-semibold text-violet-200">{guestChatReadable ? "View message history" : chat ? `Guest messages${chat.unread_count > 0 ? ` · ${chat.unread_count} new` : ""}` : "Message guest"}</button> : null}
        {canCheckIn ? <button disabled={busy} onClick={() => void transition(row, "checked_in")} className="h-10 flex-1 rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40">Check in guest</button> : null}
        {canCheckOut ? <button disabled={busy} onClick={() => void transition(row, "checked_out")} className="h-10 flex-1 rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40">Complete checkout</button> : null}
      </div>
    </article>
  );
}

type HotelTeamRow = { id: string; member_user_id: string; hotel_role: "manager" | "front_desk"; status: "invited" | "active"; capabilities: HotelCapability[]; name: string; username?: string | null };
function HotelTeam({ hotelId, grantableCapabilities }: { hotelId: number; grantableCapabilities: HotelCapability[] }) {
  const [rows, setRows] = useState<HotelTeamRow[]>([]); const [identifier, setIdentifier] = useState(""); const [role, setRole] = useState<"manager" | "front_desk">("front_desk"); const [saving, setSaving] = useState(false); const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(async () => { const { data, error } = await supabase.rpc("get_my_hotel_team", { p_hotel_id: hotelId }); if (error) return toast.error(error.message); setRows(Array.isArray(data) ? data : []); }, [hotelId]);
  useEffect(() => { void load(); }, [load]);
  async function invite() { if (!identifier.trim()) return toast.error("Enter a WeHouse username or user ID"); setSaving(true); const { error } = await supabase.rpc("create_hotel_team_invitation", {
      p_hotel_id: hotelId,
      p_role: role,
      p_identifier: identifier.trim(),
      p_delivery: "direct",
    }); setSaving(false); if (error) return toast.error(error.message); setIdentifier(""); toast.success("Invitation sent. Access starts only after acceptance."); await load(); }
  async function remove(row: HotelTeamRow) { setRemoving(row.id); const { error } = await supabase.rpc("owner_revoke_hotel_team_member", { p_membership_id: row.id }); setRemoving(null); if (error) return toast.error(error.message); toast.success(row.status === "invited" ? "Invitation cancelled" : "Hotel access removed"); await load(); }
  return <div className="space-y-5"><section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4"><h3 className="text-base font-bold">Hotel team</h3><p className="mt-1 text-sm leading-relaxed text-[#6D7485]">Invite an existing WeHouse account directly, or create a single-use link. Access starts only after acceptance.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_auto]"><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="@username or WH user ID" autoCapitalize="none" autoCorrect="off" className="h-11 rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none focus:border-violet-500/35" /><select value={role} onChange={(event) => setRole(event.target.value as "manager" | "front_desk")} className="h-11 rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs"><option value="manager">Manager</option><option value="front_desk">Front desk</option></select><button disabled={saving} onClick={() => void invite()} className="h-11 rounded-xl bg-violet-500 px-5 text-xs font-semibold disabled:opacity-40">{saving ? "Sending…" : "Send invite"}</button></div><button type="button" disabled={saving} onClick={() => void shareInvite()} className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.02] text-xs font-semibold text-[#B9BECA] disabled:opacity-40">Share invite link for {role === "manager" ? "Manager" : "Front desk"}</button><div className="mt-3 grid grid-cols-2 gap-2 text-sm leading-4 text-[#A1A7B4]"><p className="rounded-xl bg-white/[.025] p-2.5"><strong className="block text-[#B7BCC8]">Manager</strong>Reservations, guest messages, check-in/out, rooms, packages and availability</p><p className="rounded-xl bg-white/[.025] p-2.5"><strong className="block text-[#B7BCC8]">Front desk</strong>Reservations, guest messages, room readiness, check-in and checkout</p></div><p className="mt-3 text-[9px] leading-4 text-[#686F80]">Team access never transfers hotel ownership or payout authority.</p></section>{rows.length === 0 ? <Empty text="No pending invitations or active team members." /> : <div className="divide-y divide-white/[.06] border-y border-white/[.06]">{rows.map((row) => <HotelTeamMemberRow key={row.id} row={row} grantableCapabilities={grantableCapabilities} removing={removing === row.id} onRemove={() => void remove(row)} onSaved={load} />)}</div>}</div>;
}

function HotelTeamMemberRow({ row, grantableCapabilities, removing, onRemove, onSaved }: { row: HotelTeamRow; grantableCapabilities: HotelCapability[]; removing: boolean; onRemove: () => void; onSaved: () => Promise<unknown> }) {
  const [selected, setSelected] = useState<HotelCapability[]>(row.capabilities || []);
  const [saving, setSaving] = useState(false);
  useEffect(() => setSelected(row.capabilities || []), [row.capabilities]);
  const dirty = [...selected].sort().join("|") !== [...(row.capabilities || [])].sort().join("|");
  function toggle(capability: HotelCapability) {
    setSelected((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability]);
  }
  async function saveCapabilities() {
    setSaving(true);
    const { error } = await supabase.rpc("owner_set_hotel_team_capabilities", { p_membership_id: row.id, p_capabilities: selected });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Hotel permissions updated");
    await onSaved();
  }
  return <article className="py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-200">{(row.name || row.username || "W").slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.name}</p><p className="mt-1 truncate text-sm text-[#687080]">{row.username ? `@${row.username}` : row.member_user_id}</p></div><div className="text-right"><span className={`rounded-full px-2 py-1 text-sm font-semibold ${row.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-200"}`}>{row.status === "active" ? (row.hotel_role === "manager" ? "Manager" : "Front desk") : "Awaiting acceptance"}</span><button disabled={removing} onClick={onRemove} className="mt-2 block w-full text-sm font-semibold text-red-300 disabled:opacity-40">{removing ? "Updating…" : row.status === "invited" ? "Cancel" : "Remove"}</button></div></div><details className="mt-3 rounded-xl border border-white/[.06] p-3"><summary className="cursor-pointer text-sm font-semibold text-violet-200">Permissions · {selected.length}</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{grantableCapabilities.map((capability) => <label key={capability} className="flex min-h-9 items-center gap-2 text-sm text-[#9AA0AF]"><input type="checkbox" checked={selected.includes(capability)} onChange={() => toggle(capability)} className="accent-violet-500" />{HOTEL_CAPABILITY_LABELS[capability]}</label>)}</div>{dirty ? <button type="button" disabled={saving} onClick={() => void saveCapabilities()} className="mt-3 h-10 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40">{saving ? "Saving permissions…" : "Save permissions"}</button> : null}</details></article>;
}

function Sheet({ title, subtitle, close, children }: { title: string; subtitle: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[100030] flex items-end bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onClick={close}><section className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-white/[.08] bg-[#11151D] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-bold">{title}</h3><p className="mt-1 text-sm leading-4 text-[#A1A7B4]">{subtitle}</p></div><button type="button" onClick={close} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.05] text-lg" aria-label="Close">×</button></div><div className="mt-5">{children}</div></section></div>; }
function Field({ label, value, set, type = "text", placeholder }: { label: string; value: string; set: (value: string) => void; type?: string; placeholder?: string }) { return <label><span className="mb-1 block text-sm text-[#A1A7B4]">{label}</span><input type={type} min={type === "date" ? today() : type === "number" ? "0" : undefined} value={value} placeholder={placeholder} onChange={(event) => set(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none" /></label>; }
function Status({ value }: { value: string }) {
  const unitLabels: Record<string, string> = { ready: "Ready", occupied: "Occupied", cleaning: "Cleaning", maintenance: "Maintenance", out_of_service: "Out of service" };
  const tone = value === "payment_conflict" || value === "out_of_service"
    ? "bg-red-500/10 text-red-300"
    : ["confirmed", "checked_in", "ready"].includes(value)
      ? "bg-emerald-500/10 text-emerald-300"
      : ["pending", "cleaning", "maintenance"].includes(value)
        ? "bg-amber-500/10 text-amber-200"
        : "bg-white/[.05] text-[#858B9A]";
  return <span className={`inline-flex rounded-full px-2 py-1 text-sm font-semibold ${tone}`}>{HOTEL_STATUS[value] || unitLabels[value] || "Status unavailable"}</span>;
}
function Empty({ text }: { text: string }) { return <p className="py-10 text-center text-sm text-[#A1A7B4]">{text}</p>; }
function mealLabel(value: HotelRatePlan["meal_plan"]) { return { room_only: "Room only", breakfast: "Breakfast included", half_board: "Breakfast + one meal", full_board: "All daily meals", all_inclusive: "All inclusive" }[value]; }
