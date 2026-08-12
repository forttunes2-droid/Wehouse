import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import SecureSupportAttachment from '@/components/SecureSupportAttachment';
import { supabase } from '@/lib/supabase';
import {
  createSupportConversation,
  deleteSupportAttachment,
  getMySupportConversations,
  getSupportMessages,
  markSupportMessagesRead,
  sendSupportMessage,
  uploadSupportAttachment,
  type SupportThread,
} from '@/lib/supabase/support';

interface ChatProfile { user_id: string; username: string | null; email: string; role?: string }
interface Props { profile: ChatProfile | null }
type OpenDetail = { category?: string; subject?: string; contextType?: string; contextId?: string; contextSnapshot?: Record<string, unknown>; priority?: string };

const CATEGORIES = [
  ['general', 'General help'],
  ['property_inspection', 'Property / inspection'],
  ['worker_booking', 'Worker service'],
  ['apartment_booking', 'Apartment / reservation'],
  ['hotel_booking', 'Hotel booking'],
  ['payment', 'Payment / withdrawal'],
  ['verification', 'Verification'],
  ['account', 'Account / security'],
] as const;
const MAX_FILES = 6;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function SupportChat({ profile }: Props) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [active, setActive] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [input, setInput] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [context, setContext] = useState<OpenDetail>({});
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [attachments, setAttachments] = useState<File[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const loadThreads = useCallback(async (quiet = false) => {
    if (!profile) return;
    if (!quiet) setListLoading(true);
    const { conversations, error } = await getMySupportConversations();
    if (error && !quiet) toast.error(error.message || 'Unable to load support');
    if (!error) setThreads(conversations || []);
    if (!quiet) setListLoading(false);
  }, [profile?.user_id]);

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setThreadLoading(true);
    const { messages: data, error } = await getSupportMessages(id);
    if (error && !quiet) toast.error(error.message || 'Unable to load messages');
    if (!error) setMessages(data || []);
    await markSupportMessagesRead(id);
    if (!quiet) setThreadLoading(false);
  }, []);

  useEffect(() => { if (profile) void loadThreads(true); }, [profile?.user_id, loadThreads]);
  useEffect(() => { if (open && !active) void loadThreads(); }, [open, active, loadThreads]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, active?.conversation_id]);
  useEffect(() => {
    if (!recording) { setRecordingSeconds(0); return; }
    const timer = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!active) return;
    const id = active.conversation_id;
    const channel = supabase
      .channel(`support-live-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'partner_support_messages', filter: `conversation_id=eq.${id}` }, () => {
        void loadMessages(id, true);
        void loadThreads(true);
      })
      .subscribe();
    const fallback = window.setInterval(() => void loadMessages(id, true), 12000);
    return () => { window.clearInterval(fallback); void supabase.removeChannel(channel); };
  }, [active?.conversation_id, loadMessages, loadThreads]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = ((event as CustomEvent<OpenDetail>).detail || {});
      setContext(detail);
      setCategory(detail.category || 'general');
      setSubject(detail.subject || '');
      setOpen(true);
      setActive(null);
      if (detail.subject || detail.contextId) setComposeOpen(true);
    };
    window.addEventListener('openSupportChat', handler as EventListener);
    return () => window.removeEventListener('openSupportChat', handler as EventListener);
  }, []);

  async function openThread(thread: SupportThread) {
    setActive(thread);
    setAttachments([]);
    setInput('');
    setComposeOpen(false);
    await loadMessages(thread.conversation_id);
    requestAnimationFrame(() => textRef.current?.focus());
  }

  async function createThread() {
    if (!subject.trim()) return toast.error('Tell us what you need help with');
    setSending(true);
    const { conversationId, error } = await createSupportConversation({
      subject: subject.trim(),
      category,
      contextType: context.contextType || category,
      contextId: context.contextId || null,
      contextSnapshot: context.contextSnapshot || {},
      priority: context.priority || 'normal',
    });
    setSending(false);
    if (error || !conversationId) return toast.error(error?.message || 'Unable to start support');
    setComposeOpen(false);
    setSubject('');
    setContext({});
    const { conversations } = await getMySupportConversations();
    setThreads(conversations || []);
    const thread = (conversations || []).find(item => item.conversation_id === conversationId);
    if (thread) await openThread(thread);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter(file => {
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} is larger than 25MB`); return false; }
      return true;
    });
    setAttachments(current => {
      const next = [...current, ...incoming].slice(0, MAX_FILES);
      if (current.length + incoming.length > MAX_FILES) toast.error('A maximum of 6 files can be sent at once');
      return next;
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function send() {
    if (!active || sending || (!input.trim() && !attachments.length)) return;
    setSending(true);
    const paths: string[] = [];
    const types: string[] = [];
    for (const file of attachments) {
      const uploaded = await uploadSupportAttachment(active.conversation_id, file);
      if (uploaded.error || !uploaded.path) {
        for (const path of paths) await deleteSupportAttachment(path);
        setSending(false);
        return toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
      }
      paths.push(uploaded.path);
      types.push(file.type || 'application/octet-stream');
    }
    const { error } = await sendSupportMessage(active.conversation_id, input.trim(), paths, types);
    if (error) {
      for (const path of paths) await deleteSupportAttachment(path);
      setSending(false);
      return toast.error(error.message || 'Message failed');
    }
    setSending(false);
    setInput('');
    setAttachments([]);
    await loadMessages(active.conversation_id, true);
    void loadThreads(true);
  }

  async function toggleVoice() {
    if (recording) { mediaRef.current?.stop(); return; }
    if (attachments.length >= MAX_FILES) return toast.error('Remove a file before recording a voice note');
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
        setAttachments(current => [...current, new File([blob], `voice-${Date.now()}.${ext}`, { type })].slice(0, MAX_FILES));
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

  const unread = useMemo(() => threads.reduce((sum, thread) => sum + Number(thread.unread_count || 0), 0), [threads]);
  if (!profile) return null;

  if (!open) return (
    <button onClick={() => setOpen(true)} aria-label="WeHouse Support" className="fixed bottom-20 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-blue-500 text-white shadow-[0_14px_45px_rgba(59,130,246,.38)] transition active:scale-95">
      <ChatIcon />
      {unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[#090A0F] bg-red-500 px-1 text-[8px] font-bold">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );

  if (active) return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#0A0D12] text-white" style={{ height: '100dvh' }}>
      <header className="shrink-0 border-b border-white/[.06] bg-[#10141B]/95 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-4xl items-center gap-2.5">
          <button onClick={() => { setActive(null); setMessages([]); setAttachments([]); void loadThreads(); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#A5A9B7] hover:bg-white/[.06]" aria-label="Back"><BackIcon /></button>
          <SupportAvatar online />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5"><p className="truncate text-[13px] font-semibold">WeHouse Support</p><VerifiedDot /></div>
            <p className="truncate text-[9px] text-[#747A8B]">{active.subject} · {active.assigned_staff_name ? `handled by ${active.assigned_staff_name}` : 'support team'}</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${active.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-blue-500/10 text-blue-300'}`}>{String(active.status || 'open').replace(/_/g, ' ')}</span>
        </div>
      </header>

      {(active.context_id || active.context_type !== 'general') && <ContextBar thread={active} />}

      <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,.055),transparent_38%)] px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-4xl">
          {threadLoading ? <LoadingConversation /> : messages.length === 0 ? <EmptyConversation /> : <MessageStream messages={messages} myId={profile.user_id} />}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="shrink-0 border-t border-white/[.06] bg-[#10141B]/98 px-2.5 pb-[max(.6rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
        <div className="mx-auto max-w-4xl">
          {attachments.length > 0 && <PendingAttachments files={attachments} onRemove={index => setAttachments(current => current.filter((_, i) => i !== index))} />}
          {recording && <div className="mb-2 flex items-center gap-2 rounded-2xl bg-red-500/[.08] px-3 py-2 text-[10px] text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400"/><span>Recording voice</span><span className="font-mono text-red-300">{duration(recordingSeconds)}</span><span className="ml-auto text-[9px] text-red-300/70">Tap mic to finish</span></div>}
          <div className="flex items-end gap-2">
            <button onClick={() => fileRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#98A0B2] hover:bg-white/[.06]" aria-label="Attach file"><PlusIcon /></button>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,text/plain,.doc,.docx,audio/*" onChange={event => addFiles(event.target.files)} className="hidden" />
            <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.07] bg-[#1A1F28] px-3 py-1.5 shadow-inner shadow-black/10 focus-within:border-blue-500/35">
              <textarea ref={textRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} placeholder="Message" className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-5 outline-none placeholder:text-[#62697A]" />
            </div>
            {input.trim() || attachments.length ? <button onClick={() => void send()} disabled={sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/20 disabled:opacity-40" aria-label="Send message"><SendIcon /></button> : <button onClick={() => void toggleVoice()} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'} shadow-lg`} aria-label={recording ? 'Stop recording' : 'Record voice'}><MicIcon /></button>}
          </div>
        </div>
      </footer>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#0A0D12] text-white" style={{ minHeight: '100dvh' }}>
      <header className="sticky top-0 z-20 border-b border-white/[.06] bg-[#10141B]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-3 py-3 sm:px-4">
          <button onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#A1A6B5] hover:bg-white/[.06]"><BackIcon /></button>
          <div className="min-w-0 flex-1"><h2 className="text-[17px] font-bold">Support</h2><p className="mt-0.5 text-[9px] text-[#6E7485]">Your conversations with the WeHouse team</p></div>
          <button onClick={() => { setContext({}); setCategory('general'); setSubject(''); setComposeOpen(true); }} className="grid h-10 w-10 place-items-center rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/15" aria-label="New support conversation"><ComposeIcon /></button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-3 py-3 sm:px-4 sm:py-4">
        <div className="mb-3 flex items-center justify-between px-1"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#596071]">Conversations</p>{unread > 0 && <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-semibold text-blue-300">{unread} unread</span>}</div>
        {listLoading ? <ThreadSkeletons /> : threads.length === 0 ? <EmptyInbox onNew={() => setComposeOpen(true)} /> : <div className="overflow-hidden rounded-2xl border border-white/[.05] bg-[#10141B]">{threads.map((thread, index) => <ThreadRow key={thread.conversation_id} thread={thread} divider={index > 0} onClick={() => void openThread(thread)} />)}</div>}
      </main>

      {composeOpen && <NewConversationSheet subject={subject} setSubject={setSubject} category={category} setCategory={setCategory} context={context} sending={sending} onClose={() => setComposeOpen(false)} onCreate={() => void createThread()} />}
    </div>
  );
}

function ThreadRow({ thread, divider, onClick }: { thread: SupportThread; divider: boolean; onClick: () => void }) {
  const unread = Number(thread.unread_count || 0);
  return <button onClick={onClick} className={`flex w-full items-center gap-3 px-3 py-3.5 text-left hover:bg-white/[.025] sm:px-4 ${divider ? 'border-t border-white/[.045]' : ''}`}>
    <SupportAvatar online={thread.status !== 'resolved'} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-[13px] ${unread ? 'font-bold text-white' : 'font-semibold text-[#D5D8E1]'}`}>{thread.subject}</p><span className={`shrink-0 text-[9px] ${unread ? 'font-semibold text-blue-300' : 'text-[#5F6575]'}`}>{compactTime(thread.last_message_time || thread.created_at)}</span></div>
      <div className="mt-1 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-[11px] ${unread ? 'text-[#B5BBC9]' : 'text-[#707687]'}`}>{thread.last_message || categoryName(thread.category)}</p>{unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-blue-500 px-1 text-[8px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[8px] text-[#555B6B]"><span className="capitalize">{categoryName(thread.category)}</span>{thread.context_id && <><span>·</span><span className="truncate">linked request</span></>}<span>·</span><span className="capitalize">{String(thread.status || 'open').replace(/_/g, ' ')}</span></div>
    </div>
  </button>;
}

function MessageStream({ messages, myId }: { messages: any[]; myId: string }) {
  let lastDay = '';
  return <div className="space-y-1.5">{messages.map(message => {
    const day = dayKey(message.created_at);
    const showDay = day !== lastDay;
    lastDay = day;
    return <div key={message.id}>{showDay && <div className="my-4 flex justify-center"><span className="rounded-full border border-white/[.05] bg-[#151A22]/95 px-3 py-1 text-[8px] font-medium text-[#7A8090] shadow-sm">{dayLabel(message.created_at)}</span></div>}<MessageBubble message={message} mine={message.sender_id === myId} /></div>;
  })}</div>;
}

function MessageBubble({ message, mine }: { message: any; mine: boolean }) {
  return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`relative max-w-[86%] px-3 py-2 shadow-sm sm:max-w-[72%] ${mine ? 'rounded-[18px] rounded-br-[5px] bg-blue-500 text-white' : 'rounded-[18px] rounded-bl-[5px] border border-white/[.055] bg-[#171C24] text-[#E7E9EF]'}`}>
    {!mine && <div className="mb-1 flex items-center gap-1.5"><span className="text-[9px] font-bold text-blue-300">{message.sender_name || 'WeHouse Support'}</span><VerifiedDot small /></div>}
    {message.attachments?.map((path: string, index: number) => <SecureSupportAttachment key={`${message.id}-${path}`} path={path} type={message.attachment_types?.[index] || ''} className="max-w-full" />)}
    {message.content && <p className="whitespace-pre-wrap break-words text-[12px] leading-[1.45]">{message.content}</p>}
    <div className={`mt-1 flex items-center justify-end gap-1 text-[7.5px] ${mine ? 'text-blue-100/70' : 'text-[#626979]'}`}><span>{message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>{mine && <span className="font-bold">✓✓</span>}</div>
  </div></div>;
}

function ContextBar({ thread }: { thread: SupportThread }) {
  const values = Object.entries(thread.context_snapshot || {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim()).slice(0, 3);
  return <div className="shrink-0 border-b border-blue-500/10 bg-[#0E151F] px-3 py-2 sm:px-4"><div className="mx-auto flex max-w-4xl items-center gap-2 rounded-xl border border-blue-500/10 bg-blue-500/[.045] px-3 py-2"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-300"><LinkIcon /></div><div className="min-w-0 flex-1"><p className="truncate text-[9px] font-semibold text-blue-200">Linked {String(thread.context_type || 'request').replace(/_/g, ' ')}</p><p className="mt-0.5 truncate text-[8px] text-[#6F7F95]">{values.length ? values.map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`).join(' · ') : thread.context_id || 'Context attached to this conversation'}</p></div></div></div>;
}

function PendingAttachments({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  return <div className="mb-2 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-white/[.07] bg-[#1A1F28] px-2.5 py-2"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-[12px] text-blue-300">{file.type.startsWith('audio/') ? '🎤' : file.type.startsWith('image/') ? '▧' : '↗'}</div><div className="min-w-0"><p className="truncate text-[9px] font-medium text-[#C5C9D3]">{file.type.startsWith('audio/') ? 'Voice message' : file.name}</p><p className="mt-0.5 text-[8px] text-[#5F6574]">{fileSize(file.size)}</p></div><button onClick={() => onRemove(index)} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#7B8191] hover:bg-white/[.06]">×</button></div>)}</div>;
}

function NewConversationSheet({ subject, setSubject, category, setCategory, context, sending, onClose, onCreate }: { subject: string; setSubject: (value: string) => void; category: string; setCategory: (value: string) => void; context: OpenDetail; sending: boolean; onClose: () => void; onCreate: () => void }) {
  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}><section className="w-full max-w-lg rounded-t-[28px] border border-white/[.07] bg-[#11161E] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-5" onClick={event => event.stopPropagation()}>
    <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/[.14] sm:hidden" />
    <div className="flex items-start gap-3"><SupportAvatar online /><div className="min-w-0 flex-1"><h3 className="text-[16px] font-bold">Start a support conversation</h3><p className="mt-1 text-[10px] leading-relaxed text-[#73798A]">Choose what you need help with. You can send photos, documents and voice messages after opening the conversation.</p></div><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/[.05] text-[#8A90A0]">×</button></div>
    <div className="mt-5 space-y-3"><label className="block"><span className="mb-1.5 block text-[9px] font-semibold text-[#6D7383]">Category</span><select value={category} onChange={event => setCategory(event.target.value)} className="h-12 w-full rounded-2xl border border-white/[.07] bg-[#1A1F28] px-3 text-[12px] outline-none focus:border-blue-500/35">{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-[9px] font-semibold text-[#6D7383]">What do you need help with?</span><input value={subject} onChange={event => setSubject(event.target.value)} autoFocus maxLength={140} placeholder="Example: I need help with my inspection" className="h-12 w-full rounded-2xl border border-white/[.07] bg-[#1A1F28] px-3 text-[12px] outline-none placeholder:text-[#5F6574] focus:border-blue-500/35" /></label>{context.contextId && <div className="rounded-2xl border border-blue-500/12 bg-blue-500/[.045] p-3"><div className="flex items-center gap-2"><LinkIcon /><div><p className="text-[9px] font-semibold text-blue-300">Request attached automatically</p><p className="mt-0.5 text-[8px] capitalize text-[#718198]">{String(context.contextType || category).replace(/_/g, ' ')} · {context.contextId}</p></div></div></div>}<button onClick={onCreate} disabled={sending || !subject.trim()} className="h-12 w-full rounded-2xl bg-blue-500 text-[12px] font-semibold shadow-lg shadow-blue-500/15 disabled:opacity-40">{sending ? 'Opening conversation…' : 'Open conversation'}</button></div>
  </section></div>;
}

function EmptyConversation() { return <div className="grid min-h-[55vh] place-items-center text-center"><div><SupportAvatar large online /><p className="mt-4 text-[14px] font-semibold">WeHouse Support</p><p className="mx-auto mt-2 max-w-xs text-[10px] leading-relaxed text-[#73798A]">Send a message, photo, document or voice note. A real WeHouse support team member replies here.</p><div className="mx-auto mt-4 w-fit rounded-full border border-white/[.05] bg-[#151A22] px-3 py-1.5 text-[8px] text-[#656C7C]">This conversation is linked to your WeHouse account</div></div></div>; }
function LoadingConversation() { return <div className="grid min-h-[55vh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>; }
function ThreadSkeletons() { return <div className="overflow-hidden rounded-2xl border border-white/[.05] bg-[#10141B]">{[1, 2, 3].map(item => <div key={item} className="flex items-center gap-3 border-b border-white/[.045] p-4 last:border-b-0"><div className="h-11 w-11 animate-pulse rounded-full bg-white/[.05]"/><div className="flex-1"><div className="h-3 w-2/5 animate-pulse rounded bg-white/[.05]"/><div className="mt-2 h-2.5 w-4/5 animate-pulse rounded bg-white/[.04]"/></div></div>)}</div>; }
function EmptyInbox({ onNew }: { onNew: () => void }) { return <div className="rounded-3xl border border-dashed border-white/[.07] px-6 py-16 text-center"><SupportAvatar large online /><p className="mt-4 text-[14px] font-semibold">No support conversations</p><p className="mx-auto mt-2 max-w-xs text-[10px] leading-relaxed text-[#707687]">When you need help, start one conversation and keep every reply, file and voice note together.</p><button onClick={onNew} className="mt-5 rounded-full bg-blue-500 px-5 py-2.5 text-[11px] font-semibold">Message WeHouse</button></div>; }
function SupportAvatar({ online = false, large = false }: { online?: boolean; large?: boolean }) { const size = large ? 'h-16 w-16 rounded-[22px] text-xl' : 'h-11 w-11 rounded-full text-[14px]'; return <div className={`relative ${large ? 'mx-auto w-fit' : 'shrink-0'}`}><div className={`${size} grid place-items-center bg-gradient-to-br from-blue-500 to-indigo-600 font-black text-white shadow-lg shadow-blue-500/10`}>W</div>{online && <span className={`absolute rounded-full border-2 border-[#10141B] bg-emerald-400 ${large ? '-bottom-0.5 -right-0.5 h-4 w-4' : 'bottom-0 right-0 h-3.5 w-3.5'}`}/>}</div>; }
function VerifiedDot({ small = false }: { small?: boolean }) { return <span className={`${small ? 'h-3 w-3 text-[7px]' : 'h-3.5 w-3.5 text-[8px]'} grid shrink-0 place-items-center rounded-full bg-blue-400 font-bold text-white`}>✓</span>; }
function categoryName(value?: string) { return CATEGORIES.find(([id]) => id === value)?.[1] || String(value || 'General help').replace(/_/g, ' '); }
function dayKey(value?: string) { if (!value) return ''; const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function dayLabel(value?: string) { if (!value) return ''; const date = new Date(value); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (dayKey(value) === dayKey(today.toISOString())) return 'Today'; if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Yesterday'; return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
function compactTime(value?: string | null) { if (!value) return ''; const date = new Date(value); const diff = Date.now() - date.getTime(); if (diff < 86400000 && dayKey(value) === dayKey(new Date().toISOString())) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); if (diff < 6 * 86400000) return date.toLocaleDateString([], { weekday: 'short' }); return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' }); }
function duration(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function fileSize(bytes: number) { if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function BackIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>; }
function ChatIcon() { return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function ComposeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>; }
function PlusIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>; }
function MicIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>; }
function SendIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>; }
function LinkIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>; }
