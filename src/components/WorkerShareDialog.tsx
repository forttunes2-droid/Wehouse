import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import { ChevronRight, Search, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRoommateConversationPeople } from "@/lib/supabase/chat";
import { selectRoommateRecipientsFromPeers, type RoommateRecipient } from "@/lib/roommateRecipients";
import { queueWorkerShare, type SharedWorker } from "@/lib/workerShare";
import { clearPropertyShare } from "@/lib/propertyShare";
import { listMyFriends, type Friend } from "@/lib/supabase/friends";
import { withTimeout } from "@/lib/withTimeout";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import BackButton from "@/components/BackButton";
import { toast } from "sonner";

type Props = { userId: string; worker: SharedWorker; workerName: string; onClose: () => void; onConversation: (id: string) => void; onFriendConversation?: (id: string) => void };
export default function WorkerShareDialog({ userId, worker, workerName, onClose, onConversation, onFriendConversation }: Props) {
  const activity=worker.kind==='experience';
  const [recipients, setRecipients] = useState<RoommateRecipient[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [audience, setAudience] = useState<"roommates" | "friends">("roommates");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [query, setQuery] = useState("");
  const destination=useRef<(()=>void)|null>(null);
  const dismiss = useRecordScreenBack(()=>{const next=destination.current;destination.current=null;onClose();next?.();});
  const dialogRef = useDialogInteraction(dismiss);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setRecipients([]); setFriends([]);
    void (async () => {
      try {
        if (audience === "friends") {
          const friendResult = await withTimeout(listMyFriends(), 15000, "Friends took too long to load.");
          if (!active) return;
          if (friendResult.error) throw friendResult.error;
          setFriends(friendResult.friends.filter(friend => friend.status === "accepted" && friend.user_id !== userId));
          return;
        }
        const result = await withTimeout(getRoommateConversationPeople(), 15000, "Roommates took too long to load.");
        if (!active) return;
        if (result.error) throw result.error;
        setRecipients(selectRoommateRecipientsFromPeers(userId, result.connections));
      } catch { if (active) setError("Your connections could not be loaded. Please try again."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [userId, attempt, audience]);
  const visible = recipients.filter(person => `${person.name} ${person.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleFriends = friends.filter(friend => `${friend.full_name || ""} ${friend.username || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(<div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100060] flex items-end justify-center bg-[var(--wh-overlay)] sm:items-center sm:p-5" role="presentation" onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <section role="dialog" aria-modal="true" aria-label={activity?'Share activity':'Share Service Worker profile'} className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[var(--wh-border)] bg-[var(--wh-surface)] text-[var(--wh-text)] shadow-[var(--wh-shadow-md)] sm:max-h-[90dvh] sm:rounded-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-4 py-3"><BackButton onClick={dismiss} ariaLabel={activity?'Back to activity':'Back to Service Worker profile'} /><div><h2 className="text-lg font-semibold">{activity?'Share this activity':'Recommend this Service Worker'}</h2><p className="text-xs text-[var(--wh-text-secondary)]">Choose a connection to prepare a message in chat.</p></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">
        <div className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4"><p className="text-xs font-semibold text-[var(--wh-accent-text)]">{activity?'Activity':'Service Worker profile'}</p><p className="mt-1 text-sm font-semibold">{workerName}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{activity?'The recipient can check current dates and prices. Sharing does not book a place or request payment.':'The recipient can open the public profile and make their own service request.'}</p></div>
        <section className="mt-5" aria-label="Send in WeHouse"><h3 className="flex items-center gap-2 text-sm font-semibold"><Users size={17} aria-hidden="true" className="text-[var(--wh-accent-text)]" />Send in WeHouse</h3>
          <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" aria-pressed={audience === "roommates"} onClick={() => { if (audience !== "roommates") { setLoading(true); setQuery(""); setAudience("roommates"); } }} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${audience === "roommates" ? "bg-violet-600 text-white" : "border border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}>Roommates</button><button type="button" aria-pressed={audience === "friends"} onClick={() => { if (audience !== "friends") { setLoading(true); setQuery(""); setAudience("friends"); } }} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${audience === "friends" ? "bg-violet-600 text-white" : "border border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]"}`}>Friends</button></div>
          <label className="mt-3 block"><span className="sr-only">Search your connections</span><span className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3"><Search size={18} aria-hidden="true" className="shrink-0 text-[var(--wh-text-secondary)]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search connections" className="min-w-0 flex-1 bg-transparent py-3 text-base text-[var(--wh-text)] outline-none placeholder:text-[var(--wh-text-muted)]" /></span></label>
          {loading ? <WeHouseLoadingState compact label="Loading your connections" /> : <>
            {error && <div role="alert" className="py-4 text-sm text-[var(--wh-text-secondary)]"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 font-semibold text-[var(--wh-accent-text)]">Refresh connections</button></div>}
            {audience === "roommates" ? <div className="mt-3 divide-y divide-[var(--wh-border-subtle)]">{visible.map(person => <button key={person.userId} type="button" onClick={() => { try { queueWorkerShare(userId, person.conversationId, worker); clearPropertyShare(userId, person.conversationId); destination.current=()=>onConversation(person.conversationId); dismiss(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "The profile could not be shared."); } }} className="flex min-h-16 w-full items-center gap-3 py-3 text-left"><span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-semibold text-[var(--wh-accent-text)]">{person.avatar ? <img src={person.avatar} alt="" className="h-full w-full object-cover" /> : person.name[0]?.toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold">{person.name}</span>{person.username && <span className="mt-1 block break-words text-sm text-[var(--wh-text-secondary)]">@{person.username}</span>}</span><ChevronRight size={18} aria-hidden="true" className="shrink-0 text-[var(--wh-accent-text)]" /></button>)}</div> : <div className="mt-3 divide-y divide-[var(--wh-border-subtle)]">{visibleFriends.map(friend => <button key={friend.friend_id} type="button" disabled={!onFriendConversation} onClick={() => { try { if (!onFriendConversation) return; queueWorkerShare(userId, friend.friend_id, worker); clearPropertyShare(userId, friend.friend_id); destination.current=()=>onFriendConversation(friend.friend_id); dismiss(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "The profile could not be shared."); } }} className="flex min-h-16 w-full items-center gap-3 py-3 text-left disabled:opacity-50"><span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-semibold text-[var(--wh-accent-text)]">{(friend.full_name || friend.username || "F")[0]?.toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold">{friend.full_name || friend.username || "Friend"}</span>{friend.username && <span className="mt-1 block break-words text-sm text-[var(--wh-text-secondary)]">@{friend.username}</span>}</span><ChevronRight size={18} aria-hidden="true" className="shrink-0 text-[var(--wh-accent-text)]" /></button>)}</div>}
            {audience === "roommates" && !visible.length && !error && <p className="py-8 text-sm leading-6 text-[var(--wh-text-secondary)]">{query.trim() ? "No Roommates match that name." : "No accepted Roommates yet."}</p>}
            {audience === "friends" && !visibleFriends.length && !error && <p className="py-8 text-sm leading-6 text-[var(--wh-text-secondary)]">{query.trim() ? "No Friends match that name." : "No accepted Friends yet."}</p>}
          </>}
        </section>
      </div>
    </section>
  </div>, document.body);
}
