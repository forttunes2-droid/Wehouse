import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  conversationPresentation,
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
type BookingAttachmentRow = {
  id: string;
  booking_code?: string | null;
  service_type?: string | null;
  status?: string | null;
  scheduled_date?: string | null;
  negotiated_amount?: number | null;
  agreed_amount?: number | null;
  created_at?: string | null;
};
type ReservationAttachmentRow = {
  id: string;
  booking_reference?: string | null;
  status?: string | null;
  check_in?: string | null;
  start_date?: string | null;
  check_out?: string | null;
  end_date?: string | null;
  total_amount?: number | null;
  amount?: number | null;
  created_at?: string | null;
};

export default function SupportChat({ profile, onOpenListing, onOpenBooking }: Props) {
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
  const [loadError, setLoadError] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const presentation = conversationPresentation(thread || pendingContext || {});
  const visibleMessages = messages.filter(message => message.sender_role !== "system");

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
    const jobItems = ((jobs.data || []) as BookingAttachmentRow[]).map(
      (row) => ({
        category: "service_booking_help",
        subject: `${row.service_type || "Service booking"} help`,
        contextType: "support_case",
        contextId: row.id,
        contextSnapshot: {
          source_type: "worker_booking",
          source_id: row.id,
          booking_code: row.booking_code,
          service_type: row.service_type,
          status: row.status,
          scheduled_date: row.scheduled_date,
          agreed_amount: row.negotiated_amount || row.agreed_amount,
          created_at: row.created_at,
        },
      }),
    );
    const stayItems = ((stays.data || []) as ReservationAttachmentRow[]).map(
      (row) => ({
        category: "reservation_support",
        subject: `Help with reservation ${row.booking_reference ? `#${row.booking_reference}` : ""}`.trim(),
        contextType: "support_case",
        contextId: row.id,
        contextSnapshot: {
          source_type: "reservation",
          source_id: row.id,
          reference: row.booking_reference,
          status: row.status,
          check_in: row.check_in || row.start_date,
          check_out: row.check_out || row.end_date,
          amount: row.total_amount || row.amount,
          created_at: row.created_at,
        },
      }),
    );
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
    setLoadError("");
    const { messages: data, error } = await getSupportMessages(id);
    if (error) {
      setLoadError("We could not load this conversation. Please try again.");
      if (!quiet) toast.error("Unable to load this conversation");
    } else {
      const next = (data || []) as SupportMessage[];
      messageCache.set(id, next);
      setMessages(next);
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
                item.context_type === context.contextType &&
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
      const cached = context?.conversationId ? messageCache.get(context.conversationId) : undefined;
      setMessages(cached || []);
      setLoading(!cached);

      let preferredId = context?.conversationId || null;
      if (context && hasContext(context) && ["apartment_reservation", "reservation", "hotel_booking"].includes(context.contextType || "")) {
        const ensured = await ensureSupportConversation(context);
        if (!ensured.error && ensured.conversationId) preferredId = ensured.conversationId;
      }
      const current = await refreshThread(
        context,
        preferredId,
      );
      setPendingContext(current ? null : context && hasContext(context) ? context : null);
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

  return createPortal(
    <div className="fixed inset-0 z-[100030] isolate flex h-[100dvh] flex-col overflow-hidden bg-[#090C11] text-white">
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
              <p className="truncate text-[14px] font-semibold">{presentation.title}</p>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-violet-400 text-[9px] font-bold">
                ✓
              </span>
            </div>
            <p className="mt-0.5 truncate text-[9px] text-[#747A8B]">
              {[presentation.operator, presentation.meta, thread?.assigned_staff_name].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.05),transparent_34%)] px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-4xl">
          {presentation.operational && thread && (
            <LinkedOperationalContext thread={thread} onOpenBooking={onOpenBooking ? (id) => { setOpen(false); onOpenBooking(id); } : undefined} onOpenListing={onOpenListing ? (id) => { setOpen(false); onOpenListing(id); } : undefined} />
          )}
          {loading ? (
            <ConversationSkeleton />
          ) : loadError ? (
            <ConversationLoadError text={loadError} retry={() => thread?.conversation_id && void loadMessages(thread.conversation_id)} />
          ) : visibleMessages.length === 0 ? (
            <Welcome presentation={presentation} />
          ) : (
            <div className="space-y-2.5">
              {visibleMessages.map((msg, index) => (
                <div key={msg.id}>
                  {(!visibleMessages[index - 1] ||
                    new Date(visibleMessages[index - 1].created_at).toDateString() !==
                      new Date(msg.created_at).toDateString()) && (
                    <DaySeparator value={msg.created_at} />
                  )}
                  <MessageBubble
                    msg={msg}
                    mine={msg.sender_id === profile.user_id}
                    showContext={!presentation.operational}
                    onOpenListing={(listingId) => { setOpen(false); onOpenListing?.(listingId); }}
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
              hidden={presentation.operational}
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
                placeholder={`Message ${presentation.operator}`}
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
          <p className="mt-2 px-2 text-center text-[8px] text-[#505666]">
            {presentation.operational
              ? "Operational conversation · visible to you and authorized WeHouse staff"
              : "Support case · visible to you and the authorized WeHouse team handling it"}
          </p>
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
    </div>,
    document.body,
  );
}

function MessageBubble({ msg, mine, showContext, onOpenListing }: { msg: SupportMessage; mine: boolean; showContext: boolean; onOpenListing?: (listingId: string) => void }) {
  const meta = msg.action_metadata || {};
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[88%] flex-col sm:max-w-[72%] ${mine ? "items-end" : "items-start"}`}
      >
        {showContext && meta && Object.keys(meta).length > 0 && (
          <MessageContext meta={meta} type={msg.action_type} onOpenListing={onOpenListing} />
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

function LinkedOperationalContext({thread,onOpenBooking,onOpenListing}:{thread:SupportThread;onOpenBooking?:(id:string)=>void;onOpenListing?:(id:string)=>void}){
  const snapshot=thread.context_snapshot||{};
  const presentation=conversationPresentation(thread);
  const bookingId=String(thread.context_id||snapshot.reservation_id||'');
  const listingId=String(snapshot.listing_id||'');
  const rawStatus=String(snapshot.status||'').replace(/_/g,' ');
  const status=rawStatus==='occupied'?'Tenancy active':rawStatus==='checked in'?'Checked in':rawStatus==='checked out'?'Checked out':rawStatus;
  const code=String(snapshot.booking_code||snapshot.reference||'');
  const title=String(snapshot.listing_title||snapshot.hotel_name||presentation.title||'Reservation').replace(/\s*·\s*Reservation Desk$/i,'');
  const stayType=String(snapshot.stay_type||'');
  const actionLabel=thread.context_type==='hotel_booking'?'Open stay':(stayType==='long_stay'||stayType==='long_let'||String(snapshot.status||'')==='occupied')?'Open tenancy':'Open booking';
  const location=String(snapshot.listing_location||snapshot.room_name||'');
  const checkIn=String(snapshot.check_in||'');
  const checkOut=String(snapshot.check_out||'');
  return <section className="mb-4 border-y border-white/[.06] bg-white/[.018] py-3">
    <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300">⌂</div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold">{title}</p>{location&&<p className="mt-1 truncate text-[9px] text-[#747B8C]">{location}</p>}<p className="mt-1 truncate text-[9px] capitalize text-[#747B8C]">{[status,code].filter(Boolean).join(' · ')}</p></div>
    {bookingId&&onOpenBooking?<button type="button" onClick={()=>onOpenBooking(bookingId)} className="shrink-0 text-[9px] font-semibold text-violet-300">{actionLabel}</button>:listingId&&onOpenListing?<button type="button" onClick={()=>onOpenListing(listingId)} className="shrink-0 text-[9px] font-semibold text-violet-300">View property</button>:null}</div>
    {(checkIn||checkOut)&&<div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[.05] pt-3 text-[9px] text-[#747B8C]">{checkIn&&<p><span className="text-[#555C6D]">Check-in</span><br/>{new Date(checkIn).toLocaleDateString()}</p>}{checkOut&&<p><span className="text-[#555C6D]">Check-out</span><br/>{new Date(checkOut).toLocaleDateString()}</p>}</div>}
  </section>
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
        {listingId && onOpenListing ? <button type="button" onClick={() => onOpenListing(listingId)} className="shrink-0 rounded-full bg-violet-500/12 px-2.5 py-1.5 text-[8px] font-semibold text-violet-200">View property →</button> : null}
      </div>
      {Object.keys(snap).length > 0 && (
        <div className="mt-2 grid gap-1 text-[9px] text-[#8FA0B9] sm:grid-cols-2">
          {Object.entries(snap).filter(([key]) => !['id','listing_id','user_id','auth_id'].includes(key))
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
          This support case will stay linked to the selected WeHouse item.
        </p>
      </div>
      <button onClick={onRemove} className="text-[#758096]">
        ×
      </button>
    </div>
  );
}

function Welcome({presentation}:{presentation:ReturnType<typeof conversationPresentation>}) {
  return (
    <div className="grid min-h-[55vh] place-items-center px-5 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-violet-500/10 text-xl font-bold text-violet-300">
          S
        </div>
        <h2 className="mt-4 text-base font-semibold">
          {presentation.operational ? `Start this ${presentation.operator} conversation` : "Message WeHouse Support"}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#747A8B]">
          {presentation.operational
            ? "This thread belongs to the reservation shown above. Its complete history stays with that reservation."
            : "Send a message to create a genuine help case. Visiting Help alone does not create a conversation."}
        </p>
      </div>
    </div>
  );
}

function ConversationSkeleton(){return <div className="min-h-24" role="status" aria-label="Loading conversation"/>}
function ConversationLoadError({text,retry}:{text:string;retry:()=>void}){return <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-red-500/15 bg-red-500/[.04] p-5 text-center"><p className="text-xs font-semibold">Conversation could not be loaded</p><p className="mt-2 text-[9px] leading-4 text-[#858A98]">{text}</p><button type="button" onClick={retry} className="mt-4 text-[10px] font-semibold text-violet-300">Try again</button></div>}

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
