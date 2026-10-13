import { runSafeAction } from "@/lib/safeAction";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import SecureChatOnboarding from "@/components/SecureChatOnboarding";
import ReportDialog from "@/components/ReportDialog";
import { decryptPrivateMessage, encryptPrivateMessage, privateConversationReadiness, type PrivateConversationReadiness } from "@/lib/e2ee";
import { getCompanionEncryptedMessages, sendCompanionEncryptedMessage, type Companion } from "@/lib/supabase/companions";

type Line = { id: string; mine: boolean; text: string; at: string };

export default function CompanionChat({ companion, myUserId, onClose }: { companion: Companion; myUserId: string; onClose: () => void }) {
  const name = companion.full_name || companion.username || "Friend";
  const [readiness, setReadiness] = useState<PrivateConversationReadiness | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const state = await privateConversationReadiness("companion", companion.companion_id, companion.user_id);
    setReadiness(state);
    if (state.state !== "ready") return;
    const { messages, error } = await getCompanionEncryptedMessages(companion.companion_id);
    if (error) return toast.error(error.message || "Could not load messages");
    const decoded = await Promise.all(messages.map(async (m) => {
      let text = "Message could not be decrypted on this device.";
      try { text = await decryptPrivateMessage("companion", companion.companion_id, companion.user_id, m.ciphertext, m.encryption_iv); } catch { /* keep the placeholder */ }
      return { id: m.id, mine: m.sender_id === myUserId, text, at: m.created_at };
    }));
    setLines(decoded);
  }, [companion.companion_id, companion.user_id, myUserId]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 8000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [lines.length]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await runSafeAction(`friend-chat:${companion.companion_id}:${text}`, async () => {
        const { ciphertext, iv } = await encryptPrivateMessage("companion", companion.companion_id, companion.user_id, text);
        const { error } = await sendCompanionEncryptedMessage(companion.companion_id, ciphertext, iv);
        if (error) throw error;
      });
      setDraft("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message was not sent");
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Chat with ${name}`} className="fixed inset-0 z-[70] flex flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]">
      <header className="flex min-h-14 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-4">
        <button type="button" onClick={onClose} aria-label="Back" className="grid h-11 w-11 place-items-center text-xl">←</button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{name}</p><p className="text-[11px] text-[var(--wh-text-secondary)]">Friend · end-to-end encrypted</p></div>
        <button type="button" onClick={() => setReporting(true)} className="min-h-11 px-3 text-xs font-semibold text-amber-200">Report</button>
      </header>
      {readiness && readiness.state !== "ready" ? (
        <div className="flex-1 overflow-y-auto p-4"><SecureChatOnboarding status={readiness} personName={name} onReady={() => void load()} /></div>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {!lines.length && <p className="text-center text-xs text-[var(--wh-text-secondary)]">No messages yet. Say hello.</p>}
            {lines.map((line) => (
              <div key={line.id} className={`flex ${line.mine ? "justify-end" : "justify-start"}`}>
                <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${line.mine ? "bg-violet-600 text-white" : "bg-[var(--wh-interactive)]"}`}>{line.text}</p>
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <footer className="flex items-center gap-2 border-t border-[var(--wh-border-subtle)] p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
            <input value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 4000))} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} aria-label="Message" placeholder="Message" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm" />
            <button type="button" onClick={() => void send()} disabled={busy || !draft.trim()} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">Send</button>
          </footer>
        </>
      )}
      {reporting && <ReportDialog subjectType="companion_chat" subjectUserId={companion.user_id} subjectName={name} onClose={() => setReporting(false)} />}
    </div>
  );
}
