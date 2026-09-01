import { useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  cancelReservation,
  getReservationsForUser,
} from "@/lib/supabase/reservations";
import {
  getHotelBookingsForUser,
  updateBookingStatus,
} from "@/lib/supabase/hotels";
import type { Profile } from "@/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import { BOOKING_STATUS_LABELS, getMyBookingConversations } from "@/lib/supabase/worker-bookings";
import type { BookingStage } from "@/pages/MyBookings";
import SharedHomeLifecyclePanel from "@/components/SharedHomeLifecyclePanel";

type Props = { profile: Profile; onOpenConversation?:(id:string)=>void; onOpenListing?:(id:string)=>void };
type View = "all" | "housing" | "hotels" | "services";
const money = (v: unknown) => `₦${Number(v || 0).toLocaleString()}`;
const date = (v: any) => (v ? new Date(v).toLocaleDateString() : "—");
const HOUSING_STATUS: Record<string, string> = {
  payment_pending: "Payment pending",
  reserved: "Reserved",
  inspection_pending: "Inspection",
  ready_for_move_in: "Ready",
  occupied: "Occupied",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
  payment_conflict: "Payment review",
};

export default function MyReservations({ profile, onOpenConversation, onOpenListing }: Props) {
  const [housing, setHousing] = useState<any[]>([]),
    [hotels, setHotels] = useState<any[]>([]),
    [services, setServices] = useState<any[]>([]),
    [view, setView] = useState<View>("all"),
    [stage, setStage] = useState<BookingStage>("all"),
    [loading, setLoading] = useState(true),
    [activeService, setActiveService] = useState<{conversationId:string;bookingId:string}|null>(null),
    [busyId, setBusyId] = useState<string | null>(null),
    [pending, setPending] = useState<{
      kind: "cancel_housing" | "cancel_hotel";
      row: any;
    } | null>(null);
  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    const [h, h2, serviceResult] = await Promise.all([
      getReservationsForUser(profile.user_id),
      getHotelBookingsForUser(profile.user_id),
      getMyBookingConversations(profile.user_id),
    ]);
    if (h.error) toast.error(h.error.message);
    if (h2.error) toast.error(h2.error.message);
    if (serviceResult.error) toast.error(serviceResult.error.message || "Unable to load service bookings");
    setHousing(h.reservations || []);
    setHotels(h2.bookings || []);
    setServices(serviceResult.conversations || []);
    setBusyId(null);
    if (!quiet) setLoading(false);
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
      ]
        .filter(
          (item) =>
            (view === "all" ||
            (view === "housing"
              ? item.kind === "housing"
              : view === "hotels"
                ? item.kind === "hotel"
                : item.kind === "service")) &&
            (stage === "all" || lifecycleStage(item.kind,item.row) === stage),
        )
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
    [housing, hotels, services, view, stage],
  );
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
          subject: `${row.stay_type === "short_let" ? "Short Let" : "Long Let"} · ${row.booking_code || row.listing_title || "Property"}`,
          contextType: "apartment_reservation",
          contextId: row.id,
          contextSnapshot: {
            reservation_id: row.id,
            booking_code: row.booking_code,
            listing_id: row.listing_id,
            listing_title: row.listing_title,
            listing_location: row.listing_location || [row.listing_city,row.listing_state].filter(Boolean).join(", "),
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
    window.dispatchEvent(new CustomEvent("openSupportChat",{detail:{category:"hotel_booking",subject:`${row.hotels?.name||row.hotel?.name||row.hotel_name||"Hotel stay"} · Reservation Desk`,contextType:"hotel_booking",contextId:String(row.booking_id),contextSnapshot:{booking_id:row.booking_id,booking_code:row.booking_code,hotel_id:row.hotel_id,hotel_name:row.hotels?.name||row.hotel?.name||row.hotel_name,room_id:row.room_id,room_name:row.hotel_rooms?.name||row.room_name,check_in:row.check_in_date||row.check_in,check_out:row.check_out_date||row.check_out,status:row.status,payment_status:row.payment_status}}}));
  }
  if(activeService)return <BookingNegotiationChat conversationId={activeService.conversationId} bookingId={activeService.bookingId} profile={profile} isWorker={false} onClose={()=>{setActiveService(null);void load()}}/>;
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
              Properties, stays and home-service bookings in one place.
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 lg:px-8">
        <div className="flex items-end gap-3 border-b border-white/[.07]">
          <div className="flex min-w-0 flex-1">
            {(
            [
              ["all", "All"],
              ["housing", "Homes"],
              ["hotels", "Hotels"],
              ["services", "Services"],
            ] as const
            ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`relative flex-1 px-3 py-3 text-[10px] font-semibold ${view === id ? "text-violet-300 after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-violet-400" : "text-[#74798A]"}`}
            >
              {label}
            </button>
            ))}
          </div>
          <label className="mb-2 shrink-0">
            <span className="sr-only">Filter bookings by status</span>
            <select value={stage} onChange={(event)=>setStage(event.target.value as BookingStage)} className="h-9 rounded-full border border-white/[.08] bg-[#11141C] px-3 text-[9px] font-semibold text-[#A7ABB8] outline-none">
              <option value="all">All statuses</option>
              <option value="needs_action">Needs action</option>
              <option value="active">Active</option>
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>
        {(view === "all" || view === "housing") && (
          <SharedHomeLifecyclePanel
            profileId={profile.user_id}
            onOpenConversation={onOpenConversation}
            onOpenListing={onOpenListing}
          />
        )}
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty view={view} stage={stage} />
        ) : (
          <div className="space-y-3">
            {rows.map((item) =>
              item.kind === "housing" ? (
                <HousingCard
                  key={item.row.id}
                  row={item.row}
                  onOpen={() => item.row.listing_id && onOpenListing?.(item.row.listing_id)}
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
                />
              ) : (
                <ServiceCard key={item.row.booking_id || item.row.conversation_id} row={item.row} onOpen={()=>setActiveService({conversationId:item.row.conversation_id,bookingId:item.row.booking_id})}/>
              ),
            )}
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

function lifecycleStage(kind:"housing"|"hotel"|"service",row:any):BookingStage{
  const status=String(kind==="service"?row.booking_status:kind==="housing"?(row.rent_payment_status==="payment_pending"?"payment_pending":row.status):row.status||row.payment_status||"");
  if(["payment_pending","ready_for_move_in","action_required","payment_conflict"].includes(status))return"needs_action";
  if(["waiting_payment","completed_pending_approval","disputed"].includes(status))return"needs_action";
  if(["confirmed","scheduled","ready","reserved"].includes(status))return"upcoming";
  if(["completed","cancelled","expired","refunded","checked_out","approved_released"].includes(status))return"completed";
  return"active";
}

function ServiceCard({row,onOpen}:{row:any;onOpen:()=>void}){
  const status=BOOKING_STATUS_LABELS[row.booking_status];
  const amount=Number(row.negotiated_amount||0);
  return <article className="border-b border-white/[.065] py-4"><button type="button" onClick={onOpen} className="w-full text-left"><div className="flex items-start gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-violet-500/[.09] text-xl text-violet-300">⌁</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">Service</p><h2 className="mt-1 truncate text-sm font-semibold">{row.service_type||"Service request"}</h2><p className="mt-1 truncate text-[10px] text-[#676C7D]">{row.other_person_name||"WeHouse service worker"} · #{row.booking_code}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${status?.color||"bg-white/[.05] text-[#A2A6B3]"}`}>{status?.label||String(row.booking_status||"requested").replace(/_/g," ")}</span></div>{amount>0&&<p className="mt-3 text-xs font-semibold text-emerald-300">{money(amount)}</p>}<div className="mt-3 flex items-end justify-between gap-3 border-t border-white/[.05] pt-3">{!["approved_released","cancelled","refunded"].includes(row.booking_status)&&<p className="text-[9px] text-[#626879]">{serviceNextAction(row.booking_status)}</p>}<span className="text-[9px] font-semibold text-violet-300">Open booking →</span></div></div></div></button></article>
}
function serviceNextAction(status:string){const labels:Record<string,string>={booking_requested:"Waiting for the professional to respond",negotiating:"Agree the work, date and price",waiting_payment:"Approve and pay the agreed price",confirmed:"Payment secured · waiting to start",in_progress:"Work is in progress",completed_pending_approval:"Review the completed work",approved_released:"Completed",disputed:"WeHouse review in progress",cancelled:"Cancelled",refunded:"Refunded"};return labels[status]||"Open for the next action"}

function HousingCard({
  row,
  busy,
  onOpen,
  onCancel,
  onSupport,
}: {
  row: any;
  busy: boolean;
  onOpen: () => void;
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
      : HOUSING_STATUS[row.status] || String(row.status).replace(/_/g, " ");
  const nextSummary =
    row.status === "occupied"
      ? short
        ? `Checkout ${date(row.check_out_date)}`
        : `Ends ${date(row.tenancy_end_date)}`
      : row.status === "payment_pending"
        ? "Reservation fee required"
        : row.status === "inspection_pending"
          ? "Reservation Desk is reviewing the property"
          : row.status === "ready_for_move_in" && rentPaid
            ? "Confirm after you move in"
            : row.status === "ready_for_move_in"
              ? short
                ? "Stay payment required"
                : "Rent payment required"
              : null;
  return (
    <article className="border-b border-white/[.065] py-4">
      <div className="flex items-start gap-3">
        {row.listing_image ? (
          <button
            type="button"
            onClick={onOpen}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl"
            aria-label="View reservation property"
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
              {row.listing_title || "Property reservation"}
            </h2>
            <p className="mt-1 truncate text-[10px] text-[#676C7D]">
              {row.listing_location || "WeHouse property"}
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
          Finish the reservation-fee checkout to secure this booking.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onOpen} className="h-10 flex-1 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold">{row.status === "occupied" ? "View home" : "View booking"}</button>
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
          Reservation Desk
        </button>
      </div>
      <details className="mt-3 border-t border-white/[.055] pt-3 text-[9px] text-[#777C8C]">
        <summary className="cursor-pointer list-none font-semibold text-[#A8ACB8]">
          Booking details <span aria-hidden="true">⌄</span>
        </summary>
        {row.booking_code && (
          <p className="mt-3">
            Booking code <span className="font-semibold tracking-wide text-violet-300">{row.booking_code}</span>
          </p>
        )}
        {short ? <ShortFacts row={row} /> : <LongFacts row={row} />}
      </details>
    </article>
  );
}
function ShortFacts({ row }: { row: any }) {
  return (
    <div className="mt-4 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Info label="Check-in" value={date(row.stay_check_in)} />
        <Info label="Check-out" value={date(row.stay_check_out)} />
        <Info label="Nights" value={String(row.stay_nights || "—")} />
        <Info
          label="Nightly rate"
          value={money(row.nightly_rate_snapshot || row.listing_price)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Info label="Stay rent" value={money(row.stay_rent_total)} />
        <Info
          label="Refundable deposit"
          value={money(row.security_deposit_snapshot)}
        />
      </div>
    </div>
  );
}
function LongFacts({ row }: { row: any }) {
  const years = Number(row.rental_plan_years || 1);
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <Info label="Tenure" value={`${years} year${years === 1 ? "" : "s"}`} />
      <Info
        label="Year 1 rent"
        value={money(
          row.upfront_rent_required ||
            row.annual_rent_snapshot ||
            row.listing_price,
        )}
      />
      {years > 1 && (
        <>
          <Info label="Future balance" value={money(row.installment_balance)} />
          <Info
            label="Monthly contributions"
            value={String(row.installment_count || 0)}
          />
        </>
      )}
    </div>
  );
}
function HotelCard({
  row,
  busy,
  onCancel,
  onSupport,
}: {
  row: any;
  busy: boolean;
  onCancel: () => void;
  onSupport:()=>void;
}) {
  return (
    <article className="rounded-2xl border border-white/[.06] bg-[#12151D] p-4">
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
        <span className="text-[8px] capitalize text-[#9297A5]">
          {String(row.status || "pending").replace(/_/g, " ")}
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
      {row.status === "pending" && (
        <button
          disabled={busy}
          onClick={onCancel}
          className="mt-3 h-10 w-full rounded-xl border border-red-500/15 text-[10px] font-semibold text-red-300"
        >
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      )}
      <button type="button" onClick={onSupport} className="mt-3 h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#B2B6C2]">Reservation Desk</button>
    </article>
  );
}
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
function Empty({view,stage}:{view:View;stage:BookingStage}) {
  const type=view==='housing'?'home':view==='hotels'?'hotel':view==='services'?'service':'booking';
  const title=stage==='all'?`No ${type}${view==='all'?'s':' bookings'} yet`:stage==='needs_action'?`No ${type}${view==='all'?'s':''} need${view==='all'?'':'s'} action`:`No ${stage} ${type}${view==='all'?'s':' bookings'}`;
  return (
    <div className="border-y border-white/[.07] px-5 py-14 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-[10px] text-[#707788]">
        {stage==='needs_action'?`Nothing in ${view==='all'?'your bookings':view} needs you right now.`:`Your ${view==='all'?'housing, hotel and service':view} activity will appear here when it reaches this stage.`}
      </p>
    </div>
  );
}
