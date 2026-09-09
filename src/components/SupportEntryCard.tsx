import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  conversationPresentation,
  getMySupportConversations,
  type SupportThread,
} from "@/lib/supabase/support";
import type { Profile } from "@/types";

type Props = {
  profile: Profile;
  compact?: boolean;
  hideWhenEmpty?: boolean;
  onAvailabilityChange?: (available: boolean) => void;
  onUnreadChange?: (unread: number) => void;
};

export default function SupportEntryCard({
  profile,
  compact = false,
  hideWhenEmpty = false,
  onAvailabilityChange,
  onUnreadChange,
}: Props) {
  const [threads, setThreads] = useState<SupportThread[]>([]),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { conversations } = await getMySupportConversations();
    setThreads(conversations || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0),
      timer = window.setInterval(() => void load(), 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel(`wehouse-conversations:${profile.user_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partner_support_messages" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "partner_support_conversations",
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);
  const ordered = useMemo(
    () =>
      [...threads].sort(
        (a, b) =>
          new Date(b.last_message_time || b.created_at || 0).getTime() -
          new Date(a.last_message_time || a.created_at || 0).getTime(),
      ),
    [threads],
  );
  useEffect(
    () => onAvailabilityChange?.(ordered.length > 0),
    [onAvailabilityChange, ordered.length],
  );
  const unread = useMemo(
    () =>
      ordered.reduce(
        (sum, thread) => sum + Number(thread.unread_count || 0),
        0,
      ),
    [ordered],
  );
  useEffect(() => onUnreadChange?.(unread), [onUnreadChange, unread]);
  function open(thread: SupportThread) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          conversationId: thread.conversation_id,
          contextType: thread.context_type,
          contextId: thread.context_id,
        },
      }),
    );
  }
  if (loading && compact)
    return (
      <div className="px-4 py-4 text-[10px] text-[#666C7C]">
        Loading WeHouse conversations…
      </div>
    );
  if (!ordered.length && hideWhenEmpty) return null;
  if (!ordered.length)
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-xs font-semibold">No WeHouse conversations yet</p>
        <p className="mx-auto mt-2 max-w-sm text-[9px] leading-4 text-[#656B7B]">
          Open the relevant property, booking, payment or account action to
          contact the correct WeHouse work area.
        </p>
      </div>
    );
  return (
    <div>
      {ordered.map((thread, index) => {
        const p = conversationPresentation(thread);
        const caseNumber = String(thread.context_snapshot?.case_number || "");
        const status = supportStatus(thread.status);
        return (
          <div key={thread.conversation_id}>
            {index > 0 && <div className="ml-[4.5rem] h-px bg-white/[.05]" />}
            <SupportRow
              compact={compact}
              title={p.title}
              preview={thread.last_message || p.operator}
              meta={[
                caseNumber ? `Case ${caseNumber}` : "",
                status,
                thread.assigned_staff_name
                  ? `Assigned to ${thread.assigned_staff_name}`
                  : "Awaiting WeHouse assignment",
                p.meta,
              ]
                .filter(Boolean)
                .join(" · ")}
              unread={Number(thread.unread_count || 0)}
              time={thread.last_message_time || thread.created_at}
              onOpen={() => open(thread)}
            />
          </div>
        );
      })}
    </div>
  );
}

function SupportRow({
  compact,
  title,
  preview,
  meta,
  unread,
  time,
  onOpen,
}: {
  compact: boolean;
  title: string;
  preview: string;
  meta: string;
  unread: number;
  time: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={
        compact
          ? "flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025]"
          : "flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-white/[.018] p-4 text-left transition hover:bg-white/[.025]"
      }
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/[.08] bg-[#171A22] font-bold text-violet-200">
        W
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{title}</p>
        <p
          className={`mt-1 truncate text-[11px] ${unread ? "font-medium text-[#E3E5EB]" : "text-[#777C8D]"}`}
        >
          {preview}
        </p>
        <p className="mt-0.5 truncate text-[9px] text-[#5F6474]">{meta}</p>
      </div>
      <div className="shrink-0 self-start pt-0.5 text-right">
        {time && (
          <p
            className={`text-[8px] ${unread ? "text-violet-300" : "text-[#555A6B]"}`}
          >
            {formatTime(time)}
          </p>
        )}
        {unread > 0 && (
          <span className="ml-auto mt-2 grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>
    </button>
  );
}
function supportStatus(value: string) {
  const labels: Record<string, string> = {
    open: "Received",
    assigned: "Assigned",
    in_progress: "In progress",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[value] || String(value || "Received").replace(/_/g, " ");
}
function formatTime(value: string) {
  const d = new Date(value),
    now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
