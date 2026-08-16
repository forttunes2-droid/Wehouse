import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, getConversations, getMessages, sendMessage, markMessagesSeen } from '@/lib/supabase';
import { deleteRoommateChatAttachment, getRoommateConversationPeople, hideRoommateConversation, uploadRoommateChatAttachment } from '@/lib/supabase/chat';
import { BOOKING_STATUS_LABELS, getCommunicationBookingConversations } from '@/lib/supabase/worker-bookings';
import { launchPrivateCall } from '@/lib/private-calls';
import { chatPresenceLabel } from '@/lib/supabase/presence';
import useChatPresence from '@/hooks/useChatPresence';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import OfficialChannel from '@/components/OfficialChannel';
import OfficialEntryCard from '@/components/OfficialEntryCard';
import SupportEntryCard from '@/components/SupportEntryCard';
import { toast } from 'sonner';
import type { Conversation, Message, Profile } from '@/types';

type Props = { profile: Profile; onNavigate: (page: string) => void; conversationId?: string | null };
type Person = { name: string; avatar: string | null };
type RoommateMessage = Message & { attachments?: string[]; attachment_types?: string[] };
type BookingConversation = { conversation_id: string; booking_id: string; booking_code: string; booking_status: string; service_type: string; negotiated_amount: number; other_person_id: string | null; other_person_name: string; other_person_avatar: string | null; last_message: string | null; last_message_time: string | null; unread_count: number; updated_at: string };
type ActiveBooking = { conversationId: string; bookingId: string } | null;
type InboxItem = { kind: 'roommate'; id: string; time: string; roommate: Conversation } | { kind: 'worker'; id: string; time: string; booking: BookingConversation };
const MAX_FILES = 6;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function ChatPhase10({ profile, onNavigate, conversationId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bookingConversations, setBookingConversations] = useState<BookingConversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking>(null);
  const [messages, setMessages] = useState<RoommateMessage[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [officialOpen, setOfficialOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editWindow, setEditWindow] = useState(10);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [now, setNow] = useState(Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const otherId = useCallback((conv: Conversation) => conv.participant_a === profile.user_id ? conv.participant_b : conv.participant_a, [profile.user_id]);
  const unread = useCallback((conv: Conversation) => Number(conv.participant_a === profile.user_id ? conv.unread_a : conv.unread_b) || 0, [profile.user_id]);
  const peerId = active ? otherId(active) : null;
  const presence = useChatPresence(peerId);
  const presenceText = chatPresenceLabel(presence);

  const loadInbox = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [convResult, peerResult, bookingResult] = await Promise.all([getConversations(profile.user_id), getRoommateConversationPeople(), getCommunicationBookingConversations(profile.user_id)]);
    if (convResult.error && !quiet) toast.error(convResult.error.message || 'Unable to load roommate conversations');
    if (bookingResult.error && !quiet) toast.error(bookingResult.error.message || 'Unable to load Worker conversations');
    const rows = (convResult.conversations || []).filter((row) => row.conversation_type === 'roommate');
    setConversations(rows); setPeople(peerResult.people || {}); setBookingConversations((bookingResult.conversations || []) as BookingConversation[]); setLoading(false); return rows;
  }, [profile.user_id]);

  const loadRoommateMessages = useCallback(async (id: string) => {
    const result = await getMessages(id);
    if (result.error) { toast.error(result.error.message || 'Unable to open conversation'); return; }
    setMessages((result.messages || []) as RoommateMessage[]);
    await markMessagesSeen(id);
  }, []);

  useEffect(() => { void loadInbox(); }, [loadInbox]);
  useEffect(() => {
    void supabase.rpc('get_setting_v2', { p_key: 'message_edit_window_minutes' }).then(({ data }) => {
      const raw: any = data; const value = Number(Array.isArray(raw) ? raw[0]?.value : raw?.value ?? raw);
      if (Number.isFinite(value) && value > 0) setEditWindow(value);
    });
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!conversationId) return;
    const route = (window.location.hash || '').replace(/^#/, '').split('?')[0];
    if (route !== 'chat') return;
    void (async () => { const rows = await loadInbox(true); const found = rows.find((row) => row.id === conversationId); if (found) { setActive(found); void loadRoommateMessages(found.id); } })();
  }, [conversationId, loadInbox, loadRoommateMessages]);
  useEffect(() => {
    if (!active) { setMessages([]); setFiles([]); setMenuOpen(false); setConfirmDelete(false); setEditingId(null); setEditText(''); return; }
    void loadRoommateMessages(active.id);
    const channel = supabase.channel(`roommate-chat-${active.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${active.id}` }, () => { void loadRoommateMessages(active.id); void loadInbox(true); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${active.id}` }, () => void loadRoommateMessages(active.id))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active?.id, loadRoommateMessages, loadInbox]);
  useEffect(() => {
    if (active || activeBooking) return;
    const channel = supabase.channel(`message-inbox:${profile.user_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => void loadInbox(true))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_messages' }, () => void loadInbox(true))
      .subscribe();
    const timer = window.setInterval(() => void loadInbox(true), 20000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [active?.id, activeBooking?.conversationId, profile.user_id, loadInbox]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, files.length]);
  useEffect(() => { if (!recording) { setRecordSeconds(0); return; } const timer = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [recording]);
  useEffect(() => () => { if (mediaRef.current?.state === 'recording') mediaRef.current.stop(); }, []);

  async function openConversation(conv: Conversation) { setActive(conv); setInput(''); setFiles([]); setMenuOpen(false); await loadRoommateMessages(conv.id); }
  function choosePhotos(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((file) => { if (!file.type.startsWith('image/')) { toast.error(`${file.name} is not a photo`); return false; } if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} is larger than 25MB`); return false; } return true; });
    setFiles((current) => { const next = [...current, ...incoming].slice(0, MAX_FILES); if (current.length + incoming.length > MAX_FILES) toast.error('You can send up to 6 items at once'); return next; });
    if (fileRef.current) fileRef.current.value = '';
  }
  async function toggleVoice() {
    if (recording) { mediaRef.current?.stop(); return; }
    if (files.length >= MAX_FILES) return toast.error('Remove an attachment before recording a voice note');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { const type = recorder.mimeType || 'audio/webm'; const blob = new Blob(chunksRef.current, { type }); const ext = type.includes('mp4') ? 'm4a' : 'webm'; setFiles((current) => [...current, new File([blob], `voice-${Date.now()}.${ext}`, { type })].slice(0, MAX_FILES)); stream.getTracks().forEach((track) => track.stop()); setRecording(false); };
      mediaRef.current = recorder; recorder.start(); setRecording(true);
    } catch { toast.error('Microphone permission is required for voice notes'); }
  }
  async function submit() {
    if (!active || sending || (!input.trim() && !files.length)) return;
    setSending(true); const paths: string[] = []; const types: string[] = [];
    try {
      for (const file of files) { const uploaded = await uploadRoommateChatAttachment(file, active.id); if (uploaded.error || !uploaded.path) throw new Error(uploaded.error?.message || `Could not upload ${file.name}`); paths.push(uploaded.path); types.push(uploaded.type || file.type); }
      const result = await sendMessage(active.id, input.trim(), paths, types); if (result.error || !result.message) throw new Error(result.error?.message || 'Message could not be sent');
      setInput(''); setFiles([]); await loadRoommateMessages(active.id); void loadInbox(true);
    } catch (error: any) { for (const path of paths) await deleteRoommateChatAttachment(path); toast.error(error?.message || 'Message could not be sent'); }
    finally { setSending(false); }
  }
  async function saveEdit(messageId: string) {
    const text = editText.trim(); if (!text) return toast.error('Message cannot be empty');
    const { error } = await supabase.rpc('edit_my_roommate_message', { p_message_id: messageId, p_content: text });
    if (error) return toast.error(error.message);
    setEditingId(null); setEditText(''); if (active) await loadRoommateMessages(active.id); void loadInbox(true);
  }
  async function deleteFromMessages() { if (!active) return; const { hidden, error } = await hideRoommateConversation(active.id); if (error || !hidden) return toast.error(error?.message || 'Could not remove conversation'); toast.success('Conversation removed from your Messages'); setConfirmDelete(false); setMenuOpen(false); setActive(null); await loadInbox(true); }

  const inboxItems = useMemo<InboxItem[]>(() => [
    ...conversations.map((conv) => ({ kind: 'roommate' as const, id: `roommate:${conv.id}`, time: conv.last_message_at || conv.created_at, roommate: conv })),
    ...bookingConversations.map((booking) => ({ kind: 'worker' as const, id: `worker:${booking.conversation_id}`, time: booking.last_message_time || booking.updated_at, booking })),
  ].sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()), [conversations, bookingConversations]);
  const totalUnread = conversations.reduce((sum, row) => sum + unread(row), 0) + bookingConversations.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);

  if (officialOpen) return <OfficialChannel profile={profile} onBack={() => setOfficialOpen(false)} />;
  if (activeBooking) return <BookingNegotiationChat conversationId={activeBooking.conversationId} bookingId={activeBooking.bookingId} profile={profile} isWorker={profile.role === 'worker'} onClose={() => { setActiveBooking(null); void loadInbox(true); }} />;

  if (active) {
    const person = people[otherId(active)];
    return <div className="flex min-h-[100dvh] flex-col bg-[#090A0F] text-white">
      <header className="sticky top-0 z-20 shrink-0 border-b border-white/[.06] bg-[#0E1118]/96 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-3xl items-center gap-1.5 px-3 py-2.5 sm:gap-2.5 sm:px-4"><button onClick={() => setActive(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9699A8] hover:bg-white/[.05]" aria-label="Back to Messages">←</button><Avatar person={person} /><div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold">{person?.name || 'Roommate match'}</p><p className={`mt-0.5 truncate text-[9px] ${presence?.online ? 'text-emerald-300' : 'text-[#6D7282]'}`}>{presenceText || 'Private roommate conversation'}</p></div><button onClick={() => launchPrivateCall('roommate', active.id, 'audio')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#A7ACBA] hover:bg-white/[.05] hover:text-white" aria-label="Audio call"><CallPhoneIcon /></button><button onClick={() => launchPrivateCall('roommate', active.id, 'video')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#A7ACBA] hover:bg-white/[.05] hover:text-white" aria-label="Video call"><CallVideoIcon /></button><button onClick={() => setMenuOpen((value) => !value)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl text-[#8E93A3] hover:bg-white/[.05]">⋯</button></div>
        {menuOpen && <div className="absolute right-3 top-[3.65rem] z-30 w-56 overflow-hidden rounded-2xl border border-white/[.08] bg-[#171B24] p-1.5 shadow-2xl"><div className="px-3 py-2 text-[8px] leading-4 text-[#6D7485]">Audio/video calls respect each person's Privacy settings.</div><button onClick={() => { setMenuOpen(false); setConfirmDelete(true); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-red-300 hover:bg-red-500/[.07]">⌫ <span>Delete from my Messages</span></button></div>}
      </header>
      <main className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(124,58,237,.055),transparent_30%)] px-3 py-4 sm:px-4"><div className="mx-auto max-w-3xl space-y-2.5">{messages.length === 0 && <Empty title="Start your conversation" text="You both accepted the roommate match. Share photos, voice notes or a message while you discuss living plans." />}{messages.map((msg) => { const mine = msg.sender_id === profile.user_id; const canEdit = mine && Boolean(String(msg.content || '').trim()) && now <= new Date(msg.created_at).getTime() + editWindow * 60000; return <RoommateBubble key={msg.id} msg={msg} mine={mine} canEdit={canEdit} editing={editingId === msg.id} editText={editText} setEditText={setEditText} startEdit={() => { setEditingId(msg.id); setEditText(String(msg.content || '')); }} cancelEdit={() => { setEditingId(null); setEditText(''); }} saveEdit={() => void saveEdit(msg.id)} />; })}<div ref={bottomRef} /></div></main>
      <footer className="sticky bottom-0 z-20 shrink-0 border-t border-white/[.06] bg-[#0E1118]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl sm:px-4"><div className="mx-auto max-w-3xl">{files.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{files.map((file, index) => <PendingMedia key={`${file.name}-${index}`} file={file} onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))} />)}</div>}{recording && <div className="mb-2 flex items-center gap-2 rounded-xl bg-red-500/[.08] px-3 py-2 text-[10px] text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />Recording voice note <span className="font-mono">{duration(recordSeconds)}</span><span className="ml-auto text-[9px] text-red-300/70">Tap mic to finish</span></div>}<div className="flex items-end gap-2"><button onClick={() => fileRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-[#A2A7B6]" aria-label="Add photo"><PhotoIcon /></button><input ref={fileRef} type="file" multiple accept="image/*" className="hidden" onChange={(event) => choosePhotos(event.target.files)} /><button onClick={() => void toggleVoice()} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording ? 'bg-red-500' : 'border border-white/[.07] bg-white/[.035]'} text-white`} aria-label={recording ? 'Stop voice recording' : 'Record voice note'}><MicIcon /></button><div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.08] bg-[#181B24] px-3 py-1.5 focus-within:border-violet-500/40"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={1} placeholder="Message" className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[#626879]" /></div><button onClick={() => void submit()} disabled={sending || (!input.trim() && !files.length)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05] disabled:text-[#636878]" aria-label="Send">{sending ? '…' : '➤'}</button></div></div></footer>
      {confirmDelete && <DeleteSheet title="Delete this conversation from your Messages?" text="This only removes it from your inbox. It does not erase the other person's copy. A new message can make it appear again." onCancel={() => setConfirmDelete(false)} onDelete={() => void deleteFromMessages()} />}
    </div>;
  }

  return <div className="min-h-[100dvh] bg-[#090A0F] pb-24 text-white">
    <header className="sticky top-0 z-20 border-b border-white/[.06] bg-[#0E1118]/96 px-4 py-4 backdrop-blur-xl"><div className="mx-auto flex max-w-3xl items-center gap-3"><button onClick={() => onNavigate('home')} className="grid h-10 w-10 place-items-center rounded-full text-[#8C909F] hover:bg-white/[.05]">←</button><div className="min-w-0 flex-1"><h1 className="text-xl font-bold">Messages</h1><p className="mt-0.5 text-[10px] text-[#65697A]">WeHouse updates, support and private conversations.</p></div>{totalUnread > 0 && <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[9px] font-semibold text-violet-300">{totalUnread > 99 ? '99+' : totalUnread} new</span>}</div></header>
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-5">
      <section><SectionTitle title="WeHouse channels" text="Official updates and real Support conversations." /><div className="mt-3 overflow-hidden rounded-3xl border border-white/[.06] bg-[#11141C]"><OfficialEntryCard profile={profile} compact onOpen={() => setOfficialOpen(true)} /><Divider /><SupportEntryCard profile={profile} compact /></div></section>
      <section><SectionTitle title="Private conversations" text="Roommate and Worker chats stay in one clean inbox." />{loading ? <div className="mt-3 rounded-3xl border border-white/[.06] bg-[#11141C]"><Loading /></div> : inboxItems.length === 0 ? <div className="mt-3 rounded-3xl border border-dashed border-white/[.08] px-5 py-10 text-center"><p className="text-sm font-semibold">No private conversations yet</p><p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#606676]">Roommate chats appear after a mutual match. Worker chats appear when you request or receive a booking.</p></div> : <div className="mt-3 overflow-hidden rounded-3xl border border-white/[.06] bg-[#11141C]">{inboxItems.map((item, index) => <div key={item.id}>{index > 0 && <Divider />}{item.kind === 'roommate' ? <RoommateInboxRow conv={item.roommate} person={people[otherId(item.roommate)]} count={unread(item.roommate)} onOpen={() => void openConversation(item.roommate)} /> : <WorkerInboxRow row={item.booking} onOpen={() => setActiveBooking({ conversationId: item.booking.conversation_id, bookingId: item.booking.booking_id })} />}</div>)}</div>}</section>
    </main>
  </div>;
}

function RoommateInboxRow({ conv, person, count, onOpen }: { conv: Conversation; person?: Person; count: number; onOpen: () => void }) { return <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025]"><Avatar person={person} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{person?.name || 'Roommate match'}</p><span className="shrink-0 rounded-full bg-violet-500/[.08] px-2 py-0.5 text-[7px] font-semibold text-violet-300">ROOMMATE</span></div><p className={`mt-1 truncate text-[11px] ${count ? 'font-medium text-[#E3E5EB]' : 'text-[#777C8D]'}`}>{conv.last_message || 'Start the conversation'}</p><p className="mt-0.5 text-[9px] text-[#5F6474]">{formatListTime(conv.last_message_at || conv.created_at)}</p></div>{count > 0 && <Unread value={count} />}</button>; }
function WorkerInboxRow({ row, onOpen }: { row: BookingConversation; onOpen: () => void }) { const status = BOOKING_STATUS_LABELS[row.booking_status]; return <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025]"><Avatar person={{ name: row.other_person_name, avatar: row.other_person_avatar }} /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{row.other_person_name || 'Worker chat'}</p><span className="shrink-0 rounded-full bg-blue-500/[.08] px-2 py-0.5 text-[7px] font-semibold text-blue-300">WORKER</span></div><p className={`mt-1 truncate text-[11px] ${row.unread_count ? 'font-medium text-[#E3E5EB]' : 'text-[#777C8D]'}`}>{row.last_message || row.service_type || 'Worker booking'}</p><div className="mt-0.5 flex items-center gap-2 text-[9px] text-[#5F6474]"><span>{row.service_type || 'Service'}</span>{status && <><span>·</span><span>{status.label}</span></>}<span>·</span><span>{formatListTime(row.last_message_time || row.updated_at)}</span></div></div>{row.unread_count > 0 && <Unread value={row.unread_count} />}</button>; }
function RoommateBubble({ msg, mine, canEdit, editing, editText, setEditText, startEdit, cancelEdit, saveEdit }: { msg: RoommateMessage; mine: boolean; canEdit: boolean; editing: boolean; editText: string; setEditText: (value: string) => void; startEdit: () => void; cancelEdit: () => void; saveEdit: () => void }) { return <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] overflow-hidden rounded-[22px] px-3.5 py-2.5 sm:max-w-[72%] ${mine ? 'rounded-br-md bg-violet-500' : 'rounded-bl-md border border-white/[.06] bg-[#151821]'}`}>{(msg.attachments || []).map((url, index) => <PrivateAttachment key={`${msg.id}-${index}`} url={url} type={msg.attachment_types?.[index] || ''} />)}{editing ? <div className="space-y-2"><textarea autoFocus value={editText} onChange={(event) => setEditText(event.target.value)} rows={2} className="w-full resize-none rounded-xl border border-white/15 bg-black/20 p-2 text-xs outline-none" /><div className="flex justify-end gap-2"><button onClick={cancelEdit} className="rounded-lg px-2.5 py-1.5 text-[9px] text-white/70">Cancel</button><button onClick={saveEdit} className="rounded-lg bg-white px-2.5 py-1.5 text-[9px] font-bold text-violet-700">Save</button></div></div> : msg.content && <p className="whitespace-pre-wrap break-words text-[12px] leading-5">{msg.content}</p>}<div className={`mt-1 flex items-center gap-1.5 text-[8px] ${mine ? 'justify-end text-violet-100/75' : 'text-[#626677]'}`}><span>{time(msg.created_at)}</span>{msg.edited_at && <span>· Edited</span>}{mine && msg.seen && <span>· Seen</span>}{canEdit && !editing && <button onClick={startEdit} className="ml-1 rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white">Edit</button>}</div></div></div>; }
function PrivateAttachment({ url, type }: { url: string; type: string }) { if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return <img src={url} alt="Shared photo" className="mb-2 max-h-80 w-auto max-w-full rounded-xl object-contain" />; if (type.startsWith('audio/') || /\.(webm|m4a|mp3|wav|ogg)(\?|$)/i.test(url)) return <audio controls preload="metadata" src={url} className="mb-1 h-9 max-w-full" />; return null; }
function PendingMedia({ file, onRemove }: { file: File; onRemove: () => void }) { const isVoice = file.type.startsWith('audio/'); return <div className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.06] px-3 py-2"><span className="text-sm">{isVoice ? '🎤' : '▧'}</span><p className="max-w-36 truncate text-[9px] text-violet-200">{isVoice ? 'Voice note' : file.name}</p><button onClick={onRemove} className="text-[#8D91A1]">×</button></div>; }
function DeleteSheet({ title, text, onCancel, onDelete }: { title: string; text: string; onCancel: () => void; onDelete: () => void }) { return <div className="fixed inset-0 z-[70] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center" onClick={onCancel}><section className="w-full rounded-3xl border border-white/[.08] bg-[#151922] p-5 sm:max-w-sm" onClick={(event) => event.stopPropagation()}><h2 className="text-base font-bold">{title}</h2><p className="mt-2 text-[10px] leading-5 text-[#767C8C]">{text}</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onCancel} className="h-11 rounded-xl border border-white/[.08] text-[11px] font-semibold text-[#A4A9B7]">Keep</button><button onClick={onDelete} className="h-11 rounded-xl bg-red-500 text-[11px] font-semibold text-white">Delete</button></div></section></div>; }
function SectionTitle({ title, text }: { title: string; text: string }) { return <div><h2 className="text-sm font-bold">{title}</h2><p className="mt-1 text-[9px] text-[#5F6575]">{text}</p></div>; }
function Avatar({ person }: { person?: Person }) { return <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-semibold text-violet-300">{person?.avatar ? <img src={person.avatar} alt="" className="h-full w-full object-cover" /> : (person?.name || 'W')[0].toUpperCase()}</div>; }
function Unread({ value }: { value: number }) { return <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{value > 99 ? '99+' : value}</span>; }
function Divider() { return <div className="ml-[4.5rem] h-px bg-white/[.05]" />; }
function Loading() { return <div className="grid min-h-24 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="mx-auto mt-12 max-w-sm rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center"><p className="text-sm font-semibold">{title}</p><p className="mt-2 text-[10px] leading-relaxed text-[#666A7A]">{text}</p></div>; }
function time(value: string) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function formatListTime(value: string) { const date = new Date(value), current = new Date(); if (date.toDateString() === current.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); const yesterday = new Date(current); yesterday.setDate(current.getDate() - 1); if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'; return date.toLocaleDateString([], { month: 'short', day: 'numeric' }); }
function duration(value: number) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function PhotoIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 15-4-4L6 20" /></svg>; }
function MicIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></svg>; }
function CallPhoneIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7.5 3.5 10 7l-2 2c1.5 3.2 3.8 5.5 7 7l2-2 3.5 2.5-.8 3.1c-.2.8-.9 1.4-1.8 1.4C10 20.4 3.6 14 3 6.1c-.1-.9.5-1.6 1.4-1.8l3.1-.8Z"/></svg>}
function CallVideoIcon(){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>}
