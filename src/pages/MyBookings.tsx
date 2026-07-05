import { useState, useEffect } from 'react';
import { getMyBookingConversations, BOOKING_STATUS_LABELS } from '@/lib/supabase/worker-bookings';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import type { Profile } from '@/types';

interface MyBookingsProps {
  profile: Profile;
  onBack: () => void;
}

export default function MyBookings({ profile, onBack }: MyBookingsProps) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChat, setActiveChat] = useState<{ conversationId: string; bookingId: string } | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadConversations();
  }, [profile.user_id]);

  async function loadConversations() {
    setLoading(true);
    const { conversations: convs } = await getMyBookingConversations(profile.user_id);
    setConversations(convs || []);
    setLoading(false);
  }

  const filtered = filter === 'all'
    ? conversations
    : conversations.filter((c: any) => c.booking_status === filter);

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'booking_requested', label: 'Pending' },
    { key: 'negotiating', label: 'Negotiating' },
    { key: 'waiting_payment', label: 'Pay' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'in_progress', label: 'Active' },
    { key: 'completed_pending_approval', label: 'Done' },
    { key: 'approved_released', label: 'Paid' },
  ];

  // Open negotiation chat inline
  if (activeChat) {
    return (
      <BookingNegotiationChat
        conversationId={activeChat.conversationId}
        bookingId={activeChat.bookingId}
        profile={profile}
        isWorker={false}
        onClose={() => { setActiveChat(null); loadConversations(); }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0F]/90 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-base font-bold text-white">My Bookings</h1>
            <p className="text-[10px] text-[#5C5E72]">{conversations.length} booking{conversations.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {filters.map(f => (
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

        {/* Conversations List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3B82F6]/10 to-[#2563EB]/10 flex items-center justify-center mx-auto">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <path d="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white">No bookings yet</p>
            <p className="text-[11px] text-[#5C5E72] max-w-xs mx-auto">Book a worker from the Workers tab to start a job request.</p>
            <button onClick={onBack} className="h-10 px-6 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-xs font-semibold">
              Find Workers
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(conv => {
              const statusInfo = BOOKING_STATUS_LABELS[conv.booking_status] || null;
              return (
                <button
                  key={conv.conversation_id}
                  onClick={() => setActiveChat({ conversationId: conv.conversation_id, bookingId: conv.booking_id })}
                  className="w-full text-left bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3 hover:border-[#3B82F6]/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#5C5E72]">#{conv.booking_code}</span>
                      {conv.unread_count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[8px] text-white font-bold">{conv.unread_count}</span>
                      )}
                    </div>
                    {statusInfo && (
                      <span className={`text-[8px] px-2 py-0.5 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
                    )}
                  </div>
                  <p className="text-xs text-white font-medium">{conv.service_type}</p>
                  <p className="text-[10px] text-[#5C5E72] mt-0.5">{conv.other_person_name}</p>
                  {conv.last_message && (
                    <p className="text-[10px] text-[#8A8B9C] mt-1 truncate">{conv.last_message}</p>
                  )}
                  {conv.negotiated_amount > 0 && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#1E1E2C]">
                      <span className="text-xs text-emerald-400 font-medium">₦{conv.negotiated_amount?.toLocaleString()}</span>
                      <span className="text-[9px] text-[#5C5E72]">{new Date(conv.updated_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
