import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { withTimeout } from "@/lib/withTimeout";
import { useInboxRefresh } from "@/hooks/useInboxRefresh";
import { BOOKING_STATUS_LABELS, getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import Notifications from "@/pages/Notifications";
import SupportEntryCard from "@/components/SupportEntryCard";
import InboxActivityEntry from "@/components/InboxActivityEntry";
import ActivityHeader from "@/components/ActivityHeader";
import { getMySupportConversations } from "@/lib/supabase/support";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import SecureInboxLock from "@/components/SecureInboxLock";
import useSecureInboxAccess from "@/hooks/useSecureInboxAccess";
import { formatMoney } from "@/lib/regional";

export type WorkerBookingConversation = {
  conversation_id: string;
  booking_id: string;
  booking_code?: string | null;
  booking_status: string;
  service_type?: string | null;
  negotiated_amount?: number | null;
  other_person_name?: string | null;
  other_person_username?: string | null;
  other_person_avatar?: string | null;
  last_message?: string | null;
  last_message_time?: string | null;
  unread_count?: number | null;
  updated_at?: string | null;
};

const COMPLETED = new Set(["approved_released", "cancelled", "refunded"]);
const ATTENTION = new Set(["booking_requested", "disputed"]);

async function loadWorkerConversations(userId: string) {
  const { conversations, error } = await getCommunicationBookingConversations(userId);
  if (error) throw error;
  if (!Array.isArray(conversations) || conversations.some(row =>
    !row || typeof row !== 'object' ||
    ['conversation_id', 'booking_id', 'booking_status'].some(key =>
      typeof (row as Record<string, unknown>)[key] !== 'string' || !String((row as Record<string, unknown>)[key]).trim()) ||
    ['booking_code', 'service_type', 'other_person_name', 'other_person_username',
      'other_person_avatar', 'last_message', 'last_message_time', 'updated_at'].some(key =>
        (row as Record<string, unknown>)[key] != null && typeof (row as Record<string, unknown>)[key] !== 'string') ||
    (row.negotiated_amount != null && (!Number.isFinite(Number(row.negotiated_amount)) || Number(row.negotiated_amount) < 0)) ||
    (row.unread_count != null && (!Number.isSafeInteger(Number(row.unread_count)) || Number(row.unread_count) < 0)))) {
    throw new Error('Job conversations could not be confirmed. Please try again.');
  }
  return conversations as WorkerBookingConversation[];
}

export default function WorkerJobsPanelV2(props: Parameters<typeof WorkerJobsContent>[0]) {
  return <WorkerJobsContent key={props.profile.user_id} {...props} />;
}

function WorkerJobsContent({ profile, onOpenConversation }: { profile: Profile; onOpenConversation: (row: WorkerBookingConversation) => void }) {
  const [rows, setRows] = useState<WorkerBookingConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setLoadError(''); setRows([]);
    try {
      const result = await withTimeout(loadWorkerConversations(profile.user_id), 15000, 'Jobs took too long to load. Please try again.');
      if (request === generation.current) setRows(result);
    } catch (cause) {
      if (request === generation.current) setLoadError(cause instanceof Error ? cause.message : 'Jobs could not be loaded.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [profile.user_id]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  const shown = useMemo(() => [...rows].sort((a, b) => {
    const aDone = COMPLETED.has(a.booking_status) ? 1 : 0;
    const bDone = COMPLETED.has(b.booking_status) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  }), [rows]);
  return loading ? <Empty text="Loading jobs…" /> : loadError ? <ReadError text={loadError} onRetry={() => void load()} /> : shown.length === 0 ? <Empty text="New requests and completed work will appear here." /> : (
    <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
      {shown.map((row) => <JobRow key={row.booking_id} row={row} onOpen={() => onOpenConversation(row)} />)}
    </div>
  );
}

function WorkerInboxContent({
  profile,
  initialConversation,
  onConversationClosed,
  onNavigate = () => {},
  onOpenJobs,
  chatUnread,
  activityUnread: summaryActivityUnread,
  onUnreadRefresh,
}: {
  profile: Profile;
  initialConversation?: WorkerBookingConversation | null;
  onConversationClosed?: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onOpenJobs?: () => void;
  chatUnread?: number;
  activityUnread?: number;
  onUnreadRefresh?: () => void;
}) {
  const [rows, setRows] = useState<WorkerBookingConversation[]>([]);
  const [selected, setSelected] = useState<WorkerBookingConversation | null>(initialConversation || null);
  const [loading, setLoading] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [activityUnread, setActivityUnread] = useState(0);
  const [supportUnread, setSupportUnread] = useState(0);
  const [supportAvailable, setSupportAvailable] = useState(false);
  const {
    status: inboxSecurityStatus,
    refresh: refreshInboxSecurity,
  } = useSecureInboxAccess(profile.user_id);

  const [loadError, setLoadError] = useState('');
  const load = useCallback(async (isCurrent: () => boolean) => {
    try {
      const [conversations, wehouse] = await withTimeout(Promise.all([
        loadWorkerConversations(profile.user_id), getMySupportConversations('worker'),
      ]), 15000, 'Conversations took too long to load. Please try again.');
      if (wehouse.error) throw wehouse.error;
      if (!isCurrent()) return;
      setRows(conversations);
      setSupportUnread((wehouse.conversations || []).reduce((sum, row) => sum + Number(row.unread_count || 0), 0));
      setLoadError('');
    } catch (cause) {
      if (isCurrent()) setLoadError(cause instanceof Error ? cause.message : 'Conversations could not be loaded. Please try again.');
    } finally { if (isCurrent()) setLoading(false); }
  }, [profile.user_id]);
  const refresh = useInboxRefresh(load, inboxSecurityStatus?.state === 'ready');

  useEffect(() => {
    if (inboxSecurityStatus?.state !== 'ready') return;
    const channel = supabase
      .channel(`worker-inbox:${profile.user_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_messages' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_support_messages' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [inboxSecurityStatus?.state, refresh, profile.user_id]);
  useEffect(() => { if (initialConversation) setSelected(initialConversation); }, [initialConversation]);

  function openActivitySource(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (["conversation", "conversations", "message", "messages", "chat"].includes(route)) {
      const conversation = rows.find((row) => String(row.conversation_id) === String(id || "") || String(row.booking_id) === String(id || ""));
      if (conversation) { setShowActivity(false); setSelected(conversation); return; }
      toast.error("This job conversation is no longer available.");
      return;
    }
    if (["worker_dashboard", "operations_inbox", "my_reservations", "my_bookings"].includes(route)) { onOpenJobs?.(); return; }
    onNavigate(page, id);
  }

  const conversationUnread = rows.filter((row) => Number(row.unread_count || 0) > 0).length;
  const displayedChatUnread = chatUnread ?? conversationUnread + supportUnread;
  const displayedActivityUnread = summaryActivityUnread ?? activityUnread;
  const reportActivityUnread = useCallback((count: number) => { setActivityUnread(count); onUnreadRefresh?.(); }, [onUnreadRefresh]);

  if (inboxSecurityStatus?.state !== "ready") {
    return (
      <SecureInboxLock
        status={inboxSecurityStatus}
        onReady={() => void refreshInboxSecurity()}
      />
    );
  }

  if (selected) return (
    <BookingNegotiationChat conversationId={selected.conversation_id} bookingId={selected.booking_id} profile={profile} isWorker onClose={() => { setSelected(null); onConversationClosed?.(); void refresh(); onUnreadRefresh?.(); }} />
  );

  if (showActivity) return (
    <div>
      <ActivityHeader onBack={() => setShowActivity(false)} />
      <Notifications profile={profile} scope="worker" embedded onNavigate={openActivitySource} onUnreadChange={reportActivityUnread} />
    </div>
  );

  return (
    <div className="min-h-[60dvh]">
      <InboxActivityEntry unread={displayedActivityUnread} detail="Job, payment, security and official updates" onOpen={() => setShowActivity(true)} />
      <section className="pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold">Messages</h2><p className="mt-1 text-xs text-[var(--wh-text-muted)]">Customers and WeHouse conversations.</p></div>
          {displayedChatUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-xs font-semibold text-[var(--wh-accent-text)]">{displayedChatUnread > 99 ? "99+" : displayedChatUnread} new</span> : null}
        </div>
        {loadError && <ReadError text={loadError} onRetry={() => { setLoading(true); setLoadError(''); void refresh(); }} />}
        {loading ? <Empty text="Loading conversations…" /> : rows.length > 0 ? (
          <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
            {rows.map((row) => <ConversationRow key={row.conversation_id} row={row} onOpen={() => setSelected(row)} />)}
          </div>
        ) : null}
        <section className="overflow-hidden border-b border-[var(--wh-border-subtle)]">
          <SupportEntryCard profile={profile} compact hideWhenEmpty onAvailabilityChange={setSupportAvailable} />
        </section>
        {!loading && !loadError && rows.length === 0 && !supportAvailable ? <div className="grid min-h-48 place-items-center text-center"><div><p className="text-sm font-semibold">No conversations yet</p><p className="mt-2 text-sm text-[var(--wh-text-muted)]">New WeHouse Services conversations will appear here.</p></div></div> : null}
      </section>
    </div>
  );
}

export function WorkerInboxPanel(props: Parameters<typeof WorkerInboxContent>[0]) {
  return <WorkerInboxContent key={props.profile.user_id} {...props} />;
}

function ReadError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <section role="alert" className="my-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4"><p className="text-sm text-[var(--wh-text-secondary)]">{text}</p><button type="button" onClick={onRetry} className="wh-motion-control mt-3 min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold">Try again</button></section>;
}

function JobRow({ row, onOpen }: { row: WorkerBookingConversation; onOpen: () => void }) {
  const status = BOOKING_STATUS_LABELS[row.booking_status], amount = Number(row.negotiated_amount || 0);
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left">
    <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${ATTENTION.has(row.booking_status) ? "bg-amber-400" : "bg-violet-400"}`} />
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.service_type || "Service job"}</p><p className="mt-1 truncate text-xs text-[var(--wh-text-muted)]">{row.other_person_name || "Customer"}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{workerHint(row.booking_status)}</p></div>
    <div className="shrink-0 text-right">{amount > 0 ? <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{formatMoney(amount)}</p> : null}<span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-semibold ${status?.color || "bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"}`}>{status?.label || row.booking_status.replace(/_/g, " ")}</span></div>
  </button>;
}

function ConversationRow({ row, onOpen }: { row: WorkerBookingConversation; onOpen: () => void }) {
  const unread = Number(row.unread_count || 0), time = row.last_message_time || row.updated_at;
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-4 text-left">
    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-[var(--wh-accent-text)]">{row.other_person_avatar ? <img src={row.other_person_avatar} alt="" className="h-full w-full object-cover" /> : (row.other_person_name || "C")[0].toUpperCase()}</div>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{row.other_person_name || "Customer"}</p><span className="shrink-0 text-xs text-[var(--wh-accent-text)]">{BOOKING_STATUS_LABELS[row.booking_status]?.label || row.booking_status.replace(/_/g, " ")}</span></div><p className={`mt-1 truncate text-sm ${unread ? "font-semibold text-[var(--wh-text)]" : "text-[var(--wh-text-muted)]"}`}>{row.last_message || "Service request started"}</p></div>
    <div className="shrink-0 text-right">{time ? <p className="text-xs text-[var(--wh-text-muted)]">{formatConversationTime(time)}</p> : null}{unread ? <span className="mt-2 inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1.5 text-xs font-bold">{unread}</span> : null}</div>
  </button>;
}

function formatConversationTime(value: string) {
  const date = new Date(value), today = new Date();
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { day: "numeric", month: "short" });
}
function workerHint(status: string) {
  const hints: Record<string, string> = { booking_requested: "Open the conversation and respond", negotiating: "Agree the job, date and price", waiting_payment: "Waiting for customer payment", confirmed: "Paid · ready to start", in_progress: "Work in progress", completed_pending_approval: "Waiting for customer confirmation", approved_released: "Completed · earnings released", disputed: "WeHouse review in progress", cancelled: "Cancelled", refunded: "Refunded" };
  return hints[status] || "Open its conversation for details";
}
function Empty({ text }: { text: string }) { return <div className="border-y border-dashed border-[var(--wh-border-subtle)] px-5 py-12 text-center text-sm text-[var(--wh-text-muted)]">{text}</div>; }
