import {submitBookingReview} from '@/lib/propertyReviews';
import { discountedListingRate, listingDiscountQuote, type ListingDiscountQuote } from '@/lib/listingDiscountQuote';
import PropertySiteOffers from "@/components/PropertySiteOffers";
import { homeStyleLabel } from '@/lib/homeStyles';
import { shortLetRefundHours } from "@/lib/shortLetCancellationPolicy";
import { shortLetPayment,shortLetBookingPrice } from "@/lib/shortLetPayment";
import { propertyTimeZone } from "@/lib/regional";
import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import { releaseRequestKey, requestKeyFor, runSafeAction } from "@/lib/safeAction";
import { publicPropertyImages } from "@/lib/publicPropertyMedia";
import { browseDate, readPublicBrowseDraft, savePublicBrowseDraft } from "@/lib/publicBrowseDraft";
import PropertyShareDialog from "@/components/PropertyShareDialog";
import ReportListingDialog from "@/components/ReportListingDialog";
import { sharePropertyExternally } from "@/lib/propertyShare";
import { displayDate } from "@/lib/displayDate";
import DateField from "@/components/BookingDateField";
import { useEffect, useRef, useState } from "react";
import { addCalendarDays, platformCalendarDate, validateShortLetDates } from "@/lib/shortLetQuote";
import {
  createInspectionRequest,
  createReservation,
  createShortStayReservation,
  cancelReservation,
  getInspectionRequestForReservation,
  getListing,
  getReservationForListing,
  initializeReservationPayment,
  supabase,
} from "@/lib/supabase";
import {
  initializeApartmentRentPayment,
  initializeShortStayPayment,
} from "@/lib/supabase/housing-payments";
import {
  createSharedLongLet,
  getMySharedHousingGroups,
  initializeSharedHousingPayment,
  respondToSharedHousingInvite,
} from "@/lib/supabase/shared-housing";
import { getRoommateConversationPeople } from "@/lib/supabase/chat";
import { listMyFriends, type Friend } from "@/lib/supabase/friends";
import { selectRoommateRecipientsFromPeers, type RoommateRecipient } from "@/lib/roommateRecipients";
import { withTimeout } from "@/lib/withTimeout";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import type { Listing, Profile } from "@/types";
import PropertyMediaCarousel from "@/components/PropertyMediaCarousel";
import {
  directionsUrl,
  getDiscoveryDistanceMap,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";
import { toast } from "sonner";
import { listingDisplayTitle } from "@/lib/listingPresentation";
import { locationLabel } from "@/lib/locationPresentation";
import PropertyBookingJourney from "@/components/PropertyBookingJourney";
import { getPropertyBookingJourney, hasProtectedAccommodationPayment } from "@/lib/propertyBookingLifecycle";
import BackButton from "@/components/BackButton";
import BookingPaymentReview from "@/components/BookingPaymentReview";
import { formatRecordedMoney, formatRecordedMoney as formatMoney } from "@/lib/regional";

type Props = {
  listingId: string;
  onOpenListing?: (id: string) => void;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile | null;
  onRequireAuth?: () => void;
  onGoToChat: (convId: string) => void;
  onGoToFriendChat?: (id: string) => void;
  onOpenBooking: (reservationId: string) => void;
};

type ListingReviewSummary = {
  rating: number | null;
  review_count: number;
  reviews: Array<{
    review_id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    profiles?: { username?: string | null; avatar_url?: string | null } | null;
  }>;
  eligible: boolean;
  eligible_reservation_id?: string | null;
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
    cls: "border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]",
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

function DiscountSourceNote({ split }: { split: { host: number; wehouse: number; endsOn: string | null } }) {
  if (split.host + split.wehouse <= 0) return null;
  return (
    <p className="mt-2 text-xs text-[var(--wh-text-secondary)]">
      {[split.host > 0 ? `${split.host}% off from the host` : "", split.wehouse > 0 ? `${split.wehouse}% off from WeHouse` : ""].filter(Boolean).join(" + ")}
      {split.endsOn ? ` · ends ${split.endsOn}` : ""}
    </p>
  );
}

export default function ListingDetail({
  listingId,
  onNavigate,
  profile,
  isSaved,
  onToggleSave,
  onOpenBooking,
  onGoToChat,
  onGoToFriendChat,
  onRequireAuth,
  onOpenListing,
}: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingReviewSummary, setListingReviewSummary] = useState<ListingReviewSummary | null>(null);
  const [listingReviewLoading, setListingReviewLoading] = useState(false);
  const [listingReviewError, setListingReviewError] = useState("");
  const [listingReviewAttempt, setListingReviewAttempt] = useState(0);
  const [listingReviewFormOpen, setListingReviewFormOpen] = useState(false);
  const [listingReviewRating, setListingReviewRating] = useState(5);
  const [listingReviewComment, setListingReviewComment] = useState("");
  const [listingReviewSaving, setListingReviewSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [discountReceipt, setDiscountReceipt] = useState<{ listingId: string; quote: ListingDiscountQuote } | null>(null);
  const [discountError, setDiscountError] = useState(false), [discountAttempt, setDiscountAttempt] = useState(0);
  const discountQuote = discountReceipt?.listingId === String(listing?.id) ? discountReceipt.quote : null;
  const discountPercent = discountQuote?.total ?? 0;
  const discountSplit = discountQuote ?? { host: 0, wehouse: 0, endsOn: null };
  const [loadError, setLoadError] = useState("");
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");
  const loadGeneration = useRef(0);
  const reservationInFlight = useRef(false);
  const viewingInFlight = useRef(false);
  const [reservation, setReservation] = useState<any>(null);
  const formatMoney=(value:unknown)=>formatRecordedMoney(value,reservation?.currency??listing?.currency);
  const [inspection, setInspection] = useState<any>(null);
  const [reservationOptionsOpen, setReservationOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sendPropertyOpen, setSendPropertyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [roommateRecipients, setRoommateRecipients] = useState<RoommateRecipient[]>([]);
  const [friendRecipients, setFriendRecipients] = useState<Friend[]>([]);
  const [pickedPeople, setPickedPeople] = useState<string[]>([]);
  const [missingRoommateIdentities, setMissingRoommateIdentities] = useState(0);
  const [sharedGroup, setSharedGroup] = useState<any>(null);
  const [shortCheckIn, setShortCheckIn] = useState("");
  const [shortCheckOut, setShortCheckOut] = useState("");
  const [shortGuests, setShortGuests] = useState(1);
  const [paymentReview, setPaymentReview] = useState<"short_let" | "long_let" | null>(null);
  const { location } = useDiscoveryLocation();
  const [distance, setDistance] = useState<number | null>(null);
  const { getNumber } = usePlatformSettings();
  const reservationFee = getNumber("reservation_fee", 10000);
  const shortReservationFee = getNumber("short_let_reservation_fee", 10000);

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
      if (property?.sub_type === 'short_let') {
        const draft = readPublicBrowseDraft('listing', listingId);
        setShortCheckIn(browseDate(draft.checkIn)); setShortCheckOut(browseDate(draft.checkOut));
        setShortGuests(Number.isInteger(draft.guests) && Number(draft.guests) > 0 ? Number(draft.guests) : 1);
      }
      // Show the public property immediately; account checks guard only actions.
      setLoading(false);
      setReservation(null); setInspection(null); setSharedGroup(null);
      if (!property || !profile) return;
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
    let active = true;
    setListingReviewSummary(null);
    setListingReviewError("");
    if (!listing?.id) {
      setListingReviewLoading(false);
      return () => { active = false; };
    }
    setListingReviewLoading(true);
    void withTimeout(
      supabase.rpc("get_listing_review_summary", { p_listing_id: String(listing.id) }),
      15000,
      "Property reviews took too long.",
    ).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) setListingReviewError("Property reviews could not be loaded.");
      else setListingReviewSummary(data as ListingReviewSummary);
    }).catch(() => {
      if (active) setListingReviewError("Property reviews could not be loaded.");
    }).finally(() => {
      if (active) setListingReviewLoading(false);
    });
    return () => { active = false; };
  }, [listing?.id, profile?.user_id, listingReviewAttempt]);

  useEffect(() => {
    setDiscountReceipt(null);
    setDiscountError(false);
    if (!listing?.id || !["short_let", "long_stay"].includes(String(listing.sub_type))) {
      return;
    }
    let active = true;
    void withTimeout(supabase.rpc("listing_discount_breakdown", { p_listing_id: listing.id }), 15000, 'Offers took too long.')
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        const row = listingDiscountQuote(data);
        setDiscountReceipt({ listingId: String(listing.id), quote: row });
      }).catch(() => { if (active) setDiscountError(true); });
    return () => {
      active = false;
    };
  }, [listing?.id, listing?.sub_type, discountAttempt]);

  useEffect(() => {
    setShortCheckIn(""); setShortCheckOut(""); setShortGuests(1);
    setShareOpen(false); setReservationOptionsOpen(false);
    void load();
    return () => { loadGeneration.current += 1; };
  }, [listingId, profile?.user_id]);

  useEffect(() => {
    let live = true;
    void getDiscoveryDistanceMap(location, { listingIds: [String(listing?.id || listingId)] }).then((map) => {
      if (live) setDistance(map.get(`listing:${listing?.id || listingId}`) ?? null);
    });
    return () => { live = false; };
  }, [listing?.id, listingId, location]);

  useEffect(() => {
    if (!loading && listing?.id === listingId) savePublicBrowseDraft("listing", listingId, { checkIn: shortCheckIn, checkOut: shortCheckOut, guests: shortGuests });
  }, [loading, listing, listingId, shortCheckIn, shortCheckOut, shortGuests]);

function formatBookingDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatBookingDeadline(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function support(
    kind: "property" | "reservation" | "inspection" | "payment" = "property",
  ) {

  if (!listing) return;
    if (!profile) { onRequireAuth?.(); return; }
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
          subject: `${kind === "property" ? "Question about" : kind === "payment" ? "Payment help" : kind === "inspection" ? "Viewing help" : "Reservation help"} · ${displayTitle}`,
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

  const reviewLock=useRef(false);
  async function submitListingReview() {
    if (!listing?.id || !listingReviewSummary?.eligible || !listingReviewSummary.eligible_reservation_id || reviewLock.current || listingReviewSaving) return;
    reviewLock.current=true;
    setListingReviewSaving(true);
    try {
      await submitBookingReview(listingReviewSummary.eligible_reservation_id,listingReviewRating,listingReviewComment);
      const refreshed = await withTimeout(
        supabase.rpc("get_listing_review_summary", { p_listing_id: String(listing.id) }),
        15000,
        "Your review was saved, but the updated list took too long to load.",
      );
      if (!refreshed.error && refreshed.data) setListingReviewSummary(refreshed.data as ListingReviewSummary);
      setListingReviewFormOpen(false);
      setListingReviewComment("");
      toast.success("Your property review was saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your review could not be submitted");
    } finally {
      reviewLock.current=false;
      setListingReviewSaving(false);
    }
  }

  async function reserveShortLet() {
    if (!profile) { onRequireAuth?.(); return; }
    if (!listing || listing.sub_type !== "short_let" || reservationInFlight.current || busy || accountLoading || accountError || !selection.valid) return;
    reservationInFlight.current = true;
    setBusy(true);
    const request = loadGeneration.current;
    const reserveSignature = `reserve:${listingId}:${shortCheckIn}:${shortCheckOut}:${shortGuests}`;
    try {
      const created = await withTimeout(
        runSafeAction(reserveSignature, () => createShortStayReservation(listingId, shortCheckIn, shortCheckOut, shortGuests, requestKeyFor(reserveSignature))),
        20000,
        "Reservation could not be confirmed. Check your bookings before trying again.",
      );
      if (created.error || !created.reservation?.id)
        throw created.error || new Error("Reservation could not be created.");
      if (request !== loadGeneration.current) return;
      releaseRequestKey(reserveSignature);
      setReservation(created.reservation);
      setPaymentReview("short_let");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Those dates could not be reserved. Please try again.");
    } finally {
      reservationInFlight.current = false;
      setBusy(false);
    }
  }

  async function openCheckout() {
    if (!profile) { onRequireAuth?.(); return; }
    if (!listing || listing.sub_type === "short_let") return;
    setBusy(true);
    try {
      const { reservation: created, error: reserveError } = await createReservation(listingId, profile.user_id);
      if (reserveError || !created) throw new Error(reserveError?.message || "Could not start this reservation");
      setReservation(created);
      if (created.status !== "payment_pending") {
        toast.success("Your reservation is already active");
        await load();
        return;
      }
      setPaymentReview("long_let");
    } catch (error: any) {
      toast.error(error?.message || "Could not start reservation");
    } finally {
      setBusy(false);
    }
  }

  async function continueReservationPayment() {
    if (!reservation?.id || !reservation.payment_reference || !paymentReview || busy) return;
    if (paymentReview === "short_let" && (!reservation.short_stay_cancellation_policy_snapshot || shortLetRefundHours(reservation.short_stay_cancellation_policy_snapshot)===null || !shortLetBookingPrice(shortLetPayment(reservation),reservation.reservation_fee_snapshot))) {
      toast.error("Saved cancellation terms are missing, so payment is paused.");
      return;
    }
    setBusy(true);
    try {
      const { result, error } = await runSafeAction(`pay:${reservation.payment_reference}`, () => initializeReservationPayment(String(reservation.payment_reference)));
      if (error) throw error;
      if (result?.already_paid) {
        toast.success("Reservation payment is already confirmed");
        setPaymentReview(null);
        onOpenBooking(String(reservation.id));
        return;
      }
      if (!result?.success || !result.authorization_url)
        throw new Error(result?.error || "Paystack checkout could not be opened");
      window.location.assign(String(result.authorization_url));
    } catch (error: any) {
      toast.error(error?.message || "Could not open secure payment");
      setBusy(false);
    }
  }

  async function editPaymentReview() {
    if (!reservation?.id || busy) return;
    setBusy(true);
    try {
      const { reservation: cancelled, error } = await runSafeAction(`cancel:${reservation.id}`, () => cancelReservation(String(reservation.id)));
      if (error || !cancelled) throw new Error(error?.message || "The unpaid reservation hold could not be released");
      setReservation(null);
      setPaymentReview(null);
      toast.success("Reservation hold released. You can edit your selection.");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Could not release this reservation hold");
    } finally {
      setBusy(false);
    }
  }

  async function openShare() {
    if (!profile) { onRequireAuth?.(); return; }
    if (busy) return;
    setBusy(true);
    setShareOpen(false);
    setRoommateRecipients([]);
    setFriendRecipients([]);
    setPickedPeople([]);
    setMissingRoommateIdentities(0);
    try {
      const friends = await withTimeout(listMyFriends(), 15000, "Friends took too long to load.");
      if (friends.error) throw friends.error;
      setFriendRecipients(friends.friends.filter((friend) => friend.status === "accepted"));
      const peers = await withTimeout(getRoommateConversationPeople(), 15000, "Connections took too long to load.");
      if (peers.error) throw peers.error;
      setRoommateRecipients(selectRoommateRecipientsFromPeers(profile.user_id, peers.connections));
      setShareOpen(true);
    } catch {
      toast.error("Your connections could not be loaded. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  // Picked keys are "roommate:<conversationId>" or "friend:<userId>". Up to 2 others, so 3 people pay.
  function togglePicked(key: string) {
    setPickedPeople((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : current.length >= 2 ? current : [...current, key],
    );
  }
  async function sendShareInvitation() {
    const roommateIds = pickedPeople.filter((key) => key.startsWith("roommate:")).map((key) => key.slice(9));
    const friendIds = pickedPeople.filter((key) => key.startsWith("friend:")).map((key) => key.slice(7));
    if (!roommateIds.length && !friendIds.length) return;
    setBusy(true);
    const { group, error } = await createSharedLongLet(String(listing?.id || listingId), roommateIds, friendIds);
    setBusy(false);
    if (error) return toast.error(error.message);
    setSharedGroup(group);
    setShareOpen(false);
    toast.success("Shared-home invitation sent");
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
    if (!reservation) return;
    if (listing?.sub_type === "short_let") {
      if (reservation.reservation_fee_status === "paid" || reservation.manual_payment_status === "paid" || reservation.manual_payment_status === "completed") return payContractRent();
      if (!reservation.payment_reference) return toast.error("Reserve date payment reference is missing");
    } else if (!reservation.payment_reference) {
      return toast.error("Payment reference is missing");
    }
    setBusy(true);
    try {
      const { result, error } = await runSafeAction(`pay:${reservation.payment_reference}`, () => initializeReservationPayment(String(reservation.payment_reference)));
      if (error) throw error;
      if (result?.already_paid) {
        toast.success(listing?.sub_type === "short_let" ? "Reserve date payment is already confirmed" : "Payment is already confirmed");
        await load();
        setBusy(false);
        return;
      }
      if (!result?.success || !result.authorization_url) throw new Error(result?.error || "Could not reopen Paystack");
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || "Could not reopen payment");
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
    if (!profile) { onRequireAuth?.(); return; }
    if (!reservation || viewingInFlight.current) return;
    if (getPropertyBookingJourney(reservation, inspection).action !== 'choose_inspection_or_rent') {
      toast.error('Refresh this booking to see its current next step.');
      return;
    }
    viewingInFlight.current = true;
    setBusy(true);
    try {
    const { inspection: request, error } = await withTimeout(createInspectionRequest(
      reservation.id,
      listingId,
      profile.user_id,
      `Viewing requested for ${listing?.title || "property"}`,
    ), 15000, 'The viewing request could not be confirmed. Refresh this booking before retrying.');
    if (error) throw error;
    setInspection(request || null);
    await load();
    toast.success("Viewing requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The viewing request could not be confirmed. Refresh this booking before retrying.');
    } finally {
      viewingInFlight.current = false;
      setBusy(false);
    }
  }

  if (loading)
    return (
      <WeHouseLoadingState compact label="Loading" />
    );
if (loadError) return <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 p-5 text-center text-white">
    <h1 className="text-xl font-semibold">Property could not be loaded</h1>
    <p role="alert" className="max-w-sm text-sm leading-6 text-[var(--wh-text-secondary)]">{loadError}</p>
    <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-violet-600 px-5 font-semibold">Try again</button>
    <button type="button" onClick={onNavigate} className="min-h-11 px-5 text-violet-300">Go back</button>
  </main>;
  if (!listing)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[var(--wh-bg)] px-4 text-center text-[var(--wh-text)]">
        <div>
          <p className="text-sm font-semibold">Home unavailable</p>
          <button onClick={onNavigate} className="mt-4 text-xs text-violet-400">
            ← Go back
          </button>
        </div>
      </div>
    );

  const status = String(listing.status || "available") as ListingState;
  const state = LISTING_STATES[status] || LISTING_STATES.closed;
  const images = publicPropertyImages(listing.images);
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
  const today = platformCalendarDate(new Date(), propertyTimeZone());
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
  const reviewAmount = Number(
    paymentReview === "short_let"
      ? reservation?.reservation_fee_snapshot ?? reservation?.amount ?? shortReservationFee
      : reservation?.amount ?? reservationFee,
  );
  const shortPolicy = reservation?.short_stay_cancellation_policy_snapshot as Record<string, unknown> | undefined;
  const shortRefundHours=shortPolicy?shortLetRefundHours(shortPolicy):null;
  const reviewShortPrice=reservation?shortLetBookingPrice(shortLetPayment(reservation),reservation.reservation_fee_snapshot):null;
  const shortCancellationTerms = shortPolicy && shortRefundHours!==null
    ? shortPolicy.non_refundable
      ? "This discounted rate is non-refundable for ordinary guest cancellation. Provider failure and payment errors remain reviewable by WeHouse."
      : `Cancel at least ${shortRefundHours} hours before check-in for a refund of eligible protected stay funds. Separate reservation fees require policy review. Late cancellations and no-shows require WeHouse review under the saved policy. The refundable security deposit is never used as a cancellation charge. These terms are saved with your reservation.`
    : "Cancellation terms are missing from this reservation. Payment stays paused until WeHouse can show the saved policy.";

  const reviewRows = paymentReview === "short_let"
    ? [
        { label: "Property", value: String(reservation?.listing_title || displayTitle) },
        { label: "Check-in", value: formatBookingDate(reservation?.stay_check_in || shortCheckIn) },
        { label: "Check-out", value: formatBookingDate(reservation?.stay_check_out || shortCheckOut) },
        { label: "Nights and guests", value: `${Number(reservation?.stay_nights || selection.nights)} nights · ${Number(reservation?.guest_count || shortGuests)} guest${Number(reservation?.guest_count || shortGuests) === 1 ? "" : "s"}` },
        { label: "Nightly rate", value: formatMoney(reservation?.nightly_rate_snapshot) },
        { label: "Stay rent due later", value: formatMoney(reservation?.stay_rent_total) },
        ...(Number(reservation?.security_deposit_snapshot || 0) > 0
          ? [{ label: "Refundable security deposit due later", value: formatMoney(reservation?.security_deposit_snapshot) }]
          : []),
        { label: "Total booking cost", value: reviewShortPrice?formatMoney(reviewShortPrice.total):"Price could not be confirmed" },
        { label: "Stay balance due later", value: formatMoney(Number(reservation?.stay_rent_total || 0) + Number(reservation?.security_deposit_snapshot || 0)) },
        { label: "Date hold expires", value: formatBookingDeadline(reservation?.payment_expires_at || reservation?.hold_expires_at) },
      ]
    : [
        { label: "Home", value: String(reservation?.listing_title || displayTitle) },
        { label: "Location", value: String(reservation?.listing_location || visibleAddress) },
        { label: "Reservation fee", value: formatMoney(reviewAmount) },
        { label: "Hold expires", value: formatBookingDeadline(reservation?.payment_expires_at || reservation?.hold_expires_at) },
        { label: "Next step", value: "Review the tenancy and rent plan; request an optional viewing before paying rent" },
      ];

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[var(--wh-bg)] pb-12 text-[var(--wh-text)]">

      <div className="mx-auto max-w-6xl">
        <PropertyMediaCarousel
          images={images}
          videos={publicPropertyImages(listing.videos)}
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
                isSaved ? "Remove from saved listings" : "Save listing"
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

        {sendPropertyOpen && profile && <PropertyShareDialog userId={profile.user_id} property={{ kind: "listing", id: String(listing.id) }} title={displayTitle} stayType={listing.sub_type === 'short_let' ? 'short_let' : 'long_stay'} onClose={() => setSendPropertyOpen(false)} onConversation={onGoToChat} onFriendConversation={onGoToFriendChat} />}
        {reportOpen && profile && listing && (
          <ReportListingDialog
            listingId={String(listing.id)}
            listingTitle={displayTitle}
            onUrgentSafety={() => {
              setReportOpen(false);
              window.dispatchEvent(new CustomEvent("openSupportChat", {
                detail: {
                  subject: `Urgent safety concern · ${displayTitle}`,
                  category: "safety",
                  contextType: "property_listing",
                  contextId: String(listing.listing_id || listing.id),
                  priority: "urgent",
                  contextSnapshot: {
                    source_type: "listing",
                    source_id: String(listing.listing_id || listing.id),
                    listing_title: displayTitle,
                    reason_code: "safety_threat",
                  },
                },
              }));
            }}
            onClose={() => setReportOpen(false)}
          />
        )}
        <main className="px-4 py-5 sm:px-6 lg:px-8">
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => {
              if (profile) { setSendPropertyOpen(true); return; }
              void sharePropertyExternally({ kind: "listing", id: String(listing.id) }, displayTitle)
                .then(result => { if (result === "copied") toast.success("Property link copied"); })
                .catch(() => toast.error("This property could not be shared"));
            }} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold text-violet-300">Share ↗</button>
            <button type="button" onClick={() => {
              if (!profile) { onRequireAuth?.(); return; }
              setReportOpen(true);
            }} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold text-[var(--wh-text-secondary)]">Report listing</button>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <section>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="break-words text-2xl font-bold">
                      {displayTitle}
                    </h1>
                    <p className="mt-1 text-xs text-[var(--wh-text-muted)]">
                      {visibleAddress || "Location unavailable"}
                    </p>
                  </div>
                  <p className="shrink-0 text-xl font-bold text-violet-400">
                    {discountPercent > 0 ? (
                      <span className="mr-1 text-sm font-normal text-[var(--wh-text-muted)] line-through">
                        {formatMoney(Number(listing.price || 0))}
                      </span>
                    ) : null}
                    {formatMoney(discountedListingRate(listing.price, discountPercent))}
                    <span className="ml-1 text-sm font-normal text-[var(--wh-text-muted)]">
                      {listing.sub_type === "short_let" ? "/night" : discountPercent > 0 ? "Year 1" : "/year"}
                    </span>
                  </p>
                </div>
                <DiscountSourceNote split={discountSplit} />
                {discountError && <p role="status" className="mt-2 text-sm text-[var(--wh-text-secondary)]">Offers could not be loaded. Your final price is confirmed before payment. <button type="button" className="min-h-11 font-semibold text-[var(--wh-accent-text)]" onClick={() => setDiscountAttempt(n => n + 1)}>Retry offers</button></p>}
              </section>
              <section className="grid grid-cols-3 gap-2">
                <Fact
                  label="Type"
                  value={
                    listing.sub_type === "short_let"
                      ? "Short Let"
                      : listing.sub_type === "long_stay"
                        ? "Long Let"
                        : listing.property_type === "hotel" ? "Hotel" : "Home"
                  }
                />
                {homeStyleLabel(listing.home_style) && <Fact label="Home type" value={homeStyleLabel(listing.home_style)} />}
                <Fact label="Bedrooms" value={listing.bedrooms === 0 ? "Studio" : listing.bedrooms ?? "—"} />
                <Fact label="Bathrooms" value={listing.bathrooms || "—"} />
              </section>
              {listing.space_scope&&<section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-sm"><h2 className="font-semibold">{listing.space_scope==='private_room'?'Private room in a shared home':'Entire home'}{listing.space_label?` · ${listing.space_label}`:''}</h2>{listing.space_scope==='private_room'&&<p className="mt-2 leading-6 text-[var(--wh-text-secondary)]">Shared areas: {listing.shared_areas?.join(', ')||'Ask WeHouse to confirm before booking.'}</p>}</section>}
              {onOpenListing&&<PropertySiteOffers key={listing.id} listingId={listing.id} checkIn={shortCheckIn} checkOut={shortCheckOut} onOpen={onOpenListing}/>}
              {listing.description && (
                <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
                  <h2 className="text-sm font-semibold">
                    About this home
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--wh-text-secondary)]">
                    {listing.description}
                  </p>
                </section>
              )}
              {Array.isArray(listing.amenities) && listing.amenities.length > 0 && (
                <section aria-label="Property amenities" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
                  <h2 className="text-sm font-semibold">What this place offers</h2>
                  <ul className="mt-3 grid gap-2 text-sm text-[var(--wh-text-secondary)] sm:grid-cols-2">
                    {listing.amenities.map((amenity) => <li key={amenity} className="rounded-xl bg-[var(--wh-interactive)] px-3 py-2.5">{amenity}</li>)}
                  </ul>
                </section>
              )}
              <section className="border-y border-[var(--wh-border-subtle)] py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold">
                      Property location
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-[var(--wh-text-muted)]">
                      {visibleAddress || "Location unavailable"}
                      {distance !== null
                        ? ` · about ${distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} m` : `${distance.toFixed(distance < 10 ? 1 : 0)} km`} away`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-[var(--wh-text-muted)]">
                      The published street address is visible before booking. Internal entrance-location data stays private.
                    </p>
                  </div>
                  {visibleAddress && (
                    <a
                      href={directionsUrl(visibleAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-xl border border-[var(--wh-border-subtle)] px-4 py-2.5 text-sm font-semibold text-violet-300"
                    >
                      Directions
                    </a>
                  )}
                </div>
              </section>
              <section aria-label="Property reviews" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Property reviews</h2>
                    {Number(listingReviewSummary?.review_count || 0) > 0 && (
                      <p className="mt-1 text-sm text-[var(--wh-text-secondary)]">
                        <span aria-label={`${Number(listingReviewSummary?.rating || 0).toFixed(1)} out of 5`}>★ {Number(listingReviewSummary?.rating || 0).toFixed(1)}</span>
                        {` · ${listingReviewSummary?.review_count} verified ${listingReviewSummary?.review_count === 1 ? "review" : "reviews"}`}
                      </p>
                    )}
                  </div>
                  {listingReviewSummary?.eligible && (
                    <button type="button" onClick={() => setListingReviewFormOpen((open) => !open)} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold text-violet-600 dark:text-violet-300">
                      {listingReviewFormOpen ? "Close review" : "Write a review"}
                    </button>
                  )}
                </div>
                {listingReviewLoading ? <WeHouseLoadingState compact label="Loading property reviews" />
                  : listingReviewError ? <div role="status" className="mt-3 text-sm text-[var(--wh-text-secondary)]"><p>{listingReviewError}</p><button type="button" onClick={() => setListingReviewAttempt((attempt) => attempt + 1)} className="mt-2 min-h-11 font-semibold text-violet-600 dark:text-violet-300">Try again</button></div>
                  : listingReviewSummary?.reviews?.length ? (
                    <div className="mt-3 divide-y divide-[var(--wh-border-subtle)]">
                      {listingReviewSummary.reviews.map((review) => (
                        <article key={review.review_id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{review.profiles?.username || "Verified reviewer"}</p>
                              <p className="mt-1 text-xs text-[var(--wh-text-muted)]">{formatBookingDate(review.created_at)}</p>
                            </div>
                            <span aria-label={`${review.rating} out of 5`} className="shrink-0 text-sm text-amber-500 dark:text-amber-300">{"★".repeat(Math.max(0, Math.min(5, Number(review.rating))))}</span>
                          </div>
                          {review.comment && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--wh-text-secondary)]">{review.comment}</p>}
                        </article>
                      ))}
                    </div>
                  ) : <p className="mt-3 text-sm text-[var(--wh-text-secondary)]">No verified property reviews yet.</p>}
                {listingReviewFormOpen && listingReviewSummary?.eligible && (
                  <form className="mt-4 space-y-3 border-t border-[var(--wh-border-subtle)] pt-4" onSubmit={(event) => { event.preventDefault(); void submitListingReview(); }}>
                    <label className="block text-sm font-medium">Your rating
                      <select value={listingReviewRating} onChange={(event) => setListingReviewRating(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm text-[var(--wh-text)]">
                        {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} out of 5</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">Your review
                      <textarea maxLength={2000} rows={3} value={listingReviewComment} onChange={(event) => setListingReviewComment(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-sm text-[var(--wh-text)]" placeholder={listing.sub_type === "long_stay" ? "Share what future tenants should know" : "Share what future guests should know"} />
                    </label>
                    <button type="submit" disabled={listingReviewSaving} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{listingReviewSaving ? "Saving review…" : "Submit review"}</button>
                  </form>
                )}
              </section>
              {!hasOwnActiveReservation && !sharedGroup && (
                <section className="border-y border-[var(--wh-border-subtle)] py-4">
                  <h2 className="text-sm font-semibold">
                    Questions about this property?
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--wh-text-secondary)]">
                    Message WeHouse here. Your conversation stays connected to
                    this property.
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
                <section role="status" aria-label="Checking your booking status" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-sm text-[var(--wh-text-secondary)]">Checking your booking status…</section>
              ) : accountError ? (
                <section role="alert" className="rounded-2xl border border-amber-500/20 bg-[var(--wh-surface)] p-5 text-sm leading-6 text-amber-100"><p>{accountError}</p><button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold text-violet-300">Refresh booking status</button></section>
              ) : sharedGroup && profile ? (
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
                  <section className="rounded-3xl border border-violet-500/15 bg-[var(--wh-surface)] p-5">
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
                          {formatMoney(discountedListingRate(listing.price, discountPercent))}
                        </span>
                        {discountPercent > 0 ? (
                          <span className="block text-xs text-[var(--wh-text-muted)]">
                            <span className="line-through">{formatMoney(Number(listing.price || 0))}</span> · {discountPercent}% off
                          </span>
                        ) : null}
                        <span className="text-sm text-[var(--wh-text-muted)]">
                          per night
                        </span>
                      </p>
                    </div>
                    <DiscountSourceNote split={discountSplit} />
                    <p className="mt-2 text-sm text-[var(--wh-text-muted)]">
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
                    <div className="mt-4 flex h-14 items-center justify-between rounded-2xl border border-[var(--wh-border-subtle)] bg-black/10 px-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShortGuests((value) => Math.max(1, value - 1))
                        }
                        disabled={shortGuests <= 1 || busy}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--wh-border-subtle)] text-xl disabled:opacity-25"
                        aria-label="Remove one guest"
                      >
                        −
                      </button>
                      <div className="text-center">
                        <p className="text-sm font-bold">{shortGuests}</p>
                        <p className="text-sm text-[var(--wh-text-muted)]">
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
                        className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--wh-border-subtle)] text-xl disabled:opacity-25"
                        aria-label="Add one guest"
                      >
                        +
                      </button>
                    </div>
                    {selection.valid && <p className="mt-4 text-sm text-[var(--wh-text-secondary)]">{selection.nights} night{selection.nights === 1 ? "" : "s"} · {shortGuests} guest{shortGuests === 1 ? "" : "s"}</p>}
                    {shortCheckIn && shortCheckOut && !selection.valid && <p role="alert" className="mt-3 text-sm leading-6 text-amber-200">{selection.error}</p>}
                    <button type="button" disabled={busy || !selection.valid}
                      onClick={() => void reserveShortLet()}
                      className="mt-4 min-h-12 w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold disabled:opacity-40">
                      {busy ? "Checking availability…" : `Review dates · ${formatMoney(shortReservationFee)}`}
                    </button>
                    <p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">Reserve date pays only the reservation fee. Your stay price{Number(listing.security_deposit_amount || 0) > 0 ? " and refundable security deposit" : ""} are reviewed and paid separately after your dates are reserved.</p>
                  </section>
                ) : (
                  <section className="border-y border-[var(--wh-border-subtle)] py-5">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-[.15em] text-violet-300">
                          Long Let
                        </p>
                        <h2 className="mt-1 text-lg font-bold">
                          {listing.space_scope==='private_room'?'Reserve this room':'Reserve this home'}
                        </h2>
                      </div>
                      <p className="text-right">
                        <span className="block text-sm font-bold">
                          {formatMoney(reservationFee)}
                        </span>
                        <span className="text-sm text-[var(--wh-text-muted)]">
                          reservation fee
                        </span>
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--wh-text-muted)]">
                      Proceed with reservation to begin the viewing and
                      tenancy journey.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => void openCheckout()}
                      className="mt-4 h-12 w-full rounded-full bg-violet-500 text-sm font-semibold disabled:opacity-50"
                    >
                      Review reservation fee
                    </button>
                    <button
                      onClick={() => setReservationOptionsOpen(true)}
                      className="mt-3 h-10 w-full text-xs font-semibold text-violet-300"
                    >
                      Share booking cost
                    </button>
                  </section>
                )
              ) : (
                <section className="rounded-3xl border border-amber-500/15 bg-amber-500/[.04] p-5">
                  <h2 className="text-sm font-semibold">{state.label}</h2>
                  <p className="mt-2 text-sm text-[var(--wh-text-secondary)]">
                    This property is not open for a new reservation right now.
                  </p>
                </section>
              )}
            </aside>
          </div>
        </main>
      </div>

      {paymentReview && reservation ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review reservation and payment"
          className="fixed inset-0 z-[100040] flex items-end justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:p-5"
        >
          <div className="my-auto w-full max-w-xl">
            <BookingPaymentReview
              eyebrow={paymentReview === "short_let" ? "Short Let" : "Long Let"}
              title={paymentReview === "short_let" ? "Review your dates and payment" : "Review your reservation"}
              subtitle={paymentReview === "short_let"
                ? "Your dates are held while you review. The amount due now is the reserve-date fee; the stay balance is separate."
                : "Check the property and reservation fee before continuing. Rent is paid separately. A viewing is optional."}
              rows={reviewRows}
              amountLabel={paymentReview === "short_let" ? "Reserve-date fee due now" : "Reservation fee due now"}
              amount={formatMoney(reviewAmount)}
              termsTitle={paymentReview === "short_let" ? "Cancellation and stay terms" : "What this reservation payment covers"}
              terms={paymentReview === "short_let"
                ? shortCancellationTerms
                : "This payment holds the property while you begin the viewing and tenancy journey. It is the reservation fee only; it is not rent or a security deposit. Paid reservations that need cancellation or a refund are handled through WeHouse support."}
              note={paymentReview === "short_let"
                ? "Only the reserve-date fee is paid now. The stay rent and refundable security deposit are due in a separate checkout before the stay. WeHouse confirms payment only after verified Paystack confirmation."
                : "Your reservation fee and hold expiry come from the saved booking record. WeHouse confirms payment only after verified Paystack confirmation."}
              editLabel={paymentReview === "short_let" ? "Edit dates and guests" : "Edit reservation"}
              confirmLabel="Accept terms and continue"
              busy={busy}
              busyLabel="Opening Paystack…"
              confirmDisabled={paymentReview === "short_let" && (!shortPolicy || shortRefundHours===null || !reviewShortPrice)}
              onEdit={() => void editPaymentReview()}
              onConfirm={() => void continueReservationPayment()}
            />
          </div>
        </div>
      ) : null}

      {!shortStay && reservationOptionsOpen && (
        <div
          className="fixed inset-0 z-[79] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setReservationOptionsOpen(false)}
        >
          <section
            className="w-full max-w-lg rounded-t-[30px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-[var(--wh-text)] sm:rounded-[30px]"
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
                className="grid h-10 w-10 place-items-center text-[var(--wh-text-muted)]"
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
              className="mt-5 flex min-h-16 w-full items-center justify-between border-y border-[var(--wh-border-subtle)] py-3 text-left disabled:opacity-40"
            >
              <span>
                <span className="block text-sm font-semibold">
                  Choose a connected roommate
                </span>
                <span className="mt-1 block text-sm text-[var(--wh-text-muted)]">
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
            className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-violet-300">
                  Shared home
                </p>
                <h2 className="mt-1 text-lg font-bold">Share this booking</h2>
                <p className="mt-1 text-sm text-[var(--wh-text-muted)]">
                  Choose up to 2 people. At most 3 people can pay, and each must accept.
                </p>
              </div>
              <button onClick={() => setShareOpen(false)}>×</button>
            </div>
            <div className="mt-4">
              {[
                { title: "Roommates", people: roommateRecipients.map((r) => ({ key: `roommate:${r.conversationId}`, id: r.userId, name: r.name, username: r.username, avatar: r.avatar })) },
                { title: "Friends", people: friendRecipients.map((c) => ({ key: `friend:${c.user_id}`, id: c.user_id, name: c.full_name || c.username || "Friend", username: c.username || "", avatar: null as string | null })) },
              ].map((group) => (
                <div key={group.title} className="mb-4">
                  <h3 className="text-sm font-semibold uppercase text-[var(--wh-text-secondary)]">{group.title}</h3>
                  <div className="divide-y divide-[var(--wh-border-subtle)]">
                    {group.people.length ? group.people.map((person) => {
                      const picked = pickedPeople.includes(person.key);
                      return (
                        <button
                          key={person.key}
                          type="button"
                          aria-pressed={picked}
                          disabled={busy}
                          onClick={() => togglePicked(person.key)}
                          className="flex min-h-16 w-full items-center gap-3 py-3 text-left disabled:opacity-40"
                        >
                          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/10 text-violet-300">
                            {person.avatar ? <img src={person.avatar} alt="" className="h-full w-full object-cover" />
                              : person.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-base font-semibold">{person.name}</span>
                            {person.username && <span className="mt-1 block break-words text-sm text-[var(--wh-text-secondary)]">@{person.username}</span>}
                          </span>
                          <span className={picked ? "text-violet-300" : "text-[var(--wh-text-secondary)]"} aria-hidden="true">{picked ? "Selected" : "Select"}</span>
                        </button>
                      );
                    }) : (
                      <p className="py-4 text-sm text-[var(--wh-text-secondary)]">
                        {group.title === "Roommates" ? "No accepted Roommates for this invitation." : "No accepted Friends yet."}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={busy || !pickedPeople.length}
                onClick={() => void sendShareInvitation()}
                className="min-h-12 w-full rounded-2xl bg-violet-600 px-4 text-base font-semibold text-white disabled:opacity-40"
              >
                Send invitation
              </button>
              {missingRoommateIdentities > 0 && <div role="status" className="py-4 text-sm leading-6 text-[var(--wh-text-secondary)]">
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
    <section className="rounded-3xl border border-violet-500/15 bg-[var(--wh-surface)] p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">
        Shared home · equal booking shares
      </p>
      <h2 className="mt-2 text-lg font-bold">
        You and {peer?.name || "your roommate"}
      </h2>
      <p className="mt-2 text-sm leading-5 text-[var(--wh-text-muted)]">
        Both people accept and pay their own verified share. One person cannot
        complete the other person’s payment.
      </p>
      <div className="mt-4 divide-y divide-[var(--wh-border-subtle)] rounded-2xl bg-[var(--wh-interactive)] px-3">
        {members.map((member: any) => (
          <div
            key={member.user_id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="text-xs font-semibold">
                {member.user_id === profile.user_id ? "You" : member.name}
              </p>
              <p className="mt-1 text-sm capitalize text-[var(--wh-text-muted)]">
                {member.invitation_status} ·{" "}
                {String(member.payment_status).replace(/_/g, " ")}
              </p>
            </div>
            <p className="text-xs font-semibold text-violet-300">
              {formatMoney(Number(member.share_amount || 0))}
            </p>
          </div>
        ))}
      </div>
      {invited && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={() => void onAccept(false)}
            className="h-11 rounded-xl border border-[var(--wh-border-subtle)] text-xs"
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
              : `Pay my share · ${formatMoney(Number(mine.share_amount || 0))}`}
          </button>
        )}
      {mine?.payment_status === "paid" && !allPaid && (
        <p className="mt-4 rounded-xl bg-emerald-500/[.06] p-3 text-sm text-emerald-300">
          Your share is confirmed. Waiting for {peer?.name || "your roommate"}.
        </p>
      )}
      {allPaid && (
        <p className="mt-4 rounded-xl bg-emerald-500/[.06] p-3 text-sm text-emerald-300">
          Both shares are confirmed. This property is held for your shared
          reservation.
        </p>
      )}
    </section>
  );
}

export function ReservationPanel({
  shortStay,
  reservation,
  inspection,
  busy,
  fee,
  onResume,
  onInspect,
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
  onRentPay: () => void;
  onOpenBooking: () => void;
  onSupport: () => void;
}) {
  const formatMoney=(value:unknown)=>formatRecordedMoney(value,reservation?.currency);
  if (shortStay) return <ShortStayReservationPanel reservation={reservation} busy={busy} onPay={onRentPay} onSupport={onSupport} />;
  const journey = getPropertyBookingJourney(reservation, inspection);
  return <section className="space-y-3">
    <PropertyBookingJourney row={reservation} inspection={inspection} />
    <div className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      <Row label="Reservation fee" value={formatMoney(Number(reservation.amount || fee))} />
      {reservation.hold_expires_at && <Row label="Reservation held until" value={new Date(reservation.hold_expires_at).toLocaleString()} />}
      {journey.action === 'reservation_payment' && <button type="button" disabled={busy} onClick={onResume} className="mt-3 min-h-12 w-full rounded-xl bg-violet-600 text-sm font-semibold text-white disabled:opacity-50">Continue reservation payment</button>}
      {journey.action === 'choose_inspection_or_rent' && <>
        <p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">A viewing is optional. Request a visit before paying rent, or continue if you are satisfied with the home. Your reservation fee is not rent.</p>
        <button type="button" disabled={busy} onClick={onInspect} className="mt-3 min-h-12 w-full rounded-xl bg-violet-600 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending request?' : 'Request a viewing'}</button>
      </>}
      {(journey.action === 'choose_inspection_or_rent' || journey.action === 'rent_payment') && <button type="button" disabled={busy} onClick={onOpenBooking} className="mt-3 min-h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] text-sm font-semibold disabled:opacity-50">{busy ? 'Opening booking…' : 'Review rental agreement and payment'}</button>}
      {journey.action !== 'reservation_payment' && <button type="button" onClick={onOpenBooking} className="mt-3 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] text-sm font-semibold">Open booking details</button>}
      <button type="button" onClick={onSupport} className="mt-2 min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">Message WeHouse about this booking</button>
    </div>
  </section>;
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
  const formatMoney=(value:unknown)=>formatRecordedMoney(value,reservation?.currency);
  const status = String(reservation.status || "reserved");
  const paid = ["paid", "upfront_paid"].includes(
    String(reservation.rent_payment_status || ""),
  );
  const stay = (
    <div className="mt-4 rounded-xl bg-[var(--wh-interactive)] p-3">
      <Row label="Check-in" value={formatStayDate(reservation.stay_check_in)} />
      <Row
        label="Check-out"
        value={formatStayDate(reservation.stay_check_out)}
      />
      <Row label="Guests" value={String(reservation.guest_count || 1)} />
      <Row
        label="Stay rent"
        value={`${formatMoney(Number(reservation.stay_rent_total || 0))}`}
      />
      <Row
        label="Refundable deposit"
        value={`${formatMoney(Number(reservation.security_deposit_snapshot || 0))}`}
      />
    </div>
  );
  if (status === "occupied")
    return (
      <section className="rounded-3xl border border-violet-500/15 bg-[var(--wh-surface)] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-violet-300">
          Checked in
        </p>
        <h2 className="mt-2 text-lg font-bold">Your Short Let is active</h2>
        <p className="mt-2 text-sm leading-5 text-[var(--wh-text-secondary)]">
          WeHouse recorded your entry. Checkout is due on the date below.
        </p>
        {stay}
        <button
          onClick={onSupport}
          className="mt-4 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold"
        >
          Message WeHouse
        </button>
      </section>
    );
  if (status === "completed")
    return (
      <section className="rounded-3xl border border-emerald-500/15 bg-[var(--wh-surface)] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Checked out
        </p>
        <h2 className="mt-2 text-lg font-bold">Stay completed</h2>
        {stay}
        <p className="mt-3 text-sm text-[var(--wh-text-secondary)]">
          Any refundable-deposit review remains attached to this booking.
        </p>
        <button
          onClick={onSupport}
          className="mt-4 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold"
        >
          Message WeHouse
        </button>
      </section>
    );
  if (!paid)
    return (
      <section className="rounded-3xl border border-emerald-500/15 bg-[var(--wh-surface)] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Reservation prepared
        </p>
        <h2 className="mt-2 text-lg font-bold">Pay for your Short Let</h2>
        <p className="mt-2 text-sm leading-5 text-[var(--wh-text-secondary)]">
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
    <section className="rounded-3xl border border-emerald-500/15 bg-[var(--wh-surface)] p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
        Paid · ready for arrival
      </p>
      <h2 className="mt-2 text-lg font-bold">Check in with WeHouse</h2>
      <p className="mt-2 text-sm leading-5 text-[var(--wh-text-secondary)]">
        Show the booking code on arrival. Operations records entry only during
        the reserved dates and the property owner is notified.
      </p>
      {reservation.booking_code && (
        <Row label="Booking code" value={String(reservation.booking_code)} />
      )}{" "}
      {stay}
      <button
        onClick={onSupport}
        className="mt-4 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold"
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
    <div className="min-w-0 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3 text-center">
      <p className="truncate text-sm uppercase text-[var(--wh-text-muted)]">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold capitalize">{value}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--wh-text-muted)]">{label}</span>
      <span className="text-right font-semibold text-[#D5D8E0]">{value}</span>
    </div>
  );
}
