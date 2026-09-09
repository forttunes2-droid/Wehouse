import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnouncementsTab } from "@/components/AnnouncementsTab";
import SecureSupportAttachment from "@/components/SecureSupportAttachment";
import { supabase } from "@/lib/supabase";
import {
  claimCommunicationCase,
  conversationPresentation,
  deleteSupportAttachment,
  getSupportCaseEvents,
  getSupportInbox,
  getSupportMessages,
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
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<any | null>(null),
    [messages, setMessages] = useState<any[]>([]),
    [events, setEvents] = useState<SupportCaseEvent[]>([]),
    [input, setInput] = useState(""),
    [sending, setSending] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [caseAction, setCaseAction] = useState<CaseAction | null>(null),
    [caseNote, setCaseNote] = useState(""),
    [updatingCase, setUpdatingCase] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    bottomRef = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null),
    openedInitialRef = useRef<string | null>(null);
  useEffect(() => {
    if (forcedView) setView(forcedView);
  }, [forcedView]);
  async function load(quiet = false) {
    if (!quiet) setLoadingList(true);
    const { conversations, error } = await getSupportInbox(queue);
    if (error && !quiet)
      toast.error(
        error.message ||
          `Unable to load ${queue === "reservation_operations" ? "Operations" : "WeHouse"} inbox`,
      );
    if (!error) {
      const next = conversations || [];
      setRows(next);
      setSelected((current: any | null) =>
        current
          ? next.find(
              (row: any) => row.conversation_id === current.conversation_id,
            ) || current
          : current,
      );
      if (
        initialConversationId &&
        openedInitialRef.current !== initialConversationId
      ) {
        const target = next.find(
          (row: any) =>
            String(row.conversation_id) === String(initialConversationId),
        );
        openedInitialRef.current = initialConversationId;
        if (target) void open(target);
        else if (!quiet)
          toast.error(
            "The linked conversation is no longer available in this inbox.",
          );
      }
    }
    if (!quiet) setLoadingList(false);
  }
  async function refreshMessages(id: string, quiet = false) {
    if (!quiet) setLoadingThread(true);
    const [{ messages: data, error }, { events: history, error: eventError }] =
      await Promise.all([getSupportMessages(id), getSupportCaseEvents(id)]);
    if ((error || eventError) && !quiet)
      toast.error(
        (error || eventError)?.message || "Unable to open conversation",
      );
    if (!error && !eventError) {
      setMessages(data || []);
      setEvents(history);
    }
    await markSupportMessagesRead(id);
    if (!quiet) setLoadingThread(false);
  }
  useEffect(() => {
    if (view === "inbox" && !selected) void load();
  }, [view, selected, profile.user_id, queue, initialConversationId]);
  useEffect(() => {
    if (view !== "inbox") return;
    const channel = supabase
      .channel(`support-team-inbox:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        () => {
          void load(true);
          if (selected?.conversation_id)
            void refreshMessages(selected.conversation_id, true);
        },
      )
      .subscribe();
    const timer = window.setInterval(() => void load(true), 60000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [view, selected?.conversation_id, profile.user_id]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, selected?.conversation_id]);
  async function open(row: any) {
    if (profile.role === "staff" && queue !== "field_operations") {
      const claimed = await claimCommunicationCase(row.conversation_id);
      if (claimed.error)
        return toast.error(
          claimed.error.message || "This case could not be assigned",
        );
    }
    setSelected(
      profile.role === "staff"
        ? {
            ...row,
            assigned_staff_id: profile.user_id,
            assigned_staff_name:
              profile.full_name || profile.username || "Current team member",
            status: row.status === "open" ? "assigned" : row.status,
          }
        : row,
    );
    setFiles([]);
    setInput("");
    setEvents([]);
    setCaseAction(null);
    setCaseNote("");
    await refreshMessages(row.conversation_id);
    void load(true);
    requestAnimationFrame(() => inputRef.current?.focus());
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
    if (!selected || sending || (!input.trim() && !files.length)) return;
    setSending(true);
    const paths: string[] = [],
      types: string[] = [];
    for (const file of files) {
      const uploaded = await uploadSupportAttachment(
        selected.conversation_id,
        file,
      );
      if (uploaded.error || !uploaded.path) {
        for (const path of paths) await deleteSupportAttachment(path);
        setSending(false);
        return toast.error(
          uploaded.error?.message || `Could not upload ${file.name}`,
        );
      }
      paths.push(uploaded.path);
      types.push(file.type || "application/octet-stream");
    }
    const { error } = await sendSupportMessage(
      selected.conversation_id,
      input.trim(),
      paths,
      types,
    );
    if (error) {
      for (const path of paths) await deleteSupportAttachment(path);
      setSending(false);
      return toast.error(error.message || "Unable to send reply");
    }
    setSending(false);
    setInput("");
    setFiles([]);
    await refreshMessages(selected.conversation_id, true);
    void load(true);
  }
  async function updateCase(action: CaseAction) {
    if (!selected || updatingCase) return;
    const noteRequired = ["request_info", "escalate", "resolve"].includes(
      action,
    );
    if (noteRequired && !caseNote.trim()) {
      toast.error(
        action === "request_info"
          ? "Say exactly what information the requester must provide"
          : action === "escalate"
            ? "Add the reason for escalation"
            : "Explain the outcome before resolving",
      );
      return;
    }
    setUpdatingCase(true);
    const { error } = await transitionSupportCase(
      selected.conversation_id,
      action,
      caseNote.trim(),
    );
    if (error) {
      setUpdatingCase(false);
      toast.error(error.message || "Could not update this request");
      return;
    }
    const nextStatus: Record<CaseAction, string> = {
      start: "in_progress",
      request_info: "waiting_for_user",
      escalate: "escalated",
      resolve: "resolved",
      close: "closed",
    };
    setSelected((current: any | null) =>
      current ? { ...current, status: nextStatus[action] } : current,
    );
    setCaseAction(null);
    setCaseNote("");
    setUpdatingCase(false);
    toast.success(caseActionConfirmation(action));
    await refreshMessages(selected.conversation_id, true);
    void load(true);
  }
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const presentation = conversationPresentation(row);
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
  }, [rows, search]);
  const unread = rows.reduce((n, row) => n + Number(row.unread_count || 0), 0),
    reservationQueue =
      queue === "reservation_operations" || queue === "operations";
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
          <h2 className="text-base font-bold">New update</h2>
          <p className="mt-1 text-[10px] text-[#696E7F]">
            Share a WeHouse Official update with the selected audience.
          </p>
        </div>
        <AnnouncementsTab profile={profile} scope={scope} />
      </div>
    );
  if (selected) {
    const selectedPresentation = conversationPresentation(selected);
    const destination = communicationDestination(selected);
    const requesterLabel =
      selected.requester_name || selected.requester_email || "WeHouse member";
    const handlerLabel =
      selected.assigned_staff_name ||
      profile.full_name ||
      profile.username ||
      "Current team member";
    const caseNumber = String(selected.context_snapshot?.case_number || "");
    return (
      <div className="flex min-h-[70vh] flex-col overflow-hidden border-y border-white/[.06] bg-[#0E1219]">
        <header className="flex items-center gap-3 border-b border-white/[.06] px-3 py-3 sm:px-4">
          <button
            onClick={() => {
              setSelected(null);
              setMessages([]);
              setEvents([]);
              setFiles([]);
              setCaseAction(null);
              setCaseNote("");
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#9DA3B2] hover:bg-white/[.05]"
          >
            ←
          </button>
          <Avatar name={selected.requester_name || selected.requester_email} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{requesterLabel}</p>
            <p className="mt-0.5 truncate text-[9px] text-[#747A8B]">
              {requesterLabel} ↔ {handlerLabel} · WeHouse
            </p>
          </div>
          {Number(selected.unread_count || 0) > 0 && (
            <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] text-violet-300">
              new
            </span>
          )}
        </header>
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
            <span className="shrink-0 rounded-full bg-violet-500/[.08] px-2 py-1 text-[8px] font-semibold text-violet-300">
              TO WEHOUSE
            </span>
          </div>
        </section>
        <CaseManagementPanel
          row={selected}
          events={events}
          activeAction={caseAction}
          note={caseNote}
          busy={updatingCase}
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
        />
        {selectedPresentation.operational && (
          <div className="flex items-center gap-3 border-b border-white/[.06] bg-violet-500/[.045] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold text-violet-100">
                {selectedPresentation.title}
              </p>
              <p className="mt-1 truncate text-[8px] text-[#787F90]">
                {selectedPresentation.meta}
              </p>
            </div>
            {onOpenContext && (
              <button
                type="button"
                onClick={() => onOpenContext(destination.page, destination.id)}
                className="shrink-0 rounded-xl bg-violet-500 px-3 py-2 text-[9px] font-semibold"
              >
                Open record
              </button>
            )}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
          <div className="mx-auto max-w-4xl">
            {loadingThread ? (
              <div className="grid min-h-72 place-items-center">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
              </div>
            ) : messages.length === 0 ? (
              <div className="grid min-h-72 place-items-center text-center text-[11px] text-[#747A8B]">
                No messages yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {messages.map((msg) => (
                  <Bubble
                    key={msg.id}
                    msg={msg}
                    mine={msg.sender_id === profile.user_id}
                    requesterName={requesterLabel}
                  />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </main>
        <footer className="border-t border-white/[.06] bg-[#10141B] p-2.5 sm:p-3">
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
              onClick={() => fileRef.current?.click()}
              disabled={
                selected.status === "resolved" || selected.status === "closed"
              }
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
                disabled={
                  selected.status === "resolved" ||
                  selected.status === "closed"
                }
                placeholder={
                  selected.status === "resolved" || selected.status === "closed"
                    ? "Use the request controls above"
                    : reservationQueue
                      ? "Reply from Bookings"
                      : "Reply as WeHouse"
                }
                className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none"
              />
            </div>
            <button
              onClick={() => void reply()}
              disabled={
                sending ||
                selected.status === "resolved" ||
                selected.status === "closed" ||
                (!input.trim() && !files.length)
              }
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05] disabled:text-[#666C7D]"
            >
              {sending ? "…" : "➤"}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-4xl text-center text-[8px] text-[#505666]">
            From {handlerLabel} · WeHouse · To {requesterLabel}
            {caseNumber ? ` · Case ${caseNumber}` : ""}
          </p>
        </footer>
      </div>
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
      {loadingList ? (
        <div className="grid min-h-40 place-items-center">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        </div>
      ) : shown.length === 0 ? (
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
                    <ReservationContext row={row} />
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
  onSelectAction: (action: CaseAction) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (action: CaseAction) => void;
}) {
  const next = supportNextStep(row.status, row.assigned_staff_name);
  const actions = availableCaseActions(row.status);
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
function ReservationContext({ row }: { row: any }) {
  const presentation = conversationPresentation(row);
  return (
    <>
      <p
        className={`mt-1 truncate text-[11px] ${Number(row.unread_count || 0) > 0 ? "font-medium text-[#E3E5EB]" : "text-[#A0A5B3]"}`}
      >
        {presentation.title}
        {presentation.meta ? ` · ${presentation.meta}` : ""}
      </p>
      <p className="mt-0.5 truncate text-[9px] text-[#596071]">
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
function Bubble({
  msg,
  mine,
  requesterName,
}: {
  msg: any;
  mine: boolean;
  requesterName: string;
}) {
  const meta = msg.action_metadata || {};
  if (msg.action_type === "status_change") {
    return (
      <div className="mx-auto my-3 max-w-md rounded-2xl border border-violet-500/15 bg-violet-500/[.055] px-4 py-3 text-center">
        <p className="text-[9px] font-semibold text-violet-200">
          {caseEventLabel(String(meta.event_type || "request_updated"))}
        </p>
        {msg.content ? (
          <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-[#B1B5C1]">
            {msg.content}
          </p>
        ) : null}
        <p className="mt-1 text-[8px] text-[#606778]">
          {new Date(msg.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    );
  }
  const fromWeHouse = ["staff", "admin", "creator"].includes(
    String(msg.sender_role || ""),
  );
  const sender = fromWeHouse
    ? `${mine ? "You" : msg.sender_name || "WeHouse team"} · WeHouse`
    : msg.sender_name || requesterName;
  const recipient = fromWeHouse ? requesterName : "WeHouse";
  return (
    <div className={`flex ${fromWeHouse ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[88%] flex-col sm:max-w-[72%] ${fromWeHouse ? "items-end" : "items-start"}`}
      >
        {Object.keys(meta).length > 0 && (
          <ContextCard meta={meta} type={msg.action_type} />
        )}
        <p
          className={`mb-1 px-1 text-[8px] font-medium ${fromWeHouse ? "text-right text-violet-200/65" : "text-[#707789]"}`}
        >
          {sender} → {recipient}
        </p>
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
            <p className="whitespace-pre-wrap text-[12px] leading-5">
              {msg.content}
            </p>
          )}
          <p
            className={`mt-1 text-[8px] ${fromWeHouse ? "text-violet-100/65" : "text-[#606677]"}`}
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
function Avatar({ name }: { name?: string }) {
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500/20 to-violet-500/20 text-sm font-bold text-violet-200">
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
