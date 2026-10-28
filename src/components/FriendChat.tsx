import { PropertyDraftAttachment } from '@/components/SharedPropertyCard';
import { pendingPropertyShare, clearPropertyShare, propertyShareMessage, type SharedProperty } from '@/lib/propertyShare';
import { releaseRequestKey, requestKeyFor, runSafeAction } from "@/lib/safeAction";
import { useMessagePins } from "@/hooks/useMessagePins";
import { createFriendPlanMessage } from "@/lib/friendPlans";
import PinnedMessagesBar, { scrollToMessage } from "@/components/PinnedMessagesBar";
import { useCallback, useEffect, useRef, useState } from "react";
import {createRefreshScheduler} from '@/lib/refreshScheduler';
import {subscribeToFriendChatChanges} from '@/lib/friendChatLive';
import {withTimeout} from '@/lib/withTimeout';
import { toast } from "sonner";
import { CalendarPlus, Mic } from "lucide-react";
import SecureChatOnboarding from "@/components/SecureChatOnboarding";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
  getFriendEncryptedMessages, getFriendMessageHistoryCursor, blockFriend, sendFriendEncryptedMessage,
  uploadFriendChatAttachment, openFriendChatAttachment, reactToFriendMessage, deleteFriendMessageForMe, type Friend, type FriendMessageCursor,
} from "@/lib/supabase/friends";

const MAX_FILES = 6;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
type Line = {
  id: string; sender_id: string; content: string; created_at: string; seen: boolean;
  attachments: string[]; attachment_types: string[]; reply_to_id: string | null;
  reactions: Record<string, string>; media_error?: boolean;
  private_attachment_refs?: EncryptedAttachment[]; media_pending?: boolean;
};

export default function FriendChat({ friend, myUserId, onClose, onNavigate }: { friend: Friend; myUserId: string; onClose: () => void; onNavigate: (page: string, id?: string) => void }) {
  return <FriendConversation key={`${myUserId}:${friend.friend_id}`} friend={friend} myUserId={myUserId} onClose={onClose} onNavigate={onNavigate}/>;
}
function FriendConversation({ friend, myUserId, onClose, onNavigate }: { friend: Friend; myUserId: string; onClose: () => void; onNavigate: (page: string, id?: string) => void }) {
  const name = friend.full_name || friend.username || "Friend";
  const [readiness, setReadiness] = useState<PrivateConversationReadiness | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [history,setHistory]=useState<(FriendMessageCursor|null)[]>([null]);
  const before=history[history.length-1];
  const [older,setOlder]=useState<FriendMessageCursor|null>(null);
  const [loadingHistory,setLoadingHistory]=useState(false);
  const [historyError,setHistoryError]=useState(false);
  const [loadingAttachments,setLoadingAttachments]=useState<string|null>(null);
  const [draft, setDraft] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [planActivity, setPlanActivity] = useState("Dinner or coffee");
  const [customPlanActivity, setCustomPlanActivity] = useState("");
  const [planWhen, setPlanWhen] = useState("");
  const [planPlace, setPlanPlace] = useState("");
  const [propertyDraft, setPropertyDraft] = useState<SharedProperty | null>(null);
  const [workerDraft, setWorkerDraft] = useState<SharedWorker | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [replyingTo, setReplyingTo] = useState<Line | null>(null);
  const [actions, setActions] = useState<{ line: Line; mode: "reactions" | "actions"; anchor: MessageMenuAnchor } | null>(null);
  const [busy, setBusy] = useState(false);
  const pins = useMessagePins("friend", friend.friend_id, lines.length);
  const [reporting, setReporting] = useState(false);
  const [info, setInfo] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const voice = useVoiceRecorder();
  const media = useRef(new Map<string, { url: string; type: string }>());
  const loadVersion=useRef(0);
  const jumpTarget=useRef<string|null>(null);
  const attachmentRequest=useRef(false);
  const blocked = friend.status === "blocked";

  useEffect(() => { const worker = pendingWorkerShare(myUserId, friend.friend_id); setWorkerDraft(worker); setPropertyDraft(worker ? null : pendingPropertyShare(myUserId, friend.friend_id)); }, [myUserId, friend.friend_id]);

  useEffect(() => { const cache = media.current; return () => { for (const item of cache.values()) URL.revokeObjectURL(item.url); cache.clear(); }; }, [friend.friend_id,myUserId]);

  const load = useCallback(async (isActive:()=>boolean=()=>true):Promise<void> => {
    const version=++loadVersion.current;
    const current=()=>isActive()&&version===loadVersion.current;
    setLoadingHistory(true);setHistoryError(false);
    try {
    const state = await withTimeout(privateConversationReadiness("friend", friend.friend_id, friend.user_id),15000,'Secure chat took too long to open. Try again.');
    if(!current())return;
    setReadiness(state);
    if (state.state !== "ready") return;
    const { messages, older:nextOlder, error } = await withTimeout(getFriendEncryptedMessages(friend.friend_id,before),15000,'Message history took too long to load. Try again.');
    if(!current())return;
    if (error) { setHistoryError(true);toast.error(error.message || "Could not load messages"); return; }
    const decoded = await Promise.all(messages.map(async (m): Promise<Line> => {
      let content = "Message could not be decrypted on this device.";
      try { content = await decryptPrivateMessage("friend", friend.friend_id, friend.user_id, m.ciphertext, m.encryption_iv); } catch { /* keep the placeholder */ }
      const attachments: string[] = [], types: string[] = [];
      for (const item of (m.encrypted_attachments || []) as EncryptedAttachment[]) {
        if(!current())break;
        const hit = media.current.get(item.path);
        if (hit) { attachments.push(hit.url); types.push(hit.type); }
      }
      return { id: m.id, sender_id: m.sender_id, content, created_at: m.created_at, seen: true, attachments, attachment_types: types, reply_to_id: m.reply_to_id, reactions: m.reactions || {}, media_error: false, private_attachment_refs:m.encrypted_attachments as EncryptedAttachment[],media_pending:attachments.length<(m.encrypted_attachments||[]).length };
    }));
    if(current()) {
      const retained=new Set(messages.flatMap(m=>(m.encrypted_attachments||[]).map(item=>(item as EncryptedAttachment).path)));
      for(const [path,item] of media.current)if(!retained.has(path)){URL.revokeObjectURL(item.url);media.current.delete(path);}
      setLines(decoded);setOlder(nextOlder);
    }
    } catch(error) { if(current()){setHistoryError(true);toast.error(error instanceof Error?error.message:'Could not load messages');} }
    finally { if(current())setLoadingHistory(false); }
  }, [friend.friend_id, friend.user_id,before]);

  useEffect(() => {
    let live=false,lastRecovery=Date.now();
    const scheduler=createRefreshScheduler(load,()=>document.visibilityState==='visible');
    const refresh=()=>{lastRecovery=Date.now();scheduler.request();};
    refresh();
    const unsubscribe=subscribeToFriendChatChanges(friend.friend_id,refresh,healthy=>{live=healthy;});
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    // Recovery only; hidden tabs do no reads, and event bursts cannot overlap loads.
    const timer=window.setInterval(()=>{if(!live||Date.now()-lastRecovery>=300_000)refresh();},60_000);
    return()=>{
      loadVersion.current++;scheduler.dispose();unsubscribe();window.clearInterval(timer);
      window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);
    };
  }, [friend.friend_id,load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [lines.length]);
  useEffect(()=>{if(jumpTarget.current&&lines.some(line=>line.id===jumpTarget.current)){scrollToMessage(jumpTarget.current);jumpTarget.current=null;}},[lines]);
  function changeHistory(next:(FriendMessageCursor|null)[]) {
    loadVersion.current++;setLines([]);setOlder(null);setHistoryError(false);setHistory(next);
  }
  async function jumpToMessage(id:string) {
    if(lines.some(line=>line.id===id)){scrollToMessage(id);return;}
    const version=loadVersion.current;
    try {
      const cursor=await withTimeout(getFriendMessageHistoryCursor(friend.friend_id,id),15000,'Pinned message took too long to locate. Try again.');
      if(version!==loadVersion.current)return;
      jumpTarget.current=id;changeHistory(cursor?[null,cursor]:[null]);
    }catch(error){toast.error((error as Error)?.message||'Message is unavailable');}
  }
  async function loadAttachments(line:Line) {
    if(attachmentRequest.current)return;attachmentRequest.current=true;
    const version=loadVersion.current;setLoadingAttachments(line.id);
    const attachments:string[]=[],types:string[]=[];
    try {
      for(const item of line.private_attachment_refs||[]) {
        let hit=media.current.get(item.path);
        if(!hit) {
          const clear=await openFriendChatAttachment(friend.friend_id,friend.user_id,item);
          if(version!==loadVersion.current){URL.revokeObjectURL(clear.url);return;}
          hit={url:clear.url,type:clear.type};media.current.set(item.path,hit);
        }
        attachments.push(hit.url);types.push(hit.type);
      }
      if(version===loadVersion.current)setLines(all=>all.map(row=>row.id===line.id?{...row,attachments,attachment_types:types,media_pending:false,media_error:false}:row));
    }catch(error){if(version===loadVersion.current)toast.error(error instanceof Error?error.message:'Attachment could not be opened. Try again.');}
    finally{attachmentRequest.current=false;setLoadingAttachments(null);}
  }

  async function chooseFiles(list: FileList | null, source: ChatAttachmentSource = "media") {
    if (!list) return;
    const incoming: File[] = [];
    for (const file of Array.from(list)) {
      if (!isSelectableChatAttachment(file, source)) { toast.error(file.size > MAX_FILE_SIZE ? `${file.name} is larger than 25 MiB` : CHAT_MEDIA_ONLY_MESSAGE); continue; }
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

  async function send(overrideContent?: string, overrideReplyId?: string | null): Promise<boolean> {
    const text = (overrideContent ?? draft).trim();
    if ((!text && !files.length && !workerDraft && !propertyDraft) || busy || blocked) return false;
    setBusy(true);
    const preserveComposer = overrideContent !== undefined;
    const queued = preserveComposer ? [] : [...files];
    const replyId = overrideReplyId !== undefined ? overrideReplyId : replyingTo?.id || null;
    try {
      const content = preserveComposer ? text : workerDraft ? workerShareMessage(workerDraft, text) : propertyDraft ? propertyShareMessage(propertyDraft, text) : text;
      const signature = `friend-chat:${friend.friend_id}:${content}:${queued.map((f) => `${f.name}${f.size}`).join(",")}:${replyId}`;
      await runSafeAction(signature, async () => {
        const uploaded = await Promise.all(queued.map((file) => uploadFriendChatAttachment(file, friend.friend_id, friend.user_id)));
        const failed = uploaded.find((u) => u.error || !u.attachment);
        if (failed) throw failed.error || new Error("Could not upload the attachment");
        const { ciphertext, iv } = await encryptPrivateMessage("friend", friend.friend_id, friend.user_id, content);
        const { id, error } = await sendFriendEncryptedMessage(friend.friend_id, ciphertext, iv, uploaded.map((u) => u.attachment), replyId || undefined, requestKeyFor(signature));
        if (error) throw error;
        if (typeof id !== 'string' || !id.trim()) throw new Error('Message delivery could not be confirmed. Your draft has been kept; refresh this conversation before retrying.');
        releaseRequestKey(signature);
      });
      if (!preserveComposer) {
        if (workerDraft) clearWorkerShare(myUserId, friend.friend_id);
        if (propertyDraft) clearPropertyShare(myUserId, friend.friend_id);
        setPropertyDraft(null); setWorkerDraft(null); setDraft(""); setFiles([]); setReplyingTo(null);
      }
      if(before)changeHistory([null]);else await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message was not sent");
      return false;
    } finally { setBusy(false); }
  }

  async function sendPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activity = planActivity === "Something else" ? customPlanActivity.trim() : planActivity;
    if (!activity) return toast.error("Describe what you would like to do");
    if (!planWhen || new Date(planWhen).getTime() <= Date.now()) return toast.error("Choose a future date and time");
    try {
      const sent = await send(createFriendPlanMessage({ activity, when: new Date(planWhen).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", place: planPlace }), null);
      if (!sent) return;
      setPlanOpen(false);
      setPlanWhen("");
      setPlanPlace("");
      setCustomPlanActivity("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Plan could not be prepared"); }
  }

  async function replyToPlan(reply: "I'm in" | "Suggest a change", planMessageId: string) {
    await send(`${reply} for your plan.`, planMessageId);
  }

  async function react(line: Line, emoji: string) {
    const current = line.reactions[myUserId];
    const result = await reactToFriendMessage(friend.friend_id, line.id, current === emoji ? null : emoji);
    if (result.error) return toast.error(result.error.message);
    setLines((all) => all.map((l) => (l.id === line.id ? { ...l, reactions: result.reactions } : l)));
  }

  async function removeForMe(line: Line) {
    const { error } = await deleteFriendMessageForMe(friend.friend_id, line.id);
    if (error) return toast.error(error.message);
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
        items={pins.pinned.map(id=>{const line=lines.find(row=>row.id===id);return {id,text:line?(line.content||(line.private_attachment_refs?.length?'Attachment':'Message')):'Open pinned message in history'};})}
        onJump={id=>void jumpToMessage(id)}
        onUnpin={(id) => void pins.toggle(id)}
      />
      {readiness && readiness.state !== "ready" ? (
        <div className="flex-1 overflow-y-auto p-4"><SecureChatOnboarding status={readiness} personName={name} onReady={() => void load()} /></div>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            <nav aria-label="Message history" className="flex flex-wrap justify-center gap-2 pb-3">
              {older&&<button type="button" disabled={loadingHistory} onClick={()=>changeHistory([...history,older])} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-xs disabled:opacity-40">Earlier messages</button>}
              {before&&<><button type="button" disabled={loadingHistory} onClick={()=>changeHistory(history.slice(0,-1))} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-xs disabled:opacity-40">Newer messages</button><button type="button" onClick={()=>changeHistory([null])} className="min-h-11 px-3 text-xs underline">Return to latest</button></>}
            </nav>
            {before&&<p className="text-center text-xs text-[var(--wh-text-secondary)]">Viewing earlier messages. Return to latest to see new messages.</p>}
            {historyError&&<p role="alert" className="text-center text-xs">Messages could not be loaded. <button type="button" onClick={()=>void load()} className="min-h-11 underline">Try again</button></p>}
            {loadingHistory&&!lines.length&&<p role="status" className="text-center text-xs">Loading messages…</p>}
            {!loadingHistory&&!historyError&&!lines.length && <p className="text-center text-xs text-[var(--wh-text-secondary)]">{before?'No earlier messages on this page.':'No messages yet. Say hello.'}</p>}
            {lines.map((line) => (
              <div key={line.id}>
                {line.media_pending&&<button type="button" disabled={Boolean(loadingAttachments)} onClick={()=>void loadAttachments(line)} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-xs disabled:opacity-40">{loadingAttachments===line.id?'Opening attachments…':`Load ${line.private_attachment_refs?.length||''} attachment${line.private_attachment_refs?.length===1?'':'s'}`}</button>}
                <RoommateBubble
                  msg={line as never}
                  mine={line.sender_id === myUserId}
                  allowFriendPlans
                  friendPlanBusy={busy || blocked}
                  friendPlanReplyState={lines.some((reply) => reply.reply_to_id === line.id && reply.content === "I'm in for your plan.") ? "accepted" : lines.some((reply) => reply.reply_to_id === line.id && reply.content === "Suggest a change for your plan.") ? "change_suggested" : null}
                  onFriendPlanReply={replyToPlan}
                  quoted={line.reply_to_id ? (lines.find((l) => l.id === line.reply_to_id) as never) : undefined}
                  onOpenActions={(anchor) => setActions({ line, mode: "actions", anchor })}
                  onTapReaction={(anchor) => setActions({ line, mode: "reactions", anchor })}
                  onReply={() => setReplyingTo(line)}
                  onOpenProperty={(page, id) => {onClose();onNavigate(page,id);}}
                  onOpenWorker={(id) => {onClose();onNavigate("worker_discovery",id);}}
                  onOpenExperience={id=>{onClose();onNavigate('experience',id);}}
                />
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <footer className="border-t border-[var(--wh-border-subtle)] p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
            {blocked ? (
              <p className="py-2 text-center text-xs text-[var(--wh-text-secondary)]">You blocked {name}. Unblock them from your Friends list to chat again.</p>
            ) : (
              <>
                {propertyDraft && <PropertyDraftAttachment property={propertyDraft} onRemove={() => { clearPropertyShare(myUserId, friend.friend_id); setPropertyDraft(null); }} />}
                {workerDraft && <WorkerDraftAttachment activity={workerDraft.kind==='experience'} onRemove={() => { clearWorkerShare(myUserId, friend.friend_id); setWorkerDraft(null); }} />}
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
                  <button type="button" onClick={() => setPlanOpen(true)} disabled={busy} aria-label="Suggest a plan with this Friend" title="Suggest a plan" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"><CalendarPlus size={17} aria-hidden="true" /></button>
                  <ChatAttachmentPicker onFiles={chooseFiles} disabled={busy} />
                  <button type="button" onClick={() => void toggleVoice()} aria-label={voice.recording ? "Finish voice recording" : "Record voice note"}
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${voice.recording ? "bg-red-500 text-white" : "border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"}`}><Mic size={18} aria-hidden="true" /></button>
                  <input value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 4000))} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} aria-label="Message" placeholder="Message" className="min-h-11 min-w-0 flex-1 rounded-[22px] border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-4 text-sm outline-none focus:border-violet-500/40" />
                  <button type="button" onClick={() => void send()} disabled={busy || (!draft.trim() && !files.length && !workerDraft && !propertyDraft)} aria-label="Send" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-600 text-white disabled:opacity-40">{busy ? "…" : "➤"}</button>
                </div>
              </>
            )}
          </footer>
          <Dialog open={planOpen} onOpenChange={setPlanOpen}>
            <DialogContent showCloseButton={false} overlayClassName="!z-[85]" className="!z-[86] !top-auto !bottom-0 !left-0 !translate-x-0 !translate-y-0 !max-h-[90dvh] !w-full !max-w-none overflow-y-auto rounded-t-3xl border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[var(--wh-text)] sm:!left-1/2 sm:!top-1/2 sm:!bottom-auto sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!max-w-md sm:!rounded-3xl">
            <form onSubmit={(event) => void sendPlan(event)} className="space-y-4">
              <div><DialogTitle>Plan something with {name}</DialogTitle><DialogDescription className="mt-2 leading-5 text-[var(--wh-text-secondary)]">This private suggestion stays in your encrypted chat. It does not book or charge for anything.</DialogDescription></div>
              <label className="block text-sm">What would you like to do?<select value={planActivity} onChange={(event) => setPlanActivity(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base"><option>Dinner or coffee</option><option>Walk or catch-up</option><option>Day activity</option><option>Trip or stay</option><option>Something else</option></select></label>
              {planActivity === "Something else" && <label className="block text-sm">Your plan<input value={customPlanActivity} onChange={(event) => setCustomPlanActivity(event.target.value)} maxLength={60} required placeholder="For example, a picnic at the park" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base" /></label>}
              <label className="block text-sm">Suggested date and time<input required type="datetime-local" min={localDateTimeValue(new Date(Date.now() + 60_000))} value={planWhen} onChange={(event) => setPlanWhen(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base" /></label>
              <label className="block text-sm">Place or event name <span className="text-[var(--wh-text-secondary)]">(optional)</span><input value={planPlace} maxLength={140} onChange={(event) => setPlanPlace(event.target.value)} placeholder="A place, or leave it for you both to choose" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base" /></label>
              <div className="flex gap-2"><button type="button" onClick={() => setPlanOpen(false)} className="min-h-11 flex-1 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">Cancel</button><button type="submit" disabled={busy || !planWhen} className="min-h-11 flex-1 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">Send plan</button></div>
            </form>
            </DialogContent>
          </Dialog>
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
            {friend.username && <p className="text-sm text-[var(--wh-text-secondary)]">@{friend.username}</p>}
            <p className="mt-4 text-xs leading-5 text-[var(--wh-text-secondary)]">Friend messages and private plans are end-to-end encrypted, so WeHouse cannot read them. Friends can share eligible Long Let and Short Let booking costs. Hotel cost-sharing is not available yet.</p>
            <div className="mt-8 space-y-2">
              <button type="button" onClick={() => { setInfo(false); setReporting(true); }} className="h-12 w-full rounded-2xl border border-[var(--wh-border-subtle)] text-[11px] font-semibold">Report</button>
              <button type="button" disabled={busy} onClick={() => {
                if (!window.confirm(`Block ${name}? They will not be able to message you or send you requests. You can unblock them anytime and your chat will still be there.`)) return;
                void runSafeAction(`friend-block:${friend.user_id}`, () => blockFriend(friend.user_id)).then((result) => {
                  if (result.error) return toast.error(result.error.message);
                  toast.success("Blocked");
                  onClose();
                }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not block"));
              }} className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200">Block</button>
            </div>
          </div>
        </div>
      )}
      {reporting && <ReportDialog subjectType="friend_chat" subjectUserId={friend.user_id} subjectName={name} onClose={() => setReporting(false)} />}
    </div>
  );
}

function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
