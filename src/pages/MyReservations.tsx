import { useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  cancelReservation,
  getReservationsForUser,
  initializeReservationPayment,
} from "@/lib/supabase/reservations";
import { initializeApartmentRentPayment } from "@/lib/supabase/housing-payments";
import { initializeShortStayPayment } from "@/lib/short-stay";
import {
  getHotelBookingsForUser,
  updateBookingStatus,
} from "@/lib/supabase/hotels";
import type { Profile } from "@/types";
import { supabase } from "@/lib/supabase";
import ConfirmDialog from "@/components/ConfirmDialog";
import MyBookings, { type BookingStage } from "@/pages/MyBookings";
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

async function confirmMoveInFromReservation(row: any) {
  if (
    !window.confirm(
      "Confirm that you have physically moved into this home? This starts your tenancy today.",
    )
  )
    return;
  const { data, error } = await supabase.rpc("confirm_my_move_in", {
    p_reservation_id: row.id,
  });
  if (error) return toast.error(error.message);
  toast.success(
    data?.already_confirmed
      ? "Move-in was already confirmed"
      : "Move-in confirmed. Your tenancy is now active.",
  );
  window.setTimeout(() => window.location.reload(), 700);
}

export default function MyReservations({ profile, onOpenConversation, onOpenListing }: Props) {
  const [housing, setHousing] = useState<any[]>([]),
    [hotels, setHotels] = useState<any[]>([]),
    [view, setView] = useState<View>("all"),
    [stage, setStage] = useState<BookingStage>("all"),
    [gallery, setGallery] = useState<{
      images: string[];
      videos: string[];
      active: number;
      title: string;
      location: string;
      status: string;
      bedrooms?: number;
      bathrooms?: number;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [busyId, setBusyId] = useState<string | null>(null),
    [pending, setPending] = useState<{
      kind: "move_in" | "cancel_housing" | "cancel_hotel";
      row: any;
    } | null>(null);
  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    const [h, h2] = await Promise.all([
      getReservationsForUser(profile.user_id),
      getHotelBookingsForUser(profile.user_id),
    ]);
    if (h.error) toast.error(h.error.message);
    if (h2.error) toast.error(h2.error.message);
    setHousing(h.reservations || []);
    setHotels(h2.bookings || []);
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
      ]
        .filter(
          (item) =>
            (view === "all" ||
            (view === "housing"
              ? item.kind === "housing"
              : item.kind === "hotel")) &&
            (stage === "all" || lifecycleStage(item.kind,item.row) === stage),
        )
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
    [housing, hotels, view, stage],
  );
  async function fee(row: any) {
    const reference = String(row.payment_reference || "");
    if (!reference) return toast.error("Payment reference is missing");
    setBusyId(row.id);
    try {
      const { result, error } = await initializeReservationPayment(reference);
      if (error) throw error;
      if (result?.already_paid) {
        await load();
        setBusyId(null);
        return;
      }
      if (!result?.success || !result.authorization_url)
        throw new Error(result?.error || "Could not open Paystack");
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || "Could not continue payment");
      setBusyId(null);
    }
  }
  async function rent(row: any) {
    setBusyId(row.id);
    try {
      const short = row.stay_type === "short_let";
      const { result, error } = short
        ? await initializeShortStayPayment(row.id)
        : await initializeApartmentRentPayment(row.id);
      if (error) throw error;
      if (result?.already_paid) {
        toast.success(
          short
            ? "Short Let payment is already confirmed"
            : "Year 1 rent is already confirmed",
        );
        await load();
        setBusyId(null);
        return;
      }
      if (!result?.success || !result.authorization_url)
        throw new Error(result?.error || "Could not open Paystack");
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || "Could not start payment");
      setBusyId(null);
    }
  }
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
    if (action.kind === "move_in")
      return confirmMoveInFromReservation(action.row);
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
          <span className="rounded-full border border-white/[.07] px-2.5 py-1 text-[9px] text-[#7D8291]">
            {housing.length + hotels.length}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Booking status filters">
          {([['all','All'],['needs_action','Needs action'],['active','Active'],['upcoming','Upcoming'],['completed','Completed']] as const).map(([id,label])=><button key={id} onClick={()=>setStage(id)} className={`min-h-9 shrink-0 rounded-full px-3 text-[9px] font-semibold ${stage===id?'bg-violet-500 text-white':'border border-white/[.08] text-[#858A99]'}`}>{label}</button>)}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 lg:px-8">
        <div className="flex border-b border-white/[.07]">
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
        {(view === "all" || view === "housing") && (
          <SharedHomeLifecyclePanel
            profileId={profile.user_id}
            onOpenConversation={onOpenConversation}
            onOpenListing={onOpenListing}
          />
        )}
        {view === "services" ? (
          <MyBookings profile={profile} onBack={() => setView("all")} embedded stage={stage} showFilters={false} />
        ) : loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-3">
            {rows.map((item) =>
              item.kind === "housing" ? (
                <HousingCard
                  key={item.row.id}
                  row={item.row}
                  onGallery={() =>
                    setGallery({
                      images: item.row.listing_images || [],
                      videos: item.row.listing_videos || [],
                      active: 0,
                      title:
                        item.row.listing_title ||
                        `${item.row.stay_type === "short_let" ? "Short Let" : "Long Let"} in ${item.row.listing_city || item.row.city || "your area"}`,
                      location: [
                        item.row.listing_address,
                        item.row.listing_city,
                        item.row.listing_state,
                      ]
                        .filter(Boolean)
                        .join(", "),
                      status:
                        HOUSING_STATUS[item.row.status] || item.row.status,
                      bedrooms: item.row.listing_bedrooms,
                      bathrooms: item.row.listing_bathrooms,
                    })
                  }
                  busy={busyId === item.row.id}
                  onFee={() => void fee(item.row)}
                  onRent={() => void rent(item.row)}
                  onMoveIn={() =>
                    setPending({ kind: "move_in", row: item.row })
                  }
                  onCancel={() =>
                    setPending({ kind: "cancel_housing", row: item.row })
                  }
                  onSupport={() => support(item.row)}
                />
              ) : (
                <HotelCard
                  key={item.row.booking_id}
                  row={item.row}
                  busy={busyId === `hotel-${item.row.booking_id}`}
                  onCancel={() =>
                    setPending({ kind: "cancel_hotel", row: item.row })
                  }
                />
              ),
            )}
          </div>
        )}
        {view === "all" && (
          <section className="border-t border-white/[.07] pt-5">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Service bookings</h2>
              <p className="mt-1 text-[9px] text-[#707687]">
                Worker requests, agreed prices, secured payments and job progress.
              </p>
            </div>
            <MyBookings profile={profile} onBack={() => setView("all")} embedded stage={stage} showFilters={false} />
          </section>
        )}
      </main>
      {gallery && (
        <MediaGallery
          images={gallery.images}
          videos={gallery.videos}
          active={gallery.active}
          title={gallery.title}
          location={gallery.location}
          status={gallery.status}
          bedrooms={gallery.bedrooms}
          bathrooms={gallery.bathrooms}
          setActive={(active) =>
            setGallery((current) =>
              current ? { ...current, active } : current,
            )
          }
          close={() => setGallery(null)}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(pending)}
        title={
          pending?.kind === "move_in"
            ? "Confirm your move-in"
            : "Cancel this reservation?"
        }
        description={
          pending?.kind === "move_in"
            ? "Only confirm after you have received access and physically moved into the home. Your tenancy begins today."
            : "This releases the reservation and cannot be undone."
        }
        confirmLabel={
          pending?.kind === "move_in" ? "Confirm move-in" : "Cancel reservation"
        }
        variant={pending?.kind === "move_in" ? "info" : "danger"}
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}

function lifecycleStage(kind:"housing"|"hotel",row:any):BookingStage{
  const status=String(kind==="housing"?(row.rent_payment_status==="payment_pending"?"payment_pending":row.status):row.status||row.payment_status||"");
  if(["payment_pending","ready_for_move_in","action_required","payment_conflict"].includes(status))return"needs_action";
  if(["confirmed","scheduled","ready","reserved"].includes(status))return"upcoming";
  if(["completed","cancelled","expired","refunded","checked_out","occupied"].includes(status))return"completed";
  return"active";
}

function HousingCard({
  row,
  busy,
  onGallery,
  onFee,
  onRent,
  onMoveIn,
  onCancel,
  onSupport,
}: {
  row: any;
  busy: boolean;
  onGallery: () => void;
  onFee: () => void;
  onRent: () => void;
  onMoveIn: () => void;
  onCancel: () => void;
  onSupport: () => void;
}) {
  const short = row.stay_type === "short_let";
  const reservationPaid = ["paid", "completed"].includes(
    String(row.manual_payment_status || ""),
  );
  const rentPaid = ["paid", "upfront_paid"].includes(
    String(row.rent_payment_status || ""),
  );
  const canRent =
    reservationPaid &&
    !rentPaid &&
    ["reserved", "ready_for_move_in"].includes(row.status);
  return (
    <article className="border-b border-white/[.065] py-4">
      <div className="flex items-start gap-3">
        {row.listing_image ? (
          <button
            type="button"
            onClick={onGallery}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl"
            aria-label="Preview reservation property photos"
          >
            <img
              src={row.listing_image}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/70 py-0.5 text-center text-[7px]">
              View {row.listing_images?.length || 1}
            </span>
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
            {HOUSING_STATUS[row.status] ||
              String(row.status).replace(/_/g, " ")}
          </span>
        </div>
      </div>
      {row.booking_code && (
        <div className="mt-3 border-y border-white/[.055] py-2">
          <p className="text-[8px] uppercase text-[#687083]">Booking code</p>
          <p className="mt-1 text-sm font-black tracking-[.12em] text-violet-300">
            {row.booking_code}
          </p>
        </div>
      )}
      {short ? <ShortFacts row={row} /> : <LongFacts row={row} />}{" "}
      {row.status === "payment_pending" && (
        <p className="mt-3 rounded-xl bg-amber-500/[.04] p-3 text-[9px] text-amber-200">
          Finish the reservation-fee checkout to secure this booking.
        </p>
      )}
      {row.status === "inspection_pending" && (
        <p className="mt-3 rounded-xl bg-violet-500/[.04] p-3 text-[9px] text-violet-200">
          Property inspection is in progress.
        </p>
      )}
      {short && rentPaid && row.status === "ready_for_move_in" && (
        <p className="mt-3 rounded-xl bg-emerald-500/[.04] p-3 text-[9px] text-emerald-200">
          Stay payment and refundable deposit are verified. WeHouse can confirm
          check-in on the reserved date.
        </p>
      )}
      {row.status === "occupied" && (
        <p className="mt-3 rounded-xl bg-violet-500/[.04] p-3 text-[9px] text-violet-200">
          {short
            ? `Checked in · deposit ${String(row.security_deposit_status || "held").replace(/_/g, " ")}`
            : `Tenancy active · ends ${date(row.tenancy_end_date)}`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {row.status === "payment_pending" && (
          <button
            disabled={busy}
            onClick={onFee}
            className="h-10 flex-1 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-40"
          >
            {busy ? "Opening…" : "Pay reservation fee"}
          </button>
        )}
        {row.status === "payment_pending" && (
          <button
            disabled={busy}
            onClick={onCancel}
            className="h-10 rounded-xl border border-red-500/15 px-3 text-[10px] font-semibold text-red-300"
          >
            Cancel
          </button>
        )}
        {canRent && (
          <button
            disabled={busy}
            onClick={onRent}
            className="h-10 flex-1 rounded-xl bg-emerald-500 px-3 text-[10px] font-semibold text-[#03100B] disabled:opacity-40"
          >
            {busy
              ? "Opening…"
              : short
                ? "Pay stay + deposit"
                : "Pay Year 1 rent"}
          </button>
        )}
        {row.status === "ready_for_move_in" && rentPaid && (
          <button
            onClick={onMoveIn}
            className="h-10 flex-1 rounded-xl bg-emerald-500 px-3 text-[10px] font-semibold text-[#03100B]"
          >
            I have moved in
          </button>
        )}
        <button
          onClick={onSupport}
          className="h-10 rounded-xl border border-white/[.08] px-3 text-[10px] font-semibold text-[#B2B6C2]"
        >
          Reservation Desk
        </button>
      </div>
    </article>
  );
}
function MediaGallery({
  images,
  videos,
  active,
  setActive,
  close,
  title,
  location,
  status,
  bedrooms,
  bathrooms,
}: {
  images: string[];
  videos: string[];
  active: number;
  setActive: (value: number) => void;
  close: () => void;
  title: string;
  location: string;
  status: string;
  bedrooms?: number;
  bathrooms?: number;
}) {
  const items = [
      ...images.map((url) => ({ url, video: false })),
      ...videos.map((url) => ({ url, video: true })),
    ],
    selected = items[active] || items[0];
  return (
    <div
      className="fixed inset-0 z-[100000] flex flex-col bg-[#050609] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Reservation property media"
    >
      <header className="absolute inset-x-0 top-0 z-20 flex min-h-16 items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 pb-5 pt-[max(.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={close}
          className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-xl backdrop-blur-md"
          aria-label="Close property gallery"
        >
          ‹
        </button>
        <div className="rounded-full bg-black/55 px-3 py-1.5 text-[9px] font-semibold backdrop-blur-md">
          {active + 1} / {items.length}
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        {selected?.video ? (
          <video
            src={selected.url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            src={selected?.url}
            alt={title}
            className="h-full w-full object-contain"
          />
        )}
      </div>
      <section className="shrink-0 border-t border-white/[.07] bg-[#090B10] px-4 pb-[max(.8rem,env(safe-area-inset-bottom))] pt-3">
        {items.length > 1 && (
          <div className="mb-3 flex gap-2 overflow-x-auto scrollbar-hide">
            {items.map((item, index) => (
              <button
                key={item.url}
                onClick={() => setActive(index)}
                className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border ${active === index ? "border-violet-400" : "border-transparent opacity-65"}`}
              >
                {item.video ? (
                  <video
                    src={item.url}
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={item.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
                {item.video && (
                  <span className="absolute inset-0 grid place-items-center bg-black/25">
                    ▶
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-base font-bold">{title}</p>
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] text-emerald-300">
                {status}
              </span>
            </div>
            <p className="mt-1 truncate text-[9px] text-[#737A8A]">
              {location || "Reservation property"}
            </p>
          </div>
          {(bedrooms || bathrooms) && (
            <p className="shrink-0 text-[9px] text-[#A5AAB7]">
              {bedrooms || 0} bed · {bathrooms || 0} bath
            </p>
          )}
        </div>
      </section>
    </div>
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
}: {
  row: any;
  busy: boolean;
  onCancel: () => void;
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
function Empty() {
  return (
    <div className="border-y border-white/[.07] px-5 py-14 text-center">
      <p className="text-sm font-semibold">No reservations yet</p>
      <p className="mt-2 text-[10px] text-[#707788]">
        Homes and hotel stays you reserve will appear here.
      </p>
    </div>
  );
}
