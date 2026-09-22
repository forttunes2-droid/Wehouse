import OperationalThreadSurface from "@/components/OperationalThreadSurface";
import { withTimeout } from "@/lib/withTimeout";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnouncementsTab } from "@/components/AnnouncementsTab";
import SecureSupportAttachment from "@/components/SecureSupportAttachment";
import { supabase } from "@/lib/supabase";
import { createRefreshScheduler } from "@/lib/refreshScheduler";
import {
  claimCommunicationCase,
  conversationPresentation,
  deleteSupportAttachment,
  getOperationalConversationBundle,
  getSupportInbox,
  markSupportMessagesRead,
  sendSupportMessage,
  supportNextStep,
  supportStatusLabel,
  transitionSupportCase,
  uploadSupportAttachment,
  type SupportCaseEvent,
} from "@/lib/supabase/support";
import type { Profile } from "@/types";

type View = "inbox" | "broadcast";
type CaseAction =
  | "start"
  | "request_info"
  | "escalate"
  | "resolve"
  | "close";
type Scope = "all" | { state: string; lga: string };
type Props = {
  profile: Profile;
  scope: Scope;
  onOpenConversation?: (id?: string) => void;
  forcedView?: View;
  hideViewTabs?: boolean;
  queue?:
    | "all"
    | "support"
    | "operations"
    | "property_operations"
    | "reservation_operations"
    | "field_operations";
  onUnreadChange?: (count: number) => void;
  initialConversationId?: string;
  onOpenContext?: (page: string, id?: string) => void;
};
const MAX_FILES = 6,
  MAX_FILE_SIZE = 25 * 1024 * 1024;

export default function CommunicationsWorkspace({
  profile,
  scope,
  forcedView,
  hideViewTabs = false,
  queue = "support",
  onUnreadChange,
  initialConversationId,
  onOpenContext,
}: Props) {
  const [view, setView] = useState<View>(forcedView || "inbox"),
    [rows, setRows] = useState<any[]>([]),
    [loadingList, setLoadingList] = useState(true),
    [loadingThread, setLoadingThread] = useState(false),
    [listError, setListError] = useState(""),
    [threadError, setThreadError] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<any | null>(null),
    [messages, setMessages] = useState<any[]>([]),
    [internalNotes, setInternalNotes] = useState<any[]>([]),
    [events, setEvents] = useState<SupportCaseEvent[]>([]),
    [input, setInput] = useState(""),
    [sending, setSending] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [messageVisibility, setMessageVisibility] = useState<"customer" | "internal">("customer"),
    [caseAction, setCaseAction] = useState<CaseAction | null>(null),
    [caseNote, setCaseNote] = useState(""),
    [updatingCase, setUpdatingCase] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    bottomRef = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null),
    openedInitialRef = useRef<string | null>(null),
    listLoadedRef = useRef(false),
    selectedIdRef = useRef<string | null>(null),
    listRequestRef = useRef(0),
    threadRequestRef = useRef(0),
    scopeEpochRef = useRef(0),
    selectionRef = useRef(0),
    receiptRef = useRef(""),
    scrollRef = useRef<HTMLElement>(null),
    stickToBottomRef = useRef(true);
  useEffect(() => {
    scopeEpochRef.current += 1;
    listLoadedRef.current = false;
    selectedIdRef.current = null;
    setRows([]); setSelected(null); setMessages([]); setInternalNotes([]); setEvents([]);
    setListError(""); setThreadError("");
    return () => { scopeEpochRef.current += 1; listRequestRef.current += 1; threadRequestRef.current += 1; };
  }, [profile.user_id, queue]);
  useEffect(() => {
    if (forcedView) setView(forcedView);
  }, [forcedView]);
  async function load(quiet = false) {
    const request = ++listRequestRef.current;
    const epoch = scopeEpochRef.current;
    const current = () => request === listRequestRef.current && epoch === scopeEpochRef.current;
    const blockList = !quiet && !listLoadedRef.current;
    if (blockList) setLoadingList(true);
    try {
      const { conversations, error } = await withTimeout(getSupportInbox(queue), 15000, "Your inbox could not be loaded. Try again.");
      if (!current()) return;
      if (error) throw error;
      const next = conversations || [];
      setRows(next); setListError("");
      setSelected((row: any | null) => row ? next.find((item: any) => item.conversation_id === row.conversation_id) || row : null);
      listLoadedRef.current = true;
      if (initialConversationId && openedInitialRef.current !== initialConversationId) {
        const target = next.find((row: any) => String(row.conversation_id) === String(initialConversationId));
        openedInitialRef.current = initialConversationId;
        if (target) void open(target);
        else toast.error("The linked conversation is no longer available in this inbox.");
      }
    } catch (cause) {
      if (current()) setListError((cause as Error)?.message || "Your inbox could not be loaded. Try again.");
    } finally {
      if (current()) setLoadingList(false);
    }
  }
  async function refreshMessages(id: string, quiet = false) {
    const request = ++threadRequestRef.current;
    const epoch = scopeEpochRef.current;
    const current = () => request === threadRequestRef.current && epoch === scopeEpochRef.current && selectedIdRef.current === id;
    if (!quiet) setLoadingThread(true);
    try {
      const { bundle, error } = await withTimeout(getOperationalConversationBundle(id), 15000, "This conversation could not be loaded. Try again.");
      if (!current()) return;
      if (error) throw error;
      setMessages(bundle.messages || []);
      setInternalNotes(bundle.internal_notes || []);
      setEvents(bundle.events || []);
      setThreadError("");
      // A read failure, superseded request, or closed screen cannot mark anything read.
      // Receipt writes do not delay painting, and a receipt event cannot create a loop.
      const unread = bundle.messages.filter((message: any) => !message.is_read && message.sender_id !== profile.user_id);
      const receiptKey = `${id}:${unread.map((message: any) => message.id).join(",")}`;
      if (unread.length && receiptRef.current !== receiptKey) {
        receiptRef.current = receiptKey;
        void markSupportMessagesRead(id).then(({ error: readError }) => {
          if (readError && receiptRef.current === receiptKey) receiptRef.current = "";
        }).catch(() => { if (receiptRef.current === receiptKey) receiptRef.current = ""; });
      }
    } catch (cause) {
      if (current()) {
        setMessages([]); setInternalNotes([]); setEvents([]);
        setThreadError((cause as Error)?.message || "This conversation could not be loaded. Try again.");
      }
    } finally {
      if (current()) setLoadingThread(false);
    }
  }
  useEffect(() => {
    if (view === "inbox" && !selected) void load(listLoadedRef.current);
  }, [view, selected, profile.user_id, queue, initialConversationId]);
  useEffect(() => {
    if (view !== "inbox") return;
    const scheduler = createRefreshScheduler(
      async (isCurrent) => {
        if (!isCurrent()) return;
        // A slow list must not hold up the thread that is already open.
        await Promise.allSettled([
          load(true),
          ...(selectedIdRef.current ? [refreshMessages(selectedIdRef.current, true)] : []),
        ]);
      },
      () => document.visibilityState === "visible",
      180,
    );
    const reconcile = () => scheduler.request();
    const visible = () => {
      if (document.visibilityState === "visible") scheduler.request();
    };
    const channel = supabase
      .channel(`support-team-inbox:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        reconcile,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_conversations" },
        reconcile,
      )
      .subscribe();
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => {
      scheduler.dispose();
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(channel);
    };
  }, [view, selected?.conversation_id, profile.user_id, queue]);
  useEffect(() => {
    if (loadingThread || !stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, loadingThread]);
  function closeThread() {
    selectionRef.current += 1;
    selectedIdRef.current = null;
    threadRequestRef.current += 1;
    setSelected(null); setMessages([]); setEvents([]); setInternalNotes([]);
    setFiles([]); setInput(""); setCaseAction(null); setCaseNote("");
    setThreadError(""); setLoadingThread(false); setSending(false); setUpdatingCase(false);
  }
  async function open(row: any) {
    selectionRef.current += 1;
    selectedIdRef.current = row.conversation_id;
    stickToBottomRef.current = true;
    setSelected(row); setMessages([]); setEvents([]); setInternalNotes([]);
    setFiles([]); setInput(""); setCaseAction(null); setCaseNote("");
    setThreadError(""); setSending(false); setUpdatingCase(false);
    setMessageVisibility("customer");
    await refreshMessages(row.conversation_id);
    // No automatic composer focus: the recording showed the keyboard opening
    // and pushing the entire Inbox before the person chose to write anything.
  }
  function addFiles(list: FileList | null) {
    if (!list) return;
    const valid = Array.from(list).filter((file) => {
      if (file.type.startsWith("audio/")) {
        toast.error("WeHouse conversations do not use voice notes");
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is larger than 25MB`);
        return false;
      }
      return true;
    });
    setFiles((current) => {
      const next = [...current, ...valid].slice(0, MAX_FILES);
      if (current.length + valid.length > MAX_FILES)
        toast.error("A maximum of 6 files can be sent at once");
      return next;
    });
    if (fileRef.current) fileRef.current.value = "";
  }
  async function reply() {
    if (!selected || sending || loadingThread || threadError || (!input.trim() && !files.length)) return;
    const targetId = selected.conversation_id;
    const selection = selectionRef.current;
    const epoch = scopeEpochRef.current;
    const current = () => selectedIdRef.current === targetId && selectionRef.current === selection && epoch === scopeEpochRef.current;
    const body = input.trim(), visibility = messageVisibility, attachments = [...files];
    const paths: string[] = [], types: string[] = [];
    let sent = false;
    setSending(true);
    try {
      for (const file of attachments) {
        const uploaded = await uploadSupportAttachment(targetId, file);
        if (uploaded.error || !uploaded.path) throw new Error(uploaded.error?.message || `Could not upload ${file.name}`);
        paths.push(uploaded.path);
        types.push(file.type || "application/octet-stream");
      }
      // The captured recipient/body cannot become a different thread mid-send.
      const { error } = await sendSupportMessage(targetId, body, paths, types, null, visibility);
      if (error) throw error;
      sent = true;
      if (!current()) return;
      stickToBottomRef.current = true;
      setInput(""); setFiles([]);
      await refreshMessages(targetId, true);
      void load(true);
    } catch (cause) {
      if (!sent) await Promise.allSettled(paths.map(path => deleteSupportAttachment(path)));
      if (current()) toast.error((cause as Error)?.message || "Unable to send reply");
    } finally {
      if (current()) setSending(false);
    }
  }
  async function takeConversation() {
    if (!selected || updatingCase || profile.role !== "staff") return;
    const target = selected, selection = selectionRef.current, epoch = scopeEpochRef.current;
    const current = () => selection === selectionRef.current && epoch === scopeEpochRef.current;
    setUpdatingCase(true);
    try {
      const claimed = await claimCommunicationCase(selected.conversation_id);
      if (claimed.error) throw claimed.error;
      if (!current()) return;
      toast.success(conversationPresentation(target, presentationAudience).operational ? "Assignment taken" : "Request assigned to you");
      await load(true);
    } catch (cause) {
      if (current()) toast.error((cause as Error)?.message || "This work could not be assigned");
    } finally {
      if (current()) setUpdatingCase(false);
    }
  }

  async function updateCase(action: CaseAction) {
    if (!selected || updatingCase || loadingThread || threadError) return;
    if (["request_info", "escalate", "resolve"].includes(action) && !caseNote.trim()) {
      toast.error(action === "request_info" ? "Say exactly what information the requester must provide" : action === "escalate" ? "Add the reason for escalation" : "Explain the outcome before resolving");
      return;
    }
    const targetId = selected.conversation_id, selection = selectionRef.current, epoch = scopeEpochRef.current;
    const current = () => selection === selectionRef.current && epoch === scopeEpochRef.current;
    setUpdatingCase(true);
    try {
      const { error } = await transitionSupportCase(targetId, action, caseNote.trim());
      if (error) throw error;
      if (!current()) return;
      const nextStatus: Record<CaseAction, string> = { start: "in_progress", request_info: "waiting_for_user", escalate: "escalated", resolve: "resolved", close: "closed" };
      setSelected((row: any | null) => row?.conversation_id === targetId ? { ...row, status: nextStatus[action] } : row);
      setCaseAction(null); setCaseNote("");
      toast.success(caseActionConfirmation(action));
      await refreshMessages(targetId, true);
      void load(true);
    } catch (cause) {
      if (current()) toast.error((cause as Error)?.message || "Could not update this request");
    } finally {
      if (current()) setUpdatingCase(false);
    }
  }
  const reservationQueue =
      queue === "reservation_operations" || queue === "operations",
    presentationAudience = reservationQueue ? "operations" : "customer";
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const presentation = conversationPresentation(row, presentationAudience);
      return [
        row.requester_name,
        row.requester_email,
        row.requester_role,
        row.requester_lga,
        row.requester_state,
        row.last_message,
        row.subject,
        row.context_type,
        row.context_id,
        presentation.title,
        presentation.meta,
        JSON.stringify(row.context_snapshot || {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [presentationAudience, rows, search]);
  const unread = rows.reduce((n, row) => n + Number(row.unread_count || 0), 0);
  useEffect(() => {
    onUnreadChange?.(unread);
  }, [onUnreadChange, unread]);

  if (view === "broadcast")
    return (
      <div className="space-y-4">
        {!hideViewTabs && (
          <HeaderTabs view={view} setView={setView} unread={unread} />
        )}
        <div>
          {!hideViewTabs && <h2 className="text-base font-bold">New update</h2>}
          <p className="mt-1 text-[10px] text-[#696E7F]">
            Share a WeHouse Official update with the selected audience.
          </p>
        </div>
        <AnnouncementsTab profile={profile} scope={scope} />
      </div>
    );
  if (selected) {
    const selectedPresentation = conversationPresentation(
      selected,
      presentationAudience,
    );
    const destination = communicationDestination(selected);
    const requesterLabel =
      selected.requester_name || selected.requester_email || "WeHouse member";
    const handlerLabel =
      selected.assigned_staff_name ||
      (profile.role === "staff"
        ? "Awaiting assignment"
        : profile.full_name || profile.username || "Current team member");
    const staffOwnsConversation =
      profile.role !== "staff" || selected.assigned_staff_id === profile.user_id;
    const staffCanTakeConversation =
      profile.role === "staff" && !selected.assigned_staff_id;
    const caseNumber = String(selected.context_snapshot?.case_number || "");
    const conversationLocked = Boolean(
      loadingThread || threadError || !staffOwnsConversation ||
        (!selectedPresentation.operational &&
          (selected.status === "resolved" || selected.status === "closed")),
    );
    return (
      <OperationalThreadSurface conversationId={selected.conversation_id} onClose={closeThread}>
      {(dismiss) => (
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[#0E1219]">
        <header className="flex items-center gap-3 border-b border-white/[.06] px-3 py-3 sm:px-4">
          <button
            type="button"
            aria-label="Back to conversations"
            onClick={() => dismiss()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#9DA3B2] hover:bg-white/[.05]"
          >
            ←
          </button>
          <Avatar name={selected.requester_name || selected.requester_email} compact />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{requesterLabel}</p>
            <p className="mt-0.5 truncate text-[11px] text-[#858B9B]">
              {selectedPresentation.operational
                ? selectedPresentation.operator
                : selectedPresentation.title}
            </p>
          </div>
          {Number(selected.unread_count || 0) > 0 && (
            <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] text-violet-300">
              new
            </span>
          )}
        </header>
        {profile.role === "staff" && !staffOwnsConversation ? (
          <section className="flex items-center justify-between gap-3 border-b border-white/[.06] bg-amber-500/[.04] px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-amber-100">
                {staffCanTakeConversation
                  ? "This work is not assigned yet"
                  : `Assigned to ${selected.assigned_staff_name || "another team member"}`}
              </p>
              <p className="mt-1 text-[8px] text-[#777E8E]">
                Opening a record never assigns it. Take it explicitly before replying or changing its state.
              </p>
            </div>
            {staffCanTakeConversation ? (
              <button
                type="button"
                disabled={updatingCase}
                onClick={() => void takeConversation()}
                className="min-h-10 shrink-0 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-50"
              >
                {updatingCase
                  ? "Assigning…"
                  : selectedPresentation.operational
                    ? "Take assignment"
                    : "Take request"}
              </button>
            ) : null}
          </section>
        ) : null}
        {!selectedPresentation.operational && (
        <section className="border-b border-white/[.06] bg-[#0B0F15] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold text-[#D9DCE4]">
                {selectedPresentation.title}
              </p>
              <p className="mt-0.5 truncate text-[8px] text-[#687081]">
                {[
                  caseNumber ? `Case ${caseNumber}` : "WeHouse conversation",
                  publicRole(selected.requester_role),
                  [selected.requester_lga, selected.requester_state]
                    .filter(Boolean)
                    .join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <StatusBadge status={selected.status} />
          </div>
        </section>
        )}
        {!selectedPresentation.operational && <CaseManagementPanel
          row={selected}
          events={events}
          activeAction={caseAction}
          note={caseNote}
          busy={updatingCase}
          canManage={staffOwnsConversation}
          onSelectAction={(action) => {
            setCaseAction(action);
            setCaseNote("");
          }}
          onNoteChange={setCaseNote}
          onCancel={() => {
            setCaseAction(null);
            setCaseNote("");
          }}
          onSubmit={(action) => void updateCase(action)}
        />}
        {selectedPresentation.operational && (
          <div className="flex items-center gap-3 border-b border-white/[.06] bg-violet-500/[.045] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-violet-100">
                {selectedPresentation.title}
              </p>
              <p className="mt-1 truncate text-[11px] text-[#8A91A2]">
                {selectedPresentation.meta}
              </p>
            </div>
            {onOpenContext && (
              <button
                type="button"
                onClick={() => dismiss(() => onOpenContext(destination.page, destination.id))}
                className="min-h-10 shrink-0 rounded-xl bg-violet-500 px-3 text-[11px] font-semibold"
              >
                {selectedPresentation.kind === "reservation"
                  ? "Open booking"
                  : selectedPresentation.kind === "property_operations"
                    ? "Open property"
                    : "Open job"}
              </button>
            )}
          </div>
        )}
        {internalNotes.length > 0 ? <InternalNotes notes={internalNotes} /> : null}
        <main ref={scrollRef} onScroll={() => {
          const element = scrollRef.current;
          if (element) stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
          <div className="mx-auto max-w-4xl">
            {loadingThread ? (
              <ThreadSkeleton />
            ) : threadError ? (
              <div className="grid min-h-52 place-items-center text-center">
                <div><p role="alert" className="text-sm text-[#AAA3B3]">{threadError}</p>
                  <button type="button" onClick={() => void refreshMessages(selected.conversation_id)} className="mt-4 min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold">Try again</button>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="grid min-h-72 place-items-center text-center text-[11px] text-[#747A8B]">
                No customer messages yet.
              </div>
            ) : (
              <div className="space-y-3.5">
                {messages.map((msg) => (
                  <Bubble
                    key={msg.id}
                    msg={msg}
                    requesterName={requesterLabel}
                  />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </main>
        <footer className="shrink-0 border-t border-white/[.06] bg-[#10141B] p-2.5 pb-[max(.625rem,env(safe-area-inset-bottom))] sm:p-3">
          <div className="mx-auto mb-2 flex max-w-4xl gap-2">
            <button
              type="button"
              onClick={() => setMessageVisibility("customer")}
              className={`min-h-9 rounded-full px-3 text-[11px] font-semibold ${messageVisibility === "customer" ? "bg-violet-500 text-white" : "bg-white/[.05] text-[#8A90A0]"}`}
            >
              Reply to customer
            </button>
            <button
              type="button"
              onClick={() => setMessageVisibility("internal")}
              className={`min-h-9 rounded-full px-3 text-[11px] font-semibold ${messageVisibility === "internal" ? "bg-amber-500/20 text-amber-200" : "bg-white/[.05] text-[#8A90A0]"}`}
            >
              Internal work note
            </button>
          </div>
          {files.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-4xl gap-2 overflow-x-auto">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.06] px-3 py-2"
                >
                  <p className="max-w-40 truncate text-[9px] text-violet-200">
                    {file.name}
                  </p>
                  <button
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mx-auto flex max-w-4xl items-end gap-2">
            <button
              type="button"
              aria-label="Attach a file"
              onClick={() => fileRef.current?.click()}
              disabled={conversationLocked}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.06] bg-white/[.035] text-[#9AA0B1] hover:bg-white/[.05]"
            >
              ＋
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/plain,.doc,.docx"
              onChange={(e) => addFiles(e.target.files)}
              className="hidden"
            />
            <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.07] bg-[#1A1F28] px-3 py-1.5 focus-within:border-violet-500/35">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void reply();
                  }
                }}
                rows={1}
                disabled={conversationLocked}
                placeholder={
                  conversationLocked
                    ? "Use the request controls above"
                    : messageVisibility === "internal"
                      ? "Add a work note visible only to the WeHouse team"
                    : reservationQueue
                      ? "Reply as Property Operations"
                      : "Reply as WeHouse"
                }
                className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none"
              />
            </div>
            <button
              type="button"
              aria-label="Send message"
              onClick={() => void reply()}
              disabled={
                sending ||
                conversationLocked ||
                (!input.trim() && !files.length)
              }
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05] disabled:text-[#666C7D]"
            >
              {sending ? "…" : "➤"}
            </button>
          </div>
          <p className={`mx-auto mt-2 max-w-4xl text-center text-[10px] ${messageVisibility === "internal" ? "text-amber-300/70" : "text-[#656C7D]"}`}>
            {messageVisibility === "internal"
              ? "Only authorized WeHouse team members can see this note."
              : `Customer reply from ${handlerLabel} · WeHouse`}
          </p>
        </footer>
      </div>
      )}
      </OperationalThreadSurface>
    );
  }

  return (
    <div className="space-y-4">
      {!hideViewTabs && (
        <HeaderTabs view={view} setView={setView} unread={unread} />
      )}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#606576]">
          ⌕
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            reservationQueue
              ? "Search customer, booking or property"
              : "Search people or messages"
          }
          className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#141820] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"
        />
      </div>
      {listError ? <div className="rounded-xl border border-white/10 p-4">
        <p role="alert" className="text-sm text-[#AAA3B3]">{listError}</p>
        <button type="button" onClick={() => void load()} className="mt-2 min-h-11 text-sm font-semibold text-violet-300">Try again</button>
      </div> : null}
      {loadingList ? (
        <ConversationListSkeleton />
      ) : listError && !rows.length ? null : shown.length === 0 ? (
        <div className="grid min-h-36 place-items-center border-y border-white/[.06] px-5 text-center">
          <div>
            <p className="text-sm font-semibold">No conversations</p>
            <p className="mt-1 text-[10px] text-[#666B7C]">
              New messages will appear here.
            </p>
          </div>
        </div>
      ) : (
        <section className="overflow-hidden border-y border-white/[.06]">
          {shown.map((row, index) => (
            <div key={row.conversation_id}>
              {index > 0 && <div className="ml-[4.5rem] h-px bg-white/[.05]" />}
              <button
                onClick={() => void open(row)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025]"
              >
                <Avatar name={row.requester_name || row.requester_email} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[13px] font-semibold">
                      {row.requester_name ||
                        row.requester_email ||
                        "WeHouse member"}
                    </p>
                    <span className="shrink-0 rounded-full bg-white/[.04] px-2 py-0.5 text-[8px] capitalize text-[#777C8D]">
                      {publicRole(row.requester_role)}
                    </span>
                    <StatusBadge status={row.status} />
                  </div>
                  {reservationQueue ? (
                    <ReservationContext
                      row={row}
                      audience={presentationAudience}
                    />
                  ) : (
                    <>
                      <p
                        className={`mt-1 truncate text-[11px] ${Number(row.unread_count || 0) > 0 ? "font-medium text-[#E3E5EB]" : "text-[#777C8D]"}`}
                      >
                        {row.last_message || "Conversation started"}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-[#596071]">
                        {[row.requester_lga, row.requester_state]
                          .filter(Boolean)
                          .join(", ") || "Location unavailable"}
                        {row.context_type && row.context_type !== "general"
                          ? ` · ${String(row.context_type).replace(/_/g, " ")}`
                          : ""}
                      </p>
                    </>
                  )}
                </div>
                <div className="shrink-0 self-start pt-0.5 text-right">
                  {row.last_message_time && (
                    <p
                      className={`text-[8px] ${Number(row.unread_count || 0) > 0 ? "text-violet-300" : "text-[#555A6B]"}`}
                    >
                      {formatListTime(row.last_message_time)}
                    </p>
                  )}
                  {Number(row.unread_count || 0) > 0 && (
                    <span className="ml-auto mt-2 grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">
                      {row.unread_count > 99 ? "99+" : row.unread_count}
                    </span>
                  )}
                </div>
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function CaseManagementPanel({
  row,
  events,
  activeAction,
  note,
  busy,
  canManage,
  onSelectAction,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  row: any;
  events: SupportCaseEvent[];
  activeAction: CaseAction | null;
  note: string;
  busy: boolean;
  canManage: boolean;
  onSelectAction: (action: CaseAction) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (action: CaseAction) => void;
}) {
  const next = supportNextStep(row.status, row.assigned_staff_name);
  const actions = canManage ? availableCaseActions(row.status) : [];
  const importantEvent = [...events]
    .reverse()
    .find((event) =>
      ["information_requested", "escalated", "resolved"].includes(
        event.event_type,
      ),
    );
  return (
    <section className="border-b border-white/[.06] bg-[#11161E] px-4 py-4">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#697183]">
              Request handling
            </p>
            <p className="mt-1 text-[12px] font-semibold text-[#ECEEF2]">
              {row.subject || "WeHouse request"}
            </p>
          </div>
          <StatusBadge status={row.status} large />
        </div>
        <div className="mt-3 grid gap-3 rounded-2xl border border-white/[.06] bg-black/10 p-3 sm:grid-cols-3">
          <CaseFact
            label="Owner"
            value={row.assigned_staff_name || "Awaiting assignment"}
          />
          <CaseFact label="Next action by" value={next.actor} />
          <CaseFact label="What happens now" value={next.text} wide />
        </div>
        {importantEvent?.note &&
        ["waiting_for_user", "escalated", "resolved"].includes(row.status) ? (
          <div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-2.5">
            <p className="text-[8px] font-semibold uppercase tracking-wide text-[#646C7D]">
              Latest decision
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[#CDD0D8]">
              {importantEvent.note}
            </p>
          </div>
        ) : null}
        {actions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() =>
                  action === "start" || action === "close"
                    ? onSubmit(action)
                    : onSelectAction(action)
                }
                className={`min-h-9 rounded-xl px-3 text-[9px] font-semibold disabled:opacity-50 ${caseActionTone(action)}`}
              >
                {caseActionLabel(action)}
              </button>
            ))}
          </div>
        ) : null}
        {activeAction &&
        ["request_info", "escalate", "resolve"].includes(activeAction) ? (
          <div className="mt-3 rounded-2xl border border-violet-500/15 bg-violet-500/[.04] p-3">
            <label className="text-[9px] font-semibold text-violet-200">
              {caseActionPrompt(activeAction)}
            </label>
            <textarea
              autoFocus
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={3}
              placeholder={caseActionPlaceholder(activeAction)}
              className="mt-2 w-full resize-none rounded-xl border border-white/[.07] bg-[#0D1118] p-3 text-[11px] leading-5 outline-none placeholder:text-[#575E6F] focus:border-violet-500/35"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="min-h-9 rounded-xl px-3 text-[9px] font-semibold text-[#8A90A0]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => onSubmit(activeAction)}
                className="min-h-9 rounded-xl bg-violet-500 px-4 text-[9px] font-semibold disabled:opacity-50"
              >
                {busy ? "Updating…" : caseActionLabel(activeAction)}
              </button>
            </div>
          </div>
        ) : null}
        <details className="mt-3 border-t border-white/[.05] pt-3">
          <summary className="cursor-pointer text-[9px] font-semibold text-violet-300">
            Request history · {events.length + 1} update
            {events.length === 0 ? "" : "s"}
          </summary>
          <div className="mt-3 space-y-2 border-l border-white/[.08] pl-3">
            <StaffHistoryItem
              title="Request sent to WeHouse"
              time={row.created_at}
              note={null}
            />
            {events.map((event) => (
              <StaffHistoryItem
                key={event.id}
                title={caseEventLabel(event.event_type)}
                time={event.created_at}
                note={event.note}
              />
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function CaseFact({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-1" : ""}>
      <p className="text-[8px] font-semibold uppercase tracking-wide text-[#626A7B]">
        {label}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-[#CACDD5]">{value}</p>
    </div>
  );
}

function StaffHistoryItem({
  title,
  time,
  note,
}: {
  title: string;
  time: string;
  note: string | null;
}) {
  return (
    <div>
      <p className="text-[9px] font-medium text-[#D2D5DC]">{title}</p>
      <p className="mt-0.5 text-[8px] text-[#5E6575]">
        {new Date(time).toLocaleString([], {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {note ? (
        <p className="mt-1 text-[9px] leading-4 text-[#858B99]">{note}</p>
      ) : null}
    </div>
  );
}

function availableCaseActions(status: string): CaseAction[] {
  if (status === "open" || status === "assigned") return ["start"];
  if (status === "in_progress")
    return ["request_info", "escalate", "resolve"];
  if (status === "waiting_for_user") return ["escalate", "resolve"];
  if (status === "escalated") return ["request_info", "resolve"];
  if (status === "resolved") return ["close"];
  return [];
}

function caseActionLabel(action: CaseAction) {
  const labels: Record<CaseAction, string> = {
    start: "Start work",
    request_info: "Request information",
    escalate: "Escalate",
    resolve: "Resolve",
    close: "Close request",
  };
  return labels[action];
}

function caseActionPrompt(action: CaseAction) {
  if (action === "request_info") return "What exactly must the requester send?";
  if (action === "escalate") return "Why does this need additional review?";
  return "What was done and what is the outcome?";
}

function caseActionPlaceholder(action: CaseAction) {
  if (action === "request_info")
    return "Example: Please upload the payment receipt showing the transaction reference.";
  if (action === "escalate")
    return "Explain the issue and why another WeHouse reviewer is needed.";
  return "Explain the result in plain language the requester can understand.";
}

function caseActionTone(action: CaseAction) {
  if (action === "escalate") return "bg-rose-500/10 text-rose-300";
  if (action === "resolve" || action === "close")
    return "bg-emerald-500/10 text-emerald-300";
  return "bg-violet-500/10 text-violet-300";
}

function caseActionConfirmation(action: CaseAction) {
  const labels: Record<CaseAction, string> = {
    start: "Work started",
    request_info: "Requester notified about the information needed",
    escalate: "Request escalated",
    resolve: "Outcome sent to the requester",
    close: "Request closed",
  };
  return labels[action];
}

function StatusBadge({
  status,
  large = false,
}: {
  status: string;
  large?: boolean;
}) {
  const tone =
    status === "waiting_for_user"
      ? "bg-amber-500/10 text-amber-300"
      : status === "escalated"
        ? "bg-rose-500/10 text-rose-300"
        : status === "resolved" || status === "closed"
          ? "bg-emerald-500/10 text-emerald-300"
          : "bg-violet-500/10 text-violet-300";
  return (
    <span
      className={`shrink-0 rounded-full font-semibold ${large ? "px-2.5 py-1 text-[8px]" : "px-2 py-0.5 text-[7px]"} ${tone}`}
    >
      {supportStatusLabel(status, "staff")}
    </span>
  );
}

function caseEventLabel(value: string) {
  const labels: Record<string, string> = {
    assigned: "Assigned to a WeHouse team member",
    work_started: "WeHouse started work",
    information_requested: "Information requested",
    requester_replied: "Requester supplied information",
    escalated: "Escalated for additional review",
    resolved: "Outcome sent to requester",
    resolution_accepted: "Requester confirmed the outcome",
    closed: "Request closed",
    reopened: "Requester still needs help",
  };
  return labels[value] || value.replace(/_/g, " ");
}

function communicationDestination(row: any) {
  const type = String(
    row.context_type || row.context_snapshot?.source_type || "",
  );
  const id =
    String(
      row.context_id ||
        row.context_snapshot?.source_id ||
        row.context_snapshot?.booking_id ||
        row.context_snapshot?.listing_id ||
        "",
    ) || undefined;
  if (
    [
      "property_listing",
      "property_inspection",
      "hotel_property",
      "hotel_operations",
    ].includes(type)
  )
    return { page: "operations_properties", id };
  if (
    [
      "apartment_reservation",
      "apartment_payment",
      "reservation",
      "hotel_booking",
    ].includes(type)
  )
    return { page: "operations_bookings", id };
  if (type === "worker_booking") return { page: "operations_workers", id };
  return {
    page: "operations_inbox",
    id: String(row.conversation_id || "") || undefined,
  };
}
function ReservationContext({
  row,
  audience,
}: {
  row: any;
  audience: "customer" | "operations";
}) {
  const presentation = conversationPresentation(row, audience);
  return (
    <>
      <p
        className={`mt-1 truncate text-xs ${Number(row.unread_count || 0) > 0 ? "font-medium text-[#E3E5EB]" : "text-[#A0A5B3]"}`}
      >
        {presentation.title}
        {presentation.meta ? ` · ${presentation.meta}` : ""}
      </p>
      <p className="mt-1 truncate text-[10px] text-[#666D7E]">
        {row.last_message || "Conversation started"}
      </p>
    </>
  );
}
function HeaderTabs({
  view,
  setView,
  unread,
}: {
  view: View;
  setView: (v: View) => void;
  unread: number;
}) {
  return (
    <div className="grid grid-cols-2 border-b border-white/[.06]">
      <button
        onClick={() => setView("inbox")}
        className={`relative min-h-12 text-xs font-semibold ${view === "inbox" ? "text-white" : "text-[#777B8D]"}`}
      >
        Chats{unread ? ` · ${unread}` : ""}
        {view === "inbox" && (
          <span className="absolute inset-x-8 bottom-0 h-0.5 bg-violet-400" />
        )}
      </button>
      <button
        onClick={() => setView("broadcast")}
        className={`relative min-h-12 text-xs font-semibold ${view === "broadcast" ? "text-white" : "text-[#8B8F9F]"}`}
      >
        Updates
        {view === "broadcast" && (
          <span className="absolute inset-x-8 bottom-0 h-0.5 bg-violet-400" />
        )}
      </button>
    </div>
  );
}
function publicRole(role?: string) {
  if (role === "staff") return "Team member";
  if (role === "property_partner") return "Property Partner";
  return String(role || "user").replace(/_/g, " ");
}
function ConversationListSkeleton() {
  return (
    <div className="border-y border-white/[.06]" aria-label="Loading conversations">
      {[0,1,2].map((item) => (
        <div key={item} className="flex items-center gap-3 px-4 py-3.5">
          <div className="h-12 w-12 shrink-0 rounded-full bg-white/[.05] shimmer" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-28 rounded-full bg-white/[.06] shimmer" />
            <div className="mt-2 h-2.5 w-[72%] rounded-full bg-white/[.04] shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="min-h-72 space-y-4 pt-2" aria-label="Loading conversation">
      <div className="h-14 w-[58%] rounded-[18px] rounded-bl-md bg-white/[.045] shimmer" />
      <div className="ml-auto h-12 w-[42%] rounded-[18px] rounded-br-md bg-violet-500/[.10] shimmer" />
      <div className="h-16 w-[66%] rounded-[18px] rounded-bl-md bg-white/[.045] shimmer" />
    </div>
  );
}

function InternalNotes({ notes }: { notes: any[] }) {
  const latest = notes[notes.length - 1];
  return (
    <details className="max-h-[30%] shrink-0 overflow-y-auto border-b border-white/[.06] bg-amber-500/[.025] px-4 py-2.5">
      <summary className="cursor-pointer list-none text-[10px] font-semibold text-amber-200/90">
        Internal notes · {notes.length}
        <span className="ml-2 font-normal text-amber-100/45">
          {latest?.sender_name ? `Latest by ${latest.sender_name}` : "WeHouse team only"}
        </span>
      </summary>
      <div className="mx-auto mt-2 max-w-4xl space-y-2 pb-1">
        {notes.map((note) => (
          <div key={note.id} className="rounded-xl border border-amber-500/10 bg-black/10 px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-[8px] text-amber-100/45">
              <span className="truncate">{note.sender_name || "WeHouse team"}</span>
              <span>{new Date(note.created_at).toLocaleString()}</span>
            </div>
            {note.content ? <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#C8C1B3]">{note.content}</p> : null}
            {(note.attachments || []).map((path: string, index: number) => <SecureSupportAttachment key={path} path={path} type={note.attachment_types?.[index] || ""} />)}
          </div>
        ))}
      </div>
    </details>
  );
}

function Bubble({
  msg,
  requesterName,
}: {
  msg: any;
  requesterName: string;
}) {
  const meta = msg.action_metadata || {};
  // Direction is assigned by the server from this conversation's participants,
  // not from a legacy profile role that may also have a Personal workspace.
  const fromWeHouse = msg.sender_side === "wehouse";
  const sender = msg.sender_name || requesterName;
  return (
    <div className={`flex ${fromWeHouse ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[88%] flex-col sm:max-w-[72%] ${fromWeHouse ? "items-end" : "items-start"}`}
      >
        {Object.keys(meta).length > 0 && msg.action_type && msg.action_type !== "message" && (
          <ContextCard meta={meta} type={msg.action_type} />
        )}
        {!fromWeHouse ? (
          <p className="mb-1 px-1 text-[9px] font-medium text-[#838A9B]">
            {sender}
          </p>
        ) : null}
        <div
          className={`rounded-[19px] px-3.5 py-2.5 ${fromWeHouse ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-white/[.06] bg-[#171B24]"}`}
        >
          {(msg.attachments || []).map((path: string, i: number) => (
            <SecureSupportAttachment
              key={`${msg.id}-${path}`}
              path={path}
              type={msg.attachment_types?.[i] || ""}
            />
          ))}
          {msg.content && (
            <p className="whitespace-pre-wrap text-sm leading-6">
              {msg.content}
            </p>
          )}
          <p
            className={`mt-1 text-[10px] ${fromWeHouse ? "text-violet-100/70" : "text-[#747B8C]"}`}
          >
            {new Date(msg.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
function ContextCard({ meta, type }: { meta: any; type?: string }) {
  const ref = meta.context_id,
    label = String(
      meta.subject || type || meta.context_type || "Linked item",
    ).replace(/_/g, " ");
  return (
    <div className="mb-1.5 flex items-center gap-3 rounded-xl border border-violet-500/15 bg-violet-500/[.055] px-3 py-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/12 text-[10px] text-violet-200">
        ↗
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <p className="truncate text-[10px] font-semibold capitalize text-violet-200">
          {label}
        </p>
        {ref && (
          <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] text-violet-300">
            Ref {String(ref).slice(0, 18)}
          </span>
        )}
      </div>
    </div>
  );
}
function Avatar({ name, compact = false }: { name?: string; compact?: boolean }) {
  return (
    <div
      className={`grid flex-none place-items-center rounded-full bg-violet-500/20 font-bold text-violet-200 ${compact ? "h-11 min-h-11 w-11 min-w-11 max-w-11 text-sm" : "h-12 min-h-12 w-12 min-w-12 max-w-12 text-sm"}`}
    >
      {(name || "W")[0].toUpperCase()}
    </div>
  );
}
function formatListTime(value: string) {
  const d = new Date(value),
    now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
