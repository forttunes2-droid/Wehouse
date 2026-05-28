import { useState, useEffect } from 'react';
import { getRoomById, createHotelBooking } from '@/lib/supabase';
import type { HotelRoom, Hotel } from '@/types';
import { Toaster, toast } from 'sonner';

interface HotelBookingProps {
  hotelId: number;
  roomId: number;
  profile: { user_id: string; username: string | null; phone: string | null };
  onBack: () => void;
  onComplete: () => void;
}

export default function HotelBooking({ hotelId, roomId, profile, onBack, onComplete }: HotelBookingProps) {
  const [room, setRoom] = useState<(HotelRoom & { hotels: Hotel }) | null>(null);
  const [loading, setLoading] = useState(true);

  // Booking form
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guestCount, setGuestCount] = useState(1);
  const [guestName, setGuestName] = useState(profile.username || '');
  const [guestPhone, setGuestPhone] = useState(profile.phone || '');
  const [specialRequests, setSpecialRequests] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingData, setBookingData] = useState<{ totalNights: number; totalPrice: number; checkIn: string; checkOut: string } | null>(null);

  useEffect(() => {
    loadRoom();
  }, [roomId]);

  async function loadRoom() {
    setLoading(true);
    const { room: r, error } = await getRoomById(roomId);
    if (error || !r) {
      toast.error('Failed to load room');
      setLoading(false);
      return;
    }
    setRoom(r);
    setLoading(false);
  }

  // Calculate nights and total
  const calculateTotals = () => {
    if (!checkIn || !checkOut || !room) return null;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffTime = end.getTime() - start.getTime();
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (nights <= 0) return null;
    const total = nights * room.price_per_night;
    return { nights, total };
  };

  const totals = calculateTotals();

  // Get tomorrow's date for min check-in
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Get min check-out (day after check-in)
  const getMinCheckOut = () => {
    if (!checkIn) return tomorrowStr;
    const dayAfter = new Date(checkIn);
    dayAfter.setDate(dayAfter.getDate() + 1);
    return dayAfter.toISOString().split('T')[0];
  };

  async function handleBook() {
    if (!room || !totals) return;
    if (!checkIn || !checkOut) { toast.error('Select check-in and check-out dates'); return; }
    if (!guestName.trim()) { toast.error('Guest name is required'); return; }
    if (!guestPhone.trim()) { toast.error('Phone number is required'); return; }

    setSubmitting(true);
    const { booking, error } = await createHotelBooking({
      hotel_id: hotelId,
      room_id: roomId,
      user_id: profile.user_id,
      check_in: checkIn,
      check_out: checkOut,
      guest_count: guestCount,
      total_nights: totals.nights,
      total_price: totals.total,
      status: 'pending',
      guest_name: guestName.trim(),
      guest_phone: guestPhone.trim(),
      special_requests: specialRequests.trim() || null,
    });
    setSubmitting(false);

    if (error || !booking) {
      toast.error('Booking failed: ' + (error?.message || 'Unknown'));
      return;
    }

    setBookingData({
      totalNights: totals.nights,
      totalPrice: totals.total,
      checkIn,
      checkOut,
    });
    setBookingComplete(true);
    toast.success('Booking created!');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#5C5E72]">Room not found</p>
        <button onClick={onBack} className="text-xs text-[#3B82F6]">Go back</button>
      </div>
    );
  }

  // Booking success screen
  if (bookingComplete && bookingData) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center px-5">
        <div className="w-full max-w-md">
          <div className="glass rounded-2xl p-6 border border-green-500/10 text-center">
            {/* Success icon */}
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-1">Booking Confirmed!</h2>
            <p className="text-xs text-[#5C5E72] mb-5">Your reservation has been created</p>

            {/* Booking summary */}
            <div className="p-4 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] mb-5 text-left space-y-2.5">
              <div className="flex justify-between">
                <span className="text-[10px] text-[#5C5E72]">Hotel</span>
                <span className="text-xs text-white font-medium">{room.hotels.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#5C5E72]">Room</span>
                <span className="text-xs text-white font-medium">{room.room_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#5C5E72]">Check-in</span>
                <span className="text-xs text-white">{new Date(bookingData.checkIn).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#5C5E72]">Check-out</span>
                <span className="text-xs text-white">{new Date(bookingData.checkOut).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#5C5E72]">Nights</span>
                <span className="text-xs text-white">{bookingData.totalNights}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-[#5C5E72]">Guests</span>
                <span className="text-xs text-white">{guestCount}</span>
              </div>
              <div className="border-t border-[#2A2A3A] pt-2 flex justify-between">
                <span className="text-xs text-[#5C5E72] font-medium">Total</span>
                <span className="text-sm font-bold text-green-400">₦{bookingData.totalPrice.toLocaleString()}</span>
              </div>
            </div>

            {/* Next steps */}
            <div className="space-y-2 mb-5 text-left">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                <span className="text-xs font-bold text-[#3B82F6] flex-shrink-0">1</span>
                <p className="text-xs text-[#8A8B9C]">Hotel will confirm your booking within 24 hours</p>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                <span className="text-xs font-bold text-[#3B82F6] flex-shrink-0">2</span>
                <p className="text-xs text-[#8A8B9C]">Pay at the hotel during check-in (no online payment needed)</p>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                <span className="text-xs font-bold text-[#3B82F6] flex-shrink-0">3</span>
                <p className="text-xs text-[#8A8B9C]">Bring your ID and this booking confirmation</p>
              </div>
            </div>

            <button
              onClick={onComplete}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-6">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h1 className="text-base font-semibold">Book Room</h1>
          <p className="text-[10px] text-[#5C5E72]">{room.hotels.name} · {room.room_type}</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Room summary */}
        <div className="glass rounded-2xl p-4 border border-[#2A2A3A]">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-[#1A1A24] flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{room.room_type}</h3>
              <p className="text-xs text-[#3B82F6] font-bold">₦{room.price_per_night.toLocaleString()}<span className="text-[10px] text-[#5C5E72] font-normal">/night</span></p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-[#5C5E72]">{room.max_guests} max guests</span>
                {room.bed_type && <span className="text-[10px] text-[#5C5E72]">· {room.bed_type} bed</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Date Selection */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-white">Select Dates</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Check-in</label>
              <input
                type="date"
                value={checkIn}
                min={tomorrowStr}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  // Reset check-out if it's before new check-in
                  if (checkOut && e.target.value >= checkOut) setCheckOut('');
                }}
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Check-out</label>
              <input
                type="date"
                value={checkOut}
                min={getMinCheckOut()}
                onChange={(e) => setCheckOut(e.target.value)}
                disabled={!checkIn}
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 focus:border-[#3B82F6]/50 outline-none disabled:opacity-40"
              />
            </div>
          </div>
        </div>

        {/* Guest Count */}
        <div>
          <label className="text-xs font-semibold text-white mb-2 block">Number of Guests</label>
          <div className="flex gap-2">
            {Array.from({ length: Math.min(room.max_guests, 6) }).map((_, i) => (
              <button
                key={i + 1}
                onClick={() => setGuestCount(i + 1)}
                className={`w-10 h-10 rounded-xl text-sm font-bold transition-all ${
                  guestCount === i + 1
                    ? 'bg-[#3B82F6] text-white'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#5C5E72] hover:border-[#3B82F6]/30'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-[#5C5E72] mt-1.5">Max {room.max_guests} guest{room.max_guests !== 1 ? 's' : ''} for this room</p>
        </div>

        {/* Guest Details */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-white">Guest Details</h3>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Full Name *</label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Your full name"
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Phone Number *</label>
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="e.g. 08012345678"
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Special Requests (optional)</label>
            <textarea
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              placeholder="Any special requests..."
              rows={2}
              className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-3 py-2 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none"
            />
          </div>
        </div>

        {/* Price Summary */}
        {totals && (
          <div className="glass rounded-2xl p-4 border border-[#3B82F6]/10">
            <h3 className="text-xs font-semibold text-white mb-3">Price Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-[#5C5E72]">₦{room.price_per_night.toLocaleString()} × {totals.nights} night{totals.nights !== 1 ? 's' : ''}</span>
                <span className="text-xs text-white">₦{totals.total.toLocaleString()}</span>
              </div>
              <div className="border-t border-[#2A2A3A] pt-2 flex justify-between">
                <span className="text-sm font-bold text-white">Total</span>
                <span className="text-lg font-bold text-[#3B82F6]">₦{totals.total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {/* Book Button */}
        <button
          onClick={handleBook}
          disabled={submitting || !totals}
          className="w-full h-13 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40 py-3.5 flex items-center justify-center gap-2"
        >
          {submitting ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              {totals ? `Book Now — ₦${totals.total.toLocaleString()}` : 'Select dates to book'}
            </>
          )}
        </button>

        <p className="text-[9px] text-[#5C5E72] text-center">
          No online payment required. Pay at the hotel during check-in.
        </p>
      </div>
    </div>
  );
}
