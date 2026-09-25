import { publicPropertyImages } from "@/lib/publicPropertyMedia";
import { browseDate, readPublicBrowseDraft, savePublicBrowseDraft } from "@/lib/publicBrowseDraft";
import PropertyMediaCarousel from "@/components/PropertyMediaCarousel";
import HotelRoomChoices from "@/components/HotelRoomChoices";
import PropertyShareDialog from "@/components/PropertyShareDialog";
import { withTimeout } from "@/lib/withTimeout";
import DateField from "@/components/BookingDateField";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addHotelReview,
  getHotelById,
  getHotelReviews,
} from "@/lib/supabase";
import {
  getMySavedHotelIds,
  saveHotel,
  unsaveHotel,
} from "@/lib/supabase/saved-hotels";
import type {
  Hotel,
  HotelRatePlan,
  HotelReview,
  HotelRoom,
  HotelVenue,
} from "@/types";
import {
  directionsUrl,
  getDiscoveryDistanceMap,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";
import BackButton from "@/components/BackButton";
import { locationLabel } from "@/lib/locationPresentation";

type ReviewRow = HotelReview & {
  profiles: { username: string | null; avatar_url: string | null };
};

type HotelDetailRow = Hotel & {
  hotel_rooms: HotelRoom[];
  venues?: HotelVenue[];
  location_exact?: boolean;
};

type Props = {
  hotelId: number;
  onBack: () => void;
  onGoToChat?: (id: string) => void;
  onBook: (
    hotelId: number,
    roomId: number,
    ratePlanId: number,
    checkIn: string,
    checkOut: string,
  ) => void;
  profile: { user_id: string; username: string | null } | null;
  onRequireAuth?: () => void;
};

export default function HotelDetailExperience({
  hotelId,
  onBack,
  onGoToChat,
  onBook,
  profile,
  onRequireAuth,
}: Props) {
  const { location } = useDiscoveryLocation();
  const [attempt, setAttempt] = useState(0);
  const [sendPropertyOpen, setSendPropertyOpen] = useState(false);
  const [hotel, setHotel] = useState<HotelDetailRow | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null);
  const [selectedRate, setSelectedRate] = useState<HotelRatePlan | null>(null);

  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const [reviewEligible, setReviewEligible] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);

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

  useEffect(() => {
    let live = true;
    setLoading(true); setHotel(null); setReviews([]); setSaved(false);
    setSelectedRoom(null); setSelectedRate(null); setReviewEligible(false);
    setCheckIn(""); setCheckOut("");
    // Optional reviews and Saved cannot delay the primary hotel record.
    void withTimeout(getHotelReviews(hotelId), 12000, "Reviews took too long.")
      .then(result => { if (live) { setReviews(result.reviews); setReviewEligible(Boolean(profile && result.eligible)); } })
      .catch(() => undefined);
    if (profile) void withTimeout(getMySavedHotelIds(), 12000, "Saved took too long.")
      .then(result => { if (live && !result.error) setSaved(result.hotelIds.includes(hotelId)); })
      .catch(() => undefined);
    void (async () => {
      try {
        const result = await withTimeout(getHotelById(hotelId), 15000, "Hotel took too long to load.");
        if (!live) return;
        if (result.error || !result.hotel || String(result.hotel.hotel_id) !== String(hotelId)) throw new Error("Hotel could not be loaded");
        const loaded = { ...result.hotel, images: publicPropertyImages(result.hotel.images), hotel_rooms: (result.hotel.hotel_rooms || []).map(room => ({ ...room, images: publicPropertyImages(room.images) })) } as HotelDetailRow;
        const draft = readPublicBrowseDraft('hotel', String(hotelId));
        const room = loaded.hotel_rooms?.find(item => item.room_id === draft.roomId) || null;
        const rate = room?.rate_plans?.find(item => item.active && item.rate_plan_id === draft.rateId) || null;
        setHotel(loaded); setSelectedRoom(room); setSelectedRate(rate);
        if (rate) { setCheckIn(browseDate(draft.checkIn)); setCheckOut(browseDate(draft.checkOut)); }
      } catch { if (live) toast.error("Hotel could not be loaded. Please try again."); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [hotelId, profile?.user_id, attempt]);

  useEffect(() => {
    let live = true;
    void getDiscoveryDistanceMap(location).then((map) => {
      if (live) setDistance(map.get(`hotel:${hotelId}`) ?? null);
    });
    return () => { live = false; };
  }, [hotelId, location]);

  useEffect(() => {
    if (!loading && hotel && String(hotel.hotel_id) === String(hotelId)) savePublicBrowseDraft('hotel', String(hotelId), { roomId: selectedRoom?.room_id || null, rateId: selectedRate?.rate_plan_id || null, checkIn, checkOut });
  }, [loading, hotel, hotelId, selectedRoom, selectedRate, checkIn, checkOut]);

  const tomorrow = useMemo(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    return value.toISOString().split("T")[0];
  }, []);
  const bookingWindowEnd = useMemo(() => {
    const value = new Date();
    value.setDate(value.getDate() + 366);
    return value.toISOString().split("T")[0];
  }, []);
  const minCheckout = useMemo(() => {
    if (!checkIn) return tomorrow;
    const value = new Date(`${checkIn}T12:00:00`);
    value.setDate(value.getDate() + 1);
    return value.toISOString().split("T")[0];
  }, [checkIn, tomorrow]);
  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(`${checkIn}T12:00:00`).getTime();
    const end = new Date(`${checkOut}T12:00:00`).getTime();
    return Math.max(0, Math.round((end - start) / 86_400_000));
  }, [checkIn, checkOut]);
  const total = selectedRate && nights > 0
    ? Number(selectedRate.price_per_night || 0) * nights
    : 0;

  async function toggleSaved() {
    if (!profile) { onRequireAuth?.(); return; }
    if (saving) return;
    setSaving(true);
    const result = saved ? await unsaveHotel(hotelId) : await saveHotel(hotelId);
    setSaving(false);
    if (result.error)
      return toast.error(result.error.message || "Saved hotels could not be updated");
    setSaved((value) => !value);
    toast.success(saved ? "Hotel removed from Saved" : "Hotel saved");
  }

  function selectRoom(room: HotelRoom) {
    if (selectedRoom?.room_id === room.room_id) return;
    setSelectedRoom(room);
    setSelectedRate(null);
   
    setCheckIn("");
    setCheckOut("");
  }

  function selectRate(plan: HotelRatePlan) {
    if (selectedRate?.rate_plan_id === plan.rate_plan_id) return;
    setSelectedRate(plan);
    setCheckIn("");
    setCheckOut("");
  }

  function messageWeHouse() {
    if (!profile) { onRequireAuth?.(); return; }
    if (!hotel) return;
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "hotel_enquiry",
          subject: `Question about · ${hotel.name}`,
          contextType: "hotel_property",
          contextId: String(hotelId),
          contextSnapshot: {
            source_type: "hotel_property",
            source_id: String(hotelId),
            hotel_id: hotelId,
            hotel_name: hotel.name,
            location: [hotel.area, hotel.city, hotel.state].filter(Boolean).join(", "),
          },
        },
      }),
    );
  }

  function proceed() {
    if (!profile) { onRequireAuth?.(); return; }
    if (!selectedRoom) return toast.error("Choose a room type first");
    if (!selectedRate) return toast.error("Choose a package for that room");
    if (!checkIn || !checkOut)
      return toast.error("Choose check-in and check-out dates");
    if (nights < 1) return toast.error("Check-out must be after check-in");
    onBook(
      hotelId,
      selectedRoom.room_id,
      selectedRate.rate_plan_id,
      checkIn,
      checkOut,
    );
  }

  async function submitReview() {
    if (!profile) { onRequireAuth?.(); return; }
    if (!profile.user_id || submittingReview) return;
    setSubmittingReview(true);
    const { error } = await addHotelReview(
      hotelId,
      profile.user_id,
      reviewRating,
      reviewComment.trim() || undefined,
    );
    setSubmittingReview(false);
    if (error) return toast.error("Review could not be submitted");
    toast.success("Review submitted");
    setShowReviewForm(false);
    setReviewComment("");
    const refreshed = await getHotelReviews(hotelId);
    setReviews((refreshed.reviews || []) as ReviewRow[]);
  }

  if (loading)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );

  if (!hotel)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F] px-5 text-white">
        <div className="text-center">
          <p className="text-sm font-semibold">Hotel information could not be loaded</p>
          <button onClick={() => setAttempt(value => value + 1)} className="min-h-11 px-3 text-sm text-violet-300">Try again</button>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 text-xs font-semibold text-violet-300"
          >
            Back to hotels
          </button>
        </div>
      </div>
    );

  const images = hotel.images?.filter(Boolean) || [];
  const amenities = hotel.amenities || [];
  const shownAmenities = showAllAmenities ? amenities : amenities.slice(0, 6);

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-28 text-white">


      {sendPropertyOpen && onGoToChat && profile && <PropertyShareDialog userId={profile.user_id} property={{ kind: "hotel", id: String(hotelId) }} title={hotel.name} onClose={() => setSendPropertyOpen(false)} onConversation={onGoToChat} />}
      <main className="mx-auto max-w-5xl space-y-5 px-4 pb-5 sm:px-6">
        <section className="-mx-4 overflow-hidden border-y border-white/[.07] sm:mx-0 sm:rounded-2xl sm:border">
          <PropertyMediaCarousel images={images} title={hotel.name}>
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[max(.75rem,env(safe-area-inset-top))]">
              <BackButton onClick={onBack} ariaLabel="Back to hotels" className="bg-black/50 !text-white" />
              <button type="button" disabled={saving} onClick={() => void toggleSaved()} aria-label={saved ? 'Remove hotel from Saved' : 'Save hotel'} aria-pressed={saved} className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white disabled:opacity-50"><Heart filled={saved} /></button>
            </div>
          </PropertyMediaCarousel>
          <div className="bg-[#10131A] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold">{hotel.name}</h1>
                <p className="mt-1 text-sm text-[#747B8B]">
                  {locationLabel(hotel.address, hotel.area, hotel.city, hotel.state)}
                  {distance != null
                    ? ` · about ${
                        distance < 1
                          ? `${Math.max(1, Math.round(distance * 1000))} m`
                          : `${distance.toFixed(distance < 10 ? 1 : 0)} km`
                      } away`
                    : ""}
                </p>
              </div>
              {Number(hotel.rating || 0) > 0 ? (
                <span className="shrink-0 text-sm font-semibold text-amber-300">
                  ★ {Number(hotel.rating).toFixed(1)}
                </span>
              ) : null}
            </div>
            {hotel.description ? (
              <p className="mt-4 text-sm leading-5 text-[#9399A8]">
                {hotel.description}
              </p>
            ) : null}
          </div>
        </section>
        {onGoToChat && <div className="flex justify-end"><button type="button" onClick={() => profile ? setSendPropertyOpen(true) : onRequireAuth?.()} className="min-h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-violet-300">Send property ↗</button></div>}

        {amenities.length ? (
          <section className="border-y border-white/[.06] py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Amenities</h2>
              {amenities.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setShowAllAmenities((value) => !value)}
                  className="text-xs font-semibold text-violet-300"
                >
                  {showAllAmenities ? "Show less" : `+${amenities.length - 6} more`}
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {shownAmenities.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/[.07] px-2.5 py-1.5 text-xs text-[#A0A6B4]"
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-2 divide-x divide-white/[.06] border-y border-white/[.06] py-4">
          <div className="pr-4">
            <p className="text-xs uppercase tracking-wide text-[#686F80]">Check-in</p>
            <p className="mt-1 text-xs font-semibold">
              From {formatHotelTime(hotel.check_in_time, "14:00")}
            </p>
          </div>
          <div className="pl-4">
            <p className="text-xs uppercase tracking-wide text-[#686F80]">Check-out</p>
            <p className="mt-1 text-xs font-semibold">
              By {formatHotelTime(hotel.check_out_time, "12:00")}
            </p>
          </div>
        </section>

        <HotelRoomChoices rooms={hotel.hotel_rooms || []} roomId={selectedRoom?.room_id} rateId={selectedRate?.rate_plan_id} nights={nights} onRoom={selectRoom} onRate={selectRate} />

        {selectedRate ? (
          <section id="hotel-stay-dates" className="scroll-mt-4 border-y border-white/[.07] py-5">
            <h2 className="text-sm font-semibold">Choose stay dates</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <DateField
                label="Check-in"
                value={checkIn}
                min={tomorrow}
                max={bookingWindowEnd}
                onChange={(value) => {
                  setCheckIn(value);
                  if (checkOut && checkOut <= value) setCheckOut("");
                }}
              />
              <DateField
                label="Check-out"
                value={checkOut}
                min={minCheckout}
                max={bookingWindowEnd}
                onChange={setCheckOut}
              />
            </div>
            {nights > 0 ? (
              <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/[.06] pt-4">
                <div>
                  <p className="text-xs text-[#686F80]">
                    {nights} night{nights === 1 ? "" : "s"} · {selectedRate.name}
                  </p>
                  <p className="mt-1 text-xs text-[#5E6473]">
                    Availability is rechecked before payment.
                  </p>
                </div>
                <p className="text-lg font-bold">₦{total.toLocaleString()}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {hotel.venues?.length ? (
          <section className="border-y border-white/[.06] py-5">
            <h2 className="text-sm font-semibold">At the hotel</h2>
            <p className="mt-1 text-xs text-[#666D7E]">
              Restaurants and facilities are hotel information, not separate WeHouse bookings.
            </p>
            <div className="mt-3 divide-y divide-white/[.06]">
              {hotel.venues.map((venue) => (
                <div key={venue.venue_id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">{venue.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-violet-300">
                        {venue.kind}
                      </p>
                    </div>
                    {venue.opening_hours ? (
                      <p className="text-right text-xs text-[#858B9A]">
                        {venue.opening_hours}
                      </p>
                    ) : null}
                  </div>
                  {venue.description ? (
                    <p className="mt-2 text-xs leading-4 text-[#858B9A]">
                      {venue.description}
                    </p>
                  ) : null}
                  {venue.package_notes ? (
                    <p className="mt-2 text-xs text-emerald-300">
                      Package access: {venue.package_notes}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="border-y border-white/[.06] py-5">
          <h2 className="text-sm font-semibold">Location</h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[#858B9A]">
                {locationLabel(hotel.address, hotel.area, hotel.city, hotel.state)}
              </p>

            </div>
            {hotel.address ? (
              <a
                href={directionsUrl(locationLabel(hotel.address, hotel.area, hotel.city, hotel.state))}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs font-semibold text-violet-300"
              >
                Road directions
              </a>
            ) : null}
          </div>
        </section>

        <section className="border-y border-white/[.06] py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Guest reviews</h2>
              <p className="mt-1 text-xs text-[#666D7E]">
                {reviews.length} verified review{reviews.length === 1 ? "" : "s"}
              </p>
            </div>
            {reviewEligible ? (
              <button
                type="button"
                onClick={() => setShowReviewForm((value) => !value)}
                className="text-xs font-semibold text-violet-300"
              >
                {showReviewForm ? "Cancel" : "Write review"}
              </button>
            ) : null}
          </div>

          {showReviewForm && reviewEligible ? (
            <div className="mt-4 border-t border-white/[.06] pt-4">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setReviewRating(value)}
                    className={`text-lg ${
                      value <= reviewRating ? "text-amber-300" : "text-[#444A58]"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                rows={3}
                placeholder="Share your completed stay"
                className="mt-3 w-full resize-none border-b border-white/[.08] bg-transparent py-3 text-xs outline-none focus:border-violet-500/40"
              />
              <button
                type="button"
                onClick={() => void submitReview()}
                disabled={submittingReview}
                className="mt-3 h-11 rounded-xl bg-violet-500 px-5 text-sm font-semibold disabled:opacity-50"
              >
                {submittingReview ? "Submitting…" : "Publish review"}
              </button>
            </div>
          ) : null}

          <div className="mt-4 divide-y divide-white/[.06]">
            {reviews.slice(0, 6).map((review) => (
              <article key={review.review_id} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    @{review.profiles?.username || "guest"}
                  </p>
                  <p className="text-xs text-amber-300">
                    {"★".repeat(Number(review.rating || 0))}
                  </p>
                </div>
                {review.comment ? (
                  <p className="mt-2 text-sm leading-5 text-[#858B9A]">
                    {review.comment}
                  </p>
                ) : null}
              </article>
            ))}
            {!reviews.length ? (
              <p className="py-5 text-center text-sm text-[#666D7E]">
                No verified reviews yet.
              </p>
            ) : null}
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[.08] bg-[#090B12] p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mx-auto grid max-w-5xl grid-cols-[auto_minmax(0,1fr)] gap-2">
          <button
            type="button"
            onClick={messageWeHouse}
            className="h-12 rounded-2xl border border-violet-400/20 bg-violet-500/[.07] px-4 text-sm font-semibold text-violet-200"
          >
            Message WeHouse
          </button>
          <button
            type="button"
            onClick={() => {
              const section = !selectedRoom ? 'hotel-room-options' : !selectedRate ? 'hotel-package-options' : nights < 1 ? 'hotel-stay-dates' : null;
              if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              else proceed();
            }}
            className="h-12 min-w-0 rounded-2xl bg-violet-500 px-4 text-xs font-semibold disabled:bg-white/[.055] disabled:text-[#656B7A]"
          >
            {!selectedRoom
              ? "Choose a room"
              : !selectedRate
                ? "Choose a package"
                : nights < 1
                  ? "Choose stay dates"
                  : "Continue to guest details"}
          </button>
        </div>
      </div>
    </div>
  );
}


function formatHotelTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const hour = Number(match?.[1] || 0);
  const minute = match?.[2] || "00";
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "#A78BFA" : "none"}
      stroke={filled ? "#A78BFA" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
    </svg>
  );
}
