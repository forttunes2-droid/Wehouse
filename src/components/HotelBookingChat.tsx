import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SmilePlus } from "lucide-react";
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
import MessagePress from "@/components/MessagePress";
import useVoiceRecorder from "@/hooks/useVoiceRecorder";
import type { Profile } from "@/types";

type Props = {
  bookingId: number;
  conversationId?: string | null;
  profile: Profile;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onUpdated?: () => void;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function HotelBookingChat({
  bookingId,
  conversationId: initialConversationId,
  profile,
  title,
  subtitle = "Private booking conversation",
  onClose,
  onUpdated,
}: Props) {
  const [conversationId, setConversationId] = useState(initialConversationId || "");
  const [messages, setMessages] = useState<HotelMessage[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageMenu, setMessageMenu] = useState<HotelMessage | null>(null);
  const [messageToRemove, setMessageToRemove] = useState<HotelMessage | null>(null);
  const [viewer, setViewer] = useState<{ src: string; kind: "image" | "video" } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();

  const load = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true);
    const result = await getHotelMessages(id);
    if (result.error) toast.error(result.error.message || "Hotel messages could not be loaded");
    else {
      setMessages(result.messages);
      await markHotelMessagesRead(id);
    }
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let id = initialConversationId || "";
      if (!id) {
        const opened = await openHotelBookingConversation(bookingId);
        if (cancelled) return;
        if (opened.error || !opened.conversationId) {
          toast.error(opened.error?.message || "Hotel chat is unavailable");
          onClose();
          return;
        }
        id = opened.conversationId;
        setConversationId(id);
      }
      await load(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, initialConversationId, load, onClose]);

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
          onUpdated?.();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, load, onUpdated]);

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
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (!conversationId || sending || (!input.trim() && !files.length)) return;
    setSending(true);
    const paths: string[] = [];
    const types: string[] = [];
    try {
      for (const file of files) {
        const uploaded = await uploadHotelChatAttachment(conversationId, profile.user_id, file);
        if (uploaded.error || !uploaded.path) throw new Error(uploaded.error?.message || `Could not upload ${file.name}`);
        paths.push(uploaded.path);
        types.push(uploaded.type);
      }
      const result = await sendHotelMessage(conversationId, input.trim(), paths, types);
      if (result.error) throw new Error(result.error.message || "Message could not be sent");
      setInput("");
      setFiles([]);
      await load(conversationId, true);
      onUpdated?.();
    } catch (error) {
      await Promise.all(paths.map((path) => deleteHotelChatAttachment(path)));
      toast.error(error instanceof Error ? error.message : "Message could not be sent");
    } finally {
      setSending(false);
    }
  }

  async function react(message: HotelMessage, emoji: string) {
    if (!conversationId) return;
    const mine = message.reactions?.[profile.user_id];
    const result = await reactToHotelMessage(conversationId, message.id, mine === emoji ? null : emoji);
    if (result.error) return toast.error(result.error.message || "Reaction could not be saved");
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, reactions: result.reactions } : item));
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

  return (
    <div className="fixed inset-0 z-[100030] flex h-[100dvh] flex-col bg-[#090B10] text-white">
      <header className="shrink-0 border-b border-white/[.07] bg-[#0E1118]/95 px-3 py-2.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button onClick={onClose} aria-label="Back to Inbox" className="grid h-10 w-10 place-items-center rounded-full text-xl text-[#A1A7B5]">←</button>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/15 text-sm font-bold text-violet-200">H</div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="mt-0.5 truncate text-[9px] text-[#73798A]">{subtitle}</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto max-w-3xl space-y-2">
          <div className="mx-auto mb-4 max-w-sm border-y border-white/[.06] py-3 text-center text-[9px] leading-4 text-[#717788]">
            This chat is tied to the paid stay. Booking or payment problems still go to WeHouse Property Operations.
          </div>
          {loading ? <div className="min-h-48" role="status" aria-label="Loading hotel messages" /> : messages.length === 0 ? (
            <div className="py-16 text-center"><p className="text-sm font-semibold">Start the hotel conversation</p><p className="mt-2 text-[10px] text-[#6E7484]">Ask about arrival, the room or your stay.</p></div>
          ) : messages.map((message) => {
            const mine = message.sender_id === profile.user_id;
            const counts = Object.values(message.reactions || {}).reduce<Record<string, number>>((total, emoji) => ({ ...total, [emoji]: (total[emoji] || 0) + 1 }), {});
            return <MessagePress key={message.id} onOpen={() => setMessageMenu(message)} className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
              {!mine && <button type="button" onClick={(event) => { event.stopPropagation(); setMessageMenu(message); }} aria-label="Message actions" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#707687] opacity-65 sm:opacity-0 sm:group-hover:opacity-100"><SmilePlus className="h-4 w-4" /></button>}
              <div className="max-w-[84%]">
                <div className={`block w-full rounded-2xl px-3 py-2.5 text-left ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md bg-[#171B24]"}`}>
                  {!mine && <p className="mb-1 text-[8px] font-semibold text-violet-300">{message.sender_role === "hotel" ? title : message.sender_name}</p>}
                  {message.content && <p className="whitespace-pre-wrap break-words text-[12px] leading-5">{message.content}</p>}
                  {(message.attachments || []).map((src, index) => {
                    const type = message.attachment_types?.[index] || "";
                    return type.startsWith("image/") ? <button key={src} type="button" onClick={(event) => { event.stopPropagation(); setViewer({ src, kind: "image" }); }} className="mt-2 block overflow-hidden rounded-xl"><img src={src} alt="Chat attachment" loading="lazy" decoding="async" className="max-h-72 w-full object-cover" /></button> : type.startsWith("audio/") ? <div key={src} className="mt-2"><VoiceNotePlayer url={src} /></div> : null;
                  })}
                  <span className={`mt-1.5 block text-right text-[7px] ${mine ? "text-violet-100/75" : "text-[#697080]"}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{mine ? message.is_read ? " · Read" : " · Sent" : ""}</span>
                </div>
                {Object.keys(counts).length > 0 && <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>{Object.entries(counts).map(([emoji, count]) => <button key={emoji} onClick={() => void react(message, emoji)} className="rounded-full border border-white/[.08] bg-[#12151D] px-2 py-1 text-[9px]">{emoji} {count}</button>)}</div>}
              </div>
              {mine && <button type="button" onClick={(event) => { event.stopPropagation(); setMessageMenu(message); }} aria-label="Message actions" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#707687] opacity-65 sm:opacity-0 sm:group-hover:opacity-100"><SmilePlus className="h-4 w-4" /></button>}
            </MessagePress>;
          })}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="shrink-0 border-t border-white/[.07] bg-[#0E1118] px-3 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5">
        <div className="mx-auto max-w-3xl">
          {files.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex shrink-0 items-center gap-2 rounded-full bg-violet-500/10 px-3 py-2 text-[9px] text-violet-200"><span className="max-w-36 truncate">{file.name}</span><button onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}
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
          {!voice.recording && !voice.draft && <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept="image/*,audio/*" multiple hidden onChange={(event) => chooseFiles(event.target.files)} />
            <button onClick={() => fileRef.current?.click()} aria-label="Attach photo or audio" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#171B24] text-lg text-[#9CA2B1]">＋</button>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} placeholder="Message" className="max-h-28 min-h-11 flex-1 resize-none rounded-3xl border border-white/[.08] bg-[#171B24] px-4 py-3 text-xs outline-none focus:border-violet-500/40" />
            {!input.trim() && !files.length ? <button onClick={() => void voice.start().catch((error) => toast.error(error instanceof Error ? error.message : "Microphone is unavailable"))} aria-label="Record voice note" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#171B24] text-sm">●</button> : <button onClick={() => void send()} disabled={sending} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-lg disabled:opacity-50">↑</button>}
          </div>}
        </div>
      </footer>
      {messageMenu && <MessageActionSheet currentReaction={messageMenu.reactions?.[profile.user_id] || null} onClose={() => setMessageMenu(null)} onReact={(emoji) => void react(messageMenu, emoji)} onRemove={() => { setMessageToRemove(messageMenu); setMessageMenu(null); }} />}
      <ConfirmDialog isOpen={Boolean(messageToRemove)} title="Remove this message?" description="This removes the message only from your chat. The other person keeps their copy." confirmLabel="Remove for me" onCancel={() => setMessageToRemove(null)} onConfirm={() => void removeMessage()} />
      {viewer && <MediaViewer src={viewer.src} kind={viewer.kind} title="Hotel chat media" onClose={() => setViewer(null)} />}
    </div>
  );
}
