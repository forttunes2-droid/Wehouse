import { useState, useEffect } from 'react';
import { getHotelBookingsForUser, updateBookingStatus } from '@/lib/supabase/hotels';
import type { Profile } from '@/types';
import type { HotelBooking } from '@/types';
import { toast, Toaster } from 'sonner';

interface MyReservationsProps {
  profile: Profile;
  onBack: () => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  confirmed: { label: 'Confirmed', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  checked_in: { label: 'Checked In', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  checked_out: { label: 'Checked Out', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  refunded: { label: 'Refunded', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
};

export default function MyReservations({ profile, onBack }: MyReservationsProps) {
  const [bookings, setBookings] = useState<HotelBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadBookings();
  }, [profile.user_id]);

  async function loadBookings() {
    setLoading(true);
    const { bookings: data } = await getHotelBookingsForUser(profile.user_id);
    setBookings(data || []);
    setLoading(false);
  }

  async function handleCancel(bookingId: number) {
    if (!confirm('Cancel this reservation?')) return;
    const { error } = await updateBookingStatus(bookingId, 'cancelled');
    if (error) {
      toast.error('Failed to cancel: ' + error.message);
      return;
    }
    toast.success('Reservation cancelled');
    loadBookings();
  }

  const filtered = filter === 'all'
    ? bookings
    : filter === 'active'
      ? bookings.filter(b => ['pending', 'confirmed', 'checked_in'].includes(b.status))
      : bookings.filter(b => ['cancelled', 'checked_out', 'refunded'].includes(b.status));

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0F]/90 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-base font-bold text-white">My Reservations</h1>
            <p className="text-[10px] text-[#5C5E72]">{bookings.length} reservation{bookings.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'past', label: 'Past' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors ${
                filter === f.key ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#12121A] text-[#5C5E72] hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Reservations List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/10 to-[#7C3AED]/10 flex items-center justify-center mx-auto">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
                <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
                <path d="m2 20h20" />
                <path d="M12 11v-6" />
                <path d="M9 11v-2" />
                <path d="M15 11v-2" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white">No reservations yet</p>
            <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">Book a hotel room from the Hotels tab to see your reservations here.</p>
            <button onClick={onBack} className="h-10 px-6 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white text-xs font-semibold">
              Browse Hotels
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b: any) => {
              const statusInfo = STATUS_LABELS[b.status] || { label: b.status, color: 'bg-gray-500/10 text-gray-400' };
              return (
                <div key={b.booking_id} className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    <span className="text-[9px] text-[#5C5E72]">#{b.booking_code || b.booking_id}</span>
                  </div>

                  <h3 className="text-sm font-semibold text-white">{b.hotel?.name || 'Hotel'}</h3>
                  <p className="text-[10px] text-[#8A8B9C] mt-0.5">{b.room?.room_type || 'Room'}</p>

                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                      Check-in: {b.check_in_date ? new Date(b.check_in_date).toLocaleDateString() : '—'}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                      Check-out: {b.check_out_date ? new Date(b.check_out_date).toLocaleDateString() : '—'}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[#5C5E72]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      {b.num_guests} guest{b.num_guests !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1E1E2C]">
                    <span className="text-sm font-bold text-emerald-400">₦{b.total_amount?.toLocaleString()}</span>
                    <span className="text-[9px] text-[#5C5E72]">{b.nights} night{b.nights !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Cancel button for pending bookings */}
                  {b.status === 'pending' && (
                    <button
                      onClick={() => handleCancel(b.booking_id)}
                      className="mt-2 w-full h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors"
                    >
                      Cancel Reservation
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
