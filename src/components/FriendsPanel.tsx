import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import { runSafeAction } from "@/lib/safeAction";
import { useCallback, useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { toast } from "sonner";
import FriendChat from "@/components/FriendChat";
import ReportDialog from "@/components/ReportDialog";
import { blockFriend, unblockFriend, listMyFriends, removeFriend, respondToFriendRequest, previewFriendRecipient, sendFriendRequest, type FriendRecipient, type Friend } from "@/lib/supabase/friends";

// Friends: people you already know, used for chatting and paying together. Not Roommates.
type FriendsPanelProps = { myUserId: string; initialChatId?: string | null; onInitialChatOpened?: () => void; onNavigate?: (page: string, id?: string) => void };
export default function FriendsPanel(props: FriendsPanelProps) {
  return <FriendsPanelContent key={props.myUserId} {...props} />;
}
function FriendsPanelContent({ myUserId, initialChatId, onInitialChatOpened, onNavigate }: FriendsPanelProps) {
  const [people, setPeople] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [recipient, setRecipient] = useState<FriendRecipient | null>(null);
  const lookupGeneration = useRef(0);
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<Friend | null>(null);
  const [report, setReport] = useState<Friend | null>(null);

  const refresh = useCallback(async () => {
    const { friends, error } = await listMyFriends();
    if (error) toast.error("Friends could not be loaded.");
    else setPeople(friends);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (loading || !initialChatId) return;
    const target = people.find(person => person.friend_id === initialChatId && person.status === "accepted");
    if (target) { setChat(target); onInitialChatOpened?.(); }
  }, [initialChatId, loading, onInitialChatOpened, people]);

  const nameOf = (p: Friend) => p.full_name || p.username || "WeHouse member";
  async function run(action: () => Promise<{ error: { message?: string } | null }>, done: string) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      const { error } = await runSafeAction(`friend-panel:${done}`, action);
      if (error) {
        toast.error(error.message || "That did not work");
        return;
      }
      toast.success(done);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => () => { lookupGeneration.current++; }, [myUserId]);
  async function preview() {
    if (actionLock.current) return;
    actionLock.current = true;
    const generation = ++lookupGeneration.current;
    setBusy(true); setRecipient(null);
    try {
      const result = await withTimeout(previewFriendRecipient(username.trim()), 10000, "Finding this person took too long. Try again.");
      if (generation !== lookupGeneration.current) return;
      if (result.error) toast.error(result.error.message);
      else setRecipient(result.recipient);
    } catch (error) {
      if (generation === lookupGeneration.current) toast.error(error instanceof Error ? error.message : "Could not find this person");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  const accepted = people.filter((p) => p.status === "accepted");
  const incoming = people.filter((p) => p.status === "pending" && !p.requested_by_me);
  const sent = people.filter((p) => p.status === "pending" && p.requested_by_me);
  const blocked = people.filter((p) => p.status === "blocked");
  const used = accepted.length + sent.length;

  return (
    <section aria-label="Friends" className="mb-6 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-bold">Friends</h2><span className="text-xs text-[var(--wh-text-secondary)]">{used} of 5 used</span></div>
      <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">People you already know. Chat privately and pay together for a Short Let or Long Let. Not the same as Roommates.</p>
      {loading && <WeHouseLoadingState compact label="Loading" />}
      <ul className="mt-3 divide-y divide-[var(--wh-border-subtle)]">
        {incoming.map((p) => (
          <li key={p.friend_id} className="flex min-h-14 flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 break-words text-sm">{nameOf(p)} wants to be your Friend</span>
            <button type="button" disabled={busy} onClick={() => void run(() => respondToFriendRequest(p.friend_id, true), "Friend added")} className="min-h-11 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white">Accept</button>
            <button type="button" disabled={busy} onClick={() => void run(() => respondToFriendRequest(p.friend_id, false), "Request declined")} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-xs font-semibold">Decline</button>
          </li>
        ))}
        {accepted.map((p) => (
          <li key={p.friend_id} className="flex min-h-14 flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{nameOf(p)}</span>{p.username && <span className="block text-xs text-[var(--wh-text-secondary)]">@{p.username}</span>}</span>
            <button type="button" onClick={() => setChat(p)} className="min-h-11 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white">Chat</button>
            <button type="button" onClick={() => setReport(p)} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-danger-text)]">Report</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Block ${nameOf(p)}? They will not be able to message you or send you requests. You can unblock them anytime and your chat will still be there.`)) void run(() => blockFriend(p.user_id), "Blocked"); }} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-text-secondary)]">Block</button>
          </li>
        ))}
        {sent.map((p) => (
          <li key={p.friend_id} className="flex min-h-14 items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{nameOf(p)} · request sent</span>
            <button type="button" disabled={busy} onClick={() => void run(() => removeFriend(p.user_id), "Request cancelled")} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-text-secondary)]">Cancel</button>
          </li>
        ))}
        {blocked.map((p) => (
          <li key={p.friend_id} className="flex min-h-14 items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{nameOf(p)} · blocked</span>
            <button type="button" disabled={busy} onClick={() => void run(() => unblockFriend(p.user_id), "Unblocked")} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-text-primary)]">Unblock</button>
          </li>
        ))}
      </ul>
      {!loading && !people.length && <p className="mt-2 text-sm text-[var(--wh-text-secondary)]">No Friends yet.</p>}
      <div className="mt-3 flex items-center gap-2">
        <input value={username} disabled={busy} onChange={(e) => { lookupGeneration.current++; setRecipient(null); setUsername(e.target.value); }} aria-label="Friend username" placeholder="Their WeHouse username" maxLength={40} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm" />
        <button type="button" disabled={busy || !username.trim()} onClick={() => void preview()} className="min-h-12 shrink-0 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:opacity-40">Find person</button>
      </div>
      {recipient && <div className="mt-3 rounded-xl border border-[var(--wh-border-subtle)] p-3" aria-label="Confirm Friend request">
        <p className="break-words text-sm font-semibold">{recipient.full_name || recipient.username}</p>
        <p className="break-words text-xs text-[var(--wh-text-secondary)]">@{recipient.username}</p>
        <p className="mt-2 text-xs text-[var(--wh-text-secondary)]">Is this the person you know? They must accept before you can chat.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await sendFriendRequest(recipient.user_id); if (!result.error) { setRecipient(null); setUsername(""); } return result; }, "Friend request confirmed")} className="min-h-11 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-40">Send Friend request</button>
          <button type="button" disabled={busy} onClick={() => setRecipient(null)} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm">Cancel</button>
        </div>
      </div>}
      {chat && <FriendChat key={`${myUserId}:${chat.friend_id}`} friend={chat} myUserId={myUserId} onClose={() => setChat(null)} onNavigate={onNavigate} />}
      {report && <ReportDialog subjectType="friend_chat" subjectUserId={report.user_id} subjectName={nameOf(report)} onClose={() => setReport(null)} />}
    </section>
  );
}
