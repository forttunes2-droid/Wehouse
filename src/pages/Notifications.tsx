import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getAnnouncementsForUser,
  markAnnouncementRead,
} from "@/lib/supabase/announcements";
import type { Profile } from "@/types";
import { toast, Toaster } from "sonner";
import {
  activityDestinationLabel,
  activityIsCurrent,
  currentActivityRows,
  longestActivityCutoff,
  resolveActivityDestination,
} from "@/lib/activityFeed";
import VideoPlayer from "@/components/VideoPlayer";
import HotelTeamInvitations from "@/components/HotelTeamInvitations";
import WeHouseSelect from "@/components/WeHouseSelect";

type Props = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  embedded?: boolean;
  onUnreadChange?: (count: number) => void;
  scope?: string;
};
type Activity = {
  id: string;
  source: "event" | "announcement";
  sourceNumericId?: number;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  created_at: string;
  source_type?: string | null;
  source_id?: string | null;
  destination_route?: string | null;
  destination_params?: Record<string, unknown> | null;
};
type WorkPostConfirmation = {
  id: string;
  media_type: "image" | "video";
  storage_path: string;
  caption: string | null;
  job_confirmation_status: string;
  url: string;
};
type ActivityFilter = "all" | "action" | "bookings" | "property" | "work" | "money" | "roommates" | "wehouse";
const activityCache = new Map<string, Activity[]>();

export default function Notifications({
  profile,
  onNavigate,
  embedded = false,
  onUnreadChange,
  scope = "personal",
}: Props) {
  const cacheKey = `${profile.user_id}:${scope}`;
  const cached = activityCache.get(cacheKey);
  const [rows, setRows] = useState<Activity[]>(cached || []),
    [loading, setLoading] = useState(!cached),
    [error, setError] = useState(""),
    [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [workPost, setWorkPost] = useState<WorkPostConfirmation | null>(null),
    [confirmBusy, setConfirmBusy] = useState(false);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    let eventQuery = supabase
      .from("notifications")
      .select(
        "id,type,title,message,read,created_at,source_type,source_id,destination_route,destination_params,workspace_scope",
      )
      .eq("recipient_id", profile.user_id);
    eventQuery = scope === "personal"
      ? eventQuery.in("workspace_scope", ["personal", "account"])
      : eventQuery.eq("workspace_scope", scope);
    const [eventResult, announcementResult] = await Promise.all([
      eventQuery
        .gte("created_at", longestActivityCutoff())
        .order("created_at", { ascending: false })
        .limit(100),
      getAnnouncementsForUser(profile.user_id),
    ]);
    const failures = [
      eventResult.error?.message,
      announcementResult.error?.message,
    ].filter(Boolean) as string[];
    if (failures.length === 2) setError(failures.join(" · "));
    else {
      const events = currentActivityRows(
        ((eventResult.data || []) as Omit<Activity, "source">[]).map((row) => ({
          ...row,
          source: "event" as const,
        })),
      ).map((row) => ({ ...row, id: `event:${row.id}` }));
      const announcements = (announcementResult.messages || []).map(
        (delivery: any) => {
          const announcement = Array.isArray(delivery.announcements)
            ? delivery.announcements[0]
            : delivery.announcement || delivery.message;
          return {
            id: `announcement:${delivery.announcement_id}`,
            sourceNumericId: Number(delivery.announcement_id),
            source: "announcement" as const,
            type: "announcement",
            title: announcement?.title || "WeHouse announcement",
            message: announcement?.content || null,
            read: Boolean(delivery.read_status),
            created_at: announcement?.created_at || delivery.delivered_at,
          };
        },
      );
      const next = [
        ...events,
        ...announcements.filter((row) => activityIsCurrent(row)),
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      activityCache.set(cacheKey, next);
      setRows(next);
      setError(failures[0] || "");
    }
    if (!quiet) setLoading(false);
  }

  useEffect(() => {
    void load(Boolean(activityCache.get(cacheKey)));
    const channel = supabase
      .channel(`activity-feed:${profile.user_id}:${scope}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${profile.user_id}`,
        },
        () => void load(true),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "announcement_recipients",
          filter: `user_id=eq.${profile.user_id}`,
        },
        () => void load(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile.user_id, scope]);

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesActivityFilter(row, activityFilter)),
    [activityFilter, rows],
  );
  const groups = useMemo(() => {
    const result = new Map<string, Activity[]>();
    for (const row of filteredRows) {
      const day = !row.read ? "New" : dayLabel(row.created_at);
      result.set(day, [...(result.get(day) || []), row]);
    }
    return [...result];
  }, [filteredRows]);

  async function markRead(row: Activity) {
    if (row.read) return true;
    const result =
      row.source === "announcement"
        ? await markAnnouncementRead(
            Number(row.sourceNumericId),
            profile.user_id,
          )
        : await supabase.rpc("mark_my_notification_read", {
            p_notification_id: row.id.replace("event:", ""),
          });
    if (result.error) {
      toast.error(
        result.error.message || "Activity could not be marked as read",
      );
      return false;
    }
    setRows((current) =>
      current.map((item) =>
        item.id === row.id ? { ...item, read: true } : item,
      ),
    );
    return true;
  }

  async function open(row: Activity) {
    void markRead(row);
    if (row.source === "announcement") {
      setExpanded((current) => (current === row.id ? null : row.id));
      return;
    }
    if (row.type === "work_post_confirmation_requested") {
      const postId = String(
        row.destination_params?.work_post_id || row.source_id || "",
      );
      if (!postId) return toast.error("Showcase post reference is missing");
      const { data, error } = await supabase
        .from("worker_showcase_posts")
        .select("id,media_type,storage_path,caption,job_confirmation_status")
        .eq("id", postId)
        .maybeSingle();
      if (error || !data)
        return toast.error(error?.message || "Showcase post could not be loaded");
      const signed = await supabase.storage
        .from("worker-showcase")
        .createSignedUrl(data.storage_path, 900);
      if (signed.error || !signed.data?.signedUrl)
        return toast.error(
          signed.error?.message || "Showcase media could not be opened",
        );
      setWorkPost({
        ...data,
        url: signed.data.signedUrl,
      } as WorkPostConfirmation);
      return;
    }
    if (row.source_type === "wehouse_case" && !["creator", "admin", "staff"].includes(profile.role)) {
      window.dispatchEvent(new CustomEvent("openSupportChat", { detail: { conversationId: row.source_id } }));
      return;
    }
    const destination = resolveActivityDestination(row);
    if (destination.route)
      onNavigate(destination.route, destination.id);
    else setExpanded((current) => (current === row.id ? null : row.id));
  }

  async function answerWorkPost(confirm: boolean) {
    if (!workPost) return;
    setConfirmBusy(true);
    const { error } = await supabase.rpc(
      "respond_to_worker_work_post_confirmation",
      { p_post_id: workPost.id, p_confirm: confirm },
    );
    setConfirmBusy(false);
    if (error) return toast.error(error.message);
    toast.success(confirm ? "Work confirmed" : "Work not confirmed");
    setWorkPost(null);
    await load(true);
  }

  async function markAll() {
    const unreadEvents = rows.filter(
      (row) => !row.read && row.source === "event",
    );
    const unreadAnnouncements = rows.filter(
      (row) => !row.read && row.source === "announcement",
    );
    const [eventResults, announcementResults] = await Promise.all([
      Promise.all(
        unreadEvents.map((row) =>
          supabase.rpc("mark_my_notification_read", {
            p_notification_id: row.id.replace("event:", ""),
          }),
        ),
      ),
      Promise.all(
        unreadAnnouncements.map((row) =>
          markAnnouncementRead(Number(row.sourceNumericId), profile.user_id),
        ),
      ),
    ]);
    const eventError = eventResults.find((result) => result.error)?.error;
    const announcementError = announcementResults.find(
      (result) => result.error,
    )?.error;
    if (eventError || announcementError)
      return toast.error(
        eventError?.message ||
          announcementError?.message ||
          "Activity could not be marked as read",
      );
    setRows((current) => current.map((row) => ({ ...row, read: true })));
    toast.success("Activity marked as read");
  }

  const unread = rows.filter((row) => !row.read).length;
  useEffect(() => {
    onUnreadChange?.(unread);
  }, [onUnreadChange, unread]);
  const content = (
    <main className={embedded ? "py-1" : "mx-auto max-w-4xl px-4 py-5"}>
      {scope === "personal" && <HotelTeamInvitations />}
      {loading ? (
        <ActivityLoading />
      ) : error && rows.length === 0 ? (
        <ErrorState text={error} retry={() => void load()} />
      ) : rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/[.06] pb-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#656B7D]">
                Activity
              </p>
              <p className="mt-1 text-[10px] text-[#8A909F]">
                Meaningful updates and actions
              </p>
            </div>
            <WeHouseSelect
              value={activityFilter}
              options={[
                { value: "all", label: "All updates" },
                { value: "action", label: "Needs my action" },
                { value: "bookings", label: "Bookings and stays" },
                { value: "property", label: "Properties" },
                { value: "work", label: "Work and inspections" },
                { value: "money", label: "Money" },
                { value: "roommates", label: "Roommates" },
                { value: "wehouse", label: "WeHouse" },
              ]}
              onChange={(value) => setActivityFilter(value as ActivityFilter)}
              eyebrow="Activity"
              title="Filter updates"
              ariaLabel="Filter activity updates"
            />
          </div>
          {unread > 0 && (
            <div className="flex items-center justify-end">
              <button
                onClick={() => void markAll()}
                className="shrink-0 rounded-full border border-white/[.08] px-3 py-2 text-[9px] font-semibold text-violet-300"
              >
                Mark all read
              </button>
            </div>
          )}
          {groups.length === 0 ? (
            <div className="grid min-h-48 place-items-center text-center">
              <div>
                <p className="text-sm font-semibold">No updates in this group</p>
                <p className="mt-2 text-[10px] text-[#6C7282]">
                  Choose another filter to see other meaningful activity.
                </p>
              </div>
            </div>
          ) : groups.map(([day, items]) => (
            <section key={day}>
              <h2
                className={`mb-2 text-[9px] font-bold uppercase tracking-[.15em] ${day === "New" ? "text-violet-300" : "text-[#656B7C]"}`}
              >
                {day}
              </h2>
              <div className="divide-y divide-white/[.055] border-y border-white/[.055]">
                {items.map((row) => (
                  <article
                    key={row.id}
                    className={`relative overflow-hidden ${row.read ? "bg-transparent" : "bg-white/[.018]"}`}
                  >
                    {!row.read && (
                      <span className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-violet-400" />
                    )}
                    <button
                      onClick={() => void open(row)}
                      className="flex min-h-24 w-full items-start gap-3 p-3.5 text-left active:bg-white/[.025] sm:p-4"
                    >
                      <span
                        className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${row.read ? "bg-white/[.035] text-[#73798A]" : "bg-violet-500/12 text-violet-300"}`}
                      >
                        {icon(row.type)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 block text-[7px] font-bold uppercase tracking-[.14em] text-[#62697A]">
                          {activityKind(row)}
                        </span>
                        <span
                          className={`block text-xs ${row.read ? "font-medium text-[#A3A7B3]" : "font-semibold text-white"}`}
                        >
                          {activityTitle(row)}
                        </span>
                        {activityMessage(row) && (
                          <span
                            className={`${expanded === row.id ? "whitespace-pre-wrap" : "line-clamp-2"} mt-1 block text-[10px] leading-4 text-[#717788]`}
                          >
                            {activityMessage(row)}
                          </span>
                        )}
                        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className="text-[8px] text-[#555C6D]">
                            {new Date(row.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="text-[8px] font-semibold text-violet-300">
                            {activityAction(row, expanded === row.id)}
                          </span>
                        </span>
                      </span>
                      {!row.read ? (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                      ) : (
                        <span className="mt-2 text-[#555C6D]">›</span>
                      )}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
  const confirmation = workPost && (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[#08090D] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm worker showcase post"
    >
      <header className="flex h-14 items-center gap-3 border-b border-white/[.08] px-3">
        <button
          onClick={() => setWorkPost(null)}
          disabled={confirmBusy}
          className="grid h-10 w-10 place-items-center text-xl"
          aria-label="Close"
        >
          ×
        </button>
        <div>
          <p className="text-sm font-semibold">
            Does this show the completed work?
          </p>
          <p className="text-[9px] text-[#707687]">
            Confirm only the work from your linked WeHouse job
          </p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid min-h-[52dvh] place-items-center bg-black">
          {workPost.media_type === "video" ? (
            <VideoPlayer src={workPost.url} className="max-h-[68dvh] w-full bg-black object-contain" />
          ) : (
            <img
              src={workPost.url}
              alt="Worker's linked completed work"
              className="max-h-[68dvh] w-full object-contain"
            />
          )}
        </div>
        <div className="mx-auto max-w-xl space-y-4 p-4">
          {workPost.caption && (
            <p className="text-xs leading-5 text-[#B4B8C3]">
              {workPost.caption}
            </p>
          )}
          {workPost.job_confirmation_status === "pending" ? (
            <>
              <p className="text-[10px] leading-5 text-[#7D8393]">
                Yes adds the “Completed through WeHouse” badge. No keeps this as
                an ordinary showcase post without that badge.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => void answerWorkPost(false)}
                  disabled={confirmBusy}
                  className="h-12 rounded-2xl border border-white/[.1] text-xs font-semibold disabled:opacity-40"
                >
                  No, it does not
                </button>
                <button
                  onClick={() => void answerWorkPost(true)}
                  disabled={confirmBusy}
                  className="h-12 rounded-2xl bg-emerald-500 text-xs font-semibold text-[#04110B] disabled:opacity-40"
                >
                  {confirmBusy ? "Saving…" : "Yes, confirm"}
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-2xl bg-white/[.04] p-4 text-xs text-[#A5AAB6]">
              This confirmation has already been answered.
            </p>
          )}
        </div>
      </main>
    </div>
  );
  if (embedded)
    return (
      <>
        <Toaster position="top-center" richColors />
        {content}
        {confirmation}
      </>
    );
  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-28 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-xl font-bold">Activity</h1>
        </div>
      </header>
      {content}
      {confirmation}
    </div>
  );
}

function activityAction(row: Activity, expanded: boolean) {
  if (row.source === "announcement")
    return expanded ? "Show less" : "Read update";
  if (row.type === "work_post_confirmation_requested")
    return "Review completed work";
  const label = activityDestinationLabel(row);
  return label === "View details" && expanded ? "Show less" : label;
}
function dayLabel(value: string) {
  const date = new Date(value),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
function icon(type: string) {
  if (type === "announcement") return "W";
  if (type.includes("payment")) return "₦";
  if (type.includes("roommate")) return "◉";
  if (type.includes("security")) return "⌾";
  if (type.includes("booking") || type.includes("reservation")) return "✓";
  return "•";
}
function ActivityLoading() {
  return (
    <div
      className="grid min-h-40 place-items-center"
      role="status"
      aria-label="Loading activity"
    >
      <div className="text-center">
        <div className="mx-auto grid h-10 w-10 animate-pulse place-items-center rounded-2xl bg-violet-500 text-sm font-black">
          WH
        </div>
        <p className="mt-3 text-[9px] text-[#686F80]">
          Loading recent activity…
        </p>
      </div>
    </div>
  );
}
function Empty() {
  return (
    <div className="grid min-h-[55dvh] place-items-center text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-violet-300">
          ✓
        </div>
        <p className="mt-4 text-sm font-semibold">You’re up to date</p>
        <p className="mt-2 max-w-xs text-[10px] leading-5 text-[#6C7282]">
          Nothing needs your attention right now.
        </p>
      </div>
    </div>
  );
}
function ErrorState({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/15 p-5 text-center">
      <p className="text-xs font-semibold">Activity could not be loaded</p>
      <p className="mt-1 text-[9px] text-[#757B8A]">{text}</p>
      <button
        onClick={retry}
        className="mt-3 text-[10px] font-semibold text-violet-300"
      >
        Try again
      </button>
    </div>
  );
}
function matchesActivityFilter(row: Activity, filter: ActivityFilter) {
  if (filter === "all") return true;
  const value = `${row.type} ${row.source_type} ${row.destination_route}`.toLowerCase();
  if (filter === "action")
    return /action_required|changes_requested|waiting_for_user|escalat|failed|dispute|verification_required|approval_required/.test(value);
  if (filter === "money")
    return /payment|payout|earning|refund|wallet|commission/.test(value);
  if (filter === "roommates") return /roommate|shared_home|match/.test(value);
  if (filter === "property") return /property|listing|hotel_review|publication/.test(value);
  if (filter === "work") return /worker|job|service|inspection|field/.test(value);
  if (filter === "bookings") return /booking|reservation|tenancy|move_in|handover|check_in|check_out|hotel/.test(value);
  return row.source === "announcement" || !/payment|payout|earning|refund|wallet|commission|roommate|shared_home|match|property|listing|hotel|worker|job|service|inspection|field|booking|reservation|tenancy|move_in|handover|check_in|check_out/.test(value);
}
function activityKind(row: Activity) {
  const value = `${row.type} ${row.source_type}`.toLowerCase();
  if (/security|device|password|login/.test(value)) return "Security";
  if (/payment|payout|earning|refund|wallet|commission/.test(value))
    return "Money";
  if (/inspection|field|visit|access_evidence/.test(value)) return "Inspection";
  if (/worker|job|service/.test(value)) return "Work";
  if (/property|listing|publication/.test(value)) return "Property";
  if (/hotel|booking|reservation|tenancy|move_in|handover|check_in|check_out/.test(value))
    return "Booking";
  if (/roommate|shared_home|match/.test(value)) return "Roommates";
  return "WeHouse";
}
function activityTitle(row: Activity) {
  if (row.type === "roommate_match") return "Roommate connection ready";
  return row.title;
}
function activityMessage(row: Activity) {
  if (row.type === "roommate_match")
    return String(row.message || "").replace(
      "You can now chat.",
      "Open Roommates to view the connection.",
    );
  return row.message || "";
}
