import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import DateField from "@/components/BookingDateField";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import HotelBookingShares from '@/components/HotelBookingShares';
const SharedHousingDetails=lazy(()=>import('@/components/SharedHousingDetails'));
import {
  createHotelBooking,
  getRoomById,
  initializeHotelBookingPayment,
  quoteHotelRoomRate,
} from "@/lib/supabase";
import {getMyHotelBookingHold,releaseHotelBookingHold} from '@/lib/supabase/hotels';
import {hotelCheckoutSignature,hotelHoldReceipt,hotelQuoteReceipt,hotelCalendarDay,hotelCheckoutState,validHotelPhone,type HotelHold} from '@/lib/hotelCheckout';
import {requestKeyFor,releaseRequestKey,runSafeAction} from '@/lib/safeAction';
import type { Hotel, HotelRatePlan, HotelRoom } from "@/types";
import { toast } from "sonner";
import { formatRecordedMoney, propertyTimeZone } from "@/lib/regional";
import BackButton from "@/components/BackButton";
import BookingPaymentReview from "@/components/BookingPaymentReview";
import {displayDateTimeAtProperty,displayMoment} from '@/lib/displayDate';

interface HotelBookingProps {
  hotelId: number;
  roomId: number;
  ratePlanId: number;
  checkIn?: string;
  checkOut?: string;
  profile: { user_id: string; username: string | null; phone: string | null;full_name?:string|null };
  onBack: () => void;
  onComplete: (bookingId?:number) => void;
}

type RoomContext = HotelRoom & { hotels: Hotel };
type PendingHotelBooking = HotelHold & {currency?:string};
type Quote = {
  currency?: string;
  available: boolean;
  nights?: number;
  total_price?: number;
  blocked_date?: string;
  rate_plan_name?: string;
  cancellation_deadline?: string | null;
  cancellation_timezone?: string;
  refund_amount_ngn?: number;
  original_price?: number;
  discount_percent?: number;
  discount_amount?: number;
  wehouse_discount_percent?: number;
};

const money = (value: number) => formatRecordedMoney(value);
const mealLabels: Record<HotelRatePlan["meal_plan"], string> = {
  room_only: "Room only",
  breakfast: "Breakfast included",
  half_board: "Breakfast + one meal",
  full_board: "All daily meals",
  all_inclusive: "All inclusive",
};

export default function HotelBooking(props:HotelBookingProps){return <HotelBookingForm key={[props.profile.user_id,props.hotelId,props.roomId,props.ratePlanId,props.checkIn,props.checkOut].join(':')} {...props}/>;}
function HotelBookingForm({
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
  const [guestName, setGuestName] = useState(profile.full_name || "");
  const [guestPhone, setGuestPhone] = useState(profile.phone || "");
  const [specialRequests, setSpecialRequests] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [action,setAction]=useState<'hold'|'release'|'payment'|null>(null);
  const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const signature=hotelCheckoutSignature({personId:profile.user_id,hotelId,roomId,ratePlanId});
  const [requestKey,setRequestKey]=useState(()=>requestKeyFor(signature));
  const scope=useMemo(()=>({personId:profile.user_id,hotelId,roomId,ratePlanId,requestKey}),[profile.user_id,hotelId,roomId,ratePlanId,requestKey]);
  const actionLock=useRef(false),alive=useRef(true);
  const submitting=Boolean(action)||loading;
  const [pendingBooking, setPendingBooking] = useState<PendingHotelBooking | null>(null);
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{
    const update=()=>setClock(Date.now());update();window.addEventListener('focus',update);
    const until=Date.parse(pendingBooking?.payment_expires_at||'')-Date.now();
    const timer=until>0&&until<2147483647?window.setTimeout(update,until+25):undefined;
    return()=>{if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener('focus',update);};
  },[pendingBooking?.booking_id,pendingBooking?.payment_expires_at,pendingBooking?.payment_status]);

  useEffect(() => {
    let live=true;setLoading(true);setError('');
    void Promise.all([getRoomById(roomId,hotelId),getMyHotelBookingHold(requestKey)]).then(([roomResult,holdResult])=>{
      if(!live)return;
      if(holdResult.error)throw holdResult.error;
      const saved=hotelHoldReceipt(holdResult.booking,scope);
      if(saved){setPendingBooking(saved);setCheckIn(saved.check_in);setCheckOut(saved.check_out);setGuestCount(saved.guest_count);setGuestName(saved.guest_name);setGuestPhone(saved.guest_phone);setSpecialRequests(saved.special_requests||'');}else setPendingBooking(null);
      const result=roomResult.room;
      if(roomResult.error||!result||result.room_id!==roomId||result.hotel_id!==hotelId||!Number.isInteger(result.max_guests)||result.max_guests<1)throw Error('This room package could not be loaded. Please retry or choose another room.');
      setRoom(result as RoomContext);
    }).catch(cause=>{if(live)setError(message(cause,'This room could not be loaded. Please retry.'));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[hotelId,roomId,requestKey,scope,attempt]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

  const ratePlan = useMemo(
    () => room?.rate_plans?.find((plan) => plan.rate_plan_id === ratePlanId) || null,
    [ratePlanId, room],
  );

  useEffect(() => {
    setQuote(null);
    if (!checkIn || !checkOut || !ratePlan || pendingBooking) {
      setQuote(null);
      setQuoteLoading(false);
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
            setError(error.message || "Live availability could not be checked");
            return;
          }
          setQuote(hotelQuoteReceipt(result));setError('');
        },
      ).catch(cause=>{if(live){setQuoteLoading(false);setError(message(cause,'Live availability could not be checked.'));}});
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [checkIn, checkOut, hotelId, ratePlan, ratePlanId, roomId,pendingBooking,attempt]);

  const today=new Date().toISOString().slice(0,10),tomorrowString=hotelCalendarDay(today),windowEndString=hotelCalendarDay(today,366);
  const minimumCheckout=hotelCalendarDay(checkIn)||tomorrowString;

  async function book() {
    if(actionLock.current||submitting)return;
    if (!room || !ratePlan) return toast.error("Room package is unavailable");
    if (!quote?.available || !quote.nights || !quote.total_price)
      return toast.error("Choose available dates first");
    if(!guestName.trim()){setError('Enter the guest’s full name.');return;}
    if(!guestPhone.trim()){setError('Enter a contact phone number.');return;}
    if(!validHotelPhone(guestPhone.trim())){setError('Enter a phone number with 7–15 digits. You can include spaces and the country code.');return;}
    if (guestCount < 1 || guestCount > Number(room.max_guests || 1))
      return toast.error(`This room allows up to ${room.max_guests} guests`);

    actionLock.current=true;setAction('hold');setError('');
    try{
    const { booking, error } = await runSafeAction('hotel-hold:'+requestKey,()=>createHotelBooking({
      hotel_id: hotelId,
      room_id: roomId,
      rate_plan_id: ratePlanId,
      rate_plan_name: ratePlan.name,
      user_id: profile.user_id,
      check_in: checkIn,
      check_out: checkOut,
      guest_count: guestCount,
      total_nights: Number(quote.nights),
      total_price: Number(quote.total_price),
      status: "pending",
      payment_status: "unpaid",
      guest_name: guestName.trim(),
      guest_phone: guestPhone.trim(),
      special_requests: specialRequests.trim() || null,
    },requestKey));
    if(error)throw error;
    const saved=hotelHoldReceipt(booking,scope);if(!saved)throw Error('The room hold was not confirmed. Refresh before retrying.');
    if(alive.current)setPendingBooking(saved);
    }catch(cause){if(alive.current)setError(message(cause,'The room hold could not be confirmed. Refresh before retrying.'));}
    finally{actionLock.current=false;if(alive.current)setAction(null);}
  }

  function startFreshCheckout(){releaseRequestKey(signature);setRequestKey(requestKeyFor(signature));setPendingBooking(null);setQuote(null);setError('');setAttempt(value=>value+1);}

  async function editPendingBooking() {
    if (!pendingBooking || submitting||actionLock.current) return;
    actionLock.current=true;setAction('release');setError('');
    try{const result=await runSafeAction('hotel-release:'+pendingBooking.booking_id,()=>releaseHotelBookingHold(pendingBooking.booking_id));if(result.error)throw result.error;if(alive.current){startFreshCheckout();toast.success('Unpaid room hold released. You can edit the booking details.');}}
    catch(cause){if(alive.current)setError(message(cause,'The room hold release could not be confirmed. Refresh before retrying.'));}
    finally{actionLock.current=false;if(alive.current)setAction(null);}
  }

  async function openPayment() {
    if (!pendingBooking || submitting||actionLock.current) return;
    actionLock.current=true;setAction('payment');setError('');
    try{
      const payment=await runSafeAction('hotel-pay:'+pendingBooking.booking_id,()=>initializeHotelBookingPayment(pendingBooking.booking_id));
      if(payment.error||payment.result?.success!==true)throw Error(payment.error?.message||payment.result?.error||'Secure payment could not start. Refresh the booking before retrying.');
      if(!alive.current)return;
      if(payment.result.already_paid===true){toast.success('Payment recorded. Check your booking status.');onComplete(pendingBooking.booking_id);return;}
      if(!payment.result.authorization_url)throw Error('The secure checkout link could not be confirmed.');
      window.location.assign(String(payment.result.authorization_url));
    }catch(cause){if(alive.current)setError(message(cause,'The payment start result is unknown. Refresh this booking before retrying.'));}
    finally{actionLock.current=false;if(alive.current)setAction(null);}
  }

  if (pendingBooking?.shared_payment_group_id) return <Suspense fallback={<WeHouseLoadingState label="Loading shared Hotel booking"/>}><SharedHousingDetails
    groupId={pendingBooking.shared_payment_group_id} userId={profile.user_id} onBack={()=>onComplete(pendingBooking.booking_id)}
    onChanged={()=>setAttempt(value=>value+1)}/></Suspense>;
  if (pendingBooking) {
    const state=hotelCheckoutState(pendingBooking,clock);
    if(!state.canPay)return <HotelCheckoutStatus state={state} error={error} busy={submitting} onBack={onBack} onBookings={()=>onComplete(pendingBooking.booking_id)} onStart={startFreshCheckout} onRefresh={()=>setAttempt(value=>value+1)}/>;
    const savedCancellation = pendingBooking.cancellation_snapshot;
    const cancellationTerms = savedCancellation
      ? savedCancellation.refundable
        ? `Full refund ${money(Number(savedCancellation.refund_amount_ngn))} if cancelled by ${formatDeadline(savedCancellation.deadline, savedCancellation.timezone)}. These terms are saved for this booking.`
        : "This rate is non-refundable for ordinary cancellation or missed arrival. A payment or stay problem can still be reported to WeHouse for review."
      : "Saved cancellation terms are not available. Payment is disabled until the booking can show the terms.";

    const pendingRows = [
      { label: "Hotel", value: room?.hotels.name || "Selected hotel" },
      { label: "Room and package", value: `${room?.room_type || "Room"} · ${pendingBooking.rate_plan_name || ratePlan?.name || "Selected package"}` },
      { label: "Stay dates", value: <><span className="block">Check-in · {formatBookingDate(pendingBooking.check_in)}</span><span className="block">Check-out · {formatBookingDate(pendingBooking.check_out)}</span></> },
      { label: "Guest details", value: <><span className="block">{pendingBooking.guest_name} · {pendingBooking.guest_count} {pendingBooking.guest_count===1?'guest':'guests'}</span><span className="block">{pendingBooking.guest_phone}</span></> },
      ...(pendingBooking.special_requests ? [{ label: "Special request", value: pendingBooking.special_requests }] : []),
      ...(pendingBooking.payment_expires_at ? [{ label: "Room hold expires", value: formatDeadline(pendingBooking.payment_expires_at) }] : []),
    ];
    return (
      <main className="min-h-[100dvh] bg-[var(--wh-bg)] px-4 py-6 text-[var(--wh-text)] sm:py-10">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center justify-between gap-3"><BackButton disabled={submitting} onClick={() => void editPendingBooking()} /><button type="button" disabled={submitting} onClick={()=>setAttempt(value=>value+1)} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm">{loading?'Checking...':'Refresh room hold'}</button></div>
          {error&&<p role="alert" className="mt-4 rounded-xl border border-[var(--wh-border)] p-4 text-sm leading-6">{error}</p>}
          <div className="mt-4">
            <BookingPaymentReview
              eyebrow="Hotel booking"
              title="Review your stay"
              subtitle="Check the hotel, room, package, dates, guest details and saved cancellation terms before paying."
              rows={pendingRows}
              amountLabel="Total due now"
              amount={formatRecordedMoney(Number(pendingBooking.total_price),pendingBooking.currency)}
              termsTitle="Cancellation and arrival"
              terms={cancellationTerms}
              note="Eligible refunds go to the original payment method and remain processing until Paystack confirms them. WeHouse confirms your booking only after verified payment."
              editLabel="Edit booking"
              confirmLabel="Accept terms and continue"
              busy={submitting}
              busyLabel={action==='release'?'Releasing room hold…':loading?'Checking room hold…':'Opening secure checkout…'}
              confirmDisabled={!savedCancellation||Boolean(error)}
              onEdit={() => void editPendingBooking()}
              onConfirm={() => void openPayment()}
            />
            <HotelBookingShares booking={pendingBooking} userId={profile.user_id} onCreated={group=>setPendingBooking(current=>current!==null&&current.booking_id===group.hotel_booking_id?{...current,shared_payment_group_id:group.id}:current)}/>
          </div>
        </div>
      </main>
    );
  }

  if (loading)
    return (
      <main className="min-h-[100dvh] bg-[var(--wh-bg)] px-4 py-6 text-[var(--wh-text)]"><div className="mx-auto max-w-2xl"><BackButton onClick={onBack}/><WeHouseLoadingState compact label="Checking room and saved checkout"/></div></main>
    );

  if (!room || !ratePlan)
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[var(--wh-bg)] px-5 text-center text-[var(--wh-text)]">
        <div>
          <p className="text-sm font-semibold">Room package unavailable</p>
          {error&&<p role="alert" className="mx-auto mt-3 max-w-md text-sm leading-6">{error}</p>}
          <button type="button" onClick={()=>setAttempt(value=>value+1)} className="mt-4 min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold">Try again</button>
          <button type="button" onClick={()=>onComplete()} className="ml-3 min-h-11 text-sm underline">Open my bookings</button>
          <button onClick={onBack} className="mt-4 text-xs font-semibold text-violet-700 dark:text-violet-300">Choose another room</button>
        </div>
      </div>
    );

  return (
    <div className="min-h-[100dvh] bg-[var(--wh-bg)] pb-10 text-[var(--wh-text)]">

      <header className="sticky top-0 z-40 border-b border-[var(--wh-border-subtle)] bg-[var(--wh-bg)]/95 px-4 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <BackButton onClick={onBack} disabled={Boolean(action)}/>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[.16em] text-violet-700 dark:text-violet-300">Secure hotel booking</p>
            <h1 className="mt-1 truncate text-sm font-semibold">{room.hotels.name}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-5">
        {error&&<div role="alert" className="space-y-2 rounded-xl border border-[var(--wh-border)] p-4 text-sm leading-6"><p>{error}</p><button type="button" disabled={submitting} onClick={()=>setAttempt(value=>value+1)} className="min-h-11 underline">Refresh room hold and availability</button></div>}
        <section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
          {room.images?.[0] ? <img src={room.images[0]} alt={room.room_type} className="aspect-[16/8] w-full object-cover" /> : null}
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-base font-bold">{room.room_type}</h2><p className="mt-1 text-xs text-[var(--wh-text-muted)]">Up to {room.max_guests} guests{room.bed_type ? ` · ${room.bed_type}` : ""}</p></div>
              <p className="text-sm font-bold text-violet-700 dark:text-violet-300">{formatRecordedMoney(Number(ratePlan.price_per_night),quote?.currency)}<span className="block text-right text-[11px] font-normal text-[var(--wh-text-muted)]">per night</span></p>
            </div>
            <div className="mt-4 border-t border-[var(--wh-border-subtle)] pt-3">
              <p className="text-xs font-semibold">{ratePlan.name}</p>
              <p className="mt-1 text-xs text-[var(--wh-text-muted)]">{mealLabels[ratePlan.meal_plan]} · {ratePlan.refundable ? `Refundable up to ${ratePlan.cancellation_hours || 0}h before arrival` : "Non-refundable"}</p>
              {ratePlan.included_features?.length ? <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">Includes {ratePlan.included_features.join(" · ")}</p> : null}
            </div>
          </div>
        </section>

        <fieldset disabled={Boolean(action)} aria-label="Booking details" className="space-y-5">
        <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
          <h2 className="text-sm font-semibold">Stay dates</h2>
          <p className="mt-1 text-xs text-[var(--wh-text-muted)]">Check-in from {formatHotelTime(room.hotels.check_in_time, "14:00")} · Check-out by {formatHotelTime(room.hotels.check_out_time, "12:00")}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <DateField label="Check-in" value={checkIn} min={tomorrowString} max={windowEndString} onChange={(value) => { setCheckIn(value); if (checkOut && checkOut <= value) setCheckOut(""); }} />
            <DateField label="Check-out" value={checkOut} min={minimumCheckout} max={windowEndString} onChange={setCheckOut} />
          </div>
          {quoteLoading ? <p className="mt-3 text-xs text-violet-700 dark:text-violet-300">Checking live room inventory…</p> : null}
          {!quoteLoading && quote && !quote.available ? <p className="mt-3 rounded-xl bg-amber-500/[.08] p-3 text-xs text-amber-700 dark:text-amber-200">Unavailable on {quote.blocked_date ? new Date(`${quote.blocked_date}T00:00:00`).toLocaleDateString() : "one of these dates"}. Choose different dates.</p> : null}
          {quote?.available && quote.nights && quote.total_price ? (
            <div className="mt-4 flex items-center justify-between border-t border-[var(--wh-border-subtle)] pt-3"><p className="text-[10px] text-[var(--wh-text-muted)]">{quote.nights} night{quote.nights === 1 ? "" : "s"} · live price</p><div className="text-right">{quote.discount_percent ? <p className="text-xs text-[var(--wh-text-muted)]"><span className="line-through">{formatRecordedMoney(Number(quote.original_price),quote.currency)}</span> · {quote.discount_percent}% off{quote.wehouse_discount_percent ? ` · includes ${quote.wehouse_discount_percent}% from WeHouse` : " from the hotel"}</p> : null}<p className="text-lg font-bold">{formatRecordedMoney(Number(quote.total_price),quote.currency)}</p></div></div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
          <h2 className="text-sm font-semibold">Guest details</h2>
          <p className="mt-1 text-xs leading-4 text-[var(--wh-text-muted)]">The hotel receives this booking context after verified payment. You do not need to message them first.</p>
          <div className="mt-4 space-y-3">
            <Field label="Full name" value={guestName} onChange={setGuestName} autoComplete="name" maxLength={120}/>
            <Field label="Phone number" value={guestPhone} onChange={setGuestPhone} type="tel" autoComplete="tel" maxLength={40}/>
            <div>
              <p className="mb-1.5 text-xs text-[var(--wh-text-muted)]">Guests</p>
              <div className="flex h-12 items-center justify-between rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-2">
                <button type="button" disabled={guestCount <= 1} onClick={() => setGuestCount((value) => Math.max(1, value - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--wh-border-subtle)] text-lg disabled:opacity-25" aria-label="Remove guest">−</button>
                <span className="text-sm font-bold">{guestCount}</span>
                <button type="button" disabled={guestCount >= room.max_guests} onClick={() => setGuestCount((value) => Math.min(room.max_guests, value + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--wh-border-subtle)] text-lg disabled:opacity-25" aria-label="Add guest">+</button>
              </div>
            </div>
            <label><span className="mb-1.5 block text-xs text-[var(--wh-text-muted)]">Special requests (optional)</span><textarea value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value.slice(0, 1200))} rows={3} placeholder="Arrival time, accessibility or room request" className="w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-sm outline-none focus:border-violet-500/40" /><span className="mt-2 block text-sm leading-6 text-[var(--wh-text-secondary)]">Your request is attached to this reservation for the hotel team. It is not guaranteed until the hotel confirms it.</span></label>
          </div>
        </section>

        <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[.06] p-4" aria-label="Cancellation and arrival terms">
          <h2 className="text-sm font-semibold text-[var(--wh-text)]">Cancellation and arrival</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">
            {ratePlan.refundable
              ? `This rate is refundable when you request cancellation at least ${ratePlan.cancellation_hours ?? 0} hours before the hotel's check-in time. After that deadline, a refund is not automatic.`
              : "This rate is non-refundable if you cancel or do not arrive. A payment or stay problem can still be reported to WeHouse for review."}
          </p>
          {quote?.cancellation_deadline && <p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Full refund {money(Number(quote.refund_amount_ngn || 0))} if cancelled by {new Date(quote.cancellation_deadline).toLocaleString(undefined,{timeZone:propertyTimeZone(quote.cancellation_timezone)})} ({propertyTimeZone(quote.cancellation_timezone)}). The confirmed booking saves these terms.</p>}
          <p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Eligible paid bookings can be cancelled from your booking. Refunds go to the original payment method and remain processing until confirmed. Contact WeHouse for exceptions or a stay the hotel could not provide.</p>
        </section>

        </fieldset>
        <button type="button" onClick={() => void book()} disabled={submitting || quoteLoading || !quote?.available} className="h-12 w-full rounded-2xl bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-40">
          {submitting ? "Confirming room hold…" : quote?.available && quote.total_price ? `Review booking · ${formatRecordedMoney(Number(quote.total_price),quote.currency)}` : "Choose available dates"}
        </button>
        <p className="text-center text-xs leading-4 text-[var(--wh-text-muted)]">Your room, package, dates, guest and payment stay attached to one WeHouse booking record.</p>
      </main>
    </div>
  );
}


function HotelCheckoutStatus({state,error,busy,onBack,onBookings,onStart,onRefresh}:{state:ReturnType<typeof hotelCheckoutState>;error:string;busy:boolean;onBack:()=>void;onBookings:()=>void;onStart:()=>void;onRefresh:()=>void}){
 return <main className="min-h-[100dvh] bg-[var(--wh-bg)] px-4 py-6 text-[var(--wh-text)]">
  <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-5">
   <BackButton onClick={onBack}/>
   <h1 className="text-xl font-semibold">{state.title}</h1>
   <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">{state.explanation}</p>
   {error&&<p role="alert" className="text-sm leading-6">{error}</p>}
   <button type="button" className="wh-motion-control min-h-12 w-full rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white" onClick={onBookings}>Open my bookings</button>
   {state.canStartNew&&<button type="button" disabled={busy} className="wh-motion-control min-h-12 w-full rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold disabled:opacity-50" onClick={onStart}>{state.newLabel}</button>}
   <button type="button" disabled={busy} className="min-h-11 px-2 text-sm underline disabled:opacity-50" onClick={onRefresh}>{busy?'Checking room hold...':'Refresh room hold'}</button>
  </section>
 </main>;
}

function Field({ label, value, onChange, type = "text", autoComplete,maxLength }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete?: string;maxLength?:number }) {
  return <label><span className="mb-1.5 block text-xs text-[var(--wh-text-muted)]">{label}</span><input type={type} value={value} autoComplete={autoComplete} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none focus:border-violet-500/40" /></label>;
}

function formatBookingDate(value: string) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatDeadline(value: string|null|undefined, timezone?: string) {
  if(!value)return 'Deadline unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return timezone?displayDateTimeAtProperty(value,timezone):displayMoment(value);
}

function formatHotelTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const hour = Number(match?.[1] || 0), minute = match?.[2] || "00";
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}
function message(cause:unknown,fallback:string){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||fallback;}
