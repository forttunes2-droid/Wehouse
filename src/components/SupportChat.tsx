import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import { displayDate } from "@/lib/displayDate";
import SecureSupportAttachment from "@/components/SecureSupportAttachment";
import { supabase } from "@/lib/supabase";
import {
  completeSupportCase,
  conversationPresentation,
  createSupportMessageDraft,
  deleteSupportAttachment,
  discardSupportMessageDraft,
  getMySupportConversations,
  getSupportCaseEvents,
  getSupportMessageDraftStatus,
  getSupportMessages,
  isSupportedSupportEvidence,
  markSupportMessagesRead,
  reopenSupportCase,
  sendFirstContextualHelpMessage,
  sendFirstWeHouseMessage,
  supportContextForWorkspace,
  sendSupportMessage,
  supportNextStep,
  supportStatusLabel,
  uploadSupportAttachment,
  uploadSupportDraftAttachment,
  supportContextType,
  sanitizeSupportSnapshot,
  findSupportThread,
  supportDraftKey,
  type SupportCaseEvent,
  type SupportOpenContext,
  type SupportThread,
} from "@/lib/supabase/support";


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
  visibility?: "customer" | "internal" | null;
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
  const firstSendAttemptRef = useRef<{
    draftId: string;
    content: string;
    context: SupportOpenContext;
    paths: string[];
    types: string[];
  } | null>(null);
  const messageCache = useRef(new Map<string, SupportMessage[]>()).current;
  const requestRef = useRef(0);
  const activeThreadRef = useRef<string | null>(null);
  const activeContextRef = useRef<SupportOpenContext>({});
  const composerKey = useRef("");
  const composer = useRef({ input, files });
  composer.current = { input, files };
  const sendingRef = useRef(false);
  const drafts = useRef(new Map<string, {
    input: string; files: File[]; attempt: typeof firstSendAttemptRef.current;
  }>());
  const saveDraft = useCallback(() => {
    if (composerKey.current) drafts.current.set(composerKey.current, {
      ...composer.current, attempt: firstSendAttemptRef.current,
    });
  }, []);
  const closeConversation = useCallback(() => {
    if (sendingRef.current) { toast("Sending your message…"); return; }
    saveDraft();
    requestRef.current += 1;
    activeThreadRef.current = null;
    setOpen(false);
    setThread(null);
    setPendingContext(null);
    setMessages([]);
    setEvents([]);
  }, [saveDraft]);
  useEffect(() => () => { requestRef.current += 1; }, []);
  const presentation = conversationPresentation(thread || pendingContext || {});
  const caseLocked = Boolean(
    !presentation.operational &&
      (thread?.status === "resolved" || thread?.status === "closed"),
  );
  const caseNumber = String(thread?.context_snapshot?.case_number || "");
  const handlerLabel = thread?.assigned_staff_name
    ? `${thread.assigned_staff_name} · WeHouse`
    : "Support team";
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
      if (!isSupportedSupportEvidence(file)) {
        toast.error(`${file.name} is not a supported evidence file`);
        return false;
      }
      return true;
    });
    setFiles((current) => [...current, ...allowed].slice(0, 6));
    if (fileRef.current) fileRef.current.value = "";
  }

  const loadMessages = useCallback(async (id: string, quiet = false, request = requestRef.current) => {
    if (request !== requestRef.current || activeThreadRef.current !== id) return false;
    if (!quiet) setLoading(true);
    setLoadError("");
    const [{ messages: data, error }, { events: history, error: eventError }] =
      await Promise.all([getSupportMessages(id), getSupportCaseEvents(id)]);
    if (request !== requestRef.current || activeThreadRef.current !== id) return false;
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
    if (!quiet && request === requestRef.current) setLoading(false);
    return !error;
  }, []);

  const refreshThread = useCallback(
    async (
      context?: SupportOpenContext | null,
      preferredId?: string | null,
      request = requestRef.current,
    ) => {
      const { conversations, error } = await getMySupportConversations(profile?.role || "personal");
      if (request !== requestRef.current) return null;
      if (error) {
        setLoadError("We could not load this conversation. Please try again.");
        return null;
      }
      const current = findSupportThread(conversations || [], preferredId ? { conversationId: preferredId } : context || {});
      if (preferredId && !current) setLoadError("This conversation is unavailable in this workspace.");
      activeThreadRef.current = current?.conversation_id || null;
      setThread(current);
      return current;
    },
    [profile?.role],
  );

  const openConversation = useCallback(
    async (context?: SupportOpenContext) => {
      if (!profile || sendingRef.current) return;
      saveDraft();
      const request = ++requestRef.current;
      const requested = supportContextForWorkspace(context || {}, profile.role || "personal");
      activeContextRef.current = requested;
      composerKey.current = `${profile.user_id}:${profile.role || "personal"}:${supportDraftKey(requested)}`;
      const draft = drafts.current.get(composerKey.current);
      firstSendAttemptRef.current = draft?.attempt || null;
      setInput(draft?.input || "");
      setFiles(draft?.files || []);
      setOpen(true);
      setThread(null);
      activeThreadRef.current = null;
      setPendingContext(hasContext(requested) ? requested : null);
      setLoadError("");
      setMessages([]);
      setEvents([]);
      setCaseAction(null);
      setLoading(true);

      try {
        const current = await refreshThread(requested, requested.conversationId, request);
        if (request !== requestRef.current) return;
        if (current?.conversation_id) {
          setPendingContext(null);
          const cached = messageCache.get(current.conversation_id);
          setMessages(cached || []);
          await loadMessages(current.conversation_id, Boolean(cached), request);
        }
        if (request === requestRef.current) setLoading(false);
      } catch {
        if (request === requestRef.current) {
          setLoadError("We could not load this conversation. Please try again.");
          setLoading(false);
        }
      }
    },
    [profile, loadMessages, refreshThread, saveDraft, messageCache],
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
    const request = requestRef.current;
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
          void loadMessages(id, true, request);
          void refreshThread(null, id, request);
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
    if (sendingRef.current || loading || loadError || caseLocked || (!input.trim() && !files.length && !firstSendAttemptRef.current)) return;
    if (!profile) return;
    sendingRef.current = true;
    setSending(true);
    const request = requestRef.current;
    try {

      const existingConversationId = thread?.conversation_id || null;
      if (existingConversationId) {
        const paths: string[] = [];
        const types: string[] = [];
        for (const file of files) {
          const uploaded = await uploadSupportAttachment(existingConversationId, file);
          if (uploaded.error || !uploaded.path) {
            for (const path of paths) await deleteSupportAttachment(path);
            toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
            return;
          }
          paths.push(uploaded.path);
          types.push(file.type || "application/octet-stream");
        }
        const { error } = await sendSupportMessage(
          existingConversationId,
          input.trim(),
          paths,
          types,
          null,
        );
        if (error) {
          for (const path of paths) await deleteSupportAttachment(path);
          toast.error(error.message || "Message failed");
          return;
        }
        setInput("");
        setFiles([]);
        await loadMessages(existingConversationId, true, request);
        await refreshThread(null, existingConversationId, request);
        return;
      }

      let attempt = firstSendAttemptRef.current;
      if (!attempt) {
        const context = supportContextForWorkspace(pendingContext || {}, profile.role || "personal");
        const draft = await createSupportMessageDraft();
        if (draft.error || !draft.draftId) {
          toast.error(draft.error?.message || "Unable to prepare this WeHouse message");
          return;
        }
        const paths: string[] = [];
        const types: string[] = [];
        for (const file of files) {
          const uploaded = await uploadSupportDraftAttachment(
            draft.draftId,
            profile.user_id,
            file,
          );
          if (uploaded.error || !uploaded.path) {
            for (const path of paths) await deleteSupportAttachment(path);
            await discardSupportMessageDraft(draft.draftId);
            toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
            return;
          }
          paths.push(uploaded.path);
          types.push(file.type || "application/octet-stream");
        }
        attempt = {
          draftId: draft.draftId,
          content: input.trim(),
          context,
          paths,
          types,
        };
        firstSendAttemptRef.current = attempt;
      }

      const sent =
        attempt.context.contextType === "contextual_help" &&
        String(attempt.context.contextSnapshot?.reason_code || "").trim()
          ? await sendFirstContextualHelpMessage(
              attempt.draftId,
              attempt.context,
              attempt.content,
              attempt.paths,
              attempt.types,
            )
          : await sendFirstWeHouseMessage(
              attempt.draftId,
              attempt.context,
              attempt.content,
              attempt.paths,
              attempt.types,
            );
      let conversationId = sent.conversationId;
      if (sent.error || !conversationId) {
        const checked = await getSupportMessageDraftStatus(attempt.draftId);
        if (checked.status?.state === "sent" && checked.status.conversation_id) {
          conversationId = checked.status.conversation_id;
        } else if (checked.error) {
          toast.error(
            "We could not confirm whether that message was sent. Tap Send again to reconcile the same request before creating another one.",
          );
          return;
        } else {
          for (const path of attempt.paths) await deleteSupportAttachment(path);
          if (checked.status?.state !== "expired")
            await discardSupportMessageDraft(attempt.draftId);
          firstSendAttemptRef.current = null;
          toast.error(sent.error?.message || "Message failed");
          return;
        }
      }

      firstSendAttemptRef.current = null;
      setInput("");
      setFiles([]);
      setPendingContext(null);
      await refreshThread(attempt.context, conversationId, request);
      await loadMessages(conversationId, true, request);
    } catch {
      toast.error("We could not confirm the send. Try again in this conversation.");
    } finally {
      sendingRef.current = false;
      if (request === requestRef.current) setSending(false);
    }
  }

  async function respondToResolution(action: "complete" | "reopen") {
    if (!thread?.conversation_id || caseAction) return;
    const request = requestRef.current;
    setCaseAction(action);
    const result =
      action === "complete"
        ? await completeSupportCase(thread.conversation_id)
        : await reopenSupportCase(thread.conversation_id);
    if (request !== requestRef.current) return;
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
      loadMessages(thread.conversation_id, true, request),
      refreshThread(null, thread.conversation_id, request),
    ]);
    if (request === requestRef.current) setCaseAction(null);
  }

  if (!profile) return null;
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100030] isolate flex h-[100dvh] flex-col overflow-hidden bg-[#090C11] text-white">
      <header className="shrink-0 border-b border-white/[.06] bg-[#10141B]/95 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <BackButton onClick={closeConversation} ariaLabel="Back" />
          <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-200 font-bold">
            W

          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-[14px] font-semibold">
                {presentation.title}
              </h1>

            </div>
            <p className="mt-0.5 truncate text-[9px] text-[#747A8B]">
              {presentation.operational
                ? [presentation.operator, presentation.meta].filter(Boolean).join(" · ")
                : `${presentation.operator} · ${handlerLabel}`}
            </p>
          </div>
        </div>
      </header>

      {!presentation.operational && (
      <section className="shrink-0 border-b border-white/[.06] bg-[#0D1118] px-4 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold text-[#D9DCE4]">
              {presentation.title}
            </p>
            <p className="mt-0.5 truncate text-[8px] text-[#687081]">
              {[
                caseNumber ? `Case ${caseNumber}` : "",
                thread ? supportStatusLabel(thread.status) : "New conversation",
                presentation.meta,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-violet-500/[.08] px-2 py-1 text-[8px] font-semibold text-violet-300">HELP</span>
        </div>
      </section>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.05),transparent_34%)] px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-4xl">
          {thread && !presentation.operational && (
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
                      if (sendingRef.current) return;
                      closeConversation();
                      onOpenBooking(id);
                    }
                  : undefined
              }
              onOpenListing={
                onOpenListing
                  ? (id) => {
                      if (sendingRef.current) return;
                      closeConversation();
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
              retry={() => void openConversation(activeContextRef.current)}
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
                      if (sendingRef.current) return;
                      closeConversation();
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
          {!loading && pendingContext && hasContext(pendingContext) && (
            <PendingContext
              context={pendingContext}
              onStartGeneralHelp={
                firstSendAttemptRef.current ? undefined : () => void openConversation({})
              }
            />
          )}

          {firstSendAttemptRef.current && !sending && <p role="status" className="mb-2 px-2 text-xs text-amber-200">Message not confirmed. Tap Send to retry.</p>}
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
                    disabled={sending || Boolean(firstSendAttemptRef.current)}
                    aria-label={`Remove ${file.name}`}
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
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,.doc,.docx"
              onChange={(event) => addFiles(event.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={caseLocked || loading || Boolean(loadError) || sending || Boolean(firstSendAttemptRef.current)}
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
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                disabled={caseLocked || loading || Boolean(loadError) || sending || Boolean(firstSendAttemptRef.current)}
                aria-label="Message"
                data-chat-composer
                placeholder={
                  caseLocked
                    ? "Use the request outcome buttons above"
                    : thread?.status === "waiting_for_user"
                      ? "Reply with the information WeHouse requested"
                      : "Message WeHouse"
                }
                className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-5 outline-none placeholder:text-[#62697A]"
              />
            </div>
            <button
              onClick={() => void send()}
              disabled={
                sending || loading || Boolean(loadError) ||
                caseLocked ||
                (!input.trim() && !files.length)
              }
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-white disabled:bg-white/[.05] disabled:text-[#666C7D]"
              aria-label="Send"
            >
              {sending ? "…" : "➤"}
            </button>
          </div>
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
          {sender}
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
  const snapshot = sanitizeSupportSnapshot(thread.context_snapshot);
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
  const code = String(snapshot.reference || "");
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
              {displayDate(checkIn)}
            </p>
          )}
          {checkOut && (
            <p>
              <span className="text-[#555C6D]">Check-out</span>
              <br />
              {displayDate(checkOut)}
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
  const snap = sanitizeSupportSnapshot(
    meta.context_snapshot && typeof meta.context_snapshot === "object"
      ? (meta.context_snapshot as Record<string, unknown>)
      : {});
  const listingId = String(snap.listing_id || meta.listing_id || "");
  const label = String(snap.listing_title || snap.hotel_name || snap.service_type || meta.subject || type || "Related item").replace(/_/g, " ");
  const facts = [
    ["Room", snap.room_name],
    ["Issue", snap.reason_label],
    ["Check-in", snap.check_in ? displayDate(String(snap.check_in)) : null],
    ["Check-out", snap.check_out ? displayDate(String(snap.check_out)) : null],
  ].filter(([, value]) => Boolean(value));
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
            className="shrink-0 rounded-full bg-violet-500/12 px-2.5 py-1.5 text-[8px] font-semibold text-violet-300"
          >
            View apartment →
          </button>
        ) : null}
      </div>
      {facts.length > 0 && (
        <div className="mt-2 grid gap-1 text-xs text-[#A5A0B3] sm:grid-cols-2">
          {facts.map(([key, value]) => <p key={String(key)}>{String(key)}: {String(value)}</p>)}
        </div>
      )}
    </div>
  );
}

function PendingContext({ context, onStartGeneralHelp }: {
  context: SupportOpenContext;
  onStartGeneralHelp?: () => void;
}) {
  const view = conversationPresentation(context);
  const snapshot = sanitizeSupportSnapshot(context.contextSnapshot);
  const type = supportContextType(context);
  const label = type === "hotel_property" ? "Hotel enquiry"
    : type === "hotel_booking" ? "Hotel booking"
    : type === "worker_booking" ? "Service booking"
    : type === "property_listing" ? "Apartment enquiry"
    : view.meta || "Related to";
  const details = [snapshot.room_name, snapshot.service_type,
    snapshot.check_in ? displayDate(String(snapshot.check_in)) : null,
    snapshot.check_out ? displayDate(String(snapshot.check_out)) : null,
  ].filter(Boolean).join(" · ");
  return (
    <section aria-label="Conversation topic" className="mb-2 flex items-center gap-3 border-l-2 border-violet-400 bg-white/[.035] py-2 pl-3 pr-1">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-[#A5A0B3]">{label}</p>
        <p className="truncate text-[13px] font-semibold text-violet-100">{view.title}</p>
        {details && <p className="truncate text-xs text-[#A5A0B3]">{details}</p>}
      </div>
      {onStartGeneralHelp && (
        <button
          type="button"
          onClick={onStartGeneralHelp}
          aria-label="Change topic to General Help"
          className="shrink-0 rounded-full px-2 py-2 text-[9px] font-semibold text-violet-300"
        >
          Change topic
        </button>
      )}
    </section>
  );
}

function Welcome({
  presentation,
}: {
  presentation: ReturnType<typeof conversationPresentation>;
}) {
  return (
    <div className="grid min-h-48 place-items-center px-5 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-xl font-bold text-violet-300">
          W
        </div>
        <h2 className="mt-4 text-base font-semibold">Message WeHouse</h2>
        <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#747A8B]">
          {presentation.operational
            ? `Ask the WeHouse team about ${presentation.title}.`
            : "How can we help?"}
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
    (value.contextId && !value.contextId.startsWith("workspace:")) ||
    (value.contextType && value.contextType !== "general") ||
    (value.contextSnapshot && Object.keys(value.contextSnapshot).some(key => key !== "requester_workspace")),
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
