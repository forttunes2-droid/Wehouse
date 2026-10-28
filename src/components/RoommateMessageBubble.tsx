import MessagePress from '@/components/MessagePress';
import SharedPropertyCard from '@/components/SharedPropertyCard';
import {CalendarDays,UserRound} from 'lucide-react';
import MessageMedia, { AttachmentState } from '@/components/MessageMedia';
import { parsePropertyShareMessage, propertyMessagePreview } from '@/lib/propertyShare';
import { parseWorkerShareMessage, workerMessagePreview } from '@/lib/workerShare';
import { formatFriendPlanTime, parseFriendPlanMessage } from '@/lib/friendPlans';
import type { Message } from '@/types';
import type { MessageSyncState } from '@/lib/chatMessageReconciliation';
type RoommateMessage = Message & MessageSyncState & {
  attachments?: string[]; attachment_types?: string[]; reply_to_id?: string | null;
  reactions?: Record<string, string>; delivery_state?: 'sending' | 'failed';
};
export default function RoommateBubble({
  msg,
  mine,
  quoted,
  onOpenActions,
  onTapReaction,
  onReply,
  onOpenProperty,
  onOpenWorker,
  onOpenExperience,
  allowFriendPlans = false,
  friendPlanBusy = false,
  friendPlanReplyState = null,
  onFriendPlanReply,
}: {
  onOpenProperty: (page: string, id: string) => void;
  onOpenWorker?: (id: string) => void;
  onOpenExperience?: (id: string) => void;
  msg: RoommateMessage;
  mine: boolean;
  quoted?: RoommateMessage;
  onOpenActions: (anchor: DOMRect) => void;
  onTapReaction: (anchor: DOMRect) => void;
  onReply: () => void;
  allowFriendPlans?: boolean;
  friendPlanBusy?: boolean;
  friendPlanReplyState?: "accepted" | "change_suggested" | null;
  onFriendPlanReply?: (reply: "I'm in" | "Suggest a change", planMessageId: string) => void;
}) {
  const shared = parsePropertyShareMessage(msg.content || "");
  const sharedWorker = parseWorkerShareMessage(msg.content || "");
  const friendPlan = allowFriendPlans ? parseFriendPlanMessage(msg.content || "") : null;
  const reactions = Object.values(msg.reactions || {}).reduce<
    Record<string, number>
  >((all, emoji) => ({ ...all, [emoji]: (all[emoji] || 0) + 1 }), {});
  return (
    <MessagePress
      messageId={msg.id}
      onOpen={onOpenActions}
      onTap={onTapReaction}
      onReply={onReply}
      className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[86%] cursor-pointer rounded-[20px] px-3.5 py-2.5 sm:max-w-[70%] ${shared||sharedWorker ? `border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] ${mine ? "rounded-br-md" : "rounded-bl-md"}` : mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]"}`}
      >
        {quoted && (
          <div
            className={`mb-2 rounded-xl border-l-2 px-2.5 py-2 ${mine ? "border-violet-100/70 bg-black/10" : "border-violet-400 bg-[var(--wh-interactive)]"}`}
          >
            <p className="text-xs font-semibold opacity-90">
              {quoted.sender_id === msg.sender_id ? "Earlier message" : "Reply"}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm opacity-90">
              {workerMessagePreview(quoted.content || "") !== quoted.content ? workerMessagePreview(quoted.content || "") : propertyMessagePreview(quoted.content || "") ||
                ((quoted.attachments || []).length ? "Attachment" : "Message")}
            </p>
          </div>
        )}
        {msg.media_loading && <AttachmentState />}
        {msg.media_error && <AttachmentState error />}
        <MessageMedia items={(msg.attachments || []).map((url, index) => ({ url, type: msg.attachment_types?.[index] || "" }))} />
        {friendPlan ? <section aria-label="Private Friend plan" className="min-w-[min(70vw,18rem)] rounded-xl border border-violet-400/30 bg-[var(--wh-surface)] p-3 text-[var(--wh-text)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">Plan together</p>
          <h3 className="mt-2 break-words text-base font-semibold">{friendPlan.activity}</h3>
          <p className="mt-1 text-sm">{formatFriendPlanTime(friendPlan.when, friendPlan.timeZone)}</p>
          <p className="mt-1 break-words text-sm text-[var(--wh-text-secondary)]">{friendPlan.place}</p>
          {friendPlanReplyState && <p role="status" className="mt-3 rounded-lg bg-violet-500/10 px-2.5 py-2 text-xs font-medium text-violet-700 dark:text-violet-200">{friendPlanReplyState === "accepted" ? mine ? "Your Friend is in" : "You’re in" : mine ? "Your Friend suggested a change" : "You suggested a change"}</p>}
          {!mine && onFriendPlanReply && <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={friendPlanBusy} onClick={(event) => { event.stopPropagation(); onFriendPlanReply("I'm in", msg.id); }} className="min-h-10 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-40">I’m in</button><button type="button" disabled={friendPlanBusy} onClick={(event) => { event.stopPropagation(); onFriendPlanReply("Suggest a change", msg.id); }} className="min-h-10 rounded-lg border border-[var(--wh-border-subtle)] px-3 text-xs font-semibold disabled:opacity-40">Suggest a change</button></div>}
          <p className="mt-3 text-xs text-[var(--wh-text-secondary)]">A private suggestion. No booking or payment is created.</p>
        </section> : sharedWorker ? <>
          {sharedWorker.text && <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-6">{sharedWorker.text}</p>}
          <button type="button" data-message-swipe-surface="true" onClick={event => { event.stopPropagation(); if(sharedWorker.worker.kind==='experience')onOpenExperience?.(sharedWorker.worker.id);else onOpenWorker?.(sharedWorker.worker.id); }} className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-3 text-left" aria-label={sharedWorker.worker.kind==='experience'?'Open shared activity':'Open recommended Worker profile'}>
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--wh-accent-surface)] text-[var(--wh-accent-text)]">{sharedWorker.worker.kind==='experience'?<CalendarDays size={22}/>:<UserRound size={22}/>}</span>
            <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--wh-accent-text)]">{sharedWorker.worker.kind==='experience'?'Activity suggestion':'Service Worker recommendation'}</span><span className="mt-1 block text-sm font-semibold">{sharedWorker.worker.kind==='experience'?'View activity and dates':'View Service Worker profile'}</span></span>
          </button>
        </> : shared ? <>
          {shared.text && <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-6">{shared.text}</p>}
          <SharedPropertyCard property={shared.property} onOpen={onOpenProperty} />
        </> : msg.content && <p className="whitespace-pre-wrap break-words text-sm leading-6">{msg.content}</p>}
        <p
          className={`mt-1 text-right text-xs ${mine ? "text-violet-100/80" : "text-[var(--wh-text-secondary)]"}`}
        >
          {time(msg.created_at)}
          {mine ? msg.delivery_state === "sending" ? " · Sending…" : msg.delivery_state === "failed" ? " · Not sent" : msg.seen ? " · Seen" : " · Sent" : ""}
        </p>
        {Object.keys(reactions).length > 0 && (
          <div
            className={`absolute -bottom-3 ${mine ? "right-2" : "left-2"} flex gap-1 rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-2 py-0.5 text-[10px] shadow-lg`}
          >
            {Object.entries(reactions).map(([emoji, count]) => (
              <span key={emoji}>
                {emoji}
                {count > 1 ? (
                  <small className="ml-0.5 text-[7px] text-[var(--wh-text-secondary)]">
                    {count}
                  </small>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </div>
    </MessagePress>
  );
}
function time(value: string) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
