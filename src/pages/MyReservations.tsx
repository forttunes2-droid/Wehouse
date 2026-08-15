import { useEffect, useMemo, useState } from 'react';
import {
  cancelReservation,
  getReservationsForUser,
  initializeReservationPayment,
} from '@/lib/supabase/reservations';
import { getHotelBookingsForUser, updateBookingStatus } from '@/lib/supabase/hotels';
import type { Profile } from '@/types';
import { toast, Toaster } from 'sonner';

type Props = { profile: Profile; onBack: () => void };
type View = 'all' | 'housing' | 'hotels';

const HOUSING_STATUS: Record<string, { label: string; cls: string }> = {
  payment_pending: { label: 'Payment pending', cls: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  reserved: { label: 'Reserved', cls: 'border-blue-500/20 bg-blue-500/10 text-blue-300' },
  inspection_pending: { label: 'Inspection', cls: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' },
  ready_for_move_in: { label: 'Ready for move-in', cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  occupied: { label: 'Occupied', cls: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
  completed: { label: 'Completed', cls: 'border-white/10 bg-white/[.04] text-[#9AA0AE]' },
  cancelled: { label: 'Cancelled', cls: 'border-red-500/20 bg-red-500/10 text-red-300' },
  expired: { label: 'Expired', cls: 'border-orange-500/20 bg-orange-500/10 text-orange-300' },
  refunded: { label: 'Refunded', cls: 'border-purple-500/20 bg-purple-500/10 text-purple-300' },
  payment_conflict: { label: 'Payment review', cls: 'border-red-500/20 bg-red-500/10 text-red-300' },
};

const HOTEL_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  confirmed: { label: 'Confirmed', cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  checked_in: { label: 'Checked in', cls: 'border-blue-500/20 bg-blue-500/10 text-blue-300' },
  checked_out: { label: 'Checked out', cls: 'border-white/10 bg-white/[.04] text-[#9AA0AE]' },
  completed: { label: 'Completed', cls: 'border-white/10 bg-white/[.04] text-[#9AA0AE]' },
  cancelled: { label: 'Cancelled', cls: 'border-red-500/20 bg-red-500/10 text-red-300' },
  refunded: { label: 'Refunded', cls: 'border-purple-500/20 bg-purple-500/10 text-purple-300' },
};

export default function MyReservations({ profile, onBack }: Props) {
  const [housing, setHousing] = useState<any[]>([]);
  const [hotels, setHotels] = useState<any[]>([]);
  const [view, setView] = useState<View>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [housingResult, hotelResult] = await Promise.all([
      getReservationsForUser(profile.user_id),
      getHotelBookingsForUser(profile.user_id),
    ]);
    if (housingResult.error) toast.error(housingResult.error.message);
    setHousing(housingResult.reservations || []);
    setHotels(hotelResult.bookings || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [profile.user_id]);

  const rows = useMemo(() => {
    const housingRows = housing.map(row => ({ kind: 'housing' as const, row, date: row.created_at || '' }));
    const hotelRows = hotels.map(row => ({ kind: 'hotel' as const, row, date: row.created_at || '' }));
    return [...housingRows, ...hotelRows]
      .filter(item => view === 'all' || (view === 'housing' ? item.kind === 'housing' : item.kind === 'hotel'))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [housing, hotels, view]);

  async function continueHousingPayment(row: any) {
    const reference = String(row.payment_reference || '');
    if (!reference) return toast.error('Payment reference is missing');
    setBusyId(row.id);
    try {
      const { result, error } = await initializeReservationPayment(reference);
      if (error) throw error;
      if (result?.already_paid) {
        toast.success('Payment is already confirmed');
        await load();
        return;
      }
      if (!result?.success || !result.authorization_url) throw new Error(result?.error || 'Could not open Paystack');
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || 'Could not continue payment');
      setBusyId(null);
    }
  }

  async function cancelHousing(row: any) {
    if (!confirm('Cancel this unpaid property reservation?')) return;
    setBusyId(row.id);
    const { error } = await cancelReservation(row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success('Reservation cancelled and property released');
    await load();
  }

  async function cancelHotel(row: any) {
    if (!confirm('Cancel this hotel reservation?')) return;
    const id = Number(row.booking_id);
    setBusyId(`hotel-${id}`);
    const { error } = await updateBookingStatus(id, 'cancelled');
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success('Hotel reservation cancelled');
    await load();
  }

  function housingSupport(row: any) {
    window.dispatchEvent(new CustomEvent('openSupportChat', {
      detail: {
        category: row.status === 'payment_pending' ? 'payment' : 'apartment_booking',
        subject: `Housing reservation · ${row.listing_title || 'Property'}`,
        contextType: 'apartment_reservation',
        contextId: row.id,
        contextSnapshot: {
          reservation_id: row.id,
          listing_id: row.listing_id,
          listing_title: row.listing_title,
          status: row.status,
          payment_reference: row.payment_reference,
          rental_plan_years: row.rental_plan_years,
          tenancy_start_date: row.tenancy_start_date,
          tenancy_end_date: row.tenancy_end_date,
        },
      },
    }));
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-8 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#0A0A0F]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[.07] bg-white/[.04] text-[#8A8B9C]">←</button>
          <div className="min-w-0 flex-1"><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-blue-300">WEHOUSE STAYS</p><h1 className="text-base font-bold">My reservations</h1></div>
          <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[9px] text-[#7D8291]">{housing.length + hotels.length} total</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <section className="grid grid-cols-3 gap-2">
          <Metric label="Housing" value={housing.filter(row => !['completed', 'cancelled', 'expired', 'refunded'].includes(row.status)).length} />
          <Metric label="Hotels" value={hotels.filter(row => !['completed', 'checked_out', 'cancelled', 'refunded'].includes(row.status)).length} />
          <Metric label="Occupied" value={housing.filter(row => row.status === 'occupied').length} />
        </section>

        <div className="flex gap-1 rounded-xl border border-white/[.06] bg-[#10131A] p-1">
          {([['all', 'All'], ['housing', 'Housing'], ['hotels', 'Hotels']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} className={`flex-1 rounded-lg px-3 py-2 text-[10px] font-semibold ${view === id ? 'bg-blue-500 text-white' : 'text-[#74798A]'}`}>{label}</button>
          ))}
        </div>

        {loading ? <Loading /> : rows.length === 0 ? <Empty onBack={onBack} /> : (
          <div className="space-y-3">
            {rows.map(item => item.kind === 'housing'
              ? <HousingCard key={`housing-${item.row.id}`} row={item.row} busy={busyId === item.row.id} onPay={() => void continueHousingPayment(item.row)} onCancel={() => void cancelHousing(item.row)} onSupport={() => housingSupport(item.row)} />
              : <HotelCard key={`hotel-${item.row.booking_id}`} row={item.row} busy={busyId === `hotel-${item.row.booking_id}`} onCancel={() => void cancelHotel(item.row)} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function HousingCard({ row, busy, onPay, onCancel, onSupport }: { row: any; busy: boolean; onPay: () => void; onCancel: () => void; onSupport: () => void }) {
  const state = HOUSING_STATUS[row.status] || { label: String(row.status || 'Unknown').replace(/_/g, ' '), cls: 'border-white/10 bg-white/[.04] text-[#9AA0AE]' };
  return <article className="rounded-2xl border border-white/[.06] bg-[#12151D] p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wide text-blue-300">Housing</p><h2 className="mt-1 truncate text-sm font-semibold">{row.listing_title || 'Apartment reservation'}</h2><p className="mt-1 truncate text-[10px] text-[#676C7D]">{row.listing_location || 'WeHouse property'}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${state.cls}`}>{state.label}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2"><Info label="Reservation fee" value={`₦${Number(row.amount || 0).toLocaleString()}`} /><Info label="Tenure" value={`${row.rental_plan_years || 1} year${Number(row.rental_plan_years || 1) === 1 ? '' : 's'}`} /></div>
    {row.status === 'payment_pending' && <div className="mt-3 rounded-xl border border-amber-500/10 bg-amber-500/[.04] p-3"><p className="text-[10px] text-amber-200">Finish checkout to turn this temporary hold into a paid reservation.</p>{row.payment_expires_at && <p className="mt-1 text-[9px] text-[#8E7658]">Checkout expires {new Date(row.payment_expires_at).toLocaleString()}</p>}</div>}
    {row.hold_expires_at && ['reserved', 'inspection_pending', 'ready_for_move_in'].includes(row.status) && <p className="mt-3 text-[9px] text-amber-300">Reservation hold until {new Date(row.hold_expires_at).toLocaleString()}</p>}
    {row.status === 'occupied' && <div className="mt-3 rounded-xl border border-violet-500/10 bg-violet-500/[.04] p-3"><Row label="Move-in" value={date(row.tenancy_start_date)} /><Row label="Tenancy ends" value={date(row.tenancy_end_date)} /><Row label="Grace until" value={date(row.move_out_grace_until)} /></div>}
    {row.status === 'payment_conflict' && <p className="mt-3 rounded-xl border border-red-500/15 bg-red-500/[.05] p-3 text-[10px] text-red-200">Your payment requires WeHouse review because the property hold changed before fulfillment. No second occupancy is created automatically.</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      {row.status === 'payment_pending' && <button disabled={busy} onClick={onPay} className="h-10 flex-1 rounded-xl bg-blue-500 px-3 text-[10px] font-semibold disabled:opacity-50">{busy ? 'Opening…' : 'Continue payment'}</button>}
      {row.status === 'payment_pending' && <button disabled={busy} onClick={onCancel} className="h-10 rounded-xl border border-red-500/15 px-3 text-[10px] font-semibold text-red-300 disabled:opacity-50">Cancel</button>}
      <button onClick={onSupport} className="h-10 rounded-xl border border-white/[.08] px-3 text-[10px] font-semibold text-[#B2B6C2]">Support</button>
    </div>
  </article>;
}

function HotelCard({ row, busy, onCancel }: { row: any; busy: boolean; onCancel: () => void }) {
  const state = HOTEL_STATUS[row.status] || { label: String(row.status || 'Unknown').replace(/_/g, ' '), cls: 'border-white/10 bg-white/[.04] text-[#9AA0AE]' };
  const checkIn = row.check_in_date || row.check_in;
  const checkOut = row.check_out_date || row.check_out;
  const amount = row.total_amount ?? row.total_price ?? 0;
  return <article className="rounded-2xl border border-white/[.06] bg-[#12151D] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">Hotel</p><h2 className="mt-1 truncate text-sm font-semibold">{row.hotel?.name || row.hotel_name || 'Hotel reservation'}</h2><p className="mt-1 text-[10px] text-[#676C7D]">{row.room?.room_type || row.room_type || 'Room'}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${state.cls}`}>{state.label}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><Info label="Check-in" value={date(checkIn)} /><Info label="Check-out" value={date(checkOut)} /></div><div className="mt-3 flex items-center justify-between border-t border-white/[.05] pt-3"><span className="text-sm font-bold text-emerald-300">₦{Number(amount).toLocaleString()}</span>{row.status === 'pending' && <button disabled={busy} onClick={onCancel} className="rounded-xl border border-red-500/15 px-3 py-2 text-[9px] font-semibold text-red-300 disabled:opacity-50">{busy ? 'Cancelling…' : 'Cancel'}</button>}</div></article>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/[.06] bg-[#12151D] p-3"><p className="text-[8px] uppercase tracking-wide text-[#5E6474]">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[.025] p-3"><p className="text-[8px] uppercase text-[#5D6272]">{label}</p><p className="mt-1 truncate text-[10px] font-semibold text-[#C5C8D1]">{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="mt-1 flex justify-between gap-3 text-[9px]"><span className="text-[#777C8C]">{label}</span><span className="text-right font-semibold text-violet-200">{value}</span></div>; }
function date(value: any) { return value ? new Date(value).toLocaleDateString() : '—'; }
function Loading() { return <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>; }
function Empty({ onBack }: { onBack: () => void }) { return <div className="rounded-3xl border border-dashed border-white/[.08] px-5 py-14 text-center"><p className="text-sm font-semibold">No reservations yet</p><p className="mx-auto mt-2 max-w-xs text-[10px] leading-5 text-[#606575]">Housing and hotel reservations will stay together here with their current status instead of being split across different dashboards.</p><button onClick={onBack} className="mt-4 rounded-xl bg-blue-500 px-4 py-2.5 text-[10px] font-semibold">Back</button></div>; }
