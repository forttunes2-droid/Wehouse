import { useEffect, useRef, useState } from 'react';
import {
  getBookingMessages, sendBookingMessage, uploadBookingChatAttachment, workerAcceptBooking,
  workerStartJob, workerMarkComplete, customerConfirmCompletion, customerRaiseDispute,
  cancelBooking, getBookingDetails, createWorkerBookingPayment, BOOKING_STATUS_LABELS,
  markBookingMessagesRead, hideBookingConversation,
} from '@/lib/supabase/worker-bookings';
import { initializePaystackPopup } from '@/lib/supabase/paystack';
import { launchPrivateCall } from '@/lib/private-calls';
import { chatPresenceLabel } from '@/lib/supabase/presence';
import useChatPresence from '@/hooks/useChatPresence';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { toast } from 'sonner';

type Props = { conversationId: string; bookingId: string; profile: Profile; isWorker: boolean; onClose: () => void };
const MAX_FILES = 6;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function BookingNegotiationChatPhase10({ conversationId, bookingId, profile, isWorker, onClose }: Props) {
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
  const [paying, setPaying] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editWindow, setEditWindow] = useState(10);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [now, setNow] = useState(Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const peerId = booking ? (isWorker ? booking.user_id : booking.worker_id) : null;
  const presence = useChatPresence(peerId);
  const presenceText = chatPresenceLabel(presence);

  useEffect(() => { void loadAll(); }, [conversationId, bookingId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, files.length]);
  useEffect(() => () => { if (mediaRef.current?.state === 'recording') mediaRef.current.stop(); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    void supabase.rpc('get_setting_v2', { p_key: 'message_edit_window_minutes' }).then(({ data }) => {
      const raw: any = data;
      const value = Number(Array.isArray(raw) ? raw[0]?.value : raw?.value ?? raw);
      if (Number.isFinite(value) && value > 0) setEditWindow(value);
    });
  }, []);
  useEffect(() => {
    const channel = supabase.channel(`booking-chat-live:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_messages', filter: `conversation_id=eq.${conversationId}` }, () => void loadAll(true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'booking_messages', filter: `conversation_id=eq.${conversationId}` }, () => void loadAll(true))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, bookingId]);

  async function loadAll(quiet = false) {
    if (!quiet) setLoading(true);
    const [msgRes, bookingRes] = await Promise.all([getBookingMessages(conversationId), getBookingDetails(bookingId)]);
    setMessages(msgRes.messages || []);
    setBooking(bookingRes.booking);
    await markBookingMessagesRead(conversationId);
    if (!quiet) setLoading(false);
  }
  function openSupport() {
    setMenuOpen(false);
    window.dispatchEvent(new CustomEvent('openSupportChat', { detail: {
      category: 'worker_booking', subject: `Worker booking ${booking?.booking_code || ''}`.trim(), contextType: 'worker_booking', contextId: bookingId,
      contextSnapshot: { booking_code: booking?.booking_code || null, service_type: booking?.service_type || null, status: booking?.status || null, scheduled_date: booking?.scheduled_date || null, agreed_amount: booking?.negotiated_amount || booking?.agreed_amount || null, address: booking?.address || null, worker_id: booking?.worker_id || null, customer_id: booking?.user_id || null },
    } }));
  }
  function chooseFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((file) => { if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} is larger than 25MB`); return false; } return true; });
    setFiles((current) => { const next = [...current, ...incoming].slice(0, MAX_FILES); if (current.length + incoming.length > MAX_FILES) toast.error('You can send up to 6 files at once'); return next; });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
  async function handleSend() {
    if (sending || (!input.trim() && !files.length)) return;
    setSending(true);
    const paths: string[] = [];
    try {
      for (const file of files) {
        const { path, error } = await uploadBookingChatAttachment(file, conversationId);
        if (error || !path) throw new Error(error?.message || `Could not upload ${file.name}`);
        paths.push(path);
      }
      const { error } = await sendBookingMessage(conversationId, input.trim(), paths);
      if (error) throw error;
      setInput(''); setFiles([]); await loadAll(true);
    } catch (error: any) {
      if (paths.length) await supabase.storage.from('chat-files').remove(paths);
      toast.error(error?.message || 'Message could not be sent');
    } finally { setSending(false); }
  }
  async function toggleVoice() {
    if (recording) { mediaRef.current?.stop(); return; }
    if (files.length >= MAX_FILES) return toast.error('Remove a file before recording a voice note');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'; const blob = new Blob(chunksRef.current, { type }); const ext = type.includes('mp4') ? 'm4a' : 'webm';
        setFiles((current) => [...current, new File([blob], `voice-${Date.now()}.${ext}`, { type })].slice(0, MAX_FILES));
        stream.getTracks().forEach((track) => track.stop()); setRecording(false);
      };
      mediaRef.current = recorder; recorder.start(); setRecording(true);
    } catch { toast.error('Microphone permission is required for voice messages'); }
  }
  async function saveEdit(messageId: string) {
    const text = editText.trim();
    if (!text) return toast.error('Message cannot be empty');
    const { error } = await supabase.rpc('edit_my_booking_message', { p_message_id: messageId, p_content: text });
    if (error) return toast.error(error.message);
    setEditingId(null); setEditText(''); await loadAll(true);
  }
  async function deleteFromMessages() { const { hidden, error } = await hideBookingConversation(conversationId); if (error || !hidden) return toast.error(error?.message || 'Could not remove conversation'); toast.success('Conversation removed from your Messages'); setConfirmDelete(false); setMenuOpen(false); onClose(); }
  async function handleWorkerAccept() { const amount = Number(acceptAmount.replace(/[^0-9]/g, '')); if (!amount || amount <= 0) return toast.error('Enter a valid amount'); if (!acceptDate) return toast.error('Pick a schedule date'); const { success, error } = await workerAcceptBooking(bookingId, amount, acceptDate); if (error || !success) return toast.error(error?.message || 'Booking could not be accepted'); toast.success('Booking accepted. The customer can now pay.'); setShowAcceptForm(false); void loadAll(true); }
  async function handleWorkerStart() { const { success, error } = await workerStartJob(bookingId); if (error || !success) return toast.error(error?.message || 'Job could not be started'); toast.success('Job started'); void loadAll(true); }
  async function handleWorkerComplete() { const { success, error } = await workerMarkComplete(bookingId); if (error || !success) return toast.error(error?.message || 'Job could not be completed'); toast.success('Marked complete. Waiting for customer confirmation.'); void loadAll(true); }
  async function handleCustomerConfirm() { const { success, error } = await customerConfirmCompletion(bookingId); if (error || !success) return toast.error(error?.message || 'Completion could not be confirmed'); toast.success('Job confirmed. Payment released to the Worker.'); void loadAll(true); }
  async function handleCustomerDispute() { if (!disputeReason.trim()) return toast.error('Enter a reason'); const { success, error } = await customerRaiseDispute(bookingId, disputeReason.trim()); if (error || !success) return toast.error(error?.message || 'Dispute could not be raised'); toast.success('Dispute sent to WeHouse for review'); setShowDisputeForm(false); void loadAll(true); }
  async function handleCancel() { if (!cancelReason.trim()) return toast.error('Enter a reason'); const { success, error } = await cancelBooking(bookingId, cancelReason.trim()); if (error || !success) return toast.error(error?.message || 'Booking could not be cancelled'); toast.success('Booking cancelled'); setShowCancelForm(false); void loadAll(true); }
  async function handleCustomerPay() {
    setPaying(true);
    try {
      const { result: bootstrap, error: bootstrapErr } = await createWorkerBookingPayment(bookingId);
      if (bootstrapErr || !bootstrap?.success) { setPaying(false); return toast.error(bootstrap?.error || 'Payment initialization failed'); }
      const reference = bootstrap.reference as string; const amount = bootstrap.amount as number;
      const { data: pk } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_public_key' });
      if (!pk) { setPaying(false); return toast.error('Paystack not configured'); }
      initializePaystackPopup({ publicKey: pk as string, email: profile.email, amountKobo: Math.round(amount * 100), reference, metadata: { payment_type: 'worker_booking', expected_amount: amount, booking_id: bookingId }, onSuccess: async () => {
        const { verifyPaymentWithRetry } = await import('@/lib/supabase/payment-verify');
        const result = await verifyPaymentWithRetry(reference, { purpose: 'worker_booking', expected_amount: amount });
        if (result.success) toast.success('Payment successful. The Worker can now start the job.');
        else if (result.requires_review) toast.error('Payment was received but needs WeHouse review. Do not pay again.');
        else toast.error(result.error || 'Payment verification failed');
        setPaying(false); void loadAll(true);
      }, onCancel: () => { toast.info('Payment cancelled'); setPaying(false); }, onError: (message) => { toast.error(message); setPaying(false); } });
    } catch (error: any) { setPaying(false); toast.error(error?.message || 'Payment failed'); }
  }

  const statusInfo = booking?.status ? BOOKING_STATUS_LABELS[booking.status] : null;
  const paymentReview = booking?.payment_review_required === true;
  const openConversation = ['booking_requested', 'negotiating', 'waiting_payment', 'confirmed', 'in_progress', 'completed_pending_approval', 'disputed'].includes(booking?.status);
  const peerName = isWorker ? (booking?.customer_username ? `@${booking.customer_username}` : booking?.user_name || 'Customer') : booking?.worker_name || 'Worker';
  const peerAvatar = isWorker ? booking?.user_avatar : booking?.worker_avatar;

  if (loading) return <div className="grid min-h-[100dvh] place-items-center bg-[#090A0F]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;

  return <div className="flex min-h-[100dvh] flex-col bg-[#090A0F] text-white">
    <header className="sticky top-0 z-20 shrink-0 border-b border-white/[.06] bg-[#0E1118]/96 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-4xl items-center gap-1.5 px-3 py-2.5 sm:gap-2.5 sm:px-4"><button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#8E93A3] hover:bg-white/[.05]" aria-label="Back">←</button><ChatAvatar name={peerName} src={peerAvatar} /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{peerName}</p>{statusInfo && <span className={`shrink-0 rounded-full px-2 py-1 text-[7px] ${statusInfo.color}`}>{statusInfo.label}</span>}</div><p className={`mt-0.5 truncate text-[9px] ${presence?.online ? 'text-emerald-300' : 'text-[#676D7D]'}`}>{presenceText || `${booking?.service_type || 'Worker booking'} · #${booking?.booking_code || ''}`}</p></div><button onClick={() => launchPrivateCall('worker_booking', conversationId, 'audio')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#A7ACBA] hover:bg-white/[.05] hover:text-white" aria-label="Audio call"><CallPhoneIcon /></button><button onClick={() => launchPrivateCall('worker_booking', conversationId, 'video')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#A7ACBA] hover:bg-white/[.05] hover:text-white" aria-label="Video call"><CallVideoIcon /></button><button onClick={() => setMenuOpen((value) => !value)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl text-[#8E93A3] hover:bg-white/[.05]">⋯</button></div>
      {menuOpen && <div className="absolute right-3 top-[3.65rem] z-30 w-60 overflow-hidden rounded-2xl border border-white/[.08] bg-[#171B24] p-1.5 shadow-2xl"><div className="px-3 py-2 text-[8px] leading-4 text-[#6D7485]">Calls are private to this booking and respect both participants' call settings.</div><button onClick={openSupport} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-violet-300 hover:bg-violet-500/[.06]">? <span>WeHouse Support</span></button><button onClick={() => { setMenuOpen(false); setConfirmDelete(true); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-red-300 hover:bg-red-500/[.07]">⌫ <span>Delete from my Messages</span></button></div>}
      {booking && <JobCard booking={booking} statusInfo={statusInfo} paymentReview={paymentReview} isWorker={isWorker} paying={paying} showAcceptForm={showAcceptForm} setShowAcceptForm={setShowAcceptForm} acceptAmount={acceptAmount} setAcceptAmount={setAcceptAmount} acceptDate={acceptDate} setAcceptDate={setAcceptDate} handleWorkerAccept={handleWorkerAccept} handleWorkerStart={handleWorkerStart} handleWorkerComplete={handleWorkerComplete} handleCustomerPay={handleCustomerPay} handleCustomerConfirm={handleCustomerConfirm} showDisputeForm={showDisputeForm} setShowDisputeForm={setShowDisputeForm} disputeReason={disputeReason} setDisputeReason={setDisputeReason} handleCustomerDispute={handleCustomerDispute} showCancelForm={showCancelForm} setShowCancelForm={setShowCancelForm} cancelReason={cancelReason} setCancelReason={setCancelReason} handleCancel={handleCancel} />}
    </header>

    <main className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(124,58,237,.05),transparent_30%)] px-3 py-4 sm:px-4"><div className="mx-auto max-w-4xl space-y-3">
      {booking && <section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-3"><div className="flex items-center justify-between gap-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">About this job</p><button onClick={openSupport} className="text-[9px] font-semibold text-violet-300">Need WeHouse?</button></div><p className="mt-2 text-xs leading-relaxed">{booking.description || 'No description provided'}</p>{booking.address && <p className="mt-1 text-[10px] text-[#626678]">{booking.address}</p>}{booking.scheduled_date && <p className="mt-1 text-[10px] text-emerald-300">Scheduled · {new Date(booking.scheduled_date).toLocaleDateString()}</p>}</section>}
      {messages.map((msg) => { const mine = msg.sender_id === profile.user_id; const canEdit = mine && Boolean(String(msg.content || '').trim()) && now <= new Date(msg.created_at).getTime() + editWindow * 60000; return <div key={msg.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] overflow-hidden rounded-[22px] px-3.5 py-2.5 sm:max-w-[72%] ${mine ? 'rounded-br-md bg-violet-500' : 'rounded-bl-md border border-white/[.055] bg-[#151821]'}`}>{!mine && <p className="mb-1 text-[9px] font-semibold text-violet-300">{msg.sender_name || 'Job participant'}</p>}{(msg.attachments || []).map((url: string, index: number) => <BookingAttachment key={`${msg.id}-${index}`} url={url} />)}{editingId === msg.id ? <div className="space-y-2"><textarea autoFocus value={editText} onChange={(event) => setEditText(event.target.value)} rows={2} className="w-full resize-none rounded-xl border border-white/15 bg-black/20 p-2 text-xs outline-none" /><div className="flex justify-end gap-2"><button onClick={() => { setEditingId(null); setEditText(''); }} className="rounded-lg px-2.5 py-1.5 text-[9px] text-white/70">Cancel</button><button onClick={() => void saveEdit(msg.id)} className="rounded-lg bg-white px-2.5 py-1.5 text-[9px] font-bold text-violet-700">Save</button></div></div> : msg.content && <MessageContent content={msg.content} />}<div className={`mt-1 flex items-center gap-1.5 text-[8px] ${mine ? 'justify-end text-violet-100/75' : 'text-[#5C6070]'}`}><span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{msg.edited_at && <span>· Edited</span>}{mine && msg.is_read && <span>· Seen</span>}{canEdit && editingId !== msg.id && <button onClick={() => { setEditingId(msg.id); setEditText(String(msg.content || '')); }} className="ml-1 rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white">Edit</button>}</div></div></div>; })}
      <div ref={bottomRef} />
    </div></main>

    <footer className="sticky bottom-0 z-20 shrink-0 border-t border-white/[.06] bg-[#0E1118]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl sm:px-4">{openConversation ? <div className="mx-auto max-w-4xl">{files.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.05] px-3 py-2"><p className="max-w-40 truncate text-[9px] text-violet-200">{file.type.startsWith('audio/') ? '🎤 Voice note' : file.name}</p><button onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="text-[#8B90A0]">×</button></div>)}</div>}<div className="flex items-end gap-2"><button onClick={() => fileInputRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-lg text-[#858A9B]">＋</button><input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => chooseFiles(event.target.files)} /><button onClick={() => void toggleVoice()} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording ? 'bg-red-500' : 'border border-white/[.07] bg-white/[.035]'}`}>🎤</button><div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.08] bg-[#181B24] px-3 py-1.5"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} rows={1} placeholder="Message" className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[#626879]" /></div><button onClick={() => void handleSend()} disabled={sending || (!input.trim() && !files.length)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05]">{sending ? '…' : '➤'}</button></div></div> : <div className="mx-auto max-w-4xl rounded-2xl border border-white/[.06] bg-white/[.025] px-4 py-3 text-center text-[10px] text-[#747A8A]">This booking conversation is closed.</div>}</footer>
    {confirmDelete && <DeleteSheet onCancel={() => setConfirmDelete(false)} onDelete={() => void deleteFromMessages()} />}
  </div>;
}

function JobCard(props: any) {
  const { booking, statusInfo, paymentReview, isWorker, paying, showAcceptForm, setShowAcceptForm, acceptAmount, setAcceptAmount, acceptDate, setAcceptDate, handleWorkerAccept, handleWorkerStart, handleWorkerComplete, handleCustomerPay, handleCustomerConfirm, showDisputeForm, setShowDisputeForm, disputeReason, setDisputeReason, handleCustomerDispute, showCancelForm, setShowCancelForm, cancelReason, setCancelReason, handleCancel } = props;
  return <div className="mx-auto mb-3 max-w-4xl px-3 sm:px-4"><div className="rounded-2xl border border-white/[.06] bg-[#12151D] p-3"><div className="mb-2 flex items-center justify-between"><p className="text-[9px] font-semibold uppercase tracking-wide text-[#656A7A]">Job progress</p>{Number(booking.negotiated_amount || 0) > 0 && <p className="text-xs font-bold">₦{Number(booking.negotiated_amount).toLocaleString()}</p>}</div><div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-violet-500" style={{ width: getProgressWidth(booking.status) }} /></div><p className="mt-1 text-[9px] leading-relaxed text-[#686C7D]">{statusInfo?.description}</p>{paymentReview && <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2"><p className="text-[9px] font-semibold text-amber-300">Payment review required</p><p className="mt-1 text-[9px] leading-relaxed text-[#8A8190]">A verified payment needs WeHouse review. Do not pay or cancel again.</p></div>}<div className="mt-2 flex flex-wrap gap-1.5">{isWorker && ['booking_requested', 'negotiating'].includes(booking.status) && <Action onClick={() => setShowAcceptForm(!showAcceptForm)} tone="green">Accept booking</Action>}{isWorker && booking.status === 'confirmed' && <Action onClick={() => void handleWorkerStart()} tone="blue">Start job</Action>}{isWorker && booking.status === 'in_progress' && <Action onClick={() => void handleWorkerComplete()} tone="violet">Mark complete</Action>}{!isWorker && !paymentReview && booking.status === 'waiting_payment' && <Action onClick={() => void handleCustomerPay()} tone="green">{paying ? 'Processing…' : `Pay ₦${Number(booking.negotiated_amount || 0).toLocaleString()}`}</Action>}{!isWorker && booking.status === 'completed_pending_approval' && <Action onClick={() => void handleCustomerConfirm()} tone="green">Confirm completion</Action>}{!isWorker && ['confirmed', 'in_progress', 'completed_pending_approval'].includes(booking.status) && <Action onClick={() => setShowDisputeForm(!showDisputeForm)} tone="red">Raise dispute</Action>}{!paymentReview && ['booking_requested', 'negotiating', 'waiting_payment'].includes(booking.status) && <Action onClick={() => setShowCancelForm(!showCancelForm)}>Cancel</Action>}</div>
      {showAcceptForm && <div className="mt-2 space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[.035] p-2"><input inputMode="numeric" value={acceptAmount} onChange={(event) => setAcceptAmount(event.target.value.replace(/[^0-9]/g, ''))} placeholder="Agreed price (₦)" className="h-9 w-full rounded-lg border border-white/[.07] bg-[#181A23] px-3 text-xs outline-none" /><input type="date" value={acceptDate} onChange={(event) => setAcceptDate(event.target.value)} className="h-9 w-full rounded-lg border border-white/[.07] bg-[#181A23] px-3 text-xs outline-none" /><button onClick={() => void handleWorkerAccept()} className="h-9 w-full rounded-lg bg-emerald-500 text-[10px] font-semibold">Confirm & accept</button></div>}
      {showDisputeForm && <div className="mt-2 space-y-2 rounded-xl border border-red-500/15 bg-red-500/[.035] p-2"><textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} rows={2} placeholder="What went wrong?" className="w-full resize-none rounded-lg border border-white/[.07] bg-[#181A23] p-2 text-xs outline-none" /><button onClick={() => void handleCustomerDispute()} className="h-9 w-full rounded-lg bg-red-500 text-[10px] font-semibold">Submit dispute</button></div>}
      {showCancelForm && <div className="mt-2 space-y-2 rounded-xl border border-white/[.07] bg-white/[.025] p-2"><textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} placeholder="Reason for cancellation" className="w-full resize-none rounded-lg border border-white/[.07] bg-[#181A23] p-2 text-xs outline-none" /><div className="grid grid-cols-2 gap-2"><button onClick={() => setShowCancelForm(false)} className="h-9 rounded-lg bg-white/[.04] text-[10px]">Keep booking</button><button onClick={() => void handleCancel()} className="h-9 rounded-lg bg-red-500/10 text-[10px] font-semibold text-red-300">Cancel booking</button></div></div>}
    </div></div>;
}
function Action({ children, onClick, tone = 'muted' }: { children: React.ReactNode; onClick: () => void; tone?: string }) { const cls = tone === 'green' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : tone === 'blue' ? 'bg-blue-500/10 text-blue-300 border-blue-500/20' : tone === 'violet' ? 'bg-violet-500/10 text-violet-300 border-violet-500/20' : tone === 'red' ? 'bg-red-500/10 text-red-300 border-red-500/20' : 'bg-white/[.04] text-[#858999] border-white/[.05]'; return <button onClick={onClick} className={`rounded-lg border px-3 py-1.5 text-[9px] font-semibold ${cls}`}>{children}</button>; }
function ChatAvatar({ name, src }: { name: string; src?: string | null }) { return <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-xs font-bold text-violet-300">{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : (name || 'W')[0].toUpperCase()}</div>; }
function MessageContent({ content }: { content: string }) { return <p className="whitespace-pre-wrap break-words text-[12px] leading-5">{content}</p>; }
function BookingAttachment({ url }: { url: string }) { if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return <img src={url} alt="Shared" className="mb-2 max-h-80 max-w-full rounded-xl object-contain" />; if (/\.(webm|m4a|mp3|wav|ogg)(\?|$)/i.test(url)) return <audio controls preload="metadata" src={url} className="mb-1 h-9 max-w-full" />; if (/\.(mp4|mov)(\?|$)/i.test(url)) return <video controls playsInline src={url} className="mb-2 max-h-80 max-w-full rounded-xl" />; return <a href={url} target="_blank" rel="noreferrer" className="mb-2 block rounded-xl border border-white/10 px-3 py-2 text-[10px] underline">Open attachment</a>; }
function DeleteSheet({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => void }) { return <div className="fixed inset-0 z-[70] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center" onClick={onCancel}><section className="w-full rounded-3xl border border-white/[.08] bg-[#151922] p-5 sm:max-w-sm" onClick={(event) => event.stopPropagation()}><h2 className="text-base font-bold">Delete this conversation from your Messages?</h2><p className="mt-2 text-[10px] leading-5 text-[#767C8C]">This only hides it from your inbox. It does not erase the other participant's copy or the job record.</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onCancel} className="h-11 rounded-xl border border-white/[.08] text-[11px] font-semibold text-[#A4A9B7]">Keep</button><button onClick={onDelete} className="h-11 rounded-xl bg-red-500 text-[11px] font-semibold text-white">Delete</button></div></section></div>; }
function getProgressWidth(status: string) { const map: Record<string, string> = { booking_requested: '10%', negotiating: '22%', waiting_payment: '35%', confirmed: '50%', in_progress: '68%', completed_pending_approval: '84%', approved_released: '100%', disputed: '88%', cancelled: '100%', refunded: '100%' }; return map[status] || '8%'; }
function CallPhoneIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7.5 3.5 10 7l-2 2c1.5 3.2 3.8 5.5 7 7l2-2 3.5 2.5-.8 3.1c-.2.8-.9 1.4-1.8 1.4C10 20.4 3.6 14 3 6.1c-.1-.9.5-1.6 1.4-1.8l3.1-.8Z"/></svg>}
function CallVideoIcon(){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>}
