import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  supabase,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesSeen,
} from "@/lib/supabase";
import {
  deleteRoommateChatAttachment,
  getRoommateConversationPeople,
  hideRoommateConversation,
  setRoommateBlock,
  uploadRoommateChatAttachment,
} from "@/lib/supabase/chat";
import type { RoommatePeer } from "@/lib/supabase/chat";
import {
  BOOKING_STATUS_LABELS,
  getCommunicationBookingConversations,
  hideBookingConversation,
} from "@/lib/supabase/worker-bookings";
import { getCallCapabilities, launchPrivateCall } from "@/lib/private-calls";
import { chatPresenceLabel } from "@/lib/supabase/presence";
import useChatPresence from "@/hooks/useChatPresence";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import OfficialChannel from "@/components/OfficialChannel";
import OfficialEntryCard from "@/components/OfficialEntryCard";
import SupportEntryCard from "@/components/SupportEntryCard";
import { toast } from "sonner";
import type { Conversation, Message, Profile } from "@/types";

type Props = {
  profile: Profile;
  onNavigate: (page: string) => void;
  conversationId?: string | null;
};
type Person = Pick<RoommatePeer, "name" | "avatar"> & Partial<RoommatePeer>;
type RoommateMessage = Message & {
  attachments?: string[];
  attachment_types?: string[];
};
type BookingConversation = {
  conversation_id: string;
  booking_id: string;
  booking_code: string;
  booking_status: string;
  service_type: string;
  negotiated_amount: number;
  other_person_id: string | null;
  other_person_name: string;
  other_person_avatar: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number;
  updated_at: string;
};
type ActiveBooking = { conversationId: string; bookingId: string } | null;
type InboxItem =
  | { kind: "roommate"; id: string; time: string; roommate: Conversation }
  | { kind: "worker"; id: string; time: string; booking: BookingConversation };
const MAX_FILES = 6,
  MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function Chat({ profile, conversationId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [bookingConversations, setBookingConversations] = useState<
      BookingConversation[]
    >([]),
    [active, setActive] = useState<Conversation | null>(null),
    [activeBooking, setActiveBooking] = useState<ActiveBooking>(null),
    [messages, setMessages] = useState<RoommateMessage[]>([]),
    [people, setPeople] = useState<Record<string, Person>>({}),
    [input, setInput] = useState(""),
    [loading, setLoading] = useState(true),
    [loadingMessages, setLoadingMessages] = useState(false),
    [sending, setSending] = useState(false),
    [officialOpen, setOfficialOpen] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [recording, setRecording] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    [menuOpen, setMenuOpen] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [blockBusy, setBlockBusy] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [bulkDelete, setBulkDelete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    mediaRef = useRef<MediaRecorder | null>(null),
    chunksRef = useRef<Blob[]>([]),
    recordStartedRef = useRef(0);
  const otherId = useCallback(
    (conv: Conversation) =>
      conv.participant_a === profile.user_id
        ? conv.participant_b
        : conv.participant_a,
    [profile.user_id],
  );
  const unread = useCallback(
    (conv: Conversation) =>
      Number(
        conv.participant_a === profile.user_id ? conv.unread_a : conv.unread_b,
      ) || 0,
    [profile.user_id],
  );
  const peerId = active ? otherId(active) : null;
  const presence = useChatPresence(peerId);
  const presenceText = chatPresenceLabel(presence);

  const loadInbox = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      const [convResult, peerResult, bookingResult] = await Promise.all([
        getConversations(profile.user_id),
        getRoommateConversationPeople(),
        getCommunicationBookingConversations(profile.user_id),
      ]);
      if (convResult.error && !quiet)
        toast.error(
          convResult.error.message || "Unable to load roommate conversations",
        );
      if (bookingResult.error && !quiet)
        toast.error(
          bookingResult.error.message || "Unable to load Worker conversations",
        );
      const rows = (convResult.conversations || []).filter(
        (row) => row.conversation_type === "roommate",
      );
      setConversations(rows);
      setPeople(peerResult.people || {});
      setBookingConversations(
        (bookingResult.conversations || []) as BookingConversation[],
      );
      setLoading(false);
      return rows;
    },
    [profile.user_id],
  );

  const loadRoommateMessages = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) setLoadingMessages(true);
      const result = await getMessages(id);
      if (result.error) {
        if (!quiet)
          toast.error(result.error.message || "Unable to open conversation");
        setLoadingMessages(false);
        return;
      }
      setMessages((result.messages || []) as RoommateMessage[]);
      await Promise.all([
        markMessagesSeen(id),
        supabase
          .from("notifications")
          .update({ read: true })
          .eq("recipient_id", profile.user_id)
          .eq("related_id", id),
      ]);
      setLoadingMessages(false);
    },
    [profile.user_id],
  );

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);
  useEffect(() => {
    if (!conversationId) return;
    void (async () => {
      const rows = await loadInbox(true);
      const found = rows.find((row) => row.id === conversationId);
      if (found) {
        setActive(found);
        void loadRoommateMessages(found.id);
      }
    })();
  }, [conversationId, loadInbox, loadRoommateMessages]);
  useEffect(() => {
    if (!active) {
      setMessages([]);
      setFiles([]);
      setMenuOpen(false);
      setConfirmDelete(false);
      return;
    }
    void loadRoommateMessages(active.id);
    const channel = supabase
      .channel(`roommate-chat-${active.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${active.id}`,
        },
        () => {
          void loadRoommateMessages(active.id, true);
          void loadInbox(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${active.id}`,
        },
        () => void loadRoommateMessages(active.id, true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active?.id, loadRoommateMessages, loadInbox]);
  useEffect(() => {
    if (active || activeBooking) return;
    const channel = supabase
      .channel(`message-inbox:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => void loadInbox(true),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "booking_messages" },
        () => void loadInbox(true),
      )
      .subscribe();
    const timer = window.setInterval(() => void loadInbox(true), 20000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [active?.id, activeBooking?.conversationId, profile.user_id, loadInbox]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, files.length]);
  useEffect(() => {
    if (!recording) {
      setRecordSeconds(0);
      return;
    }
    const timer = window.setInterval(
      () => setRecordSeconds((v) => v + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(
    () => () => {
      if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    },
    [],
  );

  async function openConversation(conv: Conversation) {
    setActive(conv);
    setInput("");
    setFiles([]);
    setMenuOpen(false);
    await loadRoommateMessages(conv.id);
  }
  function choosePhotos(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not a photo`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is larger than 25MB`);
        return false;
      }
      return true;
    });
    setFiles((current) => {
      const next = [...current, ...incoming].slice(0, MAX_FILES);
      if (current.length + incoming.length > MAX_FILES)
        toast.error("You can send up to 6 items at once");
      return next;
    });
    if (fileRef.current) fileRef.current.value = "";
  }
  async function toggleVoice() {
    if (recording) {
      mediaRef.current?.stop();
      return;
    }
    if (files.length >= MAX_FILES)
      return toast.error("Remove an attachment before recording a voice note");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recordStartedRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm",
          blob = new Blob(chunksRef.current, { type }),
          ext = type.includes("mp4") ? "m4a" : "webm",
          elapsed = Math.max(
            1,
            Math.round((Date.now() - recordStartedRef.current) / 1000),
          );
        setFiles((current) =>
          [
            ...current,
            new File([blob], `voice-${Date.now()}-${elapsed}s.${ext}`, {
              type,
            }),
          ].slice(0, MAX_FILES),
        );
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      mediaRef.current = recorder;
      recorder.start(250);
      setRecording(true);
    } catch {
      toast.error("Microphone permission is required for voice notes");
    }
  }
  async function submit() {
    if (!active || sending || (!input.trim() && !files.length)) return;
    setSending(true);
    const paths: string[] = [],
      types: string[] = [];
    try {
      for (const file of files) {
        const uploaded = await uploadRoommateChatAttachment(file, active.id);
        if (uploaded.error || !uploaded.path)
          throw new Error(
            uploaded.error?.message || `Could not upload ${file.name}`,
          );
        paths.push(uploaded.path);
        types.push(uploaded.type || file.type);
      }
      const result = await sendMessage(active.id, input.trim(), paths, types);
      if (result.error || !result.message)
        throw new Error(result.error?.message || "Message could not be sent");
      setInput("");
      setFiles([]);
      await loadRoommateMessages(active.id);
      void loadInbox(true);
    } catch (error: unknown) {
      for (const path of paths) await deleteRoommateChatAttachment(path);
      toast.error(
        error instanceof Error ? error.message : "Message could not be sent",
      );
    } finally {
      setSending(false);
    }
  }
  async function deleteFromMessages() {
    if (!active) return;
    const { hidden, error } = await hideRoommateConversation(active.id);
    if (error || !hidden)
      return toast.error(error?.message || "Could not remove conversation");
    toast.success("Conversation removed from your Messages");
    setConfirmDelete(false);
    setMenuOpen(false);
    setActive(null);
    await loadInbox(true);
  }
  async function toggleBlock() {
    if (!peerId || blockBusy) return;
    const person = people[peerId];
    setBlockBusy(true);
    const nextBlocked = !person?.isBlocked;
    const { error } = await setRoommateBlock(peerId, nextBlocked);
    setBlockBusy(false);
    if (error)
      return toast.error(error.message || "Could not update message blocking");
    setPeople((current) => ({
      ...current,
      [peerId]: { ...current[peerId], isBlocked: nextBlocked },
    }));
    setMenuOpen(false);
    toast.success(
      nextBlocked ? "Messages blocked from this person" : "Messages unblocked",
    );
  }
  async function startCall() {
    if (!active) return;
    const { capabilities, error } = await getCallCapabilities(
      "roommate",
      active.id,
    );
    if (error || !capabilities)
      return toast.error(error?.message || "Call is not available");
    if (!capabilities.allow_audio_calls)
      return toast.error("This person is not accepting audio calls");
    launchPrivateCall("roommate", active.id, "audio");
  }
  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function deleteSelected() {
    if (!selected.size) return;
    setBulkDelete(true);
    let failed = 0;
    for (const id of selected) {
      const [kind, value] = id.split(":");
      const result =
        kind === "roommate"
          ? await hideRoommateConversation(value)
          : await hideBookingConversation(value);
      if (result.error || !result.hidden) failed++;
    }
    setBulkDelete(false);
    setSelected(new Set());
    await loadInbox(true);
    if (failed)
      toast.error(
        `${failed} conversation${failed === 1 ? "" : "s"} could not be removed`,
      );
    else toast.success("Selected conversations removed from Messages");
  }

  const inboxItems = useMemo<InboxItem[]>(
    () =>
      [
        ...conversations.map((conv) => ({
          kind: "roommate" as const,
          id: `roommate:${conv.id}`,
          time: conv.last_message_at || conv.created_at,
          roommate: conv,
        })),
        ...bookingConversations.map((booking) => ({
          kind: "worker" as const,
          id: `worker:${booking.conversation_id}`,
          time: booking.last_message_time || booking.updated_at,
          booking,
        })),
      ].sort(
        (a, b) =>
          new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime(),
      ),
    [conversations, bookingConversations],
  );
  const totalUnread =
    conversations.reduce((sum, row) => sum + unread(row), 0) +
    bookingConversations.reduce(
      (sum, row) => sum + Number(row.unread_count || 0),
      0,
    );

  if (officialOpen)
    return (
      <OfficialChannel
        profile={profile}
        onBack={() => setOfficialOpen(false)}
      />
    );
  if (activeBooking)
    return (
      <BookingNegotiationChat
        conversationId={activeBooking.conversationId}
        bookingId={activeBooking.bookingId}
        profile={profile}
        isWorker={profile.role === "worker"}
        onClose={() => {
          setActiveBooking(null);
          void loadInbox(true);
        }}
      />
    );
  if (active) {
    const person = people[otherId(active)];
    return (
      <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col bg-[#090A0F] text-white">
        <header className="relative shrink-0 border-b border-white/[.06] bg-[#10131B]/97 px-3 py-2.5 backdrop-blur-xl sm:px-4">
          <div className="mx-auto flex max-w-3xl items-center gap-1">
            <button
              onClick={() => setActive(null)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9699A8] hover:bg-white/[.05]"
              aria-label="Back to Messages"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-label="View roommate profile"
            >
              <Avatar person={person} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold">
                  {person?.name || "Roommate match"}
                </span>
                <span
                  className={`mt-0.5 block truncate text-[9px] ${presence?.online ? "text-emerald-300" : "text-[#6D7282]"}`}
                >
                  {presenceText || "Private roommate conversation"}
                </span>
              </span>
            </button>
            <HeaderAction label="Audio call" onClick={() => void startCall()}>
              <PhoneIcon />
            </HeaderAction>
            <button
              onClick={() => setMenuOpen((value) => !value)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-[#8E93A3] hover:bg-white/[.05]"
              aria-label="Conversation options"
            >
              ⋯
            </button>
          </div>
          {menuOpen && (
            <div className="absolute right-3 top-[3.65rem] z-20 w-56 overflow-hidden rounded-2xl border border-white/[.08] bg-[#171B24] p-1.5 shadow-2xl">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setProfileOpen(true);
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] hover:bg-white/[.04]"
              >
                <span>◉</span>
                <span>View profile</span>
              </button>
              <button
                disabled={blockBusy}
                onClick={() => void toggleBlock()}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-amber-200"
              >
                <span>⊘</span>
                <span>
                  {person?.isBlocked ? "Unblock messages" : "Block messages"}
                </span>
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-red-300 hover:bg-red-500/[.07]"
              >
                <span>⌫</span>
                <span>Delete from my Messages</span>
              </button>
            </div>
          )}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.055),transparent_32%)] px-3 py-4 sm:px-4">
          <div className="mx-auto max-w-3xl space-y-2.5">
            {loadingMessages && messages.length === 0 ? (
              <MessageSkeleton />
            ) : messages.length === 0 ? (
              <Empty
                title="Start your conversation"
                text="You both accepted the roommate match. Share photos, voice notes or a message while you discuss living plans."
              />
            ) : null}
            {messages.map((msg, index) => (
              <div key={msg.id}>
                {index === 0 ||
                dayKey(messages[index - 1].created_at) !==
                  dayKey(msg.created_at) ? (
                  <DateDivider value={msg.created_at} />
                ) : null}
                <RoommateBubble
                  msg={msg}
                  mine={msg.sender_id === profile.user_id}
                />
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </main>
        <footer className="shrink-0 border-t border-white/[.06] bg-[#10131B]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
          <div className="mx-auto max-w-3xl">
            {files.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {files.map((file, index) => (
                  <PendingMedia
                    key={`${file.name}-${index}`}
                    file={file}
                    onRemove={() =>
                      setFiles((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  />
                ))}
              </div>
            )}
            {recording && (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-red-500/[.08] px-3 py-2 text-[10px] text-red-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                Recording voice note{" "}
                <span className="font-mono">{duration(recordSeconds)}</span>
                <span className="ml-auto text-[9px] text-red-300/70">
                  Tap mic to finish
                </span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-[#A2A7B6]"
                aria-label="Add photo"
              >
                <PhotoIcon />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(event) => choosePhotos(event.target.files)}
              />
              <button
                onClick={() => void toggleVoice()}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording ? "bg-red-500" : "border border-white/[.07] bg-white/[.035]"} text-white`}
                aria-label={
                  recording ? "Stop voice recording" : "Record voice note"
                }
              >
                <MicIcon />
              </button>
              <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.08] bg-[#181B24] px-3 py-1.5 focus-within:border-violet-500/40">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  rows={1}
                  placeholder="Message"
                  className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[#626879]"
                />
              </div>
              <button
                onClick={() => void submit()}
                disabled={sending || (!input.trim() && !files.length)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05] disabled:text-[#636878]"
                aria-label="Send"
              >
                {sending ? "…" : "➤"}
              </button>
            </div>
          </div>
        </footer>
        {confirmDelete && (
          <DeleteSheet
            title="Delete this conversation from your Messages?"
            text="This only removes it from your inbox. It does not erase the other person's copy. A new message can make it appear again."
            onCancel={() => setConfirmDelete(false)}
            onDelete={() => void deleteFromMessages()}
          />
        )}
        {profileOpen && (
          <PeerProfileSheet
            person={person}
            presenceText={presenceText || ""}
            onClose={() => setProfileOpen(false)}
            onToggleBlock={() => void toggleBlock()}
            onCall={() => {
              setProfileOpen(false);
              void startCall();
            }}
            busy={blockBusy}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-start gap-3">
          {selected.size ? (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[.07] text-lg"
              aria-label="Cancel selection"
            >
              ×
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">
              WEHOUSE
            </p>
            <h1 className="mt-1 text-xl font-bold">
              {selected.size ? `${selected.size} selected` : "Messages"}
            </h1>
            <p className="mt-1 text-[10px] text-[#74798B]">
              {selected.size
                ? "Tap another conversation to add it."
                : "Updates, support and private conversations."}
            </p>
          </div>
          {selected.size ? (
            <button
              disabled={bulkDelete}
              onClick={() => void deleteSelected()}
              className="mt-1 h-10 rounded-full bg-red-500/12 px-4 text-[10px] font-semibold text-red-300 disabled:opacity-50"
            >
              {bulkDelete ? "Removing…" : "Delete"}
            </button>
          ) : (
            totalUnread > 0 && (
              <span className="mt-5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[9px] font-semibold text-violet-300">
                {totalUnread > 99 ? "99+" : totalUnread} new
              </span>
            )
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-5 lg:px-8">
        <section>
          <SectionTitle
            title="WeHouse channels"
            text="Official updates and help from the WeHouse team."
          />
          <div className="mt-3 overflow-hidden rounded-3xl border border-white/[.06] bg-[#11141C]">
            <OfficialEntryCard
              profile={profile}
              compact
              onOpen={() => setOfficialOpen(true)}
            />
            <Divider />
            <SupportEntryCard profile={profile} compact />
          </div>
        </section>
        <section>
          <SectionTitle
            title="Conversations"
            text="Long-press a chat to select one or several."
          />
          {loading ? (
            <div className="mt-3 rounded-3xl border border-white/[.06] bg-[#11141C]">
              <Loading />
            </div>
          ) : inboxItems.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-white/[.08] px-5 py-10 text-center">
              <p className="text-sm font-semibold">
                No private conversations yet
              </p>
              <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#606676]">
                Roommate chats appear after a mutual match. Worker chats appear
                when you request or receive a booking.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-3xl border border-white/[.06] bg-[#11141C]">
              {inboxItems.map((item, index) => (
                <div key={item.id}>
                  {index > 0 && <Divider />}
                  {item.kind === "roommate" ? (
                    <RoommateInboxRow
                      conv={item.roommate}
                      person={people[otherId(item.roommate)]}
                      count={unread(item.roommate)}
                      selected={selected.has(item.id)}
                      selectionMode={selected.size > 0}
                      onSelect={() => toggleSelected(item.id)}
                      onOpen={() => void openConversation(item.roommate)}
                    />
                  ) : (
                    <WorkerInboxRow
                      row={item.booking}
                      selected={selected.has(item.id)}
                      selectionMode={selected.size > 0}
                      onSelect={() => toggleSelected(item.id)}
                      onOpen={() =>
                        setActiveBooking({
                          conversationId: item.booking.conversation_id,
                          bookingId: item.booking.booking_id,
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function RoommateInboxRow({
  conv,
  person,
  count,
  onOpen,
  onSelect,
  selected,
  selectionMode,
}: {
  conv: Conversation;
  person?: Person;
  count: number;
  onOpen: () => void;
  onSelect: () => void;
  selected: boolean;
  selectionMode: boolean;
}) {
  return (
    <SelectableRow
      onOpen={onOpen}
      onSelect={onSelect}
      selectionMode={selectionMode}
      selected={selected}
    >
      <Avatar person={person} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {person?.name || "Roommate match"}
          </p>
          <span className="shrink-0 rounded-full bg-violet-500/[.08] px-2 py-0.5 text-[7px] font-semibold text-violet-300">
            ROOMMATE
          </span>
        </div>
        <p
          className={`mt-1 truncate text-[11px] ${count ? "font-medium text-[#E3E5EB]" : "text-[#777C8D]"}`}
        >
          {conv.last_message || "Start the conversation"}
        </p>
        <p className="mt-0.5 text-[9px] text-[#5F6474]">
          {formatListTime(conv.last_message_at || conv.created_at)}
        </p>
      </div>
      {count > 0 && <Unread value={count} />}
    </SelectableRow>
  );
}
function WorkerInboxRow({
  row,
  onOpen,
  onSelect,
  selected,
  selectionMode,
}: {
  row: BookingConversation;
  onOpen: () => void;
  onSelect: () => void;
  selected: boolean;
  selectionMode: boolean;
}) {
  const status = BOOKING_STATUS_LABELS[row.booking_status];
  return (
    <SelectableRow
      onOpen={onOpen}
      onSelect={onSelect}
      selectionMode={selectionMode}
      selected={selected}
    >
      <Avatar
        person={{
          name: row.other_person_name,
          avatar: row.other_person_avatar,
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {row.other_person_name || "Worker chat"}
          </p>
          <span className="shrink-0 rounded-full bg-violet-500/[.08] px-2 py-0.5 text-[7px] font-semibold text-violet-300">
            WORKER
          </span>
        </div>
        <p
          className={`mt-1 truncate text-[11px] ${row.unread_count ? "font-medium text-[#E3E5EB]" : "text-[#777C8D]"}`}
        >
          {row.last_message || row.service_type || "Worker booking"}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[9px] text-[#5F6474]">
          <span>{row.service_type || "Service"}</span>
          {status && (
            <>
              <span>·</span>
              <span>{status.label}</span>
            </>
          )}
          <span>·</span>
          <span>{formatListTime(row.last_message_time || row.updated_at)}</span>
        </div>
      </div>
      {row.unread_count > 0 && <Unread value={row.unread_count} />}
    </SelectableRow>
  );
}
function SelectableRow({
  onOpen,
  onSelect,
  selected,
  selectionMode,
  children,
}: {
  onOpen: () => void;
  onSelect: () => void;
  selected: boolean;
  selectionMode: boolean;
  children: React.ReactNode;
}) {
  const timer = useRef<number | null>(null),
    held = useRef(false);
  function begin() {
    held.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      held.current = true;
      timer.current = null;
      onSelect();
      navigator.vibrate?.(25);
    }, 420);
  }
  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  return (
    <button
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        begin();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!held.current) onSelect();
      }}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        if (selectionMode) onSelect();
        else onOpen();
      }}
      className={`flex w-full touch-pan-y select-none items-center gap-3 px-4 py-3.5 text-left transition ${selected ? "bg-violet-500/10 ring-1 ring-inset ring-violet-400/20" : "hover:bg-white/[.025]"}`}
    >
      {selectionMode && (
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${selected ? "border-violet-400 bg-violet-500" : "border-white/20"}`}
        >
          {selected ? "✓" : ""}
        </span>
      )}
      {children}
    </button>
  );
}
function RoommateBubble({
  msg,
  mine,
}: {
  msg: RoommateMessage;
  mine: boolean;
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[86%] overflow-hidden rounded-[20px] px-3.5 py-2.5 sm:max-w-[70%] ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-white/[.06] bg-[#151821]"}`}
      >
        {(msg.attachments || []).map((url, index) => (
          <PrivateAttachment
            key={`${msg.id}-${index}`}
            url={url}
            type={msg.attachment_types?.[index] || ""}
          />
        ))}
        {msg.content && (
          <p className="whitespace-pre-wrap text-[12px] leading-5">
            {msg.content}
          </p>
        )}
        <p
          className={`mt-1 text-right text-[8px] ${mine ? "text-violet-100/70" : "text-[#626677]"}`}
        >
          {time(msg.created_at)}
          {mine ? (msg.seen ? " · Seen" : " · Sent") : ""}
        </p>
      </div>
    </div>
  );
}
function PrivateAttachment({ url, type }: { url: string; type: string }) {
  if (type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url))
    return (
      <img
        src={url}
        alt="Shared photo"
        className="mb-2 max-h-80 w-auto max-w-full rounded-xl object-contain"
      />
    );
  if (type.startsWith("audio/") || /\.(webm|m4a|mp3|wav|ogg)(\?|$)/i.test(url))
    return <VoiceNotePlayer url={url} />;
  return null;
}
function VoiceNotePlayer({ url }: { url: string }) {
  const recordedSeconds = voiceDurationFromUrl(url);
  const ref = useRef<HTMLAudioElement>(null),
    [playing, setPlaying] = useState(false),
    [current, setCurrent] = useState(0),
    [total, setTotal] = useState(0);
  function toggle() {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }
  function seek(value: number) {
    if (ref.current) {
      ref.current.currentTime = value;
      setCurrent(value);
    }
  }
  async function resolveDuration(mediaDuration: number) {
    if (recordedSeconds) {
      setTotal(recordedSeconds);
      return;
    }
    try {
      const response = await fetch(url);
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      setTotal(decoded.duration || mediaDuration);
      await context.close();
    } catch {
      setTotal(mediaDuration);
    }
  }
  return (
    <div className="mb-1 flex min-w-[210px] items-center gap-2.5 rounded-2xl bg-black/15 px-2.5 py-2">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const mediaDuration = Number.isFinite(event.currentTarget.duration)
            ? event.currentTarget.duration
            : 0;
          void resolveDuration(mediaDuration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-[12px]"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
      >
        {playing ? "Ⅱ" : "▶"}
      </button>
      <div className="min-w-0 flex-1">
        <input
          aria-label="Voice note position"
          type="range"
          min={0}
          max={Math.max(total, 0.1)}
          step="0.1"
          value={Math.min(current, total || 0)}
          onChange={(event) => seek(Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer accent-white"
        />
        <p className="mt-1 text-[8px] text-white/70">
          {duration(Math.floor(current))} / {duration(Math.round(total))}
        </p>
      </div>
    </div>
  );
}
function DateDivider({ value }: { value: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-white/[.055]" />
      <span className="rounded-full bg-white/[.045] px-3 py-1 text-[8px] font-semibold text-[#858A99]">
        {dayLabel(value)}
      </span>
      <span className="h-px flex-1 bg-white/[.055]" />
    </div>
  );
}
function PeerProfileSheet({
  person,
  presenceText,
  onClose,
  onToggleBlock,
  onCall,
  busy,
}: {
  person?: Person;
  presenceText: string;
  onClose: () => void;
  onToggleBlock: () => void;
  onCall: () => void;
  busy: boolean;
}) {
  const location = [person?.city, person?.state].filter(Boolean).join(", ");
  return (
    <div className="fixed inset-0 z-[90] min-h-[100dvh] overflow-y-auto bg-[#090B10] text-white">
      <header className="sticky top-0 z-10 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center">
          <button
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full text-xl text-[#A4A9B7]"
            aria-label="Back to conversation"
          >
            ←
          </button>
          <p className="ml-2 text-sm font-semibold">Contact profile</p>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-5 pb-12 pt-8">
        <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-3xl font-bold text-violet-300">
          {person?.avatar ? (
            <img
              src={person.avatar}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            (person?.name || "W")[0].toUpperCase()
          )}
        </div>
        <h2 className="mt-5 text-center text-2xl font-bold">
          {person?.name || "Roommate"}
        </h2>
        <p className="mt-1 text-center text-[10px] text-emerald-300">
          {presenceText || "Roommate connection"}
        </p>
        <div className="mx-auto mt-7 max-w-xs">
          <ProfileAction label="Audio call" onClick={onCall}>
            <PhoneIcon />
          </ProfileAction>
        </div>
        {person?.bio && (
          <section className="mt-8 border-y border-white/[.06] py-5">
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-[#686E7D]">
              About
            </p>
            <p className="mt-2 text-[12px] leading-6 text-[#D0D3DB]">
              {person.bio}
            </p>
          </section>
        )}
        <section className="divide-y divide-white/[.06] border-b border-white/[.06]">
          {location && <ProfileDetail label="Location" value={location} />}{" "}
          {person?.occupation && (
            <ProfileDetail label="Occupation" value={person.occupation} />
          )}{" "}
          {person?.school && (
            <ProfileDetail label="Institution" value={person.school} />
          )}
        </section>
        <button
          disabled={busy}
          onClick={onToggleBlock}
          className="mt-8 h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200"
        >
          {person?.isBlocked ? "Unblock messages" : "Block messages"}
        </button>
      </main>
    </div>
  );
}
function ProfileAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 text-[10px] font-medium text-[#B9BDC8]"
    >
      <span className="grid h-14 w-14 place-items-center rounded-full bg-white/[.055] text-[#D8DAE1]">
        {children}
      </span>
      {label}
    </button>
  );
}
function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-5 py-4">
      <span className="text-[10px] text-[#6D7383]">{label}</span>
      <span className="text-right text-[11px] font-semibold text-[#DDE0E7]">
        {value}
      </span>
    </div>
  );
}
function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#A4A9B7] hover:bg-white/[.05]"
      aria-label={label}
    >
      {children}
    </button>
  );
}
function PhoneIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.9Z" />
    </svg>
  );
}
function PendingMedia({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const isVoice = file.type.startsWith("audio/");
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.06] px-3 py-2">
      <span className="text-sm">{isVoice ? "🎤" : "▧"}</span>
      <p className="max-w-36 truncate text-[9px] text-violet-200">
        {isVoice ? "Voice note" : file.name}
      </p>
      <button onClick={onRemove} className="text-[#8D91A1]">
        ×
      </button>
    </div>
  );
}
function DeleteSheet({
  title,
  text,
  onCancel,
  onDelete,
}: {
  title: string;
  text: string;
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
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-2 text-[10px] leading-5 text-[#767C8C]">{text}</p>
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
function SectionTitle({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-1 text-[9px] text-[#5F6575]">{text}</p>
    </div>
  );
}
function Avatar({ person }: { person?: Person }) {
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-semibold text-violet-300">
      {person?.avatar ? (
        <img
          src={person.avatar}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        (person?.name || "W")[0].toUpperCase()
      )}
    </div>
  );
}
function Unread({ value }: { value: number }) {
  return (
    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">
      {value > 99 ? "99+" : value}
    </span>
  );
}
function Divider() {
  return <div className="ml-[4.5rem] h-px bg-white/[.05]" />;
}
function Loading() {
  return (
    <div className="grid min-h-24 place-items-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function MessageSkeleton() {
  return (
    <div aria-label="Loading messages" className="space-y-3 py-4">
      <div className="h-14 w-3/5 animate-pulse rounded-2xl rounded-bl-md bg-white/[.05]" />
      <div className="ml-auto h-20 w-4/5 animate-pulse rounded-2xl rounded-br-md bg-violet-500/[.08]" />
      <div className="h-12 w-2/5 animate-pulse rounded-2xl rounded-bl-md bg-white/[.05]" />
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto mt-12 max-w-sm rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-[10px] leading-relaxed text-[#666A7A]">{text}</p>
    </div>
  );
}
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function dayKey(value: string) {
  return new Date(value).toDateString();
}
function dayLabel(value: string) {
  const date = new Date(value),
    now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatListTime(value: string) {
  const date = new Date(value),
    now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function duration(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function voiceDurationFromUrl(value: string) {
  const match = decodeURIComponent(value).match(/voice-\d+-(\d+)s\./i);
  return match ? Number(match[1]) : 0;
}
function PhotoIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 15-4-4L6 20" />
    </svg>
  );
}
function MicIcon() {
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
