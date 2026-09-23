import MessagePress from '@/components/MessagePress';
import SharedPropertyCard from '@/components/SharedPropertyCard';
import MessageMedia, { AttachmentState } from '@/components/MessageMedia';
import { parsePropertyShareMessage, propertyMessagePreview } from '@/lib/propertyShare';
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
}: {
  onOpenProperty: (page: string, id: string) => void;
  msg: RoommateMessage;
  mine: boolean;
  quoted?: RoommateMessage;
  onOpenActions: (anchor: DOMRect) => void;
  onTapReaction: (anchor: DOMRect) => void;
  onReply: () => void;
}) {
  const shared = parsePropertyShareMessage(msg.content || "");
  const reactions = Object.values(msg.reactions || {}).reduce<
    Record<string, number>
  >((all, emoji) => ({ ...all, [emoji]: (all[emoji] || 0) + 1 }), {});
  return (
    <MessagePress
      onOpen={onOpenActions}
      onTap={onTapReaction}
      onReply={onReply}
      className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[86%] cursor-pointer rounded-[20px] px-3.5 py-2.5 sm:max-w-[70%] ${shared ? `border border-white/[.09] bg-[#171B24] ${mine ? "rounded-br-md" : "rounded-bl-md"}` : mine ? "rounded-br-md bg-violet-500" : "rounded-bl-md border border-white/[.06] bg-[#151821]"}`}
      >
        {quoted && (
          <div
            className={`mb-2 rounded-xl border-l-2 px-2.5 py-2 ${mine ? "border-violet-100/70 bg-black/10" : "border-violet-400 bg-white/[.035]"}`}
          >
            <p className="text-xs font-semibold opacity-90">
              {quoted.sender_id === msg.sender_id ? "Earlier message" : "Reply"}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm opacity-90">
              {propertyMessagePreview(quoted.content || "") ||
                ((quoted.attachments || []).length ? "Attachment" : "Message")}
            </p>
          </div>
        )}
        {msg.media_loading && <AttachmentState />}
        {msg.media_error && <AttachmentState error />}
        <MessageMedia items={(msg.attachments || []).map((url, index) => ({ url, type: msg.attachment_types?.[index] || "" }))} />
        {shared ? <>
          {shared.text && <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-6">{shared.text}</p>}
          <SharedPropertyCard property={shared.property} onOpen={onOpenProperty} />
        </> : msg.content && <p className="whitespace-pre-wrap break-words text-sm leading-6">{msg.content}</p>}
        <p
          className={`mt-1 text-right text-xs ${mine ? "text-violet-100/80" : "text-[#A5AAB8]"}`}
        >
          {time(msg.created_at)}
          {mine ? msg.delivery_state === "sending" ? " · Sending…" : msg.delivery_state === "failed" ? " · Not sent" : msg.seen ? " · Seen" : " · Sent" : ""}
        </p>
        {Object.keys(reactions).length > 0 && (
          <div
            className={`absolute -bottom-3 ${mine ? "right-2" : "left-2"} flex gap-1 rounded-full border border-white/[.08] bg-[#171A22] px-2 py-0.5 text-[10px] shadow-lg`}
          >
            {Object.entries(reactions).map(([emoji, count]) => (
              <span key={emoji}>
                {emoji}
                {count > 1 ? (
                  <small className="ml-0.5 text-[7px] text-[#A6AAB6]">
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
