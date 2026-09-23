import MessageMedia, { AttachmentState, PendingMessageMedia } from "@/components/MessageMedia";
import { hotelMessagePresentation, type HotelConversationContext } from "@/lib/hotelConversationContext";
import { displayDate } from "@/lib/displayDate";
import { createPortal } from "react-dom";
import HotelSpecialRequest from "@/components/HotelSpecialRequest";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { withTimeout } from "@/lib/withTimeout";
import { acknowledgeChatMessage, reconcileChatMessages, type MessageSyncState } from "@/lib/chatMessageReconciliation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  deleteHotelChatAttachment,
  getHotelMessages,
  markHotelMessagesRead,
  openHotelBookingConversation,
  reactToHotelMessage,
  removeHotelMessageForMe,
  sendHotelMessage,
  uploadHotelChatAttachment,
  type HotelMessage,
} from "@/lib/supabase/hotel-chat";
import VoiceRecorderPanel from "@/components/VoiceRecorderPanel";
import ConfirmDialog from "@/components/ConfirmDialog";
import MessageActionSheet from "@/components/MessageActionSheet";
import type { MessageMenuAnchor } from "@/lib/messageMenuPosition";
import MessagePress from "@/components/MessagePress";
import useVoiceRecorder from "@/hooks/useVoiceRecorder";
import type { Profile } from "@/types";
import ChatAttachmentPicker from "@/components/ChatAttachmentPicker";
import BackButton from "@/components/BackButton";

type Props = {
  bookingId: number;
  conversationId?: string | null;
  profile: Profile;
  title: string;
  subtitle?: string;
  specialRequest?: string | null;
  hotelView?: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onUpdated?: () => void;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
type LocalHotelMessage = HotelMessage & MessageSyncState;

export default function HotelBookingChat({
  bookingId,
  conversationId: initialConversationId,
  profile,
  title,
  subtitle = "Hotel team · Booking conversation",
  readOnly = false,
  onClose,
  onUpdated,
}: Props) {
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<MessageMenuAnchor | null>(null);
  const [conversationId, setConversationId] = useState(
    initialConversationId || "",
  );
  const [messages, setMessages] = useState<LocalHotelMessage[]>([]);
  const [context, setContext] = useState<HotelConversationContext | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageMenu, setMessageMenu] = useState<HotelMessage | null>(null);
  const [messageMenuMode, setMessageMenuMode] = useState<"reactions" | "actions">("reactions");
  const [replyingTo, setReplyingTo] = useState<HotelMessage | null>(null);
  const [messageToRemove, setMessageToRemove] = useState<HotelMessage | null>(
    null,
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceRecorder();
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const onCloseRef = useRef(onClose), updatedRef = useRef(onUpdated);
  onCloseRef.current = onClose; updatedRef.current = onUpdated;
  const dismiss = useRecordScreenBack(() => onCloseRef.current());
  const dialogRef = useDialogInteraction(dismiss);
  const generation = useRef(0), requestNumber = useRef(0), sendingRef = useRef(false);
  const activeId = useRef(initialConversationId || '');
  const draftRef = useRef({ input, files }); draftRef.current = { input, files };
  const localUrls = useRef(new Set<string>());
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async (id: string, quiet = false) => {
    const session = generation.current, request = ++requestNumber.current, startedAt = Date.now();
    const current = () => session === generation.current && request === requestNumber.current && activeId.current === id;
    if (!quiet) setLoading(true);
    setLoadError('');
    try {
      const result = await withTimeout(getHotelMessages(id, bookingId, (rows, verifiedContext) => {
        if (!current()) return;
        setContext(verifiedContext); setMessages(old => reconcileChatMessages(old, rows, startedAt)); setLoading(false);
        if (document.visibilityState === "visible") void markHotelMessagesRead(id).catch(() => undefined);
      }), 18000, 'Hotel messages took too long to refresh.');
      if (!current()) return;
      if (result.error) throw result.error;
      setContext(result.context);
      setMessages(old => reconcileChatMessages(old, result.messages, startedAt));
    } catch (cause) {
      if (!current()) return;
      if (/permission|not authori[sz]ed|access denied|not a participant|authentication required/i.test(String((cause as {message?: string})?.message || cause))) { setMessages([]); setContext(null); }
      setLoadError('Messages could not be refreshed. Please try again.');
    } finally { if (current()) setLoading(false); }
  }, [bookingId]);

  useEffect(() => {
    const session = ++generation.current;
    activeId.current = initialConversationId || '';
    setConversationId(initialConversationId || ''); setMessages([]); setContext(null); setInput(''); setFiles([]); setReplyingTo(null); setLoading(true); setLoadError('');
    sendingRef.current = false; setSending(false);
    void (async () => {
      try {
        let id = initialConversationId || '';
        if (!id) {
          const opened = await withTimeout(openHotelBookingConversation(bookingId), 15000, 'Hotel chat took too long to open.');
          if (session !== generation.current) return;
          if (opened.error || !opened.conversationId) throw opened.error || new Error('Hotel chat unavailable');
          id = opened.conversationId;
        }
        if (session !== generation.current) return;
        activeId.current = id; setConversationId(id); await load(id);
      } catch {
        if (session === generation.current) { setLoading(false); setLoadError('Hotel chat could not be opened. Return to the reservation and try again.'); }
      }
    })();
    return () => {
      generation.current++; requestNumber.current++; activeId.current = '';
      for (const url of localUrls.current) URL.revokeObjectURL(url);
      localUrls.current.clear();
    };
  }, [bookingId, initialConversationId, profile.user_id, load]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`hotel-booking-chat:${conversationId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'hotel_booking_messages', filter: `conversation_id=eq.${conversationId}`,
    }, () => { void load(conversationId, true); updatedRef.current?.(); }).subscribe();
    const refreshOnVisible = () => { if (document.visibilityState === 'visible') void load(conversationId, true); };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => { document.removeEventListener('visibilitychange', refreshOnVisible); void supabase.removeChannel(channel); };
  }, [conversationId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, files.length]);

  function chooseFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((file) => {
      if (!file.type.startsWith("image/") && !file.type.startsWith("audio/")) {
        toast.error("Hotel chat supports photos and voice notes");
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is larger than 25MB`);
        return false;
      }
      return true;
    });
    setFiles((current) => [...current, ...incoming].slice(0, 6));
  }

  async function send() {
    if (!conversationId || !context?.can_reply || readOnly || loading || sendingRef.current || sending || (!input.trim() && !files.length)) return;
    const session = generation.current;
    const stillHere = () => session === generation.current && activeId.current === conversationId;
    sendingRef.current = true;
    setSending(true);
    const paths: string[] = [];
    const types: string[] = [];
    const text = input.trim();
    const queuedFiles = [...files];
    const replyTarget = replyingTo;
    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimisticUrls = queuedFiles.map((file) => URL.createObjectURL(file));
    optimisticUrls.forEach(url => localUrls.current.add(url));
    setInput("");
    setFiles([]);
    setReplyingTo(null);
    setMessages((current) => [...current, {
      id: optimisticId,
      sender_id: profile.user_id,
      sender_name: profile.full_name || profile.username || "You",
      sender_role: context.viewer_party,
      content: text,
      attachments: optimisticUrls,
      attachment_types: queuedFiles.map((file) => file.type),
      reactions: {},
      is_read: false,
      reply_to_id: replyTarget?.id || null,
      created_at: new Date().toISOString(),
      delivery_state: "sending",
    }]);
    let accepted = false;
    try {
      for (const file of queuedFiles) {
        const uploaded = await uploadHotelChatAttachment(
          conversationId,
          profile.user_id,
          file,
        );
        if (uploaded.error || !uploaded.path)
          throw new Error(
            uploaded.error?.message || `Could not upload ${file.name}`,
          );
        paths.push(uploaded.path);
        types.push(uploaded.type);
      }
      const result = await sendHotelMessage(
        conversationId,
        text,
        paths,
        types,
        replyTarget?.id || null,
      );
      if (result.error || !result.messageId)
        throw new Error(result.error?.message || "Message could not be sent");
      accepted = true;
      if (stillHere()) {
        setMessages(old => acknowledgeChatMessage(old, optimisticId, result.messageId!));
        setSending(false);
        // Refresh failure is not send failure: never delete an accepted upload.
        void load(conversationId, true);
        updatedRef.current?.();
      }
    } catch (error) {
      if (accepted) return;
      // Only upload/send failure reaches here, not an optional refresh.
      if (stillHere()) {
        const newDraft = Boolean(draftRef.current.input.trim() || draftRef.current.files.length);
        setMessages(current => newDraft ? current.map(row => row.id === optimisticId ? {...row, delivery_state: 'failed'} : row) : current.filter(row => row.id !== optimisticId));
        if (!newDraft) { setInput(text); setFiles(queuedFiles); setReplyingTo(replyTarget); }
        toast.error(error instanceof Error ? error.message : 'Message could not be sent');
      }
      await Promise.allSettled(paths.map(path => deleteHotelChatAttachment(path)));
    } finally {
      if (stillHere()) { sendingRef.current = false; setSending(false); }
      else { optimisticUrls.forEach(url => URL.revokeObjectURL(url)); }
    }
  }

  async function react(message: HotelMessage, emoji: string) {
    if (!conversationId) return;
    const mine = message.reactions?.[profile.user_id];
    const result = await reactToHotelMessage(
      conversationId,
      message.id,
      mine === emoji ? null : emoji,
    );
    if (result.error)
      return toast.error(result.error.message || "Reaction could not be saved");
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? { ...item, reactions: result.reactions }
          : item,
      ),
    );
    setMessageMenu(null);
  }

  async function removeMessage() {
    if (!conversationId || !messageToRemove) return;
    const result = await removeHotelMessageForMe(
      conversationId,
      messageToRemove.id,
    );
    if (result.error) {
      toast.error(result.error.message || "Message could not be removed");
      return;
    }
    setMessages((current) =>
      current.filter((message) => message.id !== messageToRemove.id),
    );
    setMessageToRemove(null);
  }

  const chatTitle = context?.other_party_label || title;
  const chatSubtitle = context ? [context.viewer_party === 'hotel' ? context.hotel_name : 'Hotel team', context.room_name,
    `${displayDate(context.check_in)} – ${displayDate(context.check_out)}`].filter(Boolean).join(' · ') : subtitle;
  const canReply = Boolean(context?.can_reply) && !readOnly;
  const specialRequest = context?.request_visible ? context.special_requests : null;
  const hotelView = context?.viewer_party === 'hotel';

  return createPortal(
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={chatTitle} className="fixed inset-0 z-[100030] flex h-[100dvh] flex-col bg-[#090B10] text-white">
      <header className="shrink-0 border-b border-white/[.07] bg-[#0E1118]/95 px-3 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <BackButton onClick={dismiss} ariaLabel="Back to Inbox" className="!ml-0 !w-10" />
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/15 text-sm font-bold text-violet-200">
            {chatTitle.trim().charAt(0).toUpperCase() || "H"}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{chatTitle}</h1>
            <p className="mt-0.5 truncate text-xs text-[#73798A]">
              {chatSubtitle}
            </p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto max-w-3xl space-y-2">
          {specialRequest?.trim() && <HotelSpecialRequest request={specialRequest} hotelView={hotelView} inConversation />}
          {loadError && <div role="alert" className="mb-3 text-sm text-amber-200"><p>{loadError}</p>{conversationId && <button type="button" className="min-h-11 underline" onClick={() => void load(conversationId, true)}>Try again</button>}</div>}
          {loading ? (
            <div
              className="min-h-48"
              role="status"
              aria-label="Loading hotel messages"
            />
          ) : messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold">
                Start the hotel conversation
              </p>
              <p className="mt-2 text-sm text-[#6E7484]">
                Ask about arrival, the room or your stay.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              if (!context) return null;
              const presentation = hotelMessagePresentation(message, profile.user_id, context);
              const mine = presentation.outgoing;
              const counts = Object.values(message.reactions || {}).reduce<
                Record<string, number>
              >(
                (total, emoji) => ({
                  ...total,
                  [emoji]: (total[emoji] || 0) + 1,
                }),
                {},
              );
              return (
                <MessagePress
                  key={message.id}
                  onOpen={(anchor) => {
                    setMessageMenuAnchor(anchor);
                    if (message.delivery_state) return;
                    setMessageMenuMode("actions");
                    setMessageMenu(message);
                  }}
                  onTap={(anchor) => {
                    setMessageMenuAnchor(anchor);
                    if (message.delivery_state) return;
                    setMessageMenuMode("reactions");
                    setMessageMenu(message);
                  }}
                  onReply={() => { if (canReply && !message.delivery_state) setReplyingTo(message); }}
                  className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[84%]">
                    <div
                      className={`block w-full rounded-2xl px-3 py-2.5 text-left ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md bg-[#171B24]"}`}
                    >
                      {(!mine || presentation.teammate) && (
                        <p className={`mb-1 text-xs font-semibold ${mine ? "text-violet-100" : "text-violet-300"}`}>
                          {presentation.author}
                        </p>
                      )}
                      {message.reply_to_id &&
                        (() => {
                          const quoted = messageById.get(message.reply_to_id);
                          return quoted ? (
                            <div
                              className={`mb-2 border-l-2 px-2.5 py-1.5 ${mine ? "border-violet-100/70 bg-black/10" : "border-violet-400 bg-white/[.035]"}`}
                            >
                              <p className="truncate text-xs font-semibold text-violet-200">
                                {hotelMessagePresentation(quoted, profile.user_id, context).author}
                              </p>
                              <p className="mt-0.5 truncate text-xs opacity-70">
                                {quoted.content ||
                                  (quoted.attachments?.length
                                    ? "Attachment"
                                    : "Message")}
                              </p>
                            </div>
                          ) : null;
                        })()}
                      {message.content && (
                        <p className="whitespace-pre-wrap break-words text-sm leading-5">
                          {message.content}
                        </p>
                      )}
                      {message.media_loading && <AttachmentState />}
                      {message.media_error && <AttachmentState error />}
                      <MessageMedia items={(message.attachments || []).map((url, index) => ({ url, type: message.attachment_types?.[index] || "" }))} />
                      <span
                        className={`mt-1.5 block text-right text-xs ${mine ? "text-violet-100/75" : "text-[#697080]"}`}
                      >
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {mine ? message.delivery_state === "sending" ? " · Sending…" : message.delivery_state === "failed" ? " · Not sent" : message.is_read ? " · Read" : " · Sent" : ""}
                      </span>
                    </div>
                    {Object.keys(counts).length > 0 && (
                      <div
                        className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}
                      >
                        {Object.entries(counts).map(([emoji, count]) => (
                          <button
                            key={emoji}
                            onClick={() => void react(message, emoji)}
                            className="rounded-full border border-white/[.08] bg-[#12151D] px-2 py-1 text-xs"
                          >
                            {emoji} {count}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </MessagePress>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="shrink-0 border-t border-white/[.07] bg-[#0E1118] px-3 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5">
        <div className="mx-auto max-w-3xl">
          {!canReply ? (
            <p className="py-2 text-center text-sm text-[#73798A]">
              {!context ? "Checking conversation access…" : "This booking conversation is read-only. Your messages remain available here."}
            </p>
          ) : <>
          <PendingMessageMedia files={files} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))} />
          <VoiceRecorderPanel
            recording={voice.recording}
            seconds={voice.seconds}
            level={voice.level}
            draft={voice.draft}
            onCancel={voice.cancel}
            onFinish={voice.finish}
            onDiscard={voice.discard}
            onUse={(file) => {
              setFiles((current) => [...current, file].slice(0, 6));
              voice.discard();
            }}
          />
          {replyingTo && (
            <div className="mb-2 flex items-center gap-3 border-l-2 border-violet-400 bg-white/[.035] px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-violet-300">
                  Replying to{" "}
                  {replyingTo.sender_id === profile.user_id
                    ? "yourself"
                    : replyingTo.sender_name}
                </p>
                <p className="mt-0.5 truncate text-sm text-[#A1A6B4]">
                  {replyingTo.content ||
                    (replyingTo.attachments?.length ? "Attachment" : "Message")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="grid h-8 w-8 place-items-center text-[#818797]"
                aria-label="Cancel reply"
              >
                ×
              </button>
            </div>
          )}
          {!voice.recording && !voice.draft && (
            <div className="flex items-end gap-2">
              <ChatAttachmentPicker onFiles={chooseFiles} allowAudio />
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Message"
                className="max-h-28 min-h-11 flex-1 resize-none rounded-3xl border border-white/[.08] bg-[#171B24] px-4 py-3 text-xs outline-none focus:border-violet-500/40"
              />
              {!input.trim() && !files.length ? (
                <button
                  onClick={() =>
                    void voice
                      .start()
                      .catch((error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Microphone is unavailable",
                        ),
                      )
                  }
                  aria-label="Record voice note"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#171B24] text-sm"
                >
                  ●
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={sending}
                  aria-label="Send message"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-lg disabled:opacity-50"
                >
                  ↑
                </button>
              )}
            </div>
          )}
          </>}
        </div>
      </footer>
      {messageMenu && (
        <MessageActionSheet
          anchor={messageMenuAnchor}
          mode={messageMenuMode}
          currentReaction={messageMenu.reactions?.[profile.user_id] || null}
          onClose={() => setMessageMenu(null)}
          onReact={(emoji) => void react(messageMenu, emoji)}
          onReply={() => {
            if (canReply) setReplyingTo(messageMenu);
            setMessageMenu(null);
          }}
          onRemove={() => {
            setMessageToRemove(messageMenu);
            setMessageMenu(null);
          }}
          onCopy={messageMenu.content ? () => {
            void navigator.clipboard.writeText(messageMenu.content || "");
            toast.success("Message copied");
            setMessageMenu(null);
          } : undefined}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(messageToRemove)}
        title="Remove this message?"
        description="This removes the message only from your chat. The other person keeps their copy."
        confirmLabel="Remove for me"
        onCancel={() => setMessageToRemove(null)}
        onConfirm={() => void removeMessage()}
      />

    </div>, document.body
  );
}
