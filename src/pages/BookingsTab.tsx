import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function BookingsTab() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBookings();
  }, []);

  async function loadBookings() {
    setLoading(true);
    const { data, error } = await supabase
      .from('worker_bookings')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data) {
      setBookings(data);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-[#5C5E72]">No bookings found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">All Bookings</h3>
        <span className="text-[10px] text-[#5C5E72]">{bookings.length} total</span>
      </div>
      {bookings.map(b => (
        <div key={b.id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white">{b.service_type || 'Booking'}</p>
              <p className="text-[10px] text-[#5C5E72]">Code: {b.booking_code}</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              b.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
              b.status === 'cancelled' ? 'bg-red-500/10 text-red-400' :
              'bg-amber-500/10 text-amber-400'
            }`}>{b.status}</span>
          </div>
          <p className="text-[10px] text-[#5C5E72] mt-1">Amount: N{b.negotiated_amount || b.agreed_amount || 0}</p>
        </div>
      ))}
    </div>
  );
}
