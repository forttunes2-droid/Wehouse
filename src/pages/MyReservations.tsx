import ShortLetSplitCosts from "@/components/ShortLetSplitCosts";
import SharedHousingDetails from "@/components/SharedHousingDetails";
import { getMySharedHousingGroups, type SharedHousingGroup } from "@/lib/supabase/shared-housing";
import { sharedHousingLane } from "@/lib/sharedHousingPresentation";
import { withTimeout } from "@/lib/withTimeout";
import HotelSpecialRequest from "@/components/HotelSpecialRequest";
import StayArrivalInstructions from "@/components/StayArrivalInstructions";
import WorkerCustomerRecordConsent from "@/components/WorkerCustomerRecordConsent";
import ShortLetPaymentReview from "@/components/ShortLetPaymentReview";
import { shortLetPayment } from "@/lib/shortLetPayment";
import ReceiptAccess from "@/components/PaymentReceipt";
import { displayDate, displayDateTime, nigeriaDateTimeInput, nigeriaInputToISO } from "@/lib/displayDate";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  cancelReservation,
  createInspectionRequest,
  getInspectionRequestsForUser,
  getReservationsForUser,
  initializeReservationPayment,
  requestApartmentMoveIn,
} from "@/lib/supabase/reservations";
import {
  initializeApartmentRentPayment,
  initializeShortStayPayment,
} from "@/lib/supabase/housing-payments";
import {
  getHotelBookingsForUser,
  issueMyHotelStayCode,
  initializeHotelBookingPayment,
  updateBookingStatus,
} from "@/lib/supabase/hotels";
import type { Profile } from "@/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import HotelBookingChat from "@/components/HotelBookingChat";
import {
  getBookingDetails,
  getMyBookingConversations,
} from "@/lib/supabase/worker-bookings";
import BackButton from "@/components/BackButton";
import WeHouseChoice from "@/components/WeHouseChoice";
import { directionsUrl } from "@/hooks/useDiscoveryLocation";
import PropertyBookingJourney from "@/components/PropertyBookingJourney";
import {
  getPropertyBookingJourney,
  hasProtectedAccommodationPayment,
  hasUnprotectedPaidAccommodation,
  propertyBookingStatusLabel,
} from "@/lib/propertyBookingLifecycle";
import { locationLabel } from "@/lib/locationPresentation";
import { verifyPaymentWithRetry } from "@/lib/supabase/payment-verify";
import { hotelArrivalGuidance } from "@/lib/hotelArrivalGuidance";
import {
  getMyAccommodationProtection,
  reportMyAccommodationArrivalIssue,
  type AccommodationProtection,
  type AccommodationSubject,
} from "@/lib/supabase/accommodation-protection";

type Props = {
  profile: Profile;
  initialBookingId?: string | null;
  onInitialBookingConsumed?: () => void;
  onOpenConversation?: (id: string) => void;
  onOpenListing?: (id: string) => void;
};
type View = "all" | "housing" | "hotels" | "services";
type StatusView = "all" | BookingGroup;
type BookingItem = {
  kind: "housing" | "hotel" | "service" | "shared";
  row: any;
  date: string;
};
type BookingGroup = "action" | "active" | "history";
type BookingSourceErrors = Partial<
  Record<"housing" | "hotels" | "services", string>
>;

  return (
    <BookingCard
      eyebrow={short ? "Short Let" : "Long Let"}
      title={row.listing_title || "Apartment reservation"}
      subtitle={row.listing_location || "WeHouse apartment"}
      image={row.listing_image || null}
      fallback="⌂"
      meta={dates}
      next={nextSummary || (["completed", "cancelled", "expired", "refunded"].includes(row.status) ? propertyBookingStatusLabel(row) : journey.title)}
      onOpen={onOpen}
    />
  );
}

function HotelCard({ row, onOpen }: { row: any; onOpen: () => void }) {
  const hotel = row.hotels || row.hotel || {};
  const room = row.hotel_rooms || {};
  const checkIn = date(row.check_in_date || row.check_in);
  const checkOut = date(row.check_out_date || row.check_out);
  const image = room.images?.[0] || hotel.images?.[0] || null;
  const next =
    row.status === "pending"
      ? "Complete secure payment to confirm this stay"
      : row.status === "confirmed"
        ? hotelArrivalGuidance(row.check_in_date || row.check_in, row.check_out_date || row.check_out, formatStayTime(hotel.check_in_time, "14:00"), hotel.timezone) || `Check-in ${checkIn} from ${formatStayTime(hotel.check_in_time, "14:00")} (hotel local time)`
        : row.status === "checked_in"
          ? `Check-out ${checkOut} by ${formatStayTime(hotel.check_out_time, "12:00")} (hotel local time)`
          : HOTEL_STATUS[String(row.status || "")] || "";
  return (
    <BookingCard
      eyebrow="Hotel"
      title={hotel.name || row.hotel_name || "Hotel reservation"}
      subtitle={room.room_type || row.room_name || row.rate_plan_name || "Hotel room"}
      image={image}
      fallback="H"
      meta={[`${checkIn} – ${checkOut}`]}
      next={next}
      onOpen={onOpen}
    />
  );
}

export function BookingCard({
  eyebrow,
  title,
  subtitle,
  image,
  fallback,
  meta,
  next,
  onOpen,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  image: string | null;
  fallback: string;
  meta: string[];
  next: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${eyebrow} booking for ${title}`}
      className="w-full rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3 text-left transition-[background,transform] duration-150 hover:bg-[var(--wh-elevated)] active:scale-[.995] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 sm:p-4"
    >
      <div className="flex items-start gap-3">
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-xl font-bold text-violet-300">
          {fallback}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-violet-300">{eyebrow}</p>
        <p className="break-words text-sm font-semibold leading-5">
          {title}
        </p>
        <p className="mt-0.5 break-words text-xs leading-4 text-[var(--wh-text-muted)]">
          {subtitle}
        </p>
        {meta.length ? (
          <p className="mt-2 text-xs leading-4 text-[var(--wh-text-secondary)]">
            {meta.join(" · ")}
          </p>
        ) : null}
      </div>
      <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--wh-interactive)] text-base text-[var(--wh-text-secondary)]">›</span>
      </div>
      {next && <div className="mt-3 flex items-start gap-2 border-t border-[var(--wh-border-subtle)] pt-3 text-xs leading-5"><span className="shrink-0 font-semibold text-violet-300">Next</span><span className="min-w-0 text-[var(--wh-text-secondary)]">{next}</span></div>}
    </button>
  );
}

function formatStayTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const [hour, minute] = match ? [Number(match[1]), match[2]] : [0, "00"];
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function PropertyBookingDetail({
  row,
  userId,
  onSplitCreated,
  onOpenShared,
  inspection,
  busy,
  protection,
  onArrivalIssue,
  onBack,
  onDesk,
  onResume,
  onCancel,
  onInspect,
  onRent,
  onMoveIn,
}: {
  row: any;
  userId: string;
  onSplitCreated:(group:SharedHousingGroup)=>void;
  onOpenShared:(id:string)=>void;
  inspection: any;
  busy: boolean;
  protection: AccommodationProtection | null;
  onArrivalIssue: () => void;
  onBack: () => void;
  onDesk: () => void;
  onResume: () => void;
  onCancel: () => void;
  onInspect: () => void;
  onRent: () => void;
  onMoveIn: (requestedAt: string) => void;
}) {
  const short = row.stay_type === "short_let";
  const status = propertyBookingStatusLabel(row);
  const title =
    row.status === "occupied"
      ? short
        ? "Current Short Let"
        : "Your tenancy"
      : short
        ? "Short Let"
        : "Long Let";
  const journey = getPropertyBookingJourney(row, inspection);
  const paymentNeedsReview = hasUnprotectedPaidAccommodation(row);
  const recordCode =
    Boolean(row.booking_code) &&
    journey.rentPaid &&
    ["handover", "tenancy", "completed"].includes(journey.action);
  const shortBill = shortLetPayment(row);
  const hostManaged = row.management_mode_snapshot === "host";
  const arrivalManager = hostManaged ? "Property host" : "WeHouse Property Operations";
  const addressForDirections = row.listing_address || row.listing_location || [row.listing_city,row.listing_state].filter(Boolean).join(", ");
  const rentAmount = Number(
    short
      ? shortBill?.total || 0
      : row.upfront_rent_required ||
          row.annual_rent_snapshot ||
          row.listing_price ||
          0,
  );
  const earliestMoveIn = nigeriaDateTimeInput(
    new Date(Date.now() + 5 * 60_000),
  );
  const latestMoveIn = nigeriaDateTimeInput(
    new Date(Date.now() + 3 * 86_400_000),
  );
  const [moveInAt, setMoveInAt] = useState(
    row.requested_move_in_at
      ? nigeriaDateTimeInput(new Date(row.requested_move_in_at))
      : earliestMoveIn,
  );
  const [editingMoveIn, setEditingMoveIn] = useState(false);
  const helpRelevant =
    row.status === "payment_conflict" ||
    row.rent_payment_status === "payment_conflict" ||
    hasUnprotectedPaidAccommodation(row) ||
    (journey.rentPaid && ["handover", "tenancy"].includes(journey.action));

  return (
    <BookingDetailShell
      title={title}
      onBack={onBack}
      action={<ReceiptAccess subjectType="housing" subjectId={String(row.id)} />}
    >
      <section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
        {row.listing_image ? (
          <img
            src={row.listing_image}
            alt={row.listing_title || "Apartment"}
            loading="lazy"
            decoding="async"
            className="h-40 w-full object-cover sm:h-48"
          />
        ) : null}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                {short ? "Short Let" : "Long Let"}
              </p>
              <h2 className="mt-1 break-words text-base font-bold leading-5">
                {row.listing_title || "Apartment booking"}
              </h2>
              <p className="mt-1 text-[10px] leading-4 text-[var(--wh-text-muted)]">
                {locationLabel(
                  row.listing_location,
                  row.listing_address,
                  row.listing_city,
                  row.listing_state,
                ) ||
                  "Area unavailable"}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-violet-200">
              {status}
            </span>
          </div>

          {recordCode ? (
            <p className="mt-4 text-xs text-[var(--wh-text-muted)]">
              {short ? "Arrival code" : "Move-in code"}{" "}
              <span className="font-bold tracking-wide text-violet-300">
                {row.booking_code}
              </span>
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-x-3">
            {!short && <Info
              label="Reservation fee"
              value={journey.feePaid ? `Paid · ${money(row.amount)}` : money(row.amount)}
            />}
            {short ? <Info label="Reserve date" value={(row.reservation_fee_status === "paid" || ["paid","completed"].includes(String(row.manual_payment_status || ""))) ? `Paid · ${money(row.reservation_fee_snapshot || row.amount)}` : "Payment required"} /> : null}
            <Info
              label={short ? "Stay payment" : "Rent payment status"}
              value={
                paymentNeedsReview
                  ? "Needs WeHouse review"
                  : journey.rentPaid
                  ? "Paid"
                  : row.rent_payment_status === "payment_pending"
                    ? "Payment started"
                    : "Not paid"
              }
            />
            {short ? (
              <>
                <Info label="Check-in" value={date(row.stay_check_in)} />
                <Info label="Check-out" value={date(row.stay_check_out)} />
              </>
            ) : (
              <>
                <Info
                  label="Tenure"
                  value={`${Number(row.rental_plan_years || 1)} year${
                    Number(row.rental_plan_years || 1) === 1 ? "" : "s"
                  }`}
                />
                <Info label="Year 1 rent" value={money(rentAmount)} />
              </>
            )}
          </div>

          {journey.rentPaid && <StayArrivalInstructions kind="home" bookingId={String(row.id)} />}

          {row.hold_expires_at &&
          !journey.rentPaid &&
          !["occupied", "completed"].includes(row.status) ? (
            <p className="mt-3 text-xs text-amber-300">
              Reservation hold until {displayDateTime(row.hold_expires_at)}
            </p>
          ) : null}

          <section className="mt-4 border-y border-[var(--wh-border-subtle)] py-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--wh-text-muted)]">Arrival</p><p className="mt-1 text-xs font-semibold">{arrivalManager}</p></div>{addressForDirections ? <a href={directionsUrl(addressForDirections)} target="_blank" rel="noreferrer" className="min-h-10 rounded-xl border border-[var(--wh-border-subtle)] px-3 py-2 text-xs font-semibold text-violet-300">Directions</a> : null}</div>
            <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-secondary)]">{hostManaged ? "Your authorised property host handles arrival and access for this booking. WeHouse still controls payment verification, support and disputes." : "WeHouse Property Operations handles arrival and verified access for this booking."}</p>
          </section>
          <ShortLetPaymentReview row={row} />
          <ShortLetSplitCosts row={row} userId={userId} onCreated={onSplitCreated}/>
          {row.shared_payment_group_id && <button type="button" onClick={()=>onOpenShared(String(row.shared_payment_group_id))} className="mt-4 min-h-12 w-full rounded-xl bg-violet-600 px-4 text-sm font-semibold">View shared payment</button>}
          <PropertyBookingJourney row={row} inspection={inspection} />

          {journey.action === "reservation_payment" ? (
            <div className="mt-5 grid gap-2">
              <button type="button" disabled={busy} onClick={onResume} className="min-h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">
                {busy ? "Opening secure payment…" : short ? "Pay Reserve date fee" : "Pay reservation fee"}
              </button>
              <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 w-full rounded-xl border border-red-500/15 text-xs font-semibold text-red-300 disabled:opacity-50">
                Cancel reservation
              </button>
            </div>
          ) : null}

          {journey.action === "choose_inspection_or_rent" ? (
            <section className="mt-5">
              <p className="text-xs font-semibold">Choose one next step</p>
              <p className="mt-1 text-xs leading-4 text-[var(--wh-text-muted)]">
                An inspection is optional. If you request it, rent waits until the visit is completed.
              </p>
              <button type="button" disabled={busy} onClick={onInspect} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">
                {busy ? "Sending request…" : "Request apartment inspection"}
              </button>
              <button type="button" disabled={busy} onClick={onRent} className="mt-2 min-h-11 w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[.06] text-xs font-semibold text-emerald-300 disabled:opacity-50">
                {busy ? "Opening secure payment…" : `Proceed with Year 1 rent · ${money(rentAmount)}`}
              </button>
            </section>
          ) : null}

          {journey.action === "rent_payment" && !row.shared_payment_group_id ? (
            <button type="button" disabled={busy || (short && !shortBill)} onClick={onRent} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-500 text-xs font-semibold text-[#03100B] disabled:opacity-50">
              {busy
                ? "Checking payment…"
                : row.rent_payment_status === "payment_pending"
                  ? short
                    ? "Check or continue stay payment"
                    : "Check Year 1 rent payment"
                  : short
                    ? `Pay ${money(rentAmount)} securely`
                    : `Pay Year 1 rent · ${money(rentAmount)}`}
            </button>
          ) : null}

          {journey.action === "move_in_request" || (!short && journey.action === "handover" && editingMoveIn) ? (
            <section className="mt-5 rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
              <p className="text-xs font-semibold">Choose your move-in time</p>
              <p className="mt-1 text-xs leading-4 text-[var(--wh-text-muted)]">
                Times are in Nigeria time (WAT). Choose a time within the next 3 days. Paying rent does not start the tenancy; verified handover does.
              </p>
              <input aria-label="Move-in time in Nigeria (WAT)" type="datetime-local" min={earliestMoveIn} max={latestMoveIn} value={moveInAt} onChange={(event) => setMoveInAt(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs" />
              <button type="button" disabled={busy || !moveInAt} onClick={() => onMoveIn(moveInAt)} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">
                {busy ? "Saving move-in time…" : "Send move-in time"}
              </button>
            </section>
          ) : null}

          {!short && journey.action === "handover" && !editingMoveIn && (
            <button type="button" onClick={() => { setMoveInAt(earliestMoveIn); setEditingMoveIn(true); }} className="mt-4 min-h-11 text-sm font-semibold text-violet-300">Change move-in time</button>
          )}

          {journey.action === "handover" && row.booking_code ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-y border-emerald-500/15 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[.14em] text-emerald-300">
                  {short ? "Arrival code" : "Handover code"}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--wh-text-secondary)]">
                  Show only to {hostManaged ? "your authorised property host" : "Property Operations"} during verified handover.
                </p>
              </div>
              <p className="shrink-0 font-mono text-sm font-bold tracking-[.1em] text-emerald-200">
                {row.booking_code}
              </p>
            </div>
          ) : null}

          {short && protection ? (
            <AccommodationProtectionPanel
              protection={protection}
              onReport={onArrivalIssue}
            />
          ) : null}

          {short &&
          row.status === "completed" &&
          Number(row.security_deposit_snapshot || 0) > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-500/15 bg-amber-500/[.035] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                Refundable caution fee
              </p>
              <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-secondary)]">
                The Property Partner has 24 hours after effective checkout to
                submit an itemized evidence-backed claim. After successful
                notice, you have 48 hours to accept, counter or dispute. Silence
                never awards the fee to the Partner.
              </p>
            </div>
          ) : null}

          {helpRelevant ? (
            <button type="button" onClick={onDesk} className="mt-4 min-h-11 w-full border-t border-[var(--wh-border-subtle)] pt-4 text-xs font-semibold text-violet-300">
              Get help from WeHouse
            </button>
          ) : null}
        </div>
      </section>
    </BookingDetailShell>
  );
}


function HotelBookingDetail({
  row,
  busy,
  protection,
  onArrivalIssue,
  onBack,
  onDesk,
  onHotel,
  onPay,
  onCancel,
}: {
  row: any;
  busy: boolean;
  protection: AccommodationProtection | null;
  onArrivalIssue: () => void;
  onBack: () => void;
  onDesk: () => void;
  onHotel: () => void;
  onPay: () => void;
  onCancel: () => void;
}) {
  const name =
    row.hotels?.name || row.hotel?.name || row.hotel_name || "Hotel stay";
  const status = HOTEL_STATUS[String(row.status || "")] || "Status unavailable";
  const room =
    row.hotel_rooms?.room_type ||
    row.hotel_rooms?.name ||
    row.room_name ||
    "Room details unavailable";
  const packageName =
    row.rate_plan_name || row.hotel_rate_plans?.name || "Room package";
  const hotelAddress = row.hotels?.address || null;
  const journeyStatus =
    row.status === "checked_out" ? "completed" : String(row.status || "");
  const stages = ["pending", "confirmed", "checked_in", "completed"];
  const current = Math.max(0, stages.indexOf(journeyStatus));
  const stopped = ["cancelled", "expired", "refunded", "payment_conflict"].includes(
    journeyStatus,
  );
  const roomImage = row.hotel_rooms?.images?.[0] || row.hotels?.images?.[0] || null;
  const showCode =
    Boolean(row.booking_code) &&
    String(row.payment_status) === "paid" &&
    ["confirmed", "checked_in"].includes(journeyStatus);
  const hotelChatOpen =
    String(row.payment_status) === "paid" &&
    ["confirmed", "checked_in"].includes(journeyStatus);
  const helpRelevant =
    journeyStatus === "payment_conflict" ||
    (String(row.payment_status) === "paid" &&
      ["confirmed", "checked_in", "cancelled", "refunded"].includes(journeyStatus));
  const next =
    journeyStatus === "pending"
      ? "Complete secure payment to confirm the room."
      : journeyStatus === "confirmed"
        ? hotelArrivalGuidance(row.check_in_date || row.check_in, row.check_out_date || row.check_out, formatStayTime(row.hotels?.check_in_time || row.hotel?.check_in_time, "14:00"), row.hotels?.timezone || row.hotel?.timezone) || "Arrive from the check-in time shown above. Show your code at reception."
        : journeyStatus === "checked_in"
          ? "Your stay is in progress."
          : journeyStatus === "completed"
            ? "Stay completed. You can leave a verified hotel review."
            : journeyStatus === "payment_conflict"
              ? "Payment needs WeHouse review."
              : stopped
                ? "This stay is no longer active."
                : "Open this booking for its latest state.";

  return (
    <BookingDetailShell
      title="Hotel booking"
      onBack={onBack}
      action={<ReceiptAccess subjectType="hotel" subjectId={String(row.booking_id)} />}
    >
      <section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
        {roomImage ? (
          <img
            src={roomImage}
            alt={`${room} at ${name}`}
            loading="lazy"
            decoding="async"
            className="h-40 w-full object-cover sm:h-48"
          />
        ) : null}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                Hotel
              </p>
              <h2 className="mt-1 text-base font-bold leading-5">{name}</h2>
              <p className="mt-1 text-[10px] text-[var(--wh-text-muted)]">
                {room} · {packageName}
              </p>
              {hotelAddress ? (
                <p className="mt-1 text-[10px] leading-4 text-[var(--wh-text-muted)]">
                  {hotelAddress}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-full bg-[var(--wh-interactive)] px-2 py-1 text-[10px] font-semibold text-[var(--wh-text-secondary)]">
              {status}
            </span>
          </div>

          {showCode ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-500/[.07] px-3 py-2.5">
              <div className="min-w-0"><p className="text-[10px] font-semibold text-violet-200">Booking reference</p><p className="mt-0.5 text-[10px] text-[var(--wh-text-secondary)]">Your reservation ID; arrival and departure use a separate code.</p></div>
              <p className="font-mono text-xs font-bold tracking-wider text-violet-200">{row.booking_code}</p>
            </div>
          ) : null}
          {showCode ? <HotelPresenceCode bookingId={Number(row.booking_id)} status={journeyStatus as "confirmed" | "checked_in"} /> : null}

          {hotelAddress ? (
            <a
              href={directionsUrl(hotelAddress)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-10 items-center text-xs font-semibold text-violet-300"
            >
              Open road directions
            </a>
          ) : null}

          <p className="mt-2 text-[10px] text-[var(--wh-text-secondary)]">Times use the hotel’s local time.</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3">
            <Info
              label="Check-in"
              value={`${date(row.check_in_date || row.check_in)} from ${formatStayTime(
                row.hotels?.check_in_time || row.hotel?.check_in_time,
                "14:00",
              )}`}
            />
            <Info
              label="Check-out"
              value={`${date(row.check_out_date || row.check_out)} by ${formatStayTime(
                row.hotels?.check_out_time || row.hotel?.check_out_time,
                "12:00",
              )}`}
            />
            <Info label="Guests" value={String(row.guest_count || "—")} />
            <Info label="Payment" value={hotelPaymentLabel(row.payment_status)} />
            <Info label="Room" value={room} />
            <Info label="Package" value={packageName} />
          </div>

          <HotelSpecialRequest request={row.special_requests} />
          {row.cancellation_snapshot && <div className="mt-3 rounded-xl border border-[var(--wh-border-subtle)] p-3 text-xs leading-5">
            <p>{row.cancellation_snapshot.refundable ? `Full refund ${money(row.cancellation_snapshot.refund_amount_ngn)} when cancelled by ${new Date(row.cancellation_snapshot.deadline).toLocaleString('en-NG',{timeZone:row.cancellation_snapshot.timezone})} (${row.cancellation_snapshot.timezone}).` : 'This booking is non-refundable for ordinary cancellation.'}</p>
            <p className="mt-1 text-[var(--wh-text-secondary)]">These booked terms remain fixed if the hotel later changes its rate. Exceptions can be sent to WeHouse for review.</p>
          </div>}
          {row.refund_status && <p role="status" className="mt-3 rounded-xl bg-[var(--wh-interactive)] p-3 text-xs leading-5">Refund {money(row.refund_amount_ngn)} · {row.refund_status==='completed'?'Completed':row.refund_status==='pending'?'Requested':row.refund_status==='manual_review'||row.refund_status==='failed'||row.refund_status==='provider_attention'?'Needs Finance review':'Processing'}. {row.refund_status!=='completed'?'The stay is cancelled; the money has not yet been confirmed returned.':''}</p>}
          {row.status==='confirmed' && row.payment_status==='paid' && row.cancellation_snapshot?.refundable && Date.now()<=new Date(row.cancellation_snapshot.deadline).getTime() && <button type="button" disabled={busy} onClick={onCancel} className="mt-3 min-h-11 w-full rounded-xl border border-red-500/30 px-3 text-xs font-semibold">Cancel stay and request full refund</button>}
          {row.payment_status === 'paid' && <StayArrivalInstructions kind="hotel" bookingId={String(row.booking_id)} />}

          <div className="mt-4 border-t border-[var(--wh-border-subtle)] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wh-text-secondary)]">
              Stay journey
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[
                ["pending", "Payment"],
                ["confirmed", "Confirmed"],
                ["checked_in", "Checked in"],
                ["completed", "Completed"],
              ].map(([id, label], index) => (
                <div key={id} className="text-center">
                  <div
                    className={`mx-auto grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                      !stopped && index <= current
                        ? "bg-violet-500 text-white"
                        : "bg-[var(--wh-interactive)] text-[var(--wh-text-muted)]"
                    }`}
                  >
                    {!stopped && index < current ? "✓" : index + 1}
                  </div>
                  <p
                    className={`mt-1 text-[10px] ${
                      !stopped && index <= current
                        ? "text-violet-300"
                        : "text-[var(--wh-text-muted)]"
                    }`}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
            <p
              className={`mt-3 rounded-xl bg-[var(--wh-interactive)] px-3 py-2 text-xs leading-5 ${
                stopped ? "text-amber-200" : "text-[var(--wh-text-secondary)]"
              }`}
            >
              {next}
            </p>
          </div>

          {(row.total_price || row.total_amount || row.amount) != null ? (
            <p className="mt-3 text-sm font-bold">
              {money(row.total_price || row.total_amount || row.amount)}
            </p>
          ) : null}

          {protection ? (
            <AccommodationProtectionPanel
              protection={protection}
              onReport={onArrivalIssue}
            />
          ) : null}

          {row.status === "pending" &&
          ["unpaid", "payment_pending", "failed"].includes(
            String(row.payment_status),
          ) ? (
            <>
              <button type="button" disabled={busy} onClick={onPay} className="mt-5 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">
                {busy ? "Opening payment…" : "Continue secure payment"}
              </button>
              <button type="button" disabled={busy} onClick={onCancel} className="mt-2 min-h-11 w-full rounded-xl border border-red-500/15 text-xs font-semibold text-red-300 disabled:opacity-40">
                Cancel reservation
              </button>
            </>
          ) : null}

          {hotelChatOpen ? (
            <button type="button" onClick={onHotel} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">
              Message hotel
            </button>
          ) : null}

          {helpRelevant ? (
            <div className="mt-4 border-t border-[var(--wh-border-subtle)] pt-3">
              <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Need to cancel a paid stay or missed check-in? WeHouse reviews the booking’s rate rule and what happened. A missed arrival does not automatically create a refund.</p>
              <button type="button" onClick={onDesk} className="mt-2 min-h-11 rounded-xl border border-violet-400/25 px-4 text-xs font-semibold text-violet-300">
                Request cancellation or refund review
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </BookingDetailShell>
  );
}

function HotelPresenceCode({ bookingId, status }: { bookingId: number; status: "confirmed" | "checked_in" }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const action = status === "confirmed" ? "checked_in" : "checked_out";
  useEffect(() => { setCode(""); }, [bookingId, status]);
  async function issue() {
    if (busy) return;
    setBusy(true);
    const { code: next, error } = await issueMyHotelStayCode(bookingId, action);
    setBusy(false);
    if (error || !next) return toast.error(error?.message || "Could not prepare your guest code");
    setCode(next);
  }
  return <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/[.06] p-3">
    <p className="text-xs font-semibold text-violet-200">{status === "confirmed" ? "Arriving at the hotel" : "Leaving the hotel"}</p>
    <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">{status === "confirmed" ? "When you are at reception, show this code to hotel staff so they can verify your arrival." : "When you leave, show a departure code to hotel staff. You may leave before the scheduled checkout time."}</p>
    {code ? <p role="status" className="mt-3 rounded-lg bg-black/20 px-3 py-3 text-center font-mono text-lg font-semibold tracking-[.25em] text-white">{code}</p> : null}
    {code ? <p className="mt-1 text-center text-[10px] text-[var(--wh-text-secondary)]">Valid for 10 minutes. Do not send it in chat.</p> : null}
    <button type="button" disabled={busy} onClick={() => void issue()} className="mt-3 min-h-11 w-full rounded-xl border border-violet-400/25 text-xs font-semibold text-violet-200 disabled:opacity-40">{busy ? "Preparing code…" : code ? "Get a new code" : status === "confirmed" ? "Show arrival code" : "Show departure code"}</button>
  </div>;
}

function AccommodationProtectionPanel({
  protection,
  onReport,
}: {
  protection: AccommodationProtection;
  onReport: () => void;
}) {
  const deadline = protection.arrival_issue_deadline_at
    ? new Date(protection.arrival_issue_deadline_at)
    : null;
  const open =
    Boolean(protection.arrival_issue_case_id) ||
    protection.protection_state === "disputed";
  return (
    <section
      className={`mt-4 rounded-2xl border p-4 ${
        open
          ? "border-amber-500/20 bg-amber-500/[.045]"
          : "border-emerald-500/15 bg-emerald-500/[.035]"
      }`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          open ? "text-amber-300" : "text-emerald-300"
        }`}
      >
        Payment Protection
      </p>
      <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-secondary)]">
        {open
          ? "Arrival issue open. The accommodation payment is frozen for WeHouse review."
          : deadline
            ? `Protected until the arrival-issue window ends ${displayDateTime(deadline)}.`
            : protection.protection_state === "released"
              ? "Payment released to the property."
              : protection.protection_state === "refunded"
                ? "Payment refunded."
                : protection.protection_state === "protected" && !protection.checked_in_at
                  ? "Your payment is protected. The arrival-issue window starts when you check in."
                  : "Open the payment details or contact WeHouse to check the release status."}
      </p>
      {protection.can_report_arrival_issue ? (
        <button
          type="button"
          onClick={onReport}
          className="mt-3 min-h-11 w-full rounded-xl border border-amber-500/25 bg-amber-500/[.07] text-xs font-semibold text-amber-200"
        >
          Report arrival issue
        </button>
      ) : null}
    </section>
  );
}

function ArrivalIssueDialog({
  open,
  label,
  reason,
  busy,
  onReason,
  onClose,
  onSubmit,
}: {
  open: boolean;
  label: string;
  reason: string;
  busy: boolean;
  onReason: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-end bg-black/75 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="arrival-issue-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)] shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          Formal arrival issue
        </p>
        <h2 id="arrival-issue-title" className="mt-2 text-lg font-bold">
          Report a problem with {label}
        </h2>
        <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-secondary)]">
          This is different from an ordinary WeHouse message. Confirming
          freezes only this accommodation payment and opens a specialist review
          case.
        </p>
        <label className="mt-4 block">
          <span className="text-xs text-[var(--wh-text-secondary)]">What is wrong?</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            maxLength={1500}
            rows={5}
            className="mt-2 w-full resize-none rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3 text-xs outline-none focus:border-amber-500/35"
            placeholder="Describe the room/property, access, safety, or listing mismatch."
          />
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy || reason.trim().length < 10}
            onClick={onSubmit}
            className="min-h-11 rounded-xl bg-amber-500 text-xs font-semibold text-[#1A1000] disabled:opacity-50"
          >
            {busy ? "Opening case…" : "Freeze payment & report"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingDetailShell({
  title,
  onBack,
  action,
  children,
}: {
  title: string;
  onBack: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", { detail: { open: true } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, []);
  return (
    <div className="min-h-[100dvh] bg-[var(--wh-bg)] text-[var(--wh-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--wh-border-subtle)] bg-[var(--wh-bg)]/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 max-w-2xl items-center gap-2 px-3 sm:px-5">
          <BackButton onClick={onBack} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-violet-400">Bookings</p>
            <h1 className="truncate text-sm font-semibold">{title}</h1>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </header>
      <main className="wh-panel-enter mx-auto max-w-2xl px-3 py-4 sm:px-5">{children}</main>
    </div>
  );
}

function hotelPaymentLabel(value: any) {
  const labels: Record<string, string> = {
    unpaid: "Not paid",
    payment_pending: "Payment pending",
    paid: "Paid",
    refunded: "Refunded",
    failed: "Payment failed",
    expired: "Payment expired",
  };
  return labels[String(value || "")] || "Not available";
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-[var(--wh-border-subtle)] py-2">
      <p className="text-[10px] uppercase text-[var(--wh-text-muted)]">{label}</p>
      <p className="mt-0.5 break-words text-xs font-medium leading-5 text-[var(--wh-text)]">
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

function Empty({ view, statusView, filtered = false }: { view: View; statusView: StatusView; filtered?: boolean }) {
  const label =
    view === "housing"
      ? "apartment bookings"
      : view === "hotels"
        ? "hotel stays"
        : view === "services"
          ? "WeHouse Services bookings"
          : "bookings";
  return (
    <div className="border-y border-[var(--wh-border-subtle)] px-5 py-14 text-center">
      <p className="text-sm font-semibold">
        {statusView === "all" && !filtered
          ? `No ${label} yet`
          : "No bookings match these filters"}
      </p>
      <p className="mt-2 text-[10px] text-[var(--wh-text-muted)]">
        {statusView === "all" && !filtered
          ? "New records appear here automatically with their current next step."
          : "Try another month, search, status or booking type."}
      </p>
    </div>
  );
}
