import { useEffect, useState } from "react";
import {
  getHotelById,
  getHotelReviews,
  addHotelReview,
  canReviewHotel,
  getHotelBookingsForUser,
} from "@/lib/supabase";
import type { Hotel, HotelRoom, HotelReview } from "@/types";
import type { HotelRatePlan, HotelVenue } from "@/types";
import { Toaster, toast } from "sonner";
import {
  directionsUrl,
  distanceBetweenKm,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";
import BackButton from "@/components/BackButton";

type ReviewRow = HotelReview & {
  profiles: { username: string | null; avatar_url: string | null };
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

function roomStartingPrice(room: HotelRoom) {
  const prices = (room.rate_plans || [])
    .filter((plan) => plan.active)
    .map((plan) => Number(plan.price_per_night))
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : Number(room.price_per_night || 0);
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
    at_property: "Pay at the property",
  }[value];
}

export default function HotelDetail({
  hotelId,
  onBack,
  onBook,
  profile,
}: Props) {
  const { location } = useDiscoveryLocation();
  const [hotel, setHotel] = useState<
      (Hotel & { hotel_rooms: HotelRoom[]; venues?: HotelVenue[] }) | null
    >(null),
    [reviews, setReviews] = useState<ReviewRow[]>([]),
    [loading, setLoading] = useState(true),
    [currentImage, setCurrentImage] = useState(0),
    [roomImage, setRoomImage] = useState(0),
    [showAllAmenities, setShowAllAmenities] = useState(false),
    [showReviewForm, setShowReviewForm] = useState(false),
    [reviewEligible, setReviewEligible] = useState(false),
    [locationUnlocked, setLocationUnlocked] = useState(false),
    [reviewRating, setReviewRating] = useState(5),
    [reviewComment, setReviewComment] = useState(""),
    [submittingReview, setSubmittingReview] = useState(false),
    [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null),
    [selectedRate, setSelectedRate] = useState<HotelRatePlan | null>(null),
    [checkIn, setCheckIn] = useState(""),
    [checkOut, setCheckOut] = useState("");
  useEffect(() => {
    void load();
  }, [hotelId]);
  async function load() {
    setLoading(true);
    const [{ hotel: h, error }, { reviews: r }, eligibility, bookingResult] =
      await Promise.all([
        getHotelById(hotelId),
        getHotelReviews(hotelId),
        canReviewHotel(hotelId, profile.user_id),
        getHotelBookingsForUser(profile.user_id),
      ]);
    if (error || !h) {
      toast.error("Hotel could not be loaded");
      setLoading(false);
      return;
    }
    setHotel(h);
    const firstRoom = h.hotel_rooms?.[0] || null;
    setSelectedRoom(firstRoom);
    setSelectedRate(firstRoom?.rate_plans?.find((plan) => plan.active) || null);
    setReviews((r || []) as ReviewRow[]);
    setReviewEligible(eligibility.eligible);
    setLocationUnlocked(
      Boolean(
        bookingResult.bookings?.some(
          (booking) =>
            booking.hotel_id === hotelId &&
            booking.payment_status === "paid" &&
            !["cancelled", "refunded"].includes(booking.status),
        ),
      ),
    );
    setLoading(false);
  }
  async function submitReview() {
    if (!profile.user_id) return;
    setSubmittingReview(true);
    const { error } = await addHotelReview(
      hotelId,
      profile.user_id,
      reviewRating,
      reviewComment || undefined,
    );
    setSubmittingReview(false);
    if (error) return toast.error("Review could not be submitted");
    toast.success("Review submitted");
    setShowReviewForm(false);
    setReviewComment("");
    const { reviews: r } = await getHotelReviews(hotelId);
    setReviews((r || []) as ReviewRow[]);
    const { hotel: h } = await getHotelById(hotelId);
    if (h) setHotel(h);
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  const bookingWindowEnd = new Date(tomorrow);
  bookingWindowEnd.setDate(bookingWindowEnd.getDate() + 365);
  const bookingWindowEndStr = bookingWindowEnd.toISOString().split("T")[0];
  function minCheckout() {
    if (!checkIn) return tomorrowStr;
    const next = new Date(checkIn);
    next.setDate(next.getDate() + 1);
    return next.toISOString().split("T")[0];
  }
  const nights =
    checkIn && checkOut
      ? Math.ceil(
          (new Date(checkOut).getTime() - new Date(checkIn).getTime()) /
            86400000,
        )
      : 0;
  const totalPrice = selectedRate && nights > 0 ? nights * selectedRate.price_per_night : 0;
  function proceed() {
    if (!selectedRoom) return toast.error("Choose a room first");
    if (!selectedRate) return toast.error("Choose a room package first");
    if (!checkIn || !checkOut)
      return toast.error("Select check-in and check-out");
    if (nights <= 0) return toast.error("Check-out must be after check-in");
    onBook(hotelId, selectedRoom.room_id, selectedRate.rate_plan_id, checkIn, checkOut);
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
            onClick={onBack}
            className="mt-4 rounded-xl bg-violet-500 px-4 py-2 text-xs font-semibold"
          >
            Back to hotels
          </button>
        </div>
      </div>
    );
  const images = hotel.images?.length ? hotel.images : [],
    allAmenities = hotel.amenities || [],
    displayedAmenities = showAllAmenities
      ? allAmenities
      : allAmenities.slice(0, 4);
  const latitude = Number(hotel.gps_latitude),
    longitude = Number(hotel.gps_longitude),
    mapPoint = Number.isFinite(latitude) && Number.isFinite(longitude) ? { lat: latitude, lng: longitude } : null,
    destination = locationUnlocked && hotel.location_exact === true ? mapPoint : null,
    distance = location && mapPoint ? distanceBetweenKm(location, mapPoint) : null;
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-28 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#0A0A0F]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-400">
              WEHOUSE · HOTELS
            </p>
            <p className="mt-1 truncate text-sm font-semibold">{hotel.name}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6">
        <section className="-mx-4 overflow-hidden border-y border-white/[.07] bg-[#10141C] sm:mx-0 sm:rounded-3xl sm:border">
          <div className="relative aspect-[4/3] bg-[#171B24] sm:aspect-[16/9]">
            {images.length ? (
              <img
                src={images[currentImage]}
                alt={`${hotel.name} photo ${currentImage + 1}`}
                fetchPriority="high"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-[#62697A]">
                No hotel image yet
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            {images.length > 1 && (
              <>
                <span className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-[9px] font-semibold">
                  {currentImage + 1} / {images.length}
                </span>
                <div className="absolute bottom-3 left-3 flex gap-1.5">
                  {images.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImage(index)}
                      aria-label={`View hotel photo ${index + 1}`}
                      className={`h-1.5 rounded-full ${index === currentImage ? "w-5 bg-violet-400" : "w-1.5 bg-white/45"}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold">{hotel.name}</h1>
                <p className="mt-1 text-[10px] text-[#747B8B]">
                  {[hotel.area, hotel.city, hotel.state]
                    .filter(Boolean)
                    .join(", ")}
                  {distance !== null
                    ? ` · about ${distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} m` : `${distance.toFixed(distance < 10 ? 1 : 0)} km`} away`
                    : ""}
                </p>
              </div>
              {Number(hotel.rating || 0) > 0 && (
                <span className="rounded-full border border-amber-500/20 bg-amber-500/[.08] px-2.5 py-1 text-[9px] font-semibold text-amber-300">
                  ★ {Number(hotel.rating).toFixed(1)}
                </span>
              )}
            </div>
            {hotel.description && (
              <p className="mt-4 text-[11px] leading-5 text-[#9399A8]">
                {hotel.description}
              </p>
            )}
            {destination && hotel.address ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-black/10 p-3 text-[10px] text-[#7D8494]">
                <span>{hotel.address}</span>
                {destination && (
                  <a
                    href={directionsUrl(destination.lat, destination.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-semibold text-violet-300"
                  >
                    Directions
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-white/[.06] bg-black/10 p-3 text-[10px] text-[#7D8494]">
                Approximate area only. The exact entrance and road directions
                unlock after a confirmed payment.
              </div>
            )}
          </div>
        </section>

        {allAmenities.length > 0 && (
          <section className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Amenities</h2>
              {allAmenities.length > 4 && (
                <button
                  onClick={() => setShowAllAmenities((value) => !value)}
                  className="text-[9px] font-semibold text-violet-300"
                >
                  {showAllAmenities
                    ? "Show less"
                    : `+${allAmenities.length - 4} more`}
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {displayedAmenities.map((item) => (
                <span
                  key={item}
                  className="rounded-xl border border-white/[.06] bg-white/[.025] px-2.5 py-1.5 text-[9px] text-[#A0A6B4]"
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[.06] bg-white/[.06]">
          <div className="bg-[#10141C] p-4"><p className="text-[8px] uppercase tracking-wide text-[#686F80]">Check-in</p><p className="mt-1 text-xs font-semibold">From {formatHotelTime(hotel.check_in_time, "14:00")}</p></div>
          <div className="bg-[#10141C] p-4"><p className="text-[8px] uppercase tracking-wide text-[#686F80]">Check-out</p><p className="mt-1 text-xs font-semibold">By {formatHotelTime(hotel.check_out_time, "12:00")}</p></div>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-base font-bold">Rooms and rates</h2>
            <p className="mt-1 text-[9px] text-[#666D7E]">
              Select a room type to see its full gallery and booking details.
            </p>
          </div>
          {hotel.hotel_rooms?.length ? (
            <div className="divide-y divide-white/[.07] border-y border-white/[.07]">
              {hotel.hotel_rooms.map((room) => {
                const roomPhotos = Array.isArray(room.images)
                  ? room.images
                  : [];
                const active = selectedRoom?.room_id === room.room_id;
                return (
                  <button
                    key={room.room_id}
                    onClick={() => {
                      setSelectedRoom(room);
                      setSelectedRate(room.rate_plans?.find((plan) => plan.active) || null);
                      setRoomImage(0);
                    }}
                    className={`flex w-full items-center gap-3 py-3 text-left ${active ? "text-white" : "text-[#C3C7D1]"}`}
                  >
                    <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">
                      {roomPhotos[0] ? (
                        <img
                          src={roomPhotos[0]}
                          alt={`${room.room_type} room`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-[8px] text-[#62697A]">
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">
                        {room.room_type}
                      </h3>
                      <p className="mt-1 text-[9px] text-[#858B9A]">
                        Up to {room.max_guests} guest
                        {room.max_guests === 1 ? "" : "s"}
                        {room.bed_type ? ` · ${room.bed_type}` : ""}
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-violet-200">
                        From ₦{roomStartingPrice(room).toLocaleString()}{" "}
                        <span className="text-[8px] font-normal text-[#62697A]">
                          / night
                        </span>
                      </p>
                    </div>
                    <span
                      className={`text-lg ${active ? "text-violet-300" : "text-[#62697A]"}`}
                    >
                      {active ? "✓" : "›"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="border-y border-dashed border-white/[.08] py-10 text-center text-[10px] text-[#666D7E]">
              No rooms are currently available.
            </div>
          )}
          {selectedRoom && (
            <div className="mt-5 border-y border-violet-500/20 py-4">
              <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-black">
                {selectedRoom.images?.[roomImage] ? (
                  <img
                    src={selectedRoom.images[roomImage]}
                    alt={`${selectedRoom.room_type} photo ${roomImage + 1}`}
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-[9px] text-[#62697A]">
                    Room photo unavailable
                  </div>
                )}
              </div>
              {(selectedRoom.images?.length || 0) > 1 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {selectedRoom.images.map((src, index) => (
                    <button
                      type="button"
                      key={`${src}-${index}`}
                      onClick={() => setRoomImage(index)}
                      aria-label={`View ${selectedRoom.room_type} photo ${index + 1}`}
                      className={`h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${roomImage === index ? "border-violet-400" : "border-transparent"}`}
                    >
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
              <div className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold">
                      {selectedRoom.room_type}
                    </h3>
                    <p className="mt-1 text-[9px] text-[#858B9A]">
                      Maximum {selectedRoom.max_guests} guest
                      {selectedRoom.max_guests === 1 ? "" : "s"}
                    </p>
                  </div>
                  {selectedRate && <p className="text-sm font-bold text-violet-200">
                    ₦{Number(selectedRate.price_per_night).toLocaleString()}
                    <span className="block text-right text-[8px] font-normal text-[#62697A]">per night</span>
                  </p>}
                </div>
                {selectedRoom.description && (
                  <p className="mt-3 text-[10px] leading-5 text-[#969CAA]">
                    {selectedRoom.description}
                  </p>
                )}
                {selectedRoom.amenities?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedRoom.amenities.map((item) => (
                      <span
                        key={item}
                        className="border-b border-white/[.09] px-1 py-1 text-[8px] text-[#A0A6B4]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-5 space-y-2">
                  <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#6F7585]">Choose your package</p>
                  {(selectedRoom.rate_plans || []).filter((plan) => plan.active).map((plan) => (
                    <button
                      key={plan.rate_plan_id}
                      type="button"
                      onClick={() => setSelectedRate(plan)}
                      className={`w-full rounded-2xl border p-3 text-left ${selectedRate?.rate_plan_id === plan.rate_plan_id ? "border-violet-400/45 bg-violet-500/[.09]" : "border-white/[.07] bg-white/[.02]"}`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-xs font-semibold">{plan.name}</span>
                          <span className="mt-1 block text-[9px] text-[#747B8C]">
                            {mealLabel(plan.meal_plan)} · {paymentLabel(plan.payment_timing)} · {plan.refundable ? `Free cancellation${plan.cancellation_hours ? ` up to ${plan.cancellation_hours}h before arrival` : ""}` : "Non-refundable"}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-bold text-violet-200">₦{Number(plan.price_per_night).toLocaleString()}</span>
                      </span>
                      {plan.description && <span className="mt-2 block text-[9px] leading-4 text-[#8A91A0]">{plan.description}</span>}
                      {plan.included_features?.length ? <span className="mt-2 block text-[8px] text-emerald-300">Includes {plan.included_features.join(" · ")}</span> : null}
                    </button>
                  ))}
                  {!selectedRoom.rate_plans?.some((plan) => plan.active) && <p className="rounded-xl bg-amber-500/[.08] p-3 text-[9px] text-amber-200">This room has no active package yet.</p>}
                </div>
              </div>
            </div>
          )}
        </section>

        {hotel.venues?.length ? (
          <section className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4">
            <h2 className="text-sm font-semibold">At the hotel</h2>
            <p className="mt-1 text-[9px] text-[#666D7E]">Named restaurants and facilities, with hours and package access.</p>
            <div className="mt-3 divide-y divide-white/[.06]">
              {hotel.venues.map((venue) => (
                <div key={venue.venue_id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-xs font-semibold">{venue.name}</p><p className="mt-1 text-[8px] uppercase tracking-wide text-violet-300">{venue.kind}</p></div>
                    {venue.opening_hours && <p className="text-right text-[9px] text-[#858B9A]">{venue.opening_hours}</p>}
                  </div>
                  {venue.description && <p className="mt-2 text-[9px] leading-4 text-[#858B9A]">{venue.description}</p>}
                  {venue.package_notes && <p className="mt-2 text-[8px] text-emerald-300">Package access: {venue.package_notes}</p>}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {selectedRoom && (
          <section className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4">
            <h2 className="text-sm font-semibold">Stay dates</h2>
            <p className="mt-1 text-[9px] text-[#6F7585]">
              Dates outside this booking window are unavailable.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <DateField
                label="Check-in"
                value={checkIn}
                min={tomorrowStr}
                max={bookingWindowEndStr}
                onChange={(value) => {
                  setCheckIn(value);
                  if (checkOut && checkOut <= value) setCheckOut("");
                }}
              />
              <DateField
                label="Check-out"
                value={checkOut}
                min={minCheckout()}
                max={bookingWindowEndStr}
                onChange={setCheckOut}
              />
            </div>
            {nights > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Fact label="Nights" value={String(nights)} />
                <Fact
                  label="Stay total"
                  value={`₦${totalPrice.toLocaleString()}`}
                />
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Guest reviews</h2>
              <p className="mt-1 text-[9px] text-[#666D7E]">
                {reviews.length} verified review
                {reviews.length === 1 ? "" : "s"}
              </p>
            </div>
            {reviewEligible && (
              <button
                onClick={() => setShowReviewForm((value) => !value)}
                className="rounded-xl border border-white/[.08] px-3 py-2 text-[9px] font-semibold text-violet-300"
              >
                {showReviewForm ? "Cancel" : "Write review"}
              </button>
            )}
          </div>
          {showReviewForm && reviewEligible && (
            <div className="mt-4 space-y-3 rounded-2xl border border-white/[.06] bg-black/10 p-3">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    onClick={() => setReviewRating(value)}
                    className={`text-lg ${value <= reviewRating ? "text-amber-300" : "text-[#444A58]"}`}
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
                className="w-full resize-none rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none focus:border-violet-500/40"
              />
              <button
                onClick={() => void submitReview()}
                disabled={submittingReview}
                className="h-11 w-full rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-50"
              >
                {submittingReview ? "Submitting…" : "Publish verified review"}
              </button>
            </div>
          )}
          <div className="mt-4 space-y-2">
            {reviews.length ? (
              reviews.slice(0, 6).map((review) => (
                <div
                  key={review.review_id}
                  className="rounded-xl border border-white/[.05] bg-black/10 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold">
                      @{review.profiles?.username || "guest"}
                    </p>
                    <p className="text-[9px] text-amber-300">
                      {"★".repeat(Number(review.rating || 0))}
                    </p>
                  </div>
                  {review.comment && (
                    <p className="mt-2 text-[10px] leading-relaxed text-[#858B9A]">
                      {review.comment}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="py-5 text-center text-[10px] text-[#666D7E]">
                No verified reviews yet.
              </p>
            )}
          </div>
        </section>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[.08] bg-[#090B12]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mx-auto max-w-5xl">
          <button
            onClick={proceed}
            disabled={!selectedRoom}
            className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40"
          >
            Continue to guest details
          </button>
        </div>
      </div>
    </div>
  );
}

function formatHotelTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const hour = Number(match?.[1] || 0), minute = match?.[2] || "00";
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
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
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[.05] bg-black/10 p-3">
      <p className="text-[8px] uppercase tracking-wide text-[#62697A]">
        {label}
      </p>
      <p className="mt-1 text-[11px] font-semibold">{value}</p>
    </div>
  );
}
