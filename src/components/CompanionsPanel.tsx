import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import CompanionChat from "@/components/CompanionChat";
import ReportDialog from "@/components/ReportDialog";
import { listMyCompanions, removeCompanion, respondToCompanionRequest, sendCompanionRequestByUsername, friendlyConnectionMessage, type Companion } from "@/lib/supabase/companions";

// Friends: people you already know, used for chatting and paying together. Not Roommates.
export default function CompanionsPanel({ myUserId }: { myUserId: string }) {
  const [people, setPeople] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<Companion | null>(null);
  const [report, setReport] = useState<Companion | null>(null);

  const refresh = useCallback(async () => {
    const { companions, error } = await listMyCompanions();
    if (error) toast.error("Friends could not be loaded.");
    else setPeople(companions);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const nameOf = (p: Companion) => p.full_name || p.username || "WeHouse member";
  async function run(action: () => Promise<{ error: { message?: string } | null }>, done: string) {
    setBusy(true);
    try {
      const { error } = await action();
      if (error) {
        toast.error(friendlyConnectionMessage(error.message) || "That did not work");
        return;
      }
      toast.success(done);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? friendlyConnectionMessage(error.message) : "That did not work");
    } finally {
      setBusy(false);
    }
  }
  const accepted = people.filter((p) => p.status === "accepted");
  const incoming = people.filter((p) => p.status === "pending" && !p.requested_by_me);
  const sent = people.filter((p) => p.status === "pending" && p.requested_by_me);
  const used = accepted.length + sent.length;

  return (
    <section aria-label="Friends" className="mb-6 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-bold">Friends</h2><span className="text-xs text-[var(--wh-text-secondary)]">{used} of 5 used</span></div>
      <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">People you already know. Chat privately and pay together for a Short Let or Long Let. Not the same as Roommates.</p>
      {loading && <p role="status" className="mt-3 text-sm">Loading…</p>}
      <ul className="mt-3 divide-y divide-[var(--wh-border-subtle)]">
        {incoming.map((p) => (
          <li key={p.companion_id} className="flex min-h-14 flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 break-words text-sm">{nameOf(p)} wants to be your Friend</span>
            <button type="button" disabled={busy} onClick={() => void run(() => respondToCompanionRequest(p.companion_id, true), "Friend added")} className="min-h-11 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white">Accept</button>
            <button type="button" disabled={busy} onClick={() => void run(() => respondToCompanionRequest(p.companion_id, false), "Request declined")} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-xs font-semibold">Decline</button>
          </li>
        ))}
        {accepted.map((p) => (
          <li key={p.companion_id} className="flex min-h-14 flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{nameOf(p)}</span>{p.username && <span className="block text-xs text-[var(--wh-text-secondary)]">@{p.username}</span>}</span>
            <button type="button" onClick={() => setChat(p)} className="min-h-11 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white">Chat</button>
            <button type="button" onClick={() => setReport(p)} className="min-h-11 px-2 text-xs font-semibold text-amber-200">Report</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Cancel your Friend connection with ${nameOf(p)}? You cannot add each other again for 30 days.`)) void run(() => removeCompanion(p.user_id), "Friend connection cancelled"); }} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-text-secondary)]">Cancel</button>
          </li>
        ))}
        {sent.map((p) => (
          <li key={p.companion_id} className="flex min-h-14 items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{nameOf(p)} · request sent</span>
            <button type="button" disabled={busy} onClick={() => void run(() => removeCompanion(p.user_id), "Request cancelled")} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-text-secondary)]">Cancel</button>
          </li>
        ))}
      </ul>
      {!loading && !people.length && <p className="mt-2 text-sm text-[var(--wh-text-secondary)]">No Friends yet.</p>}
      <div className="mt-3 flex items-center gap-2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Friend username" placeholder="Their WeHouse username" maxLength={40} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm" />
        <button type="button" disabled={busy || !username.trim()} onClick={() => void run(async () => { const r = await sendCompanionRequestByUsername(username.trim()); if (!r.error) setUsername(""); return r; }, "Request sent")} className="min-h-12 shrink-0 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:opacity-40">Add</button>
      </div>
      {chat && <CompanionChat companion={chat} myUserId={myUserId} onClose={() => setChat(null)} />}
      {report && <ReportDialog subjectType="companion_chat" subjectUserId={report.user_id} subjectName={nameOf(report)} onClose={() => setReport(null)} />}
    </section>
  );
}
