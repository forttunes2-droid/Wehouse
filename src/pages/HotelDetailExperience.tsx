import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  addHotelReview,
  canReviewHotel,
  getHotelBookingsForUser,
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
  distanceBetweenKm,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";
import BackButton from "@/components/BackButton";

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
  onBook: (
    hotelId: number,
    roomId: number,
    ratePlanId: number,
    checkIn: string,
    checkOut: string,
  ) => void;
  profile: { user_id: string; username: string | null };
};

export default function HotelDetailExperience({
  hotelId,
  onBack,
  onBook,
  profile,
}: Props) {
  const { location } = useDiscoveryLocation();
  const [hotel, setHotel] = useState<HotelDetailRow | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentImage, setCurrentImage] = useState(0);
  const [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null);
  const [selectedRate, setSelectedRate] = useState<HotelRatePlan | null>(null);
  const [roomImage, setRoomImage] = useState(0);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const [reviewEligible, setReviewEligible] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [locationUnlocked, setLocationUnlocked] = useState(false);

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
    void (async () => {
      setLoading(true);
      const [hotelResult, reviewResult, eligibility, bookingResult, savedResult] =
        await Promise.all([
          getHotelById(hotelId),
          getHotelReviews(hotelId),
          canReviewHotel(hotelId, profile.user_id),
          getHotelBookingsForUser(profile.user_id),
          getMySavedHotelIds(),
        ]);
      if (!live) return;
      if (hotelResult.error || !hotelResult.hotel) {
        toast.error("Hotel could not be loaded");
        setHotel(null);
      } else {
        setHotel(hotelResult.hotel as HotelDetailRow);
        // Never choose for the guest. Room + package are explicit decisions.
        setSelectedRoom(null);
        setSelectedRate(null);
        setRoomImage(0);
      }
      setReviews((reviewResult.reviews || []) as ReviewRow[]);
      setReviewEligible(Boolean(eligibility.eligible));
      setSaved(
        !savedResult.error && savedResult.hotelIds.includes(Number(hotelId)),
      );
      setLocationUnlocked(
        Boolean(
          bookingResult.bookings?.some(
            (booking) =>
              Number(booking.hotel_id) === Number(hotelId) &&
              booking.payment_status === "paid" &&
              ["confirmed", "checked_in"].includes(String(booking.status)),
          ),
        ),
      );
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [hotelId, profile.user_id]);

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
    setSelectedRoom(room);
    setSelectedRate(null);
    setRoomImage(0);
    setCheckIn("");
    setCheckOut("");
  }

  function selectRate(plan: HotelRatePlan) {
    setSelectedRate(plan);
    setCheckIn("");
    setCheckOut("");
  }

  function proceed() {
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
          <p className="text-sm font-semibold">Hotel not found</p>
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
  const latitude = Number(hotel.gps_latitude);
  const longitude = Number(hotel.gps_longitude);
  const point =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { lat: latitude, lng: longitude }
      : null;
  const exactDestination =
    locationUnlocked && hotel.location_exact === true ? point : null;
  const distance =
    location && point ? distanceBetweenKm(location, point) : null;

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-28 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#0A0A0F]/96 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0 flex-1">
            <p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-400">
              WEHOUSE · HOTELS
            </p>
            <p className="mt-1 truncate text-sm font-semibold">{hotel.name}</p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void toggleSaved()}
            aria-label={saved ? "Remove hotel from Saved" : "Save hotel"}
            aria-pressed={saved}
            className="grid h-10 w-10 shrink-0 place-items-center text-white active:scale-95 disabled:opacity-50"
          >
            <Heart filled={saved} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-6">
        <section className="-mx-4 overflow-hidden border-y border-white/[.07] sm:mx-0 sm:rounded-2xl sm:border">
          <div className="relative aspect-[4/3] bg-[#171B24] sm:aspect-[16/9]">
            {images.length ? (
              <img
                src={images[currentImage]}
                alt={`${hotel.name} photo ${currentImage + 1}`}
                className="h-full w-full object-cover"
                fetchPriority="high"
                decoding="async"
              />
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-[#62697A]">
                No hotel image yet
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            {images.length > 1 ? (
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 backdrop-blur">
                {images.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`View hotel photo ${index + 1}`}
                    onClick={() => setCurrentImage(index)}
                    className={`h-1.5 rounded-full ${
                      index === currentImage ? "w-5 bg-white" : "w-1.5 bg-white/45"
                    }`}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="bg-[#10131A] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold">{hotel.name}</h1>
                <p className="mt-1 text-[10px] text-[#747B8B]">
                  {[hotel.area, hotel.city, hotel.state].filter(Boolean).join(", ")}
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
                <span className="shrink-0 text-[10px] font-semibold text-amber-300">
                  ★ {Number(hotel.rating).toFixed(1)}
                </span>
              ) : null}
            </div>
            {hotel.description ? (
              <p className="mt-4 text-[11px] leading-5 text-[#9399A8]">
                {hotel.description}
              </p>
            ) : null}
          </div>
        </section>

        {amenities.length ? (
          <section className="border-y border-white/[.06] py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Amenities</h2>
              {amenities.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setShowAllAmenities((value) => !value)}
                  className="text-[9px] font-semibold text-violet-300"
                >
                  {showAllAmenities ? "Show less" : `+${amenities.length - 6} more`}
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {shownAmenities.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/[.07] px-2.5 py-1.5 text-[9px] text-[#A0A6B4]"
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-2 divide-x divide-white/[.06] border-y border-white/[.06] py-4">
          <div className="pr-4">
            <p className="text-[8px] uppercase tracking-wide text-[#686F80]">Check-in</p>
            <p className="mt-1 text-xs font-semibold">
              From {formatHotelTime(hotel.check_in_time, "14:00")}
            </p>
          </div>
          <div className="pl-4">
            <p className="text-[8px] uppercase tracking-wide text-[#686F80]">Check-out</p>
            <p className="mt-1 text-xs font-semibold">
              By {formatHotelTime(hotel.check_out_time, "12:00")}
            </p>
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-base font-bold">Choose a room</h2>
            <p className="mt-1 text-[9px] text-[#666D7E]">
              WeHouse does not choose a room or package for you.
            </p>
          </div>
          {hotel.hotel_rooms?.length ? (
            <div className="divide-y divide-white/[.07] border-y border-white/[.07]">
              {hotel.hotel_rooms.map((room) => {
                const active = selectedRoom?.room_id === room.room_id;
                const photo = room.images?.[0];
                return (
                  <button
                    key={room.room_id}
                    type="button"
                    onClick={() => selectRoom(room)}
                    className={`flex w-full items-center gap-3 py-4 text-left ${
                      active ? "text-white" : "text-[#C3C7D1]"
                    }`}
                  >
                    <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${room.room_type} room`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-[8px] text-[#62697A]">
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{room.room_type}</h3>
                      <p className="mt-1 text-[9px] text-[#858B9A]">
                        Up to {room.max_guests} guest{room.max_guests === 1 ? "" : "s"}
                        {room.bed_type ? ` · ${room.bed_type}` : ""}
                      </p>
                      <p className="mt-1 text-[8px] text-[#656C7C]">
                        {(room.rate_plans || []).filter((plan) => plan.active).length} package choice{(room.rate_plans || []).filter((plan) => plan.active).length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className={active ? "text-violet-300" : "text-[#62697A]"}>
                      {active ? "✓" : "›"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="border-y border-dashed border-white/[.08] py-10 text-center text-[10px] text-[#666D7E]">
              No rooms are currently available.
            </p>
          )}
        </section>

        {selectedRoom ? (
          <section className="border-y border-white/[.07] py-5">
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-black">
              {selectedRoom.images?.[roomImage] ? (
                <img
                  src={selectedRoom.images[roomImage]}
                  alt={`${selectedRoom.room_type} photo ${roomImage + 1}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center text-[9px] text-[#62697A]">
                  Room photo unavailable
                </div>
              )}
            </div>
            {(selectedRoom.images?.length || 0) > 1 ? (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {selectedRoom.images.map((src, index) => (
                  <button
                    type="button"
                    key={`${src}-${index}`}
                    onClick={() => setRoomImage(index)}
                    className={`h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                      roomImage === index ? "border-violet-400" : "border-transparent"
                    }`}
                    aria-label={`View ${selectedRoom.room_type} photo ${index + 1}`}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
            <h3 className="mt-4 text-base font-bold">{selectedRoom.room_type}</h3>
            {selectedRoom.description ? (
              <p className="mt-2 text-[10px] leading-5 text-[#969CAA]">
                {selectedRoom.description}
              </p>
            ) : null}
            {selectedRoom.amenities?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedRoom.amenities.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/[.07] px-2.5 py-1 text-[8px] text-[#A0A6B4]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-5">
              <h3 className="text-sm font-bold">Choose a package</h3>
              <p className="mt-1 text-[9px] text-[#666D7E]">
                Price belongs to the package you choose for this room.
              </p>
              <div className="mt-3 divide-y divide-white/[.06] border-y border-white/[.06]">
                {(selectedRoom.rate_plans || [])
                  .filter((plan) => plan.active)
                  .map((plan) => {
                    const active = selectedRate?.rate_plan_id === plan.rate_plan_id;
                    return (
                      <button
                        key={plan.rate_plan_id}
                        type="button"
                        onClick={() => selectRate(plan)}
                        className="flex w-full items-start justify-between gap-4 py-4 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold">{plan.name}</span>
                          <span className="mt-1 block text-[9px] leading-4 text-[#777E8E]">
                            {mealLabel(plan.meal_plan)} · {paymentLabel(plan.payment_timing)} · {plan.refundable ? "Refundable" : "Non-refundable"}
                          </span>
                          {plan.included_features?.length ? (
                            <span className="mt-1.5 block text-[8px] text-emerald-300">
                              Includes {plan.included_features.join(" · ")}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-bold text-violet-200">
                            ₦{Number(plan.price_per_night).toLocaleString()}
                          </span>
                          <span className="text-[8px] text-[#656C7C]">per night</span>
                          {active ? (
                            <span className="mt-1 block text-[8px] font-semibold text-violet-300">
                              Selected
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </section>
        ) : null}

        {selectedRate ? (
          <section className="border-y border-white/[.07] py-5">
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
                  <p className="text-[9px] text-[#686F80]">
                    {nights} night{nights === 1 ? "" : "s"} · {selectedRate.name}
                  </p>
                  <p className="mt-1 text-[8px] text-[#5E6473]">
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
            <p className="mt-1 text-[9px] text-[#666D7E]">
              Restaurants and facilities are hotel information, not separate WeHouse bookings.
            </p>
            <div className="mt-3 divide-y divide-white/[.06]">
              {hotel.venues.map((venue) => (
                <div key={venue.venue_id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">{venue.name}</p>
                      <p className="mt-1 text-[8px] uppercase tracking-wide text-violet-300">
                        {venue.kind}
                      </p>
                    </div>
                    {venue.opening_hours ? (
                      <p className="text-right text-[9px] text-[#858B9A]">
                        {venue.opening_hours}
                      </p>
                    ) : null}
                  </div>
                  {venue.description ? (
                    <p className="mt-2 text-[9px] leading-4 text-[#858B9A]">
                      {venue.description}
                    </p>
                  ) : null}
                  {venue.package_notes ? (
                    <p className="mt-2 text-[8px] text-emerald-300">
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
          {exactDestination && hotel.address ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[10px] text-[#858B9A]">{hotel.address}</p>
              <a
                href={directionsUrl(exactDestination.lat, exactDestination.lng)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[9px] font-semibold text-violet-300"
              >
                Road directions
              </a>
            </div>
          ) : (
            <p className="mt-2 text-[10px] leading-5 text-[#777E8E]">
              Approximate area only. Exact entrance and road directions unlock for a confirmed paid stay.
            </p>
          )}
        </section>

        <section className="border-y border-white/[.06] py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Guest reviews</h2>
              <p className="mt-1 text-[9px] text-[#666D7E]">
                {reviews.length} verified review{reviews.length === 1 ? "" : "s"}
              </p>
            </div>
            {reviewEligible ? (
              <button
                type="button"
                onClick={() => setShowReviewForm((value) => !value)}
                className="text-[9px] font-semibold text-violet-300"
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
                className="mt-3 h-11 rounded-xl bg-violet-500 px-5 text-[10px] font-semibold disabled:opacity-50"
              >
                {submittingReview ? "Submitting…" : "Publish review"}
              </button>
            </div>
          ) : null}

          <div className="mt-4 divide-y divide-white/[.06]">
            {reviews.slice(0, 6).map((review) => (
              <article key={review.review_id} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold">
                    @{review.profiles?.username || "guest"}
                  </p>
                  <p className="text-[9px] text-amber-300">
                    {"★".repeat(Number(review.rating || 0))}
                  </p>
                </div>
                {review.comment ? (
                  <p className="mt-2 text-[10px] leading-5 text-[#858B9A]">
                    {review.comment}
                  </p>
                ) : null}
              </article>
            ))}
            {!reviews.length ? (
              <p className="py-5 text-center text-[10px] text-[#666D7E]">
                No verified reviews yet.
              </p>
            ) : null}
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[.08] bg-[#090B12]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mx-auto max-w-5xl">
          <button
            type="button"
            onClick={proceed}
            disabled={!selectedRoom || !selectedRate || nights < 1}
            className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:bg-white/[.055] disabled:text-[#656B7A]"
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

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[9px] text-[#777E8E]">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none focus:border-violet-500/40"
      />
    </label>
  );
}

function formatHotelTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const hour = Number(match?.[1] || 0);
  const minute = match?.[2] || "00";
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function mealLabel(value: HotelRatePlan["meal_plan"]) {
  return {
    room_only: "Room only",
    breakfast: "Breakfast included",
    half_board: "Breakfast + one meal",
    full_board: "All daily meals",
    all_inclusive: "All inclusive",
  }[value];
}

function paymentLabel(value: HotelRatePlan["payment_timing"]) {
  return {
    pay_now: "Pay now",
    before_arrival: "Pay before arrival",
    at_property: "Pay at property",
  }[value];
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
