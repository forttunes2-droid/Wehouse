import { releaseRequestKey, requestKeyFor, runSafeAction } from "@/lib/safeAction";
import { useMessagePins } from "@/hooks/useMessagePins";
import PinnedMessagesBar, { scrollToMessage } from "@/components/PinnedMessagesBar";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic } from "lucide-react";
import SecureChatOnboarding from "@/components/SecureChatOnboarding";
import ReportDialog from "@/components/ReportDialog";
import RoommateBubble from "@/components/RoommateMessageBubble";
import { WorkerDraftAttachment } from "@/components/WorkerShareCard";
import { pendingWorkerShare, clearWorkerShare, workerShareMessage, type SharedWorker } from "@/lib/workerShare";
import MessageActionSheet from "@/components/MessageActionSheet";
import ChatAttachmentPicker from "@/components/ChatAttachmentPicker";
import VoiceRecorderPanel from "@/components/VoiceRecorderPanel";
import { PendingMessageMedia } from "@/components/MessageMedia";
import useVoiceRecorder from "@/hooks/useVoiceRecorder";
import { isSelectableChatAttachment, validateChatUpload, CHAT_MEDIA_ONLY_MESSAGE, type ChatAttachmentSource } from "@/lib/chatMediaPolicy";
import { decryptPrivateMessage, encryptPrivateMessage, privateConversationReadiness, type EncryptedAttachment, type PrivateConversationReadiness } from "@/lib/e2ee";
import type { MessageMenuAnchor } from "@/lib/messageMenuPosition";
import {
  getCompanionEncryptedMessages, blockFriend, friendlyFriendMessage, sendCompanionEncryptedMessage,
  uploadFriendChatAttachment, openFriendChatAttachment, reactToFriendMessage, deleteFriendMessageForMe, type Companion,
} from "@/lib/supabase/companions";

const MAX_FILES = 6;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
type Line = {
  id: string; sender_id: string; content: string; created_at: string; seen: boolean;
  attachments: string[]; attachment_types: string[]; reply_to_id: string | null;
  reactions: Record<string, string>; media_error?: boolean;
};

export default function CompanionChat({ companion, myUserId, onClose, onNavigate }: { companion: Companion; myUserId: string; onClose: () => void; onNavigate?: (page: string, id?: string) => void }) {
  const name = companion.full_name || companion.username || "Friend";
  const [readiness, setReadiness] = useState<PrivateConversationReadiness | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [workerDraft, setWorkerDraft] = useState<SharedWorker | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [replyingTo, setReplyingTo] = useState<Line | null>(null);
  const [actions, setActions] = useState<{ line: Line; mode: "reactions" | "actions"; anchor: MessageMenuAnchor } | null>(null);
  const [busy, setBusy] = useState(false);
  const pins = useMessagePins("friend", companion.companion_id, lines.length);
  const [reporting, setReporting] = useState(false);
  const [info, setInfo] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const voice = useVoiceRecorder();
  const media = useRef(new Map<string, { url: string; type: string }>());
  const blocked = companion.status === "blocked";

  useEffect(() => { setWorkerDraft(pendingWorkerShare(myUserId, companion.companion_id)); }, [myUserId, companion.companion_id]);

  useEffect(() => { const cache = media.current; return () => { for (const item of cache.values()) URL.revokeObjectURL(item.url); cache.clear(); }; }, []);

  const load = useCallback(async () => {
    const state = await privateConversationReadiness("companion", companion.companion_id, companion.user_id);
    setReadiness(state);
    if (state.state !== "ready") return;
    const { messages, error } = await getCompanionEncryptedMessages(companion.companion_id);
    if (error) return toast.error(error.message || "Could not load messages");
    const decoded = await Promise.all(messages.map(async (m): Promise<Line> => {
      let content = "Message could not be decrypted on this device.";
      try { content = await decryptPrivateMessage("companion", companion.companion_id, companion.user_id, m.ciphertext, m.encryption_iv); } catch { /* keep the placeholder */ }
      const attachments: string[] = [], types: string[] = [];
      let failed = false;
      for (const item of (m.encrypted_attachments || []) as EncryptedAttachment[]) {
        let hit = media.current.get(item.path);
        if (!hit) {
          try { const clear = await openFriendChatAttachment(companion.companion_id, companion.user_id, item); hit = { url: clear.url, type: clear.type }; media.current.set(item.path, hit); } catch { failed = true; }
        }
        if (hit) { attachments.push(hit.url); types.push(hit.type); }
      }
      return { id: m.id, sender_id: m.sender_id, content, created_at: m.created_at, seen: true, attachments, attachment_types: types, reply_to_id: m.reply_to_id, reactions: m.reactions || {}, media_error: failed };
    }));
    setLines(decoded);
  }, [companion.companion_id, companion.user_id]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 8000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [lines.length]);

  async function chooseFiles(list: FileList | null, source: ChatAttachmentSource = "media") {
    if (!list) return;
    const incoming: File[] = [];
    for (const file of Array.from(list)) {
      if (!isSelectableChatAttachment(file, source)) { toast.error(file.size > MAX_FILE_SIZE ? `${file.name} is larger than 25MB` : CHAT_MEDIA_ONLY_MESSAGE); continue; }
      try { await validateChatUpload(file, false); incoming.push(file); } catch (error) { toast.error(error instanceof Error ? error.message : CHAT_MEDIA_ONLY_MESSAGE); }
    }
    if (files.length + incoming.length > MAX_FILES) toast.error("You can send up to 6 items at once");
    setFiles((current) => [...current, ...incoming].slice(0, MAX_FILES));
  }

  async function toggleVoice() {
    if (voice.recording) return voice.finish();
    if (files.length >= MAX_FILES) return toast.error("Remove an attachment before recording a voice note");
    try { await voice.start(); } catch (error) { toast.error(error instanceof Error ? error.message : "Microphone permission is required for voice notes"); }
  }

  async function send() {
    const text = draft.trim();
    if ((!text && !files.length && !workerDraft) || busy || blocked) return;
    setBusy(true);
    const queued = [...files];
    const replyId = replyingTo?.id || null;
    try {
      const content = workerDraft ? workerShareMessage(workerDraft, text) : text;
      const signature = `friend-chat:${companion.companion_id}:${content}:${queued.map((f) => `${f.name}${f.size}`).join(",")}:${replyId}`;
      await runSafeAction(signature, async () => {
        const uploaded = await Promise.all(queued.map((file) => uploadFriendChatAttachment(file, companion.companion_id, companion.user_id)));
        const failed = uploaded.find((u) => u.error || !u.attachment);
        if (failed) throw failed.error || new Error("Could not upload the attachment");
        const { ciphertext, iv } = await encryptPrivateMessage("companion", companion.companion_id, companion.user_id, content);
        const { error } = await sendCompanionEncryptedMessage(companion.companion_id, ciphertext, iv, uploaded.map((u) => u.attachment), replyId || undefined, requestKeyFor(signature));
        if (error) throw error;
        releaseRequestKey(signature);
      });
      if (workerDraft) clearWorkerShare(myUserId, companion.companion_id);
      setWorkerDraft(null); setDraft(""); setFiles([]); setReplyingTo(null);
      await load();
    } catch (error) {
      toast.error(friendlyFriendMessage(error instanceof Error ? error.message : "Message was not sent"));
    } finally { setBusy(false); }
  }

  async function react(line: Line, emoji: string) {
    const current = line.reactions[myUserId];
    const result = await reactToFriendMessage(companion.companion_id, line.id, current === emoji ? null : emoji);
    if (result.error) return toast.error(friendlyFriendMessage(result.error.message));
    setLines((all) => all.map((l) => (l.id === line.id ? { ...l, reactions: result.reactions } : l)));
  }

  async function removeForMe(line: Line) {
    const { error } = await deleteFriendMessageForMe(companion.companion_id, line.id);
    if (error) return toast.error(friendlyFriendMessage(error.message));
    setLines((all) => all.filter((l) => l.id !== line.id));
    toast.success("Deleted for you");
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Chat with ${name}`} className="fixed inset-0 z-[70] flex flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]">
      <header className="flex min-h-14 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-4">
        <button type="button" onClick={onClose} aria-label="Back" className="grid h-11 w-11 place-items-center text-xl">←</button>
        <button type="button" onClick={() => setInfo(true)} aria-label="Friend info" className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold">{name}</p><p className="text-[11px] text-[var(--wh-text-secondary)]">Friend · end-to-end encrypted</p></button>
      </header>
      <PinnedMessagesBar
        items={pins.pinned.map((id) => lines.find((l) => l.id === id)).filter((l): l is Line => Boolean(l)).map((l) => ({ id: l.id, text: l.content || (l.attachments.length ? "Attachment" : "Message") }))}
        onJump={scrollToMessage}
        onUnpin={(id) => void pins.toggle(id)}
      />
      {readiness && readiness.state !== "ready" ? (
        <div className="flex-1 overflow-y-auto p-4"><SecureChatOnboarding status={readiness} personName={name} onReady={() => void load()} /></div>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {!lines.length && <p className="text-center text-xs text-[var(--wh-text-secondary)]">No messages yet. Say hello.</p>}
            {lines.map((line) => (
              <RoommateBubble
                key={line.id}
                msg={line as never}
                mine={line.sender_id === myUserId}
                quoted={line.reply_to_id ? (lines.find((l) => l.id === line.reply_to_id) as never) : undefined}
                onOpenActions={(anchor) => setActions({ line, mode: "actions", anchor })}
                onTapReaction={(anchor) => setActions({ line, mode: "reactions", anchor })}
                onReply={() => setReplyingTo(line)}
                onOpenProperty={() => undefined}
                onOpenWorker={(id) => onNavigate?.("worker_discovery", id)}
              />
            ))}
            <div ref={bottom} />
          </div>
          <footer className="border-t border-[var(--wh-border-subtle)] p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
            {blocked ? (
              <p className="py-2 text-center text-xs text-[var(--wh-text-secondary)]">You blocked {name}. Unblock them from your Friends list to chat again.</p>
            ) : (
              <>
                {workerDraft && <WorkerDraftAttachment onRemove={() => { clearWorkerShare(myUserId, companion.companion_id); setWorkerDraft(null); }} />}
                <PendingMessageMedia files={files} onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))} />
                <VoiceRecorderPanel recording={voice.recording} seconds={voice.seconds} level={voice.level} draft={voice.draft} onCancel={voice.cancel} onFinish={voice.finish} onDiscard={voice.discard}
                  onUse={(file) => { setFiles((current) => [...current, file].slice(0, MAX_FILES)); voice.discard(); }} />
                {replyingTo && (
                  <div className="mb-2 flex items-center gap-3 rounded-2xl border-l-2 border-violet-400 bg-[var(--wh-interactive)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-violet-300">Replying to {replyingTo.sender_id === myUserId ? "yourself" : name}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--wh-text-secondary)]">{replyingTo.content || (replyingTo.attachments.length ? "Attachment" : "Message")}</p>
                    </div>
                    <button type="button" onClick={() => setReplyingTo(null)} className="grid h-8 w-8 place-items-center text-[var(--wh-text-secondary)]" aria-label="Cancel reply">×</button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <ChatAttachmentPicker onFiles={chooseFiles} disabled={busy} />
                  <button type="button" onClick={() => void toggleVoice()} aria-label={voice.recording ? "Finish voice recording" : "Record voice note"}
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${voice.recording ? "bg-red-500 text-white" : "border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"}`}><Mic size={18} aria-hidden="true" /></button>
                  <input value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 4000))} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} aria-label="Message" placeholder="Message" className="min-h-11 min-w-0 flex-1 rounded-[22px] border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-4 text-sm outline-none focus:border-violet-500/40" />
                  <button type="button" onClick={() => void send()} disabled={busy || (!draft.trim() && !files.length && !workerDraft)} aria-label="Send" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-600 text-white disabled:opacity-40">{busy ? "…" : "➤"}</button>
                </div>
              </>
            )}
          </footer>
          {actions && (
            <MessageActionSheet
              anchor={actions.anchor}
              mode={actions.mode}
              currentReaction={actions.line.reactions[myUserId] || null}
              onClose={() => setActions(null)}
              onReply={blocked ? undefined : () => { setReplyingTo(actions.line); setActions(null); }}
              onRemove={() => { const line = actions.line; setActions(null); if (window.confirm("Delete this message for you? The other person will still see it.")) void removeForMe(line); }}
              pinned={pins.pinned.includes(actions.line.id)}
              onPin={() => { const id = actions.line.id; setActions(null); void pins.toggle(id); }}
              onCopy={actions.line.content ? () => { void navigator.clipboard.writeText(actions.line.content); toast.success("Message copied"); setActions(null); } : undefined}
              onReact={async (emoji) => { const line = actions.line; setActions(null); if (!blocked) await react(line, emoji); }}
            />
          )}
        </>
      )}
      {info && (
        <div role="dialog" aria-modal="true" aria-label="Friend info" className="fixed inset-0 z-[80] flex flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]">
          <header className="flex min-h-14 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-4">
            <button type="button" onClick={() => setInfo(false)} aria-label="Back to chat" className="grid h-11 w-11 place-items-center text-xl">←</button>
            <p className="text-sm font-semibold">Friend info</p>
          </header>
          <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-5 py-8 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[var(--wh-interactive)] text-2xl font-semibold">{name.slice(0, 1).toUpperCase()}</div>
            <h2 className="mt-4 text-lg font-semibold">{name}</h2>
            {companion.username && <p className="text-sm text-[var(--wh-text-secondary)]">@{companion.username}</p>}
            <p className="mt-4 text-xs leading-5 text-[var(--wh-text-secondary)]">Friends can chat privately and split a Short Let payment. Messages are end-to-end encrypted, so WeHouse cannot read them.</p>
            <div className="mt-8 space-y-2">
              <button type="button" onClick={() => { setInfo(false); setReporting(true); }} className="h-12 w-full rounded-2xl border border-[var(--wh-border-subtle)] text-[11px] font-semibold">Report</button>
              <button type="button" disabled={busy} onClick={() => {
                if (!window.confirm(`Block ${name}? They will not be able to message you or send you requests. You can unblock them anytime and your chat will still be there.`)) return;
                void runSafeAction(`friend-block:${companion.user_id}`, () => blockFriend(companion.user_id)).then((result) => {
                  if (result.error) return toast.error(friendlyFriendMessage(result.error.message));
                  toast.success("Blocked");
                  onClose();
                }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not block"));
              }} className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200">Block</button>
            </div>
          </div>
        </div>
      )}
      {reporting && <ReportDialog subjectType="companion_chat" subjectUserId={companion.user_id} subjectName={name} onClose={() => setReporting(false)} />}
    </div>
  );
}
