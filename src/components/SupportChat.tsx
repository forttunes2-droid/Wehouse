import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import SecureSupportAttachment from "@/components/SecureSupportAttachment";
import { supabase } from "@/lib/supabase";
import {
  deleteSupportAttachment,
  ensureSupportConversation,
  getMySupportConversations,
  getSupportMessages,
  markSupportMessagesRead,
  sendSupportMessage,
  uploadSupportAttachment,
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
}
type SupportMessage={id:string;sender_id:string;sender_name?:string|null;content?:string|null;attachments?:string[]|null;attachment_types?:string[]|null;action_type?:string|null;action_metadata?:Record<string,unknown>|null;is_read?:boolean|null;created_at:string};
type BookingAttachmentRow={id:string;booking_code?:string|null;service_type?:string|null;status?:string|null;scheduled_date?:string|null;negotiated_amount?:number|null;agreed_amount?:number|null;created_at?:string|null};
type ReservationAttachmentRow={id:string;booking_reference?:string|null;status?:string|null;check_in?:string|null;start_date?:string|null;check_out?:string|null;end_date?:string|null;total_amount?:number|null;amount?:number|null;created_at?:string|null};

export default function SupportChat({ profile }: Props) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pendingContext, setPendingContext] =
    useState<SupportOpenContext | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachItems, setAttachItems] = useState<SupportOpenContext[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeContextType =
    pendingContext?.contextType || thread?.context_type || "";
  const isReservationDesk = [
    "apartment_reservation",
    "reservation",
    "hotel_booking",
  ].includes(activeContextType);
  const deskName = isReservationDesk ? "Reservation Help" : "WeHouse Help";

  async function openWeHouseItems() {
    setAttachOpen(true);
    const [jobs, stays] = await Promise.all([
      supabase
        .from("worker_bookings")
        .select("*")
        .or(`user_id.eq.${profile?.user_id},worker_id.eq.${profile?.user_id}`)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("reservations")
        .select("*")
        .eq("user_id", profile?.user_id || "")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    const jobItems = ((jobs.data || []) as BookingAttachmentRow[]).map((row) => ({
      category: "worker_booking",
      subject:
        `Worker booking ${row.booking_code ? `#${row.booking_code}` : ""}`.trim(),
      contextType: "worker_booking",
      contextId: row.id,
      contextSnapshot: {
        booking_code: row.booking_code,
        service_type: row.service_type,
        status: row.status,
        scheduled_date: row.scheduled_date,
        agreed_amount: row.negotiated_amount || row.agreed_amount,
        created_at: row.created_at,
      },
    }));
    const stayItems = ((stays.data || []) as ReservationAttachmentRow[]).map((row) => ({
      category: "reservation",
      subject:
        `Housing reservation ${row.booking_reference ? `#${row.booking_reference}` : ""}`.trim(),
      contextType: "reservation",
      contextId: row.id,
      contextSnapshot: {
        reference: row.booking_reference,
        status: row.status,
        check_in: row.check_in || row.start_date,
        check_out: row.check_out || row.end_date,
        amount: row.total_amount || row.amount,
        created_at: row.created_at,
      },
    }));
    setAttachItems(
      [...jobItems, ...stayItems].sort((a, b) =>
        String(b.contextSnapshot?.created_at || "").localeCompare(
          String(a.contextSnapshot?.created_at || ""),
        ),
      ),
    );
  }

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true);
    const { messages: data, error } = await getSupportMessages(id);
    if (error && !quiet)
      toast.error(error.message || "Unable to load support messages");
    if (!error) setMessages(data || []);
    await markSupportMessagesRead(id);
    if (!quiet) setLoading(false);
  }, []);

  const refreshThread = useCallback(async (context?: SupportOpenContext | null, preferredId?: string | null) => {
    const { conversations } = await getMySupportConversations();
    const current = preferredId
      ? conversations?.find((item) => item.conversation_id === preferredId) || null
      : context && hasContext(context)
        ? conversations?.find((item) => item.context_type === context.contextType && item.context_id === context.contextId) || null
        : conversations?.find((item) => item.context_type === 'general') || null;
    setThread(current);
    return current;
  }, []);

  const openConversation = useCallback(
    async (context?: SupportOpenContext) => {
      if (!profile) return;
      setOpen(true);
      setPendingContext(context && hasContext(context) ? context : null);
      setLoading(true);

      const current = await refreshThread(context);
      if (current?.conversation_id)
        await loadMessages(current.conversation_id, true);
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
          created.error?.message || "Unable to start WeHouse Support",
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

  if (!profile) return null;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-[#090C11] text-white">
      <header className="shrink-0 border-b border-white/[.06] bg-[#10141B]/95 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            onClick={() => {
              setOpen(false);
              setFiles([]);
              setPendingContext(null);
            }}
            aria-label="Close support"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9DA3B2] hover:bg-white/[.05]"
          >
            ←
          </button>
          <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 font-bold">
            S
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#10141B] bg-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[14px] font-semibold">{deskName}</p>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-violet-400 text-[9px] font-bold">
                ✓
              </span>
            </div>
            <p className="mt-0.5 truncate text-[9px] text-[#747A8B]">
              {thread?.assigned_staff_name
                ? `Human support · ${thread.assigned_staff_name}`
                : "Human support · send a message to start a case"}
            </p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.05),transparent_34%)] px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-4xl">
          {loading ? (
            <div className="grid min-h-[55vh] place-items-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            <Welcome />
          ) : (
            <div className="space-y-2.5">
              {messages.map((msg, index) => (
                <div key={msg.id}>
                  {(!messages[index - 1] ||
                    new Date(messages[index - 1].created_at).toDateString() !==
                      new Date(msg.created_at).toDateString()) && (
                    <DaySeparator value={msg.created_at} />
                  )}
                  <MessageBubble
                    msg={msg}
                    mine={msg.sender_id === profile.user_id}
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
            <button
              onClick={() => void openWeHouseItems()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.06] bg-white/[.035] text-[#9AA0B1] hover:bg-white/[.05]"
              aria-label="Attach a WeHouse item"
            >
              ＋
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
                placeholder={`Message ${deskName}`}
                className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-5 outline-none placeholder:text-[#62697A]"
              />
            </div>
            <button
              onClick={() => void send()}
              disabled={sending || (!input.trim() && !files.length)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-white disabled:bg-white/[.05] disabled:text-[#666C7D]"
              aria-label="Send"
            >
              {sending ? "…" : "➤"}
            </button>
          </div>
          <p className="mt-2 px-2 text-center text-[8px] text-[#505666]">Each reservation or job keeps its own WeHouse help case.</p>
        </div>
      </footer>
      {attachOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-end bg-black/70 backdrop-blur-sm"
          onClick={() => setAttachOpen(false)}
        >
          <section
            className="max-h-[72dvh] w-full overflow-y-auto rounded-t-[30px] bg-[#11151D] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15" />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Attach from WeHouse</h2>
                <p className="mt-1 text-[9px] text-[#747B8B]">
                  Choose a real booking or reservation. Support receives its
                  current reference and status.
                </p>
              </div>
              <button
                onClick={() => setAttachOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/[.04] text-[#9298A8]"
              >
                ×
              </button>
            </div>
            <div className="mt-5 divide-y divide-white/[.06] border-y border-white/[.06]">
              {attachItems.length ? (
                attachItems.map((item) => (
                  <button
                    key={`${item.contextType}:${item.contextId}`}
                    onClick={() => {
                      setPendingContext(item);
                      setAttachOpen(false);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    className="flex w-full items-center gap-3 py-4 text-left"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/10 text-violet-300">
                      {item.contextType === "worker_booking" ? "W" : "H"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">
                        {item.subject}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-[#707788]">
                        {String(
                          item.contextSnapshot?.status ||
                            "Current WeHouse record",
                        ).replace(/_/g, " ")}
                      </p>
                    </div>
                    <span className="text-[#707788]">›</span>
                  </button>
                ))
              ) : (
                <p className="py-10 text-center text-[10px] text-[#707788]">
                  No recent reservations or Worker bookings were found.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, mine }: { msg: SupportMessage; mine: boolean }) {
  const meta = msg.action_metadata || {};
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[88%] flex-col sm:max-w-[72%] ${mine ? "items-end" : "items-start"}`}
      >
        {meta && Object.keys(meta).length > 0 && (
          <MessageContext meta={meta} type={msg.action_type} />
        )}
        <div
          className={`rounded-[19px] px-3.5 py-2.5 ${mine ? "rounded-br-md bg-violet-500 text-white" : "rounded-bl-md border border-white/[.06] bg-[#171B24] text-[#E4E6EC]"}`}
        >
          {!mine && (
            <p className="mb-1 text-[9px] font-semibold text-violet-300">
              {msg.sender_name || "WeHouse Support"}
            </p>
          )}
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

function MessageContext({ meta, type }: { meta: Record<string,unknown>; type?: string | null }) {
  const snap = meta.context_snapshot && typeof meta.context_snapshot === 'object' ? meta.context_snapshot as Record<string,unknown> : {};
  const ref = meta.context_id;
  const label = String(
    meta.subject || type || meta.context_type || "Linked WeHouse item",
  ).replace(/_/g, " ");
  return (
    <div className="mb-1.5 w-full max-w-sm rounded-2xl border border-violet-500/15 bg-violet-500/[.055] p-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[10px] font-semibold capitalize text-violet-200">
          {label}
        </p>
        {Boolean(ref) && (
          <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] text-violet-300">
            Ref {String(ref).slice(0, 18)}
          </span>
        )}
      </div>
      {Object.keys(snap).length > 0 && (
        <div className="mt-2 grid gap-1 text-[9px] text-[#8FA0B9] sm:grid-cols-2">
          {Object.entries(snap)
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
          This reference will be attached to your next message
          {context.contextId ? ` · ${context.contextId}` : ""}.
        </p>
      </div>
      <button onClick={onRemove} className="text-[#758096]">
        ×
      </button>
    </div>
  );
}

function Welcome() {
  return (
    <div className="grid min-h-[55vh] place-items-center px-5 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-violet-500/10 text-xl font-bold text-violet-300">
          S
        </div>
        <h2 className="mt-4 text-base font-semibold">
          Message WeHouse Support
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#747A8B]">
          Send text, photos or documents to the human support team. A Support
          case begins only after you send the first message. Booking, inspection
          or payment context stays attached to that message.
        </p>
      </div>
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
