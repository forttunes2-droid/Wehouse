import { useEffect, useMemo, useState } from "react";
import { getStoredSessionId, supabase } from "@/lib/supabase";
import { getAnnouncementsForUser, markAnnouncementRead } from "@/lib/supabase/announcements";
import type { Profile } from "@/types";
import { toast, Toaster } from "sonner";
import { activityIsCurrent, isConversationDestination, isOrdinaryMessageEvent, longestActivityCutoff } from "@/lib/activityFeed";

type Props = { profile: Profile; onNavigate: (page: string, id?: string) => void; embedded?: boolean; onUnreadChange?: (count: number) => void };
type Activity = {
  id: string; source: "event" | "announcement"; sourceNumericId?: number; type: string;
  title: string; message: string | null; read: boolean; created_at: string;
  source_type?: string | null; source_id?: string | null; destination_route?: string | null;
  destination_params?: Record<string, unknown> | null;
};
type WorkPostConfirmation = { id:string; media_type:'image'|'video'; storage_path:string; caption:string|null; job_confirmation_status:string; url:string };
type DeviceLogin = { rowId:string; sessionId:string; device:string; os:string; browser:string; location:string; loginTime:string };
type ActivityScope = "all" | "security" | "money" | "bookings" | "updates";
const activityCache=new Map<string,Activity[]>();

export default function Notifications({ profile, onNavigate, embedded = false, onUnreadChange }: Props) {
  const cached=activityCache.get(profile.user_id);
  const [rows, setRows] = useState<Activity[]>(cached||[]), [loading, setLoading] = useState(!cached), [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [workPost, setWorkPost] = useState<WorkPostConfirmation | null>(null), [confirmBusy,setConfirmBusy]=useState(false);
  const [deviceLogin,setDeviceLogin]=useState<DeviceLogin|null>(null),[deviceBusy,setDeviceBusy]=useState(false);
  const [scope,setScope]=useState<ActivityScope>("all");

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
    for (const row of rows.filter((item)=>scope==='all'||activityScope(item)===scope)) { const day = dayLabel(row.created_at); result.set(day, [...(result.get(day) || []), row]); }
    return [...result];
  }, [rows,scope]);

  async function markRead(row:Activity){
    if(row.read)return true;
    const result=row.source==='announcement'?await markAnnouncementRead(Number(row.sourceNumericId),profile.user_id):await supabase.rpc('mark_my_notification_read',{p_notification_id:row.id.replace('event:','')});
    if(result.error){toast.error(result.error.message||'Activity could not be marked as read');return false}
    setRows(current=>current.map(item=>item.id===row.id?{...item,read:true}:item));return true;
  }

  async function open(row: Activity) {
    if(row.type==='new_device_login'){
      const decision=String(row.destination_params?.decision||'unreviewed');
      const sessionId=String(row.destination_params?.session_id||row.source_id||'');
      if(decision==='unreviewed'&&sessionId&&getStoredSessionId()!==sessionId){
        const{data:session,error:sessionError}=await supabase.from('user_sessions').select('id,device,os,browser,login_time,is_active').eq('id',sessionId).maybeSingle();
        if(sessionError||!session)return toast.error('Login details could not be loaded');
        if(!session.is_active){await markRead(row);setExpanded(current=>current===row.id?null:row.id);return}
        setExpanded(row.id);
        setDeviceLogin({rowId:row.id,sessionId,device:String(session.device||row.destination_params?.device||'Device'),os:String(session.os||row.destination_params?.os||'Unknown'),browser:String(session.browser||row.destination_params?.browser||'Unknown'),location:String(row.destination_params?.location||'Location unavailable'),loginTime:String(session.login_time||row.destination_params?.login_time||row.created_at)});return;
      }
      await markRead(row);setExpanded(current=>current===row.id?null:row.id);return;
    }
    if(!await markRead(row))return;
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
    const route = activityRoute(row), params = row.destination_params || {};
    const id = String(params.inspection_id || params.inspectionId || params.listing_id || params.listingId || params.reservation_id || params.reservationId || params.conversation_id || params.conversationId || params.contextId || params.booking_id || params.bookingId || params.worker_id || params.workerId || params.hotel_id || params.hotelId || params.sharedGroupId || row.source_id || "");
    if (route) onNavigate(route, id || undefined);
    else setExpanded((current)=>current===row.id?null:row.id);
  }

  async function answerWorkPost(confirm:boolean){
    if(!workPost)return;setConfirmBusy(true);
    const{error}=await supabase.rpc('respond_to_worker_work_post_confirmation',{p_post_id:workPost.id,p_confirm:confirm});
    setConfirmBusy(false);if(error)return toast.error(error.message);
    toast.success(confirm?'Work confirmed':'Work not confirmed');setWorkPost(null);await load(true);
  }

  async function answerDeviceLogin(wasMe:boolean):Promise<void>{
    if(!deviceLogin)return;setDeviceBusy(true);
    const{error}=await supabase.rpc('review_new_device_login',{p_session_id:deviceLogin.sessionId,p_was_me:wasMe});
    setDeviceBusy(false);if(error){toast.error(error.message||'Login notice could not be reviewed');return}
    toast.success(wasMe?'Login marked as recognized':'That device has been signed out');setDeviceLogin(null);await load(true);
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
  const content = <main className={embedded ? "py-1" : "mx-auto max-w-4xl px-4 py-5"}>{loading ? <ActivityLoading /> : error && rows.length === 0 ? <ErrorState text={error} retry={() => void load()} /> : rows.length === 0 ? <Empty /> : <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{unread>0?`${unread} new update${unread===1?'':'s'}`:'Recent activity'}</p><p className="mt-1 text-[9px] text-[#697081]">Security, money, bookings and official WeHouse updates.</p></div>{unread>0&&<button onClick={() => void markAll()} className="shrink-0 rounded-full border border-white/[.08] px-3 py-2 text-[9px] font-semibold text-violet-300">Mark read</button>}</div>
    <div className="flex gap-1.5 overflow-x-auto border-b border-white/[.06] pb-3 scrollbar-hide" aria-label="Activity categories">{activityScopes(rows).map(item=><button key={item.id} onClick={()=>setScope(item.id)} className={`shrink-0 rounded-full px-3 py-2 text-[9px] font-semibold ${scope===item.id?'bg-violet-500 text-white':'bg-white/[.04] text-[#777D8D]'}`}>{item.label}{item.count>0?` · ${item.count}`:''}</button>)}</div>
    {groups.length===0?<p className="py-12 text-center text-[10px] text-[#666C7D]">No activity in this category.</p>:groups.map(([day, items]) => <section key={day}><h2 className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#656B7C]">{day}</h2><div className="divide-y divide-white/[.055] border-y border-white/[.06]">{items.map((row) => <div key={row.id}><button onClick={() => void open(row)} className="flex min-h-20 w-full items-start gap-3 py-3 text-left">
      <span className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${row.read ? "bg-white/[.035] text-[#73798A]" : "bg-violet-500/12 text-violet-300"}`}>{icon(row.type)}</span>
      <span className="min-w-0 flex-1"><span className="mb-1 block text-[7px] font-bold uppercase tracking-[.14em] text-[#62697A]">{scopeLabel(activityScope(row))}</span><span className={`block text-xs ${row.read ? "font-medium text-[#A3A7B3]" : "font-semibold text-white"}`}>{row.title}</span>
      {row.message && <span className={`${expanded === row.id ? "whitespace-pre-wrap" : "line-clamp-2"} mt-1 block text-[10px] leading-4 text-[#717788]`}>{row.message}</span>}
      <span className="mt-2 flex items-center gap-2"><span className="text-[8px] text-[#555C6D]">{new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span className="text-[8px] font-semibold text-violet-300">{activityAction(row, expanded === row.id)}</span></span></span>{!row.read ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-400" />:<span className="mt-2 text-[#555C6D]">›</span>}
    </button>{deviceLogin?.rowId===row.id&&<DeviceLoginReview login={deviceLogin} busy={deviceBusy} answer={answerDeviceLogin}/>}</div>)}</div></section>)}
  </div>}</main>;
  const confirmation=workPost&&<div className="fixed inset-0 z-[100] flex flex-col bg-[#08090D] text-white" role="dialog" aria-modal="true" aria-label="Confirm worker Work Post"><header className="flex h-14 items-center gap-3 border-b border-white/[.08] px-3"><button onClick={()=>setWorkPost(null)} disabled={confirmBusy} className="grid h-10 w-10 place-items-center text-xl" aria-label="Close">×</button><div><p className="text-sm font-semibold">Does this show the completed work?</p><p className="text-[9px] text-[#707687]">Confirm only the work from your linked WeHouse job</p></div></header><main className="min-h-0 flex-1 overflow-y-auto"><div className="grid min-h-[52dvh] place-items-center bg-black">{workPost.media_type==='video'?<video src={workPost.url} controls playsInline className="max-h-[68dvh] w-full object-contain"/>:<img src={workPost.url} alt="Worker's linked completed work" className="max-h-[68dvh] w-full object-contain"/>}</div><div className="mx-auto max-w-xl space-y-4 p-4">{workPost.caption&&<p className="text-xs leading-5 text-[#B4B8C3]">{workPost.caption}</p>}{workPost.job_confirmation_status==='pending'?<><p className="text-[10px] leading-5 text-[#7D8393]">Yes adds the “Completed through WeHouse” badge. No keeps this as an ordinary worker post without that badge.</p><div className="grid grid-cols-2 gap-3"><button onClick={()=>void answerWorkPost(false)} disabled={confirmBusy} className="h-12 rounded-2xl border border-white/[.1] text-xs font-semibold disabled:opacity-40">No, it does not</button><button onClick={()=>void answerWorkPost(true)} disabled={confirmBusy} className="h-12 rounded-2xl bg-emerald-500 text-xs font-semibold text-[#04110B] disabled:opacity-40">{confirmBusy?'Saving…':'Yes, confirm'}</button></div></>:<p className="rounded-2xl bg-white/[.04] p-4 text-xs text-[#A5AAB6]">This confirmation has already been answered.</p>}</div></main></div>;
  if (embedded) return <><Toaster position="top-center" richColors />{content}{confirmation}</>;
  return <div className="min-h-[100dvh] bg-[#090B10] pb-28 text-white"><Toaster position="top-center" richColors /><header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl"><div className="mx-auto max-w-4xl"><p className="text-[9px] font-bold uppercase tracking-[.24em] text-violet-400">WEHOUSE</p><h1 className="mt-1 text-xl font-bold">Activity</h1><p className="mt-1 text-[10px] text-[#747A8B]">Important security, payment, booking and official updates.</p></div></header>{content}{confirmation}</div>;
}

function legacyRoute(type: string) { if (type === "roommate_interest" || type === "roommate_match" || type === "shared_home_invite" || type === "shared_home_response") return "roommate"; if (type.includes("booking") || type.includes("payment") || type.includes("inspection") || type.includes("reservation") || type.includes("shared_home")) return "my_reservations"; return ""; }
function activityRoute(row:Activity){
  const fallback=legacyRoute(row.type);
  if(isConversationDestination(row))return fallback;
  const route=String(row.destination_route||fallback||'');
  return /^(conversation|conversations|message|messages|chat)$/i.test(route)?'':route;
}
function activityAction(row: Activity, expanded: boolean) {
  if (row.source === 'announcement') return expanded ? 'Show less' : 'Read update';
  if (row.type === 'new_device_login') {const decision=String(row.destination_params?.decision||'unreviewed');return decision==='unreviewed'?'Was this you?':'View details'}
  if (row.type === 'work_post_confirmation_requested') return 'Review completed work';
  const route = activityRoute(row).toLowerCase();
  if (route.includes('propert') || route === 'detail' || route === 'listing_detail') return 'Open property record';
  if (route.includes('reservation') || route.includes('booking') || route === 'operations_inbox') return 'Open booking record';
  if (route.includes('worker')) return 'Open worker record';
  if (route.includes('roommate')) return 'Open roommate record';
  return expanded ? 'Show less' : 'View details';
}
function dayLabel(value: string) { const date = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return "Today"; if (date.toDateString() === yesterday.toDateString()) return "Yesterday"; return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }); }
function icon(type: string) { if (type === "announcement") return "W"; if (type.includes("payment")) return "₦"; if (type.includes("roommate")) return "◉"; if (type.includes("security")||type==='new_device_login') return "⌾"; if (type.includes("booking") || type.includes("reservation")) return "✓"; return "•"; }
function ActivityLoading(){return <div className="grid min-h-40 place-items-center" role="status" aria-label="Loading activity"><div className="text-center"><div className="mx-auto grid h-10 w-10 animate-pulse place-items-center rounded-2xl bg-violet-500 text-sm font-black">WH</div><p className="mt-3 text-[9px] text-[#686F80]">Loading recent activity…</p></div></div>}
function Empty() { return <div className="grid min-h-[55dvh] place-items-center text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-violet-300">✓</div><p className="mt-4 text-sm font-semibold">You’re up to date</p><p className="mt-2 max-w-xs text-[10px] leading-5 text-[#6C7282]">Nothing needs your attention right now.</p></div></div>; }
function ErrorState({ text, retry }: { text: string; retry: () => void }) { return <div className="rounded-2xl border border-red-500/15 p-5 text-center"><p className="text-xs font-semibold">Activity could not be loaded</p><p className="mt-1 text-[9px] text-[#757B8A]">{text}</p><button onClick={retry} className="mt-3 text-[10px] font-semibold text-violet-300">Try again</button></div>; }
function DeviceDetail({label,value}:{label:string;value:string}){return <div className="flex items-start justify-between gap-5"><span className="text-[9px] text-[#656C7D]">{label}</span><strong className="text-right text-[10px] font-semibold text-[#D7DAE3]">{value}</strong></div>}
function DeviceLoginReview({login,busy,answer}:{login:DeviceLogin;busy:boolean;answer:(wasMe:boolean)=>Promise<void>}){return <section className="mb-3 ml-12 border-l-2 border-violet-500/35 pl-4" aria-label="Review new login"><p className="text-xs font-semibold">Was this you?</p><p className="mt-1 text-[9px] leading-4 text-[#777D8D]">This device is already signed in after confirming the account email. If you do not recognize it, WeHouse will end that session.</p><div className="mt-3 space-y-2 border-y border-white/[.05] py-3"><DeviceDetail label="Device" value={login.device}/><DeviceDetail label="System" value={`${login.os} · ${login.browser}`}/><DeviceDetail label="Location" value={login.location}/><DeviceDetail label="Time" value={new Date(login.loginTime).toLocaleString()}/></div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={()=>void answer(false)} disabled={busy} className="min-h-11 rounded-xl border border-red-500/20 bg-red-500/[.05] px-2 text-[10px] font-semibold text-red-300 disabled:opacity-40">No, sign it out</button><button onClick={()=>void answer(true)} disabled={busy} className="min-h-11 rounded-xl bg-violet-500 px-2 text-[10px] font-semibold disabled:opacity-40">{busy?'Saving…':'Yes, this was me'}</button></div></section>}
function activityScope(row:Activity):ActivityScope{const value=`${row.type} ${row.source_type} ${row.destination_route}`.toLowerCase();if(/security|device|password|login/.test(value))return'security';if(/payment|payout|earning|refund|wallet|commission/.test(value))return'money';if(/booking|reservation|inspection|listing|property|hotel|job|worker|roommate/.test(value))return'bookings';return'updates'}
function scopeLabel(scope:ActivityScope){return scope==='money'?'Payments':scope==='bookings'?'Bookings':scope==='security'?'Security':scope==='updates'?'Updates':'All activity'}
function activityScopes(rows:Activity[]){const ids:ActivityScope[]=['all','security','money','bookings','updates'];return ids.map(id=>({id,label:scopeLabel(id),count:id==='all'?rows.length:rows.filter(row=>activityScope(row)===id).length}))}
