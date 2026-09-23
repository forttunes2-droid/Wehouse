import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { withTimeout } from "@/lib/withTimeout";
import { acknowledgeChatMessage, reconcileChatMessages } from "@/lib/chatMessageReconciliation";
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
import MediaViewer from "@/components/MediaViewer";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";
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
  readOnly?: boolean;
  onClose: () => void;
  onUpdated?: () => void;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
type LocalHotelMessage = HotelMessage & { delivery_state?: "sending" };

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
  const dismiss = useRecordScreenBack(onClose);
  const dialogRef = useDialogInteraction(dismiss);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const loadGeneration = useRef(0);
  const sendingRef = useRef(false);
  const localUrls = useRef(new Set<string>());
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => { onUpdatedRef.current = onUpdated; }, [onUpdated]);
  const activeConversation = useRef(initialConversationId || "");
  const activeIdentity = useRef(profile.user_id);
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<MessageMenuAnchor | null>(null);
  const [conversationId, setConversationId] = useState(
    initialConversationId || "",
  );
  const [messages, setMessages] = useState<LocalHotelMessage[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sending, setSending] = useState(false);
  const [messageMenu, setMessageMenu] = useState<HotelMessage | null>(null);
  const [messageMenuMode, setMessageMenuMode] = useState<"reactions" | "actions">("reactions");
  const [replyingTo, setReplyingTo] = useState<HotelMessage | null>(null);
  const [messageToRemove, setMessageToRemove] = useState<HotelMessage | null>(
    null,
  );
  const [viewer, setViewer] = useState<{
    src: string;
    kind: "image" | "video";
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceRecorder();
  const composer = useRef({ input, files });
  useEffect(() => { composer.current = { input, files }; }, [input, files]);
  useEffect(() => {
    const visible = new Set(messages.flatMap(message => message.attachments || []));
    for (const url of localUrls.current) if (!visible.has(url)) {
      URL.revokeObjectURL(url); localUrls.current.delete(url);
    }
  }, [messages]);
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const load = useCallback(async (id: string, quiet = false) => {
    const generation = ++loadGeneration.current;
    const current = () => generation === loadGeneration.current && activeConversation.current === id;
    if (!quiet) { setLoading(true); setLoadError(""); }
    try {
      const result = await withTimeout(getHotelMessages(id), 15000, "Hotel messages took too long to load");
      if (!current()) return;
      if (result.error) throw result.error;
      setLoadError("");
      setMessages(previous => reconcileChatMessages(previous, result.messages));
      void markHotelMessagesRead(id).catch(() => undefined);
    } catch (error) {
      if (current() && !quiet) setLoadError(error instanceof Error ? error.message : "Hotel messages could not be loaded");
    } finally { if (current()) setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    activeIdentity.current = profile.user_id;
    setMessages([]); setInput(""); setFiles([]); setReplyingTo(null);
    setConversationId(initialConversationId || "");
    activeConversation.current = initialConversationId || "";
    setLoading(true);
    void (async () => {
      let id = initialConversationId || "";
      if (!id) {
        const opened = await withTimeout(openHotelBookingConversation(bookingId), 15000, "Hotel conversation took too long to open");
        if (cancelled) return;
        if (opened.error || !opened.conversationId) {
          toast.error(opened.error?.message || "Hotel chat is unavailable");
          onCloseRef.current();
          return;
        }
        id = opened.conversationId;
        setConversationId(id);
      }
      activeConversation.current = id;
      await load(id);
    })().catch(error => {
      if (!cancelled) {
        setLoading(false);
        toast.error(error instanceof Error ? error.message : "Hotel chat could not be opened");
        onCloseRef.current();
      }
    });
    return () => {
      cancelled = true; loadGeneration.current++; activeConversation.current = ""; activeIdentity.current = "";
      for (const url of localUrls.current) URL.revokeObjectURL(url);
      localUrls.current.clear();
    };
  }, [bookingId, initialConversationId, profile.user_id, load]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`hotel-booking-chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotel_booking_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void load(conversationId, true);
          onUpdatedRef.current?.();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
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
    if (!conversationId || readOnly || loading || sendingRef.current || (!input.trim() && !files.length)) return;
    sendingRef.current = true;
    const target = conversationId;
    const isCurrent = () => activeConversation.current === target && activeIdentity.current === profile.user_id;
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
      sender_role: profile.role === "user" ? "guest" : "hotel",
      content: text,
      attachments: optimisticUrls,
      attachment_types: queuedFiles.map((file) => file.type),
      reactions: {},
      is_read: false,
      reply_to_id: replyTarget?.id || null,
      created_at: new Date().toISOString(),
      delivery_state: "sending",
    }]);
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
        throw new Error(result.error?.message || "Message acknowledgement was not received. Check this conversation before trying again.");
      if (isCurrent()) {
        loadGeneration.current++;
        setMessages(current => acknowledgeChatMessage(current, optimisticId, result.messageId!));
        setSending(false);
        void load(target, true);
        onUpdatedRef.current?.();
      }
    } catch (error) {
      if (!isCurrent()) return;
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      void Promise.all(paths.map((path) => deleteHotelChatAttachment(path))).catch(() => undefined);
      if (!composer.current.input && !composer.current.files.length) {
        setInput(text); setFiles(queuedFiles); setReplyingTo(replyTarget);
      }
      toast.error(
        error instanceof Error ? error.message : "Message could not be sent",
      );
    } finally {
      sendingRef.current = false;
      if (isCurrent()) setSending(false);
      else optimisticUrls.forEach(url => { URL.revokeObjectURL(url); localUrls.current.delete(url); });
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

  return createPortal(
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Hotel conversation" className="fixed inset-0 z-[100030] flex h-[100dvh] flex-col bg-[#090B10] text-white">
      <header className="shrink-0 border-b border-white/[.07] bg-[#0E1118]/95 px-3 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <BackButton onClick={dismiss} ariaLabel="Back to Inbox" className="!ml-0 !w-10" />
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/15 text-sm font-bold text-violet-200">
            H
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="mt-0.5 truncate text-xs text-[#73798A]">
              {subtitle}
            </p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto max-w-3xl space-y-2">
          <div className="mx-auto mb-4 max-w-sm border-y border-white/[.06] py-3 text-center text-xs leading-4 text-[#717788]">
            Use this conversation for arrival, the room and the stay. For
            payment or booking changes, open the booking and choose Get help
            from WeHouse.
          </div>
          {loading ? (
            <div
              className="min-h-48"
              role="status"
              aria-label="Loading hotel messages"
            />
          ) : loadError ? (
            <div role="alert" className="py-10 text-center text-sm text-[#AAA3B3]"><p>{loadError}</p><button type="button" onClick={() => void load(conversationId)} className="mt-3 min-h-11 font-semibold text-violet-300">Try again</button></div>
          ) : messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold">
                Start the hotel conversation
              </p>
              <p className="mt-2 text-xs text-[#6E7484]">
                Ask about arrival, the room or your stay.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const mine = message.sender_id === profile.user_id;
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
                  onReply={() => setReplyingTo(message)}
                  className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[84%]">
                    <div
                      className={`block w-full rounded-2xl px-3 py-2.5 text-left ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md bg-[#171B24]"}`}
                    >
                      {!mine && (
                        <p className="mb-1 text-xs font-semibold text-violet-300">
                          {message.sender_role === "hotel"
                            ? title
                            : message.sender_name}
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
                                {quoted.sender_id === profile.user_id
                                  ? "You"
                                  : quoted.sender_name}
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
                      {(message.attachments || []).map((src, index) => {
                        const type = message.attachment_types?.[index] || "";
                        return type.startsWith("image/") ? (
                          <button
                            key={src}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setViewer({ src, kind: "image" });
                            }}
                            className="mt-2 block overflow-hidden rounded-xl"
                          >
                            <img
                              src={src}
                              alt="Chat attachment"
                              loading="lazy"
                              decoding="async"
                              className="max-h-72 w-full object-cover"
                            />
                          </button>
                        ) : type.startsWith("audio/") ? (
                          <div key={src} className="mt-2">
                            <VoiceNotePlayer url={src} />
                          </div>
                        ) : null;
                      })}
                      <span
                        className={`mt-1.5 block text-right text-xs ${mine ? "text-violet-100/75" : "text-[#697080]"}`}
                      >
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {mine ? message.delivery_state === "sending" ? " · Sending…" : message.is_read ? " · Read" : " · Sent" : ""}
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
          {readOnly ? (
            <p className="py-2 text-center text-xs text-[#73798A]">
              This stay has ended. Its conversation is kept as read-only history.
            </p>
          ) : <>
          {files.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-violet-500/10 px-3 py-2 text-xs text-violet-200"
                >
                  <span className="max-w-36 truncate">{file.name}</span>
                  <button
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
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
                <p className="mt-0.5 truncate text-xs text-[#A1A6B4]">
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
            setReplyingTo(messageMenu);
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
      {viewer && (
        <MediaViewer
          src={viewer.src}
          kind={viewer.kind}
          title="Hotel chat media"
          onClose={() => setViewer(null)}
        />
      )}
    </div>, document.body
  );
}
