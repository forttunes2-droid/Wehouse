import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getBookingMessages,
  sendBookingMessage,
  uploadBookingChatAttachment,
  workerAcceptBooking,
  workerStartJob,
  workerMarkComplete,
  customerConfirmCompletion,
  customerRaiseDispute,
  cancelBooking,
  getBookingDetails,
  createWorkerBookingPayment,
  BOOKING_STATUS_LABELS,
  markBookingMessagesRead,
  hideBookingConversation,
  getMyWorkerBookingReview,
  submitWorkerBookingReview,
} from "@/lib/supabase/worker-bookings";
import { chatPresenceLabel } from "@/lib/supabase/presence";
import useChatPresence from "@/hooks/useChatPresence";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import { toast } from "sonner";
import { getCallCapabilities, launchPrivateCall } from "@/lib/private-calls";
import PrivateCallHistory from "@/components/PrivateCallHistory";
import BackButton from "@/components/BackButton";
import VoiceRecorderPanel from "@/components/VoiceRecorderPanel";
import useVoiceRecorder from "@/hooks/useVoiceRecorder";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";
import WorkerPublicProfile from "@/components/WorkerPublicProfile";
import SecureChatOnboarding from "@/components/SecureChatOnboarding";
import {
  privateConversationReadiness,
  type PrivateConversationReadiness,
} from "@/lib/e2ee";

type Props = {
  conversationId: string;
  bookingId: string;
  profile: Profile;
  isWorker: boolean;
  onClose: () => void;
};
type ChatMessage = {
  id: string;
  sender_id: string;
  sender_name?: string | null;
  content: string;
  attachments?: string[] | null;
  is_read?: boolean | null;
  created_at: string;
};
type Booking = {
  user_id: string;
  worker_id: string;
  status: string;
  booking_code?: string | null;
  service_type?: string | null;
  scheduled_date?: string | null;
  negotiated_amount?: number | null;
  agreed_amount?: number | null;
  address?: string | null;
  description?: string | null;
  customer_message?: string | null;
  request_attachments?: string[] | null;
  customer_username?: string | null;
  user_name?: string | null;
  worker_name?: string | null;
  user_avatar?: string | null;
  worker_avatar?: string | null;
  payment_review_required?: boolean | null;
  payment_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
type ConversationProfile = Partial<Profile> & {
  lga?: string | null;
  school?: string | null;
  bio?: string | null;
};
const MAX_FILES = 6,
  MAX_FILE_SIZE = 25 * 1024 * 1024;
export default function BookingNegotiationChat({
  conversationId,
  bookingId,
  profile,
  isWorker,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [messageError, setMessageError] = useState<string | null>(null),
    [booking, setBooking] = useState<Booking | null>(null),
    [input, setInput] = useState(""),
    [loading, setLoading] = useState(true),
    [acceptAmount, setAcceptAmount] = useState(""),
    [acceptDate, setAcceptDate] = useState(""),
    [showAcceptForm, setShowAcceptForm] = useState(false),
    [disputeReason, setDisputeReason] = useState(""),
    [showDisputeForm, setShowDisputeForm] = useState(false),
    [cancelReason, setCancelReason] = useState(""),
    [showCancelForm, setShowCancelForm] = useState(false),
    [paying, setPaying] = useState(false),
    [sending, setSending] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [menuOpen, setMenuOpen] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [peerProfile, setPeerProfile] = useState<ConversationProfile | null>(null),
    [messageMenu, setMessageMenu] = useState<ChatMessage | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    [secureChat, setSecureChat] = useState<PrivateConversationReadiness | null>(null);
  const [review,setReview]=useState<any>(null),[reviewRating,setReviewRating]=useState(0),[reviewComment,setReviewComment]=useState(''),[reviewSaving,setReviewSaving]=useState(false),[reviewOpen,setReviewOpen]=useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null),
    fileInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();
  const peerId = booking
    ? isWorker
      ? booking.user_id
      : booking.worker_id
    : null;
  const presence = useChatPresence(peerId);
  const presenceText = chatPresenceLabel(presence);
  const refreshSecureChat = useCallback(async () => {
    if (!peerId) return setSecureChat(null);
    setSecureChat(await privateConversationReadiness("worker", conversationId, peerId));
  }, [conversationId, peerId]);
  const loadAll = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      const bookingRes = await getBookingDetails(bookingId);
      const loadedBooking = (bookingRes.booking || null) as Booking | null;
      const loadedPeerId = loadedBooking ? (isWorker ? loadedBooking.user_id : loadedBooking.worker_id) : null;
      const msgRes = await getBookingMessages(conversationId, loadedPeerId);
      if (!msgRes.error) {
        setMessages((msgRes.messages || []) as ChatMessage[]);
        setMessageError(null);
      } else if (!quiet) {
        setMessageError(msgRes.error.message || "Conversation could not be loaded");
        toast.error("Conversation could not be loaded");
      }
      if (!bookingRes.error)
        setBooking(loadedBooking);
      if(loadedBooking?.status==='approved_released'&&!isWorker){const reviewResult=await getMyWorkerBookingReview(bookingId);if(!reviewResult.error&&reviewResult.review){setReview(reviewResult.review);setReviewRating(Number(reviewResult.review.rating||0));setReviewComment(String(reviewResult.review.comment||''));}}
      await markBookingMessagesRead(conversationId);
      if (!quiet) setLoading(false);
    },
    [conversationId, bookingId, isWorker],
  );
  useEffect(() => {
    void loadAll();
  }, [loadAll]);
  useEffect(() => {
    void refreshSecureChat();
  }, [refreshSecureChat]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, files.length]);
  useEffect(() => {
    document.body.classList.add("wehouse-conversation-open");
    window.dispatchEvent(
      new CustomEvent("wehouse:conversation-open", { detail: { open: true } }),
    );
    return () => {
      document.body.classList.remove("wehouse-conversation-open");
      window.dispatchEvent(
        new CustomEvent("wehouse:conversation-open", {
          detail: { open: false },
        }),
      );
    };
  }, []);
  useEffect(() => {
    const channel = supabase
      .channel(`booking-chat-live:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "booking_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void loadAll(true),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "booking_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void loadAll(true),
      )
      .subscribe();
    const refresh = () => {
      if (document.visibilityState === "visible") void loadAll(true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, loadAll]);
  function openSupport() {
    setMenuOpen(false);
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "service_booking_help",
          subject: `${booking?.service_type || "Service booking"} help`,
          contextType: "worker_booking",
          contextId: bookingId,
          contextSnapshot: {
            source_type: "worker_booking",
            source_id: bookingId,
            booking_code: booking?.booking_code || null,
            service_type: booking?.service_type || null,
            status: booking?.status || null,
            scheduled_date: booking?.scheduled_date || null,
            agreed_amount:
              booking?.negotiated_amount || booking?.agreed_amount || null,
            address: booking?.address || null,
            worker_id: booking?.worker_id || null,
            customer_id: booking?.user_id || null,
          },
        },
      }),
    );
  }
  function chooseFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is larger than 25MB`);
        return false;
      }
      return true;
    });
    setFiles((current) => {
      const next = [...current, ...incoming].slice(0, MAX_FILES);
      if (current.length + incoming.length > MAX_FILES)
        toast.error("You can send up to 6 files at once");
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  async function handleSend() {
    if (sending || (!input.trim() && !files.length)) return;
    if (secureChat?.state !== "ready" || !peerId) return toast.error("Secure chat is not ready yet");
    const content = input.trim(),
      queuedFiles = [...files];
    setSending(true);
    setInput("");
    setFiles([]);
    const optimisticId = `pending-${Date.now()}`;
    if (content)
      setMessages((current) => [
        ...current,
        {
          id: optimisticId,
          sender_id: profile.user_id,
          sender_name: profile.full_name || profile.username || "You",
          content,
          attachments: [],
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ]);
    const paths: string[] = [], attachments: Array<{path:string;file_iv:string;metadata_ciphertext:string;metadata_iv:string}> = [];
    try {
      for (const file of queuedFiles) {
        const uploaded = await uploadBookingChatAttachment(
          file,
          conversationId,
          peerId || "",
        );
        if (uploaded.error || !uploaded.path || !uploaded.attachment)
          throw new Error(uploaded.error?.message || `Could not upload ${file.name}`);
        paths.push(uploaded.path);
        attachments.push(uploaded.attachment);
      }
      const { error } = await sendBookingMessage(
        conversationId,
        peerId || "",
        content,
        attachments,
      );
      if (error) throw error;
      await loadAll(true);
    } catch (error: unknown) {
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticId),
      );
      setInput(content);
      setFiles(queuedFiles);
      if (paths.length) await supabase.storage.from("chat-files").remove(paths);
      toast.error(
        error instanceof Error ? error.message : "Message could not be sent",
      );
    } finally {
      setSending(false);
    }
  }
  async function toggleVoice() {
    if (voice.recording) return voice.finish();
    if (files.length >= MAX_FILES)
      return toast.error("Remove a file before recording a voice note");
    try {
      await voice.start();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Microphone permission is required for voice messages");
    }
  }
  async function openPeerProfile() {
    const { data, error } = await supabase.rpc(
      "get_allowed_conversation_profile",
      { p_context_type: "worker_booking", p_context_id: bookingId },
    );
    if (error) return toast.error("Profile could not be opened");
    setPeerProfile(data || null);
    setProfileOpen(true);
  }
  async function deleteFromMessages() {
    const { hidden, error } = await hideBookingConversation(conversationId);
    if (error || !hidden)
      return toast.error(error?.message || "Could not remove conversation");
    toast.success("Conversation removed");
    setConfirmDelete(false);
    setMenuOpen(false);
    onClose();
  }
  async function deleteMessageForMe() {
    if (!messageMenu) return;
    const { error } = await supabase.rpc("delete_conversation_message_for_me", {
      p_kind: "worker",
      p_message_id: messageMenu.id,
    });
    if (error)
      return toast.error(error.message || "Message could not be removed");
    setMessageMenu(null);
    await loadAll(true);
  }
  async function startCall(callType: "audio" | "video") {
    const { capabilities, error } = await getCallCapabilities(
      "worker_booking",
      conversationId,
    );
    if (error || !capabilities)
      return toast.error(error?.message || `${callType === "video" ? "Video" : "Audio"} call is not available`);
    const allowed = callType === "audio" ? capabilities.allow_audio_calls : capabilities.allow_video_calls;
    if (!allowed) return toast.error(`This person is not accepting ${callType} calls`);
    launchPrivateCall("worker_booking", conversationId, callType);
  }
  async function saveReview(){if(reviewRating<1)return toast.error('Choose a star rating');setReviewSaving(true);const{review:next,error}=await submitWorkerBookingReview(bookingId,reviewRating,reviewComment);setReviewSaving(false);if(error||!next)return toast.error(error?.message||'Review could not be saved');setReview(next);setReviewOpen(false);toast.success('Your review was saved')}
  async function handleWorkerAccept() {
    const amount = Number(acceptAmount.replace(/[^0-9]/g, ""));
    if (!amount || amount <= 0) return toast.error("Enter a valid amount");
    if (!acceptDate) return toast.error("Pick a schedule date");
    const { success, error } = await workerAcceptBooking(
      bookingId,
      amount,
      acceptDate,
    );
    if (error || !success)
      return toast.error(error?.message || "Booking could not be accepted");
    toast.success("Booking accepted. The customer can now pay.");
    setShowAcceptForm(false);
    void loadAll(true);
  }
  async function handleWorkerStart() {
    const { success, error } = await workerStartJob(bookingId);
    if (error || !success)
      return toast.error(error?.message || "Job could not be started");
    toast.success("Job started");
    void loadAll(true);
  }
  async function handleWorkerComplete() {
    const { success, error } = await workerMarkComplete(bookingId);
    if (error || !success)
      return toast.error(error?.message || "Job could not be completed");
    toast.success("Marked complete. Waiting for customer confirmation.");
    void loadAll(true);
  }
  async function handleCustomerConfirm() {
    const { success, error } = await customerConfirmCompletion(bookingId);
    if (error || !success)
      return toast.error(error?.message || "Completion could not be confirmed");
    toast.success("Job confirmed. Payment released to the Worker.");
    void loadAll(true);
  }
  async function handleCustomerDispute() {
    if (!disputeReason.trim()) return toast.error("Enter a reason");
    const { success, error } = await customerRaiseDispute(
      bookingId,
      disputeReason.trim(),
    );
    if (error || !success)
      return toast.error(error?.message || "Dispute could not be raised");
    toast.success("Dispute sent to WeHouse for review");
    setShowDisputeForm(false);
    void loadAll(true);
  }
  async function handleCancel() {
    if (!cancelReason.trim()) return toast.error("Enter a reason");
    const { success, error } = await cancelBooking(
      bookingId,
      cancelReason.trim(),
    );
    if (error || !success)
      return toast.error(error?.message || "Booking could not be cancelled");
    toast.success("Booking cancelled");
    setShowCancelForm(false);
    void loadAll(true);
  }
  async function handleCustomerPay() {
    setPaying(true);
    try {
      const { result: bootstrap, error: bootstrapErr } =
        await createWorkerBookingPayment(bookingId);
      if (bootstrapErr || !bootstrap?.success) {
        setPaying(false);
        return toast.error(bootstrap?.error || "Payment initialization failed");
      }
      const reference = bootstrap.reference as string,
        amount = bootstrap.amount as number;
      const { data: initialized, error: initError } = await supabase.functions.invoke(
        "payment-init",
        { body: { reference } },
      );
      if (initError || !initialized?.success) {
        throw new Error(initialized?.error || initError?.message || "Checkout could not start");
      }
      if (initialized.already_paid) {
        toast.success("Payment is already confirmed");
        setPaying(false);
        void loadAll(true);
        return;
      }
      if (!initialized.authorization_url) throw new Error("Paystack checkout link is missing");
      try {
        localStorage.setItem("wh_worker_booking_payment", JSON.stringify({ reference, bookingId, amount }));
      } catch { /* Checkout still works when storage is unavailable. */ }
      window.location.assign(String(initialized.authorization_url));
    } catch (error: unknown) {
      setPaying(false);
      toast.error(error instanceof Error ? error.message : "Payment failed");
    }
  }
  const statusInfo = booking?.status
      ? BOOKING_STATUS_LABELS[booking.status]
      : null,
    paymentReview = booking?.payment_review_required === true,
    openConversation = [
      "booking_requested",
      "negotiating",
      "waiting_payment",
      "confirmed",
      "in_progress",
      "completed_pending_approval",
      "disputed",
    ].includes(booking?.status || ""),
    peerName = isWorker
      ? booking?.customer_username
        ? `@${booking.customer_username}`
        : booking?.user_name || "Customer"
      : booking?.worker_name || "Worker",
    peerAvatar = isWorker ? booking?.user_avatar : booking?.worker_avatar;
  if (loading)
    return createPortal(
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#0A0A0F]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>, document.body
    );
  return createPortal(
    <div className="fixed inset-0 z-[100020] isolate flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0A0A0F] text-white">
      <header className="relative shrink-0 border-b border-white/[.06] bg-[#11131A]/97 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-4xl items-center gap-2.5">
          <BackButton onClick={onClose} />
          <button
            onClick={() => void openPeerProfile()}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left active:bg-white/[.04]"
          >
            <ChatAvatar name={peerName} src={peerAvatar} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                  {peerName}
                </p>
                {statusInfo && (
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[7px] ${statusInfo.color}`}
                  >
                    {statusInfo.label}
                  </span>
                )}
              </div>
              <p
                className={`mt-0.5 truncate text-[9px] ${presence?.online ? "text-emerald-300" : "text-[#676D7D]"}`}
              >
                {presenceText ||
                  `${booking?.service_type || "Worker booking"} · #${booking?.booking_code || ""}`}
              </p>
            </div>
          </button>
          {openConversation && <button
            onClick={() => void startCall("audio")}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.035] px-3 text-[10px] font-semibold text-[#D5D8E0] hover:bg-white/[.06]"
            aria-label="Start audio call"
          >
            <Phone />
            <span className="hidden min-[360px]:inline">Call</span>
          </button>}
          {openConversation && <button onClick={() => void startCall("video")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-[#D5D8E0] hover:bg-white/[.06]" aria-label="Start video call">
            <VideoCallIcon />
          </button>}
          <button
            onClick={() => setMenuOpen((value) => !value)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl text-[#8E93A3] hover:bg-white/[.05]"
            aria-label="Conversation options"
          >
            ⋯
          </button>
        </div>
        {menuOpen && (
          <div className="absolute right-3 top-[3.65rem] z-30 w-56 overflow-hidden rounded-2xl border border-white/[.08] bg-[#171B24] p-1.5 shadow-2xl">
            <button
              onClick={openSupport}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-violet-300 hover:bg-violet-500/[.06]"
            >
              <span>?</span>
              <span>WeHouse Support</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-red-300 hover:bg-red-500/[.07]"
            >
              <span>⌫</span>
              <span>Delete conversation</span>
            </button>
          </div>
        )}
        {booking && (
          <div className="mx-auto mt-3 max-w-4xl rounded-2xl border border-white/[.06] bg-white/[.025] p-3">
            <button type="button" onClick={()=>setDetailsOpen(value=>!value)} className="mb-3 flex w-full items-center justify-between gap-3 border-b border-white/[.055] pb-3 text-left">
              <span><span className="block text-[10px] font-semibold">Original service request</span><span className="mt-1 block text-[8px] text-[#686E7E]">The same request is shared by customer and Worker · #{booking.booking_code||'—'}</span></span>
              <span className="shrink-0 text-[10px] font-semibold text-violet-300">{detailsOpen?'Hide':'View details'}</span>
            </button>
            {detailsOpen&&<JobRequestDetails booking={booking}/>}
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[#656A7A]">
                Job progress
              </p>
              {Number(booking.negotiated_amount || 0) > 0 && (
                <p className="text-xs font-bold">
                  ₦{Number(booking.negotiated_amount).toLocaleString()}
                </p>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]">
              <div
                className="h-full rounded-full bg-violet-500"
                style={{ width: getProgressWidth(booking.status) }}
              />
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-[#686C7D]">
              {statusInfo?.description}
            </p>
            {!isWorker && ["confirmed", "in_progress", "completed_pending_approval"].includes(booking.status) && (
              <div className="mt-3 border-y border-emerald-500/15 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-emerald-300">✓</span>
                  <div>
                    <p className="text-[10px] font-semibold text-emerald-300">Payment secured for this job</p>
                    <p className="mt-1 text-[9px] leading-relaxed text-[#808696]">
                      The Worker is paid only after the work is completed and you confirm it. If something goes wrong, raise a dispute before confirming completion.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {isWorker && ["confirmed", "in_progress", "completed_pending_approval"].includes(booking.status) && (
              <p className="mt-3 border-y border-emerald-500/15 py-3 text-[9px] leading-relaxed text-[#808696]">
                Customer payment is secured. Your earnings become available after completed work is confirmed.
              </p>
            )}
            {paymentReview && (
              <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2">
                <p className="text-[9px] font-semibold text-amber-300">
                  Payment review required
                </p>
                <p className="mt-1 text-[9px] leading-relaxed text-[#8A8190]">
                  Paystack verified a payment, but this booking could not finish
                  payment processing automatically. Do not pay or cancel again.
                  WeHouse must review it first.
                </p>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isWorker &&
                ["booking_requested", "negotiating"].includes(
                  booking.status,
                ) && (
                  <button
                    onClick={() => setShowAcceptForm((v) => !v)}
                    className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 text-[9px] font-semibold text-violet-300"
                  >
                    Set price &amp; accept
                  </button>
                )}
              {isWorker && booking.status === "confirmed" && (
                <button
                  onClick={() => void handleWorkerStart()}
                  className="rounded-lg bg-violet-500/10 px-3 py-1.5 text-[9px] font-semibold text-violet-300"
                >
                  Start job
                </button>
              )}
              {isWorker && booking.status === "in_progress" && (
                <button
                  onClick={() => void handleWorkerComplete()}
                  className="rounded-lg bg-violet-500/10 px-3 py-1.5 text-[9px] font-semibold text-violet-300"
                >
                  Mark complete
                </button>
              )}
              {!isWorker &&
                !paymentReview &&
                booking.status === "waiting_payment" && (
                  <button
                    onClick={() => void handleCustomerPay()}
                    disabled={paying}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-50"
                  >
                    {paying
                      ? "Processing…"
                      : `Pay ₦${Number(booking.negotiated_amount || 0).toLocaleString()}`}
                  </button>
                )}
              {!isWorker && booking.status === "completed_pending_approval" && (
                <button
                  onClick={() => void handleCustomerConfirm()}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold"
                >
                  Confirm completion
                </button>
              )}
              {!isWorker &&
                [
                  "confirmed",
                  "in_progress",
                  "completed_pending_approval",
                ].includes(booking.status) && (
                  <button
                    onClick={() => setShowDisputeForm((v) => !v)}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[9px] font-semibold text-red-300"
                  >
                    Raise dispute
                  </button>
                )}
              {!paymentReview &&
                [
                  "booking_requested",
                  "negotiating",
                  "waiting_payment",
                ].includes(booking.status) && (
                  <button
                    onClick={() => setShowCancelForm((v) => !v)}
                    className="rounded-lg bg-white/[.04] px-3 py-1.5 text-[9px] text-[#858999]"
                  >
                    Cancel
                  </button>
                )}
            </div>
            {showAcceptForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[.035] p-2">
                <label className="block text-[9px] font-semibold text-[#A9AEBB]">
                  Your price (₦)
                  <input
                    inputMode="numeric"
                    value={acceptAmount}
                    onChange={(e) =>
                      setAcceptAmount(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="Enter the final price"
                    className="mt-1 h-9 w-full rounded-lg border border-white/[.07] bg-[#181A23] px-3 text-xs outline-none"
                  />
                </label>
                <input
                  type="date"
                  value={acceptDate}
                  onChange={(e) => setAcceptDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/[.07] bg-[#181A23] px-3 text-xs outline-none"
                />
                <button
                  disabled={!Number(acceptAmount) || !acceptDate}
                  onClick={() => void handleWorkerAccept()}
                  className="h-9 w-full rounded-lg bg-violet-500 text-[10px] font-semibold disabled:cursor-not-allowed disabled:bg-white/[.06] disabled:text-[#666B79]"
                >
                  Confirm price &amp; accept booking
                </button>
              </div>
            )}
            {showDisputeForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-red-500/15 bg-red-500/[.035] p-2">
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  rows={2}
                  placeholder="What went wrong?"
                  className="w-full resize-none rounded-lg border border-white/[.07] bg-[#181A23] p-2 text-xs outline-none"
                />
                <button
                  onClick={() => void handleCustomerDispute()}
                  className="h-9 w-full rounded-lg bg-red-500 text-[10px] font-semibold"
                >
                  Submit dispute
                </button>
              </div>
            )}
            {showCancelForm && (
              <div className="mt-2 space-y-2 rounded-xl border border-white/[.07] bg-white/[.025] p-2">
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={2}
                  placeholder="Reason for cancellation"
                  className="w-full resize-none rounded-lg border border-white/[.07] bg-[#181A23] p-2 text-xs outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowCancelForm(false)}
                    className="h-9 rounded-lg bg-white/[.04] text-[10px]"
                  >
                    Keep booking
                  </button>
                  <button
                    onClick={() => void handleCancel()}
                    className="h-9 rounded-lg bg-red-500/10 text-[10px] font-semibold text-red-300"
                  >
                    Cancel booking
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>
      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.045),transparent_32%)] px-3 py-4 sm:px-4">
        <div className="mx-auto max-w-4xl space-y-3">
          {messageError ? <div className="rounded-2xl border border-red-500/20 bg-red-500/[.06] p-4 text-center"><p className="text-xs font-semibold text-red-200">Messages could not be loaded</p><button onClick={() => void loadAll()} className="mt-2 text-[10px] font-semibold text-violet-300">Try again</button></div> : null}
          {!messageError && messages.length === 0 ? <div className="grid min-h-44 place-items-center text-center"><div><p className="text-sm font-semibold">No messages yet</p><p className="mt-2 text-[10px] text-[#666C7D]">Start with the work details, schedule and price.</p></div></div> : null}
          <PrivateCallHistory contextType="worker_booking" contextId={conversationId}/>
          {messages.map((msg, index) => {
            const mine = msg.sender_id === profile.user_id,
              prev = messages[index - 1],
              showDay =
                !prev ||
                new Date(prev.created_at).toDateString() !==
                  new Date(msg.created_at).toDateString();
            return (
              <div key={msg.id}>
                {showDay && <DaySeparator value={msg.created_at} />}
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMessageMenu(msg);
                  }}
                  onDoubleClick={() => setMessageMenu(msg)}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] overflow-hidden rounded-[20px] px-3.5 py-2.5 sm:max-w-[72%] ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-white/[.05] bg-[#161922]"}`}
                  >
                    {!mine && (
                      <p className="mb-1 text-[9px] font-semibold text-violet-300">
                        {msg.sender_name || "Job participant"}
                      </p>
                    )}
                    {msg.attachments?.map((url: string, i: number) => (
                      <BookingAttachment key={`${msg.id}-${i}`} url={url} />
                    ))}
                    {msg.content && <MessageContent content={msg.content} />}
                    <p
                      className={`mt-1 text-[8px] ${mine ? "text-violet-100/70" : "text-[#5C6070]"}`}
                    >
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {mine && (
                        <span
                          className={
                            msg.is_read
                              ? "ml-1 font-bold text-cyan-200"
                              : "ml-1 text-violet-100/50"
                          }
                        >
                          {msg.is_read ? "✓✓" : "✓"}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </main>
      <footer className="chat-input-container shrink-0 border-t border-white/[.06] bg-[#11131A]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
        {openConversation ? (
          <div className="mx-auto max-w-4xl">
            {!secureChat ? <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/[.07] px-4 py-3 text-[10px] text-[#858B9B]"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-400"/>Checking private chat…</div> : secureChat.state !== "ready" ? <SecureChatOnboarding status={secureChat} personName={peerName} onReady={() => {setSecureChat(null);void privateConversationReadiness("worker",conversationId,peerId||"").then(result=>{setSecureChat(result);if(result.state==="ready")void loadAll(true)})}}/> : <>
            {files.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.05] px-3 py-2"
                  >
                    <p className="max-w-40 truncate text-[9px] text-violet-200">
                      {file.type.startsWith("audio/")
                        ? "🎤 Voice note"
                        : file.name}
                    </p>
                    <button
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      className="text-[#8B90A0]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <VoiceRecorderPanel
              recording={voice.recording}
              seconds={voice.seconds}
              level={voice.level}
              draft={voice.draft}
              onCancel={voice.cancel}
              onFinish={voice.finish}
              onDiscard={voice.discard}
              onUse={(file) => {
                setFiles((current) => [...current, file].slice(0, MAX_FILES));
                voice.discard();
              }}
            />
            <div className="flex items-end gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-lg text-[#858A9B]"
              >
                ＋
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,audio/*,video/mp4"
                className="hidden"
                onChange={(e) => chooseFiles(e.target.files)}
              />
              <button
                onClick={() => void toggleVoice()}
                aria-label={
                  voice.recording ? "Finish voice recording" : "Record voice message"
                }
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${voice.recording ? "bg-red-500 text-white" : "border border-white/[.07] bg-white/[.035] text-[#858A9B]"}`}
              >
                <Mic />
              </button>
              <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.07] bg-[#1A1A24] px-3 py-1.5 focus-within:border-violet-500/40">
                <textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Write in this conversation…"
                  className="max-h-24 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none"
                />
              </div>
              <button
                onClick={() => void handleSend()}
                disabled={sending || (!input.trim() && !files.length)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05] disabled:text-[#626879]"
              >
                {sending ? "…" : "➤"}
              </button>
            </div>
            <p className="mt-2 text-center text-[8px] leading-relaxed text-[#505565]">
              End-to-end encrypted · private to you and the Worker
            </p>
            </>}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl py-2"><div className="flex items-center justify-between gap-3"><p className="text-[10px] text-[#656A7A]">This job conversation is closed.</p><button onClick={openSupport} className="text-[10px] font-semibold text-violet-300">Human Support</button></div>{!isWorker&&booking?.status==='approved_released'&&<section className="mt-3 border-t border-white/[.06] pt-3">{review&&!reviewOpen?<div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold text-amber-300">{'★'.repeat(Number(review.rating))}</p><p className="mt-1 text-[9px] text-[#6D7282]">Your verified review · {review.comment?'Written review included':'No written comment'}</p></div><button onClick={()=>setReviewOpen(true)} className="text-[9px] font-semibold text-violet-300">Edit review</button></div>:reviewOpen?<div><p className="text-xs font-semibold">Rate this completed job</p><p className="mt-1 text-[9px] text-[#6D7282]">Your rating and review appear on this professional’s public profile.</p><div className="mt-3 flex gap-2" aria-label="Choose rating">{[1,2,3,4,5].map(value=><button key={value} type="button" aria-label={`${value} star${value===1?'':'s'}`} onClick={()=>setReviewRating(value)} className={`text-2xl ${value<=reviewRating?'text-amber-300':'text-[#373C48]'}`}>★</button>)}</div><textarea value={reviewComment} onChange={event=>setReviewComment(event.target.value.slice(0,1200))} placeholder="Describe the work, communication and reliability (optional)" className="mt-3 min-h-20 w-full resize-none rounded-xl border border-white/[.07] bg-[#191B24] p-3 text-xs outline-none focus:border-violet-500/40"/><div className="mt-2 flex gap-2"><button disabled={reviewSaving} onClick={()=>void saveReview()} className="h-10 flex-1 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">{reviewSaving?'Saving…':'Publish verified review'}</button>{review&&<button onClick={()=>setReviewOpen(false)} className="h-10 rounded-xl border border-white/[.07] px-4 text-[10px]">Cancel</button>}</div></div>:<button onClick={()=>setReviewOpen(true)} className="h-11 w-full rounded-xl bg-amber-500/10 text-[10px] font-semibold text-amber-300">Rate and review this job</button>}</section>}</div>
        )}
      </footer>
      {profileOpen && !isWorker && peerProfile ? (
        <WorkerPublicProfile
          worker={peerProfile as Profile}
          bookingActive
          onBack={() => setProfileOpen(false)}
          onOpenBooking={() => setProfileOpen(false)}
          onBook={() => setProfileOpen(false)}
        />
      ) : profileOpen ? (
        <ConversationIdentitySheet
          profile={peerProfile}
          booking={booking}
          isWorker={isWorker}
          name={peerName}
          avatar={peerAvatar}
          presence={presenceText || ""}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
      {messageMenu && (
        <div
          className="fixed inset-0 z-[90] flex items-end bg-black/55 backdrop-blur-sm"
          onClick={() => setMessageMenu(null)}
        >
          <section
            className="w-full rounded-t-[26px] bg-[#12161E] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-white/15" />
            <p className="mb-2 truncate px-2 text-[10px] text-[#747B8C]">
              {messageMenu.content || "Attachment"}
            </p>
            <button
              onClick={() => void deleteMessageForMe()}
              className="flex min-h-12 w-full items-center px-3 text-left text-xs font-semibold text-red-300"
            >
              Delete for me
            </button>
            <button
              onClick={() => setMessageMenu(null)}
              className="min-h-12 w-full text-xs text-[#818899]"
            >
              Cancel
            </button>
          </section>
        </div>
      )}
      {confirmDelete && (
        <DeleteSheet
          onCancel={() => setConfirmDelete(false)}
          onDelete={() => void deleteFromMessages()}
        />
      )}
    </div>, document.body
  );
}
function ChatAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-violet-300">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        (name || "W")[0].toUpperCase()
      )}
    </div>
  );
}
function ConversationIdentitySheet({
  profile,
  booking,
  isWorker,
  name,
  avatar,
  presence,
  onClose,
}: {
  profile: ConversationProfile | null;
  booking: Booking | null;
  isWorker: boolean;
  name: string;
  avatar?: string | null;
  presence: string;
  onClose: () => void;
}) {
  const viewingWorker = !isWorker,
    displayName = profile?.full_name || name,
    details = viewingWorker
      ? [
          [
            "Rating",
            profile?.rating != null
              ? `${Number(profile.rating).toFixed(1)} ★ · ${Number(profile.review_count || 0)} reviews`
              : null,
          ],
          ["Service", booking?.service_type || "Service request"],
          ["Experience", profile?.worker_experience],
          [
            "Price",
            profile?.worker_price
              ? `₦${Number(profile.worker_price).toLocaleString()}`
              : null,
          ],
          [
            "Location",
            [profile?.lga, profile?.state].filter(Boolean).join(", "),
          ],
        ]
      : [
          [
            "Location",
            [profile?.city, profile?.state].filter(Boolean).join(", "),
          ],
        ];
  return (
    <div className="fixed inset-0 z-[75] flex h-[100dvh] flex-col overflow-hidden bg-[#0A0A0F]">
      <header className="shrink-0 border-b border-white/[.06] px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full text-[#9297A5]"
            aria-label="Back to conversation"
          >
            ←
          </button>
          <div>
            <p className="text-sm font-semibold">Profile</p>
            <p className="text-[9px] text-[#686F7F]">From this conversation</p>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-7">
          <div className="flex items-center gap-4">
            <ChatAvatar
              name={displayName}
              src={profile?.avatar_url || avatar}
            />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold">{displayName}</h2>
              {profile?.username && (
                <p className="mt-1 text-[10px] text-[#747B8B]">
                  @{profile.username}
                </p>
              )}
              <p className="mt-1 text-[10px] text-emerald-300">
                {presence || "WeHouse conversation"}
              </p>
            </div>
          </div>
          {(profile?.worker_bio || profile?.bio) && (
            <section className="mt-7 border-y border-white/[.06] py-5">
              <h3 className="text-xs font-semibold">About</h3>
              <p className="mt-2 whitespace-pre-line text-[11px] leading-5 text-[#AEB3BF]">
                {profile.worker_bio || profile.bio}
              </p>
            </section>
          )}
          <div className="divide-y divide-white/[.06]">
            {details
              .filter(
                ([, value]) =>
                  value !== null && value !== undefined && value !== "",
              )
              .map(([label, value]) => (
                <div
                  key={String(label)}
                  className="flex items-center justify-between gap-5 py-4"
                >
                  <span className="text-[10px] text-[#707788]">{label}</span>
                  <span className="text-right text-[12px] font-semibold text-[#E4E6EC]">
                    {value}
                  </span>
                </div>
              ))}
          </div>
          {viewingWorker &&
            Array.isArray(profile?.worker_skills) &&
            profile.worker_skills.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {profile.worker_skills.slice(0, 8).map((skill: string) => (
                  <span
                    key={skill}
                    className="rounded-full bg-violet-500/10 px-3 py-1.5 text-[9px] text-violet-200"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
        </div>
      </main>
    </div>
  );
}
function DaySeparator({ value }: { value: string }) {
  const date = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const label =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString([], {
            day: "numeric",
            month: "short",
            year:
              date.getFullYear() === today.getFullYear()
                ? undefined
                : "numeric",
          });
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="h-px flex-1 bg-white/[.05]" />
      <span className="text-[8px] font-semibold text-[#697080]">{label}</span>
      <span className="h-px flex-1 bg-white/[.05]" />
    </div>
  );
}
function DeleteSheet({
  onCancel,
  onDelete,
}: {
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center"
      onClick={onCancel}
    >
      <section
        className="w-full rounded-3xl border border-white/[.08] bg-[#151922] p-5 sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-bold">Delete this conversation?</h2>
        <p className="mt-2 text-[10px] leading-5 text-[#767C8C]">
          The job and its audit history stay intact, and the other participant
          keeps their copy. A new reply can make this conversation appear again.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="h-11 rounded-xl border border-white/[.08] text-[11px] font-semibold text-[#A4A9B7]"
          >
            Keep
          </button>
          <button
            onClick={onDelete}
            className="h-11 rounded-xl bg-red-500 text-[11px] font-semibold text-white"
          >
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}
function MessageContent({ content }: { content: string }) {
  if (isImage(content))
    return (
      <img
        src={content}
        alt="Shared"
        className="mb-1 max-h-72 max-w-full cursor-pointer rounded-xl object-contain"
        onClick={() => window.open(content, "_blank")}
      />
    );
  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed">{content}</p>
  );
}
function BookingAttachment({ url }: { url: string }) {
  if (isImage(url))
    return (
      <img
        src={url}
        alt="Attachment"
        className="mb-2 max-h-72 max-w-full cursor-pointer rounded-xl object-contain"
        onClick={() => window.open(url, "_blank")}
      />
    );
  if (isAudio(url)) return <VoiceNotePlayer url={url}/>;
  if (isVideo(url))
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className="mb-2 max-h-72 max-w-full rounded-xl"
      />
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mb-2 flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/10 px-3 py-2 text-[10px] font-semibold text-violet-100"
    >
      <span>📎</span>
      <span>Open attachment</span>
    </a>
  );
}
function isImage(v: string) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(v);
}
function isAudio(v: string) {
  return /\.(mp3|wav|webm|m4a|ogg)(\?|$)/i.test(v);
}
function isVideo(v: string) {
  return /\.(mp4|mov)(\?|$)/i.test(v);
}
function Mic() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
function Phone() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function VideoCallIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="14" height="14" rx="3" /><path d="m17 10 4-2v8l-4-2" /></svg>;
}
function JobRequestDetails({booking}:{booking:Booking}) {
  const amount=Number(booking.negotiated_amount||booking.agreed_amount||0);
  const facts=[
    ['Service',booking.service_type||'Service request'],
    ['Location',booking.address||'Not supplied'],
    ['Requested',booking.created_at?new Date(booking.created_at).toLocaleString():'Not available'],
    ['Schedule',booking.scheduled_date?new Date(`${booking.scheduled_date}T12:00:00`).toLocaleDateString():'To be agreed'],
    ['Price',amount>0?`₦${amount.toLocaleString('en-NG')}`:'Worker has not supplied a price'],
    ['Payment',booking.payment_status&&booking.payment_status!=='not_started'?booking.payment_status.replace(/_/g,' '):booking.status==='waiting_payment'?'Action needed':(['confirmed','in_progress','completed_pending_approval','approved_released'].includes(booking.status)?'Secured':'Not started')],
  ];
  return <div className="mb-3 space-y-3 rounded-xl border border-violet-500/12 bg-violet-500/[.035] p-3">
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{facts.map(([label,value])=><div key={label}><p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[#626879]">{label}</p><p className="mt-1 break-words text-[10px] leading-4 text-[#D4D7E0]">{value}</p></div>)}</div>
    <div className="border-t border-white/[.055] pt-3"><p className="text-[8px] font-semibold uppercase tracking-[.1em] text-[#626879]">Original description</p><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-[#B8BDCA]">{booking.description||booking.customer_message||'No written description was supplied with this request.'}</p></div>
    {booking.request_attachments?.length?<div className="flex flex-wrap gap-2 border-t border-white/[.055] pt-3">{booking.request_attachments.map((url,index)=><a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[9px] font-semibold text-violet-300">Open request attachment {index+1}</a>)}</div>:null}
  </div>;
}
function getProgressWidth(status: string) {
  const progress: Record<string, string> = {
    booking_requested: "15%",
    negotiating: "30%",
    waiting_payment: "45%",
    confirmed: "60%",
    in_progress: "75%",
    completed_pending_approval: "85%",
    approved_released: "100%",
    completed: "100%",
    disputed: "90%",
    cancelled: "0%",
    refunded: "0%",
  };
  return progress[status] || "0%";
}
