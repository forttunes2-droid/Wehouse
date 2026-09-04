import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  deleteRoommateChatAttachment,
  getConversationById,
  getConversations,
  getMessages,
  getRoommateConversationPeople,
  hideRoommateConversation,
  markMessagesSeen,
  reactToMessage,
  sendMessage,
  setRoommateBlock,
  uploadRoommateChatAttachment,
} from "@/lib/supabase/chat";
import type { RoommatePeer } from "@/lib/supabase/chat";
import {
  BOOKING_STATUS_LABELS,
  getCommunicationBookingConversations,
  hideBookingConversation,
} from "@/lib/supabase/worker-bookings";
import { getCallCapabilities, launchPrivateCall, type PrivateCall } from "@/lib/private-calls";
import { chatPresenceLabel } from "@/lib/supabase/presence";
import useChatPresence from "@/hooks/useChatPresence";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import { conversationPresentation, getMySupportConversations, type SupportThread } from "@/lib/supabase/support";
import { toast } from "sonner";
import type { Conversation, Message, Profile } from "@/types";
import Notifications from "@/pages/Notifications";
import VoiceRecorderPanel from "@/components/VoiceRecorderPanel";
import useVoiceRecorder from "@/hooks/useVoiceRecorder";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";
import { privateConversationReadiness, type PrivateConversationReadiness } from "@/lib/e2ee";
import RoommatePublicProfile from "@/components/RoommatePublicProfile";
import SecureChatOnboarding from "@/components/SecureChatOnboarding";

type Props = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  conversationId?: string | null;
  initialMode?: "chats" | "activity";
  chatUnreadCount?: number;
  activityUnreadCount?: number;
};
type Person = Pick<RoommatePeer, "name" | "avatar"> & Partial<RoommatePeer>;
type RoommateMessage = Message & {
  attachments?: string[];
  attachment_types?: string[];
  reply_to_id?: string | null;
  reactions?: Record<string,string>;
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
  | { kind: "worker"; id: string; time: string; booking: BookingConversation }
  | { kind: "support"; id: string; time: string; support: SupportThread };
const MAX_FILES = 6,
  MAX_FILE_SIZE = 25 * 1024 * 1024;

function latestTime(...values:(string|null|undefined)[]) {
  return values.filter(Boolean).sort((a,b)=>new Date(b!).getTime()-new Date(a!).getTime())[0] || "";
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[#747A8B]"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
}

export default function Chat({ profile, conversationId, onNavigate, initialMode="chats", chatUnreadCount=0, activityUnreadCount=0 }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [bookingConversations, setBookingConversations] = useState<
      BookingConversation[]
    >([]),
    [supportThreads,setSupportThreads]=useState<SupportThread[]>([]),
    [active, setActive] = useState<Conversation | null>(null),
    [activeBooking, setActiveBooking] = useState<ActiveBooking>(null),
    [messages, setMessages] = useState<RoommateMessage[]>([]),
    [people, setPeople] = useState<Record<string, Person>>({}),
    [input, setInput] = useState(""),
    [loading, setLoading] = useState(true),
    [loadingMessages, setLoadingMessages] = useState(false),
    [sending, setSending] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [menuOpen, setMenuOpen] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [blockBusy, setBlockBusy] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [bulkDelete, setBulkDelete] = useState(false),
    [inboxFilter, setInboxFilter] = useState<"all" | "people" | "wehouse">("all"),
    [inboxQuery, setInboxQuery] = useState("");
  const [secureChat,setSecureChat]=useState<PrivateConversationReadiness|null>(null);
  const [recentRoommateCalls,setRecentRoommateCalls]=useState<Record<string,PrivateCall>>({});
  const [activeCalls,setActiveCalls]=useState<PrivateCall[]>([]);
  const [replyingTo,setReplyingTo]=useState<RoommateMessage|null>(null);
  const [messageActions,setMessageActions]=useState<string|null>(null);
  const [inboxMode,setInboxMode]=useState<"chats"|"activity">(initialMode);
  const inboxAutoSelectedRef=useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();
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

  useEffect(() => {
    if (inboxAutoSelectedRef.current || conversationId || initialMode === "activity") return;
    if (chatUnreadCount === 0 && activityUnreadCount > 0) setInboxMode("activity");
    if (chatUnreadCount > 0 || activityUnreadCount > 0) inboxAutoSelectedRef.current = true;
  }, [activityUnreadCount, chatUnreadCount, conversationId, initialMode]);

  const loadInbox = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      const conversationsRequest=getConversations(profile.user_id),peopleRequest=getRoommateConversationPeople();
      const bookingRequest=getCommunicationBookingConversations(profile.user_id),supportRequest=getMySupportConversations();
      const callsRequest=supabase.from("private_calls").select("*").eq("context_type","roommate").or(`caller_id.eq.${profile.user_id},callee_id.eq.${profile.user_id}`).order("created_at",{ascending:false}).limit(50);
      const [convResult, peerResult] = await Promise.all([conversationsRequest,peopleRequest]);
      if (convResult.error && !quiet)
        toast.error(
          convResult.error.message || "Unable to load roommate conversations",
        );
      const allRoommateRows = (convResult.conversations || []).filter(
        (row) => row.conversation_type === "roommate",
      );
      // The database returns only threads with at least one sent message.
      // A match may open an empty composer from Roommates, but an untouched
      // composer must never become an Inbox row.
      setConversations(allRoommateRows);
      setPeople(peerResult.people || {});
      setLoading(false);
      void Promise.all([bookingRequest,supportRequest,callsRequest]).then(([bookingResult,supportResult,callResult])=>{
        if (bookingResult.error && !quiet) toast.error(bookingResult.error.message || "Unable to load Worker conversations");
        const calls:Record<string,PrivateCall>={};for(const row of callResult.data||[])if(!calls[row.context_id])calls[row.context_id]=row as PrivateCall;
        setRecentRoommateCalls(calls);
        setBookingConversations((bookingResult.conversations || []) as BookingConversation[]);
        setSupportThreads(supportResult.conversations || []);
      });
      return allRoommateRows;
    },
    [profile.user_id],
  );

  const loadRoommateMessages = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) setLoadingMessages(true);
      const conversation = conversations.find((row) => row.id === id) || active;
      const peer = conversation ? otherId(conversation) : null;
      const [result,callResult] = await Promise.all([
        getMessages(id, peer),
        supabase.from("private_calls").select("*").eq("context_type","roommate").eq("context_id",id).order("created_at",{ascending:true}).limit(100),
      ]);
      if (result.error) {
        if (!quiet)
          toast.error(result.error.message || "Unable to open conversation");
        setLoadingMessages(false);
        return;
      }
      setMessages((result.messages || []) as RoommateMessage[]);
      setActiveCalls((callResult.data||[]) as PrivateCall[]);
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
    [profile.user_id, conversations, active, otherId],
  );

  useEffect(() => {
    if (!conversationId) void loadInbox();
  }, [conversationId, loadInbox]);
  useEffect(() => {
    if (!conversationId) return;
    void (async () => {
      const rows = await loadInbox(true);
      let found = rows.find((row) => row.id === conversationId);
      if (!found) {
        const direct = await getConversationById(conversationId);
        if (!direct.error && direct.conversation?.conversation_type === "roommate")
          found = direct.conversation;
      }
      if (found) {
        setActive(found);
        return;
      }
      const bookingResult=await getCommunicationBookingConversations(profile.user_id);
      const booking=((bookingResult.conversations||[]) as BookingConversation[]).find((row)=>row.conversation_id===conversationId);
      if(booking)setActiveBooking({conversationId:booking.conversation_id,bookingId:booking.booking_id});
      else toast.error("This conversation is not available. Return to Roommates and reconnect.");
    })();
  }, [conversationId, loadInbox, loadRoommateMessages, profile.user_id]);
  useEffect(() => {
    if (!active) {
      setMessages([]);
      setFiles([]);
      setMenuOpen(false);
      setConfirmDelete(false);
      setReplyingTo(null);
      setMessageActions(null);
      setActiveCalls([]);
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
  }, [active, loadRoommateMessages, loadInbox]);
  useEffect(()=>{
    if(!active){setSecureChat(null);return}
    let cancelled=false;setSecureChat(null);
    void privateConversationReadiness("roommate",active.id,otherId(active)).then(result=>{if(!cancelled)setSecureChat(result)});
    return()=>{cancelled=true};
  },[active,otherId]);
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
  }, [active, activeBooking, profile.user_id, loadInbox]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, files.length]);

  async function openConversation(conv: Conversation) {
    setActive(conv);
    setInput("");
    setFiles([]);
    setMenuOpen(false);
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
    if (voice.recording) return voice.finish();
    if (files.length >= MAX_FILES)
      return toast.error("Remove an attachment before recording a voice note");
    try {
      await voice.start();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Microphone permission is required for voice notes");
    }
  }
  async function submit() {
    if (!active || sending || (!input.trim() && !files.length)) return;
    if (secureChat?.state !== "ready") return toast.error("Secure chat is not ready yet");
    setSending(true);
    const paths: string[] = [], attachments: Array<{path:string;file_iv:string;metadata_ciphertext:string;metadata_iv:string}> = [],
      types: string[] = [];
    try {
      for (const file of files) {
        const uploaded = await uploadRoommateChatAttachment(file, active.id, otherId(active));
        if (uploaded.error || !uploaded.path || !uploaded.attachment)
          throw new Error(
            uploaded.error?.message || `Could not upload ${file.name}`,
          );
        paths.push(uploaded.path);
        attachments.push(uploaded.attachment);
        types.push(uploaded.type || file.type);
      }
      const result = await sendMessage(active.id, otherId(active), input.trim(), attachments, types, replyingTo?.id||null);
      if (result.error || !result.message)
        throw new Error(result.error?.message || "Message could not be sent");
      setInput("");
      setFiles([]);
      setReplyingTo(null);
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
    toast.success("Conversation removed from your Inbox");
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
      return toast.error(error.message || "Could not update this block");
    setPeople((current) => ({
      ...current,
      [peerId]: { ...current[peerId], isBlocked: nextBlocked },
    }));
    setMenuOpen(false);
    toast.success(
      nextBlocked ? "This person is blocked from matching, messaging and calling" : "Person unblocked",
    );
  }
  async function startCall(callType: "audio" | "video") {
    if (!active) return;
    const { capabilities, error } = await getCallCapabilities(
      "roommate",
      active.id,
    );
    if (error || !capabilities)
      return toast.error(error?.message || "Call is not available");
    const allowed = callType === "audio" ? capabilities.allow_audio_calls : capabilities.allow_video_calls;
    if (!allowed) return toast.error(`This person is not accepting ${callType} calls`);
    launchPrivateCall("roommate", active.id, callType);
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
    else toast.success("Selected conversations removed from Inbox");
  }

  const inboxItems = useMemo<InboxItem[]>(
    () =>
      [
        ...conversations.map((conv) => ({
          kind: "roommate" as const,
          id: `roommate:${conv.id}`,
          time: latestTime(recentRoommateCalls[conv.id]?.created_at,conv.last_message_at,conv.created_at),
          roommate: conv,
        })),
        ...bookingConversations.map((booking) => ({
          kind: "worker" as const,
          id: `worker:${booking.conversation_id}`,
          time: booking.last_message_time || booking.updated_at,
          booking,
        })),
        ...supportThreads.map((support) => ({
          kind: "support" as const,
          id: `support:${support.conversation_id}`,
          time: support.last_message_time || support.created_at,
          support,
        })),
      ].sort(
        (a, b) =>
          new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime(),
      ),
    [conversations, bookingConversations, supportThreads, recentRoommateCalls],
  );
  const totalUnread =
    conversations.reduce((sum, row) => sum + (unread(row) > 0 ? 1 : 0), 0) +
    bookingConversations.reduce(
      (sum, row) => sum + (Number(row.unread_count || 0) > 0 ? 1 : 0),
      0,
    ) + supportThreads.reduce((sum,row)=>sum+(Number(row.unread_count||0)>0?1:0),0);
  const visibleInboxItems = useMemo(() => {
    const query = inboxQuery.trim().toLowerCase();
    return inboxItems.filter((item) => {
      if (inboxFilter === "people" && item.kind === "support") return false;
      if (inboxFilter === "wehouse" && item.kind !== "support") return false;
      if (!query) return true;
      const searchable = item.kind === "roommate"
        ? [people[otherId(item.roommate)]?.name, item.roommate.last_message]
        : item.kind === "worker"
          ? [item.booking.other_person_name, item.booking.service_type, item.booking.last_message, item.booking.booking_code]
          : (() => { const view = conversationPresentation(item.support); return [view.title, view.operator, view.meta, item.support.subject, item.support.last_message]; })();
      return searchable.filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [inboxFilter, inboxItems, inboxQuery, otherId, people]);

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
    const timeline=[
      ...messages.map(message=>({kind:"message" as const,time:message.created_at,id:`message:${message.id}`,message})),
      ...activeCalls.map(call=>({kind:"call" as const,time:call.created_at,id:`call:${call.id}`,call})),
    ].sort((a,b)=>new Date(a.time).getTime()-new Date(b.time).getTime()||a.id.localeCompare(b.id));
    return (
      <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col bg-[#090A0F] text-white">
        <header className="relative shrink-0 border-b border-white/[.06] bg-[#10131B]/97 px-3 py-2.5 backdrop-blur-xl sm:px-4">
          <div className="mx-auto flex max-w-3xl items-center gap-1">
            <button
              onClick={() => setActive(null)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9699A8] hover:bg-white/[.05]"
              aria-label="Back to Inbox"
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
            <HeaderAction label="Audio call" onClick={() => void startCall("audio")}>
              <PhoneIcon />
            </HeaderAction>
            <HeaderAction label="Video call" onClick={() => void startCall("video")}>
              <VideoIcon />
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
                  {person?.isBlocked ? "Unblock person" : "Block person"}
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
                <span>Remove from my Inbox</span>
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
            {timeline.map((event, index) => (
              <div key={event.id}>
                {index === 0 || dayKey(timeline[index - 1].time) !== dayKey(event.time) ? (
                  <DateDivider value={event.time} />
                ) : null}
                {event.kind==="call"?<CallTimelineEvent call={event.call} me={profile.user_id}/>:<RoommateBubble
                  msg={event.message}
                  mine={event.message.sender_id === profile.user_id}
                  quoted={event.message.reply_to_id?messages.find(row=>row.id===event.message.reply_to_id):undefined}
                  actionsOpen={messageActions===event.message.id}
                  onToggleActions={()=>setMessageActions(current=>current===event.message.id?null:event.message.id)}
                  onReply={()=>{setReplyingTo(event.message);setMessageActions(null)}}
                  onReact={async emoji=>{const current=event.message.reactions?.[profile.user_id];const result=await reactToMessage(active.id,event.message.id,current===emoji?null:emoji);if(result.error)return toast.error(result.error.message);setMessages(rows=>rows.map(row=>row.id===event.message.id?{...row,reactions:result.reactions}:row));setMessageActions(null)}}
                />}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </main>
        <footer className="shrink-0 border-t border-white/[.06] bg-[#10131B]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
          <div className="mx-auto max-w-3xl">
            {person?.isBlocked ? <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-amber-500/15 bg-amber-500/[.05] px-4"><p className="text-[10px] text-amber-100">This person is blocked. Matching, messages and calls are off.</p><button type="button" onClick={()=>void toggleBlock()} className="shrink-0 text-[10px] font-semibold text-violet-300">Unblock</button></div> : !secureChat?<div className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/[.07] px-4 py-3 text-[10px] text-[#858B9B]"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-400"/>Checking private chat…</div>:secureChat.state!=="ready"?<SecureChatOnboarding status={secureChat} personName={person?.name||"This person"} onReady={()=>{setSecureChat(null);void privateConversationReadiness("roommate",active.id,otherId(active)).then(result=>{setSecureChat(result);if(result.state==="ready")void loadRoommateMessages(active.id,true)})}}/> : <>{files.length > 0 && (
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
            {replyingTo&&<div className="mb-2 flex items-center gap-3 rounded-2xl border-l-2 border-violet-400 bg-white/[.035] px-3 py-2"><div className="min-w-0 flex-1"><p className="text-[8px] font-semibold text-violet-300">Replying to {replyingTo.sender_id===profile.user_id?"yourself":person?.name||"message"}</p><p className="mt-0.5 truncate text-[10px] text-[#A1A6B4]">{replyingTo.content||((replyingTo.attachments||[]).length?"Attachment":"Message")}</p></div><button type="button" onClick={()=>setReplyingTo(null)} className="grid h-8 w-8 place-items-center text-[#818797]" aria-label="Cancel reply">×</button></div>}
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
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${voice.recording ? "bg-red-500" : "border border-white/[.07] bg-white/[.035]"} text-white`}
                aria-label={
                  voice.recording ? "Finish voice recording" : "Record voice note"
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
            </div></>}
          </div>
        </footer>
        {confirmDelete && (
          <DeleteSheet
            title="Remove this conversation from your Inbox?"
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
            onAudioCall={() => {
              setProfileOpen(false);
              void startCall("audio");
            }}
            onVideoCall={() => { setProfileOpen(false); void startCall("video"); }}
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
              {selected.size ? `${selected.size} selected` : "Inbox"}
            </h1>
            <p className="mt-1 text-[10px] text-[#74798B]">
              {selected.size
                ? "Tap another conversation to add it."
                : "Chats and activity connected to your WeHouse life."}
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
      <main className="mx-auto max-w-5xl px-4 py-4 sm:px-5 lg:px-8">
        <div className="mb-4 flex border-b border-white/[.07]" aria-label="Inbox views">
          {([['chats','Chats',chatUnreadCount],['activity','Activity',activityUnreadCount]] as const).map(([id,label,count])=><button key={id} type="button" onClick={()=>setInboxMode(id)} className={`relative flex-1 py-3 text-[11px] font-semibold ${inboxMode===id?'text-violet-300 after:absolute after:inset-x-10 after:bottom-0 after:h-0.5 after:bg-violet-400':'text-[#74798A]'}`}>{label}{count>0&&<span className={`ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[8px] font-bold ${inboxMode===id?'bg-violet-500 text-white':'bg-red-500 text-white'}`}>{count>99?'99+':count}</span>}</button>)}
        </div>
        {inboxMode==='activity'?<Notifications profile={profile} embedded onNavigate={onNavigate}/>:
        <section>
          <label className="flex h-11 items-center gap-3 rounded-2xl border border-white/[.07] bg-[#11141C] px-4 focus-within:border-violet-500/35">
            <SearchIcon />
            <input value={inboxQuery} onChange={(event) => setInboxQuery(event.target.value)} placeholder="Search conversations" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#626879]" />
          </label>
          <div className="mt-3 flex gap-1 rounded-2xl border border-white/[.06] bg-[#0E1118] p-1" aria-label="Conversation filters">
            {([['all','All'],['people','People'],['wehouse','WeHouse']] as const).map(([id,label]) => <button key={id} type="button" onClick={() => setInboxFilter(id)} className={`min-h-9 flex-1 rounded-xl text-[10px] font-semibold ${inboxFilter===id?'bg-violet-500 text-white':'text-[#7A8090]'}`}>{label}</button>)}
          </div>
          {loading ? (
            <div className="mt-3 rounded-3xl border border-white/[.06] bg-[#11141C]">
              <Loading />
            </div>
          ) : visibleInboxItems.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-white/[.08] px-5 py-10 text-center">
              <p className="text-sm font-semibold">
                {inboxQuery.trim() ? "No matching conversations" : inboxFilter === "wehouse" ? "No WeHouse conversations" : inboxFilter === "people" ? "No private conversations" : "No conversations yet"}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#606676]">
                {inboxQuery.trim() ? "Try a person, service, property or reservation name." : "Conversations appear after someone sends the first message in a roommate chat, service booking, reservation or WeHouse help case."}
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/[.06] bg-[#11141C]">
              {visibleInboxItems.map((item, index) => (
                <div key={item.id}>
                  {index > 0 && <Divider />}
                  {item.kind === "roommate" ? (
                    <RoommateInboxRow
                      conv={item.roommate}
                      person={people[otherId(item.roommate)]}
                      count={unread(item.roommate) > 0 ? 1 : 0}
                      recentCall={recentRoommateCalls[item.roommate.id]}
                      selected={selected.has(item.id)}
                      selectionMode={selected.size > 0}
                      onSelect={() => toggleSelected(item.id)}
                      onOpen={() => void openConversation(item.roommate)}
                    />
                  ) : item.kind === "worker" ? (
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
                  ) : item.kind === "support" ? (
                    <SupportInboxRow thread={item.support} onOpen={()=>window.dispatchEvent(new CustomEvent("openSupportChat",{detail:{conversationId:item.support.conversation_id,contextType:item.support.context_type,contextId:item.support.context_id}}))}/>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>}
      </main>
    </div>
  );
}

function RoommateInboxRow({
  conv,
  person,
  count,
  recentCall,
  onOpen,
  onSelect,
  selected,
  selectionMode,
}: {
  conv: Conversation;
  person?: Person;
  count: number;
  recentCall?: PrivateCall;
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
          {conv.last_message || (recentCall ? `${recentCall.status === "missed" ? "Missed" : "Recent"} ${recentCall.call_type} call` : "Start the conversation")}
        </p>
        <p className="mt-0.5 text-[9px] text-[#5F6474]">
          {formatListTime(recentCall?.created_at || conv.last_message_at || conv.created_at)}
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
      {row.unread_count > 0 && <Unread value={1} />}
    </SelectableRow>
  );
}
function SupportInboxRow({thread,onOpen}:{thread:SupportThread;onOpen:()=>void}){
  const p=conversationPresentation(thread);
  const badge=p.kind==='reservation'?'RESERVATION':p.kind==='property_operations'?'PROPERTY':'WEHOUSE';
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025]"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-500/15 font-semibold text-violet-300">W</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.title}</p><span className="shrink-0 rounded-full bg-emerald-500/[.08] px-2 py-0.5 text-[7px] font-semibold text-emerald-300">{badge}</span></div><p className={`mt-1 truncate text-[11px] ${thread.unread_count?"font-medium text-[#E3E5EB]":"text-[#777C8D]"}`}>{thread.last_message||p.operator}</p><p className="mt-0.5 truncate text-[9px] text-[#5F6474]">{[p.operator,p.meta,formatListTime(thread.last_message_time||thread.created_at)].filter(Boolean).join(' · ')}</p></div>{thread.unread_count>0&&<Unread value={1}/>}</button>
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
  quoted,
  actionsOpen,
  onToggleActions,
  onReply,
  onReact,
}: {
  msg: RoommateMessage;
  mine: boolean;
  quoted?: RoommateMessage;
  actionsOpen:boolean;
  onToggleActions:()=>void;
  onReply:()=>void;
  onReact:(emoji:string)=>void;
}) {
  const reactions=Object.values(msg.reactions||{}).reduce<Record<string,number>>((all,emoji)=>({...all,[emoji]:(all[emoji]||0)+1}),{});
  return (
    <div className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        onClick={onToggleActions}
        className={`relative max-w-[86%] cursor-pointer rounded-[20px] px-3.5 py-2.5 sm:max-w-[70%] ${mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-white/[.06] bg-[#151821]"}`}
      >
        {quoted&&<div className={`mb-2 rounded-xl border-l-2 px-2.5 py-2 ${mine?"border-violet-100/70 bg-black/10":"border-violet-400 bg-white/[.035]"}`}><p className="text-[8px] font-semibold opacity-75">{quoted.sender_id===msg.sender_id?"Earlier message":"Reply"}</p><p className="mt-0.5 line-clamp-2 text-[10px] opacity-80">{quoted.content||((quoted.attachments||[]).length?"Attachment":"Message")}</p></div>}
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
        {Object.keys(reactions).length>0&&<div className={`absolute -bottom-3 ${mine?"right-2":"left-2"} flex gap-1 rounded-full border border-white/[.08] bg-[#171A22] px-2 py-0.5 text-[10px] shadow-lg`}>{Object.entries(reactions).map(([emoji,count])=><span key={emoji}>{emoji}{count>1?<small className="ml-0.5 text-[7px] text-[#A6AAB6]">{count}</small>:null}</span>)}</div>}
      </div>
      {actionsOpen&&<div className="mt-3 flex items-center gap-1 rounded-full border border-white/[.08] bg-[#171A22] p-1 shadow-xl"><button type="button" onClick={onReply} className="rounded-full px-3 py-1.5 text-[9px] font-semibold text-violet-300">Reply</button>{["👍","❤️","😂","😮","😢","🙏"].map(emoji=><button type="button" key={emoji} onClick={()=>onReact(emoji)} className="grid h-8 w-8 place-items-center rounded-full text-sm hover:bg-white/[.06]">{emoji}</button>)}</div>}
    </div>
  );
}
function CallTimelineEvent({call,me}:{call:PrivateCall;me:string}){
  const outgoing=call.caller_id===me,ended=call.ended_at?new Date(call.ended_at).getTime():0,answered=call.answered_at?new Date(call.answered_at).getTime():0;
  const duration=ended&&answered?Math.max(0,Math.round((ended-answered)/1000)):0;
  return <div className="my-2 flex justify-center"><div className="flex max-w-[88%] items-center gap-2 rounded-full border border-white/[.06] bg-[#141720] px-3 py-2 text-[9px]"><span className={call.status==="missed"||call.status==="failed"?"text-red-300":"text-violet-300"}>{call.call_type==="video"?"▣":"☎"}</span><span className="font-medium text-[#B8BCC7]">{outgoing?"Outgoing":"Incoming"} {call.call_type} call</span><span className={call.status==="missed"||call.status==="failed"?"text-red-300":"text-[#747A8A]"}>{call.status}{duration?` · ${Math.floor(duration/60)?`${Math.floor(duration/60)}m `:""}${duration%60}s`:""} · {time(call.created_at)}</span></div></div>
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
  onAudioCall,
  onVideoCall,
  busy,
}: {
  person?: Person;
  presenceText: string;
  onClose: () => void;
  onToggleBlock: () => void;
  onAudioCall: () => void;
  onVideoCall: () => void;
  busy: boolean;
}) {
  const location = [person?.city, person?.state].filter(Boolean).join(", ");
  return <RoommatePublicProfile context="conversation" person={{name:person?.name||'Roommate',avatar:person?.avatar,location,bio:person?.bio,school:person?.isStudent?person.school:null,occupation:person?.occupation}} presence={presenceText||'Roommate connection'} onClose={onClose} actions={<div className="mx-auto flex max-w-xs justify-center gap-12">
          <ProfileAction label="Audio" onClick={onAudioCall}>
            <PhoneIcon />
          </ProfileAction>
          <ProfileAction label="Video" onClick={onVideoCall}><VideoIcon /></ProfileAction>
        </div>} footer={<button
          disabled={busy}
          onClick={onToggleBlock}
          className="mt-8 h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200"
        >
          {person?.isBlocked ? "Unblock person" : "Block person"}
        </button>}/>;
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
function VideoIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="14" height="14" rx="3" /><path d="m17 10 4-2v8l-4-2" /></svg>;
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
  return <div className="min-h-24" role="status" aria-label="Loading messages" />;
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
