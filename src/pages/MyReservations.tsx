import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import {
  cancelReservation,
  createInspectionRequest,
  getInspectionRequestsForUser,
  getReservationsForUser,
  initializeReservationPayment,
} from "@/lib/supabase/reservations";
import {
  initializeApartmentRentPayment,
  initializeShortStayPayment,
} from "@/lib/supabase/housing-payments";
import {
  getHotelBookingsForUser,
  initializeHotelBookingPayment,
  updateBookingStatus,
} from "@/lib/supabase/hotels";
import type { Profile } from "@/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import HotelBookingChat from "@/components/HotelBookingChat";
import { BOOKING_STATUS_LABELS, getMyBookingConversations } from "@/lib/supabase/worker-bookings";
import BackButton from "@/components/BackButton";
import { directionsUrl } from "@/hooks/useDiscoveryLocation";
import WeHouseSelect from "@/components/WeHouseSelect";
import PropertyBookingJourney from "@/components/PropertyBookingJourney";
import { getPropertyBookingJourney } from "@/lib/propertyBookingLifecycle";

type Props = { profile: Profile; initialBookingId?:string|null; onInitialBookingConsumed?:()=>void; onOpenConversation?:(id:string)=>void; onOpenListing?:(id:string)=>void };
type View = "all" | "housing" | "hotels" | "services";
type BookingItem = { kind: "housing" | "hotel" | "service"; row: any; date: string };
type BookingGroup = "action" | "active" | "history";
type BookingSourceErrors = Partial<Record<"housing" | "hotels" | "services", string>>;
const VIEW_OPTIONS = [
  { value: "all", label: "All bookings", description: "Apartments, hotels and WeHouse Services" },
  { value: "housing", label: "Apartments", description: "Short lets and long-let tenancies" },
  { value: "hotels", label: "Hotels", description: "Hotel rooms and stay packages" },
  { value: "services", label: "WeHouse Services", description: "Jobs booked with professionals" },
] as const;
const money = (v: unknown) => `₦${Number(v || 0).toLocaleString()}`;
const date = (v: any) => (v ? new Date(v).toLocaleDateString() : "—");
const isUnpaidHousingDraft = (row: any) =>
  ["cancelled", "expired"].includes(String(row.status || "")) &&
  !row.paid_at &&
  !["paid", "completed"].includes(String(row.manual_payment_status || ""));
const isUnpaidHotelDraft = (row: any) =>
  ["cancelled", "expired"].includes(String(row.status || "")) &&
  !row.paid_at &&
  String(row.payment_status || "") !== "paid";
const HOUSING_STATUS: Record<string, string> = {
  payment_pending: "Payment pending",
  reserved: "Reserved",
  inspection_pending: "Inspection in progress",
  ready_for_move_in: "Ready for move-in",
  occupied: "Occupied",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
  payment_conflict: "Payment review",
};
const HOTEL_STATUS: Record<string, string> = {
  pending: "Awaiting payment",
  confirmed: "Stay confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  completed: "Stay completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  expired: "Expired",
  payment_conflict: "Payment review",
};

export default function MyReservations({ profile, initialBookingId, onInitialBookingConsumed }: Props) {
  const openedInitialRef=useRef<string|null>(null);
  const [housing, setHousing] = useState<any[]>([]),
    [hotels, setHotels] = useState<any[]>([]),
    [services, setServices] = useState<any[]>([]),
    [inspections, setInspections] = useState<any[]>([]),
    [view, setView] = useState<View>("all"),
    [sourceErrors, setSourceErrors] = useState<BookingSourceErrors>({}),
    [loading, setLoading] = useState(true),
    [activeHousing, setActiveHousing] = useState<any | null>(null),
    [activeHotel, setActiveHotel] = useState<any | null>(null),
    [activeHotelChat, setActiveHotelChat] = useState<any | null>(null),
    [activeService, setActiveService] = useState<{conversationId:string;bookingId:string}|null>(null),
    [busyId, setBusyId] = useState<string | null>(null),
    [pending, setPending] = useState<{
      kind: "cancel_housing" | "cancel_hotel";
      row: any;
    } | null>(null);
  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [housingResult, hotelResult, serviceResult, inspectionResult] = await Promise.allSettled([
        getReservationsForUser(profile.user_id),
        getHotelBookingsForUser(profile.user_id),
        getMyBookingConversations(profile.user_id),
        getInspectionRequestsForUser(profile.user_id),
      ]);
      const nextErrors: BookingSourceErrors = {};
      if (housingResult.status === "fulfilled") {
        if (housingResult.value.reservations) {
          const nextHousing = housingResult.value.reservations.filter((row: any) => !isUnpaidHousingDraft(row));
          setHousing(nextHousing);
          setActiveHousing((current: any) => current
            ? nextHousing.find((row: any) => String(row.id) === String(current.id)) || current
            : current);
        }
        if (housingResult.value.error)
          nextErrors.housing = "Apartment bookings could not be fully refreshed.";
      } else nextErrors.housing = "Apartment bookings could not be refreshed.";
      if (hotelResult.status === "fulfilled") {
        if (!hotelResult.value.error)
          setHotels((hotelResult.value.bookings || []).filter((row: any) => !isUnpaidHotelDraft(row)));
        else nextErrors.hotels = "Hotel stays could not be refreshed.";
      } else nextErrors.hotels = "Hotel stays could not be refreshed.";
      if (serviceResult.status === "fulfilled") {
        if (!serviceResult.value.error)
          setServices(serviceResult.value.conversations || []);
        else nextErrors.services = "WeHouse Services could not be refreshed.";
      } else nextErrors.services = "WeHouse Services could not be refreshed.";
      if (inspectionResult.status === "fulfilled") {
        if (!inspectionResult.value.error)
          setInspections(inspectionResult.value.inspections || []);
        else nextErrors.housing ||= "Apartment inspection updates could not be refreshed.";
      } else nextErrors.housing ||= "Apartment inspection updates could not be refreshed.";
      setSourceErrors(nextErrors);
    } finally {
      setBusyId(null);
      if (!quiet) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => void load(true);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [profile.user_id]);
  useEffect(()=>{
    if(!initialBookingId||loading||openedInitialRef.current===initialBookingId)return;
    const housingMatch=housing.find(row=>String(row.id)===initialBookingId||String(row.reservation_code||'')===initialBookingId||String(row.listing_id||'')===initialBookingId);
    if(housingMatch){openedInitialRef.current=initialBookingId;setActiveHousing(housingMatch);onInitialBookingConsumed?.();return}
    const hotelMatch=hotels.find(row=>String(row.id||row.booking_id)===initialBookingId||String(row.reservation_code||row.booking_code||'')===initialBookingId);
    if(hotelMatch){openedInitialRef.current=initialBookingId;setActiveHotel(hotelMatch);onInitialBookingConsumed?.();return}
    const serviceMatch=services.find(row=>String(row.booking_id)===initialBookingId||String(row.conversation_id)===initialBookingId||String(row.booking_code||'')===initialBookingId);
    if(serviceMatch){openedInitialRef.current=initialBookingId;setActiveService({conversationId:serviceMatch.conversation_id,bookingId:serviceMatch.booking_id});onInitialBookingConsumed?.();return}
    openedInitialRef.current=initialBookingId;
    onInitialBookingConsumed?.();
  },[initialBookingId,loading,housing,hotels,services,onInitialBookingConsumed]);
  const rows = useMemo(
    () =>
      [
        ...housing.map((row) => ({
          kind: "housing" as const,
          row,
          date: row.created_at || "",
        })),
        ...hotels.map((row) => ({
          kind: "hotel" as const,
          row,
          date: row.created_at || "",
        })),
        ...services.map((row) => ({
          kind: "service" as const,
          row,
          date: row.updated_at || "",
        })),
      ].filter((item) => view === "all" || (view === "housing" ? item.kind === "housing" : view === "hotels" ? item.kind === "hotel" : item.kind === "service")).sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
    [housing, hotels, services, view],
  );
  const sections = useMemo(() => {
    const groups: Record<BookingGroup, BookingItem[]> = {
      action: [],
      active: [],
      history: [],
    };
    for (const item of rows as BookingItem[]) groups[bookingGroup(item)].push(item);
    return [
      { id: "action" as const, label: "Needs your action", items: groups.action },
      { id: "active" as const, label: "Active & upcoming", items: groups.active },
      { id: "history" as const, label: "History", items: groups.history },
    ].filter((section) => section.items.length > 0);
  }, [rows]);
  async function cancelHousing(row: any) {
    setBusyId(row.id);
    const { error } = await cancelReservation(row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Reservation cancelled");
    await load();
  }
  async function cancelHotel(row: any) {
    const id = Number(row.booking_id);
    setBusyId(`hotel-${id}`);
    const { error } = await updateBookingStatus(id, "cancelled");
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Hotel reservation cancelled");
    await load();
  }
  async function payHotel(row:any){
    const id=Number(row.booking_id);setBusyId(`hotel-${id}`);
    const{result,error}=await initializeHotelBookingPayment(id);
    if(error||!result?.success){setBusyId(null);return toast.error(error?.message||result?.error||"Could not open secure payment")}
    if(result.already_paid){toast.success("Hotel payment already confirmed");await load();return}
    if(!result.authorization_url){setBusyId(null);return toast.error("Secure checkout link is missing")}
    window.location.assign(String(result.authorization_url));
  }
  async function continueHousing(row: any) {
    if (!row.payment_reference) return toast.error("This reservation cannot be resumed. Start again from the apartment.");
    setBusyId(row.id);
    const { result } = await initializeReservationPayment(String(row.payment_reference));
    if (!result?.success) {
      setBusyId(null);
      return toast.error(result?.error || "Could not reopen payment");
    }
    if (result.already_paid) {
      toast.success("Reservation payment is already confirmed");
      await load();
      return;
    }
    if (!result.authorization_url) {
      setBusyId(null);
      return toast.error("Secure checkout link is missing");
    }
    window.location.assign(String(result.authorization_url));
  }
  async function inspectHousing(row: any) {
    setBusyId(row.id);
    const { error } = await createInspectionRequest(
      row.id,
      row.listing_id,
      profile.user_id,
      `Inspection requested for ${row.listing_title || "apartment"}`,
    );
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Apartment inspection requested");
    await load();
  }
  async function payHousingRent(row: any) {
    setBusyId(row.id);
    const { result, error } = row.stay_type === "short_let"
      ? await initializeShortStayPayment(row.id)
      : await initializeApartmentRentPayment(row.id);
    if (error || !result?.success) {
      setBusyId(null);
      return toast.error(error?.message || result?.error || "Could not open secure payment");
    }
    if (result.already_paid) {
      toast.success(row.stay_type === "short_let" ? "Stay payment already confirmed" : "Year 1 rent already confirmed");
      await load();
      return;
    }
    if (!result.authorization_url) {
      setBusyId(null);
      return toast.error("Secure checkout link is missing");
    }
    window.location.assign(String(result.authorization_url));
  }
  async function runPending() {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === "cancel_housing") return cancelHousing(action.row);
    return cancelHotel(action.row);
  }
  function support(row: any) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category:
            row.status === "payment_pending" ||
            row.rent_payment_status === "payment_pending"
              ? "payment"
              : "apartment_booking",
          subject: `${row.stay_type === "short_let" ? "Short Let" : "Long Let"} · ${row.booking_code || row.listing_title || "Apartment"}`,
          contextType: "apartment_reservation",
          contextId: row.id,
          contextSnapshot: {
            reservation_id: row.id,
            booking_code: row.booking_code,
            listing_id: row.listing_id,
            listing_title: row.listing_title,
            listing_location: row.listing_location || row.listing_address || [row.listing_city,row.listing_state].filter(Boolean).join(", "),
            stay_type: row.stay_type,
            status: row.status,
            check_in: row.stay_check_in,
            check_out: row.stay_check_out,
            rent_payment_status: row.rent_payment_status,
          },
        },
      }),
    );
  }
  function hotelSupport(row:any){
    window.dispatchEvent(new CustomEvent("openSupportChat",{detail:{category:"hotel_booking",subject:`${row.hotels?.name||row.hotel?.name||row.hotel_name||"Hotel stay"} · ${row.booking_code||`Booking ${row.booking_id}`}`,contextType:"hotel_booking",contextId:String(row.booking_id),contextSnapshot:{booking_id:row.booking_id,booking_code:row.booking_code,hotel_id:row.hotel_id,hotel_name:row.hotels?.name||row.hotel?.name||row.hotel_name,hotel_address:row.hotels?.address||null,room_id:row.room_id,room_name:row.hotel_rooms?.room_type||row.hotel_rooms?.name||row.room_name,rate_plan_id:row.rate_plan_id,rate_plan_name:row.rate_plan_name||row.hotel_rate_plans?.name,check_in:row.check_in_date||row.check_in,check_out:row.check_out_date||row.check_out,guest_count:row.guest_count,guest_name:row.guest_name,total_price:row.total_price,status:row.status,payment_status:row.payment_status}}}));
  }
  if(activeService)return <BookingNegotiationChat conversationId={activeService.conversationId} bookingId={activeService.bookingId} profile={profile} isWorker={false} onClose={()=>{setActiveService(null);void load()}}/>;
  if(activeHotelChat)return <HotelBookingChat bookingId={Number(activeHotelChat.booking_id)} profile={profile} title={activeHotelChat.hotels?.name||activeHotelChat.hotel?.name||activeHotelChat.hotel_name||"Hotel"} subtitle={`${activeHotelChat.hotel_rooms?.room_type||activeHotelChat.room_name||"Room"} · ${activeHotelChat.booking_code||"Paid stay"}`} onClose={()=>{setActiveHotelChat(null);void load(true)}}/>;
  if(activeHousing)return <PropertyBookingDetail row={activeHousing} inspection={inspections.find(item=>String(item.reservation_id)===String(activeHousing.id))||null} busy={busyId===activeHousing.id} onBack={()=>setActiveHousing(null)} onDesk={()=>support(activeHousing)} onResume={()=>void continueHousing(activeHousing)} onInspect={()=>void inspectHousing(activeHousing)} onRent={()=>void payHousingRent(activeHousing)}/>;
  if(activeHotel)return <HotelBookingDetail row={activeHotel} busy={busyId===`hotel-${activeHotel.booking_id}`} onBack={()=>setActiveHotel(null)} onDesk={()=>hotelSupport(activeHotel)} onHotel={()=>setActiveHotelChat(activeHotel)} onPay={()=>void payHotel(activeHotel)}/>;
  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-8 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 sm:px-5 lg:px-8 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-start gap-3">
          <div className="flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">
              WEHOUSE
            </p>
            <h1 className="mt-1 text-xl font-bold">Bookings</h1>
            <p className="mt-1 text-[10px] text-[#74798B]">
              What needs you now, what is active, and what is finished.
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 lg:px-8">
        <div className="flex items-center justify-between gap-3 border-b border-white/[.07] pb-3">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#656B7D]">
              Booking type
            </p>
            <p className="mt-1 text-[10px] text-[#8A909F]">
              {rows.length} {rows.length === 1 ? "record" : "records"} shown
            </p>
          </div>
          <WeHouseSelect
            value={view}
            options={VIEW_OPTIONS}
            onChange={setView}
            eyebrow="Bookings"
            title="Filter booking type"
            ariaLabel="Filter bookings by type"
          />
        </div>
        {Object.keys(sourceErrors).length > 0 && (
          <BookingSourceNotice errors={sourceErrors} retry={() => void load()} />
        )}
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty view={view} />
        ) : (
          <div className="space-y-7">
            {sections.map((section) => (
              <section key={section.id}>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className={`text-[10px] font-bold uppercase tracking-[.14em] ${section.id === "action" ? "text-amber-300" : "text-[#747A8B]"}`}>
                    {section.label}
                  </h2>
                  <span className="text-[9px] text-[#555C6D]">{section.items.length}</span>
                </div>
                <div className="divide-y divide-white/[.065] border-y border-white/[.065]">
                  {section.items.map((item) =>
                    item.kind === "housing" ? (
                      <HousingCard
                        key={item.row.id}
                        row={item.row}
                        onOpen={() => setActiveHousing(item.row)}
                        onResume={() => void continueHousing(item.row)}
                        busy={busyId === item.row.id}
                        onCancel={() =>
                          setPending({ kind: "cancel_housing", row: item.row })
                        }
                        onSupport={() => support(item.row)}
                      />
                    ) : item.kind === "hotel" ? (
                      <HotelCard
                        key={item.row.booking_id}
                        row={item.row}
                        busy={busyId === `hotel-${item.row.booking_id}`}
                        onCancel={() =>
                          setPending({ kind: "cancel_hotel", row: item.row })
                        }
                        onSupport={()=>hotelSupport(item.row)}
                        onOpen={()=>setActiveHotel(item.row)}
                      />
                    ) : (
                      <ServiceCard key={item.row.booking_id || item.row.conversation_id} row={item.row} onOpen={()=>setActiveService({conversationId:item.row.conversation_id,bookingId:item.row.booking_id})}/>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
      <ConfirmDialog
        isOpen={Boolean(pending)}
        title="Cancel this reservation?"
        description="This releases the reservation and cannot be undone."
        confirmLabel="Cancel reservation"
        variant="danger"
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}

function bookingGroup(item: BookingItem): BookingGroup {
  if (item.kind === "housing") {
    const status = String(item.row.status || "");
    const rentPaid = ["paid", "upfront_paid"].includes(String(item.row.rent_payment_status || ""));
    if (status === "payment_pending" || status === "payment_conflict" || (status === "reserved" && !rentPaid) || (status === "ready_for_move_in" && !rentPaid)) return "action";
    if (["completed", "cancelled", "expired", "refunded"].includes(status)) return "history";
    return "active";
  }
  if (item.kind === "hotel") {
    const status = String(item.row.status || "");
    const payment = String(item.row.payment_status || "");
    if (status === "payment_conflict" || (status === "pending" && ["unpaid", "payment_pending", "failed"].includes(payment))) return "action";
    if (["checked_out", "completed", "cancelled", "expired", "refunded"].includes(status)) return "history";
    return "active";
  }
  const status = String(item.row.booking_status || "");
  if (["waiting_payment", "completed_pending_approval"].includes(status)) return "action";
  if (["approved_released", "cancelled", "refunded"].includes(status)) return "history";
  return "active";
}

function BookingSourceNotice({ errors, retry }: { errors: BookingSourceErrors; retry: () => void }) {
  const labels = [
    errors.housing && "apartments",
    errors.hotels && "hotels",
    errors.services && "WeHouse Services",
  ].filter(Boolean);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/15 bg-amber-500/[.045] p-3" role="status">
      <div>
        <p className="text-[10px] font-semibold text-amber-200">
          {labels.join(", ")} {labels.length === 1 ? "needs" : "need"} a refresh
        </p>
        <p className="mt-1 text-[9px] text-[#8E8375]">
          Any booking already loaded stays visible.
        </p>
      </div>
      <button type="button" onClick={retry} className="min-h-9 shrink-0 rounded-full border border-amber-400/20 px-3 text-[9px] font-semibold text-amber-200">
        Try again
      </button>
    </div>
  );
}

function ServiceCard({row,onOpen}:{row:any;onOpen:()=>void}){
  const status=BOOKING_STATUS_LABELS[row.booking_status];
  const amount=Number(row.negotiated_amount||0);
  return <article className="py-4"><button type="button" onClick={onOpen} className="w-full text-left"><div className="flex items-start gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-violet-500/[.09] text-xl text-violet-300">⌁</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">WeHouse Service</p><h2 className="mt-1 truncate text-sm font-semibold">{row.service_type||"Service request"}</h2><p className="mt-1 truncate text-[10px] text-[#676C7D]">{row.other_person_name||"WeHouse professional"} · #{row.booking_code}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${status?.color||"bg-white/[.05] text-[#A2A6B3]"}`}>{status?.label||"Status unavailable"}</span></div>{amount>0&&<p className="mt-3 text-xs font-semibold text-emerald-300">{money(amount)}</p>}<div className="mt-3 flex items-end justify-between gap-3 border-t border-white/[.05] pt-3">{!["approved_released","cancelled","refunded"].includes(row.booking_status)&&<p className="text-[9px] text-[#626879]">{serviceNextAction(row.booking_status)}</p>}<span className="text-[9px] font-semibold text-violet-300">Open booking →</span></div></div></div></button></article>
}
function serviceNextAction(status:string){const labels:Record<string,string>={booking_requested:"Waiting for the professional to respond",negotiating:"Agree the work, date and price",waiting_payment:"Approve and pay the agreed price",confirmed:"Payment secured · waiting to start",in_progress:"Work is in progress",completed_pending_approval:"Review the completed work",approved_released:"Completed",disputed:"WeHouse review in progress",cancelled:"Cancelled",refunded:"Refunded"};return labels[status]||"Open for the next action"}

function HousingCard({
  row,
  busy,
  onOpen,
  onResume,
  onCancel,
  onSupport,
}: {
  row: any;
  busy: boolean;
  onOpen: () => void;
  onResume: () => void;
  onCancel: () => void;
  onSupport: () => void;
}) {
  const short = row.stay_type === "short_let";
  const rentPaid = ["paid", "upfront_paid"].includes(
    String(row.rent_payment_status || ""),
  );
  const visibleStatus =
    row.status === "occupied"
      ? short
        ? "Checked in"
        : "Tenancy active"
      : HOUSING_STATUS[row.status] || "Status unavailable";
  const nextSummary =
    row.status === "occupied"
      ? short
        ? `Checkout ${date(row.check_out_date)}`
        : `Ends ${date(row.tenancy_end_date)}`
      : row.status === "payment_pending"
        ? "Finish your reservation"
        : row.status === "reserved" && !rentPaid
          ? row.rent_payment_status === "payment_pending"
            ? short
              ? "Finish stay payment"
              : "Finish Year 1 rent payment"
            : short
              ? "Pay for your stay"
              : "Choose inspection or Year 1 rent"
        : row.status === "inspection_pending"
          ? "WeHouse is reviewing the apartment"
          : row.status === "ready_for_move_in" && rentPaid
            ? "Confirm after you move in"
            : row.status === "ready_for_move_in"
              ? short
                ? "Stay payment required"
                : "Rent payment required"
              : null;
  return (
    <article className="py-4">
      <div className="flex items-start gap-3">
        {row.listing_image ? (
          <button
            type="button"
            onClick={onOpen}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl"
            aria-label="View reservation apartment"
          >
            <img
              src={row.listing_image}
              alt=""
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-violet-300">
            ⌂
          </div>
        )}
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={`text-[9px] font-semibold uppercase tracking-wide ${short ? "text-violet-300" : "text-violet-300"}`}
            >
              {short ? "Short Let" : "Long Let"}
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold">
              {row.listing_title || "Apartment reservation"}
            </h2>
            <p className="mt-1 truncate text-[10px] text-[#676C7D]">
              {row.listing_location || "WeHouse apartment"}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/[.08] px-2 py-1 text-[8px] text-[#A2A6B3]">
            {visibleStatus}
          </span>
        </div>
      </div>
      {nextSummary && (
        <p className="mt-3 text-[11px] font-medium text-[#C5C8D2]">
          {nextSummary}
        </p>
      )}
      {row.status === "payment_pending" && (
        <p className="mt-3 rounded-xl bg-amber-500/[.04] p-3 text-[9px] text-amber-200">
          Complete the reservation payment to submit this booking.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {row.status === "payment_pending" ? <button disabled={busy} onClick={onResume} className="h-10 flex-1 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-50">{busy ? "Opening payment…" : "Continue reservation"}</button> : <button onClick={onOpen} className="h-10 flex-1 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold">{row.status === "occupied" ? "Open tenancy" : "Open booking"}</button>}
        {row.status === "payment_pending" && <button onClick={onOpen} className="h-10 rounded-xl border border-white/[.08] px-3 text-[10px] font-semibold text-[#B2B6C2]">Details</button>}
        {row.status === "payment_pending" && (
          <button
            disabled={busy}
            onClick={onCancel}
            className="h-10 rounded-xl border border-red-500/15 px-3 text-[10px] font-semibold text-red-300"
          >
            Cancel
          </button>
        )}
        <button
          onClick={onSupport}
          className="h-10 rounded-xl border border-white/[.08] px-3 text-[10px] font-semibold text-[#B2B6C2]"
        >
          Message WeHouse
        </button>
      </div>
    </article>
  );
}
function HotelCard({
  row,
  busy,
  onCancel,
  onSupport,
  onOpen,
}: {
  row: any;
  busy: boolean;
  onCancel: () => void;
  onSupport:()=>void;
  onOpen:()=>void;
}) {
  const visibleStatus = HOTEL_STATUS[String(row.status || "")] || "Status unavailable";
  return (
    <article className="py-4">
      <div className="flex justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold uppercase text-amber-300">
            Hotel
          </p>
          <h2 className="mt-1 text-sm font-semibold">
            {row.hotels?.name ||
              row.hotel?.name ||
              row.hotel_name ||
              "Hotel reservation"}
          </h2>
        </div>
        <span className="rounded-full border border-white/[.08] px-2 py-1 text-[8px] text-[#A2A6B3]">
          {visibleStatus}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Info
          label="Check-in"
          value={date(row.check_in_date || row.check_in)}
        />
        <Info
          label="Check-out"
          value={date(row.check_out_date || row.check_out)}
        />
      </div>
      <button type="button" onClick={onOpen} className="mt-3 h-10 w-full rounded-xl bg-violet-500 text-[10px] font-semibold">Open stay</button>
      {row.status === "pending" && (
        <button
          disabled={busy}
          onClick={onCancel}
          className="mt-3 h-10 w-full rounded-xl border border-red-500/15 text-[10px] font-semibold text-red-300"
        >
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      )}
      <button type="button" onClick={onSupport} className="mt-3 h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#B2B6C2]">Message WeHouse</button>
    </article>
  );
}
function PropertyBookingDetail({row,inspection,busy,onBack,onDesk,onResume,onInspect,onRent}:{row:any;inspection:any;busy:boolean;onBack:()=>void;onDesk:()=>void;onResume:()=>void;onInspect:()=>void;onRent:()=>void}) {
  const short=row.stay_type==='short_let';
  const status=row.status==='occupied'?(short?'Checked in':'Tenancy active'):(HOUSING_STATUS[row.status]||'Status unavailable');
  const title=row.status==='occupied'?(short?'Current stay':'Your tenancy'):(short?'Apartment stay':'Apartment booking');
  const journey=getPropertyBookingJourney(row,inspection);
  const recordCode=Boolean(row.booking_code)&&row.status!=="payment_pending"&&!isUnpaidHousingDraft(row);
  const rentAmount=Number(short?Number(row.stay_rent_total||0)+Number(row.security_deposit_snapshot||0):row.upfront_rent_required||row.annual_rent_snapshot||row.listing_price||0);
  return (
    <BookingDetailShell title={title} onBack={onBack}>
      <section className="overflow-hidden rounded-3xl border border-white/[.07] bg-[#11141C]">
        {row.listing_image&&<img src={row.listing_image} alt={row.listing_title||"Apartment"} loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover"/>}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">{short?'Short Let':'Long Let'}</p>
              <h1 className="mt-1 break-words text-xl font-bold">{row.listing_title||'Apartment booking'}</h1>
              <p className="mt-1 text-[10px] leading-4 text-[#777D8E]">{row.listing_location||row.listing_address||[row.listing_city,row.listing_state].filter(Boolean).join(', ')||'Area unavailable'}</p>
            </div>
            <span className="shrink-0 rounded-full border border-violet-500/20 bg-violet-500/[.06] px-2.5 py-1 text-[9px] font-semibold text-violet-200">{status}</span>
          </div>
          {recordCode&&<p className="mt-4 text-[9px] text-[#777D8E]">Booking record <span className="font-bold tracking-wide text-violet-300">{row.booking_code}</span></p>}
          <div className="mt-4 grid grid-cols-2 gap-x-3">
            <Info label="Reservation fee" value={journey.feePaid?`Paid · ${money(row.amount)}`:money(row.amount)}/>
            <Info label={short?'Stay payment':'Year 1 rent'} value={journey.rentPaid?'Paid':row.rent_payment_status==='payment_pending'?'Payment started':'Not paid'}/>
            {short?<><Info label="Check-in" value={date(row.stay_check_in)}/><Info label="Check-out" value={date(row.stay_check_out)}/></>:<><Info label="Tenure" value={`${Number(row.rental_plan_years||1)} year${Number(row.rental_plan_years||1)===1?'':'s'}`}/><Info label="Year 1 rent" value={money(rentAmount)}/></>}
          </div>
          {row.hold_expires_at&&!['occupied','completed'].includes(row.status)&&<p className="mt-3 text-[9px] text-amber-300">Reservation hold until {new Date(row.hold_expires_at).toLocaleString()}</p>}
          <PropertyBookingJourney row={row} inspection={inspection}/>
          {journey.action==='reservation_payment'&&(
            <button type="button" disabled={busy} onClick={onResume} className="mt-5 min-h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{busy?'Opening secure payment…':'Pay reservation fee'}</button>
          )}
          {journey.action==='choose_inspection_or_rent'&&(
            <section className="mt-5">
              <p className="text-xs font-semibold">Choose one next step</p>
              <p className="mt-1 text-[9px] leading-4 text-[#727889]">An inspection is optional. If you request it, rent waits until the visit is completed.</p>
              <button type="button" disabled={busy} onClick={onInspect} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{busy?'Sending request…':'Request apartment inspection'}</button>
              <button type="button" disabled={busy} onClick={onRent} className="mt-2 min-h-11 w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[.06] text-xs font-semibold text-emerald-300 disabled:opacity-50">{busy?'Opening secure payment…':`Proceed with Year 1 rent · ${money(rentAmount)}`}</button>
            </section>
          )}
          {journey.action==='rent_payment'&&(
            <button type="button" disabled={busy} onClick={onRent} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-500 text-xs font-semibold text-[#03100B] disabled:opacity-50">{busy?'Opening secure payment…':row.rent_payment_status==='payment_pending'?(short?'Continue stay payment':'Continue Year 1 rent payment'):(short?`Pay stay and deposit · ${money(rentAmount)}`:`Pay Year 1 rent · ${money(rentAmount)}`)}</button>
          )}
          {journey.action==='handover'&&row.booking_code&&(
            <div className="mt-5 border-y border-emerald-500/20 bg-emerald-500/[.035] py-4 text-center">
              <p className="text-[8px] uppercase tracking-[.16em] text-emerald-300">Show Property Operations</p>
              <p className="mt-2 text-xl font-bold tracking-[.14em]">{row.booking_code}</p>
              <p className="mx-auto mt-2 max-w-sm text-[9px] leading-4 text-[#7C887F]">Access is handed over only after the code, property, identity and payment match.</p>
            </div>
          )}
          <button type="button" onClick={onDesk} className="mt-4 min-h-11 w-full rounded-xl border border-white/[.09] text-xs font-semibold">Message WeHouse Property Operations</button>
        </div>
      </section>
    </BookingDetailShell>
  );
}
function HotelBookingDetail({row,busy,onBack,onDesk,onHotel,onPay}:{row:any;busy:boolean;onBack:()=>void;onDesk:()=>void;onHotel:()=>void;onPay:()=>void}) {
  const name=row.hotels?.name||row.hotel?.name||row.hotel_name||'Hotel stay';
  const status=HOTEL_STATUS[String(row.status||'')]||'Status unavailable';
  const room=row.hotel_rooms?.room_type||row.hotel_rooms?.name||row.room_name||'Room details unavailable';
  const packageName=row.rate_plan_name||row.hotel_rate_plans?.name||'Room package';
  const hotelAddress=row.hotels?.address||null;
  const hotelLatitude=Number(row.hotels?.gps_latitude);
  const hotelLongitude=Number(row.hotels?.gps_longitude);
  const exactDestination=row.hotels?.location_exact===true&&Number.isFinite(hotelLatitude)&&Number.isFinite(hotelLongitude);
  const journeyStatus=row.status==='checked_out'?'completed':String(row.status||'');
  const stages=['pending','confirmed','checked_in','completed'];
  const current=Math.max(0,stages.indexOf(journeyStatus));
  const stopped=['cancelled','expired','refunded','payment_conflict'].includes(journeyStatus);
  const roomImage=row.hotel_rooms?.images?.[0]||row.hotels?.images?.[0]||null;
  const showCode=Boolean(row.booking_code)&&String(row.payment_status)==='paid'&&!['cancelled','expired','payment_conflict'].includes(journeyStatus);
  const hotelChatOpen=String(row.payment_status)==='paid'&&['confirmed','checked_in','checked_out','completed'].includes(journeyStatus);
  const next=journeyStatus==='pending'?'Complete secure payment to confirm the room.':journeyStatus==='confirmed'?'Your room is confirmed. Present this booking at check-in.':journeyStatus==='checked_in'?'Your stay is in progress. The hotel completes it after checkout.':journeyStatus==='completed'?'Stay completed. You can now leave a verified hotel review.':stopped?'Message WeHouse if you need help with this booking.':'Message WeHouse for the next update.';
  return <BookingDetailShell title="Hotel booking" onBack={onBack}><section className="overflow-hidden border-y border-white/[.07] bg-[#11141C]">{roomImage&&<img src={roomImage} alt={`${room} at ${name}`} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover"/>}<div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-wide text-amber-300">Hotel stay</p><h1 className="mt-1 text-xl font-bold">{name}</h1><p className="mt-1 text-[10px] text-[#777D8E]">{room} · {packageName}</p>{hotelAddress&&<p className="mt-1 text-[10px] leading-4 text-[#777D8E]">{hotelAddress}</p>}</div><span className="rounded-full border border-amber-500/20 bg-amber-500/[.06] px-2.5 py-1 text-[9px] font-semibold text-amber-200">{status}</span></div>{showCode&&<div className="mt-4 border-y border-violet-500/20 bg-violet-500/[.04] py-3"><p className="text-[8px] uppercase tracking-wide text-[#777D8E]">Check-in code</p><p className="mt-1 text-lg font-bold tracking-[.12em] text-violet-200">{row.booking_code}</p><p className="mt-1 text-[8px] text-[#777D8E]">Show this to authorized staff at arrival.</p></div>}{exactDestination&&<a href={directionsUrl(hotelLatitude,hotelLongitude)} target="_blank" rel="noreferrer" className="mt-4 flex min-h-11 items-center justify-center rounded-xl border border-violet-500/20 text-[10px] font-semibold text-violet-300">Open road directions</a>}<div className="mt-5 grid grid-cols-2 gap-2"><Info label="Check-in" value={date(row.check_in_date||row.check_in)}/><Info label="Check-out" value={date(row.check_out_date||row.check_out)}/><Info label="Guests" value={String(row.guest_count||'—')}/><Info label="Payment" value={hotelPaymentLabel(row.payment_status)}/><Info label="Room" value={room}/><Info label="Package" value={packageName}/></div><div className="mt-5"><p className="text-[9px] font-semibold uppercase tracking-wide text-[#777D8E]">Stay journey</p><div className="mt-3 grid grid-cols-4 gap-1">{[['pending','Payment'],['confirmed','Confirmed'],['checked_in','Checked in'],['completed','Completed']].map(([id,label],index)=><div key={id} className="text-center"><div className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${!stopped&&index<=current?'bg-violet-500 text-white':'bg-white/[.05] text-[#686E7E]'}`}>{!stopped&&index<current?'✓':index+1}</div><p className={`mt-1 text-[8px] ${!stopped&&index<=current?'text-violet-300':'text-[#626879]'}`}>{label}</p></div>)}</div><p className={`mt-3 rounded-xl px-3 py-2 text-[9px] leading-5 ${stopped?'bg-amber-500/10 text-amber-200':'bg-violet-500/[.06] text-[#A5A9B5]'}`}>{next}</p></div>{(row.total_price||row.total_amount||row.amount)!=null&&<p className="mt-4 text-base font-bold">{money(row.total_price||row.total_amount||row.amount)}</p>}{row.status==='pending'&&['unpaid','payment_pending','failed'].includes(String(row.payment_status))&&<button type="button" disabled={busy} onClick={onPay} className="mt-5 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{busy?'Opening payment…':'Pay securely'}</button>}{hotelChatOpen&&<button type="button" onClick={onHotel} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">Message hotel</button>}<button type="button" onClick={onDesk} className="mt-3 min-h-11 w-full rounded-xl border border-white/[.09] text-xs font-semibold">Message WeHouse Property Operations</button></div></section></BookingDetailShell>;
}
function BookingDetailShell({title,onBack,children}:{title:string;onBack:()=>void;children:ReactNode}){return <div className="min-h-[100dvh] bg-[#090B10] text-white"><header className="sticky top-0 z-40 flex min-h-16 items-center gap-3 border-b border-white/[.06] bg-[#090B10]/95 px-4 backdrop-blur-xl"><BackButton onClick={onBack}/><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-400">Bookings</p><h1 className="text-sm font-semibold">{title}</h1></div></header><main className="mx-auto max-w-3xl p-4 sm:p-6">{children}</main></div>}
function hotelPaymentLabel(value:any){const labels:Record<string,string>={unpaid:'Not paid',payment_pending:'Payment pending',paid:'Paid',refunded:'Refunded',failed:'Payment failed',expired:'Payment expired'};return labels[String(value||'')]||'Not available'}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/[.05] py-2.5">
      <p className="text-[8px] uppercase text-[#5D6272]">{label}</p>
      <p className="mt-1 truncate text-[10px] font-semibold text-[#C5C8D1]">
        {value}
      </p>
    </div>
  );
}
function Loading() {
  return (
    <div className="grid min-h-56 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function Empty({ view }: { view: View }) {
  const label = view === "housing"
    ? "apartment bookings"
    : view === "hotels"
      ? "hotel stays"
      : view === "services"
        ? "WeHouse Services bookings"
        : "bookings";
  return (
    <div className="border-y border-white/[.07] px-5 py-14 text-center">
      <p className="text-sm font-semibold">No {label} yet</p>
      <p className="mt-2 text-[10px] text-[#707788]">
        New records appear here automatically with their current next step.
      </p>
    </div>
  );
}
