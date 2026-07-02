import { useState, useEffect } from 'react';
import { getRoomById, createHotelBooking, getAllUsers, submitStaffReview } from '@/lib/supabase';
import type { HotelRoom, Hotel } from '@/types';
import { Toaster, toast } from 'sonner';

interface HotelBookingProps {
  hotelId: number;
  roomId: number;
  profile: { user_id: string; username: string | null; phone: string | null };
  onBack: () => void;
  onComplete: () => void;
}

// ─── STAR RATING COMPONENT ────────────────────────
function StarRating({ value, onChange, size = 24 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange?.(star)}
          onMouseEnter={() => onChange && setHover(star)}
          onMouseLeave={() => onChange && setHover(0)}
          className={onChange ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}
          disabled={!onChange}
        >
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={star <= (hover || value) ? '#F59E0B' : 'none'}
            stroke={star <= (hover || value) ? '#F59E0B' : '#5C5E72'}
            strokeWidth="2"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
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

  // Staff rating state
  const [showRating, setShowRating] = useState(false);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [rating, setRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

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

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

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

  // Load staff list for rating
  async function loadStaffList() {
    const { users } = await getAllUsers();
    const staffOnly = (users || []).filter((u: any) =>
      ['staff', 'admin', 'creator', 'creator_admin'].includes(u.role)
    );
    setStaffList(staffOnly);
  }

  async function handleSubmitReview() {
    if (!selectedStaff) { toast.error('Select a staff member'); return; }
    if (rating === 0) { toast.error('Select a star rating'); return; }

    setSubmittingReview(true);
    const { error } = await submitStaffReview(profile.user_id, selectedStaff, rating, reviewComment || undefined);
    setSubmittingReview(false);

    if (error) {
      toast.error('Failed to submit review');
      return;
    }
    setReviewSubmitted(true);
    toast.success('Review submitted!');
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

  // ─── RATING SCREEN ────────────────────────────
  if (showRating) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center px-5">
        <div className="w-full max-w-md">
          <div className="glass rounded-2xl p-6 border border-amber-500/10 text-center">
            {reviewSubmitted ? (
              <>
                <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                </div>
                <h2 className="text-lg font-bold text-white mb-1">Thank You!</h2>
                <p className="text-xs text-[#5C5E72] mb-5">Your review helps others trust our staff.</p>
                <button onClick={onComplete} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold">Done</button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-white mb-1">Rate Your Experience</h2>
                <p className="text-xs text-[#5C5E72] mb-5">How was the staff who handled your booking?</p>

                {/* Star rating */}
                <div className="flex justify-center mb-5">
                  <StarRating value={rating} onChange={setRating} size={36} />
                </div>

                {/* Staff selection */}
                <div className="text-left mb-4">
                  <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Select Staff Member</label>
                  <select
                    value={selectedStaff}
                    onChange={(e) => setSelectedStaff(e.target.value)}
                    onFocus={() => { if (staffList.length === 0) loadStaffList(); }}
                    className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-[#3B82F6]"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235C5E72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', appearance: 'none' }}
                  >
                    <option value="">Choose who helped you...</option>
                    {staffList.map((s) => (
                      <option key={s.user_id} value={s.user_id}>{s.full_name || s.username || s.email} ({s.role})</option>
                    ))}
                  </select>
                </div>

                {/* Comment */}
                <div className="text-left mb-5">
                  <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Comment (optional)</label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Share your experience..."
                    rows={3}
                    className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6] outline-none resize-none"
                  />
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setShowRating(false)} className="flex-1 h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:bg-[#232330]">Back</button>
                  <button
                    onClick={handleSubmitReview}
                    disabled={submittingReview || rating === 0 || !selectedStaff}
                    className="flex-1 h-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {submittingReview ? 'Submitting...' : 'Submit Review'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── BOOKING SUCCESS SCREEN ───────────────────
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
                <span className="text-sm font-bold text-green-400">N{bookingData.totalPrice.toLocaleString()}</span>
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

            {/* Rate staff button */}
            <button
              onClick={() => { setShowRating(true); if (staffList.length === 0) loadStaffList(); }}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity mb-3 flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              Rate Your Experience
            </button>

            <button
              onClick={onComplete}
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:bg-[#232330] transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── BOOKING FORM ─────────────────────────────
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
          <p className="text-[10px] text-[#5C5E72]">{room.hotels.name} &middot; {room.room_type}</p>
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
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{room.room_type}</p>
              <p className="text-xs text-[#5C5E72]">{room.hotels.name}</p>
              <p className="text-xs text-[#3B82F6] font-medium mt-0.5">N{room.price_per_night.toLocaleString()}/night</p>
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Check-in</label>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              min={tomorrowStr}
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-[#3B82F6] [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Check-out</label>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              min={getMinCheckOut()}
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-[#3B82F6] [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Guest count */}
        <div>
          <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Guests</label>
          <select
            value={guestCount}
            onChange={(e) => setGuestCount(Number(e.target.value))}
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-[#3B82F6]"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235C5E72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', appearance: 'none' }}
          >
            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>)}
          </select>
        </div>

        {/* Guest details */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Full Name</label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Your full name"
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] outline-none focus:border-[#3B82F6]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Phone Number</label>
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="e.g. 08012345678"
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] outline-none focus:border-[#3B82F6]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">Special Requests (optional)</label>
            <textarea
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              placeholder="Any special requirements..."
              rows={3}
              className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] outline-none focus:border-[#3B82F6] resize-none"
            />
          </div>
        </div>

        {/* Price summary */}
        {totals && (
          <div className="p-4 rounded-xl bg-[#1A1A24] border border-[#2A2A3A]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-[#5C5E72]">{room.price_per_night.toLocaleString()} x {totals.nights} nights</span>
              <span className="text-sm text-white">N{totals.total.toLocaleString()}</span>
            </div>
            <div className="border-t border-[#2A2A3A] pt-2 flex justify-between items-center">
              <span className="text-sm font-semibold text-white">Total</span>
              <span className="text-lg font-bold text-green-400">N{totals.total.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Book button */}
        <button
          onClick={handleBook}
          disabled={submitting || !totals}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {submitting ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              Confirm Booking
            </>
          )}
        </button>

        <p className="text-[10px] text-[#5C5E72] text-center">No payment required now. Pay at check-in.</p>
      </div>
    </div>
  );
}
