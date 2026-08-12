import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnnouncementsTab } from '@/components/AnnouncementsTab';
import SecureSupportAttachment from '@/components/SecureSupportAttachment';
import { supabase } from '@/lib/supabase';
import { deleteSupportAttachment, getSupportInbox, getSupportMessages, markSupportMessagesRead, sendSupportMessage, uploadSupportAttachment } from '@/lib/supabase/support';
import type { Profile } from '@/types';

type View = 'inbox' | 'announcements';
type Scope = 'all' | { state: string; lga: string };
type Props = { profile: Profile; scope: Scope; onOpenConversation?: (id?: string) => void; forcedView?: View; hideViewTabs?: boolean };
const MAX_FILES = 6;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function CommunicationsWorkspace({ profile, scope, forcedView, hideViewTabs = false }: Props) {
  const [view, setView] = useState<View>(forcedView || 'inbox');
  const [rows, setRows] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forcedView) {
      setView(forcedView);
      setSelected(null);
      setMessages([]);
      setInput('');
      setFiles([]);
    }
  }, [forcedView]);

  async function load(quiet = false) {
    if (!quiet) setLoadingList(true);
    const { conversations, error } = await getSupportInbox();
    if (error) {
      if (!quiet) toast.error(error.message || 'Unable to load support inbox');
      setRows([]);
    } else setRows(conversations || []);
    if (!quiet) setLoadingList(false);
  }

  async function refreshMessages(id: string, quiet = false) {
    if (!quiet) setLoadingThread(true);
    const { messages: data, error } = await getSupportMessages(id);
    if (error && !quiet) toast.error(error.message || 'Unable to open conversation');
    if (!error) setMessages(data || []);
    await markSupportMessagesRead(id);
    if (!quiet) setLoadingThread(false);
  }

  useEffect(() => { if (view === 'inbox') void load(); }, [view, profile.user_id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, selected?.conversation_id]);
  useEffect(() => {
    if (!recording) { setRecordingSeconds(0); return; }
    const timer = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!selected) return;
    const id = selected.conversation_id;
    const channel = supabase.channel(`support-team-live-${id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'partner_support_messages', filter: `conversation_id=eq.${id}` }, () => {
      void refreshMessages(id, true);
      void load(true);
    }).subscribe();
    const fallback = window.setInterval(() => void refreshMessages(id, true), 12000);
    return () => { window.clearInterval(fallback); void supabase.removeChannel(channel); };
  }, [selected?.conversation_id]);

  async function open(row: any) {
    setSelected(row);
    setFiles([]);
    setInput('');
    setContextOpen(false);
    await refreshMessages(row.conversation_id);
    void load(true);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter(file => {
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} is larger than 25MB`); return false; }
      return true;
    });
    setFiles(current => {
      const next = [...current, ...incoming].slice(0, MAX_FILES);
      if (current.length + incoming.length > MAX_FILES) toast.error('A maximum of 6 files can be sent at once');
      return next;
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function reply() {
    if (!selected || sending || (!input.trim() && !files.length)) return;
    setSending(true);
    const paths: string[] = [];
    const types: string[] = [];
    for (const file of files) {
      const uploaded = await uploadSupportAttachment(selected.conversation_id, file);
      if (uploaded.error || !uploaded.path) {
        for (const path of paths) await deleteSupportAttachment(path);
        setSending(false);
        return toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
      }
      paths.push(uploaded.path);
      types.push(file.type || 'application/octet-stream');
    }
    const { error } = await sendSupportMessage(selected.conversation_id, input.trim(), paths, types);
    if (error) {
      for (const path of paths) await deleteSupportAttachment(path);
      setSending(false);
      return toast.error(error.message || 'Unable to send reply');
    }
    setSending(false);
    setInput('');
    setFiles([]);
    await refreshMessages(selected.conversation_id, true);
    await load(true);
  }

  async function toggleVoice() {
    if (recording) { mediaRef.current?.stop(); return; }
    if (files.length >= MAX_FILES) return toast.error('Remove a file before recording a voice note');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        setFiles(current => [...current, new File([blob], `voice-${Date.now()}.${ext}`, { type })].slice(0, MAX_FILES));
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error('Microphone permission is required for voice messages');
    }
  }

  const types = useMemo(() => ['all', ...Array.from(new Set(rows.map(row => row.category).filter(Boolean)))], [rows]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => (filter === 'all' || row.category === filter) && (!q || [row.subject, row.requester_name, row.requester_email, row.requester_role, row.category, row.context_type, row.context_id, row.last_message].filter(Boolean).join(' ').toLowerCase().includes(q)));
  }, [rows, filter, search]);
  const unread = rows.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);

  if (view === 'announcements') return <div className="space-y-5"><WorkspaceHeading profile={profile} view={view} setView={setView} unread={unread} hideViewTabs={hideViewTabs} /><AnnouncementsTab profile={profile} scope={scope} /></div>;

  return <div className="space-y-4">
    <WorkspaceHeading profile={profile} view={view} setView={setView} unread={unread} hideViewTabs={hideViewTabs} />
    <section className="overflow-hidden rounded-[24px] border border-white/[.06] bg-[#0E1219] shadow-[0_18px_55px_rgba(0,0,0,.18)] lg:grid lg:min-h-[680px] lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className={`${selected ? 'hidden lg:flex' : 'flex'} min-h-[68vh] flex-col border-white/[.06] lg:min-h-0 lg:border-r`}>
        <div className="border-b border-white/[.05] p-3 sm:p-4">
          <div className="relative"><SearchIcon /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search conversations" className="h-11 w-full rounded-2xl border border-white/[.06] bg-[#171C24] pl-10 pr-3 text-[11px] outline-none placeholder:text-[#5E6575] focus:border-violet-500/30" /></div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">{types.map(type => <button key={String(type)} onClick={() => setFilter(String(type))} className={`shrink-0 rounded-full px-3 py-1.5 text-[8px] font-semibold capitalize ${filter === type ? 'bg-violet-500 text-white' : 'bg-white/[.04] text-[#777D8E]'}`}>{String(type).replace(/_/g, ' ')}</button>)}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{loadingList ? <InboxSkeleton /> : shown.length === 0 ? <div className="grid min-h-[430px] place-items-center px-6 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/[.04] text-[#666D7D]"><ChatIcon /></div><p className="mt-3 text-[12px] font-semibold">No conversations here</p><p className="mt-1 text-[9px] text-[#62697A]">Try another search or category.</p></div></div> : shown.map((row, index) => <InboxRow key={row.conversation_id} row={row} active={selected?.conversation_id === row.conversation_id} divider={index > 0} onClick={() => void open(row)} />)}</div>
      </aside>

      <div className={`${selected ? 'flex' : 'hidden lg:flex'} min-w-0 flex-col bg-[#0A0E14]`}>
        {!selected ? <NoSelection /> : <>
          <header className="shrink-0 border-b border-white/[.055] bg-[#11161E] px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <button onClick={() => { setSelected(null); setMessages([]); setFiles([]); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9BA1B0] hover:bg-white/[.05] lg:hidden"><BackIcon /></button>
              <RequesterAvatar name={selected.requester_name || selected.requester_email} role={selected.requester_role} />
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-[13px] font-semibold">{selected.requester_name || selected.requester_email || 'WeHouse member'}</p><RolePill role={selected.requester_role} /></div><p className="mt-0.5 truncate text-[9px] text-[#707788]">{selected.subject}</p></div>
              <button onClick={() => setContextOpen(value => !value)} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${contextOpen ? 'bg-violet-500/15 text-violet-300' : 'text-[#838A9B] hover:bg-white/[.05]'}`} aria-label="Conversation details"><InfoIcon /></button>
            </div>
          </header>

          {contextOpen && <ConversationInfo row={selected} />}

          <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.045),transparent_38%)] px-3 py-4 sm:px-5">
            <div className="mx-auto max-w-4xl">{loadingThread ? <ThreadLoader /> : messages.length === 0 ? <div className="grid min-h-[420px] place-items-center text-center"><div><RequesterAvatar name={selected.requester_name || selected.requester_email} role={selected.requester_role} large /><p className="mt-4 text-[13px] font-semibold">Conversation ready</p><p className="mx-auto mt-2 max-w-xs text-[9px] leading-relaxed text-[#687081]">Reply here. The requester can send text, files, photos and voice messages in the same thread.</p></div></div> : <MessageStream messages={messages} myId={profile.user_id} requesterName={selected.requester_name || selected.requester_email || 'Requester'} />}<div ref={bottomRef} /></div>
          </main>

          <footer className="shrink-0 border-t border-white/[.055] bg-[#11161E] px-2.5 pb-2.5 pt-2.5 sm:px-4">
            <div className="mx-auto max-w-4xl">{files.length > 0 && <PendingFiles files={files} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))} />}{recording && <div className="mb-2 flex items-center gap-2 rounded-xl bg-red-500/[.07] px-3 py-2 text-[9px] text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400"/>Recording voice <span className="font-mono">{duration(recordingSeconds)}</span><span className="ml-auto text-red-300/70">tap mic to stop</span></div>}<div className="flex items-end gap-2"><button onClick={() => fileRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#9299A9] hover:bg-white/[.05]"><PlusIcon /></button><input ref={fileRef} type="file" multiple accept="image/*,application/pdf,text/plain,.doc,.docx,audio/*" onChange={event => addFiles(event.target.files)} className="hidden"/><div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.065] bg-[#1A1F28] px-3 py-1.5 focus-within:border-violet-500/30"><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void reply(); } }} rows={1} placeholder="Reply as WeHouse Support" className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[12px] leading-5 outline-none placeholder:text-[#5F6575]"/></div>{input.trim() || files.length ? <button onClick={() => void reply()} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-white shadow-lg shadow-violet-500/15 disabled:opacity-40"><SendIcon /></button> : <button onClick={() => void toggleVoice()} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording ? 'bg-red-500' : 'bg-violet-500'} text-white`}><MicIcon /></button>}</div><p className="mt-1.5 px-12 text-[8px] text-[#515868]">First Support Staff reply claims an unassigned branch conversation automatically.</p></div>
          </footer>
        </>}
      </div>
    </section>
  </div>;
}

function WorkspaceHeading({ profile, view, setView, unread, hideViewTabs }: { profile: Profile; view: View; setView: (view: View) => void; unread: number; hideViewTabs: boolean }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-bold">Communications</h2><p className="mt-1 text-[10px] text-[#707386]">{profile.role === 'creator' ? 'Human support and official platform communication.' : `Human support and official communication for ${profile.assigned_lga || 'your assigned branch'}.`}</p></div>{!hideViewTabs && <div className="flex w-full rounded-xl border border-white/[.06] bg-[#0D1017] p-1 sm:w-auto"><button onClick={() => setView('inbox')} className={`flex-1 rounded-lg px-4 py-2 text-[10px] font-semibold sm:flex-none ${view === 'inbox' ? 'bg-violet-500 text-white' : 'text-[#777A8C]'}`}>Support {unread ? `(${unread})` : ''}</button><button onClick={() => setView('announcements')} className={`flex-1 rounded-lg px-4 py-2 text-[10px] font-semibold sm:flex-none ${view === 'announcements' ? 'bg-violet-500 text-white' : 'text-[#777A8C]'}`}>Announcements</button></div>}</div>;
}

function InboxRow({ row, active, divider, onClick }: { row: any; active: boolean; divider: boolean; onClick: () => void }) {
  const unread = Number(row.unread_count || 0);
  return <button onClick={onClick} className={`flex w-full gap-3 px-3 py-3.5 text-left transition sm:px-4 ${divider ? 'border-t border-white/[.04]' : ''} ${active ? 'bg-violet-500/[.08]' : 'hover:bg-white/[.025]'}`}><RequesterAvatar name={row.requester_name || row.requester_email} role={row.requester_role} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-[11px] ${unread ? 'font-bold text-white' : 'font-semibold text-[#D6D9E2]'}`}>{row.requester_name || row.requester_email || 'WeHouse member'}</p><span className={`shrink-0 text-[8px] ${unread ? 'text-violet-300' : 'text-[#5B6272]'}`}>{compactTime(row.last_message_time || row.created_at)}</span></div><p className="mt-0.5 truncate text-[9px] font-medium text-[#8A90A0]">{row.subject}</p><div className="mt-1 flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[9px] text-[#656C7C]">{row.last_message || categoryName(row.category)}</p>{unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}</div><div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[7.5px] text-[#505767]"><span className="capitalize">{String(row.requester_role || 'user').replace(/_/g, ' ')}</span><span>·</span><span className="truncate capitalize">{categoryName(row.category)}</span>{row.priority && row.priority !== 'normal' && <><span>·</span><span className="text-red-300">{row.priority}</span></>}</div></div></button>;
}

function ConversationInfo({ row }: { row: any }) {
  const context = Object.entries(row.context_snapshot || {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim()).slice(0, 10);
  return <div className="shrink-0 border-b border-white/[.05] bg-[#0F141C] px-3 py-3 sm:px-4"><div className="mx-auto grid max-w-4xl gap-2 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Account" value={`${String(row.requester_role || 'user').replace(/_/g, ' ')} · ${row.requester_email || 'email unavailable'}`} /><Detail label="Location" value={[row.requester_lga, row.requester_state].filter(Boolean).join(', ') || 'Location unavailable'} /><Detail label="Support owner" value={row.assigned_staff_name || 'Unassigned queue'} /><Detail label="Status" value={String(row.status || 'open').replace(/_/g, ' ')} /></div>{(row.context_id || context.length > 0) && <div className="mx-auto mt-2 max-w-4xl rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-3"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-violet-300">Linked workflow</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-[#7E8799]">{row.context_type && <span className="capitalize">{String(row.context_type).replace(/_/g, ' ')}</span>}{row.context_id && <span>Ref: {row.context_id}</span>}{context.map(([key, value]) => <span key={key}><span className="capitalize text-[#626B7C]">{key.replace(/_/g, ' ')}:</span> {String(value)}</span>)}</div></div>}</div>;
}

function MessageStream({ messages, myId, requesterName }: { messages: any[]; myId: string; requesterName: string }) {
  let lastDay = '';
  return <div className="space-y-1.5">{messages.map(message => { const day = dayKey(message.created_at); const showDay = day !== lastDay; lastDay = day; const mine = message.sender_id === myId; return <div key={message.id}>{showDay && <div className="my-4 flex justify-center"><span className="rounded-full border border-white/[.05] bg-[#151A22] px-3 py-1 text-[8px] text-[#777E8E]">{dayLabel(message.created_at)}</span></div>}<div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[86%] px-3 py-2 sm:max-w-[72%] ${mine ? 'rounded-[18px] rounded-br-[5px] bg-violet-500 text-white' : 'rounded-[18px] rounded-bl-[5px] border border-white/[.055] bg-[#171C24] text-[#E7E9EF]'}`}>{!mine && <p className="mb-1 text-[8px] font-bold text-cyan-300">{message.sender_name || requesterName}</p>}{message.attachments?.map((path: string, index: number) => <SecureSupportAttachment key={`${message.id}-${path}`} path={path} type={message.attachment_types?.[index] || ''} className="max-w-full"/>)}{message.content && <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.5]">{message.content}</p>}<div className={`mt-1 flex justify-end gap-1 text-[7px] ${mine ? 'text-violet-100/70' : 'text-[#5D6575]'}`}><span>{message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>{mine && <span>✓✓</span>}</div></div></div></div>; })}</div>;
}

function RequesterAvatar({ name, role, large = false }: { name?: string; role?: string; large?: boolean }) { const letter = (name || 'U').trim()[0]?.toUpperCase() || 'U'; const style = role === 'worker' ? 'from-cyan-500 to-blue-600' : role === 'property_partner' ? 'from-violet-500 to-fuchsia-600' : 'from-blue-500 to-indigo-600'; const size = large ? 'h-16 w-16 rounded-[22px] text-xl mx-auto' : 'h-11 w-11 rounded-full text-sm shrink-0'; return <div className={`${size} grid place-items-center bg-gradient-to-br ${style} font-bold text-white shadow-md`}>{letter}</div>; }
function RolePill({ role }: { role?: string }) { return <span className="shrink-0 rounded-full border border-white/[.06] bg-white/[.035] px-2 py-0.5 text-[7px] capitalize text-[#858C9C]">{String(role || 'user').replace(/_/g, ' ')}</span>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.05] bg-white/[.02] p-2.5"><p className="text-[7px] uppercase tracking-[.1em] text-[#555D6D]">{label}</p><p className="mt-1 break-words text-[8.5px] capitalize text-[#A5AAB7]">{value}</p></div>; }
function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) { return <div className="mb-2 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-white/[.06] bg-[#1A1F28] px-2.5 py-2"><span className="text-[12px]">{file.type.startsWith('audio/') ? '🎤' : file.type.startsWith('image/') ? '▧' : '↗'}</span><div className="min-w-0"><p className="truncate text-[8.5px] text-[#C5C9D3]">{file.type.startsWith('audio/') ? 'Voice message' : file.name}</p><p className="text-[7px] text-[#5B6272]">{fileSize(file.size)}</p></div><button onClick={() => onRemove(index)} className="ml-1 text-[#7B8291]">×</button></div>)}</div>; }
function NoSelection() { return <div className="grid flex-1 place-items-center text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-violet-500/10 text-violet-300"><ChatIcon /></div><p className="mt-4 text-[14px] font-semibold">WeHouse Support</p><p className="mx-auto mt-2 max-w-xs text-[9px] leading-relaxed text-[#646C7C]">Select a conversation to read the full thread, context and attachments.</p></div></div>; }
function InboxSkeleton() { return <div>{[1,2,3,4,5].map(item => <div key={item} className="flex gap-3 border-b border-white/[.04] p-4"><div className="h-11 w-11 animate-pulse rounded-full bg-white/[.05]"/><div className="flex-1"><div className="h-2.5 w-2/5 animate-pulse rounded bg-white/[.05]"/><div className="mt-2 h-2 w-4/5 animate-pulse rounded bg-white/[.04]"/><div className="mt-2 h-2 w-3/5 animate-pulse rounded bg-white/[.03]"/></div></div>)}</div>; }
function ThreadLoader() { return <div className="grid min-h-[420px] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>; }
function categoryName(value?: string) { return String(value || 'general').replace(/_/g, ' '); }
function dayKey(value?: string) { if (!value) return ''; const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function dayLabel(value?: string) { if (!value) return ''; const date = new Date(value); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (dayKey(value) === dayKey(today.toISOString())) return 'Today'; if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Yesterday'; return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
function compactTime(value?: string) { if (!value) return ''; const date = new Date(value); const diff = Date.now() - date.getTime(); if (diff < 86400000 && dayKey(value) === dayKey(new Date().toISOString())) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); if (diff < 6 * 86400000) return date.toLocaleDateString([], { weekday: 'short' }); return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' }); }
function duration(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function fileSize(bytes: number) { if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function SearchIcon() { return <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#62697A]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>; }
function ChatIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function BackIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>; }
function InfoIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>; }
function PlusIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>; }
function MicIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>; }
function SendIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>; }
