import { useState, useEffect, useRef } from 'react';
import {
  getBookingMessages, sendBookingMessage,
  uploadBookingChatImage,
  workerAcceptBooking, workerStartJob, workerMarkComplete,
  customerConfirmCompletion, customerRaiseDispute, cancelBooking, getBookingDetails,
} from '@/lib/supabase/worker-bookings';
import { BOOKING_STATUS_LABELS } from '@/lib/supabase/worker-bookings';
import type { Profile } from '@/types';
import { toast } from 'sonner';

interface Props {
  conversationId: string;
  bookingId: string;
  profile: Profile;
  isWorker: boolean;
  onClose: () => void;
}

export default function BookingNegotiationChat({ conversationId, bookingId, profile, isWorker, onClose }: Props) {
  const [messages, setMessages] = useState<any[]>([]);
  const [booking, setBooking] = useState<any>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [acceptAmount, setAcceptAmount] = useState('');
  const [acceptDate, setAcceptDate] = useState('');
  const [showAcceptForm, setShowAcceptForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadAll(); }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadAll() {
    const [msgRes, bookingRes] = await Promise.all([
      getBookingMessages(conversationId),
      getBookingDetails(bookingId),
    ]);
    setMessages(msgRes.messages || []);
    setBooking(bookingRes.booking);
    setLoading(false);
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    await sendBookingMessage(conversationId, profile.user_id, input.trim());
    setInput('');
    setSending(false);
    loadAll();
  }

  async function handleWorkerAccept() {
    const amount = parseInt(acceptAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    if (!acceptDate) { toast.error('Pick a schedule date'); return; }
    const { success, error } = await workerAcceptBooking(bookingId, profile.user_id, amount, acceptDate);
    if (error || !success) { toast.error('Failed: ' + (error?.message || 'unknown')); return; }
    toast.success('Booking accepted! Customer will now pay.');
    setShowAcceptForm(false);
    loadAll();
  }

  async function handleWorkerStart() {
    const { success, error } = await workerStartJob(bookingId, profile.user_id);
    if (error || !success) { toast.error('Failed'); return; }
    toast.success('Job started!');
    loadAll();
  }

  async function handleWorkerComplete() {
    const { success, error } = await workerMarkComplete(bookingId, profile.user_id);
    if (error || !success) { toast.error('Failed'); return; }
    toast.success('Marked as complete. Waiting for customer confirmation.');
    loadAll();
  }

  async function handleCustomerConfirm() {
    const { success, error } = await customerConfirmCompletion(bookingId, profile.user_id);
    if (error || !success) { toast.error('Failed'); return; }
    toast.success('Job confirmed! Payment released to worker.');
    loadAll();
  }

  async function handleCustomerDispute() {
    if (!disputeReason.trim()) { toast.error('Enter a reason'); return; }
    const { success, error } = await customerRaiseDispute(bookingId, profile.user_id, disputeReason);
    if (error || !success) { toast.error('Failed'); return; }
    toast.success('Dispute raised. WeHouse will review.');
    setShowDisputeForm(false);
    loadAll();
  }

  async function handleCancel() {
    if (!cancelReason.trim()) { toast.error('Enter a reason'); return; }
    const { success, error } = await cancelBooking(bookingId, profile.user_id, cancelReason);
    if (error || !success) { toast.error('Failed'); return; }
    toast.success('Booking cancelled');
    setShowCancelForm(false);
    loadAll();
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    toast.loading('Uploading photo...', { id: 'photo-upload' });
    const { url, error } = await uploadBookingChatImage(file, conversationId);
    if (error || !url) {
      toast.dismiss('photo-upload');
      toast.error('Upload failed: ' + (error?.message || 'Unknown error'));
      setSending(false);
      e.target.value = '';
      return;
    }
    // Send image URL as message content
    const { error: sendErr } = await sendBookingMessage(conversationId, profile.user_id, url);
    toast.dismiss('photo-upload');
    setSending(false);
    e.target.value = '';
    if (sendErr) {
      toast.error('Failed to send photo');
      return;
    }
    loadAll();
  }

  // Detect if a message content is an image URL
  function isImageUrl(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    return content.startsWith('http') && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(content);
  }

  const statusInfo = booking?.status ? BOOKING_STATUS_LABELS[booking.status] : null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0F] flex flex-col" style={{ height: '100dvh' }}>
      {/* ═══ HEADER ═══ */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-[#5C5E72] hover:text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">
                {isWorker
                  ? (booking?.customer_username ? `@${booking.customer_username}` : booking?.user_name || 'Customer')
                  : booking?.worker_name}
              </p>
              {statusInfo && (
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
              )}
            </div>
            <p className="text-[10px] text-[#5C5E72]">{booking?.service_type} &middot; #{booking?.booking_code}</p>
          </div>
        </div>

        {/* ═══ BOOKING STATUS BAR ═══ */}
        {booking && (
          <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Booking Status</p>
              {booking.negotiated_amount > 0 && (
                <p className="text-xs font-bold text-white">N{booking.negotiated_amount?.toLocaleString()}</p>
              )}
            </div>
            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] rounded-full transition-all" style={{ width: getProgressWidth(booking.status) }} />
            </div>
            <p className="text-[10px] text-[#5C5E72] mt-1">{statusInfo?.description}</p>

            {/* Worker Guide — simple 3-step flow */}
            {isWorker && booking.status === 'booking_requested' && (
              <div className="mt-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500/10 space-y-1">
                <p className="text-[9px] text-blue-400 font-semibold">How to confirm:</p>
                <div className="flex items-center gap-1.5 text-[9px] text-[#5C5E72]">
                  <span className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[8px] font-bold flex-shrink-0">1</span>
                  Tap "Accept Booking" below
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-[#5C5E72]">
                  <span className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[8px] font-bold flex-shrink-0">2</span>
                  Enter your price + pick a date
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-[#5C5E72]">
                  <span className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[8px] font-bold flex-shrink-0">3</span>
                  Customer pays, then you start the job
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isWorker && booking.status === 'booking_requested' && (
                <button onClick={() => setShowAcceptForm(!showAcceptForm)} className="h-7 px-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">Accept Booking</button>
              )}
              {isWorker && booking.status === 'confirmed' && (
                <button onClick={handleWorkerStart} className="h-7 px-3 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-semibold">Start Job</button>
              )}
              {isWorker && booking.status === 'in_progress' && (
                <button onClick={handleWorkerComplete} className="h-7 px-3 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[10px] font-semibold">Mark Complete</button>
              )}

              {!isWorker && booking.status === 'waiting_payment' && (
                <button onClick={() => toast.info('Paystack payment coming soon')} className="h-7 px-3 rounded-lg bg-emerald-500 text-white text-[10px] font-semibold">Pay N{booking.negotiated_amount?.toLocaleString()}</button>
              )}
              {!isWorker && booking.status === 'completed_pending_approval' && (
                <>
                  <button onClick={handleCustomerConfirm} className="h-7 px-3 rounded-lg bg-emerald-500 text-white text-[10px] font-semibold">Confirm Completion</button>
                  <button onClick={() => setShowDisputeForm(!showDisputeForm)} className="h-7 px-3 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-semibold">Raise Dispute</button>
                </>
              )}

              {['booking_requested', 'negotiating', 'waiting_payment'].includes(booking.status) && (
                <button onClick={() => setShowCancelForm(!showCancelForm)} className="h-7 px-3 rounded-lg bg-white/[0.03] text-[#5C5E72] text-[10px]">Cancel</button>
              )}
            </div>

            {/* Worker Accept Form with Price + Schedule Date */}
            {showAcceptForm && (
              <div className="mt-2 p-2 rounded-lg bg-white/[0.03] border border-emerald-500/20 space-y-2">
                <input type="text" inputMode="numeric" value={acceptAmount} onChange={e => setAcceptAmount(e.target.value)}
                  placeholder="Enter agreed price (NGN)" className="w-full h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 outline-none focus:border-emerald-500" />
                <input type="date" value={acceptDate} onChange={e => setAcceptDate(e.target.value)}
                  className="w-full h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 outline-none focus:border-emerald-500" />
                <p className="text-[9px] text-[#5C5E72]">Pick the date you and the customer agreed to meet</p>
                <button onClick={handleWorkerAccept} className="w-full h-8 rounded-lg bg-emerald-500 text-white text-[10px] font-semibold">Confirm & Accept</button>
              </div>
            )}

            {/* Dispute Form */}
            {showDisputeForm && (
              <div className="mt-2 p-2 rounded-lg bg-white/[0.03] border border-red-500/20 space-y-2">
                <textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)}
                  placeholder="Why are you disputing?" rows={2} className="w-full rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 outline-none focus:border-red-500 resize-none" />
                <button onClick={handleCustomerDispute} className="w-full h-8 rounded-lg bg-red-500 text-white text-[10px] font-semibold">Submit Dispute</button>
              </div>
            )}

            {/* Cancel Form */}
            {showCancelForm && (
              <div className="mt-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-2">
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  placeholder="Reason for cancellation" rows={2} className="w-full rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 outline-none focus:border-[#3B82F6] resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => setShowCancelForm(false)} className="flex-1 h-8 rounded-lg bg-white/[0.03] text-[#5C5E72] text-[10px]">Keep</button>
                  <button onClick={handleCancel} className="flex-1 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-semibold">Cancel Booking</button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* ═══ MESSAGES ═══ */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Booking Info Card */}
        {booking && (
          <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-3 space-y-1.5">
            <p className="text-[10px] text-blue-400 uppercase tracking-wider">Booking Details</p>
            {/* WHO booked — critical for worker */}
            {isWorker && booking?.customer_username && (
              <div className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                <p className="text-[11px] text-[#3B82F6] font-medium">Booked by @{booking.customer_username}</p>
              </div>
            )}
            <p className="text-xs text-white">{booking.description || 'No description'}</p>
            {booking.address && <p className="text-[10px] text-[#5C5E72]">{booking.address}</p>}
            {booking.scheduled_date && <p className="text-[10px] text-emerald-400">Scheduled: {new Date(booking.scheduled_date).toLocaleDateString()}</p>}
            {booking.negotiated_amount > 0 && <p className="text-[10px] text-emerald-400 font-medium">Agreed: ₦{booking.negotiated_amount?.toLocaleString()}</p>}
          </div>
        )}

        {messages.map(msg => {
          const isMe = msg.sender_id === profile.user_id;
          const isImage = isImageUrl(msg.content);
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl overflow-hidden ${isMe ? 'bg-[#3B82F6] text-white rounded-br-md' : 'bg-white/[0.05] text-white rounded-bl-md'} ${isImage ? 'p-1.5' : 'px-4 py-2.5'}`}>
                {!isMe && !isImage && <p className="text-[9px] text-[#5C5E72] mb-0.5">{msg.sender_name}</p>}
                {isImage ? (
                  <div className="space-y-1">
                    <img src={msg.content} alt="Shared" className="max-w-full rounded-xl cursor-pointer" onClick={() => window.open(msg.content, '_blank')} />
                    <p className={`text-[9px] px-1 ${isMe ? 'text-blue-200' : 'text-[#5C5E72]'}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed">{msg.content}</p>
                    <p className={`text-[9px] mt-1 ${isMe ? 'text-blue-200' : 'text-[#5C5E72]'}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ═══ INPUT — Fixed at bottom, always reachable ═══ */}
      <div className="flex-shrink-0 bg-[#12121A] border-t border-white/[0.06] px-4 pt-3 pb-6">
        {['booking_requested', 'negotiating', 'confirmed', 'in_progress', 'completed_pending_approval'].includes(booking?.status) ? (
          <div className="flex items-center gap-2">
            {/* Photo button */}
            <button onClick={() => fileInputRef.current?.click()} className="w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center text-[#5C5E72] hover:text-[#3B82F6] flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />

            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-[#3B82F6]"
            />
            <button onClick={handleSend} disabled={sending || !input.trim()}
              className="w-10 h-10 rounded-xl bg-[#3B82F6] flex items-center justify-center text-white disabled:opacity-40 transition-opacity flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </div>
        ) : (
          <p className="text-center text-[11px] text-[#5C5E72] py-2">
            This conversation is {booking?.status === 'cancelled' ? 'cancelled' : booking?.status === 'refunded' ? 'refunded' : 'resolved'}.
          </p>
        )}
      </div>
    </div>
  );
}

function getProgressWidth(status: string): string {
  const progress: Record<string, string> = {
    booking_requested: '15%',
    negotiating: '30%',
    waiting_payment: '45%',
    confirmed: '60%',
    in_progress: '75%',
    completed_pending_approval: '85%',
    approved_released: '100%',
    completed: '100%',
    disputed: '90%',
    cancelled: '0%',
    refunded: '0%',
  };
  return progress[status] || '0%';
}
