import PropertyShareDialog from "@/components/PropertyShareDialog";
import { displayDate } from "@/lib/displayDate";
import DateField from "@/components/BookingDateField";
import { useEffect, useRef, useState } from "react";
import { addCalendarDays, nigeriaCalendarDate, validateShortLetDates } from "@/lib/shortLetQuote";
import {
  createInspectionRequest,
  createReservation,
  createShortStayReservation,
  getInspectionRequestForReservation,
  getListing,
  getReservationForListing,
  initializeReservationPayment,
  updateReservationPlan,
} from "@/lib/supabase";
import {
  initializeApartmentRentPayment,
  initializeShortStayPayment,
} from "@/lib/supabase/housing-payments";
import {
  createSharedHousingGroup,
  getMySharedHousingGroups,
  initializeSharedHousingPayment,
  respondToSharedHousingInvite,
} from "@/lib/supabase/shared-housing";
import { getConversations, getRoommateConversationPeople } from "@/lib/supabase/chat";
import { selectRoommateRecipients, type RoommateRecipient } from "@/lib/roommateRecipients";
import { withTimeout } from "@/lib/withTimeout";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import type { Listing, Profile, RentalDuration } from "@/types";
import RentalPlanSelector from "@/components/RentalPlanSelector";
import PropertyMediaCarousel from "@/components/PropertyMediaCarousel";
import {
  directionsUrl,
  getDiscoveryDistanceMap,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";
import { toast } from "sonner";
import { listingDisplayTitle } from "@/lib/listingPresentation";
import { locationLabel } from "@/lib/locationPresentation";
import { hasProtectedAccommodationPayment } from "@/lib/propertyBookingLifecycle";
import BackButton from "@/components/BackButton";

type Props = {
  listingId: string;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile;
  onGoToChat: (convId: string) => void;
  onOpenBooking: (reservationId: string) => void;
};

type Plan = {
  durationYears: RentalDuration;
  year1Upfront: number;
  monthlyInstallment: number;
};
type ListingState =
  | "pending_approval"
  | "available"
  | "reserved"
  | "occupied"
  | "maintenance"
  | "closed"
  | "rejected";
const LISTING_STATES: Record<ListingState, { label: string; cls: string }> = {
  pending_approval: {
    label: "Pending approval",
    cls: "border-violet-500/20 bg-violet-500/10 text-violet-300",
  },
  available: {
    label: "Available",
    cls: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  },
  reserved: {
    label: "Reserved",
    cls: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  },
  occupied: {
    label: "Occupied",
    cls: "border-violet-500/20 bg-violet-500/10 text-violet-300",
  },
  maintenance: {
    label: "Maintenance",
    cls: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  },
  closed: {
    label: "Closed",
    cls: "border-white/10 bg-white/[.04] text-[#8A8E9D]",
  },
  rejected: {
    label: "Rejected",
    cls: "border-red-500/20 bg-red-500/10 text-red-300",
  },
};
const ACTIVE_RESERVATION_STATES = new Set([
  "payment_pending",
  "reserved",
  "inspection_pending",
  "ready_for_move_in",
  "occupied",
]);

export default function ListingDetail({
  listingId,
  onNavigate,
  profile,
  isSaved,
  onToggleSave,
  onOpenBooking,
  onGoToChat,
}: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");
  const loadGeneration = useRef(0);
  const reservationInFlight = useRef(false);
  const [reservation, setReservation] = useState<any>(null);
  const [inspection, setInspection] = useState<any>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [reservationOptionsOpen, setReservationOptionsOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sendPropertyOpen, setSendPropertyOpen] = useState(false);
  const [roommateRecipients, setRoommateRecipients] = useState<RoommateRecipient[]>([]);
  const [missingRoommateIdentities, setMissingRoommateIdentities] = useState(0);
  const [sharedGroup, setSharedGroup] = useState<any>(null);
  const [shortCheckIn, setShortCheckIn] = useState("");
  const [shortCheckOut, setShortCheckOut] = useState("");
  const [shortGuests, setShortGuests] = useState(1);
  const { location } = useDiscoveryLocation();
  const [distance, setDistance] = useState<number | null>(null);
  const { getNumber } = usePlatformSettings();
  const reservationFee = getNumber("reservation_fee", 10000);

  async function load() {
    const request = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    setAccountLoading(true); setAccountError("");
    let propertyLoaded = false;
    try {
      const result = await withTimeout(getListing(listingId), 15000, "Property took too long to load.");
      if (request !== loadGeneration.current) return;
      if (result.error) throw result.error;
      const property = result.listing;
      setListing(property);
      propertyLoaded = true;
      // Show the public property immediately; account checks guard only actions.
      setLoading(false);
      setReservation(null); setInspection(null); setSharedGroup(null); setPlan(null);
      if (!property) return;
      const [currentResult, shared] = await Promise.all([
        withTimeout(getReservationForListing(listingId, profile.user_id), 15000, "Your reservation could not be loaded."),
        property.sub_type === "long_stay"
          ? withTimeout(getMySharedHousingGroups(), 15000, "Your shared reservation could not be loaded.")
          : Promise.resolve({ groups: [], error: null }),
      ]);
      if (request !== loadGeneration.current) return;
      if (shared.error) throw shared.error;
      setSharedGroup(shared.groups.find(group => String(group.listing?.id) === String(property.id)) || null);
      if (currentResult.error) throw currentResult.error;
      if (request !== loadGeneration.current) return;
      const current = currentResult.reservation;
      setReservation(current);
      if (current?.rental_plan_years) setPlan({
        durationYears: current.rental_plan_years as RentalDuration,
        year1Upfront: Number(current.upfront_rent_required || 0),
        monthlyInstallment: current.installment_count ? Number(current.installment_balance || 0) / Number(current.installment_count) : 0,
      });
      if (current?.id) {
        const inspectionResult = await withTimeout(getInspectionRequestForReservation(current.id), 15000, "Your visit details could not be loaded.");
        if (inspectionResult.error) throw inspectionResult.error;
        if (request !== loadGeneration.current) return;
        setInspection(inspectionResult.inspection || null);
      }
    } catch {
      if (request === loadGeneration.current) {
        if (propertyLoaded) setAccountError("Your booking status could not be checked. Refresh before reserving or paying.");
        else setLoadError("This property could not be refreshed. Please try again.");
      }
    } finally {
      if (request === loadGeneration.current) { setLoading(false); setAccountLoading(false); }
    }
  }

  useEffect(() => {
    setShortCheckIn(""); setShortCheckOut(""); setShortGuests(1);
    setShareOpen(false); setReservationOptionsOpen(false);
    void load();
    return () => { loadGeneration.current += 1; };
  }, [listingId, profile.user_id]);

  useEffect(() => {
    let live = true;
    void getDiscoveryDistanceMap(location).then((map) => {
      if (live) setDistance(map.get(`listing:${listing?.id || listingId}`) ?? null);
    });
    return () => { live = false; };
  }, [listing?.id, listingId, location]);

  function support(
    kind: "property" | "reservation" | "inspection" | "payment" = "property",
  ) {

  if (!listing) return;
    const displayTitle = listingDisplayTitle(listing);
    const contextId =
      kind === "inspection"
        ? inspection?.id || reservation?.id || listing.listing_id
        : kind === "reservation" || kind === "payment"
          ? reservation?.id || listing.listing_id
          : listing.listing_id;
    const contextType =
      kind === "inspection"
        ? "property_inspection"
        : kind === "reservation"
          ? "apartment_reservation"
          : kind === "payment"
            ? "apartment_payment"
            : "property_listing";
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category:
            kind === "inspection"
              ? "property_inspection"
              : kind === "payment"
                ? "payment"
                : "apartment_booking",
          subject: `${kind === "property" ? "Question about" : kind === "payment" ? "Payment help" : kind === "inspection" ? "Inspection help" : "Reservation help"} · ${displayTitle}`,
          contextType,
          contextId,
          contextSnapshot: {
            listing_id: listing.listing_id,
            listing_title: displayTitle,
            location: [listing.city, listing.state].filter(Boolean).join(", "),
            price: listing.price,
            reservation_id: reservation?.id || null,
            reservation_status: reservation?.status || null,
            rent_payment_status: reservation?.rent_payment_status || null,
            inspection_id: inspection?.id || null,
            inspection_status: inspection?.status || null,
          },
        },
      }),
    );
  }

  async function reserveShortLet() {
    if (!listing || listing.sub_type !== "short_let" || reservationInFlight.current || busy || accountLoading || accountError || !selection.valid) return;
    reservationInFlight.current = true; setBusy(true);
    const request = loadGeneration.current;
    try {
      const created = await withTimeout(createShortStayReservation(listingId, shortCheckIn, shortCheckOut, shortGuests), 20000, "Reservation could not be confirmed. Check your bookings before trying again.");
      if (created.error || !created.reservation?.id) throw created.error || new Error("Reservation could not be created.");
      if (request !== loadGeneration.current) return;
      setReservation(created.reservation);
      // The existing reservation owns its dates, price snapshot and payment.
      // An unpaid request is not advertised as a confirmed/exclusive stay.
      onOpenBooking(String(created.reservation.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Those dates could not be reserved. Please try again.");
    } finally { reservationInFlight.current = false; setBusy(false); }
  }

  async function openCheckout() {
    if (!listing) return;
    setBusy(true);
    try {
      const shortStay = listing.sub_type === "short_let";
      if (shortStay && (!shortCheckIn || !shortCheckOut))
        throw new Error("Choose your check-in and check-out dates");
      const reservationResult = shortStay
        ? await createShortStayReservation(
            listingId,
            shortCheckIn,
            shortCheckOut,
            shortGuests,
          )
        : await createReservation(listingId, profile.user_id);
      const { reservation: created, error: reserveError } = reservationResult;
      if (reserveError || !created)
        throw new Error(
          reserveError?.message || "Could not start this reservation",
        );
      const next = created;
      setReservation(next);
      if (!shortStay && next.status !== "payment_pending") {
        toast.success("Your reservation is already active");
        setShowPlan(false);
        await load();
        return;
      }
      const reference = String(next.payment_reference || "");
      if (!shortStay && !reference)
        throw new Error("Reservation payment reference is missing");
      const { result, error } = shortStay
        ? await initializeShortStayPayment(next.id)
        : await initializeReservationPayment(reference);
      if (error) throw error;
      if (result?.already_paid) {
        toast.success("Reservation payment is already confirmed");
        setShowPlan(false);
        await load();
        return;
      }
      if (!result?.success || !result.authorization_url)
        throw new Error(
          result?.error || "Paystack checkout could not be opened",
        );
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || "Could not start payment");
      setBusy(false);
    }
  }

  async function saveRentPlan() {
    if (!reservation?.id || !plan) return;
    setBusy(true);
    const { reservation: updated, error } = await updateReservationPlan(
      reservation.id,
      plan.durationYears,
    );
    setBusy(false);
    if (error || !updated)
      return toast.error(error?.message || "Could not save the rent plan");
    setReservation(updated);
    setShowPlan(false);
    toast.success("Rent plan saved. Your reservation is unchanged.");
  }

  async function openShare() {
    if (busy) return;
    setBusy(true);
    setShareOpen(false);
    setRoommateRecipients([]);
    setMissingRoommateIdentities(0);
    try {
      const [chats, peers] = await Promise.all([
        withTimeout(getConversations(profile.user_id), 15000, "Connections took too long to load."),
        withTimeout(getRoommateConversationPeople(), 15000, "Connection names took too long to load."),
      ]);
      if (chats.error || peers.error) throw chats.error || peers.error;
      const result = selectRoommateRecipients(profile.user_id, chats.conversations, peers.people);
      setRoommateRecipients(result.recipients);
      setMissingRoommateIdentities(result.missingIdentityCount);
      setShareOpen(true);
    } catch {
      toast.error("Your connections could not be loaded. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function shareWith(conversationId: string) {
    setBusy(true);
    const { group, error } = await createSharedHousingGroup(
      String(listing?.id || listingId),
      conversationId,
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    setSharedGroup(group);
    setShareOpen(false);
    toast.success("Shared-home invitation sent in your roommate relationship");
  }
  async function answerShare(accept: boolean) {
    if (!sharedGroup) return;
    setBusy(true);
    const { group, error } = await respondToSharedHousingInvite(
      sharedGroup.id,
      accept,
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    setSharedGroup(group);
    toast.success(accept ? "Shared home accepted" : "Shared home declined");
  }
  async function payShare() {
    if (!sharedGroup) return;
    setBusy(true);
    const { result, error } = await initializeSharedHousingPayment(
      sharedGroup.id,
    );
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    if (result?.already_paid) {
      setBusy(false);
      await load();
      return toast.success("Your share is already paid");
    }
    if (!result?.authorization_url) {
      setBusy(false);
      return toast.error(result?.error || "Paystack checkout could not open");
    }
    window.location.assign(result.authorization_url);
  }

  async function resumeCheckout() {
    if (listing?.sub_type === "short_let") return payContractRent();
    if (!reservation?.payment_reference)
      return toast.error("Payment reference is missing");
    setBusy(true);
    try {
      const { result, error } = await initializeReservationPayment(
        String(reservation.payment_reference),
      );
      if (error) throw error;
      if (result?.already_paid) {
        toast.success("Payment is already confirmed");
        await load();
        setBusy(false);
        return;
      }
      if (!result?.success || !result.authorization_url)
        throw new Error(result?.error || "Could not reopen Paystack");
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || "Could not continue payment");
      setBusy(false);
    }
  }

  async function payContractRent() {
    if (!reservation?.id) return;
    setBusy(true);
    try {
      const { result, error } =
        listing?.sub_type === "short_let"
          ? await initializeShortStayPayment(reservation.id)
          : await initializeApartmentRentPayment(reservation.id);
      if (error) throw error;
      if (result?.already_paid) {
        toast.success(
          listing?.sub_type === "short_let"
            ? "Your Short Let payment is already confirmed"
            : "Required contract rent is already confirmed",
        );
        await load();
        setBusy(false);
        return;
      }
      if (!result?.success || !result.authorization_url)
        throw new Error(
          result?.error ||
            (listing?.sub_type === "short_let"
              ? "Could not open Short Let checkout"
              : "Could not open contract-rent checkout"),
        );
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(
        error?.message ||
          (listing?.sub_type === "short_let"
            ? "Could not start Short Let payment"
            : "Could not start contract-rent payment"),
      );
      setBusy(false);
    }
  }

  async function requestInspection() {
    if (!reservation) return;
    setBusy(true);
    const { inspection: request, error } = await createInspectionRequest(
      reservation.id,
      listingId,
      profile.user_id,
      `Inspection requested for ${listing?.title || "apartment"}`,
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    setInspection(request || null);
    await load();
    toast.success("Inspection requested");
  }

  if (loading)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#090A0F]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
if (loadError) return <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 p-5 text-center text-white">
    <h1 className="text-xl font-semibold">Property could not be loaded</h1>
    <p role="alert" className="max-w-sm text-sm leading-6 text-[#AAA3B3]">{loadError}</p>
    <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-violet-600 px-5 font-semibold">Try again</button>
    <button type="button" onClick={onNavigate} className="min-h-11 px-5 text-violet-300">Go back</button>
  </main>;
  if (!listing)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#090A0F] px-4 text-center text-white">
        <div>
          <p className="text-sm font-semibold">Apartment unavailable</p>
          <button onClick={onNavigate} className="mt-4 text-xs text-violet-400">
            ← Go back
          </button>
        </div>
      </div>
    );

  const status = String(listing.status || "available") as ListingState;
  const state = LISTING_STATES[status] || LISTING_STATES.closed;
  const images = listing.images?.length
    ? listing.images
    : listing.videos?.length
      ? []
      : ["https://placehold.co/900x650/171922/666A7A?text=No+Image"];
  const shortStay = listing.sub_type === "short_let";
  const shortMinNights = Math.max(
    1,
    Math.round(getNumber("short_stay_min_nights", 1)),
  );
  const shortMaxNights = Math.max(
    shortMinNights,
    Math.round(getNumber("short_stay_max_nights", 90)),
  );
  const bookingWindowDays = Math.max(
    shortMaxNights,
    Math.round(getNumber("short_stay_booking_advance_days", 365)),
  );
  const today = nigeriaCalendarDate();
  const bookingWindowEnd = addCalendarDays(today, bookingWindowDays);
  const minShortCheckout = addCalendarDays(shortCheckIn || today, shortMinNights);
  const maxGuests = Number(listing.max_guests || 0);
  const selection = validateShortLetDates({ checkIn: shortCheckIn, checkOut: shortCheckOut, today,
    lastDate: bookingWindowEnd, guests: shortGuests, maxGuests, minNights: shortMinNights, maxNights: shortMaxNights });
  const hasOwnActiveReservation = Boolean(
    reservation && ACTIVE_RESERVATION_STATES.has(String(reservation.status)),
  );
  const canStartReservation =
    status === "available" && !hasOwnActiveReservation;
  const accommodationPaid = reservation
    ? hasProtectedAccommodationPayment(reservation)
    : false;
  void accommodationPaid;
  const visibleAddress = locationLabel(listing.address, listing.city, listing.state);
  const displayTitle = listingDisplayTitle(listing);

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#090A0F] pb-12 text-white">

      <div className="mx-auto max-w-6xl">
        <PropertyMediaCarousel
          images={images}
          videos={listing.videos || []}
          title={displayTitle}
        >
          <BackButton
            onClick={onNavigate}
            className="!absolute !left-4 !top-4 !ml-0 !h-10 !w-10 !rounded-full !border-transparent !bg-black/55 !text-white shadow-lg backdrop-blur"
          />
          {!hasOwnActiveReservation && (
            <button
              onClick={onToggleSave}
              aria-label={
                isSaved ? "Remove from saved apartments" : "Save apartment"
              }
              aria-pressed={isSaved}
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/55 shadow-lg backdrop-blur active:scale-95"
            >
              <Heart filled={isSaved} />
            </button>
          )}
          {!hasOwnActiveReservation && (
            <span
              className={`absolute bottom-4 left-4 rounded-full border px-3 py-1.5 text-sm font-bold uppercase ${state.cls}`}
            >
              {state.label}
            </span>
          )}
        </PropertyMediaCarousel>

        {sendPropertyOpen && <PropertyShareDialog userId={profile.user_id} property={{ kind: "listing", id: String(listing.id) }} title={displayTitle} onClose={() => setSendPropertyOpen(false)} onConversation={onGoToChat} />}
        <main className="px-4 py-5 sm:px-6 lg:px-8">
          <div className="mb-3 flex justify-end"><button type="button" onClick={() => setSendPropertyOpen(true)} className="min-h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-violet-300">Send property ↗</button></div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <section>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="break-words text-2xl font-bold">
                      {displayTitle}
                    </h1>
                    <p className="mt-1 text-xs text-[#777B8B]">
                      {visibleAddress || "Location unavailable"}
                    </p>
                  </div>
                  <p className="shrink-0 text-xl font-bold text-violet-400">
                    ₦{Number(listing.price || 0).toLocaleString()}
                    <span className="ml-1 text-sm font-normal text-[#686C7D]">
                      {listing.sub_type === "short_let" ? "/night" : "/year"}
                    </span>
                  </p>
                </div>
              </section>
              <section className="grid grid-cols-3 gap-2">
                <Fact
                  label="Type"
                  value={
                    listing.sub_type === "short_let"
                      ? "Short Let"
                      : listing.sub_type === "long_stay"
                        ? "Long Let"
                        : listing.property_type || "Apartment"
                  }
                />
                <Fact label="Bedrooms" value={listing.bedrooms || "—"} />
                <Fact label="Bathrooms" value={listing.bathrooms || "—"} />
              </section>
              {listing.description && (
                <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
                  <h2 className="text-sm font-semibold">
                    About this apartment
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[#9599A8]">
                    {listing.description}
                  </p>
                </section>
              )}
              <section className="border-y border-white/[.07] py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold">
                      Apartment location
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-[#707586]">
                      {visibleAddress || "Location unavailable"}
                      {distance !== null
                        ? ` · about ${distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} m` : `${distance.toFixed(distance < 10 ? 1 : 0)} km`} away`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-[#5F6575]">
                      The published street address is visible before booking. Internal entrance-location data stays private.
                    </p>
                  </div>
                  {visibleAddress && (
                    <a
                      href={directionsUrl(visibleAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-xl border border-white/[.09] px-4 py-2.5 text-sm font-semibold text-violet-300"
                    >
                      Directions
                    </a>
                  )}
                </div>
              </section>
              {!hasOwnActiveReservation && !sharedGroup && (
                <section className="border-y border-white/[.07] py-4">
                  <h2 className="text-sm font-semibold">
                    Questions about this apartment?
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#7C8191]">
                    Message WeHouse here. Your conversation stays connected to
                    this apartment.
                  </p>
                  <button
                    onClick={() => support("property")}
                    className="mt-3 text-xs font-semibold text-violet-300"
                  >
                    Message WeHouse →
                  </button>
                </section>
              )}
            </div>

            <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
              {accountLoading ? (
                <section role="status" aria-label="Checking your booking status" className="rounded-2xl border border-white/10 bg-[#11141C] p-5 text-sm text-[#AAA3B3]">Checking your booking status…</section>
              ) : accountError ? (
                <section role="alert" className="rounded-2xl border border-amber-500/20 bg-[#11141C] p-5 text-sm leading-6 text-amber-100"><p>{accountError}</p><button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold text-violet-300">Refresh booking status</button></section>
              ) : sharedGroup ? (
                <SharedHomeCard
                  group={sharedGroup}
                  profile={profile}
                  busy={busy}
                  onAccept={answerShare}
                  onPay={payShare}
                />
              ) : hasOwnActiveReservation ? (
                <ReservationPanel
                  shortStay={shortStay}
                  reservation={reservation}
                  inspection={inspection}
                  busy={busy}
                  fee={reservationFee}
                  onResume={() => void resumeCheckout()}
                  onInspect={() => void requestInspection()}
                  onRentOptions={() => setShowPlan(true)}
                  onRentPay={() => void payContractRent()}
                  onOpenBooking={() => onOpenBooking(String(reservation.id))}
                  onSupport={() =>
                    support(
                      reservation?.status === "payment_pending" ||
                        reservation?.rent_payment_status === "payment_pending"
                        ? "payment"
                        : inspection
                          ? "inspection"
                          : "reservation",
                    )
                  }
                />
              ) : canStartReservation ? (
                shortStay ? (
                  <section className="rounded-3xl border border-violet-500/15 bg-[#11141C] p-5">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-[.15em] text-violet-300">
                          Short Let
                        </p>
                        <h2 className="mt-1 text-lg font-bold">
                          Reserve your dates
                        </h2>
                      </div>
                      <p className="text-right">
                        <span className="block text-sm font-bold">
                          ₦{Number(listing.price || 0).toLocaleString()}
                        </span>
                        <span className="text-sm text-[#747889]">
                          per night
                        </span>
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-[#74798A]">
                      {shortMinNights}–{shortMaxNights} nights · dates outside
                      this booking window are unavailable.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <DateField
                        label="Check-in"
                        value={shortCheckIn}
                        min={today}
                        max={bookingWindowEnd}
                        onChange={(value) => {
                          setShortCheckIn(value);
                          if (!value || (shortCheckOut && shortCheckOut < addCalendarDays(value, shortMinNights)))
                            setShortCheckOut("");
                        }}
                      />
                      <DateField
                        label="Check-out"
                        value={shortCheckOut}
                        min={minShortCheckout}
                        max={bookingWindowEnd}
                        onChange={setShortCheckOut}
                      />
                    </div>
                    <div className="mt-4 flex h-14 items-center justify-between rounded-2xl border border-white/[.07] bg-black/10 px-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShortGuests((value) => Math.max(1, value - 1))
                        }
                        disabled={shortGuests <= 1 || busy}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.08] text-xl disabled:opacity-25"
                        aria-label="Remove one guest"
                      >
                        −
                      </button>
                      <div className="text-center">
                        <p className="text-sm font-bold">{shortGuests}</p>
                        <p className="text-sm text-[#777D8D]">
                          {shortGuests === 1 ? "guest" : "guests"} · max{" "}
                          {maxGuests}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setShortGuests((value) =>
                            Math.min(maxGuests, value + 1),
                          )
                        }
                        disabled={shortGuests >= maxGuests || busy}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.08] text-xl disabled:opacity-25"
                        aria-label="Add one guest"
                      >
                        +
                      </button>
                    </div>
                    {selection.valid && <p className="mt-4 text-sm text-[#AAA3B3]">{selection.nights} night{selection.nights === 1 ? "" : "s"} · {shortGuests} guest{shortGuests === 1 ? "" : "s"}</p>}
                    {shortCheckIn && shortCheckOut && !selection.valid && <p role="alert" className="mt-3 text-sm leading-6 text-amber-200">{selection.error}</p>}
                    <button type="button" disabled={busy || !selection.valid}
                      onClick={() => void reserveShortLet()}
                      className="mt-4 min-h-12 w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold disabled:opacity-40">
                      {busy ? "Preparing reservation…" : "Reserve date"}
                    </button>
                    <p className="mt-3 text-sm leading-6 text-[#AAA3B3]">Next: review your stay price{Number(listing.security_deposit_amount || 0) > 0 ? " and refundable deposit" : ""}. No payment is taken at this step.</p>
                  </section>
                ) : (
                  <section className="border-y border-white/[.08] py-5">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-[.15em] text-violet-300">
                          Long Let
                        </p>
                        <h2 className="mt-1 text-lg font-bold">
                          Reserve this apartment
                        </h2>
                      </div>
                      <p className="text-right">
                        <span className="block text-sm font-bold">
                          ₦{reservationFee.toLocaleString()}
                        </span>
                        <span className="text-sm text-[#747889]">
                          reservation fee
                        </span>
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-[#777B8B]">
                      Proceed with reservation to begin the inspection and
                      tenancy journey.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => void openCheckout()}
                      className="mt-4 h-12 w-full rounded-full bg-violet-500 text-sm font-semibold disabled:opacity-50"
                    >
                      Proceed with reservation
                    </button>
                    <button
                      onClick={() => setReservationOptionsOpen(true)}
                      className="mt-3 h-10 w-full text-xs font-semibold text-violet-300"
                    >
                      Split costs
                    </button>
                  </section>
                )
              ) : (
                <section className="rounded-3xl border border-amber-500/15 bg-amber-500/[.04] p-5">
                  <h2 className="text-sm font-semibold">{state.label}</h2>
                  <p className="mt-2 text-sm text-[#8A8E9D]">
                    This apartment is not open for a new reservation right now.
                  </p>
                </section>
              )}
            </aside>
          </div>
        </main>
      </div>

      {!shortStay && showPlan && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
          onClick={() => !busy && setShowPlan(false)}
        >
          <section
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/[.08] bg-[#11141C] p-5 text-white sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
                  Rent plan
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  Choose how you want to pay rent
                </h2>
                <p className="mt-1 text-sm text-[#74798A]">
                  Review the amounts and schedule before you confirm.
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => setShowPlan(false)}
                className="text-[#777B8B]"
              >
                ×
              </button>
            </div>
            <div className="mt-5">
              <RentalPlanSelector
                annualRent={listing.price || 0}
                subType={listing.sub_type || "long_stay"}
                securityDepositAmount={listing.security_deposit_amount}
                onSelectPlan={setPlan}
              />
            </div>
            <button
              onClick={() => void saveRentPlan()}
              disabled={!plan || busy}
              className="mt-5 h-12 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-[#03100B] disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save rent plan"}
            </button>
            <button
              onClick={() => setShowPlan(false)}
              disabled={busy}
              className="mt-2 h-11 w-full text-xs text-violet-300"
            >
              Keep current plan
            </button>
          </section>
        </div>
      )}
      {!shortStay && reservationOptionsOpen && (
        <div
          className="fixed inset-0 z-[79] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setReservationOptionsOpen(false)}
        >
          <section
            className="w-full max-w-lg rounded-t-[30px] border border-white/[.08] bg-[#11141C] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-white sm:rounded-[30px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[.16em] text-violet-300">
                  Shared reservation
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  Reserve with a roommate
                </h2>
              </div>
              <button
                onClick={() => setReservationOptionsOpen(false)}
                className="grid h-10 w-10 place-items-center text-[#777B8B]"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setReservationOptionsOpen(false);
                void openShare();
              }}
              className="mt-5 flex min-h-16 w-full items-center justify-between border-y border-white/[.07] py-3 text-left disabled:opacity-40"
            >
              <span>
                <span className="block text-sm font-semibold">
                  Choose a connected roommate
                </span>
                <span className="mt-1 block text-sm text-[#74798A]">
                  Both people accept and pay their own reservation share
                </span>
              </span>
              <span className="text-violet-300">›</span>
            </button>
          </section>
        </div>
      )}
      {!shortStay && shareOpen && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-black/75 sm:items-center sm:p-4"
          onClick={() => setShareOpen(false)}
        >
          <section
            className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/[.08] bg-[#11141C] p-5 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-violet-300">
                  Shared apartment
                </p>
                <h2 className="mt-1 text-lg font-bold">Your connections</h2>
                <p className="mt-1 text-sm text-[#74798A]">
                  Only people with an accepted roommate conversation appear
                  here.
                </p>
              </div>
              <button onClick={() => setShareOpen(false)}>×</button>
            </div>
            <div className="mt-4 divide-y divide-white/[.06]">
              {roommateRecipients.length ? (
                roommateRecipients.map((recipient) => (
                  <button
                    key={recipient.userId}
                    disabled={busy}
                    onClick={() => void shareWith(recipient.conversationId)}
                    className="flex min-h-16 w-full items-center gap-3 py-3 text-left disabled:opacity-40"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/10 text-violet-300">
                      {recipient.avatar ? <img src={recipient.avatar} alt="" className="h-full w-full object-cover" />
                        : recipient.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-base font-semibold">{recipient.name}</span>
                      {recipient.username && <span className="mt-1 block break-words text-sm text-[#AAA3B3]">@{recipient.username}</span>}
                      <span className="mt-1 block text-sm text-[#AAA3B3]">Invite to split this apartment equally</span>
                    </span>
                    <span className="text-violet-300" aria-hidden="true">›</span>
                  </button>
                ))
              ) : !missingRoommateIdentities ? (
                <p className="py-8 text-center text-sm leading-6 text-[#AAA3B3]">
                  No connected roommates are available for this invitation.
                </p>
              ) : null}
              {missingRoommateIdentities > 0 && <div role="status" className="py-4 text-sm leading-6 text-[#AAA3B3]">
                <p>Some connection names could not be loaded. Refresh before choosing them.</p>
                <button type="button" disabled={busy} onClick={() => void openShare()} className="mt-2 min-h-11 text-violet-300">Refresh connections</button>
              </div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "#A78BFA" : "none"}
      stroke={filled ? "#A78BFA" : "white"}
      strokeWidth="2"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function SharedHomeCard({
  group,
  profile,
  busy,
  onAccept,
  onPay,
}: {
  group: any;
  profile: Profile;
  busy: boolean;
  onAccept: (accept: boolean) => Promise<unknown>;
  onPay: () => Promise<unknown>;
}) {
  const members = Array.isArray(group.members) ? group.members : [],
    mine = members.find((member: any) => member.user_id === profile.user_id),
    peer = members.find((member: any) => member.user_id !== profile.user_id);
  const invited = mine?.invitation_status === "invited",
    ready = ["ready", "payment_pending"].includes(group.status),
    allPaid =
      members.length > 0 &&
      members.every((member: any) => member.payment_status === "paid");
  return (
    <section className="rounded-3xl border border-violet-500/15 bg-[#11141C] p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">
        Shared apartment · equal split
      </p>
      <h2 className="mt-2 text-lg font-bold">
        You and {peer?.name || "your roommate"}
      </h2>
      <p className="mt-2 text-sm leading-5 text-[#777C8D]">
        Both people accept and pay their own verified share. One person cannot
        complete the other person’s payment.
      </p>
      <div className="mt-4 divide-y divide-white/[.06] rounded-2xl bg-white/[.025] px-3">
        {members.map((member: any) => (
          <div
            key={member.user_id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="text-xs font-semibold">
                {member.user_id === profile.user_id ? "You" : member.name}
              </p>
              <p className="mt-1 text-sm capitalize text-[#686E7F]">
                {member.invitation_status} ·{" "}
                {String(member.payment_status).replace(/_/g, " ")}
              </p>
            </div>
            <p className="text-xs font-semibold text-violet-300">
              ₦{Number(member.share_amount || 0).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
      {invited && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={() => void onAccept(false)}
            className="h-11 rounded-xl border border-white/[.08] text-xs"
          >
            Decline
          </button>
          <button
            disabled={busy}
            onClick={() => void onAccept(true)}
            className="h-11 rounded-xl bg-violet-500 text-xs font-semibold"
          >
            Accept
          </button>
        </div>
      )}
      {mine?.invitation_status === "accepted" &&
        mine.payment_status !== "paid" &&
        ready && (
          <button
            disabled={busy}
            onClick={() => void onPay()}
            className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-50"
          >
            {busy
              ? "Opening secure checkout…"
              : `Pay my share · ₦${Number(mine.share_amount || 0).toLocaleString()}`}
          </button>
        )}
      {mine?.payment_status === "paid" && !allPaid && (
        <p className="mt-4 rounded-xl bg-emerald-500/[.06] p-3 text-sm text-emerald-300">
          Your share is confirmed. Waiting for {peer?.name || "your roommate"}.
        </p>
      )}
      {allPaid && (
        <p className="mt-4 rounded-xl bg-emerald-500/[.06] p-3 text-sm text-emerald-300">
          Both shares are confirmed. This apartment is held for your shared
          reservation.
        </p>
      )}
    </section>
  );
}

function ReservationPanel({
  shortStay,
  reservation,
  inspection,
  busy,
  fee,
  onResume,
  onInspect,
  onRentOptions,
  onRentPay,
  onOpenBooking,
  onSupport,
}: {
  shortStay: boolean;
  reservation: any;
  inspection: any;
  busy: boolean;
  fee: number;
  onResume: () => void;
  onInspect: () => void;
  onRentOptions: () => void;
  onRentPay: () => void;
  onOpenBooking: () => void;
  onSupport: () => void;
}) {
  const status = String(reservation?.status || "payment_pending");
  if (shortStay)
    return (
      <ShortStayReservationPanel
        reservation={reservation}
        busy={busy}
        onPay={onRentPay}
        onSupport={onSupport}
      />
    );
  if (status === "payment_pending")
    return (
      <section className="rounded-3xl border border-amber-500/15 bg-[#11141C] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-300">
          Reservation not completed
        </p>
        <h2 className="mt-2 text-lg font-bold">Finish your reservation</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#777B8B]">
          Complete the ₦{fee.toLocaleString()} reservation payment to submit
          this booking.
        </p>
        {reservation.payment_expires_at && (
          <p className="mt-3 text-sm text-amber-300">
            Checkout available until ·{" "}
            {new Date(reservation.payment_expires_at).toLocaleString()}
          </p>
        )}
        <button
          disabled={busy}
          onClick={onResume}
          className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Opening Paystack…" : "Continue reservation"}
        </button>
        <button
          onClick={onSupport}
          className="mt-2 h-10 w-full text-xs text-violet-300"
        >
          Message WeHouse
        </button>
      </section>
    );
  if (status === "occupied")
    return (
      <section className="rounded-3xl border border-violet-500/15 bg-[#11141C] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">
          Occupied
        </p>
        <h2 className="mt-2 text-lg font-bold">Your tenancy is active</h2>
        {reservation.tenancy_start_date && (
          <Row
            label="Started"
            value={new Date(
              reservation.tenancy_start_date,
            ).toLocaleDateString()}
          />
        )}
        {reservation.tenancy_end_date && (
          <Row
            label="Tenancy ends"
            value={new Date(reservation.tenancy_end_date).toLocaleDateString()}
          />
        )}
        {reservation.move_out_grace_until && (
          <Row
            label="Grace until"
            value={new Date(
              reservation.move_out_grace_until,
            ).toLocaleDateString()}
          />
        )}
        {Number(reservation.installment_balance || 0) > 0 && (
          <Row
            label="Installment balance"
            value={`₦${Number(reservation.installment_balance).toLocaleString()}`}
          />
        )}
        <button
          onClick={onSupport}
          className="mt-4 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold"
        >
          Message WeHouse
        </button>
      </section>
    );
  if (status === "ready_for_move_in") {
    const rentPaid = ["paid", "upfront_paid"].includes(
      String(reservation.rent_payment_status || ""),
    );
    if (!rentPaid)
      return (
        <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
            Inspection passed
          </p>
          <h2 className="mt-2 text-lg font-bold">Settle contract rent</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#777B8B]">
            Move-in cannot be activated until WeHouse verifies the required
            contract-rent payment.
          </p>
          <div className="mt-3 rounded-xl bg-white/[.035] p-3">
            <Row
              label="Total contract"
              value={`₦${Number(reservation.contract_rent_total || 0).toLocaleString()}`}
            />
            <Row
              label="Required now"
              value={`₦${Number(reservation.upfront_rent_required || 0).toLocaleString()}`}
            />
            {Number(reservation.installment_balance || 0) > 0 && (
              <Row
                label={`${reservation.installment_count || 4} installments later`}
                value={`₦${Number(reservation.installment_balance).toLocaleString()}`}
              />
            )}
          </div>
          <button
            disabled={busy}
            onClick={onRentPay}
            className="mt-4 h-12 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-[#03100B] disabled:opacity-50"
          >
            {busy
              ? "Opening Paystack…"
              : reservation.rent_payment_status === "payment_pending"
                ? "Continue contract-rent payment"
                : "Pay required contract rent"}
          </button>
          <button
            onClick={onSupport}
            className="mt-2 h-10 w-full text-xs text-violet-300"
          >
            Message WeHouse
          </button>
        </section>
      );
    const moveInRequested = Boolean(reservation.requested_move_in_at);
    return (
      <section className="rounded-3xl border border-emerald-500/15 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,.12),transparent_45%),#11141C] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Year 1 rent verified
        </p>
        <h2 className="mt-2 text-xl font-bold">
          {moveInRequested ? "Move-in time sent" : "Choose your move-in time"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#8A918F]">
          {moveInRequested
            ? "Meet Property Operations at the selected time. Show the booking code only when you arrive; your tenancy starts after access is handed over and verified."
            : "Rent payment alone does not start the tenancy. Open Bookings to choose when you can meet Property Operations for handover."}
        </p>
        {moveInRequested && reservation.requested_move_in_at && (
          <Row
            label="Requested arrival"
            value={new Date(reservation.requested_move_in_at).toLocaleString()}
          />
        )}
        {moveInRequested && reservation.booking_code && (
          <Row label="Booking code" value={String(reservation.booking_code)} />
        )}
        {reservation.rent_paid_at && (
          <Row
            label="Rent verified"
            value={new Date(reservation.rent_paid_at).toLocaleString()}
          />
        )}
        <button
          onClick={onOpenBooking}
          className="mt-4 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold"
        >
          {moveInRequested ? "Open move-in booking" : "Choose move-in time in Bookings"}
        </button>
        <button
          onClick={onSupport}
          className="mt-2 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold"
        >
          Message WeHouse
        </button>
      </section>
    );
  }
  return (
    <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Reservation paid
      </p>
      <h2 className="mt-2 text-lg font-bold">Apartment held for you</h2>
      {reservation.hold_expires_at && (
        <p className="mt-2 text-sm text-amber-300">
          Current hold · until{" "}
          {new Date(reservation.hold_expires_at).toLocaleString()}
        </p>
      )}
      <div className="mt-3 rounded-xl bg-white/[.035] p-3">
        <Row
          label="Reservation fee"
          value={`₦${Number(reservation.amount || fee).toLocaleString()}`}
        />
        <Row
          label="Rent plan"
          value={`${reservation.rental_plan_years || 1} year${Number(reservation.rental_plan_years || 1) === 1 ? "" : "s"}`}
        />
      </div>
      {inspection ? (
        <div className="mt-3 rounded-xl border border-violet-500/10 bg-violet-500/[.05] p-3 text-sm text-violet-300">
          Inspection ·{" "}
          {String(inspection.status || "pending").replace(/_/g, " ")}
        </div>
      ) : (
        <button
          disabled={busy}
          onClick={onInspect}
          className="mt-4 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? "Requesting…" : "Request apartment inspection"}
        </button>
      )}
      <button
        onClick={onRentOptions}
        className="mt-2 h-10 w-full text-xs font-semibold text-emerald-300"
      >
        Rent options
      </button>
      <button
        onClick={onSupport}
        className="h-10 w-full text-xs text-violet-300"
      >
        Message WeHouse
      </button>
    </section>
  );
}

function ShortStayReservationPanel({
  reservation,
  busy,
  onPay,
  onSupport,
}: {
  reservation: any;
  busy: boolean;
  onPay: () => void;
  onSupport: () => void;
}) {
  const status = String(reservation.status || "reserved");
  const paid = ["paid", "upfront_paid"].includes(
    String(reservation.rent_payment_status || ""),
  );
  const stay = (
    <div className="mt-4 rounded-xl bg-white/[.03] p-3">
      <Row label="Check-in" value={formatStayDate(reservation.stay_check_in)} />
      <Row
        label="Check-out"
        value={formatStayDate(reservation.stay_check_out)}
      />
      <Row label="Guests" value={String(reservation.guest_count || 1)} />
      <Row
        label="Stay rent"
        value={`₦${Number(reservation.stay_rent_total || 0).toLocaleString()}`}
      />
      <Row
        label="Refundable deposit"
        value={`₦${Number(reservation.security_deposit_snapshot || 0).toLocaleString()}`}
      />
    </div>
  );
  if (status === "occupied")
    return (
      <section className="rounded-3xl border border-violet-500/15 bg-[#11141C] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">
          Checked in
        </p>
        <h2 className="mt-2 text-lg font-bold">Your Short Let is active</h2>
        <p className="mt-2 text-sm leading-5 text-[#7D8291]">
          WeHouse recorded your entry. Checkout is due on the date below.
        </p>
        {stay}
        <button
          onClick={onSupport}
          className="mt-4 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold"
        >
          Message WeHouse
        </button>
      </section>
    );
  if (status === "completed")
    return (
      <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Checked out
        </p>
        <h2 className="mt-2 text-lg font-bold">Stay completed</h2>
        {stay}
        <p className="mt-3 text-sm text-[#7D8291]">
          Any refundable-deposit review remains attached to this booking.
        </p>
        <button
          onClick={onSupport}
          className="mt-4 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold"
        >
          Message WeHouse
        </button>
      </section>
    );
  if (!paid)
    return (
      <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Reservation prepared
        </p>
        <h2 className="mt-2 text-lg font-bold">Pay for your Short Let</h2>
        <p className="mt-2 text-sm leading-5 text-[#7D8291]">
          Review the stay price and any refundable deposit in your booking before
          payment. An unpaid reservation is not a confirmed stay.
        </p>
        {stay}
        <button
          disabled={busy}
          onClick={onPay}
          className="mt-4 h-12 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-[#03100B] disabled:opacity-50"
        >
          {busy
            ? "Opening Paystack…"
            : reservation.rent_payment_status === "payment_pending"
              ? "Continue Short Let payment"
              : "Pay stay and deposit"}
        </button>
        <button
          onClick={onSupport}
          className="mt-2 h-10 w-full text-xs text-violet-300"
        >
          Message WeHouse
        </button>
      </section>
    );
  return (
    <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Paid · ready for arrival
      </p>
      <h2 className="mt-2 text-lg font-bold">Check in with WeHouse</h2>
      <p className="mt-2 text-sm leading-5 text-[#7D8291]">
        Show the booking code on arrival. Operations records entry only during
        the reserved dates and the property owner is notified.
      </p>
      {reservation.booking_code && (
        <Row label="Booking code" value={String(reservation.booking_code)} />
      )}{" "}
      {stay}
      <button
        onClick={onSupport}
        className="mt-4 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold"
      >
        Message WeHouse
      </button>
    </section>
  );
}


function formatStayDate(value: unknown) {
  return value
    ? displayDate(String(value).slice(0, 10))
    : "—";
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[.06] bg-[#11141C] p-3 text-center">
      <p className="truncate text-sm uppercase text-[#5E6272]">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold capitalize">{value}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 text-sm">
      <span className="text-[#707586]">{label}</span>
      <span className="text-right font-semibold text-[#D5D8E0]">{value}</span>
    </div>
  );
}
