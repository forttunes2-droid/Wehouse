import { useState, useEffect } from 'react';
import { getRoomById, createReservation, getReservationForListing, supabase } from '@/lib/supabase';
import { useHotelReservationSettings, calculateReservationFee } from '@/hooks/useHotelReservationSettings';
import type { HotelRoom, Hotel } from '@/types';
import { Toaster, toast } from 'sonner';

interface HotelReservationProps {
  hotelId: number;
  roomId: number;
  profile: { user_id: string; username: string | null; phone: string | null };
  onBack: () => void;
  onProceedToBooking: (hotelId: number, roomId: number) => void;
  onComplete: () => void;
}

export default function HotelReservation({ hotelId, roomId, profile, onBack, onProceedToBooking, onComplete }: HotelReservationProps) {
  const [room, setRoom] = useState<(HotelRoom & { hotels: Hotel }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reservationComplete, setReservationComplete] = useState(false);
  const [existingReservation, setExistingReservation] = useState<any>(null);

  // Creator-controlled reservation settings
  const settings = useHotelReservationSettings();

  useEffect(() => {
    loadRoomAndReservation();
  }, [roomId, hotelId]);

  async function loadRoomAndReservation() {
    setLoading(true);
    const { room: r, error } = await getRoomById(roomId);
    if (error || !r) {
      toast.error('Failed to load room');
      setLoading(false);
      return;
    }
    setRoom(r);

    // Check if user already has a reservation for this hotel room
    const { data: existing } = await supabase
      .from('reservations')
      .select('*')
      .eq('user_id', profile.user_id)
      .eq('listing_id', String(hotelId)) // hotels use hotel_id as listing_id in reservations
      .in('status', ['pending', 'confirmed', 'approved_for_verification'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      setExistingReservation(existing);
      setReservationComplete(true);
    }

    setLoading(false);
  }

  async function handlePayReservation() {
    if (!room) return;
    setSubmitting(true);

    // Create a reservation record
    const fee = calculateReservationFee(settings);
    const { reservation, error, alreadyExists } = await createReservation(
      String(hotelId),
      profile.user_id,
      {
        title: `${room.hotels.name} — ${room.room_type}`,
        price: room.price_per_night,
        location: `${room.hotels.city}, ${room.hotels.state}`,
      }
    );

    if (error) {
      toast.error('Failed to create reservation');
      setSubmitting(false);
      return;
    }

    if (alreadyExists) {
      toast.success('You already have a reservation for this hotel');
      setExistingReservation(reservation);
      setReservationComplete(true);
      setSubmitting(false);
      return;
    }

    // Update reservation with hotel-specific data
    if (reservation) {
      await supabase
        .from('reservations')
        .update({
          status: 'confirmed',
          manual_payment_status: 'paid',
          reservation_type: 'hotel',
          room_id: roomId,
          reservation_fee: fee,
          expiry_hours: settings.expiryHours,
          refund_policy: settings.refundPolicy,
        })
        .eq('id', reservation.id);

      toast.success(`Reservation confirmed! Fee: ₦${fee.toLocaleString()}`);
      setReservationComplete(true);
      setExistingReservation({ ...reservation, status: 'confirmed' });
    }

    setSubmitting(false);
  }

  const fee = calculateReservationFee(settings);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#5C5E72]">Room not found</p>
        <button onClick={onBack} className="text-xs text-[#3B82F6]">Go back</button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-[#1A1A24] flex items-center justify-center text-white hover:bg-[#2A2A3A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-bold text-white">Hotel Reservation</h1>
        </div>
      </header>

      <div className="px-4 py-6 space-y-4">
        {/* Hotel & Room Info */}
        <div className="glass rounded-2xl p-4 border border-white/[0.06]">
          <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide mb-1">Hotel</p>
          <p className="text-sm font-bold text-white">{room.hotels.name}</p>
          <p className="text-[10px] text-[#5C5E72] mt-0.5">{room.hotels.city}, {room.hotels.state}</p>

          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide mb-1">Room</p>
            <p className="text-sm font-bold text-white">{room.room_type}</p>
            <p className="text-[10px] text-[#5C5E72] mt-0.5">₦{room.price_per_night.toLocaleString()} per night</p>
          </div>
        </div>

        {/* Reservation Status */}
        {!reservationComplete ? (
          <>
            {/* Pay Reservation Fee */}
            <div className="glass rounded-2xl p-4 border border-[#3B82F6]/20 bg-[#3B82F6]/5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Reservation Fee</p>
                  <p className="text-[10px] text-[#5C5E72]">Required before booking</p>
                </div>
              </div>

              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-bold text-[#3B82F6]">₦{fee.toLocaleString()}</span>
                <span className="text-[10px] text-[#5C5E72]">{settings.feeType === 'per_day' ? 'per day' : 'fixed'}</span>
              </div>

              <div className="space-y-1.5 mb-4">
                <p className="text-[10px] text-[#5C5E72] flex items-center gap-1.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  Expires in {settings.expiryHours} hours
                </p>
                <p className="text-[10px] text-[#5C5E72] flex items-center gap-1.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {settings.refundPolicy}
                </p>
              </div>

              <button
                onClick={handlePayReservation}
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing...</>
                ) : (
                  <>Pay ₦{fee.toLocaleString()} Reservation Fee</>
                )}
              </button>
            </div>

            {/* What happens next */}
            <div className="p-4 rounded-2xl bg-[#12121A] border border-[#2A2A3A]">
              <p className="text-xs font-semibold text-white mb-2">What happens next?</p>
              <ol className="space-y-2">
                <li className="flex items-start gap-2 text-[10px] text-[#8B8DA0]">
                  <span className="w-4 h-4 rounded-full bg-[#3B82F6]/10 flex items-center justify-center text-[8px] text-[#3B82F6] font-bold flex-shrink-0 mt-0.5">1</span>
                  Pay the reservation fee to reserve this room
                </li>
                <li className="flex items-start gap-2 text-[10px] text-[#8B8DA0]">
                  <span className="w-4 h-4 rounded-full bg-[#3B82F6]/10 flex items-center justify-center text-[8px] text-[#3B82F6] font-bold flex-shrink-0 mt-0.5">2</span>
                  Your reservation is confirmed
                </li>
                <li className="flex items-start gap-2 text-[10px] text-[#8B8DA0]">
                  <span className="w-4 h-4 rounded-full bg-[#3B82F6]/10 flex items-center justify-center text-[8px] text-[#3B82F6] font-bold flex-shrink-0 mt-0.5">3</span>
                  Proceed with booking — select dates and pay accommodation fee
                </li>
              </ol>
            </div>
          </>
        ) : (
          <>
            {/* Reservation Confirmed */}
            <div className="glass rounded-2xl p-4 border border-emerald-500/20 bg-emerald-500/5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Reservation Confirmed</p>
                  <p className="text-[10px] text-[#5C5E72]">Your room is reserved</p>
                </div>
              </div>

              <div className="space-y-1.5 mb-4">
                <p className="text-[10px] text-[#8B8DA0] flex justify-between">
                  <span>Reservation Fee Paid</span>
                  <span className="text-white font-medium">₦{fee.toLocaleString()}</span>
                </p>
                <p className="text-[10px] text-[#8B8DA0] flex justify-between">
                  <span>Status</span>
                  <span className="text-emerald-400 font-medium">Confirmed</span>
                </p>
                <p className="text-[10px] text-[#8B8DA0] flex justify-between">
                  <span>Expires</span>
                  <span className="text-white font-medium">{settings.expiryHours} hours</span>
                </p>
              </div>

              <button
                onClick={() => onProceedToBooking(hotelId, roomId)}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                Proceed with Booking
              </button>
            </div>

            {/* Reservation details */}
            <div className="p-4 rounded-2xl bg-[#12121A] border border-[#2A2A3A]">
              <p className="text-xs font-semibold text-white mb-2">Reservation Details</p>
              <p className="text-[10px] text-[#5C5E72]">
                Your reservation fee of ₦{fee.toLocaleString()} will be applied to your final booking.
                If you do not complete your booking within {settings.expiryHours} hours, the reservation will expire.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
