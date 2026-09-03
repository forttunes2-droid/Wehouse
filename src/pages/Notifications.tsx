import { useEffect, useMemo, useState } from "react";
import { getStoredSessionId, supabase } from "@/lib/supabase";
import { getAnnouncementsForUser, markAnnouncementRead } from "@/lib/supabase/announcements";
import type { Profile } from "@/types";
import { toast, Toaster } from "sonner";
import { activityIsCurrent, isOrdinaryMessageEvent, longestActivityCutoff } from "@/lib/activityFeed";

type Props = { profile: Profile; onNavigate: (page: string, id?: string) => void; embedded?: boolean; onUnreadChange?: (count: number) => void };
type Activity = {
  id: string; source: "event" | "announcement"; sourceNumericId?: number; type: string;
  title: string; message: string | null; read: boolean; created_at: string;
  source_type?: string | null; source_id?: string | null; destination_route?: string | null;
  destination_params?: Record<string, unknown> | null;
};
type WorkPostConfirmation = { id:string; media_type:'image'|'video'; storage_path:string; caption:string|null; job_confirmation_status:string; url:string };
type DeviceLogin = { sessionId:string; device:string; os:string; browser:string; loginTime:string; currentDevice:boolean };
const activityCache=new Map<string,Activity[]>();

export default function Notifications({ profile, onNavigate, embedded = false, onUnreadChange }: Props) {
  const cached=activityCache.get(profile.user_id);
  const [rows, setRows] = useState<Activity[]>(cached||[]), [loading, setLoading] = useState(!cached), [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [workPost, setWorkPost] = useState<WorkPostConfirmation | null>(null), [confirmBusy,setConfirmBusy]=useState(false);
  const [deviceLogin,setDeviceLogin]=useState<DeviceLogin|null>(null),[deviceBusy,setDeviceBusy]=useState(false);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    await supabase.rpc("prune_my_activity");
    const [eventResult, announcementResult] = await Promise.all([
      supabase.from("notifications").select("id,type,title,message,read,created_at,source_type,source_id,destination_route,destination_params").eq("recipient_id", profile.user_id).gte("created_at", longestActivityCutoff()).order("created_at", { ascending: false }).limit(100),
      getAnnouncementsForUser(profile.user_id),
    ]);
    const failures = [eventResult.error?.message, announcementResult.error?.message].filter(Boolean) as string[];
    if (failures.length === 2) setError(failures.join(" · "));
    else {
      const events = ((eventResult.data || []) as Omit<Activity, "source">[])
        .filter((row) => !isOrdinaryMessageEvent(row) && activityIsCurrent({ ...row, source: "event" }))
        .map((row) => ({ ...row, id: `event:${row.id}`, source: "event" as const }));
      const announcements = (announcementResult.messages || []).map((delivery: any) => {
        const announcement = Array.isArray(delivery.announcements) ? delivery.announcements[0] : delivery.announcement || delivery.message;
        return { id: `announcement:${delivery.announcement_id}`, sourceNumericId: Number(delivery.announcement_id), source: "announcement" as const, type: "announcement", title: announcement?.title || "WeHouse announcement", message: announcement?.content || null, read: Boolean(delivery.read_status), created_at: announcement?.created_at || delivery.delivered_at };
      });
      const next=[...events, ...announcements.filter((row) => activityIsCurrent(row))].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
    if(row.type==='work_post_confirmation_requested'){
      const postId=String(row.destination_params?.work_post_id||row.source_id||'');
      if(!postId)return toast.error('Work Post reference is missing');
      const{data,error}=await supabase.from('worker_showcase_posts').select('id,media_type,storage_path,caption,job_confirmation_status').eq('id',postId).maybeSingle();
      if(error||!data)return toast.error(error?.message||'Work Post could not be loaded');
      const signed=await supabase.storage.from('worker-showcase').createSignedUrl(data.storage_path,900);
      if(signed.error||!signed.data?.signedUrl)return toast.error(signed.error?.message||'Work Post media could not be opened');
      setWorkPost({...data,url:signed.data.signedUrl} as WorkPostConfirmation);return;
    }
    if(row.type==='new_device_login'){
      const sessionId=String(row.destination_params?.session_id||row.source_id||'');
      if(!sessionId)return toast.error('Device session reference is missing');
      setDeviceLogin({sessionId,device:String(row.destination_params?.device||'Device'),os:String(row.destination_params?.os||'Unknown'),browser:String(row.destination_params?.browser||'Unknown'),loginTime:String(row.destination_params?.login_time||row.created_at),currentDevice:getStoredSessionId()===sessionId});return;
    }
    const route = row.destination_route || legacyRoute(row.type), params = row.destination_params || {};
    const id = String(params.listing_id || params.listingId || params.conversation_id || params.conversationId || params.contextId || params.booking_id || params.bookingId || params.sharedGroupId || row.source_id || "");
    if (route) onNavigate(route, id || undefined);
  }

  async function answerWorkPost(confirm:boolean){
    if(!workPost)return;setConfirmBusy(true);
    const{error}=await supabase.rpc('respond_to_worker_work_post_confirmation',{p_post_id:workPost.id,p_confirm:confirm});
    setConfirmBusy(false);if(error)return toast.error(error.message);
    toast.success(confirm?'Work confirmed':'Work not confirmed');setWorkPost(null);await load(true);
  }

  async function answerDeviceLogin(approved:boolean){
    if(!deviceLogin)return;setDeviceBusy(true);
    const{error}=await supabase.rpc('respond_to_device_login',{p_session_id:deviceLogin.sessionId,p_approved:approved});
    setDeviceBusy(false);if(error)return toast.error(error.message||'Device login could not be reviewed');
    toast.success(approved?'Device confirmed':'Device access rejected');setDeviceLogin(null);await load(true);
  }

  async function markAll() {
    const unreadAnnouncements = rows.filter((row) => !row.read && row.source === "announcement");
    const [{ error: eventError }, announcementResults] = await Promise.all([supabase.rpc("mark_all_my_notifications_read"), Promise.all(unreadAnnouncements.map((row) => markAnnouncementRead(Number(row.sourceNumericId), profile.user_id)))]);
    const announcementError = announcementResults.find((result) => result.error)?.error;
    if (eventError || announcementError) return toast.error(eventError?.message || announcementError?.message || "Activity could not be marked as read");
    setRows((current) => current.map((row) => ({ ...row, read: true }))); toast.success("Activity marked as read");
  }

  const unread = rows.filter((row) => !row.read).length;
  useEffect(() => { onUnreadChange?.(unread); }, [onUnreadChange, unread]);
  const content = <main className={embedded ? "py-4" : "mx-auto max-w-4xl px-4 py-5"}><p className="mb-4 text-[9px] leading-5 text-[#646B7C]">Activity keeps recent alerts for quick action. The permanent property, booking and conversation records stay in their own work areas.</p>{loading ? <ActivityLoading /> : error && rows.length === 0 ? <ErrorState text={error} retry={() => void load()} /> : rows.length === 0 ? <Empty /> : <div className="space-y-7">
    {unread > 0 && <div className="flex justify-end"><button onClick={() => void markAll()} className="rounded-full border border-white/[.08] px-3 py-2 text-[9px] font-semibold text-violet-300">Mark all read</button></div>}
    {groups.map(([day, items]) => <section key={day}><h2 className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#656B7C]">{day}</h2><div className="divide-y divide-white/[.055] border-y border-white/[.06]">{items.map((row) => <button key={row.id} onClick={() => void open(row)} className="flex min-h-20 w-full items-start gap-3 py-3 text-left">
      <span className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${row.read ? "bg-white/[.035] text-[#73798A]" : "bg-violet-500/12 text-violet-300"}`}>{icon(row.type)}</span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={`block min-w-0 flex-1 text-xs ${row.read ? "font-medium text-[#A3A7B3]" : "font-semibold text-white"}`}>{row.title}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[7px] font-semibold ${activitySection(row)==='Official'?'bg-violet-500/10 text-violet-300':activitySection(row)==='Needs attention'?'bg-amber-500/10 text-amber-300':'bg-white/[.045] text-[#7D8393]'}`}>{activitySection(row).toUpperCase()}</span></span>
      {row.message && <span className={`${expanded === row.id ? "whitespace-pre-wrap" : "line-clamp-2"} mt-1 block text-[10px] leading-4 text-[#717788]`}>{row.message}</span>}
      <span className="mt-1.5 block text-[8px] text-[#555C6D]">{new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{row.source === "announcement" ? expanded === row.id ? " · Show less" : " · Read update" : row.destination_route || legacyRoute(row.type) ? " · Open details" : ""}</span></span>{!row.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-400" />}
    </button>)}</div></section>)}
  </div>}</main>;
  const confirmation=workPost&&<div className="fixed inset-0 z-[100] flex flex-col bg-[#08090D] text-white" role="dialog" aria-modal="true" aria-label="Confirm worker Work Post"><header className="flex h-14 items-center gap-3 border-b border-white/[.08] px-3"><button onClick={()=>setWorkPost(null)} disabled={confirmBusy} className="grid h-10 w-10 place-items-center text-xl" aria-label="Close">×</button><div><p className="text-sm font-semibold">Does this show the completed work?</p><p className="text-[9px] text-[#707687]">Confirm only the work from your linked WeHouse job</p></div></header><main className="min-h-0 flex-1 overflow-y-auto"><div className="grid min-h-[52dvh] place-items-center bg-black">{workPost.media_type==='video'?<video src={workPost.url} controls playsInline className="max-h-[68dvh] w-full object-contain"/>:<img src={workPost.url} alt="Worker's linked completed work" className="max-h-[68dvh] w-full object-contain"/>}</div><div className="mx-auto max-w-xl space-y-4 p-4">{workPost.caption&&<p className="text-xs leading-5 text-[#B4B8C3]">{workPost.caption}</p>}{workPost.job_confirmation_status==='pending'?<><p className="text-[10px] leading-5 text-[#7D8393]">Yes adds the “Completed through WeHouse” badge. No keeps this as an ordinary worker post without that badge.</p><div className="grid grid-cols-2 gap-3"><button onClick={()=>void answerWorkPost(false)} disabled={confirmBusy} className="h-12 rounded-2xl border border-white/[.1] text-xs font-semibold disabled:opacity-40">No, it does not</button><button onClick={()=>void answerWorkPost(true)} disabled={confirmBusy} className="h-12 rounded-2xl bg-emerald-500 text-xs font-semibold text-[#04110B] disabled:opacity-40">{confirmBusy?'Saving…':'Yes, confirm'}</button></div></>:<p className="rounded-2xl bg-white/[.04] p-4 text-xs text-[#A5AAB6]">This confirmation has already been answered.</p>}</div></main></div>;
  const deviceConfirmation=deviceLogin&&<div className="fixed inset-0 z-[110] grid place-items-end bg-black/70 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Review new device login"><section className="w-full rounded-t-[28px] border border-white/[.08] bg-[#10131B] p-5 text-white shadow-2xl sm:max-w-md sm:rounded-[28px]"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">Security</p><h2 className="mt-2 text-lg font-bold">Was this you?</h2></div><button onClick={()=>setDeviceLogin(null)} disabled={deviceBusy} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-lg" aria-label="Close">×</button></div><div className="mt-5 border-y border-white/[.07] py-4"><p className="text-sm font-semibold">{deviceLogin.device}</p><p className="mt-1 text-[10px] text-[#7B8191]">{deviceLogin.os} · {deviceLogin.browser}</p><p className="mt-2 text-[9px] text-[#5F6676]">{new Date(deviceLogin.loginTime).toLocaleString()}</p></div>{deviceLogin.currentDevice?<p className="mt-4 rounded-2xl bg-amber-500/[.07] p-4 text-[10px] leading-5 text-amber-200">For your protection, this new device cannot approve itself. Open WeHouse on one of your other trusted devices.</p>:<div className="mt-5 grid grid-cols-2 gap-3"><button onClick={()=>void answerDeviceLogin(false)} disabled={deviceBusy} className="h-12 rounded-2xl border border-red-500/20 bg-red-500/[.06] text-xs font-semibold text-red-300 disabled:opacity-40">No, it’s not me</button><button onClick={()=>void answerDeviceLogin(true)} disabled={deviceBusy} className="h-12 rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{deviceBusy?'Saving…':'Yes, it’s me'}</button></div>}</section></div>;
  if (embedded) return <><Toaster position="top-center" richColors />{content}{confirmation}{deviceConfirmation}</>;
  return <div className="min-h-[100dvh] bg-[#090B10] pb-28 text-white"><Toaster position="top-center" richColors /><header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl"><div className="mx-auto max-w-4xl"><p className="text-[9px] font-bold uppercase tracking-[.24em] text-violet-400">WEHOUSE</p><h1 className="mt-1 text-xl font-bold">Activity</h1><p className="mt-1 text-[10px] text-[#747A8B]">Lifecycle, payment, security and official updates linked to their source.</p></div></header>{content}{confirmation}{deviceConfirmation}</div>;
}

function activitySection(row:Activity){if(row.source==='announcement')return'Official';return /(required|request|confirmation|pending|failed|declined|cancel|security|dispute|price|action)/i.test(row.type)?'Needs attention':'Update'}
function legacyRoute(type: string) { if (type === "roommate_interest" || type === "shared_home_invite" || type === "shared_home_response") return "roommate"; if (type === "roommate_match" || type === "missed_call") return "conversation"; if (type.includes("booking") || type.includes("payment") || type.includes("inspection") || type.includes("reservation") || type.includes("shared_home")) return "my_reservations"; return ""; }
function dayLabel(value: string) { const date = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return "Today"; if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }); }
function icon(type: string) { if (type === "announcement") return "W"; if (type.includes("payment")) return "₦"; if (type.includes("roommate")) return "◉"; if (type.includes("security")) return "⌾"; if (type.includes("booking") || type.includes("reservation")) return "✓"; return "•"; }
function ActivityLoading(){return <div className="grid min-h-40 place-items-center" role="status" aria-label="Loading activity"><div className="text-center"><div className="mx-auto grid h-10 w-10 animate-pulse place-items-center rounded-2xl bg-violet-500 text-sm font-black">WH</div><p className="mt-3 text-[9px] text-[#686F80]">Loading recent activity…</p></div></div>}
function Empty() { return <div className="grid min-h-[55dvh] place-items-center text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-violet-300">✓</div><p className="mt-4 text-sm font-semibold">You’re up to date</p><p className="mt-2 max-w-xs text-[10px] leading-5 text-[#6C7282]">Nothing needs your attention right now.</p></div></div>; }
function ErrorState({ text, retry }: { text: string; retry: () => void }) { return <div className="rounded-2xl border border-red-500/15 p-5 text-center"><p className="text-xs font-semibold">Activity could not be loaded</p><p className="mt-1 text-[9px] text-[#757B8A]">{text}</p><button onClick={retry} className="mt-3 text-[10px] font-semibold text-violet-300">Try again</button></div>; }
