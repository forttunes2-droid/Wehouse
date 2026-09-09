import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import SecureSupportAttachment from "@/components/SecureSupportAttachment";
import { supabase } from "@/lib/supabase";
import {
  completeSupportCase,
  conversationPresentation,
  deleteSupportAttachment,
  ensureSupportConversation,
  getMySupportConversations,
  getSupportCaseEvents,
  getSupportMessages,
  markSupportMessagesRead,
  reopenSupportCase,
  sendSupportMessage,
  supportNextStep,
  supportStatusLabel,
  uploadSupportAttachment,
  supportContextType,
  type SupportCaseEvent,
  type SupportOpenContext,
  type SupportThread,
} from "@/lib/supabase/support";

const messageCache = new Map<string, SupportMessage[]>();

interface ChatProfile {
  user_id: string;
  username: string | null;
  email: string;
  role?: string;
}

interface Props {
  profile: ChatProfile | null;
  onOpenListing?: (listingId: string) => void;
  onOpenBooking?: (bookingId: string) => void;
}
type SupportMessage = {
  id: string;
  sender_id: string;
  sender_name?: string | null;
  sender_role?: string | null;
  content?: string | null;
  attachments?: string[] | null;
  attachment_types?: string[] | null;
  action_type?: string | null;
  action_metadata?: Record<string, unknown> | null;
  is_read?: boolean | null;
  created_at: string;
};
export default function SupportChat({
  profile,
  onOpenListing,
  onOpenBooking,
}: Props) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [events, setEvents] = useState<SupportCaseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pendingContext, setPendingContext] =
    useState<SupportOpenContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [caseAction, setCaseAction] = useState<"complete" | "reopen" | null>(
    null,
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const presentation = conversationPresentation(thread || pendingContext || {});
  const caseNumber = String(thread?.context_snapshot?.case_number || "");
  const handlerLabel = thread?.assigned_staff_name
    ? `${thread.assigned_staff_name} · WeHouse`
    : `${presentation.operator} · awaiting assignment`;
  const visibleMessages = messages.filter(
    (message) => message.sender_role !== "system",
  );

  function addFiles(list: FileList | null) {
    if (!list) return;
    const allowed = Array.from(list).filter((file) => {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 25MB`);
        return false;
      }
      if (
        !file.type.startsWith("image/") &&
        !file.type.startsWith("video/") &&
        file.type !== "application/pdf"
      ) {
        toast.error(`${file.name} is not a supported evidence file`);
        return false;
      }
      return true;
    });
    setFiles((current) => [...current, ...allowed].slice(0, 6));
    if (fileRef.current) fileRef.current.value = "";
  }

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError("");
    const [{ messages: data, error }, { events: history, error: eventError }] =
      await Promise.all([getSupportMessages(id), getSupportCaseEvents(id)]);
    if (error || eventError) {
      setLoadError("We could not load this conversation. Please try again.");
      if (!quiet) toast.error("Unable to load this conversation");
    } else {
      const next = (data || []) as SupportMessage[];
      messageCache.set(id, next);
      setMessages(next);
      setEvents(history);
      await markSupportMessagesRead(id);
    }
    if (!quiet) setLoading(false);
    return !error;
  }, []);

  const refreshThread = useCallback(
    async (
      context?: SupportOpenContext | null,
      preferredId?: string | null,
    ) => {
      const { conversations } = await getMySupportConversations();
      const current = preferredId
        ? conversations?.find((item) => item.conversation_id === preferredId) ||
          null
        : context && hasContext(context)
          ? conversations?.find(
              (item) =>
                supportContextType(item) === supportContextType(context) &&
                item.context_id === context.contextId,
            ) || null
          : conversations?.find((item) => item.context_type === "general") ||
            null;
      setThread(current);
      return current;
    },
    [],
  );

  const openConversation = useCallback(
    async (context?: SupportOpenContext) => {
      if (!profile) return;
      setOpen(true);
      setLoadError("");
      const cached = context?.conversationId
        ? messageCache.get(context.conversationId)
        : undefined;
      setMessages(cached || []);
      setEvents([]);
      setLoading(!cached);

      const preferredId = context?.conversationId || null;
      const current = await refreshThread(context, preferredId);
      setPendingContext(
        current ? null : context && hasContext(context) ? context : null,
      );
      if (current?.conversation_id)
        await loadMessages(current.conversation_id, Boolean(cached));
      else setMessages([]);

      setLoading(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [profile, loadMessages, refreshThread],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SupportOpenContext>).detail || {};
      void openConversation(detail);
    };
    window.addEventListener("openSupportChat", handler as EventListener);
    return () =>
      window.removeEventListener("openSupportChat", handler as EventListener);
  }, [openConversation]);

  useEffect(() => {
    if (!thread?.conversation_id || !open) return;
    const id = thread.conversation_id;
    const channel = supabase
      .channel(`human-support:${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "partner_support_messages",
          filter: `conversation_id=eq.${id}`,
        },
        () => {
          void loadMessages(id, true);
          void refreshThread(null, id);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [thread?.conversation_id, open, loadMessages, refreshThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, open]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", { detail: { open } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, [open]);

  async function send() {
    if (sending || (!input.trim() && !files.length)) return;
    setSending(true);

    let activeThread = thread;
    let conversationId = thread?.conversation_id || null;

    if (!conversationId) {
      const created = await ensureSupportConversation(pendingContext || {});
      if (created.error || !created.conversationId) {
        setSending(false);
        toast.error(
          created.error?.message || "Unable to start this WeHouse conversation",
        );
        return;
      }
      conversationId = created.conversationId;
      activeThread = await refreshThread(pendingContext, conversationId);
    }

    const paths: string[] = [];
    const types: string[] = [];

    for (const file of files) {
      const uploaded = await uploadSupportAttachment(conversationId, file);
      if (uploaded.error || !uploaded.path) {
        for (const path of paths) await deleteSupportAttachment(path);
        setSending(false);
        toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
        return;
      }
      paths.push(uploaded.path);
      types.push(file.type || "application/octet-stream");
    }

    const { error } = await sendSupportMessage(
      conversationId,
      input.trim(),
      paths,
      types,
      pendingContext,
    );
    if (error) {
      for (const path of paths) await deleteSupportAttachment(path);
      setSending(false);
      toast.error(error.message || "Message failed");
      return;
    }

    setInput("");
    setFiles([]);
    setPendingContext(null);
    setSending(false);
    await loadMessages(conversationId, true);
    if (!activeThread) await refreshThread(pendingContext, conversationId);
    else void refreshThread(null, conversationId);
  }

  async function respondToResolution(action: "complete" | "reopen") {
    if (!thread?.conversation_id || caseAction) return;
    setCaseAction(action);
    const result =
      action === "complete"
        ? await completeSupportCase(thread.conversation_id)
        : await reopenSupportCase(thread.conversation_id);
    if (result.error) {
      toast.error(
        result.error.message ||
          (action === "complete"
            ? "Could not close this request"
            : "Could not reopen this request"),
      );
      setCaseAction(null);
      return;
    }
    toast.success(
      action === "complete"
        ? "Request closed"
        : "WeHouse has been told you still need help",
    );
    await Promise.all([
      loadMessages(thread.conversation_id, true),
      refreshThread(null, thread.conversation_id),
    ]);
    setCaseAction(null);
  }

  if (!profile) return null;
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100030] isolate flex h-[100dvh] flex-col overflow-hidden bg-[#090C11] text-white">
      <header className="shrink-0 border-b border-white/[.06] bg-[#10141B]/95 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            onClick={() => {
              setOpen(false);
              setFiles([]);
              setEvents([]);
              setPendingContext(null);
            }}
            aria-label="Close WeHouse conversation"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9DA3B2] hover:bg-white/[.05]"
          >
            ←
          </button>
          <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 font-bold">
            W
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#10141B] bg-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[14px] font-semibold">
                {presentation.operator}
              </p>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-violet-400 text-[9px] font-bold">
                ✓
              </span>
            </div>
            <p className="mt-0.5 truncate text-[9px] text-[#747A8B]">
              You ↔ {handlerLabel}
            </p>
          </div>
        </div>
      </header>

      <section className="shrink-0 border-b border-white/[.06] bg-[#0D1118] px-4 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold text-[#D9DCE4]">
              {presentation.title}
            </p>
            <p className="mt-0.5 truncate text-[8px] text-[#687081]">
              {[
                caseNumber ? `Case ${caseNumber}` : "Case opens when sent",
                thread ? supportStatusLabel(thread.status) : "Not sent",
                presentation.meta,
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

      <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.05),transparent_34%)] px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-4xl">
          {thread && (
            <RequesterCaseSummary
              thread={thread}
              events={events}
              acting={caseAction}
              onComplete={() => void respondToResolution("complete")}
              onReopen={() => void respondToResolution("reopen")}
            />
          )}
          {presentation.operational && thread && (
            <LinkedOperationalContext
              thread={thread}
              onOpenBooking={
                onOpenBooking
                  ? (id) => {
                      setOpen(false);
                      onOpenBooking(id);
                    }
                  : undefined
              }
              onOpenListing={
                onOpenListing
                  ? (id) => {
                      setOpen(false);
                      onOpenListing(id);
                    }
                  : undefined
              }
            />
          )}
          {loading ? (
            <ConversationSkeleton />
          ) : loadError ? (
            <ConversationLoadError
              text={loadError}
              retry={() =>
                thread?.conversation_id &&
                void loadMessages(thread.conversation_id)
              }
            />
          ) : visibleMessages.length === 0 ? (
            <Welcome presentation={presentation} />
          ) : (
            <div className="space-y-2.5">
              {visibleMessages.map((msg, index) => (
                <div key={msg.id}>
                  {(!visibleMessages[index - 1] ||
                    new Date(
                      visibleMessages[index - 1].created_at,
                    ).toDateString() !==
                      new Date(msg.created_at).toDateString()) && (
                    <DaySeparator value={msg.created_at} />
                  )}
                  <MessageBubble
                    msg={msg}
                    mine={msg.sender_id === profile.user_id}
                    teamLabel={presentation.operator}
                    handlerName={thread?.assigned_staff_name}
                    showContext={!presentation.operational}
                    onOpenListing={(listingId) => {
                      setOpen(false);
                      onOpenListing?.(listingId);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="shrink-0 border-t border-white/[.06] bg-[#10141B]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
        <div className="mx-auto max-w-4xl">
          {pendingContext && hasContext(pendingContext) && (
            <PendingContext
              context={pendingContext}
              onRemove={() => setPendingContext(null)}
            />
          )}

          {files.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
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
                    className="text-[#8D91A1]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept="image/*,video/*,application/pdf"
              onChange={(event) => addFiles(event.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={
                thread?.status === "resolved" || thread?.status === "closed"
              }
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.06] bg-white/[.035] text-[#9AA0B1] hover:bg-white/[.05]"
              aria-label="Attach evidence"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.7 9.7a2 2 0 0 1-2.8-2.8l8.9-8.9" />
              </svg>
            </button>
            <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.07] bg-[#1A1F28] px-3 py-1.5 focus-within:border-violet-500/35">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                disabled={
                  thread?.status === "resolved" || thread?.status === "closed"
                }
                placeholder={
                  thread?.status === "resolved" || thread?.status === "closed"
                    ? "Use the request outcome buttons above"
                    : thread?.status === "waiting_for_user"
                      ? "Reply with the information WeHouse requested"
                      : `Message ${presentation.operator}`
                }
                className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-5 outline-none placeholder:text-[#62697A]"
              />
            </div>
            <button
              onClick={() => void send()}
              disabled={
                sending ||
                thread?.status === "resolved" ||
                thread?.status === "closed" ||
                (!input.trim() && !files.length)
              }
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-white disabled:bg-white/[.05] disabled:text-[#666C7D]"
              aria-label="Send"
            >
              {sending ? "…" : "➤"}
            </button>
          </div>
          <p className="mt-2 px-2 text-center text-[8px] text-[#505666]">
            From You · To {presentation.operator}
            {caseNumber ? ` · Case ${caseNumber}` : ""}
          </p>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

function RequesterCaseSummary({
  thread,
  events,
  acting,
  onComplete,
  onReopen,
}: {
  thread: SupportThread;
  events: SupportCaseEvent[];
  acting: "complete" | "reopen" | null;
  onComplete: () => void;
  onReopen: () => void;
}) {
  const next = supportNextStep(thread.status, thread.assigned_staff_name);
  const caseNumber = String(thread.context_snapshot?.case_number || "");
  const importantEvent = [...events]
    .reverse()
    .find((event) =>
      [
        "information_requested",
        "escalated",
        "resolved",
        "reopened",
      ].includes(event.event_type),
    );
  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-white/[.07] bg-[#121720]">
      <div className="flex items-start justify-between gap-3 border-b border-white/[.06] p-4">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#71798B]">
            What you asked
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[#F2F3F6]">
            {thread.subject || "Help from WeHouse"}
          </h2>
          <p className="mt-1 text-[9px] text-[#6F7687]">
            {caseNumber ? `Request ${caseNumber}` : "WeHouse request"}
          </p>
        </div>
        <StatusPill status={thread.status} />
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-wide text-[#646C7D]">
            Handled by
          </p>
          <p className="mt-1 text-[11px] font-medium text-[#D9DCE4]">
            {thread.assigned_staff_name || "Awaiting WeHouse assignment"}
          </p>
        </div>
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-wide text-[#646C7D]">
            Who acts next
          </p>
          <p className="mt-1 text-[11px] font-medium text-violet-200">
            {next.actor}
          </p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-[8px] font-semibold uppercase tracking-wide text-[#646C7D]">
            What happens now
          </p>
          <p className="mt-1 text-[10px] leading-4 text-[#A5AAB7]">
            {next.text}
          </p>
          {importantEvent?.note &&
          ["waiting_for_user", "escalated", "resolved"].includes(
            thread.status,
          ) ? (
            <p className="mt-2 rounded-xl bg-white/[.035] px-3 py-2 text-[10px] leading-4 text-[#D7DAE1]">
              {importantEvent.note}
            </p>
          ) : null}
        </div>
      </div>
      {thread.status === "resolved" ? (
        <div className="grid grid-cols-2 gap-2 border-t border-white/[.06] p-3">
          <button
            type="button"
            disabled={Boolean(acting)}
            onClick={onComplete}
            className="min-h-10 rounded-xl bg-emerald-500/12 px-3 text-[10px] font-semibold text-emerald-300 disabled:opacity-50"
          >
            {acting === "complete" ? "Closing…" : "This solved it"}
          </button>
          <button
            type="button"
            disabled={Boolean(acting)}
            onClick={onReopen}
            className="min-h-10 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-50"
          >
            {acting === "reopen" ? "Reopening…" : "I still need help"}
          </button>
        </div>
      ) : thread.status === "closed" ? (
        <div className="border-t border-white/[.06] p-3">
          <button
            type="button"
            disabled={Boolean(acting)}
            onClick={onReopen}
            className="min-h-10 w-full rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-50"
          >
            {acting === "reopen" ? "Reopening…" : "I still need help"}
          </button>
        </div>
      ) : null}
      <CaseHistory events={events} createdAt={thread.created_at} />
    </section>
  );
}

function CaseHistory({
  events,
  createdAt,
}: {
  events: SupportCaseEvent[];
  createdAt: string;
}) {
  return (
    <details className="border-t border-white/[.06] px-4 py-3">
      <summary className="cursor-pointer text-[9px] font-semibold text-violet-300">
        Request history · {events.length + 1} update
        {events.length === 0 ? "" : "s"}
      </summary>
      <div className="mt-3 space-y-3 border-l border-white/[.08] pl-3">
        <HistoryItem
          label="Request sent to WeHouse"
          time={createdAt}
          note={null}
        />
        {events.map((event) => (
          <HistoryItem
            key={event.id}
            label={caseEventLabel(event.event_type)}
            time={event.created_at}
            note={event.note}
          />
        ))}
      </div>
    </details>
  );
}

function HistoryItem({
  label,
  time,
  note,
}: {
  label: string;
  time: string;
  note: string | null;
}) {
  return (
    <div>
      <p className="text-[9px] font-medium text-[#D4D7DE]">{label}</p>
      <p className="mt-0.5 text-[8px] text-[#62697A]">
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

function StatusPill({ status }: { status: string }) {
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
      className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] font-semibold ${tone}`}
    >
      {supportStatusLabel(status)}
    </span>
  );
}

function caseEventLabel(value: string) {
  const labels: Record<string, string> = {
    assigned: "Assigned to a WeHouse team member",
    work_started: "WeHouse started work",
    information_requested: "WeHouse requested information",
    requester_replied: "You supplied more information",
    escalated: "Escalated for additional review",
    resolved: "WeHouse provided an outcome",
    resolution_accepted: "You confirmed the outcome",
    closed: "Request closed",
    reopened: "Request reopened",
  };
  return labels[value] || value.replace(/_/g, " ");
}

function MessageBubble({
  msg,
  mine,
  teamLabel,
  handlerName,
  showContext,
  onOpenListing,
}: {
  msg: SupportMessage;
  mine: boolean;
  teamLabel: string;
  handlerName?: string | null;
  showContext: boolean;
  onOpenListing?: (listingId: string) => void;
}) {
  const meta = msg.action_metadata || {};
  if (msg.action_type === "status_change") {
    return (
      <div className="mx-auto my-3 max-w-md rounded-2xl border border-violet-500/15 bg-violet-500/[.055] px-4 py-3 text-center">
        <p className="text-[9px] font-semibold text-violet-200">
          {caseEventLabel(String(meta.event_type || "request_updated"))}
        </p>
        {msg.content ? (
          <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-[#AEB3C0]">
            {msg.content}
          </p>
        ) : null}
        <p className="mt-1 text-[8px] text-[#606778]">
          {formatTime(msg.created_at)}
        </p>
      </div>
    );
  }
  const senderIsWeHouse = ["staff", "admin", "creator"].includes(
    String(msg.sender_role || ""),
  );
  const sender = mine
    ? "You"
    : msg.sender_name
      ? `${msg.sender_name}${senderIsWeHouse ? " · WeHouse" : ""}`
      : handlerName
        ? `${handlerName} · WeHouse`
        : teamLabel;
  const recipient = mine ? teamLabel : "You";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[88%] flex-col sm:max-w-[72%] ${mine ? "items-end" : "items-start"}`}
      >
        {showContext && meta && Object.keys(meta).length > 0 && (
          <MessageContext
            meta={meta}
            type={msg.action_type}
            onOpenListing={onOpenListing}
          />
        )}
        <p
          className={`mb-1 px-1 text-[8px] font-medium ${mine ? "text-right text-violet-200/65" : "text-[#707789]"}`}
        >
          {sender} → {recipient}
        </p>
        <div
          className={`rounded-[19px] px-3.5 py-2.5 ${mine ? "rounded-br-md bg-violet-500 text-white" : "rounded-bl-md border border-white/[.06] bg-[#171B24] text-[#E4E6EC]"}`}
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
            className={`mt-1 text-[8px] ${mine ? "text-violet-100/65" : "text-[#606677]"}`}
          >
            {formatTime(msg.created_at)}
            {mine && (
              <span
                className={
                  msg.is_read
                    ? "ml-1 font-bold text-cyan-200"
                    : "ml-1 text-violet-100/45"
                }
              >
                {msg.is_read ? "✓✓" : "✓"}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function LinkedOperationalContext({
  thread,
  onOpenBooking,
  onOpenListing,
}: {
  thread: SupportThread;
  onOpenBooking?: (id: string) => void;
  onOpenListing?: (id: string) => void;
}) {
  const snapshot = thread.context_snapshot || {};
  const presentation = conversationPresentation(thread);
  const contextType = supportContextType(thread);
  const reservationContext = [
    "apartment_reservation",
    "apartment_payment",
    "reservation",
    "hotel_booking",
  ].includes(contextType);
  const serviceContext = contextType === "worker_booking";
  const listingContext = contextType === "property_listing";
  const propertyRequestContext = contextType === "property_inspection";
  const bookingId =
    reservationContext || serviceContext
      ? String(
          thread.context_id ||
            snapshot.reservation_id ||
            snapshot.source_id ||
            "",
        )
      : "";
  const listingId = String(
    listingContext ? thread.context_id || "" : snapshot.listing_id || "",
  );
  const rawStatus = String(snapshot.status || "").replace(/_/g, " ");
  const status =
    rawStatus === "occupied"
      ? "Tenancy active"
      : rawStatus === "checked in"
        ? "Checked in"
        : rawStatus === "checked out"
          ? "Checked out"
          : rawStatus;
  const code = String(snapshot.booking_code || snapshot.reference || "");
  const title = String(
    snapshot.listing_title ||
      snapshot.hotel_name ||
      presentation.title ||
      "Reservation",
  ).replace(/\s*·\s*Reservation Desk$/i, "");
  const stayType = String(snapshot.stay_type || "");
  const actionLabel = serviceContext
    ? "Open service job"
    : contextType === "hotel_booking"
      ? "Open stay"
      : stayType === "long_stay" ||
          stayType === "long_let" ||
          String(snapshot.status || "") === "occupied"
        ? "Open tenancy"
        : "Open reservation";
  const location = String(
    snapshot.listing_location || snapshot.room_name || "",
  );
  const checkIn = String(snapshot.check_in || "");
  const checkOut = String(snapshot.check_out || "");
  return (
    <section className="mb-4 border-y border-white/[.06] bg-white/[.018] py-3">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300">
          ⌂
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold">{title}</p>
          {location && (
            <p className="mt-1 truncate text-[9px] text-[#747B8C]">
              {location}
            </p>
          )}
          <p className="mt-1 truncate text-[9px] capitalize text-[#747B8C]">
            {[status, code].filter(Boolean).join(" · ")}
          </p>
        </div>
        {bookingId && onOpenBooking ? (
          <button
            type="button"
            onClick={() => onOpenBooking(bookingId)}
            className="shrink-0 text-[9px] font-semibold text-violet-300"
          >
            {actionLabel}
          </button>
        ) : listingId && onOpenListing ? (
          <button
            type="button"
            onClick={() => onOpenListing(listingId)}
            className="shrink-0 text-[9px] font-semibold text-violet-300"
          >
            View apartment
          </button>
        ) : propertyRequestContext ? (
          <span className="shrink-0 text-[8px] font-semibold text-violet-300">
            Property request
          </span>
        ) : null}
      </div>
      {(checkIn || checkOut) && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[.05] pt-3 text-[9px] text-[#747B8C]">
          {checkIn && (
            <p>
              <span className="text-[#555C6D]">Check-in</span>
              <br />
              {new Date(checkIn).toLocaleDateString()}
            </p>
          )}
          {checkOut && (
            <p>
              <span className="text-[#555C6D]">Check-out</span>
              <br />
              {new Date(checkOut).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function MessageContext({
  meta,
  type,
  onOpenListing,
}: {
  meta: Record<string, unknown>;
  type?: string | null;
  onOpenListing?: (listingId: string) => void;
}) {
  const snap =
    meta.context_snapshot && typeof meta.context_snapshot === "object"
      ? (meta.context_snapshot as Record<string, unknown>)
      : {};
  const listingId = String(snap.listing_id || meta.listing_id || "");
  const label = String(
    meta.subject || type || meta.context_type || "Linked WeHouse item",
  ).replace(/_/g, " ");
  return (
    <div className="mb-1.5 w-full max-w-sm rounded-2xl border border-violet-500/15 bg-violet-500/[.055] p-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[10px] font-semibold capitalize text-violet-200">
          {label}
        </p>
        {listingId && onOpenListing ? (
          <button
            type="button"
            onClick={() => onOpenListing(listingId)}
            className="shrink-0 rounded-full bg-violet-500/12 px-2.5 py-1.5 text-[8px] font-semibold text-violet-200"
          >
            View apartment →
          </button>
        ) : null}
      </div>
      {Object.keys(snap).length > 0 && (
        <div className="mt-2 grid gap-1 text-[9px] text-[#8FA0B9] sm:grid-cols-2">
          {Object.entries(snap)
            .filter(
              ([key]) =>
                !["id", "listing_id", "user_id", "auth_id"].includes(key),
            )
            .slice(0, 6)
            .map(([key, value]) => (
              <p key={key} className="truncate">
                <span className="capitalize text-[#66758C]">
                  {key.replace(/_/g, " ")}:
                </span>{" "}
                {String(value ?? "")}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function PendingContext({
  context,
  onRemove,
}: {
  context: SupportOpenContext;
  onRemove: () => void;
}) {
  return (
    <div className="mb-2 flex items-start gap-3 rounded-2xl border border-violet-500/15 bg-violet-500/[.055] p-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300">
        ↗
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold text-violet-200">
          {context.subject ||
            String(context.contextType || "Linked WeHouse item").replace(
              /_/g,
              " ",
            )}
        </p>
        <p className="mt-1 truncate text-[9px] text-[#6F7F97]">
          This conversation will stay linked to the selected WeHouse item.
        </p>
      </div>
      <button onClick={onRemove} className="text-[#758096]">
        ×
      </button>
    </div>
  );
}

function Welcome({
  presentation,
}: {
  presentation: ReturnType<typeof conversationPresentation>;
}) {
  return (
    <div className="grid min-h-[55vh] place-items-center px-5 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-violet-500/10 text-xl font-bold text-violet-300">
          W
        </div>
        <h2 className="mt-4 text-base font-semibold">Message WeHouse</h2>
        <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#747A8B]">
          {presentation.operational
            ? "This conversation stays attached to the record shown above, so its history and next actions remain in one place."
            : "Send a message when you need the WeHouse team. Opening this screen alone does not create a conversation."}
        </p>
      </div>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="min-h-24" role="status" aria-label="Loading conversation" />
  );
}
function ConversationLoadError({
  text,
  retry,
}: {
  text: string;
  retry: () => void;
}) {
  return (
    <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-red-500/15 bg-red-500/[.04] p-5 text-center">
      <p className="text-xs font-semibold">Conversation could not be loaded</p>
      <p className="mt-2 text-[9px] leading-4 text-[#858A98]">{text}</p>
      <button
        type="button"
        onClick={retry}
        className="mt-4 text-[10px] font-semibold text-violet-300"
      >
        Try again
      </button>
    </div>
  );
}

function hasContext(value: SupportOpenContext) {
  return Boolean(
    value.contextId ||
    (value.contextType && value.contextType !== "general") ||
    (value.contextSnapshot && Object.keys(value.contextSnapshot).length),
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DaySeparator({ value }: { value: string }) {
  const date = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const label =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString([], {
            day: "numeric",
            month: "short",
            year:
              date.getFullYear() === today.getFullYear()
                ? undefined
                : "numeric",
          });
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="h-px flex-1 bg-white/[.05]" />
      <span className="text-[8px] font-semibold text-[#697080]">{label}</span>
      <span className="h-px flex-1 bg-white/[.05]" />
    </div>
  );
}
