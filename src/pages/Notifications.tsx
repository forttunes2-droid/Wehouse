import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAnnouncementsForUser, markAnnouncementRead } from "@/lib/supabase/announcements";
import type { Profile } from "@/types";
import { toast, Toaster } from "sonner";

type Props = { profile: Profile; onNavigate: (page: string, id?: string) => void; embedded?: boolean };
type Activity = {
  id: string; source: "event" | "announcement"; sourceNumericId?: number; type: string;
  title: string; message: string | null; read: boolean; created_at: string;
  source_type?: string | null; source_id?: string | null; destination_route?: string | null;
  destination_params?: Record<string, unknown> | null;
};
const activityCache=new Map<string,Activity[]>();

export default function Notifications({ profile, onNavigate, embedded = false }: Props) {
  const cached=activityCache.get(profile.user_id);
  const [rows, setRows] = useState<Activity[]>(cached||[]), [loading, setLoading] = useState(!cached), [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    const [eventResult, announcementResult] = await Promise.all([
      supabase.from("notifications").select("id,type,title,message,read,created_at,source_type,source_id,destination_route,destination_params").eq("recipient_id", profile.user_id).order("created_at", { ascending: false }).limit(100),
      getAnnouncementsForUser(profile.user_id),
    ]);
    const failures = [eventResult.error?.message, announcementResult.error?.message].filter(Boolean) as string[];
    if (failures.length === 2) setError(failures.join(" · "));
    else {
      const events = ((eventResult.data || []) as Omit<Activity, "source">[])
        .filter((row) => !isOrdinaryMessageEvent(row.type))
        .map((row) => ({ ...row, id: `event:${row.id}`, source: "event" as const }));
      const announcements = (announcementResult.messages || []).map((delivery: any) => {
        const announcement = Array.isArray(delivery.announcements) ? delivery.announcements[0] : delivery.announcement || delivery.message;
        return { id: `announcement:${delivery.announcement_id}`, sourceNumericId: Number(delivery.announcement_id), source: "announcement" as const, type: "announcement", title: announcement?.title || "WeHouse announcement", message: announcement?.content || null, read: Boolean(delivery.read_status), created_at: announcement?.created_at || delivery.delivered_at };
      });
      const next=[...events, ...announcements].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      activityCache.set(profile.user_id,next);setRows(next);
      setError(failures[0] || "");
    }
    if (!quiet) setLoading(false);
  }

  useEffect(() => {
    void load(Boolean(activityCache.get(profile.user_id)));
    const channel = supabase.channel(`activity-feed:${profile.user_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${profile.user_id}` }, () => void load(true))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcement_recipients", filter: `user_id=eq.${profile.user_id}` }, () => void load(true)).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile.user_id]);

  const groups = useMemo(() => {
    const result = new Map<string, Activity[]>();
    for (const row of rows) { const day = dayLabel(row.created_at); result.set(day, [...(result.get(day) || []), row]); }
    return [...result];
  }, [rows]);

  async function open(row: Activity) {
    if (!row.read) {
      const result = row.source === "announcement" ? await markAnnouncementRead(Number(row.sourceNumericId), profile.user_id) : await supabase.rpc("mark_my_notification_read", { p_notification_id: row.id.replace("event:", "") });
      if (result.error) return toast.error(result.error.message || "Activity could not be marked as read");
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, read: true } : item));
    }
    if (row.source === "announcement") { setExpanded((current) => current === row.id ? null : row.id); return; }
    const route = row.destination_route || legacyRoute(row.type), params = row.destination_params || {};
    const id = String(params.listing_id || params.listingId || params.conversation_id || params.conversationId || params.contextId || params.booking_id || params.bookingId || params.sharedGroupId || row.source_id || "");
    if (route) onNavigate(route, id || undefined);
  }

  async function markAll() {
    const unreadAnnouncements = rows.filter((row) => !row.read && row.source === "announcement");
    const [{ error: eventError }, announcementResults] = await Promise.all([supabase.rpc("mark_all_my_notifications_read"), Promise.all(unreadAnnouncements.map((row) => markAnnouncementRead(Number(row.sourceNumericId), profile.user_id)))]);
    const announcementError = announcementResults.find((result) => result.error)?.error;
    if (eventError || announcementError) return toast.error(eventError?.message || announcementError?.message || "Activity could not be marked as read");
    setRows((current) => current.map((row) => ({ ...row, read: true }))); toast.success("Activity marked as read");
  }

  const unread = rows.filter((row) => !row.read).length;
  const content = <main className={embedded ? "py-4" : "mx-auto max-w-4xl px-4 py-5"}>{loading ? <ActivityLoading /> : error && rows.length === 0 ? <ErrorState text={error} retry={() => void load()} /> : rows.length === 0 ? <Empty /> : <div className="space-y-7">
    {unread > 0 && <div className="flex justify-end"><button onClick={() => void markAll()} className="rounded-full border border-white/[.08] px-3 py-2 text-[9px] font-semibold text-violet-300">Mark all read</button></div>}
    {groups.map(([day, items]) => <section key={day}><h2 className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#656B7C]">{day}</h2><div className="divide-y divide-white/[.055] border-y border-white/[.06]">{items.map((row) => <button key={row.id} onClick={() => void open(row)} className="flex min-h-20 w-full items-start gap-3 py-3 text-left">
      <span className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${row.read ? "bg-white/[.035] text-[#73798A]" : "bg-violet-500/12 text-violet-300"}`}>{icon(row.type)}</span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={`block min-w-0 flex-1 text-xs ${row.read ? "font-medium text-[#A3A7B3]" : "font-semibold text-white"}`}>{row.title}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[7px] font-semibold ${activitySection(row)==='Official'?'bg-violet-500/10 text-violet-300':activitySection(row)==='Needs attention'?'bg-amber-500/10 text-amber-300':'bg-white/[.045] text-[#7D8393]'}`}>{activitySection(row).toUpperCase()}</span></span>
      {row.message && <span className={`${expanded === row.id ? "whitespace-pre-wrap" : "line-clamp-2"} mt-1 block text-[10px] leading-4 text-[#717788]`}>{row.message}</span>}
      <span className="mt-1.5 block text-[8px] text-[#555C6D]">{new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{row.source === "announcement" ? expanded === row.id ? " · Show less" : " · Read update" : row.destination_route || legacyRoute(row.type) ? " · Open details" : ""}</span></span>{!row.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-400" />}
    </button>)}</div></section>)}
  </div>}</main>;
  if (embedded) return <><Toaster position="top-center" richColors />{content}</>;
  return <div className="min-h-[100dvh] bg-[#090B10] pb-28 text-white"><Toaster position="top-center" richColors /><header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl"><div className="mx-auto max-w-4xl"><p className="text-[9px] font-bold uppercase tracking-[.24em] text-violet-400">WEHOUSE</p><h1 className="mt-1 text-xl font-bold">Activity</h1><p className="mt-1 text-[10px] text-[#747A8B]">Lifecycle, payment, security and official updates linked to their source.</p></div></header>{content}</div>;
}

function isOrdinaryMessageEvent(type: string) { return type !== "missed_call" && (type === "new_message" || type === "message" || type === "chat_message" || type.endsWith("_message")); }
function activitySection(row:Activity){if(row.source==='announcement')return'Official';return /(required|request|pending|failed|declined|cancel|security|dispute|price|action)/i.test(row.type)?'Needs attention':'Update'}
function legacyRoute(type: string) { if (type === "roommate_interest" || type === "shared_home_invite" || type === "shared_home_response") return "roommate"; if (type === "roommate_match" || type === "missed_call") return "conversation"; if (type.includes("booking") || type.includes("payment") || type.includes("inspection") || type.includes("reservation") || type.includes("shared_home")) return "my_reservations"; return ""; }
function dayLabel(value: string) { const date = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return "Today"; if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }); }
function icon(type: string) { if (type === "announcement") return "W"; if (type.includes("payment")) return "₦"; if (type.includes("roommate")) return "◉"; if (type.includes("security")) return "⌾"; if (type.includes("booking") || type.includes("reservation")) return "✓"; return "•"; }
function ActivityLoading(){return <div className="min-h-28" role="status" aria-label="Loading activity"/>}
function Empty() { return <div className="grid min-h-[55dvh] place-items-center text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-violet-300">✓</div><p className="mt-4 text-sm font-semibold">You’re up to date</p><p className="mt-2 max-w-xs text-[10px] leading-5 text-[#6C7282]">Nothing needs your attention right now.</p></div></div>; }
function ErrorState({ text, retry }: { text: string; retry: () => void }) { return <div className="rounded-2xl border border-red-500/15 p-5 text-center"><p className="text-xs font-semibold">Activity could not be loaded</p><p className="mt-1 text-[9px] text-[#757B8A]">{text}</p><button onClick={retry} className="mt-3 text-[10px] font-semibold text-violet-300">Try again</button></div>; }
