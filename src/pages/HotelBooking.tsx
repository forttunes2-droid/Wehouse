import { useEffect, useMemo, useState } from "react";
import {
  createHotelBooking,
  getRoomById,
  initializeHotelBookingPayment,
  quoteHotelRoomRate,
} from "@/lib/supabase";
import type { Hotel, HotelRatePlan, HotelRoom } from "@/types";
import { Toaster, toast } from "sonner";
import BackButton from "@/components/BackButton";

interface HotelBookingProps {
  hotelId: number;
  roomId: number;
  ratePlanId: number;
  checkIn?: string;
  checkOut?: string;
  profile: { user_id: string; username: string | null; phone: string | null };
  onBack: () => void;
  onComplete: () => void;
}

type RoomContext = HotelRoom & { hotels: Hotel };
type Quote = {
  available: boolean;
  nights?: number;
  total_price?: number;
  blocked_date?: string;
  rate_plan_name?: string;
};

const mealLabels: Record<HotelRatePlan["meal_plan"], string> = {
  room_only: "Room only",
  breakfast: "Breakfast included",
  half_board: "Breakfast + one meal",
  full_board: "All daily meals",
  all_inclusive: "All inclusive",
};

export default function HotelBooking({
  hotelId,
  roomId,
  ratePlanId,
  checkIn: prefillCheckIn,
  checkOut: prefillCheckOut,
  profile,
  onBack,
  onComplete,
}: HotelBookingProps) {
  const [room, setRoom] = useState<RoomContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkIn, setCheckIn] = useState(prefillCheckIn || "");
  const [checkOut, setCheckOut] = useState(prefillCheckOut || "");
  const [guestCount, setGuestCount] = useState(1);
  const [guestName, setGuestName] = useState(profile.username || "");
  const [guestPhone, setGuestPhone] = useState(profile.phone || "");
  const [specialRequests, setSpecialRequests] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let live = true;
    void getRoomById(roomId, hotelId).then(({ room: result, error }) => {
      if (!live) return;
      if (error || !result) toast.error("This room could not be loaded");
      setRoom(result as RoomContext | null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [hotelId, roomId]);

  const ratePlan = useMemo(
    () => room?.rate_plans?.find((plan) => plan.rate_plan_id === ratePlanId) || null,
    [ratePlanId, room],
  );

  useEffect(() => {
    if (!checkIn || !checkOut || !ratePlan) {
      setQuote(null);
      return;
    }
    let live = true;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      void quoteHotelRoomRate({ hotelId, roomId, ratePlanId, checkIn, checkOut }).then(
        ({ quote: result, error }) => {
          if (!live) return;
          setQuoteLoading(false);
          if (error) {
            setQuote(null);
            toast.error(error.message || "Live availability could not be checked");
            return;
          }
          setQuote(result);
        },
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [checkIn, checkOut, hotelId, ratePlan, ratePlanId, roomId]);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowString = tomorrow.toISOString().split("T")[0];
  const windowEnd = new Date(tomorrow);
  windowEnd.setDate(windowEnd.getDate() + 365);
  const windowEndString = windowEnd.toISOString().split("T")[0];
  const minimumCheckout = checkIn
    ? new Date(new Date(`${checkIn}T00:00:00`).getTime() + 86400000)
        .toISOString()
        .split("T")[0]
    : tomorrowString;

  async function book() {
    if (!room || !ratePlan) return toast.error("Room package is unavailable");
    if (!quote?.available || !quote.nights || !quote.total_price)
      return toast.error("Choose available dates first");
    if (!guestName.trim() || !guestPhone.trim())
      return toast.error("Guest name and phone number are required");
    if (guestCount < 1 || guestCount > Number(room.max_guests || 1))
      return toast.error(`This room allows up to ${room.max_guests} guests`);

    setSubmitting(true);
    const { booking, error } = await createHotelBooking({
      hotel_id: hotelId,
      room_id: roomId,
      rate_plan_id: ratePlanId,
      rate_plan_name: ratePlan.name,
      user_id: profile.user_id,
      check_in: checkIn,
      check_out: checkOut,
      guest_count: guestCount,
      total_nights: quote.nights,
      total_price: quote.total_price,
      status: "pending",
      payment_status: "unpaid",
      guest_name: guestName.trim(),
      guest_phone: guestPhone.trim(),
      special_requests: specialRequests.trim() || null,
    });
    if (error || !booking) {
      setSubmitting(false);
      toast.error(error?.message || "Booking could not be created");
      return;
    }
    const payment = await initializeHotelBookingPayment(booking.booking_id);
    if (payment.error || !payment.result?.success) {
      setSubmitting(false);
      toast.error(payment.error?.message || payment.result?.error || "Secure payment could not start");
      return;
    }
    if (payment.result.already_paid) {
      setSubmitting(false);
      toast.success("Booking payment confirmed");
      onComplete();
      return;
    }
    if (!payment.result.authorization_url) {
      setSubmitting(false);
      toast.error("Secure checkout link is missing");
      return;
    }
    window.location.assign(String(payment.result.authorization_url));
  }

  if (loading)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#090B10]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );

  if (!room || !ratePlan)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#090B10] px-5 text-center text-white">
        <div>
          <p className="text-sm font-semibold">Room package unavailable</p>
          <button onClick={onBack} className="mt-4 text-xs font-semibold text-violet-300">Choose another room</button>
        </div>
      </div>
    );

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-10 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">Secure hotel booking</p>
            <h1 className="mt-1 truncate text-sm font-semibold">{room.hotels.name}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-5">
        <section className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#11151D]">
          {room.images?.[0] ? <img src={room.images[0]} alt={room.room_type} className="aspect-[16/8] w-full object-cover" /> : null}
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-base font-bold">{room.room_type}</h2><p className="mt-1 text-[9px] text-[#737A8A]">Up to {room.max_guests} guests{room.bed_type ? ` · ${room.bed_type}` : ""}</p></div>
              <p className="text-sm font-bold text-violet-200">₦{Number(ratePlan.price_per_night).toLocaleString()}<span className="block text-right text-[8px] font-normal text-[#687080]">per night</span></p>
            </div>
            <div className="mt-4 border-t border-white/[.06] pt-3">
              <p className="text-xs font-semibold">{ratePlan.name}</p>
              <p className="mt-1 text-[9px] text-[#858B9A]">{mealLabels[ratePlan.meal_plan]} · {ratePlan.refundable ? `Refundable up to ${ratePlan.cancellation_hours || 0}h before arrival` : "Non-refundable"}</p>
              {ratePlan.included_features?.length ? <p className="mt-2 text-[8px] text-emerald-300">Includes {ratePlan.included_features.join(" · ")}</p> : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
          <h2 className="text-sm font-semibold">Stay dates</h2>
          <p className="mt-1 text-[9px] text-[#6E7585]">Check-in from {formatHotelTime(room.hotels.check_in_time, "14:00")} · Check-out by {formatHotelTime(room.hotels.check_out_time, "12:00")}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <DateField label="Check-in" value={checkIn} min={tomorrowString} max={windowEndString} onChange={(value) => { setCheckIn(value); if (checkOut && checkOut <= value) setCheckOut(""); }} />
            <DateField label="Check-out" value={checkOut} min={minimumCheckout} max={windowEndString} onChange={setCheckOut} />
          </div>
          {quoteLoading ? <p className="mt-3 text-[9px] text-violet-300">Checking live room inventory…</p> : null}
          {!quoteLoading && quote && !quote.available ? <p className="mt-3 rounded-xl bg-amber-500/[.08] p-3 text-[9px] text-amber-200">Unavailable on {quote.blocked_date ? new Date(`${quote.blocked_date}T00:00:00`).toLocaleDateString() : "one of these dates"}. Choose different dates.</p> : null}
          {quote?.available && quote.nights && quote.total_price ? (
            <div className="mt-4 flex items-center justify-between border-t border-white/[.06] pt-3"><p className="text-[10px] text-[#858B9A]">{quote.nights} night{quote.nights === 1 ? "" : "s"} · live price</p><p className="text-lg font-bold">₦{Number(quote.total_price).toLocaleString()}</p></div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
          <h2 className="text-sm font-semibold">Guest details</h2>
          <p className="mt-1 text-[9px] leading-4 text-[#6E7585]">The hotel receives this booking context after verified payment. You do not need to message them first.</p>
          <div className="mt-4 space-y-3">
            <Field label="Full name" value={guestName} onChange={setGuestName} autoComplete="name" />
            <Field label="Phone number" value={guestPhone} onChange={setGuestPhone} type="tel" autoComplete="tel" />
            <div>
              <p className="mb-1.5 text-[9px] text-[#777E8E]">Guests</p>
              <div className="flex h-12 items-center justify-between rounded-xl border border-white/[.08] bg-[#171B24] px-2">
                <button type="button" disabled={guestCount <= 1} onClick={() => setGuestCount((value) => Math.max(1, value - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-white/[.07] text-lg disabled:opacity-25" aria-label="Remove guest">−</button>
                <span className="text-sm font-bold">{guestCount}</span>
                <button type="button" disabled={guestCount >= room.max_guests} onClick={() => setGuestCount((value) => Math.min(room.max_guests, value + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-white/[.07] text-lg disabled:opacity-25" aria-label="Add guest">+</button>
              </div>
            </div>
            <label><span className="mb-1.5 block text-[9px] text-[#777E8E]">Special requests (optional)</span><textarea value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value.slice(0, 1200))} rows={3} placeholder="Arrival time, accessibility or room request" className="w-full resize-none rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none focus:border-violet-500/40" /></label>
          </div>
        </section>

        <button type="button" onClick={() => void book()} disabled={submitting || quoteLoading || !quote?.available} className="h-12 w-full rounded-2xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-40">
          {submitting ? "Opening secure payment…" : quote?.available && quote.total_price ? `Pay ₦${Number(quote.total_price).toLocaleString()} securely` : "Choose available dates"}
        </button>
        <p className="text-center text-[9px] leading-4 text-[#626979]">Your room, package, dates, guest and payment stay attached to one WeHouse booking record.</p>
      </main>
    </div>
  );
}

function DateField({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (value: string) => void }) {
  return <label><span className="mb-1.5 block text-[9px] text-[#777E8E]">{label}</span><input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none [color-scheme:dark] focus:border-violet-500/40" /></label>;
}

function Field({ label, value, onChange, type = "text", autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete?: string }) {
  return <label><span className="mb-1.5 block text-[9px] text-[#777E8E]">{label}</span><input type={type} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none focus:border-violet-500/40" /></label>;
}

function formatHotelTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const hour = Number(match?.[1] || 0), minute = match?.[2] || "00";
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}
