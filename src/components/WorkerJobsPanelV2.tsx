import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BOOKING_STATUS_LABELS, getCommunicationBookingConversations } from '@/lib/supabase/worker-bookings';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import Notifications from '@/pages/Notifications';
import type { Profile } from '@/types';

export type WorkerBookingConversation = {
  conversation_id: string; booking_id: string; booking_code?: string | null;
  booking_status: string; service_type?: string | null; negotiated_amount?: number | null;
  other_person_name?: string | null; other_person_username?: string | null;
  other_person_avatar?: string | null; last_message?: string | null;
  last_message_time?: string | null; unread_count?: number | null; updated_at?: string | null;
};

const COMPLETED = new Set(['approved_released', 'cancelled', 'refunded']);
const ATTENTION = new Set(['booking_requested', 'disputed']);

async function loadWorkerConversations(userId: string) {
  const { conversations, error } = await getCommunicationBookingConversations(userId);
  if (error) throw error;
  return conversations as WorkerBookingConversation[];
}

export default function WorkerJobsPanelV2({profile, onOpenConversation}: {profile: Profile; onOpenConversation: (row: WorkerBookingConversation) => void}) {
  const [rows, setRows] = useState<WorkerBookingConversation[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void loadWorkerConversations(profile.user_id)
      .then((result) => { if (active) setRows(result); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Jobs could not be loaded'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile.user_id]);
  const shown = useMemo(() => [...rows].sort((a, b) => {
    const aDone = COMPLETED.has(a.booking_status) ? 1 : 0;
    const bDone = COMPLETED.has(b.booking_status) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  }), [rows]);
  return loading ? <Empty text="Loading jobs…"/> : shown.length === 0 ? <Empty text="New requests and completed work will appear here."/> : <div className="divide-y divide-white/[.06] border-y border-white/[.06]">{shown.map((row) => <JobRow key={row.booking_id} row={row} onOpen={() => onOpenConversation(row)}/>)}</div>;
}

export function WorkerInboxPanel({profile, initialConversation, onConversationClosed, onNavigate = () => {}, onOpenJobs}: {profile: Profile; initialConversation?: WorkerBookingConversation | null; onConversationClosed?: () => void; onNavigate?: (page:string,id?:string)=>void; onOpenJobs?:()=>void}) {
  const [rows, setRows] = useState<WorkerBookingConversation[]>([]);
  const [selected, setSelected] = useState<WorkerBookingConversation | null>(initialConversation || null);
  const [loading, setLoading] = useState(true);
  const [view,setView]=useState<'chats'|'activity'>('chats');
  const [activityUnread,setActivityUnread]=useState(0);
  const load = useCallback(async () => {
    try { setRows(await loadWorkerConversations(profile.user_id)); }
    catch (error: unknown) { toast.error(error instanceof Error ? error.message : 'Conversations could not be loaded'); }
    finally { setLoading(false); }
  }, [profile.user_id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialConversation) setSelected(initialConversation); }, [initialConversation]);
  function openActivitySource(page:string,id?:string){
    if(['worker_dashboard','operations_inbox','my_reservations','my_bookings'].includes(page)){onOpenJobs?.();return}
    onNavigate(page,id);
  }
  if (selected) return <BookingNegotiationChat conversationId={selected.conversation_id} bookingId={selected.booking_id} profile={profile} isWorker onClose={() => { setSelected(null); onConversationClosed?.(); void load(); }}/>;
  const conversationUnread=rows.reduce((sum,row)=>sum+Number(row.unread_count||0),0);
  return <div className="space-y-5"><div className="flex border-b border-white/[.07]" aria-label="Inbox views">{([['chats','Conversations',conversationUnread],['activity','Activity',activityUnread]] as const).map(([id,label,count])=><button key={id} onClick={()=>setView(id)} className={`relative flex-1 py-3 text-[11px] font-semibold ${view===id?'text-violet-300 after:absolute after:inset-x-10 after:bottom-0 after:h-0.5 after:bg-violet-400':'text-[#74798A]'}`}>{label}{count>0&&<span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">{count>99?'99+':count}</span>}</button>)}</div>{view==='activity'?<Notifications profile={profile} embedded onNavigate={openActivitySource} onUnreadChange={setActivityUnread}/>:loading ? <Empty text="Loading conversations…"/> : rows.length === 0 ? <Empty text="Conversations appear when a customer starts a service request."/> : <div className="divide-y divide-white/[.06] border-y border-white/[.06]">{rows.map((row) => <ConversationRow key={row.conversation_id} row={row} onOpen={() => setSelected(row)}/>)}</div>}</div>;
}

function JobRow({row, onOpen}: {row: WorkerBookingConversation; onOpen: () => void}) {
  const status = BOOKING_STATUS_LABELS[row.booking_status], amount = Number(row.negotiated_amount || 0);
  return <button onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left"><div className={`h-2.5 w-2.5 shrink-0 rounded-full ${ATTENTION.has(row.booking_status) ? 'bg-amber-400' : 'bg-violet-400'}`}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.service_type || 'Service job'}</p><p className="mt-1 truncate text-[9px] text-[#676E7F]">#{row.booking_code || '—'} · {row.other_person_name || 'Customer'}</p><p className="mt-1 text-[9px] text-[#858B9A]">{workerHint(row.booking_status)}</p></div><div className="shrink-0 text-right">{amount > 0 ? <p className="text-[11px] font-semibold text-emerald-300">₦{amount.toLocaleString('en-NG')}</p> : null}<span className={`mt-1 inline-block rounded-full px-2 py-1 text-[8px] font-semibold ${status?.color || 'bg-white/[.05] text-[#8A8F9E]'}`}>{status?.label || row.booking_status.replace(/_/g, ' ')}</span></div></button>;
}

function ConversationRow({row, onOpen}: {row: WorkerBookingConversation; onOpen: () => void}) {
  const unread = Number(row.unread_count || 0), time = row.last_message_time || row.updated_at;
  return <button onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left"><div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-violet-300">{row.other_person_avatar ? <img src={row.other_person_avatar} alt="" className="h-full w-full object-cover"/> : (row.other_person_name || 'C')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{row.other_person_name || 'Customer'}</p><span className="shrink-0 text-[8px] text-violet-300">{BOOKING_STATUS_LABELS[row.booking_status]?.label || row.booking_status.replace(/_/g, ' ')}</span></div><p className={`mt-1 truncate text-[10px] ${unread ? 'font-semibold text-[#DDE0E8]' : 'text-[#6B7181]'}`}>{row.last_message || 'Booking request started'}</p></div><div className="shrink-0 text-right">{time ? <p className="text-[8px] text-[#5F6676]">{formatConversationTime(time)}</p> : null}{unread ? <span className="mt-2 inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1.5 text-[8px] font-bold">{unread}</span> : null}</div></button>;
}

function formatConversationTime(value: string) { const date = new Date(value), today = new Date(); return date.toDateString() === today.toDateString() ? date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : date.toLocaleDateString([], {day: 'numeric', month: 'short'}); }
function workerHint(status: string) { const hints: Record<string, string> = {booking_requested: 'Open the conversation and respond', negotiating: 'Agree the job, date and price', waiting_payment: 'Waiting for customer payment', confirmed: 'Paid · ready to start', in_progress: 'Work in progress', completed_pending_approval: 'Waiting for customer confirmation', approved_released: 'Completed · earnings released', disputed: 'WeHouse review in progress', cancelled: 'Cancelled', refunded: 'Refunded'}; return hints[status] || 'Open its conversation for details'; }
function Empty({text}: {text: string}) { return <div className="border-y border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">{text}</div>; }
